import os
import uuid
import json
from google.cloud import bigquery
import functions_framework

bq_client = bigquery.Client()

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


@functions_framework.http
def save_interviewer_slots(request):
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
        request_json = request.get_json(silent=True)
        if not request_json:
            return ({"error": "Invalid JSON payload"}, 400, headers)

        job_id = request_json.get("jobId")
        interviewer = request_json.get("interviewer")
        interview_round = request_json.get("round", "round1")

        if not job_id or not interviewer or not interviewer.get("id"):
            return ({"error": "Missing required fields"}, 400, headers)

        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
        dataset_id = os.environ.get("BQ_DATASET_ID", "hr_dataset")
        table_id = f"{project_id}.{dataset_id}.interviewer_slots"

        interviewer_id = interviewer.get("id")

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
            return ({"success": True, "message": "Interviewer deleted successfully"}, 200, headers)

        raw_slots = interviewer.get("slots", "")
        slot_details = parse_day_slots(raw_slots)
        flat_slots = flatten_slots(slot_details)

        if not flat_slots:
            return ({"error": "No valid slots provided"}, 400, headers)

        # ── Build a STRUCT array for the new slot set ──
        # This becomes the source table in MERGE, matched against existing
        # rows on (Interviewer_id, job_id, round, day, start_time, end_time).
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
                    work_mode         = S.work_mode
                    -- NOTE: status intentionally NOT overwritten here so an
                    -- already-booked slot stays booked on resubmission.
            WHEN NOT MATCHED THEN
                INSERT (
                    slot_id, Interviewer_id, job_id,
                    Interviewer_name, Interviewer_email, `round`,
                    day, start_time, end_time, work_mode, status, created_at
                )
                VALUES (
                    S.slot_id, @Interviewer_id, @job_id,
                    @Interviewer_name, @Interviewer_email, @round,
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
                bigquery.ArrayQueryParameter("new_slots", "STRUCT", new_rows_struct),
            ]
        )

        query_job = bq_client.query(query, job_config=job_config)
        query_job.result()

        # ── DELETE stale slots: rows that exist in BQ for this
        #    interviewer/job/round but are NOT in the new submitted set,
        #    AND are still "free" (never delete a booked slot silently). ──
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

        return (
            {
                "success": True,
                "message": "Interviewer slots saved successfully",
                "slot_count": len(flat_slots),
            },
            200,
            headers,
        )

    except Exception as e:
        print(f"Error saving interviewer: {e}")
        return ({"error": str(e)}, 500, headers)