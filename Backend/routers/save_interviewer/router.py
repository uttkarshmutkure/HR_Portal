"""
save_interviewer — FastAPI route, mirrors the old `hr-dev-save-interviewer`
Cloud Function (save_interviewer_slots). Handles slot parsing, MERGE upsert,
stale-slot cleanup, and auto-grant of interviewer login access — all logic
unchanged.
"""

import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from google.cloud import bigquery

import config
from bigquery_client import bq_client

router = APIRouter()

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID

# ── Slot Format ────────────────────────────────────────────────────────
# Format stored in incoming payload's `interviewer.slots`:
#   "Monday@WFO:09:00-10:00;14:00-15:00,Tuesday@WFH:11:00-12:00"
# ──────────────────────────────────────────────────────────────────────


def parse_day_slots(slots_str: str) -> list[dict]:
    if not slots_str or "|" in slots_str:
        return []

    result = []
    for chunk in slots_str.split(","):
        chunk = chunk.strip()
        if ":" not in chunk:
            continue

        colon_idx = chunk.index(":")
        day_part = chunk[:colon_idx].strip()
        ranges_part = chunk[colon_idx + 1:].strip()

        if "@" in day_part:
            at_idx = day_part.index("@")
            day = day_part[:at_idx].strip()
            work_mode = day_part[at_idx + 1:].strip().upper() or "WFO"
        else:
            day = day_part
            work_mode = "WFO"

        time_ranges = []
        for r in ranges_part.split(";"):
            r = r.strip()
            if "-" in r:
                parts = r.split("-", 1)
                time_ranges.append({"start": parts[0].strip(), "end": parts[1].strip()})

        if day and time_ranges:
            time_ranges.sort(key=lambda tr: tr["start"])
            result.append({"day": day, "work_mode": work_mode, "time_ranges": time_ranges})

    _WEEKDAY_ORDER = {"Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
                       "Friday": 4, "Saturday": 5, "Sunday": 6}
    result.sort(key=lambda d: _WEEKDAY_ORDER.get(d["day"], 7))

    return result


def flatten_slots(slot_details: list[dict]) -> list[dict]:
    """Flatten day-grouped slots into individual slot rows."""
    flat = []
    for d in slot_details:
        for tr in d["time_ranges"]:
            flat.append({
                "day": d["day"],
                "work_mode": d["work_mode"],
                "start_time": tr["start"],
                "end_time": tr["end"],
            })
    return flat


@router.post("/api/save-interviewer")
async def save_interviewer_slots(request: Request):
    try:
        request_json = await request.json()
    except Exception:
        request_json = None

    if not request_json:
        return JSONResponse({"error": "Invalid JSON payload"}, status_code=400)

    job_id = request_json.get("jobId")
    interviewer = request_json.get("interviewer")
    interview_round = request_json.get("round", "round1")

    if not job_id or not interviewer or not interviewer.get("id"):
        return JSONResponse({"error": "Missing required fields"}, status_code=400)

    table_id = f"{PROJECT_ID}.{DATASET_ID}.interviewer_slots"
    interviewer_id = interviewer.get("id")

    try:
        # ── DELETE action: remove all slots for this interviewer/job/round ──
        if request_json.get("action") == "DELETE":
            delete_query = f"""
                DELETE FROM `{table_id}`
                WHERE Interviewer_id = @Interviewer_id
                  AND job_id = @job_id
                  AND `round` = @round
            """
            del_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("Interviewer_id", "STRING", interviewer_id),
                    bigquery.ScalarQueryParameter("job_id",         "STRING", job_id),
                    bigquery.ScalarQueryParameter("round",          "STRING", interview_round),
                ]
            )
            bq_client.query(delete_query, job_config=del_config).result()
            return JSONResponse({"success": True, "message": "Interviewer deleted successfully"})

        # ── DELETE_SLOT action: remove a single slot row ──
        if request_json.get("action") == "DELETE_SLOT":
            slot = request_json.get("slot", {})
            if not all([slot.get("day"), slot.get("start_time"), slot.get("end_time")]):
                return JSONResponse({"error": "Missing slot day/start_time/end_time"}, status_code=400)

            del_slot_query = f"""
                DELETE FROM `{table_id}`
                WHERE Interviewer_id = @Interviewer_id
                  AND job_id = @job_id
                  AND `round` = @round
                  AND day = @day
                  AND start_time = @start_time
                  AND end_time = @end_time
            """
            del_slot_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("Interviewer_id", "STRING", interviewer_id),
                    bigquery.ScalarQueryParameter("job_id",         "STRING", job_id),
                    bigquery.ScalarQueryParameter("round",          "STRING", interview_round),
                    bigquery.ScalarQueryParameter("day",            "STRING", slot["day"]),
                    bigquery.ScalarQueryParameter("start_time",     "STRING", slot["start_time"]),
                    bigquery.ScalarQueryParameter("end_time",       "STRING", slot["end_time"]),
                ]
            )
            bq_client.query(del_slot_query, job_config=del_slot_config).result()
            return JSONResponse({"success": True, "message": "Slot removed successfully"})

        raw_slots = interviewer.get("slots", "")
        slot_details = parse_day_slots(raw_slots)
        flat_slots = flatten_slots(slot_details)

        if not flat_slots:
            return JSONResponse({"error": "No valid slots provided"}, status_code=400)

        # ── Build a STRUCT array for the new slot set ──
        new_rows_struct = []
        for s in flat_slots:
            new_rows_struct.append(
                bigquery.StructQueryParameter(
                    None,
                    bigquery.ScalarQueryParameter("slot_id", "STRING", str(uuid.uuid4())),
                    bigquery.ScalarQueryParameter("day", "STRING", s["day"]),
                    bigquery.ScalarQueryParameter("start_time", "STRING", s["start_time"]),
                    bigquery.ScalarQueryParameter("end_time", "STRING", s["end_time"]),
                    bigquery.ScalarQueryParameter("work_mode", "STRING", s["work_mode"]),
                )
            )

        query = f"""
            MERGE `{table_id}` T
            USING UNNEST(@new_slots) AS S
            ON  T.Interviewer_id = @Interviewer_id
            AND T.job_id         = @job_id
            AND T.`round`        = @round
            AND T.day            = S.day
            AND T.start_time     = S.start_time
            AND T.end_time       = S.end_time
            WHEN MATCHED THEN
                UPDATE SET
                    Interviewer_name  = @Interviewer_name,
                    Interviewer_email = @Interviewer_email,
                    role              = @role,
                    work_mode         = S.work_mode
                    -- NOTE: status intentionally NOT overwritten here so an
                    -- already-booked slot stays booked on resubmission.
            WHEN NOT MATCHED THEN
                INSERT (
                    slot_id, Interviewer_id, job_id,
                    Interviewer_name, Interviewer_email, role, `round`,
                    day, start_time, end_time, work_mode, status, created_at
                )
                VALUES (
                    S.slot_id, @Interviewer_id, @job_id,
                    @Interviewer_name, @Interviewer_email, @role, @round,
                    S.day, S.start_time, S.end_time, S.work_mode, 'free', CURRENT_TIMESTAMP()
                )
        """

        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("Interviewer_id",    "STRING", interviewer_id),
                bigquery.ScalarQueryParameter("job_id",            "STRING", job_id),
                bigquery.ScalarQueryParameter("round",             "STRING", interview_round),
                bigquery.ScalarQueryParameter("Interviewer_name",  "STRING", interviewer.get("name")),
                bigquery.ScalarQueryParameter("Interviewer_email", "STRING", interviewer.get("email")),
                bigquery.ScalarQueryParameter("role", "STRING", interviewer.get("role")),
                bigquery.ArrayQueryParameter("new_slots", "STRUCT", new_rows_struct),
            ]
        )

        query_job = bq_client.query(query, job_config=job_config)
        query_job.result()

        # ── DELETE stale slots ──
        keep_keys = [f"{s['day']}|{s['start_time']}|{s['end_time']}" for s in flat_slots]

        cleanup_query = f"""
            DELETE FROM `{table_id}`
            WHERE Interviewer_id = @Interviewer_id
              AND job_id = @job_id
              AND `round` = @round
              AND status = 'free'
              AND CONCAT(day, '|', start_time, '|', end_time) NOT IN UNNEST(@keep_keys)
        """
        cleanup_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("Interviewer_id", "STRING", interviewer_id),
                bigquery.ScalarQueryParameter("job_id",         "STRING", job_id),
                bigquery.ScalarQueryParameter("round",          "STRING", interview_round),
                bigquery.ArrayQueryParameter("keep_keys",       "STRING", keep_keys),
            ]
        )
        bq_client.query(cleanup_query, job_config=cleanup_config).result()

        # ── Auto-grant login access for this interviewer ───────────────
        users_table_id = f"{PROJECT_ID}.{DATASET_ID}.users"

        grant_query = f"""
            MERGE `{users_table_id}` T
            USING (SELECT @email AS email) S
            ON T.email = S.email
            WHEN MATCHED AND NOT CONTAINS_SUBSTR(T.roles, 'interviewer') THEN
                UPDATE SET roles = CONCAT(T.roles, ',interviewer')
            WHEN NOT MATCHED THEN
                INSERT (user_id, email, name, roles, status, source, granted_by, created_at)
                VALUES (
                    @user_id, @email, @name, 'interviewer', 'active',
                    'auto_via_assignment', 'system', CURRENT_TIMESTAMP()
                )
        """
        grant_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("user_id", "STRING", str(uuid.uuid4())),
                bigquery.ScalarQueryParameter("email",   "STRING", interviewer.get("email")),
                bigquery.ScalarQueryParameter("name",    "STRING", interviewer.get("name")),
            ]
        )
        bq_client.query(grant_query, job_config=grant_config).result()

        return JSONResponse({
            "success": True,
            "message": "Interviewer slots saved successfully",
            "slot_count": len(flat_slots),
        })

    except Exception as e:
        print(f"Error saving interviewer: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)