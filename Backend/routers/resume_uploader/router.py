"""
resume_uploader — FastAPI route, mirrors the old `hr-dev-upload-resume`
Cloud Function (upload_resumes_http). Handles multipart form uploads instead
of JSON, so it uses FastAPI's Form/File/UploadFile instead of request.json().
"""

import logging

from fastapi import APIRouter, Form, UploadFile, File
from fastapi.responses import JSONResponse

import config
from gcs_client import gcs_client

log = logging.getLogger(__name__)

router = APIRouter()

BUCKET_NAME = config.GCS_BUCKET_NAME


@router.post("/api/resume-uploader")
async def upload_resumes(job_id: str = Form(...), resumes: list[UploadFile] = File(...)):
    if not job_id or not resumes:
        return JSONResponse({"error": "Missing 'job_id' or 'resumes' in payload"}, status_code=400)

    try:
        bucket = gcs_client.bucket(BUCKET_NAME)

        uploaded_files = []
        for f in resumes:
            if not f.filename.lower().endswith(".pdf"):
                continue

            # Strip malicious pathing characters strictly
            clean_name = "".join(c for c in f.filename if c.isalnum() or c in "._- ")

            # TARGET PATH: resume/{job_id}/{clean_name}
            blob = bucket.blob(f"resume/{job_id}/{clean_name}")

            contents = await f.read()
            blob.upload_from_string(contents, content_type="application/pdf")
            uploaded_files.append(clean_name)

        log.info(
            "Uploaded %d resumes to gs://%s/resume/%s/",
            len(uploaded_files),
            BUCKET_NAME,
            job_id,
        )

        return JSONResponse({
            "success": True,
            "job_id": job_id,
            "count": len(uploaded_files),
            "files": uploaded_files,
        })

    except Exception as e:
        log.error("Upload bridge threw exception: %s", str(e), exc_info=True)
        return JSONResponse({"error": str(e)}, status_code=500)