import os
import json
from google.cloud import bigquery
import functions_framework
from datetime import datetime, timedelta

bq_client = bigquery.Client()

_WEEKDAY_ORDER = {
    "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
    "Friday": 4, "Saturday": 5, "Sunday": 6
}


@functions_framework.http
def get_candidate_slots(request):
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

        job_id          = request_json.get("jobId")
        candidate_id    = request_json.get("candidateId")
        interview_round = request_json.get("round", "round1")
        limit           = int(request_json.get("limit", 3))

        if not job_id or not candidate_id:
            return ({"error": "Missing jobId or candidateId"}, 400, headers)

        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
        dataset_id = os.environ.get("BQ_DATASET_ID", "hr_dataset")
        slots_table      = f"{project_id}.{dataset_id}.interviewer_slots"
        selections_table = f"{project_id}.{dataset_id}.candidate_slot_selections"

        # ── STEP 1: Check if slots were already offered to this candidate ──
        check_query = f"""
            SELECT slots_offered
            FROM `{selections_table}`
            WHERE job_id = @job_id
              AND candidate_id = @candidate_id
              AND round = @round
              AND slots_offered IS NOT NULL
            LIMIT 1
        """
        check_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
                bigquery.ScalarQueryParameter("candidate_id", "STRING", candidate_id),
                bigquery.ScalarQueryParameter("round", "STRING", interview_round),
            ]
        )
        existing = list(bq_client.query(check_query, job_config=check_config).result())

        if existing and existing[0].slots_offered:
            offered = existing[0].slots_offered
            if isinstance(offered, str):
                offered = json.loads(offered)
            return (
                {"success": True, "slots": offered},
                200,
                headers,
            )
        # ── STEP 2: First time — fetch fresh free slots ──
        query = f"""
            SELECT
                slot_id, Interviewer_id, Interviewer_name,
                day, start_time, end_time, work_mode
            FROM `{slots_table}`
            WHERE job_id = @job_id
              AND `round` = @round
              AND status = 'free'
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
                bigquery.ScalarQueryParameter("round",  "STRING", interview_round),
            ]
        )

        rows = list(bq_client.query(query, job_config=job_config).result())

        if not rows:
            return ({"success": True, "slots": []}, 200, headers)

        slots = [dict(row) for row in rows]

        # ── Exclude today, and reorder week starting from tomorrow ──
        today_name = datetime.now().strftime("%A")  # e.g. "Monday"
        today_idx = _WEEKDAY_ORDER[today_name]

        def days_from_tomorrow(day_name):
            day_idx = _WEEKDAY_ORDER.get(day_name, 7)
            # distance forward from today (1 = tomorrow, ..., 6 = today+6)
            return (day_idx - today_idx - 1) % 7

        slots = [s for s in slots if s["day"] != today_name]
        slots.sort(key=lambda s: (days_from_tomorrow(s["day"]), s["start_time"]))

        seen = set()
        unique_slots = []
        for s in slots:
            key = (s["day"], s["start_time"], s["end_time"])
            if key not in seen:
                seen.add(key)
                unique_slots.append(s)

        top_slots = unique_slots[:limit]

        # ── For round1 only: ensure work-mode diversity in the top 3 ──
        if interview_round == 'round1' and len(top_slots) == limit:
            modes_in_top = {s['work_mode'] for s in top_slots}

            if len(modes_in_top) == 1:
                # All 3 are the same mode — find the first slot further down
                # the list with a different mode and swap it in for the last slot
                only_mode = next(iter(modes_in_top))
                for candidate_slot in unique_slots[limit:]:
                    if candidate_slot['work_mode'] != only_mode:
                        top_slots[-1] = candidate_slot
                        break
                    
        slot_ids_to_hold = [s["slot_id"] for s in top_slots]

        # ── STEP 3: Put these specific slots ON HOLD so no other candidate gets them ──
        if slot_ids_to_hold:
            hold_query = f"""
                UPDATE `{slots_table}`
                SET status = 'on_hold'
                WHERE slot_id IN UNNEST(@slot_ids)
            """
            hold_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ArrayQueryParameter("slot_ids", "STRING", slot_ids_to_hold),
                ]
            )
            bq_client.query(hold_query, job_config=hold_config).result()

        result_slots = [
            {
                "day": s["day"],
                "start_time": s["start_time"],
                "end_time": s["end_time"],
                "work_mode": s["work_mode"],
            }
            for s in top_slots
        ]

        # ── STEP 4: Persist the offer so future page loads reuse the SAME slots ──
        upsert_query = f"""
            MERGE `{selections_table}` T
            USING (SELECT @job_id AS job_id, @candidate_id AS candidate_id, @round AS round) S
            ON T.job_id = S.job_id AND T.candidate_id = S.candidate_id AND T.round = S.round
            WHEN MATCHED THEN
                UPDATE SET slots_offered = @slots_offered
            WHEN NOT MATCHED THEN
                INSERT (slot_id, candidate_id, job_id, round, slots_offered, status)
                VALUES (@candidate_id, @candidate_id, @job_id, @round, @slots_offered, 'offered')
        """
        upsert_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
                bigquery.ScalarQueryParameter("candidate_id", "STRING", candidate_id),
                bigquery.ScalarQueryParameter("round", "STRING", interview_round),
                bigquery.ScalarQueryParameter("slots_offered", "JSON", json.dumps(result_slots)),
            ]
        )
        bq_client.query(upsert_query, job_config=upsert_config).result()

        return ({"success": True, "slots": result_slots}, 200, headers)

    except Exception as e:
        print(f"Error in get_candidate_slots: {e}")
        return ({"error": str(e)}, 500, headers)