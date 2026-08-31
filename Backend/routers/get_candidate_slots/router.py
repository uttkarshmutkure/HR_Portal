"""
save_slots — FastAPI route, mirrors the old `hr-dev-new-get-candidates-slots`
Cloud Function (get_candidate_slots). Offers a candidate 3 available interview
slots, holds them, and persists the offer so reloads return the same slots.
Also supports a "manual" mode for HR to see/pick from all free slots directly.
"""

import json
from datetime import datetime

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from google.cloud import bigquery

import config
from bigquery_client import bq_client

router = APIRouter()

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID

_WEEKDAY_ORDER = {
    "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
    "Friday": 4, "Saturday": 5, "Sunday": 6
}


@router.post("/api/get-candidate-slots")
async def get_candidate_slots(request: Request):
    try:
        request_json = await request.json()
    except Exception:
        request_json = None

    if not request_json:
        return JSONResponse({"error": "Invalid JSON payload"}, status_code=400)

    job_id          = request_json.get("jobId")
    candidate_id    = request_json.get("candidateId")
    interview_round = request_json.get("round", "round1")
    limit           = int(request_json.get("limit", 3))

    mode = request_json.get("mode", "auto")  # "auto" (default) or "manual"

    if not job_id or not candidate_id:
        return JSONResponse({"error": "Missing jobId or candidateId"}, status_code=400)

    slots_table      = f"{PROJECT_ID}.{DATASET_ID}.interviewer_slots"
    selections_table = f"{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections"

    try:
        # ── Manual mode: release this candidate's previously-held slots back to 'free' ──
        if mode == "manual":
            prev_query = f"""
                SELECT slots_offered
                FROM `{selections_table}`
                WHERE job_id = @job_id
                  AND candidate_id = @candidate_id
                  AND round = @round
                  AND slots_offered IS NOT NULL
                LIMIT 1
            """
            prev_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
                    bigquery.ScalarQueryParameter("candidate_id", "STRING", candidate_id),
                    bigquery.ScalarQueryParameter("round", "STRING", interview_round),
                ]
            )
            prev_rows = list(bq_client.query(prev_query, job_config=prev_config).result())

            if prev_rows and prev_rows[0].slots_offered:
                prev_offered = prev_rows[0].slots_offered
                if isinstance(prev_offered, str):
                    prev_offered = json.loads(prev_offered)

                if prev_offered:
                    release_conditions = []
                    release_params = [
                        bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
                        bigquery.ScalarQueryParameter("round", "STRING", interview_round),
                    ]
                    for i, s in enumerate(prev_offered):
                        release_conditions.append(
                            f"(day = @day_{i} AND start_time = @start_{i} AND end_time = @end_{i})"
                        )
                        release_params.append(bigquery.ScalarQueryParameter(f"day_{i}", "STRING", s.get("day", "")))
                        release_params.append(bigquery.ScalarQueryParameter(f"start_{i}", "STRING", s.get("start_time", "")))
                        release_params.append(bigquery.ScalarQueryParameter(f"end_{i}", "STRING", s.get("end_time", "")))

                    release_query = f"""
                        UPDATE `{slots_table}`
                        SET status = 'free'
                        WHERE job_id = @job_id
                          AND `round` = @round
                          AND status = 'on_hold'
                          AND ({' OR '.join(release_conditions)})
                    """
                    release_config = bigquery.QueryJobConfig(query_parameters=release_params)
                    bq_client.query(release_query, job_config=release_config).result()
                    print(f"[MANUAL MODE] Released {len(prev_offered)} held slot(s) back to free for candidate {candidate_id}")

        if mode != "manual":
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
                return JSONResponse({"success": True, "slots": offered})

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
            return JSONResponse({"success": True, "slots": []})

        slots = [dict(row) for row in rows]

        # ── Exclude today, and reorder week starting from tomorrow ──
        today_name = datetime.now().strftime("%A")  # e.g. "Monday"
        today_idx = _WEEKDAY_ORDER[today_name]

        def days_from_tomorrow(day_name):
            day_idx = _WEEKDAY_ORDER.get(day_name, 7)
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

        # ── Manual mode: HR sees ALL free slots, nothing is held or persisted ──
        if mode == "manual":
            result_slots = [
                {
                    "day": s["day"],
                    "start_time": s["start_time"],
                    "end_time": s["end_time"],
                    "work_mode": s["work_mode"],
                }
                for s in unique_slots
            ]
            return JSONResponse({"success": True, "slots": result_slots})

        top_slots = unique_slots[:limit]

        # ── For round1 only: ensure work-mode diversity in the top 3 ──
        if interview_round == 'round1' and len(top_slots) == limit:
            modes_in_top = {s['work_mode'] for s in top_slots}

            if len(modes_in_top) == 1:
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
            USING (SELECT @job_id AS job_id, @candidate_id AS candidate_id, @round AS round, @slot_id AS slot_id) S
            ON T.job_id = S.job_id AND T.candidate_id = S.candidate_id AND T.round = S.round
            WHEN MATCHED THEN
                UPDATE SET slots_offered = @slots_offered
            WHEN NOT MATCHED THEN
                INSERT (slot_id, candidate_id, job_id, round, slots_offered, status)
                VALUES (S.slot_id, @candidate_id, @job_id, @round, @slots_offered, 'invited')
        """

        upsert_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
                bigquery.ScalarQueryParameter("candidate_id", "STRING", candidate_id),
                bigquery.ScalarQueryParameter("round", "STRING", interview_round),
                bigquery.ScalarQueryParameter("slot_id", "STRING", f"{candidate_id}_{interview_round}"),
                bigquery.ScalarQueryParameter("slots_offered", "JSON", json.dumps(result_slots)),
            ]
        )
        bq_client.query(upsert_query, job_config=upsert_config).result()

        return JSONResponse({"success": True, "slots": result_slots})

    except Exception as e:
        print(f"Error in get_candidate_slots: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)