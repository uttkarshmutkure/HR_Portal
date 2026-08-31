"""
update_candidate_status — FastAPI route, mirrors the old
`hr-dev-update-candidate-status` Cloud Function. Same transition-validation
logic, same bulk/single support, same DELETE_CANDIDATE action.
"""

import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from google.cloud import bigquery

import config
from bigquery_client import bq_client

router = APIRouter()

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID

# ── ALLOWED TRANSITIONS ───────────────────────────────────────────────────────
ALLOWED_TRANSITIONS = {
    "Passed":       {"Shortlisted", "Rejected"},
    "Human Review": {"Shortlisted", "Rejected"},
    "Shortlisted":  {"Interview", "Rejected"},
    "Interview":    {"Selected",  "Rejected"},
}
# Archive / Selected / Rejected are terminal — no further moves allowed.


def _error(message: str, code: int):
    return JSONResponse({"status": "error", "message": message}, status_code=code)

def _ok(payload: dict):
    return JSONResponse({"status": "success", **payload})


@router.post("/api/update-candidate-status")
async def update_candidate_status(request: Request):
    """
    Accepts two request shapes:
    1. Single update:  { "candidate_id": "abc", "candidate_result": "Shortlisted" }
    2. Bulk update:     { "candidate_ids": ["abc", "def"], "candidate_result": "Shortlisted" }
    """
    body = await request.json()
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

            delete_slots_query = f"""
                DELETE FROM `{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections`
                WHERE candidate_id = '{candidate_id}'
            """
            bq_client.query(delete_slots_query).result()

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

    blocked     = []
    allowed_ids = []

    for row in current_rows:
        cid     = row.candidate_id
        current = row.current_result

        allowed_next = ALLOWED_TRANSITIONS.get(current)

        if allowed_next is None:
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

    if blocked:
        return JSONResponse({
            "status":  "error",
            "message": "One or more candidates cannot make this transition.",
            "blocked": blocked,
        }, status_code=422)

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

        for row in current_rows:
            if row.candidate_id in allowed_ids:
                merge_query = f"""
                    MERGE `{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections` T
                    USING (
                        SELECT
                            @job_id AS job_id,
                            @candidate_id AS candidate_id,
                            @round AS round,
                            @slot_id AS slot_id,
                            @name AS candidate_name,
                            @email AS candidate_email,
                            @status AS status
                    ) S
                    ON T.job_id = S.job_id AND T.candidate_id = S.candidate_id AND T.round = S.round
                    WHEN MATCHED THEN
                        UPDATE SET
                            status = S.status,
                            confirmed_at = CURRENT_TIMESTAMP()
                    WHEN NOT MATCHED THEN
                        INSERT (slot_id, job_id, candidate_id, candidate_name, candidate_email, round, status, confirmed_at)
                        VALUES (S.slot_id, S.job_id, S.candidate_id, S.candidate_name, S.candidate_email, S.round, S.status, CURRENT_TIMESTAMP())
                """
                merge_config = bigquery.QueryJobConfig(
                    query_parameters=[
                        bigquery.ScalarQueryParameter("job_id", "STRING", row.job_id),
                        bigquery.ScalarQueryParameter("candidate_id", "STRING", row.candidate_id),
                        bigquery.ScalarQueryParameter("round", "STRING", "round1"),
                        bigquery.ScalarQueryParameter("slot_id", "STRING", f"{row.candidate_id}_round1"),
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