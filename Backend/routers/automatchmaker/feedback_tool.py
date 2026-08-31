"""
feedback_tool — generates tokenized feedback/review links for interviewer
and candidate emails. Unchanged logic, FRONTEND_URL now required via
config.py (no hardcoded fallback URL).
"""

import json
import time
import base64
import urllib.parse

import config

FRONTEND_URL = config.FRONTEND_URL


def generate_feedback_link(candidate_id: str, job_id: str, round_id: str, candidate_name: str, job_title: str) -> str:
    """
    Generates the FEEDBACK_LINK URL for the interviewer email. Call this tool to get the
    feedback link — pass the value it returns into the interviewer email's
    {feedback_link} placeholder exactly as returned, without modifying it.
    """
    feedback_payload = json.dumps({
        "candidateId":   candidate_id,
        "jobId":         job_id,
        "round":         round_id,
        "candidateName": candidate_name,
        "jobTitle":      job_title,
        "skills":        [],
        "exp":           int((time.time() + 7 * 24 * 3600) * 1000),
    })
    feedback_token = base64.b64encode(urllib.parse.quote(feedback_payload).encode()).decode()
    return f"{FRONTEND_URL}/feedback/{feedback_token}"


def generate_candidate_review_link(candidate_id: str, job_id: str, round_id: str, candidate_name: str, job_title: str) -> str:
    """
    Generates the REVIEW_LINK URL for the candidate email. Call this tool to get the
    candidate's review link — pass the value it returns into the candidate email's
    {review_link} placeholder exactly as returned, without modifying it.
    """
    payload = json.dumps({
        "candidateId":   candidate_id,
        "jobId":         job_id,
        "round":         round_id,
        "candidateName": candidate_name,
        "jobTitle":      job_title,
        "exp":           int((time.time() + 14 * 24 * 3600) * 1000),
    })
    token = base64.b64encode(urllib.parse.quote(payload).encode()).decode()
    return f"{FRONTEND_URL}/candidate-review/{token}"