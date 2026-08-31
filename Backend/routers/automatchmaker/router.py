"""
automatchmaker — FastAPI route, mirrors the old `hr-dev-automatchmaker`
Cloud Function (auto_matchmaker). Matches a candidate's preferred slots
against free interviewer slots via Gemini, books the match, creates a Meet
link, and emails both parties.
"""

import json
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor

import requests
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from google.cloud import bigquery
from google.genai import types

import config
from bigquery_client import bq_client
from genai_client import genai_client_global
from routers.automatchmaker.calendar_tool import create_meet_link
from routers.automatchmaker.db_tool import book_interview_in_db
from routers.automatchmaker.feedback_tool import generate_feedback_link, generate_candidate_review_link

router = APIRouter()

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID
EMAIL_API_URL = config.EMAIL_API_URL
TEST_EMAIL = config.TEST_EMAIL

ROUND_DURATIONS = {'round1': 30, 'technical': 60, 'hr': 30}
ROUND_LABELS = {'round1': 'Round 1', 'technical': 'Technical Round', 'hr': 'HR Round'}

SUPPORT_FOOTER = """
    <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;">
        For any queries, contact us at 
        <a href="mailto:support@atgeirsolutions.com" style="color:#F07C2D;text-decoration:none;font-weight:500;">support@atgeirsolutions.com</a> 
        or call <span style="font-weight:500;color:#6B7280;">+91 020-41292883</span>
    </p>
"""

CANDIDATE_EMAIL_TEMPLATE = """
<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
  <div style="background:#F07C2D;padding:24px 28px;">
    <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.02em;">Atgeir Solutions</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">Hiring Team</div>
  </div>
  <div style="padding:28px;">
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear <strong>{candidate_name}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
      Your interview for the <strong>{job_title}</strong> position has been successfully scheduled.
    </p>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">Interview Details</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;width:110px;">Round</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{round}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;">Date</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{date}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;">Time</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{time}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;">Interviewer</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{interviewer_name}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;">Mode</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{mode}</td></tr>
      </table>
    </div>
    <a href="{meet_link}" style="display:inline-block;background:#F07C2D;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:20px;">Join Google Meet</a>
    <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">Please join the meeting on time. If you have any questions, feel free to reach out.</p>
    <p style="margin:16px 0 0;font-size:13px;color:#374151;">Best regards,<br><strong>Atgeir Solutions Hiring Team</strong></p>
  </div>
  {support_footer}
</div>
"""

INTERVIEWER_EMAIL_TEMPLATE = """
<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
  <div style="background:#111827;padding:24px 28px;">
    <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.02em;">Atgeir Solutions</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:2px;">Internal — Interview Assignment</div>
  </div>
  <div style="padding:28px;">
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear <strong>{interviewer_name}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
      You have been assigned to interview a candidate for the <strong>{job_title}</strong> position.
    </p>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">Interview Details</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;width:110px;">Candidate</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{candidate_name}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;">Round</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{round}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;">Date</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{date}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;">Time</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{time}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;">Mode</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{mode}</td></tr>
      </table>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:20px;">
      <a href="{meet_link}" style="display:inline-block;background:#F07C2D;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:600;">Join Google Meet</a>
      <a href="{review_link}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:600;">Rate Interview Experience</a>
    </div>
    <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">Please join the meeting on time. After your interview concludes, we would love your candid feedback via the button above.</p>
    <p style="margin:16px 0 0;font-size:13px;color:#374151;">Best regards,<br><strong>Atgeir Solutions HR Team</strong></p>
  </div>
  {support_footer}
</div>
"""


def fill_template(template: str, fields: dict) -> str:
    html_body = template.replace('{support_footer}', SUPPORT_FOOTER)
    for key, value in fields.items():
        html_body = html_body.replace(f'{{{key}}}', str(value))
    return html_body


def send_email(to_email: str, subject: str, html_body: str) -> bool:
    actual_recipient = TEST_EMAIL if TEST_EMAIL else to_email
    try:
        res = requests.post(EMAIL_API_URL, json={"to": actual_recipient, "subject": subject, "body": html_body}, timeout=10)
        return res.status_code == 200
    except Exception as e:
        print(f"[MATCHMAKER] Email send error: {e}")
        return False


DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def next_date_for_day(day_name: str) -> str:
    today = datetime.now()
    try:
        target_idx = DAY_NAMES.index(day_name)
    except ValueError:
        return today.strftime('%Y-%m-%d')
    days_ahead = (target_idx - today.weekday() + 7) % 7
    days_ahead = days_ahead if days_ahead != 0 else 7
    return (today + timedelta(days=days_ahead)).strftime('%Y-%m-%d')


def format_date_human(date_str: str) -> str:
    dt = datetime.strptime(date_str, '%Y-%m-%d')
    return dt.strftime('%A, %d %B %Y')


def format_time_range(start_time: str, end_time: str) -> str:
    def fmt(t):
        return datetime.strptime(t, '%H:%M').strftime('%I:%M %p').lstrip('0')
    return f"{fmt(start_time)} - {fmt(end_time)}"


@router.post("/api/automatchmaker")
async def auto_matchmaker(request: Request):
    try:
        try:
            req_json = await request.json()
        except Exception:
            req_json = None

        if not req_json:
            return JSONResponse({"error": "Invalid JSON payload"}, status_code=400)

        job_id          = req_json.get('jobId')
        candidate_id    = req_json.get('candidateId')
        interview_round = req_json.get('round', 'round1')

        if not job_id or not candidate_id:
            return JSONResponse({"error": "Missing jobId or candidateId"}, status_code=400)

        def fetch_candidate():
            return list(bq_client.query(
                f"SELECT candidate_name, candidate_email, slot_selected "
                f"FROM `{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections` "
                f"WHERE job_id = '{job_id}' AND candidate_id = '{candidate_id}' AND round = '{interview_round}' "
                f"ORDER BY confirmed_at DESC LIMIT 1"
            ))

        def fetch_candidate_contact_fallback():
            return list(bq_client.query(
                f"SELECT candidate_name, candidate_email "
                f"FROM `{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections` "
                f"WHERE job_id = '{job_id}' AND candidate_id = '{candidate_id}' "
                f"AND candidate_email IS NOT NULL AND candidate_email != '' "
                f"ORDER BY confirmed_at DESC LIMIT 1"
            ))

        def fetch_job():
            return list(bq_client.query(
                f"SELECT title FROM `{PROJECT_ID}.{DATASET_ID}.jobs` "
                f"WHERE job_id = '{job_id}' LIMIT 1"
            ))

        def fetch_interviewers():
            return [dict(r) for r in bq_client.query(
                f"SELECT slot_id, Interviewer_name, Interviewer_email, day, start_time, end_time, work_mode "
                f"FROM `{PROJECT_ID}.{DATASET_ID}.interviewer_slots` "
                f"WHERE job_id = '{job_id}' AND `round` = '{interview_round}' AND status IN ('free', 'on_hold')"
            )]

        with ThreadPoolExecutor(max_workers=3) as ex:
            f_cand = ex.submit(fetch_candidate)
            f_job  = ex.submit(fetch_job)
            f_inv  = ex.submit(fetch_interviewers)
            cand_results      = f_cand.result()
            job_rows          = f_job.result()
            free_interviewers = f_inv.result()

        if not cand_results:
            return JSONResponse({"success": False, "message": "Candidate not found"}, status_code=404)

        candidate      = cand_results[0]
        selected_slots = json.loads(candidate.slot_selected)
        job_title      = job_rows[0].title if job_rows else job_id

        candidate_name  = candidate.candidate_name
        candidate_email = candidate.candidate_email

        if not candidate_email or not candidate_name:
            fallback_rows = fetch_candidate_contact_fallback()
            if fallback_rows:
                if not candidate_email:
                    candidate_email = fallback_rows[0].candidate_email
                if not candidate_name:
                    candidate_name = fallback_rows[0].candidate_name

        if not free_interviewers:
            return JSONResponse({"success": True, "matchSuccess": False, "message": "No free interviewer slots available. Manual assignment required."})

        match_prompt = f"""
        You are matching a candidate's preferred interview time slots against a list of available interviewer slots.

        SELECTED SLOTS (candidate's preferences):
        {json.dumps(selected_slots)}

        FREE INTERVIEWER SLOTS (each is one slot: slot_id, Interviewer_name, Interviewer_email, day, start_time, end_time, work_mode):
        {json.dumps(free_interviewers)}

        Find ONE interviewer slot whose `day` name and `start_time`/`end_time` overlap with any of the candidate's selected slots.
        Match ONLY on day name and time overlap. Ignore work_mode when matching.

        Respond with ONLY a JSON object, no other text:
        - If a match is found: {{"matched": true, "slot_id": "...", "interviewer_name": "...", "interviewer_email": "...", "day": "...", "start_time": "HH:MM", "end_time": "HH:MM", "work_mode": "WFH or WFO"}}
        - If no match is found: {{"matched": false}}
        """

        response = genai_client_global.models.generate_content(
            model="gemini-3.5-flash",
            contents=match_prompt,
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json",
            )
        )

        try:
            match_result = json.loads(response.text)
        except Exception as parse_err:
            print(f"[MATCHMAKER] Failed to parse match response: {parse_err}. Raw: {response.text!r}")
            return JSONResponse({"success": True, "matchSuccess": False, "message": "Matching failed to produce valid output. Manual assignment required."})

        print(f"[MATCHMAKER] Match result: {match_result}")

        if not match_result.get('matched'):
            return JSONResponse({"success": True, "matchSuccess": False, "message": "No time overlap found. Manual assignment required."})

        matched_slot_id            = match_result['slot_id']
        matched_interviewer_name   = match_result['interviewer_name']
        matched_interviewer_email  = match_result['interviewer_email']
        matched_day                = match_result['day']
        matched_start_time         = match_result['start_time']
        matched_end_time           = match_result['end_time']
        matched_work_mode          = match_result['work_mode']

        actual_date = next_date_for_day(matched_day)

        booking_result = book_interview_in_db(
            interviewer_id=matched_slot_id,
            interviewer_name=matched_interviewer_name,
            interviewer_email=matched_interviewer_email,
            candidate_id=candidate_id,
            job_id=job_id,
            job_title=job_title,
            round_id=interview_round,
            date=actual_date,
            start_time=matched_start_time,
            end_time=matched_end_time,
            work_mode=matched_work_mode,
        )
        print(f"[MATCHMAKER] Booking result: {booking_result}")

        verify_query = f"""
            SELECT interviewer_id
            FROM `{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections`
            WHERE job_id = @job_id AND candidate_id = @candidate_id AND round = @round
            ORDER BY confirmed_at DESC
            LIMIT 1
        """
        verify_rows = list(bq_client.query(verify_query, job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
                bigquery.ScalarQueryParameter("candidate_id", "STRING", candidate_id),
                bigquery.ScalarQueryParameter("round", "STRING", interview_round),
            ]
        )))
        booking_confirmed = bool(verify_rows and verify_rows[0].interviewer_id)
        print(f"[MATCHMAKER] Booking confirmed in DB: {booking_confirmed}")

        if not booking_confirmed:
            return JSONResponse({"success": True, "matchSuccess": False, "message": "Booking failed. Manual assignment required.", "bookingResult": booking_result})

        meet_link = create_meet_link(
            slot_date=actual_date,
            slot_start_time=matched_start_time,
            job_title=job_title,
            round_label=ROUND_LABELS.get(interview_round, interview_round),
            duration_mins=ROUND_DURATIONS.get(interview_round, 45),
        )
        print(f"[MATCHMAKER] Meet link: {meet_link}")

        feedback_link = generate_feedback_link(
            candidate_id=candidate_id, job_id=job_id, round_id=interview_round,
            candidate_name=candidate_name, job_title=job_title
        )
        review_link = generate_candidate_review_link(
            candidate_id=candidate_id, job_id=job_id, round_id=interview_round,
            candidate_name=candidate_name, job_title=job_title
        )

        mode_label = "Online (Virtual)" if matched_work_mode == "WFH" else "In-Person (Office)"
        common_fields = {
            "candidate_name": candidate_name,
            "interviewer_name": matched_interviewer_name,
            "job_title": job_title,
            "round": ROUND_LABELS.get(interview_round, interview_round),
            "date": format_date_human(actual_date),
            "time": format_time_range(matched_start_time, matched_end_time),
            "mode": mode_label,
            "meet_link": meet_link,
        }

        candidate_html = fill_template(CANDIDATE_EMAIL_TEMPLATE, common_fields)
        interviewer_html = fill_template(INTERVIEWER_EMAIL_TEMPLATE, {**common_fields, "feedback_link": feedback_link, "review_link": review_link})

        candidate_email_sent = send_email(
            to_email=candidate_email,
            subject=f"Interview Scheduled — {job_title}",
            html_body=candidate_html,
        )
        interviewer_email_sent = send_email(
            to_email=matched_interviewer_email,
            subject=f"Interview Assignment — {job_title}",
            html_body=interviewer_html,
        )

        print(f"[MATCHMAKER] candidate_email_sent={candidate_email_sent}, interviewer_email_sent={interviewer_email_sent}")

        if not (candidate_email_sent and interviewer_email_sent):
            print(f"[MATCHMAKER] WARNING: booking succeeded but emails incomplete: candidate={candidate_email_sent}, interviewer={interviewer_email_sent}")

        try:
            release_query = f"""
                UPDATE `{PROJECT_ID}.{DATASET_ID}.interviewer_slots`
                SET status = 'free'
                WHERE job_id = @job_id
                  AND `round` = @round
                  AND status = 'on_hold'
            """
            bq_client.query(release_query, job_config=bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
                    bigquery.ScalarQueryParameter("round", "STRING", interview_round),
                ]
            )).result()
        except Exception as release_err:
            print(f"[MATCHMAKER] Failed to release on_hold slots: {release_err}")

        return JSONResponse({
            "success": True,
            "matchSuccess": True,
            "message": "Successfully matched, booked, and emailed.",
            "emailStatus": {"candidate": candidate_email_sent, "interviewer": interviewer_email_sent},
        })

    except Exception as e:
        print(f"[MATCHMAKER] Error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)