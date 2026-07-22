import os
import json
from datetime import datetime, timezone

from google.cloud import bigquery
import functions_framework
import requests

bq_client = bigquery.Client()

# ── Day-name lookup ────────────────────────────────────────────────────────────
# Python's datetime.weekday(): 0=Monday … 6=Sunday
_WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def slot_date_to_day_name(slot_date: str) -> str:
    """
    Convert a 'YYYY-MM-DD' string to its full day-of-week name, e.g. 'Monday'.
    Falls back to empty string on any parse error.
    """
    try:
        dt = datetime.strptime(slot_date, "%Y-%m-%d")
        return _WEEKDAY_NAMES[dt.weekday()]
    except Exception:
        return ""


def build_day_slot_string(slots: list[dict]) -> str:
    """
    Collapse a list of {slot_date, slot_start_time, slot_end_time} dicts
    into the same compact day-wise format used by interviewers:

        "Monday:10:00-11:00;14:00-15:00,Wednesday:10:00-10:30"

    Multiple preferences on the same day are merged under one day key.
    The order of preferences is preserved within each day group.
    """
    # Group time-ranges by day name, preserving order
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
        if range_str not in day_map[day]:          # avoid duplicates
            day_map[day].append(range_str)

    parts = [f"{day}:{';'.join(day_map[day])}" for day in day_order]
    return ",".join(parts)


def build_slot_details_json(slots: list[dict]) -> str:
    """
    Build the structured JSON representation (same schema as interviewers):

        [
          {"day": "Monday",    "time_ranges": [{"start": "10:00", "end": "11:00"}]},
          {"day": "Wednesday", "time_ranges": [{"start": "10:00", "end": "10:30"}]}
        ]

    Also enriches each time_range with the original calendar date so the
    matchmaker can use a concrete date for calendar-invite creation.
    """
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


@functions_framework.http
def save_candidate_slots(request):

    # ── CORS Preflight ─────────────────────────────────────────────────────────
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin':  '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age':       '3600'
        }
        return ('', 204, headers)

    headers = {'Access-Control-Allow-Origin': '*'}

    if request.method != 'POST':
        return ({'error': 'Method not allowed'}, 405, headers)

    try:
        request_json = request.get_json(silent=True)
        if not request_json:
            return ({'error': 'Invalid JSON payload'}, 400, headers)

        job_id          = request_json.get('jobId')
        candidate_id    = request_json.get('candidateId')
        interview_round = request_json.get('round')
        selected_slots  = request_json.get('selectedSlots', [])

        if not job_id or not candidate_id or not interview_round:
            return ({'error': 'Missing required fields'}, 400, headers)

        if not isinstance(selected_slots, list) or len(selected_slots) == 0:
            return ({'error': 'selectedSlots must be a non-empty array'}, 400, headers)

        project_id = os.environ.get('GOOGLE_CLOUD_PROJECT', 'atgeir-moae-dev')
        dataset_id = os.environ.get('BQ_DATASET_ID', 'hr_dataset')
        table_id   = f"{project_id}.{dataset_id}.candidate_slot_selections"

        current_time = datetime.now(timezone.utc)
        email_sent_at = request_json.get('emailSentAt') or None

        # ── Build day-wise representations ────────────────────────────────────
        # `available_slots`   → compact string  "Monday:10:00-11:00,Wednesday:10:00-10:30"
        # `slot_details_json` → structured JSON  [{day, time_ranges:[{start,end,date}]}]
        available_slots   = build_day_slot_string(selected_slots)
        slot_details_json = build_slot_details_json(selected_slots)

        # Keep first-preference fields for legacy / email display columns
        first_slot      = selected_slots[0]
        slot_date       = first_slot.get("slot_date", "")
        slot_start_time = first_slot.get("slot_start_time", "")
        slot_end_time   = first_slot.get("slot_end_time",   "")

        # ── Upsert: UPDATE if row exists, INSERT otherwise ─────────────────────
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
                # ── UPDATE ─────────────────────────────────────────────────────
                update_query = f"""
                    UPDATE `{table_id}`
                    SET
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
                # ── INSERT ─────────────────────────────────────────────────────
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
                    bigquery.ScalarQueryParameter("slot_id",           "STRING",    candidate_id),
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
            return ({'error': 'Failed to save to database', 'details': str(db_err)}, 500, headers)

        # ── Trigger Matchmaker ─────────────────────────────────────────────────
        matchmaker_url = os.environ.get(
            'MATCHMAKER_URL',
            'https://asia-south1-atgeir-moae-dev.cloudfunctions.net/hr-dev-matchmaker'
        )

        trigger_payload = {
            "jobId":       job_id,
            "candidateId": candidate_id,
            "round":       interview_round
        }

        try:
            match_res  = requests.post(matchmaker_url, json=trigger_payload, timeout=25)
            match_data = match_res.json()

            if match_res.status_code == 200 and match_data.get('success'):
                return ({'success': True, 'message': f'Slots saved & matched for {interview_round}!'}, 200, headers)
            else:
                print(f"Matchmaker returned non-success: {match_res.text}")
                return ({
                    'success':      True,
                    'matchSuccess': False,
                    'message':      'Slots saved, but no interviewer match found. HR will assign manually.'
                }, 200, headers)

        except requests.exceptions.Timeout:
            print("Matchmaker timed out")
            return ({
                'success':      True,
                'matchSuccess': False,
                'message':      'Slots saved, but matching timed out. HR will be notified.'
            }, 200, headers)

        except Exception as req_e:
            print(f"Matchmaker request error: {req_e}")
            return ({
                'success':      True,
                'matchSuccess': False,
                'message':      f'Slots saved, but matching error: {str(req_e)}'
            }, 200, headers)

    except Exception as e:
        print(f"Error in save_candidate_slots: {e}")
        return ({'error': str(e)}, 500, headers)