"""
hr-dev-resume-uploader  —  Cloud Function (HTTP)
────────────────────────────────────────────────
Two callers share this function:

  1. HR portal  (unchanged)  →  1-20 PDFs in field "resumes", HR-style rules.
  2. Careers page (public)   →  form field source=careers_page. Exactly ONE PDF
     plus the applicant's details. Extra rules apply (see below).

Resumes are stored at   gs://<staging bucket>/resumes/{job_id}/{file}.pdf
The staging bucket has NO Eventarc trigger, so nothing is screened yet.
A later promote step copies files into the main bucket to start screening.

Careers-page mode (source=careers_page):
  • job must be ACTIVE (HR mode only rejects archived)
  • first_name, last_name, email, phone and consent=true are required
  • the object is named  <First><Last>_<emailhash>.pdf  and written with
    if_generation_match=0, so the SAME email applying to the SAME job twice is
    rejected (409 ALREADY_APPLIED) instead of creating a duplicate
  • applicant details are saved as GCS custom metadata on the object
    (keys applicant_*, consent_at, applied_at, source). Eventarc delivers them in
    the event's "metadata" field, so the pipeline can read them with no lookup.
"""

import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

import functions_framework
from google.api_core.exceptions import PreconditionFailed
from google.cloud import bigquery, storage

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

gcs_client = storage.Client()
bq_client = bigquery.Client()

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID = os.environ.get("BQ_DATASET_ID", "hr_dataset")
JOBS_TABLE = f"{PROJECT_ID}.{DATASET_ID}.jobs"
BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME", "hr-data-source-at")
STAGING_BUCKET_NAME = os.environ.get("GCS_STAGING_BUCKET_NAME", "hr-data-staging-at")

MAX_FILES = 20
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB per resume
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$")

CAREERS_SOURCE = "careers_page"
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
PHONE_RE = re.compile(r"^\+\d{7,15}$")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
}


def _json(payload, code):
    return (json.dumps(payload), code, {**CORS_HEADERS, "Content-Type": "application/json"})


def _clean(value, limit=200):
    """Trim, drop control characters, cap length."""
    return re.sub(r"[\x00-\x1f\x7f]", " ", (value or "")).strip()[:limit]


def _digits(value, limit):
    return re.sub(r"\D", "", value or "")[:limit]


def _name_part(value):
    return re.sub(r"[^A-Za-z0-9]", "", value or "")[:20] or "applicant"


def _job_status(job_id):
    """Returns the job's status string, or None if the job doesn't exist."""
    cfg = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("job_id", "STRING", job_id)]
    )
    rows = list(
        bq_client.query(
            f"SELECT status FROM `{JOBS_TABLE}` WHERE job_id = @job_id LIMIT 1",
            job_config=cfg,
        ).result()
    )
    if not rows:
        return None
    return (rows[0].status or "").lower()


def _parse_applicant(form):
    """
    Validates the careers-page fields.
    Returns (stored_name, metadata, None) or (None, None, error_message).
    """
    first = _clean(form.get("first_name"), 60)
    middle = _clean(form.get("middle_name"), 60)
    last = _clean(form.get("last_name"), 60)
    email = _clean(form.get("email"), 120).lower()
    phone = _clean(form.get("phone"), 20).replace(" ", "")

    if not first or not last:
        return None, None, "First name and last name are required"
    if not EMAIL_RE.match(email):
        return None, None, "A valid email address is required"
    if not PHONE_RE.match(phone):
        return None, None, "A valid mobile number is required"
    if (form.get("consent") or "").strip().lower() != "true":
        return None, None, "Consent is required to process your application"

    now = datetime.now(timezone.utc).isoformat()
    meta = {
        "source": CAREERS_SOURCE,
        "applicant_first_name": first,
        "applicant_middle_name": middle,
        "applicant_last_name": last,
        "applicant_email": email,
        "applicant_phone": phone,
        "applicant_gender": _clean(form.get("gender"), 20),
        "applicant_exp_years": _digits(form.get("experience_years"), 2),
        "applicant_exp_months": _digits(form.get("experience_months"), 2),
        "applicant_salary_currency": _clean(form.get("salary_currency"), 5),
        "applicant_salary_amount": re.sub(r"[^\d.]", "", form.get("salary_amount") or "")[:15],
        "applicant_salary_freq": _clean(form.get("salary_freq"), 10),
        "applicant_cover_note": _clean(form.get("cover_note"), 1000),
        "consent": "true",
        "consent_at": now,
        "applied_at": now,
    }
    meta = {k: v for k, v in meta.items() if v}  # GCS drops empty values anyway

    # Same email + same job => same object name => duplicate detected on write
    email_hash = hashlib.sha256(email.encode()).hexdigest()[:10]
    stored_name = f"{_name_part(first)}_{_name_part(last)}_{email_hash}.pdf"
    return stored_name, meta, None


@functions_framework.http
def upload_resumes_http(request):
    # 1. CORS preflight
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)
    if request.method != "POST":
        return _json({"error": "Method not allowed"}, 405)

    try:
        job_id = (request.form.get("job_id") or "").strip()
        files = request.files.getlist("resumes")
        is_careers = (request.form.get("source") or "").strip() == CAREERS_SOURCE

        if not job_id or not files:
            return _json({"error": "Missing 'job_id' or 'resumes' in payload"}, 400)
        if not JOB_ID_RE.match(job_id):
            return _json({"error": "Invalid job_id"}, 400)
        if len(files) > MAX_FILES:
            return _json({"error": f"Too many files — upload at most {MAX_FILES} resumes at a time"}, 400)

        # Careers mode: exactly one resume + valid applicant details
        careers_name, careers_meta = None, None
        if is_careers:
            if len(files) != 1:
                return _json({"error": "Please upload exactly one resume"}, 400)
            careers_name, careers_meta, err = _parse_applicant(request.form)
            if err:
                return _json({"error": err}, 400)

        # 2. The job must exist (and not be archived) — otherwise resumes would pile up
        #    under a folder for a job that was deleted or never created.
        try:
            status = _job_status(job_id)
        except Exception as e:
            log.error("Job lookup failed for %s: %s", job_id, e, exc_info=True)
            status = "unknown"

        if is_careers:
            # Public applicants: strict. Never accept on a failed lookup or a non-active job.
            if status == "unknown":
                return _json({"error": "We could not process your application right now. Please try again."}, 503)
            if status != "active":
                return _json({"error": "This job is no longer accepting applications.", "code": "JOB_CLOSED"}, 410)
        else:
            if status is None:
                return _json({"error": f"Job '{job_id}' does not exist"}, 404)
            if status == "archived":
                return _json({"error": f"Job '{job_id}' is archived. Restore it before uploading resumes."}, 409)

        staging = gcs_client.bucket(STAGING_BUCKET_NAME)   # all uploads go here (no trigger)
        main    = gcs_client.bucket(BUCKET_NAME)           # only used to detect duplicates
        uploaded, skipped, renamed = [], [], []

        for f in files:
            original = f.filename or ""
            # Strip path separators / odd characters strictly
            clean_name = "".join(c for c in os.path.basename(original) if c.isalnum() or c in "._- ").strip()

            if not clean_name.lower().endswith(".pdf") or len(clean_name) <= 4:
                skipped.append({"name": original, "reason": "Not a PDF file"})
                continue

            # Size + real-PDF check
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(0)
            if size == 0:
                skipped.append({"name": original, "reason": "File is empty"})
                continue
            if size > MAX_FILE_BYTES:
                skipped.append({"name": original, "reason": "Larger than 10 MB"})
                continue
            if f.read(5) != b"%PDF-":
                skipped.append({"name": original, "reason": "Not a valid PDF"})
                continue
            f.seek(0)

            # ── Careers applicant: fixed name + metadata; a name clash = duplicate ──
            if is_careers:
                key = f"resumes/{job_id}/{careers_name}"
                dup_msg = {"error": "You have already applied for this job with this email address.",
                        "code": "ALREADY_APPLIED"}
                if main.blob(key).exists():            # already promoted earlier
                    return _json(dup_msg, 409)
                blob = staging.blob(key)
                blob.metadata = careers_meta
                try:
                    blob.upload_from_file(f, content_type="application/pdf", if_generation_match=0)
                except PreconditionFailed:             # already sitting in staging
                    return _json(dup_msg, 409)
                uploaded.append(careers_name)
                continue

            # ── HR upload (unchanged): never overwrite, rename on clash ──
            stem = clean_name[:-4]
            stored_name = clean_name
            for _ in range(5):
                f.seek(0)
                key = f"resumes/{job_id}/{stored_name}"
                blob = main.blob(key)                  # HR uploads go straight to the main bucket
                try:
                    blob.upload_from_file(f, content_type="application/pdf", if_generation_match=0)
                    break
                except PreconditionFailed:             # name already exists in main → rename
                    stored_name = f"{stem}_{uuid.uuid4().hex[:6]}.pdf"
            else:
                skipped.append({"name": original, "reason": "Could not store this file — please retry"})
                continue

            uploaded.append(stored_name)
            if stored_name != clean_name:
                renamed.append({"original": original, "stored": stored_name})

        log.info(
            "job=%s source=%s uploaded=%d skipped=%d -> gs://%s/resumes/%s/",
            job_id, "careers" if is_careers else "hr", len(uploaded), len(skipped),
            STAGING_BUCKET_NAME if is_careers else BUCKET_NAME, job_id,
        )

        if not uploaded:
            if is_careers:
                reason = skipped[0]["reason"] if skipped else "Invalid file"
                return _json({"error": f"{reason}. Please upload a valid PDF resume (up to 10 MB)."}, 400)
            reasons = "; ".join(f"{s['name']}: {s['reason']}" for s in skipped) or "No valid files"
            return _json({"error": f"No resumes were uploaded. {reasons}", "skipped": skipped}, 400)

        return _json(
            {
                "success": True,
                "job_id": job_id,
                "count": len(uploaded),
                "files": uploaded,
                "skipped": skipped,
                "renamed": renamed,
                "application_id": f"{job_id}/{uploaded[0]}",
            },
            200,
        )

    except Exception as e:
        log.error("Upload bridge threw exception: %s", str(e), exc_info=True)
        return _json({"error": str(e)}, 500)