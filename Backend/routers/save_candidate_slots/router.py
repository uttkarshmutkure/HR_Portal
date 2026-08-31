"""
save_candidate_slots — FastAPI route, mirrors the old
`hr-dev-new-get-candidates-slots` Cloud Function... actually mirrors
`save_candidate_slots`: candidate confirms their chosen interview slot(s),
this upserts the row into candidate_slot_selections and triggers the
matchmaker CF via HTTP.
"""

import json
from datetime import datetime, timezone

import requests
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from google.cloud import bigquery

import config
from bigquery_client import bq_client

router = APIRouter()

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID
MATCHMAKER_URL = config.MATCHMAKER_URL

_WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def slot_date_to_day_name(slot_date: str) -> str:
    try:
        dt = datetime.strptime(slot_date, "%Y-%m-%d")
        return _WEEKDAY_NAMES[dt.weekday()]
    except Exception:
        return ""


def build_day_slot_string(slots: list[dict]) -> str:
    day_map: dict[str, list[str]] = {}
    day_order: list[str] = []

    for s in slots:
        day = slot_date_to_day_name(s.get("slot_date", ""))
        if not day:
            continue
        start = s.get("slot_start_time", "")
        end   = s.get("slot_end_time",   "")
        if not start or not end:
            continue
        if day not in day_map:
            day_map[day] = []
            day_order.append(day)
        range_str = f"{start}-{end}"
        if range_str not in day_map[day]:
            day_map[day].append(range_str)

    parts = [f"{day}:{';'.join(day_map[day])}" for day in day_order]
    return ",".join(parts)


def build_slot_details_json(slots: list[dict]) -> str:
    day_map: dict[str, list[dict]] = {}
    day_order: list[str] = []

    for s in slots:
        day   = slot_date_to_day_name(s.get("slot_date", ""))
        start = s.get("slot_start_time", "")
        end   = s.get("slot_end_time",   "")
        date  = s.get("slot_date", "")
        if not day or not start or not end:
            continue
        if day not in day_map:
            day_map[day] = []
            day_order.append(day)
        entry = {"start": start, "end": end, "date": date}
        if entry not in day_map[day]:
            day_map[day].append(entry)

    result = [{"day": day, "time_ranges": day_map[day]} for day in day_order]
    return json.dumps(result)


@router.post("/api/save-candidate-slots")
async def save_candidate_slots(request: Request):
    try:
        request_json = await request.json()
    except Exception:
        request_json = None

    if not request_json:
        return JSONResponse({'error': 'Invalid JSON payload'}, status_code=400)

    job_id          = request_json.get('jobId')
    candidate_id    = request_json.get('candidateId')
    interview_round = request_json.get('round')
    selected_slots  = request_json.get('selectedSlots', [])

    if not job_id or not candidate_id or not interview_round:
        return JSONResponse({'error': 'Missing required fields'}, status_code=400)

    if not isinstance(selected_slots, list) or len(selected_slots) == 0:
        return JSONResponse({'error': 'selectedSlots must be a non-empty array'}, status_code=400)

    table_id = f"{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections"

    try:
        current_time = datetime.now(timezone.utc)
        email_sent_at = request_json.get('emailSentAt') or None

        available_slots   = build_day_slot_string(selected_slots)
        slot_details_json = build_slot_details_json(selected_slots)

        first_slot      = selected_slots[0]
        slot_date       = first_slot.get("slot_date", "")
        slot_start_time = first_slot.get("slot_start_time", "")
        slot_end_time   = first_slot.get("slot_end_time",   "")

        check_query = f"""
            SELECT slot_id
            FROM `{table_id}`
            WHERE job_id      = @job_id
              AND candidate_id = @candidate_id
              AND round        = @round
            ORDER BY confirmed_at DESC
            LIMIT 1
        """
        check_cfg = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("job_id",       "STRING", job_id),
            bigquery.ScalarQueryParameter("candidate_id", "STRING", candidate_id),
            bigquery.ScalarQueryParameter("round",        "STRING", interview_round),
        ])

        existing_rows    = list(bq_client.query(check_query, job_config=check_cfg))
        existing_slot_id = existing_rows[0].slot_id if existing_rows else None

        try:
            if existing_slot_id:
                update_query = f"""
                    UPDATE `{table_id}`
                    SET
                        candidate_name    = @candidate_name,
                        candidate_email   = @candidate_email,
                        slot_selected     = @slot_selected,
                        available_slots   = @available_slots,
                        slot_details_json = @slot_details_json,
                        slot_date         = @slot_date,
                        slot_start_time   = @slot_start_time,
                        slot_end_time     = @slot_end_time,
                        status            = 'confirmed',
                        confirmed_at      = @confirmed_at
                    WHERE slot_id = @slot_id
                """
                update_cfg = bigquery.QueryJobConfig(query_parameters=[
                    bigquery.ScalarQueryParameter("candidate_name",    "STRING",    request_json.get('candidateName', '')),
                    bigquery.ScalarQueryParameter("candidate_email",   "STRING",    request_json.get('candidateEmail', '')),
                    bigquery.ScalarQueryParameter("slot_selected",     "STRING",    json.dumps(selected_slots)),
                    bigquery.ScalarQueryParameter("available_slots",   "STRING",    available_slots),
                    bigquery.ScalarQueryParameter("slot_details_json", "STRING",    slot_details_json),
                    bigquery.ScalarQueryParameter("slot_date",         "STRING",    slot_date),
                    bigquery.ScalarQueryParameter("slot_start_time",   "STRING",    slot_start_time),
                    bigquery.ScalarQueryParameter("slot_end_time",     "STRING",    slot_end_time),
                    bigquery.ScalarQueryParameter("confirmed_at",      "TIMESTAMP", current_time),
                    bigquery.ScalarQueryParameter("slot_id",           "STRING",    existing_slot_id),
                ])
                bq_client.query(update_query, job_config=update_cfg).result()
                print(f"[CANDIDATE SLOTS] Updated row {existing_slot_id} → {available_slots}")

            else:
                insert_query = f"""
                    INSERT INTO `{table_id}`
                    (
                        slot_id, candidate_id, job_id,
                        candidate_name, candidate_email,
                        round, slots_offered, slot_selected,
                        available_slots, slot_details_json,
                        slot_date, slot_start_time, slot_end_time,
                        status, email_sent_at, confirmed_at
                    )
                    VALUES (
                        @slot_id, @candidate_id, @job_id,
                        @candidate_name, @candidate_email,
                        @round, NULL, @slot_selected,
                        @available_slots, @slot_details_json,
                        @slot_date, @slot_start_time, @slot_end_time,
                        @status, @email_sent_at, @confirmed_at
                    )
                """

                insert_cfg = bigquery.QueryJobConfig(query_parameters=[
                    bigquery.ScalarQueryParameter("slot_id",           "STRING",    f"{candidate_id}_{interview_round}"),
                    bigquery.ScalarQueryParameter("candidate_id",      "STRING",    candidate_id),
                    bigquery.ScalarQueryParameter("job_id",            "STRING",    job_id),
                    bigquery.ScalarQueryParameter("candidate_name",    "STRING",    request_json.get('candidateName', '')),
                    bigquery.ScalarQueryParameter("candidate_email",   "STRING",    request_json.get('candidateEmail', '')),
                    bigquery.ScalarQueryParameter("round",             "STRING",    interview_round),
                    bigquery.ScalarQueryParameter("slot_selected",     "STRING",    json.dumps(selected_slots)),
                    bigquery.ScalarQueryParameter("available_slots",   "STRING",    available_slots),
                    bigquery.ScalarQueryParameter("slot_details_json", "STRING",    slot_details_json),
                    bigquery.ScalarQueryParameter("slot_date",         "STRING",    slot_date),
                    bigquery.ScalarQueryParameter("slot_start_time",   "STRING",    slot_start_time),
                    bigquery.ScalarQueryParameter("slot_end_time",     "STRING",    slot_end_time),
                    bigquery.ScalarQueryParameter("status",            "STRING",    "confirmed"),
                    bigquery.ScalarQueryParameter("email_sent_at",     "TIMESTAMP", email_sent_at),
                    bigquery.ScalarQueryParameter("confirmed_at",      "TIMESTAMP", current_time),
                ])
                bq_client.query(insert_query, job_config=insert_cfg).result()
                print(f"[CANDIDATE SLOTS] Inserted new row for candidate {candidate_id} → {available_slots}")

        except Exception as db_err:
            print(f"DB write error: {db_err}")
            return JSONResponse({'error': 'Failed to save to database', 'details': str(db_err)}, status_code=500)

        # ── Trigger Matchmaker ─────────────────────────────────────────────────
        trigger_payload = {
            "jobId":       job_id,
            "candidateId": candidate_id,
            "round":       interview_round
        }

        try:
            match_res  = requests.post(MATCHMAKER_URL, json=trigger_payload, timeout=110)
            match_data = match_res.json()

            if match_res.status_code == 200 and match_data.get('success'):
                return JSONResponse({'success': True, 'message': f'Slots saved & matched for {interview_round}!'})
            else:
                print(f"Matchmaker returned non-success: {match_res.text}")
                return JSONResponse({
                    'success':      True,
                    'matchSuccess': False,
                    'message':      'Slots saved, but no interviewer match found. HR will assign manually.'
                })

        except requests.exceptions.Timeout:
            print("Matchmaker timed out")
            return JSONResponse({
                'success':      True,
                'matchSuccess': False,
                'message':      'Slots saved, but matching timed out. HR will be notified.'
            })

        except Exception as req_e:
            print(f"Matchmaker request error: {req_e}")
            return JSONResponse({
                'success':      True,
                'matchSuccess': False,
                'message':      f'Slots saved, but matching error: {str(req_e)}'
            })

    except Exception as e:
        print(f"Error in save_candidate_slots: {e}")
        return JSONResponse({'error': str(e)}, status_code=500)