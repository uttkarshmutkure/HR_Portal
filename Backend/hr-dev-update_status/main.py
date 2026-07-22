"""
Candidate Status Update — Cloud Function (HTTP)
────────────────────────────────────────────────
Updates candidate_result in BQ as candidates move through the hiring funnel.

Allowed transitions (strictly enforced):
  Passed       → Shortlisted
  Human Review → Shortlisted
  Shortlisted  → Interview
  Shortlisted  → Rejected
  Interview    → Selected
  Interview    → Rejected

Any other transition is rejected with HTTP 422.

Deploy command
──────────────
  gcloud functions deploy update_candidate_status \
    --gen2 \
    --runtime=python312 \
    --region=asia-south1 \
    --source=. \
    --entry-point=update_candidate_status \
    --trigger-http \
    --allow-unauthenticated \
    --set-env-vars GOOGLE_CLOUD_PROJECT=atgeir-moae-dev,BQ_DATASET_ID=hr_dataset \
    --memory=256Mi \
    --timeout=60s
"""

import functions_framework
from google.cloud import bigquery
import logging
import json
import os

# ── CONFIG ────────────────────────────────────────────────────────────────────

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID = os.environ.get("BQ_DATASET_ID",        "hr_dataset")

# ── ALLOWED TRANSITIONS ───────────────────────────────────────────────────────
#
#   current result  →  set of results it can move TO
#
ALLOWED_TRANSITIONS = {
    "Passed":       {"Shortlisted", "Rejected"},
    "Human Review": {"Shortlisted", "Rejected"},
    "Shortlisted":  {"Interview", "Rejected"},
    "Interview":    {"Selected",  "Rejected"},
}
# Archive / Selected / Rejected are terminal — no further moves allowed.

# ── CORS HEADERS ──────────────────────────────────────────────────────────────

HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age":       "3600",
    "Content-Type":                 "application/json",
}

# ── CLIENT ────────────────────────────────────────────────────────────────────

bq_client = bigquery.Client(project=PROJECT_ID)


# ── HELPERS ───────────────────────────────────────────────────────────────────

def _error(message: str, code: int):
    return (json.dumps({"status": "error", "message": message}), code, HEADERS)

def _ok(payload: dict):
    return (json.dumps({"status": "success", **payload}), 200, HEADERS)


# ── ENTRY POINT ───────────────────────────────────────────────────────────────

@functions_framework.http
def update_candidate_status(request):
    """
    Accepts two request shapes:

    1. Single update
       POST { "candidate_id": "abc", "candidate_result": "Shortlisted" }

    2. Bulk update (same result for multiple candidates)
       POST { "candidate_ids": ["abc", "def"], "candidate_result": "Shortlisted" }

    The CF fetches each candidate's current result from BQ and validates
    the transition is allowed before writing.
    """

    # ── CORS preflight ────────────────────────────────────────────────────────
    if request.method == "OPTIONS":
        return ("", 204, HEADERS)

    # ── Parse body ────────────────────────────────────────────────────────────
    body = request.get_json(silent=True)
    logging.info("update_candidate_status called: %s", body)

    if not body:
        return _error("Request body missing or not valid JSON.", 400)

    if body.get("action") == "DELETE_CANDIDATE":
        candidate_id = body.get("candidate_id")
        if not candidate_id:
            return _error("candidate_id is required for deletion.", 400)
        delete_query = f"""
            DELETE FROM `{PROJECT_ID}.{DATASET_ID}.candidates`
            WHERE candidate_id = '{candidate_id}'
        """
        try:
            result = bq_client.query(delete_query).result()
            rows_deleted = result.num_dml_affected_rows or 0
            
            # Delete from candidate_slot_selections to keep DB clean
            delete_slots_query = f"""
                DELETE FROM `{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections`
                WHERE candidate_id = '{candidate_id}'
            """
            bq_client.query(delete_slots_query).result()
            
            logging.info("Deleted candidate %s (%d row)", candidate_id, rows_deleted)
            return _ok({ "deleted_count": rows_deleted, "candidate_id": candidate_id })
        except Exception as e:
            logging.error("BQ delete failed: %s", e)
            return _error(str(e), 500)

    candidate_result = body.get("candidate_result")
    if not candidate_result:
        return _error("candidate_result is required.", 400)

    # ── Resolve candidate ID(s) ───────────────────────────────────────────────
    candidate_id  = body.get("candidate_id")
    candidate_ids = body.get("candidate_ids")

    if candidate_id:
        candidate_ids = [candidate_id]
    elif candidate_ids:
        if not isinstance(candidate_ids, list) or not candidate_ids:
            return _error("candidate_ids must be a non-empty list.", 400)
    else:
        return _error("Provide either candidate_id (single) or candidate_ids (bulk).", 400)

    # ── Fetch current results from BQ ─────────────────────────────────────────
    id_list = ", ".join(f"'{cid}'" for cid in candidate_ids)

    fetch_query = f"""
        SELECT candidate_id, job_id, name, email, candidate_result AS current_result
        FROM `{PROJECT_ID}.{DATASET_ID}.candidates`
        WHERE candidate_id IN ({id_list})
    """

    try:
        current_rows = list(bq_client.query(fetch_query).result())
    except Exception as e:
        logging.error("BQ fetch failed: %s", e)
        return _error(str(e), 500)

    if not current_rows:
        return _error("No candidates found for the provided ID(s).", 404)

    # ── Validate every candidate's transition ─────────────────────────────────
    blocked     = []   # candidates whose transition is not allowed
    allowed_ids = []   # candidates cleared to update

    for row in current_rows:
        cid     = row.candidate_id
        current = row.current_result

        allowed_next = ALLOWED_TRANSITIONS.get(current)

        if allowed_next is None:
            # Terminal state — Archive, Selected, Rejected
            blocked.append({
                "candidate_id":   cid,
                "current_result": current,
                "reason":         f"'{current}' is a terminal stage. No further moves allowed.",
            })
        elif candidate_result not in allowed_next:
            blocked.append({
                "candidate_id":   cid,
                "current_result": current,
                "reason": (
                    f"Cannot move from '{current}' to '{candidate_result}'. "
                    f"Allowed: {', '.join(sorted(allowed_next))}."
                ),
            })
        else:
            allowed_ids.append(cid)

    # If ANY candidate fails validation, reject the whole request.
    # This prevents partial bulk updates which are hard to debug.
    if blocked:
        return (
            json.dumps({
                "status":  "error",
                "message": "One or more candidates cannot make this transition.",
                "blocked": blocked,
            }),
            422,
            HEADERS,
        )

    # ── Run the UPDATE for all cleared candidates ─────────────────────────────
    update_id_list = ", ".join(f"'{cid}'" for cid in allowed_ids)

    update_query = f"""
        UPDATE `{PROJECT_ID}.{DATASET_ID}.candidates`
        SET
            candidate_result = @candidate_result,
            applied_at       = CURRENT_TIMESTAMP()
        WHERE candidate_id IN ({update_id_list})
    """

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("candidate_result", "STRING", candidate_result),
        ]
    )

    logging.info(
        "Updating %d candidate(s) → %s | IDs: %s",
        len(allowed_ids), candidate_result, allowed_ids,
    )

    try:
        result = bq_client.query(update_query, job_config=job_config).result()
        rows_affected = result.num_dml_affected_rows or 0

        # Sync to 'candidate_slot_selections' table
        for row in current_rows:
            if row.candidate_id in allowed_ids:
                merge_query = f"""
                    MERGE `{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections` T
                    USING (
                        SELECT
                            @job_id AS job_id,
                            @candidate_id AS candidate_id,
                            @name AS candidate_name,
                            @email AS candidate_email,
                            @status AS status
                    ) S
                    ON T.job_id = S.job_id AND T.candidate_id = S.candidate_id
                    WHEN MATCHED THEN
                        UPDATE SET 
                            status = S.status,
                            confirmed_at = CURRENT_TIMESTAMP()
                    WHEN NOT MATCHED THEN
                        INSERT (slot_id, job_id, candidate_id, candidate_name, candidate_email, round, status, confirmed_at)
                        VALUES (S.candidate_id, S.job_id, S.candidate_id, S.candidate_name, S.candidate_email, 'round1', S.status, CURRENT_TIMESTAMP())
                """
                merge_config = bigquery.QueryJobConfig(
                    query_parameters=[
                        bigquery.ScalarQueryParameter("job_id", "STRING", row.job_id),
                        bigquery.ScalarQueryParameter("candidate_id", "STRING", row.candidate_id),
                        bigquery.ScalarQueryParameter("name", "STRING", row.name),
                        bigquery.ScalarQueryParameter("email", "STRING", row.email),
                        bigquery.ScalarQueryParameter("status", "STRING", candidate_result),
                    ]
                )
                bq_client.query(merge_query, job_config=merge_config).result()

        logging.info("Updated %d row(s) successfully.", rows_affected)
        return _ok({
            "updated_count":    rows_affected,
            "candidate_result": candidate_result,
            "candidate_ids":    allowed_ids,
        })

    except Exception as e:
        logging.error("BQ update failed: %s", e)
        return _error(str(e), 500)