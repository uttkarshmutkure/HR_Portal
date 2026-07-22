import os
import uuid
import json
from google.cloud import bigquery
import functions_framework

bq_client = bigquery.Client()

# ── Slot Format ────────────────────────────────────────────────────────
# Format stored in `available_slots`:
#   "Monday@WFO:09:00-10:00;14:00-15:00,Tuesday@WFH:11:00-12:00"
#
# Each comma-separated chunk:  <DayName>[@WorkMode]:<start>-<end>[;<start>-<end>...]
#
# The @WorkMode segment is optional for backwards-compat (old rows without it
# default to WFO in the parsed output).  Legacy pipe-based rows are left
# untouched by the MERGE — only rows whose (Interviewer_id, job_id, round)
# key matches will be overwritten.
# ──────────────────────────────────────────────────────────────────────


def parse_day_slots(slots_str: str) -> list[dict]:
    """
    Parse the day-wise slot string into a list of dicts:
      [
        {
          "day": "Monday",
          "work_mode": "WFO",           # NEW: per-day work mode
          "time_ranges": [{"start": "09:00", "end": "10:00"}, ...]
        },
        ...
      ]

    Supports both old format (no @WorkMode) and new format (with @WorkMode).
    Falls back to an empty list for legacy pipe-based formats.
    """
    if not slots_str or "|" in slots_str:
        # Legacy format — nothing to parse
        return []

    result = []
    for chunk in slots_str.split(","):
        chunk = chunk.strip()
        if ":" not in chunk:
            continue

        colon_idx = chunk.index(":")
        day_part = chunk[:colon_idx].strip()   # e.g. "Monday" or "Monday@WFH"
        ranges_part = chunk[colon_idx + 1:].strip()

        # Split day name and optional work mode
        if "@" in day_part:
            at_idx = day_part.index("@")
            day = day_part[:at_idx].strip()
            work_mode = day_part[at_idx + 1:].strip().upper() or "WFO"
        else:
            day = day_part
            work_mode = "WFO"   # default for rows saved before per-day mode was introduced

        time_ranges = []
        for r in ranges_part.split(";"):
            r = r.strip()
            if "-" in r:
                parts = r.split("-", 1)
                time_ranges.append({"start": parts[0].strip(), "end": parts[1].strip()})

        if day and time_ranges:
            result.append({"day": day, "work_mode": work_mode, "time_ranges": time_ranges})

    return result


@functions_framework.http
def save_interviewer_slots(request):
    # 1. Handle CORS Preflight
    if request.method == "OPTIONS":
        headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "3600",
        }
        return ("", 204, headers)

    headers = {"Access-Control-Allow-Origin": "*"}

    if request.method != "POST":
        return ({"error": "Method not allowed"}, 405, headers)

    try:
        # 2. Parse payload
        request_json = request.get_json(silent=True)
        if not request_json:
            return ({"error": "Invalid JSON payload"}, 400, headers)

        job_id = request_json.get("jobId")
        interviewer = request_json.get("interviewer")  # id, name, email, role, slots, work_mode
        interview_round = request_json.get("round", "round1")

        if not job_id or not interviewer or not interviewer.get("id"):
            return ({"error": "Missing required fields"}, 400, headers)

        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
        dataset_id = os.environ.get("BQ_DATASET_ID", "hr_dataset")
        table_id = f"{project_id}.{dataset_id}.interviewer_slots"

        if request_json.get("action") == "DELETE":
            delete_query = f"""
                DELETE FROM `{table_id}`
                WHERE Interviewer_id = @Interviewer_id
                  AND job_id = @job_id
                  AND `round` = @round
            """
            del_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("Interviewer_id", "STRING", interviewer.get("id")),
                    bigquery.ScalarQueryParameter("job_id",         "STRING", job_id),
                    bigquery.ScalarQueryParameter("round",          "STRING", interview_round),
                ]
            )
            bq_client.query(delete_query, job_config=del_config).result()
            return ({"success": True, "message": "Interviewer deleted successfully"}, 200, headers)

        raw_slots = interviewer.get("slots", "")

        # ── Parse new day-wise format (with per-day work_mode) ─────────
        # `available_slots` — raw serialized string (compact, easy to round-trip).
        # `slot_details_json` — exploded JSON including per-day work_mode, so
        #   downstream consumers don't need to re-parse the custom string format.
        slot_details = parse_day_slots(raw_slots)
        slot_details_json = json.dumps(slot_details)   # stored as STRING in BQ

        # Derive top-level work_mode for the BQ column (backward compat):
        #   single mode across all days  → that mode ("WFO" or "WFH")
        #   mixed modes                  → "MIXED"
        #   no days (empty)              → fall back to payload's work_mode field
        day_modes = list({d["work_mode"] for d in slot_details})
        if len(day_modes) == 1:
            top_level_work_mode = day_modes[0]
        elif len(day_modes) > 1:
            top_level_work_mode = "MIXED"
        else:
            top_level_work_mode = interviewer.get("work_mode", "WFO")

        # 3. MERGE (Upsert) — key: (Interviewer_id, job_id, round)
        query = f"""
            MERGE `{table_id}` T
            USING (
                SELECT
                    @slot_id            AS slot_id,
                    @Interviewer_id     AS Interviewer_id,
                    @job_id             AS job_id,
                    @Interviewer_name   AS Interviewer_name,
                    @Interviewer_email  AS Interviewer_email,
                    @round              AS `round`,
                    @available_slots    AS available_slots,
                    @slot_details_json  AS slot_details_json,
                    @status             AS status,
                    @work_mode          AS work_mode
            ) S
            ON  T.Interviewer_id = S.Interviewer_id
            AND T.job_id         = S.job_id
            AND T.`round`        = S.`round`
            WHEN MATCHED THEN
                UPDATE SET
                    Interviewer_name  = S.Interviewer_name,
                    Interviewer_email = S.Interviewer_email,
                    available_slots   = S.available_slots,
                    slot_details_json = S.slot_details_json,
                    status            = S.status,
                    work_mode         = S.work_mode
            WHEN NOT MATCHED THEN
                INSERT (
                    slot_id, Interviewer_id, job_id,
                    Interviewer_name, Interviewer_email, `round`,
                    available_slots, slot_details_json, status, work_mode
                )
                VALUES (
                    S.slot_id, S.Interviewer_id, S.job_id,
                    S.Interviewer_name, S.Interviewer_email, S.`round`,
                    S.available_slots, S.slot_details_json, S.status, S.work_mode
                )
        """

        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("slot_id",           "STRING", str(uuid.uuid4())),
                bigquery.ScalarQueryParameter("Interviewer_id",    "STRING", interviewer.get("id")),
                bigquery.ScalarQueryParameter("job_id",            "STRING", job_id),
                bigquery.ScalarQueryParameter("Interviewer_name",  "STRING", interviewer.get("name")),
                bigquery.ScalarQueryParameter("Interviewer_email", "STRING", interviewer.get("email")),
                bigquery.ScalarQueryParameter("round",             "STRING", interview_round),
                bigquery.ScalarQueryParameter("available_slots",   "STRING", raw_slots),
                bigquery.ScalarQueryParameter("slot_details_json", "STRING", slot_details_json),
                bigquery.ScalarQueryParameter("status",            "STRING", "free"),
                bigquery.ScalarQueryParameter("work_mode",         "STRING", top_level_work_mode),
            ]
        )

        query_job = bq_client.query(query, job_config=job_config)
        query_job.result()  # Wait for completion

        return (
            {
                "success": True,
                "message": "Interviewer slots saved successfully",
                "slot_count": sum(len(d["time_ranges"]) for d in slot_details),
            },
            200,
            headers,
        )

    except Exception as e:
        print(f"Error saving interviewer: {e}")
        return ({"error": str(e)}, 500, headers)