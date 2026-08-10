"""
Refer a Friend — single HTTP Cloud Function.

Does BOTH things in one request, synchronously:
  1. Uploads the resume PDF to GCS, extracts fields via Gemini (reusing
     resume_processing.py unchanged), and inserts the candidate into
     `candidates` marked as Referred/COMPLETED — skipping the screening
     pipeline entirely (via referral_processing.process_referral_from_gcs).
  2. Inserts a row into `referrals` with everything the referrer typed in
     the form (gender, experience, salary, fit_reason, referred_by), now
     linked to the real candidate_id from step 1.

No GCS trigger needed — this replaces that approach entirely.
"""

import json
import logging
import uuid

import functions_framework
from google.cloud import storage

from referral_processing import process_referral_from_gcs
from referral_table import insert_referral_record

log = logging.getLogger(__name__)

PROJECT_ID  = "atgeir-moae-dev"
BUCKET_NAME = "hr-data-source-at"

CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age":       "3600",
    "Content-Type":                 "application/json",
}

gcs_client = storage.Client(project=PROJECT_ID)


def _upload_resume(file_storage, job_id: str) -> str:
    """Uploads the resume to referral_candidates/{job_id}/{uuid}_{filename}.pdf.
    Returns the file's GCS path (not gs:// — just the object name, since
    process_referral_from_gcs takes bucket_name and file_name separately)."""
    safe_name = (file_storage.filename or "resume.pdf").replace(" ", "_")
    blob_path = f"referral_candidates/{job_id}/{uuid.uuid4()}_{safe_name}"
    bucket = gcs_client.bucket(BUCKET_NAME)
    blob = bucket.blob(blob_path)
    blob.upload_from_string(file_storage.read(), content_type="application/pdf")
    return blob_path


@functions_framework.http
def refer_candidate_http(request):
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)

    if request.method != "POST":
        return (json.dumps({"error": "Method not allowed"}), 405, CORS_HEADERS)

    try:
        form = request.form
        job_id      = form.get("job_id", "")
        first_name  = form.get("first_name", "")
        middle_name = form.get("middle_name", "")
        last_name   = form.get("last_name", "")
        email       = form.get("email", "")
        phone       = form.get("phone", "")

        if not job_id or not first_name or not last_name or not email:
            return (
                json.dumps({"error": "job_id, first_name, last_name, and email are required"}),
                400,
                CORS_HEADERS,
            )

        resume_file = request.files.get("resume")
        if not resume_file:
            return (
                json.dumps({"error": "Resume file is required to create the candidate record"}),
                400,
                CORS_HEADERS,
            )

        # ── STEP 1: upload resume + extract + insert into candidates (Referred) ──
        blob_path = _upload_resume(resume_file, job_id)

        candidate_id = process_referral_from_gcs(BUCKET_NAME, blob_path, job_id)
        if not candidate_id:
            return (
                json.dumps({"error": "Resume could not be read/parsed. Please check the PDF and try again."}),
                422,
                CORS_HEADERS,
            )

        # ── STEP 2: insert referral record, linked to the real candidate_id ──
        try:
            exp_years  = float(form.get("experience_years", "0") or 0)
            exp_months = float(form.get("experience_months", "0") or 0)
        except ValueError:
            exp_years, exp_months = 0.0, 0.0
        total_experience = exp_years + (exp_months / 12)

        candidate_name = " ".join(p for p in [first_name, middle_name, last_name] if p).strip()

        referral_id = insert_referral_record(
            job_id=job_id,
            candidate_id=candidate_id,
            candidate_name=candidate_name,
            candidate_email=email,
            candidate_phone=phone,
            gender=form.get("gender", ""),
            experience_years=total_experience,
            salary_currency=form.get("salary_currency", "INR"),
            salary_amount=form.get("salary_amount", ""),
            salary_frequency=form.get("salary_freq", "NA"),
            fit_reason=form.get("fit_reason", ""),
            referred_by=form.get("referred_by", ""),
            gcs_pdf_path=f"gs://{BUCKET_NAME}/{blob_path}",
        )

        return (
            json.dumps({
                "success": True,
                "candidate_id": candidate_id,
                "referral_id": referral_id,
                "message": f"{candidate_name} has been referred and added to the shortlist.",
            }),
            200,
            CORS_HEADERS,
        )

    except Exception as e:
        log.error("Refer candidate failed: %s", e)
        return (json.dumps({"error": str(e)}), 500, CORS_HEADERS)