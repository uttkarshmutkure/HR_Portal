import os
import json
import time
import requests
import uuid
from google.cloud import bigquery
import functions_framework
import google.auth
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google.cloud import secretmanager
from googleapiclient.discovery import build
from datetime import datetime, timedelta
import base64, urllib.parse, json, time

bq_client = bigquery.Client()

ROUND_DURATIONS = {
    'round1': 30,
    'technical': 60,
    'hr': 30
}

def create_meet_link(candidate_email, interviewer_email, slot_date, slot_start_time, 
                     job_title, round_label, duration_mins):
    try:
        start_dt = datetime.strptime(f"{slot_date} {slot_start_time}", "%Y-%m-%d %H:%M")
        end_dt = start_dt + timedelta(minutes=duration_mins)

        ist_offset = "+05:30"
        start_str = start_dt.strftime(f"%Y-%m-%dT%H:%M:00{ist_offset}")
        end_str   = end_dt.strftime(f"%Y-%m-%dT%H:%M:00{ist_offset}")

        # Load OAuth creds from Secret Manager
        sm_client = secretmanager.SecretManagerServiceClient()
        secret_name = "projects/atgeir-moae-dev/secrets/hr-calendar-oauth/versions/latest"
        creds_info = json.loads(sm_client.access_secret_version(name=secret_name).payload.data.decode())

        creds = Credentials(
            token=creds_info["access_token"],
            refresh_token=creds_info["refresh_token"],
            token_uri=creds_info["token_uri"],
            client_id=creds_info["client_id"],
            client_secret=creds_info["client_secret"],
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())

        service = build("calendar", "v3", credentials=creds)

        event = {
            "summary": f"{round_label} Interview — {job_title}",
            "description": "Scheduled via Atgeir HR System.",
            "start": {"dateTime": start_str, "timeZone": "Asia/Kolkata"},
            "end":   {"dateTime": end_str,   "timeZone": "Asia/Kolkata"},
            # NOTE: Attendees removed — service accounts require Domain-Wide Delegation
            # to invite attendees. Candidate & interviewer are notified via email instead.
            "conferenceData": {
                "createRequest": {
                    "requestId": str(uuid.uuid4()),
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            },
        }

        created = service.events().insert(
            calendarId="primary",
            body=event,
            conferenceDataVersion=1,
        ).execute()

        # Extract video Meet link from conference entry points
        meet_link = None
        for ep in created.get("conferenceData", {}).get("entryPoints", []):
            if ep.get("entryPointType") == "video":
                meet_link = ep.get("uri")
                break

        if not meet_link:
            raise ValueError("Meet link not returned by Calendar API")

        print(f"[CALENDAR] Meet link created successfully → {meet_link}")
        return meet_link

    except Exception as e:
        print(f"Meet link creation failed: {e}")
        return os.environ.get("GMEET_LINK", "https://meet.google.com/wge-fkcj-mny")


def send_email(api_url, to, subject, html_body):
    try:
        requests.post(api_url, json={"to": to, "subject": subject, "body": html_body}, timeout=10)
    except Exception as e:
        print(f"Email send error: {e}")


# ── Reusable support footer ────────────────────────────────────────────────────
SUPPORT_FOOTER = """
    <div style="margin-top:16px;padding:10px 14px;background:#F9FAFB;border-radius:6px;border:0.5px solid #E5E7EB;font-size:12px;color:#6B7280;">
        For any queries, please reach out to us at <a href="mailto:support@atgeirsolutions.com" style="color:#2563EB;">support@atgeirsolutions.com</a> or call <strong>+91 020-41292883</strong>.
    </div>
"""

# ── Reusable HR Portal link ────────────────────────────────────────────────────
HR_PORTAL_LINK = """
    <p style="margin-top:16px; font-size:13px; color:#4B5563;">
        For more candidate details, please log in to the <a href="https://candidate-screening.web.app/dashboard" style="color:#2563EB; font-weight:600; text-decoration:underline;">HR Portal</a>.
    </p>
"""


@functions_framework.http
def auto_matchmaker(request):
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
        return ('', 204, headers)

    headers = {'Access-Control-Allow-Origin': '*'}

    try:
        req_json        = request.get_json(silent=True)
        job_id          = req_json.get('jobId')
        candidate_id    = req_json.get('candidateId')
        interview_round = req_json.get('round', 'round1')

        project_id    = os.environ.get('GOOGLE_CLOUD_PROJECT', 'atgeir-moae-dev')
        dataset_id    = os.environ.get('BQ_DATASET_ID', 'hr_dataset')
        frontend_url  = os.environ.get('FRONTEND_URL', 'https://candidate-screening.web.app')
        email_api_url = os.environ.get('EMAIL_API_URL', 'https://wb-gateway-7xpbhfkr.an.gateway.dev/hr-screening/send-email')
        test_email    = os.environ.get('TEST_EMAIL', 'mutkureu@gmail.com')

        # 1. Fetch candidate data
        cand_query = f"""
            SELECT slot_id, candidate_name, candidate_email, slot_selected, slot_date, slot_start_time, slot_end_time
            FROM `{project_id}.{dataset_id}.candidate_slot_selections`
            WHERE job_id = @job_id AND candidate_id = @candidate_id AND round = @round
            ORDER BY confirmed_at DESC
            LIMIT 1
        """
        cand_cfg = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("job_id",       "STRING", job_id),
            bigquery.ScalarQueryParameter("candidate_id", "STRING", candidate_id),
            bigquery.ScalarQueryParameter("round",        "STRING", interview_round),
        ])
        cand_results = list(bq_client.query(cand_query, job_config=cand_cfg))

        if not cand_results:
            return ({"success": False, "message": "Candidate not found"}, 404, headers)

        candidate      = cand_results[0]
        cand_name      = candidate.candidate_name
        cand_email     = candidate.candidate_email
        selected_slots = json.loads(candidate.slot_selected)

        matched_slot_date       = candidate.slot_date
        matched_slot_start_time = candidate.slot_start_time
        matched_slot_end_time   = candidate.slot_end_time

        # 2. Fetch job info
        job_title = job_id
        skills    = []
        try:
            job_query = f"""
                SELECT title, must_have_skills
                FROM `{project_id}.{dataset_id}.jobs`
                WHERE job_id = @job_id LIMIT 1
            """
            job_cfg = bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("job_id", "STRING", job_id)
            ])
            job_rows = list(bq_client.query(job_query, job_config=job_cfg))
            if job_rows:
                job_title = job_rows[0].title or job_id
                try:
                    skills = json.loads(job_rows[0].must_have_skills or '[]')
                except Exception:
                    skills = []
            else:
                print(f"No job found for job_id={job_id} in jobs table")
        except Exception as je:
            print(f"Job fetch failed: {je}")

        # 3. Fetch free interviewers for this round
        inv_query = f"""
            SELECT slot_id, Interviewer_id, Interviewer_name, Interviewer_email,
                available_slots, IFNULL(slot_details_json, '[]') AS slot_details_json
            FROM `{project_id}.{dataset_id}.interviewer_slots`
            WHERE job_id  = @job_id
            AND `round` = @round
            AND status  = 'free'
        """
        inv_cfg = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
            bigquery.ScalarQueryParameter("round",  "STRING", interview_round),
        ])
        free_interviewers = list(bq_client.query(inv_query, job_config=inv_cfg))

        # 4. Match candidate slots to free interviewer slots
        matched_interviewer = None
        final_matched_time  = None

        for choice in selected_slots:
            cand_date = choice.get('slot_date')
            cand_start = choice.get('slot_start_time')
            cand_end = choice.get('slot_end_time')
            
            if not cand_date or not cand_start or not cand_end:
                continue

            try:
                date_obj = datetime.strptime(cand_date, "%Y-%m-%d")
                day_of_week = date_obj.strftime("%A") 
            except ValueError:
                continue
            
            target_match_string = f"{day_of_week}:{cand_start}-{cand_end}"

            for inv in free_interviewers:
                if inv.available_slots and target_match_string in inv.available_slots:
                    matched_interviewer = inv
                    final_matched_time = choice.get('raw', '') 
                    break
                    
            if matched_interviewer:
                break

        if not matched_interviewer:
            return ({"success": False, "message": "No free interviewers match the candidate's slots."}, 200, headers)

        # 5. Book the interviewer slot
        update_query = f"""
            UPDATE `{project_id}.{dataset_id}.interviewer_slots`
            SET status = 'booked'
            WHERE slot_id = '{matched_interviewer.slot_id}'
        """
        bq_client.query(update_query).result()
        
        round_labels = {'round1': 'Round 1', 'technical': 'Technical Round', 'hr': 'HR Round'}
        round_label  = round_labels.get(interview_round, interview_round)
        
        gmeet_link = create_meet_link(
            candidate_email   = cand_email,
            interviewer_email = matched_interviewer.Interviewer_email,
            slot_date         = matched_slot_date,
            slot_start_time   = matched_slot_start_time,
            job_title         = job_title,
            round_label       = round_label,
            duration_mins     = ROUND_DURATIONS.get(interview_round, 45)
        )

        # 6. Generate internal feedback link
        feedback_payload = json.dumps({
            "candidateId":   candidate_id,
            "jobId":         job_id,
            "round":         interview_round,
            "candidateName": cand_name,
            "jobTitle":      job_title,
            "skills":        skills,
            "exp":           int((time.time() + 7 * 24 * 3600) * 1000),
        })
        feedback_token = base64.b64encode(urllib.parse.quote(feedback_payload).encode()).decode()
        feedback_link  = f"{frontend_url}/feedback/{feedback_token}"

        # 7. Format display values
        position_display = f"{job_title} ({job_id})" if job_title != job_id else job_title
        display_time = f"{matched_slot_date} {matched_slot_start_time} - {matched_slot_end_time}"

        # 8. Send candidate email
        cand_html = f"""
            <div style="font-family: Arial, sans-serif; color: #374151; max-width: 600px;">
                <h2 style="color: #1F2937;">Interview Scheduled — {round_label}</h2>
                <p>Hi <strong>{cand_name}</strong>, your interview has been confirmed.</p>
                <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
                    <tr><td style="padding: 8px; color: #6B7280; width: 140px;">Position</td>
                        <td style="padding: 8px;"><strong>{position_display}</strong></td></tr>
                    <tr style="background:#F9FAFB;"><td style="padding: 8px; color: #6B7280;">Round</td>
                        <td style="padding: 8px;"><strong>{round_label}</strong></td></tr>
                    <tr><td style="padding: 8px; color: #6B7280;">Time</td>
                        <td style="padding: 8px;"><strong>{display_time}</strong></td></tr>
                    <tr style="background:#F9FAFB;"><td style="padding: 8px; color: #6B7280;">Interviewer</td>
                        <td style="padding: 8px;"><strong>{matched_interviewer.Interviewer_name}</strong></td></tr>
                </table>
                <a href="{gmeet_link}" style="display:inline-block;background:#2563EB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:8px;">
                    Join Google Meet
                </a>
                <p style="color:#6B7280;font-size:13px;margin-top:24px;">
                    Please join on time. If you need to reschedule, contact HR immediately.
                </p>
                {SUPPORT_FOOTER}
            </div>
        """
        send_email(email_api_url, test_email, f"[{round_label}] Interview Scheduled — {cand_name}", cand_html)

        # 9. Send interviewer email
        inv_html = f"""
            <div style="font-family: Arial, sans-serif; color: #374151; max-width: 600px;">
                <h2 style="color: #1F2937;">New Interview Assigned — {round_label}</h2>
                <p>Hi <strong>{matched_interviewer.Interviewer_name}</strong>, you have a new interview scheduled.</p>
                <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
                    <tr><td style="padding: 8px; color: #6B7280; width: 140px;">Candidate</td>
                        <td style="padding: 8px;"><strong>{cand_name}</strong></td></tr>
                    <tr style="background:#F9FAFB;"><td style="padding: 8px; color: #6B7280;">Round</td>
                        <td style="padding: 8px;"><strong>{round_label}</strong></td></tr>
                    <tr><td style="padding: 8px; color: #6B7280;">Time</td>
                        <td style="padding: 8px;"><strong>{display_time}</strong></td></tr>
                    <tr style="background:#F9FAFB;"><td style="padding: 8px; color: #6B7280;">Position</td>
                        <td style="padding: 8px;"><strong>{position_display}</strong></td></tr>
                </table>
                <a href="{gmeet_link}" style="display:inline-block;background:#2563EB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:8px;">
                    Join Google Meet
                </a>
                <div style="margin-top:24px;padding:16px;background:#F0FDF4;border-radius:8px;border:1px solid #86EFAC;">
                    <p style="margin:0 0 8px;font-weight:bold;color:#166534;">Post-interview feedback</p>
                    <p style="margin:0 0 4px;color:#166534;font-size:14px;">
                        After the interview, open the candidate pipeline to log the technical and communication scores.
                    </p>
                    <p style="margin:0 0 12px;color:#DC2626;font-size:13px;font-weight:600;">
                        &#9200; Please submit your feedback within 2 hours after the interview.
                    </p>
                    <a href="{feedback_link}" style="display:inline-block;background:#16A34A;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
                        Open Job Pipeline
                    </a>
                </div>
                {HR_PORTAL_LINK}
                {SUPPORT_FOOTER}
            </div>
        """
        send_email(email_api_url, test_email, f"[{round_label}] Interview Assigned — {matched_interviewer.Interviewer_name}", inv_html)

        # 10. Update candidate status to 'scheduled'
        try:
            slot_id_to_update = None
            try:
                slot_id_to_update = cand_results[0].slot_id
            except Exception:
                slot_id_to_update = None

            if slot_id_to_update:
                update_status_query = f"""
                    UPDATE `{project_id}.{dataset_id}.candidate_slot_selections`
                    SET status = 'scheduled'
                    WHERE slot_id = @slot_id
                """
                update_status_cfg = bigquery.QueryJobConfig(query_parameters=[
                    bigquery.ScalarQueryParameter("slot_id", "STRING", slot_id_to_update),
                ])
                bq_client.query(update_status_query, job_config=update_status_cfg).result()
            else:
                update_status_query = f"""
                    UPDATE `{project_id}.{dataset_id}.candidate_slot_selections`
                    SET status = 'scheduled'
                    WHERE job_id = @job_id
                      AND candidate_id = @candidate_id
                      AND round = @round
                      AND confirmed_at = (
                          SELECT MAX(confirmed_at)
                          FROM `{project_id}.{dataset_id}.candidate_slot_selections`
                          WHERE job_id = @job_id AND candidate_id = @candidate_id AND round = @round
                      )
                """
                update_status_cfg = bigquery.QueryJobConfig(query_parameters=[
                    bigquery.ScalarQueryParameter("job_id",       "STRING", job_id),
                    bigquery.ScalarQueryParameter("candidate_id", "STRING", candidate_id),
                    bigquery.ScalarQueryParameter("round",        "STRING", interview_round),
                ])
                bq_client.query(update_status_query, job_config=update_status_cfg).result()
        except Exception as merge_err:
            print(f"Status update skipped: {merge_err}")

        return ({
            "success":     True,
            "message":     f"Matched & emails sent for {round_label}!",
            "matchedTime": display_time,
            "interviewer": matched_interviewer.Interviewer_name,
            "round":       interview_round
        }, 200, headers)

    except Exception as e:
        print(f"Matchmaker Error: {e}")
        return ({"error": str(e)}, 500, headers)


# ── HR Round Accept → Candidate Selection Confirmation Email ──────────────────
def send_hr_accept_email(api_url, test_email, cand_name, cand_email, job_title):
    """
    Triggered when HR clicks 'Accept' on the feedback form after the HR Round.
    Sends a selection confirmation email to the candidate.
    """
    html_body = f"""
        <div style="font-family: Arial, sans-serif; color: #374151; max-width: 600px;">
            <h2 style="color: #1F2937;">Congratulations — You've Been Selected!</h2>
            <p>Dear <strong>{cand_name}</strong>,</p>
            <p>
                We are pleased to inform you that you have been selected for the position of
                <strong>{job_title}</strong> at Atgeir Solutions.
            </p>
            <p>
                Your skills, experience, and interview performance were impressive, and we are excited
                about the opportunity to have you join our team.
            </p>
            <p>
                Our HR team will soon share the offer letter and onboarding details with you.
            </p>
            <p style="font-weight: 600; color: #059669;">Congratulations and welcome to Atgeir Solutions!</p>
            <p style="margin-top: 24px;">
                Best regards,<br/>
                <strong>HR Team — Atgeir Solutions</strong>
            </p>
            {HR_PORTAL_LINK}
            {SUPPORT_FOOTER}
        </div>
    """
    send_email(api_url, test_email, f"You've Been Selected — {job_title} at Atgeir Solutions", html_body)


# ── Send Offer Button → Formal Offer Letter Email ────────────────────────────
def send_offer_email(api_url, test_email, cand_name, cand_email, job_title, acceptance_deadline):
    """
    Triggered when HR clicks 'Send Offer' on the Interview Pipeline (Onboarding tab).
    Sends a formal offer letter email to the candidate.
    """
    html_body = f"""
        <div style="font-family: Arial, sans-serif; color: #374151; max-width: 600px;">
            <h2 style="color: #1F2937;">Offer Letter — {job_title}</h2>
            <p>Dear <strong>{cand_name}</strong>,</p>
            <p><strong>Congratulations!</strong></p>
            <p>
                We are delighted to offer you the position of <strong>{job_title}</strong> at Atgeir Solutions.
            </p>
            <p>
                Please find your offer letter attached with this email. Kindly review the document and
                share your acceptance before <strong>{acceptance_deadline}</strong>.
            </p>
            <p>
                If you have any questions regarding the offer or onboarding process, feel free to contact us.
            </p>
            <p>We look forward to welcoming you to the team.</p>
            <p style="margin-top: 24px;">
                Best regards,<br/>
                <strong>HR Team — Atgeir Solutions</strong>
            </p>
            {HR_PORTAL_LINK}
            {SUPPORT_FOOTER}
        </div>
    """
    send_email(api_url, test_email, f"Offer Letter — {job_title} at Atgeir Solutions", html_body)