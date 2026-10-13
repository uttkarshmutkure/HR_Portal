import logging
import os
import re
import uuid
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from google.api_core.exceptions import PreconditionFailed
from google.cloud import bigquery

from bigquery_client import bq_client
from config import BUCKET_NAME, DATASET_ID, PROJECT_ID
from gcs_client import gcs_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/resume_uploader", tags=["Resume Uploader"])

JOBS_TABLE = f"{PROJECT_ID}.{DATASET_ID}.jobs"
MAX_FILES = 20
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB per resume
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$")


def _job_status(job_id: str):
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


@router.post("/upload")
async def upload_resumes(
    job_id: str = Form(...),
    resumes: List[UploadFile] = File(...),
):
    job_id = (job_id or "").strip()
    if not job_id or not resumes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing 'job_id' or 'resumes' in payload",
        )

    if not JOB_ID_RE.match(job_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid job_id",
        )

    if len(resumes) > MAX_FILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many files — upload at most {MAX_FILES} resumes at a time",
        )

    # 1. Job existence & status check
    try:
        status_val = _job_status(job_id)
    except Exception as e:
        log.error("Job lookup failed for %s: %s", job_id, e, exc_info=True)
        status_val = "unknown"

    if status_val is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' does not exist",
        )
    if status_val == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Job '{job_id}' is archived. Restore it before uploading resumes.",
        )

    # 2. Upload resumes to GCS bucket under resumes/{job_id}/
    bucket = gcs_client.bucket(BUCKET_NAME)
    uploaded = []
    skipped = []
    renamed = []

    for f in resumes:
        original = f.filename or ""
        clean_name = "".join(
            c for c in os.path.basename(original) if c.isalnum() or c in "._- "
        ).strip()

        if not clean_name.lower().endswith(".pdf") or len(clean_name) <= 4:
            skipped.append({"name": original, "reason": "Not a PDF file"})
            continue

        contents = await f.read()
        size = len(contents)

        if size == 0:
            skipped.append({"name": original, "reason": "File is empty"})
            continue
        if size > MAX_FILE_BYTES:
            skipped.append({"name": original, "reason": "Larger than 10 MB"})
            continue
        if not contents.startswith(b"%PDF-"):
            skipped.append({"name": original, "reason": "Not a valid PDF"})
            continue

        stem = clean_name[:-4]
        stored_name = clean_name

        # Prevent overwriting existing files
        for _ in range(5):
            blob = bucket.blob(f"resumes/{job_id}/{stored_name}")
            try:
                blob.upload_from_string(
                    contents,
                    content_type="application/pdf",
                    if_generation_match=0,
                )
                break
            except PreconditionFailed:
                stored_name = f"{stem}_{uuid.uuid4().hex[:6]}.pdf"
        else:
            skipped.append(
                {"name": original, "reason": "Could not store this file — please retry"}
            )
            continue

        uploaded.append(stored_name)
        if stored_name != clean_name:
            renamed.append({"original": original, "stored": stored_name})

    log.info(
        "job=%s uploaded=%d skipped=%d -> gs://%s/resumes/%s/",
        job_id,
        len(uploaded),
        len(skipped),
        BUCKET_NAME,
        job_id,
    )

    if not uploaded:
        reasons = "; ".join(f"{s['name']}: {s['reason']}" for s in skipped) or "No valid files"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": f"No resumes were uploaded. {reasons}", "skipped": skipped},
        )

    return {
        "success": True,
        "job_id": job_id,
        "count": len(uploaded),
        "files": uploaded,
        "skipped": skipped,
        "renamed": renamed,
    }