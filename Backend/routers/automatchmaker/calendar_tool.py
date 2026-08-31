"""
calendar_tool — Google Meet link creation via Calendar API, using OAuth
creds stored in Secret Manager. Unchanged logic from the original CF, just
project_id now sourced from config.py.
"""

import json
import uuid
from datetime import datetime, timedelta

from google.cloud import secretmanager
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

import config

PROJECT_ID = config.GCP_PROJECT_ID


def create_meet_link(slot_date: str, slot_start_time: str, job_title: str, round_label: str, duration_mins: int) -> str:
    """
    Creates a Google Meet link for an interview. Use this tool when a matching time slot
    is found between a candidate and an interviewer.
    """
    try:
        start_dt = datetime.strptime(f"{slot_date} {slot_start_time}", "%Y-%m-%d %H:%M")
        end_dt = start_dt + timedelta(minutes=duration_mins)

        ist_offset = "+05:30"
        start_str = start_dt.strftime(f"%Y-%m-%dT%H:%M:00{ist_offset}")
        end_str   = end_dt.strftime(f"%Y-%m-%dT%H:%M:00{ist_offset}")

        sm_client = secretmanager.SecretManagerServiceClient()
        secret_name = f"projects/{PROJECT_ID}/secrets/hr-calendar-oauth/versions/latest"
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
            "conferenceData": {
                "createRequest": {
                    "requestId": str(uuid.uuid4()),
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            },
        }

        created = service.events().insert(calendarId="primary", body=event, conferenceDataVersion=1).execute()

        for ep in created.get("conferenceData", {}).get("entryPoints", []):
            if ep.get("entryPointType") == "video":
                return ep.get("uri")
        return "Error: Meet link not returned."
    except Exception as e:
        return f"Error: {str(e)}"