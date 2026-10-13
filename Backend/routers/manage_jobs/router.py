import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from google.api_core.exceptions import PreconditionFailed
from google.cloud import bigquery

from bigquery_client import bq_client
from config import BUCKET_NAME, DATASET_ID, PROJECT_ID
from gcs_client import gcs_client
from shared.jd_processing import _process_jd_to_row

router = APIRouter(prefix="/api/manage-jobs", tags=["Manage Jobs"])

JOBS_TABLE = f"{PROJECT_ID}.{DATASET_ID}.jobs"
USERS_TABLE = f"{PROJECT_ID}.{DATASET_ID}.users"
CANDIDATES_TABLE = f"{PROJECT_ID}.{DATASET_ID}.candidates"

JD_FOLDER = "jd"
MAX_JD_BYTES = 10 * 1024 * 1024  # 10 MB
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$")

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

def _param(name: str, value: Any, bq_type: str):
    return bigquery.ScalarQueryParameter(name, bq_type, value)


def _is_active_hr(email: Optional[str]) -> bool:
    if not email:
        return False
    query = f"SELECT status, roles FROM `{USERS_TABLE}` WHERE email = @email LIMIT 1"
    cfg = bigquery.QueryJobConfig(query_parameters=[_param("email", email, "STRING")])
    rows = list(bq_client.query(query, job_config=cfg).result())
    if not rows or rows[0].status != "active":
        return False
    roles = [r.strip() for r in (rows[0].roles or "").split(",")]
    return "hr" in roles


def _get_job(job_id: str):
    query = f"SELECT * FROM `{JOBS_TABLE}` WHERE job_id = @job_id LIMIT 1"
    cfg = bigquery.QueryJobConfig(query_parameters=[_param("job_id", job_id, "STRING")])
    rows = list(bq_client.query(query, job_config=cfg).result())
    return rows[0] if rows else None


def _normalize_skills(value: Any) -> str:
    if isinstance(value, list):
        items = value
    else:
        items = str(value or "").split(",")
    cleaned = [s.strip() for s in items if s and s.strip()]
    return ",".join(cleaned)


def _split_skills(value: Optional[str]) -> List[str]:
    return [s.strip() for s in (value or "").split(",") if s.strip()]


def _clean_fields(body: Dict[str, Any]):
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

def _list_jobs(include_archived: bool):
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
    return {"success": True, "total": len(jobs), "jobs": jobs}


async def _create_job_from_pdf(job_id: str, designation: Optional[str], upload: UploadFile, requester_email: Optional[str]):
    job_id = (job_id or "").strip()
    designation = (designation or "").strip()

    if not job_id:
        raise HTTPException(status_code=400, detail="Job ID is required")
    if not JOB_ID_RE.match(job_id):
        raise HTTPException(
            status_code=400,
            detail="Job ID can only contain letters, numbers, '-' and '_' (2-64 characters)"
        )
    if upload is None or not upload.filename:
        raise HTTPException(status_code=400, detail="JD file (PDF) is required")
    if not upload.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    pdf_bytes = await upload.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    if len(pdf_bytes) > MAX_JD_BYTES:
        raise HTTPException(status_code=413, detail="File is too large (max 10 MB)")
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="This does not look like a valid PDF")

    if _get_job(job_id):
        raise HTTPException(status_code=409, detail=f"Job ID '{job_id}' already exists")

    jd_path = f"{JD_FOLDER}/{job_id}/{job_id}.pdf"
    blob = gcs_client.bucket(BUCKET_NAME).blob(jd_path)
    try:
        blob.upload_from_string(
            pdf_bytes,
            content_type="application/pdf",
            if_generation_match=0,
        )
    except PreconditionFailed:
        raise HTTPException(status_code=409, detail=f"Job ID '{job_id}' already exists")

    row = _process_jd_to_row(jd_path)
    if not row:
        try:
            blob.delete()
        except Exception:
            pass
        raise HTTPException(
            status_code=422,
            detail="Could not process this JD. Make sure the PDF has selectable text (not a scanned image) and try again."
        )

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
    except Exception:
        pass

    return {"success": True, "job_id": job_id}


def _update_job(body: Dict[str, Any]):
    job_id = body.get("job_id")
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")

    existing = _get_job(job_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")

    fields, err = _clean_fields(body)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if not fields:
        raise HTTPException(status_code=400, detail="No editable fields provided")

    for key in ("title", "description", "must_have_skills"):
        if key in fields and not fields[key]:
            raise HTTPException(status_code=400, detail=f"{key} cannot be empty")

    new_min = fields.get("experience_min", existing.experience_min)
    new_max = fields.get("experience_max", existing.experience_max)
    if new_min is not None and new_max is not None and new_min > new_max:
        raise HTTPException(status_code=400, detail="experience_min cannot be greater than experience_max")

    set_clause = ", ".join(f"{k} = @{k}" for k in fields)
    params = [_param(k, v, EDITABLE_FIELDS[k]) for k, v in fields.items()]
    params.append(_param("job_id", job_id, "STRING"))

    query = f"UPDATE `{JOBS_TABLE}` SET {set_clause} WHERE job_id = @job_id"
    bq_client.query(query, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
    return {"success": True}


def _set_job_status(job_id: Optional[str], new_status: str):
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")
    if not _get_job(job_id):
        raise HTTPException(status_code=404, detail="Job not found")

    query = f"UPDATE `{JOBS_TABLE}` SET status = @status WHERE job_id = @job_id"
    cfg = bigquery.QueryJobConfig(query_parameters=[
        _param("status", new_status, "STRING"),
        _param("job_id", job_id, "STRING"),
    ])
    bq_client.query(query, job_config=cfg).result()
    return {"success": True}


def _delete_job(job_id: Optional[str]):
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")

    existing = _get_job(job_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    if getattr(existing, "pipeline_status", None) == "RUNNING":
        raise HTTPException(
            status_code=409,
            detail="Screening is running for this job. Wait for it to finish, then delete."
        )

    bucket = gcs_client.bucket(BUCKET_NAME)
    for folder in (JD_FOLDER, "resumes", "resumes_failed"):
        for blob in bucket.list_blobs(prefix=f"{folder}/{job_id}/"):
            blob.delete()

    cfg = bigquery.QueryJobConfig(query_parameters=[_param("job_id", job_id, "STRING")])
    bq_client.query(
        f"DELETE FROM `{CANDIDATES_TABLE}` WHERE job_id = @job_id",
        job_config=cfg,
    ).result()
    bq_client.query(f"DELETE FROM `{JOBS_TABLE}` WHERE job_id = @job_id", job_config=cfg).result()
    return {"success": True}


# ── Endpoint Entrypoint (Handles both multipart & JSON) ─────────────────────────

@router.post("")
async def manage_jobs_endpoint(
    request: Request,
    job_id: Optional[str] = Form(None),
    designation: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    requester_email: Optional[str] = Form(None),
    type: Optional[str] = Form(None),
):
    content_type = request.headers.get("content-type", "")
    is_multipart = content_type.startswith("multipart/form-data")

    if is_multipart:
        action = type
        email = requester_email
        body = {}
    else:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")
        action = body.get("type")
        email = body.get("requester_email")

    if not _is_active_hr(email):
        raise HTTPException(status_code=403, detail="Forbidden — HR access required")

    if action == "LIST_JOBS":
        include_archived = str(body.get("include_archived", True)).lower() != "false"
        return _list_jobs(include_archived)

    elif action == "CREATE_JOB":
        if not is_multipart:
            raise HTTPException(
                status_code=400,
                detail="CREATE_JOB must be sent as multipart/form-data with a PDF file"
            )
        return await _create_job_from_pdf(job_id, designation, file, email)

    elif action == "UPDATE_JOB":
        return _update_job(body)

    elif action == "ARCHIVE_JOB":
        return _set_job_status(body.get("job_id"), "archived")

    elif action == "RESTORE_JOB":
        return _set_job_status(body.get("job_id"), "closed")

    elif action == "DELETE_JOB":
        return _delete_job(body.get("job_id"))

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action type: {action}")