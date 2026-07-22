"""
GCS Resume Trigger — Cloud Function (Eventarc / GCS trigger)
─────────────────────────────────────────────────────────────
Fires automatically whenever a PDF is finalized (uploaded) into
  resumes/{job_id}/*.pdf  inside your bucket.

Flow per trigger invocation:
  1. Parse path → validate job_id (JIT JD processing if needed)
  2. Process this one resume → insert into BQ (PENDING)
       • ValueError (no text / unreadable PDF) → move to resumes_failed/ → return
       • Exception  (transient error)          → re-raise so GCS retries
  3. Count PDFs in GCS vs PENDING rows in BQ for this job
       • Not equal → return early, more resumes still coming
       • Equal     → all resumes are in BQ, run the full pipeline ONCE
  4. run_pipeline() — BQ buffer wait is handled inside pipeline via smart poll
  5. Update BQ statuses (buffer already clear by the time pipeline reaches it)
  6. Save result to screening API (best-effort, short timeout)
"""

import os
import json
import logging
import requests
import functions_framework
from google.cloud import bigquery, storage
 
from resume_processing import process_resume_from_gcs
from FullPipeline     import run_pipeline
from jd_processing    import _process_jd_to_row
 
# ── CONFIG ────────────────────────────────────────────────────────────────────
 
log = logging.getLogger(__name__)
 
PROJECT_ID        = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID        = os.environ.get("BQ_DATASET_ID",        "hr_dataset")
SCREENING_API_URL = os.environ.get(
    "SCREENING_API_URL",
    "https://wb-gateway-7xpbhfkr.an.gateway.dev/hr-screening/candidate-screening",
)
 
TOP_K = 30
TOP_N = 5
 
# ── CORS HEADERS (used by HTTP endpoint only) ─────────────────────────────────
 
CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age":       "3600",
    "Content-Type":                 "application/json",
}
 
# ── CLIENTS ───────────────────────────────────────────────────────────────────
 
bq_client  = bigquery.Client(project=PROJECT_ID)
gcs_client = storage.Client(project=PROJECT_ID)
 
 
# ── HELPER: Count PDFs in GCS for this job ────────────────────────────────────
 
def count_pdfs_in_gcs(bucket_name: str, job_id: str) -> int:
    bucket = gcs_client.bucket(bucket_name)
    prefix = f"resumes/{job_id}/"
    blobs  = bucket.list_blobs(prefix=prefix)
    count  = sum(1 for b in blobs if b.name.lower().endswith(".pdf"))
    log.info("GCS PDF count for job=%s: %d", job_id, count)
    return count
 
 
# ── HELPER: Count PENDING candidate rows in BQ for this job ──────────────────
 
def count_pending_in_bq(job_id: str) -> int:
    query = f"""
        SELECT COUNT(*) AS cnt
        FROM `{PROJECT_ID}.{DATASET_ID}.candidates`
        WHERE job_id          = @job_id
          AND screening_status = 'PENDING'
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("job_id", "STRING", job_id)
        ]
    )
    rows  = list(bq_client.query(query, job_config=job_config).result())
    count = int(rows[0].cnt) if rows else 0
    log.info("BQ PENDING count for job=%s: %d", job_id, count)
    return count
 
 
# ── HELPER: Check job exists or process JD just-in-time ──────────────────────
 
def ensure_job_exists(bucket_name: str, job_id: str) -> bool:
    import time

    # ── Fast path: JD already in BQ ──────────────────────────────────────
    job_query = f"""
        SELECT 1 FROM `{PROJECT_ID}.{DATASET_ID}.jobs`
        WHERE job_id = @job_id LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("job_id", "STRING", job_id)
    ])
    if list(bq_client.query(job_query, job_config=job_config).result()):
        return True

    log.warning("job_id '%s' not in BQ. Checking GCS for JD...", job_id)
    jd_path    = f"jd/{job_id}/{job_id}.pdf"
    bucket_obj = gcs_client.bucket(bucket_name)

    if not bucket_obj.blob(jd_path).exists():
        log.error("JD not found at gs://%s/%s", bucket_name, jd_path)
        return False

    # ── Process JD ───────────────────────────────────────────────────────
    log.info("JD found — processing JIT for job_id=%s", job_id)
    try:
        jd_row = _process_jd_to_row(jd_path)
        if not jd_row:
            log.error("JD processing returned no row for %s", jd_path)
            return False

        r           = jd_row
        emb_literal = "[" + ", ".join(
            str(float(x)) for x in (r.get("jd_embedding") or [])
        ) + "]"

        # ── MERGE as atomic insert — only one instance wins ───────────────
        # If job_id already exists (inserted by another concurrent trigger),
        # MERGE does nothing and returns num_dml_affected_rows = 0.
        # Both outcomes are safe — JD is in BQ either way.
        merge_query = f"""
            MERGE `{PROJECT_ID}.{DATASET_ID}.jobs` AS target
            USING (SELECT @job_id AS job_id) AS source
            ON target.job_id = source.job_id
            WHEN NOT MATCHED THEN
              INSERT (job_id, title, description, must_have_skills, preferred_skills,
                      experience_min, experience_max, location,
                      jd_embedding, recruiter_email, status, created_at)
              VALUES (@job_id, @title, @description, @must_have_skills, @preferred_skills,
                      @experience_min, @experience_max, @location,
                      {emb_literal}, @recruiter_email, @status, @created_at)
        """
        merge_config = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("job_id",           "STRING",    r.get("job_id")           or ""),
            bigquery.ScalarQueryParameter("title",            "STRING",    r.get("title")            or ""),
            bigquery.ScalarQueryParameter("description",      "STRING",    r.get("description")      or ""),
            bigquery.ScalarQueryParameter("must_have_skills", "STRING",    r.get("must_have_skills") or ""),
            bigquery.ScalarQueryParameter("preferred_skills", "STRING",    r.get("preferred_skills") or ""),
            bigquery.ScalarQueryParameter("experience_min",   "INT64",     int(r.get("experience_min") or 0)),
            bigquery.ScalarQueryParameter("experience_max",   "INT64",     int(r.get("experience_max") or 0)),
            bigquery.ScalarQueryParameter("location",         "STRING",    r.get("location")         or ""),
            bigquery.ScalarQueryParameter("recruiter_email",  "STRING",    r.get("recruiter_email")  or ""),
            bigquery.ScalarQueryParameter("status",           "STRING",    r.get("status")           or "active"),
            bigquery.ScalarQueryParameter("created_at",       "TIMESTAMP", r.get("created_at")       or ""),
        ])
        result = bq_client.query(merge_query, job_config=merge_config).result()

        if (result.num_dml_affected_rows or 0) > 0:
            log.info("JD inserted in BQ for job_id=%s", job_id)
        else:
            log.info("JD already inserted by another trigger for job_id=%s — skipping.", job_id)

        return True

    except Exception as e:
        log.error("JIT JD processing failed for job_id=%s: %s", job_id, e)
        return False
 
 
# ── HELPER: Claim pipeline run lock (USES EXISTING JOBS TABLE) ───────────────
 
def claim_pipeline_run(job_id: str) -> bool:
    """
    Atomically claims the right to run the pipeline for this job_id.
    Uses the pipeline_status column in the existing jobs table.
    """
    query = f"""
        UPDATE `{PROJECT_ID}.{DATASET_ID}.jobs`
        SET pipeline_status = 'RUNNING'
        WHERE job_id = @job_id AND (pipeline_status IS NULL OR pipeline_status != 'RUNNING')
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("job_id", "STRING", job_id)
        ]
    )
    result = bq_client.query(query, job_config=job_config).result()
    return (result.num_dml_affected_rows or 0) > 0
 
 
# ── HELPER: Save pipeline result to screening API (best-effort) ───────────────
 
def save_pipeline_result(job_id: str, result: dict) -> None:
    try:
        payload = {"job_id": job_id, "result": result}
        resp    = requests.post(SCREENING_API_URL, json=payload, timeout=10)
        if resp.ok:
            log.info("Result saved to screening API (job=%s, status=%d)", job_id, resp.status_code)
        else:
            log.warning("Screening API non-OK %d (job=%s): %s", resp.status_code, job_id, resp.text[:200])
    except requests.exceptions.Timeout:
        log.error("Screening API timed out after 10s (job=%s) — result not saved.", job_id)
    except Exception as e:
        log.error("Failed to save result to screening API (job=%s): %s", job_id, e)
 
 
# ── SHARED: Execute the full pipeline (used by both trigger paths) ────────────
 
def _execute_pipeline(job_id: str) -> dict:
    log.info("Running pipeline for job_id=%s", job_id, TOP_K, TOP_N)
    
    try:
        result = run_pipeline(job_id=job_id, top_k=TOP_K, top_n=TOP_N)
        
        # ── Mark COMPLETED ────────────────────────────────────────────────
        bq_client.query(f"""
            UPDATE `{PROJECT_ID}.{DATASET_ID}.jobs`
            SET pipeline_status = 'COMPLETED',
                pipeline_error  = NULL,
                pipeline_ran_at = CURRENT_TIMESTAMP()
            WHERE job_id = '{job_id}'
        """).result()

        save_pipeline_result(job_id, result)
        return result

    except Exception as e:
        # ── Mark FAILED with reason ───────────────────────────────────────
        error_msg = str(e)[:500]
        bq_client.query(f"""
            UPDATE `{PROJECT_ID}.{DATASET_ID}.jobs`
            SET pipeline_status = 'FAILED',
                pipeline_error  = @error_msg,
                pipeline_ran_at = CURRENT_TIMESTAMP()
            WHERE job_id = @job_id
        """, job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("job_id",    "STRING", job_id),
            bigquery.ScalarQueryParameter("error_msg", "STRING", error_msg),
        ])).result()
        raise  # re-raise so Cloud Function logs it too
 
 
# ── ENTRY POINT 1: GCS Eventarc Trigger ──────────────────────────────────────
 
@functions_framework.cloud_event
def gcs_resume_trigger(cloud_event):
    """
    Fires on every PDF upload to the GCS bucket.
    Processes one resume, then checks if all resumes are in BQ.
    Only the invocation where GCS count == BQ count runs the full pipeline.
    """
    data      = cloud_event.data
    bucket    = data["bucket"]
    file_path = data["name"]
 
    log.info("[GCS Trigger] gs://%s/%s", bucket, file_path)
 
    # ── 1. Only handle PDFs ───────────────────────────────────────────────────
    if not file_path.lower().endswith(".pdf"):
        log.info("Skipping non-PDF: %s", file_path)
        return
 
    # ── 2. Parse path: must be resumes/{job_id}/{file}.pdf ───────────────────
    parts = file_path.split("/")
    if len(parts) < 3 or parts[0] != "resumes":
        log.info("Ignoring file outside resumes/ folder: %s", file_path)
        return
 
    job_id = parts[1]
    log.info("job_id=%s | file=%s", job_id, parts[2])
 
    # ── 3. Ensure JD exists in BQ (process JIT if needed) ────────────────────
    if not ensure_job_exists(bucket, job_id):
        log.error("Cannot proceed — job_id=%s unresolvable. Skipping: %s", job_id, file_path)
        return
 
    # ── 4. Process THIS resume → insert one PENDING row into BQ ──────────────
    log.info("Processing resume: %s", file_path)
    try:
        candidate_id = process_resume_from_gcs(
            bucket_name = bucket,
            file_name   = file_path,
            job_id      = job_id,
        )
        log.info("Resume inserted. candidate_id=%s", candidate_id)
 
    except ValueError as e:
        log.warning("Unprocessable PDF — moving to dead-letter: %s | %s", file_path, e)
        try:
            src_bucket = gcs_client.bucket(bucket)
            src_blob   = src_bucket.blob(file_path)
            if src_blob.exists():
                dead_path  = file_path.replace("resumes/", "resumes_failed/", 1)
                src_bucket.copy_blob(src_blob, src_bucket, dead_path)
                src_blob.delete()
                log.info("Moved to dead-letter: gs://%s/%s", bucket, dead_path)
            else:
                log.warning("Dead-letter source already gone: %s — skipping move.", file_path)
        except Exception as move_err:
            log.error("Failed to move dead-letter file %s: %s", file_path, move_err)
        return
 
    except Exception as e:
        log.error("Resume processing failed for %s: %s", file_path, e)
        raise
 
    # ── 5. Check: are all resumes now in BQ? ─────────────────────────────────
    gcs_count = count_pdfs_in_gcs(bucket, job_id)
    bq_count  = count_pending_in_bq(job_id)
 
    log.info("Count check — GCS: %d | BQ: %d", gcs_count, bq_count)
 
    if bq_count < gcs_count:
        log.info(
            "Not all resumes processed yet (%d/%d). Returning — pipeline will run later.",
            bq_count, gcs_count,
        )
        return
 
    # ── 6. Claim pipeline lock — only one trigger runs the pipeline ───────────
    if not claim_pipeline_run(job_id):
        log.info("Pipeline already claimed by another trigger for job_id=%s. Exiting.", job_id)
        return
 
    # ── 7. Run the full pipeline ──────────────────────────────────────────────
    try:
        _execute_pipeline(job_id)
    except ValueError as e:
        log.error("Job not found in BQ (job_id=%s): %s", job_id, e)
    except Exception as e:
        log.error("Pipeline failed for job_id=%s: %s", job_id, e)
        raise
 
    log.info("Done — job_id=%s", job_id)
 
 
# ── ENTRY POINT 2: HTTP Trigger (Run Screening button) ───────────────────────
 
@functions_framework.http
def run_pipeline_http(request):
    """
    Manual HTTP trigger for the UI Run Screening button.
 
    POST { "job_id": "job-001" }
    """
 
    # ── CORS preflight ────────────────────────────────────────────────────────
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)
 
    # ── Parse body ────────────────────────────────────────────────────────────
    body   = request.get_json(silent=True) or {}
    job_id = body.get("job_id")
 
    if not job_id:
        return (
            json.dumps({"error": "job_id is required"}),
            400,
            CORS_HEADERS,
        )
 
    log.info("[HTTP Trigger] Run Screening requested for job_id=%s", job_id)
 
    # ── Verify job exists in BQ ───────────────────────────────────────────────
    job_check = f"""
        SELECT 1 FROM `{PROJECT_ID}.{DATASET_ID}.jobs`
        WHERE job_id = @job_id LIMIT 1
    """
    jc = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("job_id", "STRING", job_id)]
    )
    if not list(bq_client.query(job_check, job_config=jc).result()):
        return (
            json.dumps({"error": f"job_id '{job_id}' not found in BQ"}),
            404,
            CORS_HEADERS,
        )
 
    # ── Verify there are PENDING candidates ──────────────────────────────────
    pending = count_pending_in_bq(job_id)
    if pending == 0:
        return (
            json.dumps({"error": "No PENDING candidates found. Upload resumes first."}),
            400,
            CORS_HEADERS,
        )
 
    # ── Claim pipeline lock ───────────────────────────────────────────────────
    if not claim_pipeline_run(job_id):
        return (
            json.dumps({
                "status":  "already_running",
                "message": "Pipeline is already running for this job. Please wait.",
            }),
            200,
            CORS_HEADERS,
        )
 
    # ── Run pipeline ──────────────────────────────────────────────────────────
    try:
        result = _execute_pipeline(job_id)
        return (json.dumps(result), 200, CORS_HEADERS)
 
    except ValueError as e:
        log.error("Pipeline ValueError for job_id=%s: %s", job_id, e)
        return (json.dumps({"error": str(e)}), 404, CORS_HEADERS)
 
    except Exception as e:
        log.error("Pipeline failed for job_id=%s: %s", job_id, e)
        return (json.dumps({"error": str(e)}), 500, CORS_HEADERS)