"""
Candidate Status Update — Cloud Function (HTTP)
────────────────────────────────────────────────
Updates candidate_result in BQ as candidates move through the hiring funnel.

Allowed transitions (strictly enforced):
  Passed       → Shortlisted / Rejected
  Human Review → Shortlisted / Rejected
  Shortlisted  → Interview / Rejected
  Interview    → Selected / Rejected / Hired
  Selected     → Hired / Rejected

NEW: moving to "Hired" additionally requires BOTH Aadhaar and PAN to be
verified in the `preboarding` table. Enforced here so it can't be bypassed by
calling the API directly.

Any other transition is rejected with HTTP 422.
gcloud functions deploy update_candidate_status `
  --gen2 `
  --runtime=python312 `
  --region=asia-south1 `
  --source=. `
  --entry-point=update_candidate_status `
  --trigger-http `
  --allow-unauthenticated `
  --set-env-vars GOOGLE_CLOUD_PROJECT=atgeir-moae-dev,BQ_DATASET_ID=hr_dataset `
  --memory=256Mi `
  --timeout=60s
"""

import functions_framework
from google.cloud import bigquery
import logging
import json
import os

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID = os.environ.get("BQ_DATASET_ID",        "hr_dataset")

ALLOWED_TRANSITIONS = {
    "Passed":       {"Shortlisted", "Rejected"},
    "Human Review": {"Shortlisted", "Rejected"},
    "Shortlisted":  {"Interview", "Rejected"},
    "Interview":    {"Selected",  "Rejected", "Hired"},
    "Selected":     {"Hired", "Rejected"},
}

HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age":       "3600",
    "Content-Type":                 "application/json",
}

bq_client = bigquery.Client(project=PROJECT_ID)


def _error(message: str, code: int):
    return (json.dumps({"status": "error", "message": message}), code, HEADERS)

def _ok(payload: dict):
    return (json.dumps({"status": "success", **payload}), 200, HEADERS)

def _ids_cfg(ids, **scalars):
    params = [bigquery.ArrayQueryParameter("ids", "STRING", ids)]
    params += [bigquery.ScalarQueryParameter(k, "STRING", v) for k, v in scalars.items()]
    return bigquery.QueryJobConfig(query_parameters=params)


@functions_framework.http
def update_candidate_status(request):
    """
    1. Single update: POST { "candidate_id": "abc", "candidate_result": "Shortlisted" }
    2. Bulk update:   POST { "candidate_ids": ["abc","def"], "candidate_result": "Shortlisted" }
    """
    if request.method == "OPTIONS":
        return ("", 204, HEADERS)

    body = request.get_json(silent=True)
    logging.info("update_candidate_status called: %s", body)

    if not body:
        return _error("Request body missing or not valid JSON.", 400)

    # ── Delete (now parameterised — was string-interpolated before) ───────────
    if body.get("action") == "DELETE_CANDIDATE":
        candidate_id = body.get("candidate_id")
        if not candidate_id:
            return _error("candidate_id is required for deletion.", 400)
        cfg = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("cid", "STRING", candidate_id)])
        try:
            result = bq_client.query(
                f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.candidates` WHERE candidate_id = @cid",
                job_config=cfg).result()
            rows_deleted = result.num_dml_affected_rows or 0
            bq_client.query(
                f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections` WHERE candidate_id = @cid",
                job_config=cfg).result()
            logging.info("Deleted candidate %s (%d row)", candidate_id, rows_deleted)
            return _ok({"deleted_count": rows_deleted, "candidate_id": candidate_id})
        except Exception as e:
            logging.error("BQ delete failed: %s", e)
            return _error(str(e), 500)

    candidate_result = body.get("candidate_result")
    if not candidate_result:
        return _error("candidate_result is required.", 400)

    candidate_id  = body.get("candidate_id")
    candidate_ids = body.get("candidate_ids")

    if candidate_id:
        candidate_ids = [candidate_id]
    elif candidate_ids:
        if not isinstance(candidate_ids, list) or not candidate_ids:
            return _error("candidate_ids must be a non-empty list.", 400)
    else:
        return _error("Provide either candidate_id (single) or candidate_ids (bulk).", 400)

    # ── Fetch current results ─────────────────────────────────────────────────
    try:
        current_rows = list(bq_client.query(
            f"""SELECT candidate_id, job_id, name, email, candidate_result AS current_result
                FROM `{PROJECT_ID}.{DATASET_ID}.candidates`
                WHERE candidate_id IN UNNEST(@ids)""",
            job_config=_ids_cfg(candidate_ids)).result())
    except Exception as e:
        logging.error("BQ fetch failed: %s", e)
        return _error(str(e), 500)

    if not current_rows:
        return _error("No candidates found for the provided ID(s).", 404)

    # ── Validate transitions ──────────────────────────────────────────────────
    blocked, allowed_ids = [], []
    for row in current_rows:
        cid, current = row.candidate_id, row.current_result
        allowed_next = ALLOWED_TRANSITIONS.get(current)
        if allowed_next is None:
            blocked.append({"candidate_id": cid, "current_result": current,
                            "reason": f"'{current}' is a terminal stage. No further moves allowed."})
        elif candidate_result not in allowed_next:
            blocked.append({"candidate_id": cid, "current_result": current,
                            "reason": (f"Cannot move from '{current}' to '{candidate_result}'. "
                                       f"Allowed: {', '.join(sorted(allowed_next))}.")})
        else:
            allowed_ids.append(cid)

    # ── NEW: Hired gate — Aadhaar + PAN must both be verified ─────────────────
    if candidate_result == "Hired" and allowed_ids:
        try:
            verified = {r.candidate_id for r in bq_client.query(
                f"""SELECT candidate_id FROM `{PROJECT_ID}.{DATASET_ID}.preboarding`
                    WHERE candidate_id IN UNNEST(@ids)
                      AND aadhaar_status = 'verified' AND pan_status = 'verified'""",
                job_config=_ids_cfg(allowed_ids)).result()}
        except Exception as e:
            logging.error("Preboarding check failed: %s", e)
            return _error("Could not verify preboarding documents: " + str(e), 500)
        for cid in allowed_ids:
            if cid not in verified:
                blocked.append({"candidate_id": cid, "current_result": "Interview/Selected",
                                "reason": "Aadhaar and PAN must both be verified before moving to Hired."})
        allowed_ids = [cid for cid in allowed_ids if cid in verified]

    if blocked:
        return (json.dumps({"status": "error",
                            "message": "One or more candidates cannot make this transition.",
                            "blocked": blocked}), 422, HEADERS)

    # ── Update ────────────────────────────────────────────────────────────────
    logging.info("Updating %d candidate(s) → %s | IDs: %s", len(allowed_ids), candidate_result, allowed_ids)
    try:
        result = bq_client.query(
            f"""UPDATE `{PROJECT_ID}.{DATASET_ID}.candidates`
                SET candidate_result = @candidate_result, applied_at = CURRENT_TIMESTAMP()
                WHERE candidate_id IN UNNEST(@ids)""",
            job_config=_ids_cfg(allowed_ids, candidate_result=candidate_result)).result()
        rows_affected = result.num_dml_affected_rows or 0

        # Sync to candidate_slot_selections (unchanged behaviour)
        for row in current_rows:
            if row.candidate_id in allowed_ids:
                merge_query = f"""
                    MERGE `{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections` T
                    USING (
                        SELECT @job_id AS job_id, @candidate_id AS candidate_id, @round AS round,
                               @slot_id AS slot_id, @name AS candidate_name,
                               @email AS candidate_email, @status AS status
                    ) S
                    ON T.job_id = S.job_id AND T.candidate_id = S.candidate_id AND T.round = S.round
                    WHEN MATCHED THEN
                        UPDATE SET status = S.status, confirmed_at = CURRENT_TIMESTAMP()
                    WHEN NOT MATCHED THEN
                        INSERT (slot_id, job_id, candidate_id, candidate_name, candidate_email, round, status, confirmed_at)
                        VALUES (S.slot_id, S.job_id, S.candidate_id, S.candidate_name, S.candidate_email, S.round, S.status, CURRENT_TIMESTAMP())
                """
                merge_config = bigquery.QueryJobConfig(query_parameters=[
                    bigquery.ScalarQueryParameter("job_id", "STRING", row.job_id),
                    bigquery.ScalarQueryParameter("candidate_id", "STRING", row.candidate_id),
                    bigquery.ScalarQueryParameter("round", "STRING", "round1"),
                    bigquery.ScalarQueryParameter("slot_id", "STRING", f"{row.candidate_id}_round1"),
                    bigquery.ScalarQueryParameter("name", "STRING", row.name),
                    bigquery.ScalarQueryParameter("email", "STRING", row.email),
                    bigquery.ScalarQueryParameter("status", "STRING", candidate_result),
                ])
                bq_client.query(merge_query, job_config=merge_config).result()

        logging.info("Updated %d row(s) successfully.", rows_affected)
        return _ok({"updated_count": rows_affected, "candidate_result": candidate_result,
                    "candidate_ids": allowed_ids})
    except Exception as e:
        logging.error("BQ update failed: %s", e)
        return _error(str(e), 500)