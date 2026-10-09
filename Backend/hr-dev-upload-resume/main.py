"""
hr-dev-resume-uploader  —  Cloud Function (HTTP)
────────────────────────────────────────────────
React UI  →  this function  →  GCS  →  Eventarc trigger (automated screening flow)

Resumes are stored at   gs://<bucket>/resumes/{job_id}/{file}.pdf

About "folders": GCS has no real folders. The path prefix resumes/{job_id}/ is
created automatically by the first object written under it, and an existing
prefix is simply reused — so there is nothing to create or skip explicitly.

Checks before anything is written:
  • job_id is well-formed (it becomes part of the object path)
  • the job exists in BigQuery and is not archived
  • each file is a real PDF, <= 10 MB; max 20 files per request
  • NOTHING valid is skipped: every PDF is stored. If a file with the same name is
    already in the folder it is never overwritten — it is saved under a unique name
    (name_ab12cd.pdf). De-duplication happens later in the screening pipeline.
"""

import json
import logging
import os
import re
import uuid

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

MAX_FILES = 20
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB per resume
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
}


def _json(payload, code):
    return (json.dumps(payload), code, {**CORS_HEADERS, "Content-Type": "application/json"})


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

        if not job_id or not files:
            return _json({"error": "Missing 'job_id' or 'resumes' in payload"}, 400)
        if not JOB_ID_RE.match(job_id):
            return _json({"error": "Invalid job_id"}, 400)
        if len(files) > MAX_FILES:
            return _json({"error": f"Too many files — upload at most {MAX_FILES} resumes at a time"}, 400)

        # 2. The job must exist (and not be archived) — otherwise resumes would pile up
        #    under a folder for a job that was deleted or never created.
        try:
            status = _job_status(job_id)
        except Exception as e:
            # Don't block uploads because the lookup failed — log it and continue
            log.error("Job lookup failed for %s: %s", job_id, e, exc_info=True)
            status = "unknown"
        if status is None:
            return _json({"error": f"Job '{job_id}' does not exist"}, 404)
        if status == "archived":
            return _json({"error": f"Job '{job_id}' is archived. Restore it before uploading resumes."}, 409)

        bucket = gcs_client.bucket(BUCKET_NAME)
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

            # resumes/{job_id}/{file}.pdf — the "folder" appears with the first upload.
            # Every valid resume is stored. If the name is already taken we never
            # overwrite it — we store this one under a unique name instead.
            stem = clean_name[:-4]
            stored_name = clean_name
            for _ in range(5):
                f.seek(0)
                blob = bucket.blob(f"resumes/{job_id}/{stored_name}")
                try:
                    # if_generation_match=0  →  create only if this exact name isn't there yet
                    blob.upload_from_file(f, content_type="application/pdf", if_generation_match=0)
                    break
                except PreconditionFailed:
                    stored_name = f"{stem}_{uuid.uuid4().hex[:6]}.pdf"
            else:
                skipped.append({"name": original, "reason": "Could not store this file — please retry"})
                continue

            uploaded.append(stored_name)
            if stored_name != clean_name:
                renamed.append({"original": original, "stored": stored_name})

        log.info(
            "job=%s uploaded=%d skipped=%d -> gs://%s/resumes/%s/",
            job_id, len(uploaded), len(skipped), BUCKET_NAME, job_id,
        )

        if not uploaded:
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
            },
            200,
        )

    except Exception as e:
        log.error("Upload bridge threw exception: %s", str(e), exc_info=True)
        return _json({"error": str(e)}, 500)