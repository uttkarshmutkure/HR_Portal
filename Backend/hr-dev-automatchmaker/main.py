import os
import json
import requests
from concurrent.futures import ThreadPoolExecutor
from google.cloud import bigquery
import functions_framework
from google import genai
from google.genai import types

from calendar_tool import create_meet_link
from db_tool import book_interview_in_db
from feedback_tool import generate_feedback_link, generate_candidate_review_link

bq_client = bigquery.Client()
project_id = os.environ.get('GOOGLE_CLOUD_PROJECT', 'atgeir-moae-dev')
dataset_id = os.environ.get('BQ_DATASET_ID', 'hr_dataset')
email_api_url = os.environ.get('EMAIL_API_URL', 'https://wb-gateway-7xpbhfkr.an.gateway.dev/hr-screening/send-email')
test_email = os.environ.get('TEST_EMAIL', 'mutkureu@gmail.com')

ai_client = genai.Client(
    vertexai=True,
    project=os.environ.get('GOOGLE_CLOUD_PROJECT', 'atgeir-moae-dev'),
    location='asia-south1'
)

ROUND_DURATIONS = {'round1': 30, 'technical': 60, 'hr': 30}

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


def send_email_tool(to_email: str, subject: str, html_body: str) -> str:
    """Sends an HTML email to notify candidates and interviewers."""
    actual_recipient = test_email if test_email else to_email
    try:
        res = requests.post(email_api_url, json={"to": actual_recipient, "subject": subject, "body": html_body}, timeout=10)
        if res.status_code == 200:
            return "Email sent successfully."
        return f"Failed with status: {res.status_code}"
    except Exception as e:
        return f"Email send error: {str(e)}"

@functions_framework.http
def auto_matchmaker(request):
    if request.method == 'OPTIONS':
        return ('', 204, {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type'})
    headers = {'Access-Control-Allow-Origin': '*'}

    try:
        req_json = request.get_json(silent=True)

        # Guard against missing/malformed body
        if not req_json:
            return ({"error": "Invalid JSON payload"}, 400, headers)

        job_id          = req_json.get('jobId')
        candidate_id    = req_json.get('candidateId')
        interview_round = req_json.get('round', 'round1')

        if not job_id or not candidate_id:
            return ({"error": "Missing jobId or candidateId"}, 400, headers)

        # Fetch all 3 BQ queries in parallel
        def fetch_candidate():
            return list(bq_client.query(
                f"SELECT candidate_name, candidate_email, slot_selected "
                f"FROM `{project_id}.{dataset_id}.candidate_slot_selections` "
                f"WHERE job_id = '{job_id}' AND candidate_id = '{candidate_id}' AND round = '{interview_round}' "
                f"ORDER BY confirmed_at DESC LIMIT 1"
            ))

        # Fallback: technical/hr rows may have blank email if the frontend didn't
        # pass candidateEmail when saving those slots. Get it from any other round.
        def fetch_candidate_contact_fallback():
            return list(bq_client.query(
                f"SELECT candidate_name, candidate_email "
                f"FROM `{project_id}.{dataset_id}.candidate_slot_selections` "
                f"WHERE job_id = '{job_id}' AND candidate_id = '{candidate_id}' "
                f"AND candidate_email IS NOT NULL AND candidate_email != '' "
                f"ORDER BY confirmed_at DESC LIMIT 1"
            ))

        def fetch_job():
            return list(bq_client.query(
                f"SELECT title FROM `{project_id}.{dataset_id}.jobs` "
                f"WHERE job_id = '{job_id}' LIMIT 1"
            ))

        def fetch_interviewers():
            return [dict(r) for r in bq_client.query(
                f"SELECT slot_id, Interviewer_name, Interviewer_email, day, start_time, end_time, work_mode "
                f"FROM `{project_id}.{dataset_id}.interviewer_slots` "
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
            return ({"success": False, "message": "Candidate not found"}, 404, headers)

        candidate      = cand_results[0]
        selected_slots = json.loads(candidate.slot_selected)
        job_title      = job_rows[0].title if job_rows else job_id

        candidate_name  = candidate.candidate_name
        candidate_email = candidate.candidate_email

        # If email/name is blank for this round, fall back to another round's row
        if not candidate_email or not candidate_name:
            fallback_rows = fetch_candidate_contact_fallback()
            if fallback_rows:
                if not candidate_email:
                    candidate_email = fallback_rows[0].candidate_email
                if not candidate_name:
                    candidate_name = fallback_rows[0].candidate_name

        candidate_template = CANDIDATE_EMAIL_TEMPLATE.replace('{support_footer}', SUPPORT_FOOTER)
        interviewer_template = INTERVIEWER_EMAIL_TEMPLATE.replace('{support_footer}', SUPPORT_FOOTER)

        agent_instructions = f"""
            You are an HR Matchmaker Agent. Match candidate time preferences with interviewer availability, book the slot, generate a Google Meet link, and send HTML emails.

            PROCESS:
            1. MATCH: Each entry in FREE INTERVIEWERS is a single available slot (slot_id, Interviewer_name, Interviewer_email, day, start_time, end_time, work_mode). Find an overlap between SELECTED SLOTS and any interviewer slot on the same day with matching time.
            2. BOOK: Call book_interview_in_db, passing the matched interviewer slot's `slot_id` as `interviewer_id`, the matched slot's `Interviewer_name` as `interviewer_name`, `Interviewer_email` as `interviewer_email`, job_id="{job_id}", job_title="{job_title}", round_id="{interview_round}", the matched slot's `day`-derived actual calendar date as `date` (format YYYY-MM-DD), `start_time` and `end_time` from the matched slot, and `work_mode` from the matched slot.
            3. MEET: Call create_meet_link (duration_mins = {ROUND_DURATIONS.get(interview_round, 45)}).
            4. FEEDBACK LINK: Call generate_feedback_link(candidate_id="{candidate_id}", job_id="{job_id}", round_id="{interview_round}", candidate_name="{candidate_name}", job_title="{job_title}") to get the FEEDBACK_LINK. Use the returned value EXACTLY as-is — do not retype, shorten, or alter it.
            5. EMAIL: Send TWO emails using the exact HTML templates below — fill in the placeholders with actual values. You MUST call send_email_tool twice: once for the candidate and once for the interviewer.
            6. CANDIDATE REVIEW LINK: Call generate_candidate_review_link(candidate_id="{candidate_id}", job_id="{job_id}", round_id="{interview_round}", candidate_name="{candidate_name}", job_title="{job_title}") to get the CANDIDATE_REVIEW_LINK. Pass its return value into the candidate email unmodified.

            CANDIDATE EMAIL TEMPLATE (fill placeholders and pass as html_body):
            {candidate_template}

            INTERVIEWER EMAIL TEMPLATE (fill placeholders and pass as html_body):
            {interviewer_template}

            Placeholders to fill:
            - CANDIDATE_NAME, INTERVIEWER_NAME, JOB_TITLE
            - ROUND — human readable e.g. "Round 1", "Technical Round"
            - DATE — formatted as "Wednesday, 10 June 2026"
            - TIME — formatted as "10:30 AM - 11:00 AM"
            - MODE — based on the matched slot's work_mode: if work_mode is "WFH", use "Online (Virtual)"; if work_mode is "WFO", use "In-Person (Office)"
            - MEET_LINK — from create_meet_link result
            - FEEDBACK_LINK — from generate_feedback_link result (interviewer email only)
            - REVIEW_LINK — from generate_candidate_review_link result (candidate email only)

            Replace the placeholder tokens in the templates exactly:
            {{candidate_name}} → actual candidate name
            {{interviewer_name}} → actual interviewer name
            {{job_title}} → actual job title
            {{round}} → human readable round name
            {{date}} → formatted date
            {{time}} → formatted time range
            {{mode}} → "Online (Virtual)" if work_mode is WFH, or "In-Person (Office)" if work_mode is WFO
            {{meet_link}} → Google Meet URL
            {{feedback_link}} → exact return value of generate_feedback_link, unmodified
            {{review_link}} → exact return value of generate_candidate_review_link, unmodified

            RULES:
            - Match ONLY on day name and time overlap. Ignore work_mode for matching.
            - If no time match found, reply exactly: "No match found." and call NO tools.
            """
        
        prompt = f"""
        Find a match and book the interview.
        CANDIDATE: {candidate_name} ({candidate_email})
        CANDIDATE ID: {candidate_id}
        JOB ID: {job_id}
        SELECTED SLOTS: {json.dumps(selected_slots)}
        FREE INTERVIEWERS: {json.dumps(free_interviewers)}
        """

        chat = ai_client.chats.create(
            model="gemini-2.5-flash",
            config=types.GenerateContentConfig(
                system_instruction=agent_instructions,
                tools=[book_interview_in_db, create_meet_link, generate_feedback_link, generate_candidate_review_link, send_email_tool],
                temperature=0.1
            )
        )

        agent_response = chat.send_message(prompt)
        response_text = agent_response.text or ""
        print(f"[MATCHMAKER] Agent response text: {response_text!r}")
        print(f"[MATCHMAKER] Finish reason: {agent_response.candidates[0].finish_reason if agent_response.candidates else 'N/A'}")

        # Case-insensitive match check
        if "no match found" in response_text.lower():
            return ({"success": True, "matchSuccess": True, "message": "Successfully matched, booked, and emailed.", "agentLog": response_text}, 200, headers)

        try:
            release_query = f"""
                UPDATE `{project_id}.{dataset_id}.interviewer_slots`
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

        return ({"success": True, "matchSuccess": True, "message": "Successfully matched, booked, and emailed.", "agentLog": agent_response.text}, 200, headers)

    except Exception as e:
        print(f"[MATCHMAKER] Error: {e}")
        return ({"error": str(e)}, 500, headers)