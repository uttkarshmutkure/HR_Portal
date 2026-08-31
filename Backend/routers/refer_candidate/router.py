"""
refer_candidate — FastAPI route, mirrors the old `hr-dev-referred-candidates`
Cloud Function (refer_candidate_http). Uploads a referred candidate's resume,
extracts + inserts them as Referred/COMPLETED (skipping the screening
pipeline), then records the referral form details linked to that candidate.
"""

import uuid

from fastapi import APIRouter, Form, UploadFile, File
from fastapi.responses import JSONResponse

import config
from gcs_client import gcs_client
from routers.refer_candidate.referral_processing import process_referral_from_gcs
from routers.refer_candidate.referral_table import insert_referral_record

router = APIRouter()

BUCKET_NAME = config.GCS_BUCKET_NAME


async def _upload_resume(resume_file: UploadFile, job_id: str) -> str:
    """Uploads the resume to referral_candidates/{job_id}/{uuid}_{filename}.pdf.
    Returns the file's GCS object path (no gs:// prefix)."""
    safe_name = (resume_file.filename or "resume.pdf").replace(" ", "_")
    blob_path = f"referral_candidates/{job_id}/{uuid.uuid4()}_{safe_name}"
    bucket = gcs_client.bucket(BUCKET_NAME)
    blob = bucket.blob(blob_path)
    contents = await resume_file.read()
    blob.upload_from_string(contents, content_type="application/pdf")
    return blob_path


@router.post("/api/refer-candidate")
async def refer_candidate_http(
    job_id: str = Form(""),
    first_name: str = Form(""),
    middle_name: str = Form(""),
    last_name: str = Form(""),
    email: str = Form(""),
    phone: str = Form(""),
    gender: str = Form(""),
    experience_years: str = Form("0"),
    experience_months: str = Form("0"),
    salary_currency: str = Form("INR"),
    salary_amount: str = Form(""),
    salary_freq: str = Form("NA"),
    fit_reason: str = Form(""),
    referred_by: str = Form(""),
    resume: UploadFile = File(...),
):
    if not job_id or not first_name or not last_name or not email:
        return JSONResponse({"error": "job_id, first_name, last_name, and email are required"}, status_code=400)

    if not resume:
        return JSONResponse({"error": "Resume file is required to create the candidate record"}, status_code=400)

    try:
        # ── STEP 1: upload resume + extract + insert into candidates (Referred) ──
        blob_path = await _upload_resume(resume, job_id)

        candidate_id = process_referral_from_gcs(BUCKET_NAME, blob_path, job_id)
        if not candidate_id:
            return JSONResponse({"error": "Resume could not be read/parsed. Please check the PDF and try again."}, status_code=422)

        # ── STEP 2: insert referral record, linked to the real candidate_id ──
        try:
            exp_years  = float(experience_years or 0)
            exp_months = float(experience_months or 0)
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
            gender=gender,
            experience_years=total_experience,
            salary_currency=salary_currency,
            salary_amount=salary_amount,
            salary_frequency=salary_freq,
            fit_reason=fit_reason,
            referred_by=referred_by,
            gcs_pdf_path=f"gs://{BUCKET_NAME}/{blob_path}",
        )

        return JSONResponse({
            "success": True,
            "candidate_id": candidate_id,
            "referral_id": referral_id,
            "message": f"{candidate_name} has been referred and added to the shortlist.",
        })

    except Exception as e:
        print(f"Refer candidate failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)