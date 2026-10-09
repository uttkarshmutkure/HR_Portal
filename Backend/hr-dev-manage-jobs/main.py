"""
hr-dev-manage-jobs  —  Cloud Function (HTTP)
────────────────────────────────────────────
Admin API for jobs. Access is restricted to active users with the 'hr' role
(checked server-side against the users table).

Actions (body field "type"):
  CREATE_JOB   multipart/form-data  →  job_id (required), designation (optional),
                                       file (PDF, required), requester_email
               Saves the JD PDF to  gs://<bucket>/jd/{job_id}/{job_id}.pdf
               then runs the normal jd_processing pipeline
               (text → Gemini fields → embedding → MERGE into jobs).
               Same path the automated resume flow (ensure_job_exists) expects.
  LIST_JOBS    JSON
  UPDATE_JOB   JSON
  ARCHIVE_JOB  JSON   (legacy — kept so old archived jobs still work)
  RESTORE_JOB  JSON
  DELETE_JOB   JSON   permanently removes the job (see _delete_job)
"""

import os
import re

import functions_framework
from google.api_core.exceptions import PreconditionFailed
from google.cloud import bigquery, storage

bq_client = bigquery.Client()
storage_client = storage.Client()

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID = os.environ.get("BQ_DATASET_ID", "hr_dataset")
JOBS_TABLE = f"{PROJECT_ID}.{DATASET_ID}.jobs"
USERS_TABLE = f"{PROJECT_ID}.{DATASET_ID}.users"

# JD storage — must match jd_processing.py (BUCKET_NAME / FOLDER_PATH)
# and the path used by the automated flow: jd/{job_id}/{job_id}.pdf
BUCKET_NAME = os.environ.get("JD_BUCKET", "hr-data-source-at")
JD_FOLDER = "jd"
MAX_JD_BYTES = 10 * 1024 * 1024  # 10 MB
# job_id becomes a folder name in GCS, so keep it safe
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$")

CORS_HEADERS = {"Access-Control-Allow-Origin": "*"}

# Columns an admin is allowed to edit, with their BigQuery types.
EDITABLE_FIELDS = {
    "title": "STRING",
    "description": "STRING",
    "must_have_skills": "STRING",
    "preferred_skills": "STRING",
    "experience_min": "INT64",
    "experience_max": "INT64",
    "location": "STRING",
    "recruiter_email": "STRING",
}
SKILL_FIELDS = ("must_have_skills", "preferred_skills")
INT_FIELDS = ("experience_min", "experience_max")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cors_preflight():
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
    }
    return ("", 204, headers)


def _param(name, value, bq_type):
    return bigquery.ScalarQueryParameter(name, bq_type, value)


def _is_active_hr(email):
    """Server-side authorization — never trust the caller's claimed role."""
    if not email:
        return False
    query = f"SELECT status, roles FROM `{USERS_TABLE}` WHERE email = @email LIMIT 1"
    cfg = bigquery.QueryJobConfig(query_parameters=[_param("email", email, "STRING")])
    rows = list(bq_client.query(query, job_config=cfg).result())
    if not rows or rows[0].status != "active":
        return False
    roles = [r.strip() for r in (rows[0].roles or "").split(",")]
    return "hr" in roles


def _get_job(job_id):
    query = f"SELECT * FROM `{JOBS_TABLE}` WHERE job_id = @job_id LIMIT 1"
    cfg = bigquery.QueryJobConfig(query_parameters=[_param("job_id", job_id, "STRING")])
    rows = list(bq_client.query(query, job_config=cfg).result())
    return rows[0] if rows else None


def _normalize_skills(value):
    """Accepts a list or a comma-separated string; stores a comma-separated string."""
    if isinstance(value, list):
        items = value
    else:
        items = str(value or "").split(",")
    cleaned = [s.strip() for s in items if s and s.strip()]
    return ",".join(cleaned)


def _split_skills(value):
    return [s.strip() for s in (value or "").split(",") if s.strip()]


def _clean_fields(body):
    """Pull editable fields out of the payload and normalize them. Returns (fields, error)."""
    fields = {}
    for key in EDITABLE_FIELDS:
        if key not in body:
            continue
        val = body[key]
        if key in SKILL_FIELDS:
            val = _normalize_skills(val)
        elif key in INT_FIELDS:
            try:
                val = int(val)
            except (TypeError, ValueError):
                return None, f"{key} must be a whole number"
            if val < 0:
                return None, f"{key} cannot be negative"
        else:
            val = str(val).strip() if val is not None else None
        fields[key] = val
    return fields, None


# ── Actions ───────────────────────────────────────────────────────────────────

def _list_jobs(include_archived):
    where = "" if include_archived else "WHERE COALESCE(status, '') != 'archived'"
    query = f"""
        SELECT job_id, title, description, must_have_skills, preferred_skills,
               experience_min, experience_max, location, recruiter_email, status,
               created_at, pipeline_status, pipeline_error, pipeline_ran_at
        FROM `{JOBS_TABLE}`
        {where}
        ORDER BY created_at DESC
    """
    jobs = []
    for r in bq_client.query(query).result():
        jobs.append({
            "job_id": r.job_id,
            "title": r.title,
            "description": r.description,
            "must_have_skills": _split_skills(r.must_have_skills),
            "preferred_skills": _split_skills(r.preferred_skills),
            "experience_min": r.experience_min,
            "experience_max": r.experience_max,
            "location": r.location,
            "recruiter_email": r.recruiter_email,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "pipeline_status": r.pipeline_status,
            "pipeline_error": r.pipeline_error,
            "pipeline_ran_at": r.pipeline_ran_at.isoformat() if r.pipeline_ran_at else None,
        })
    return ({"success": True, "total": len(jobs), "jobs": jobs}, 200)


def _create_job_from_pdf(form, files, requester_email):
    """
    UI sends only: job_id (required), designation (optional), PDF file.
    Everything else (skills, experience, location, embedding...) comes from
    the existing jd_processing pipeline.
    """
    job_id = (form.get("job_id") or "").strip()
    designation = (form.get("designation") or "").strip()
    upload = files.get("file")

    # ── Validation ────────────────────────────────────────────────────────────
    if not job_id:
        return ({"success": False, "error": "Job ID is required"}, 400)
    if not JOB_ID_RE.match(job_id):
        return ({"success": False,
                 "error": "Job ID can only contain letters, numbers, '-' and '_' (2-64 characters)"}, 400)
    if upload is None or not upload.filename:
        return ({"success": False, "error": "JD file (PDF) is required"}, 400)
    if not upload.filename.lower().endswith(".pdf"):
        return ({"success": False, "error": "Only PDF files are supported"}, 400)

    pdf_bytes = upload.read()
    if not pdf_bytes:
        return ({"success": False, "error": "The uploaded file is empty"}, 400)
    if len(pdf_bytes) > MAX_JD_BYTES:
        return ({"success": False, "error": "File is too large (max 10 MB)"}, 413)
    if not pdf_bytes.startswith(b"%PDF"):
        return ({"success": False, "error": "This does not look like a valid PDF"}, 400)

    # ── Duplicate check #1: job already in BigQuery ───────────────────────────
    if _get_job(job_id):
        return ({"success": False, "error": f"Job ID '{job_id}' already exists"}, 409)

    # ── Save the JD where the automated flow expects it ───────────────────────
    # if_generation_match=0 → atomic "create only if it doesn't exist"
    # (duplicate check #2: protects against double-click / parallel requests)
    jd_path = f"{JD_FOLDER}/{job_id}/{job_id}.pdf"
    blob = storage_client.bucket(BUCKET_NAME).blob(jd_path)
    try:
        blob.upload_from_string(
            pdf_bytes,
            content_type="application/pdf",
            if_generation_match=0,
        )
    except PreconditionFailed:
        return ({"success": False, "error": f"Job ID '{job_id}' already exists"}, 409)

    # ── Run the normal JD pipeline ────────────────────────────────────────────
    # text → Gemini field extraction → embedding → MERGE into jobs (status=active)
    # Lazy import: jd_processing initialises Vertex AI clients at import time.
    from jd_processing import _process_jd_to_row

    row = _process_jd_to_row(jd_path)
    if not row:
        # Roll back the upload so the same Job ID can be used again
        try:
            blob.delete()
        except Exception as e:
            print(f"Could not roll back {jd_path}: {e}")
        return ({
            "success": False,
            "error": "Could not process this JD. Make sure the PDF has selectable text "
                     "(not a scanned image) and try again.",
        }, 422)

    # ── Designation from the UI overrides the Gemini-extracted title ──────────
    # recruiter_email falls back to the logged-in HR if the JD had none.
    try:
        cfg = bigquery.QueryJobConfig(query_parameters=[
            _param("title", designation or row.get("title") or "", "STRING"),
            _param("fallback_email", requester_email or "", "STRING"),
            _param("job_id", job_id, "STRING"),
        ])
        bq_client.query(f"""
            UPDATE `{JOBS_TABLE}`
            SET title = @title,
                recruiter_email = IF(COALESCE(recruiter_email, '') = '',
                                     @fallback_email, recruiter_email)
            WHERE job_id = @job_id
        """, job_config=cfg).result()
    except Exception as e:
        # Job is already created and usable — don't fail the whole request
        print(f"Post-create title/email update failed for {job_id}: {e}")

    return ({"success": True, "job_id": job_id}, 200)


def _update_job(body):
    job_id = body.get("job_id")
    if not job_id:
        return ({"success": False, "error": "job_id is required"}, 400)

    existing = _get_job(job_id)
    if not existing:
        return ({"success": False, "error": "Job not found"}, 404)

    fields, err = _clean_fields(body)
    if err:
        return ({"success": False, "error": err}, 400)
    if not fields:
        return ({"success": False, "error": "No editable fields provided"}, 400)

    for key in ("title", "description", "must_have_skills"):
        if key in fields and not fields[key]:
            return ({"success": False, "error": f"{key} cannot be empty"}, 400)

    new_min = fields.get("experience_min", existing.experience_min)
    new_max = fields.get("experience_max", existing.experience_max)
    if new_min is not None and new_max is not None and new_min > new_max:
        return ({"success": False, "error": "experience_min cannot be greater than experience_max"}, 400)

    set_clause = ", ".join(f"{k} = @{k}" for k in fields)
    params = [_param(k, v, EDITABLE_FIELDS[k]) for k, v in fields.items()]
    params.append(_param("job_id", job_id, "STRING"))

    query = f"UPDATE `{JOBS_TABLE}` SET {set_clause} WHERE job_id = @job_id"
    bq_client.query(query, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
    return ({"success": True}, 200)


def _set_job_status(job_id, new_status):
    if not job_id:
        return ({"success": False, "error": "job_id is required"}, 400)
    if not _get_job(job_id):
        return ({"success": False, "error": "Job not found"}, 404)

    query = f"UPDATE `{JOBS_TABLE}` SET status = @status WHERE job_id = @job_id"
    cfg = bigquery.QueryJobConfig(query_parameters=[
        _param("status", new_status, "STRING"),
        _param("job_id", job_id, "STRING"),
    ])
    bq_client.query(query, job_config=cfg).result()
    return ({"success": True}, 200)


def _delete_job(job_id):
    """
    Permanently deletes a job:
      1. GCS files: jd/{job_id}/, resumes/{job_id}/, resumes_failed/{job_id}/
         (done FIRST — if a JD PDF were left behind, the automated resume flow
          would silently re-create the job from it, and the Job ID couldn't be reused)
      2. BigQuery: candidates rows for this job, then the jobs row
    Refused while the screening pipeline is running for this job.
    """
    if not job_id:
        return ({"success": False, "error": "job_id is required"}, 400)

    existing = _get_job(job_id)
    if not existing:
        return ({"success": False, "error": "Job not found"}, 404)
    if getattr(existing, "pipeline_status", None) == "RUNNING":
        return ({"success": False,
                 "error": "Screening is running for this job. Wait for it to finish, then delete."}, 409)

    bucket = storage_client.bucket(BUCKET_NAME)
    for folder in (JD_FOLDER, "resumes", "resumes_failed"):
        for blob in bucket.list_blobs(prefix=f"{folder}/{job_id}/"):   # trailing "/" so job-1 never matches job-10
            blob.delete()

    cfg = bigquery.QueryJobConfig(query_parameters=[_param("job_id", job_id, "STRING")])
    bq_client.query(
        f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.candidates` WHERE job_id = @job_id",
        job_config=cfg,
    ).result()
    bq_client.query(f"DELETE FROM `{JOBS_TABLE}` WHERE job_id = @job_id", job_config=cfg).result()
    return ({"success": True}, 200)


# ── Entry point ───────────────────────────────────────────────────────────────

@functions_framework.http
def manage_jobs(request):
    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "POST":
        return ({"success": False, "error": "Method not allowed"}, 405, CORS_HEADERS)

    try:
        # CREATE_JOB arrives as multipart/form-data (file upload); everything else is JSON
        is_multipart = (request.content_type or "").startswith("multipart/form-data")
        body = request.form.to_dict() if is_multipart else request.get_json(silent=True)
        if not body:
            return ({"success": False, "error": "Invalid request payload"}, 400, CORS_HEADERS)

        action = body.get("type")
        requester_email = body.get("requester_email")

        if not _is_active_hr(requester_email):
            return ({"success": False, "error": "Forbidden — HR access required"}, 403, CORS_HEADERS)

        if action == "LIST_JOBS":
            result, code = _list_jobs(str(body.get("include_archived", True)).lower() != "false")
        elif action == "CREATE_JOB":
            if not is_multipart:
                result, code = ({
                    "success": False,
                    "error": "CREATE_JOB must be sent as multipart/form-data with a PDF file",
                }, 400)
            else:
                result, code = _create_job_from_pdf(request.form, request.files, requester_email)
        elif action == "UPDATE_JOB":
            result, code = _update_job(body)
        elif action == "ARCHIVE_JOB":
            result, code = _set_job_status(body.get("job_id"), "archived")
        elif action == "DELETE_JOB":
            result, code = _delete_job(body.get("job_id"))
        elif action == "RESTORE_JOB":
            # Restores to 'closed', not 'active', so restoring never silently reopens hiring.
            result, code = _set_job_status(body.get("job_id"), "closed")
        else:
            result, code = ({"success": False, "error": f"Unknown action type: {action}"}, 400)

        return (result, code, CORS_HEADERS)

    except Exception as e:
        print(f"Error in manage_jobs: {e}")
        return ({"success": False, "error": str(e)}, 500, CORS_HEADERS)