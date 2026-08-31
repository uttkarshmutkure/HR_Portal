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
import asyncio
import functions_framework
from google.cloud import bigquery, storage

# ── CONFIG ────────────────────────────────────────────────────────────────────

log = logging.getLogger(__name__)

PROJECT_ID        = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID        = os.environ.get("BQ_DATASET_ID",        "hr_dataset")

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
# Only lightweight SDK clients here — no Vertex AI / ADK at module level.

bq_client  = bigquery.Client(project=PROJECT_ID)
gcs_client = storage.Client(project=PROJECT_ID)


# ── LAZY ADK INITIALISATION ───────────────────────────────────────────────────
# ADK agents import FullPipeline / resume_processing / jd_processing which each
# call vertexai.init() and build TextEmbeddingModel at *import time*.  If we do
# that at module level the Cloud Run healthcheck fires before those clients are
# ready and the container is killed before it can serve traffic.
#
# Solution: defer ALL ADK imports and Runner construction to the first real
# invocation via _get_runners().  Subsequent calls reuse the cached tuple.

_runners_cache: tuple | None = None   # (session_service, jd_runner, resume_runner, pipeline_runner)

def _get_runners():
    """Lazy-initialise ADK runners.  Safe to call multiple times — cached after first call."""
    global _runners_cache
    if _runners_cache is not None:
        return _runners_cache

    # Heavy imports — deferred until first real request
    from google.adk.runners  import Runner
    from google.adk.sessions import InMemorySessionService
    from orchestrator        import jd_agent, resume_agent, pipeline_agent

    session_service = InMemorySessionService()

    jd_runner = Runner(
        agent           = jd_agent,
        app_name        = "hr_jd",
        session_service = session_service,
    )
    resume_runner = Runner(
        agent           = resume_agent,
        app_name        = "hr_resume",
        session_service = session_service,
    )
    pipeline_runner = Runner(
        agent           = pipeline_agent,
        app_name        = "hr_pipeline",
        session_service = session_service,
    )

    _runners_cache = (session_service, jd_runner, resume_runner, pipeline_runner)
    log.info("ADK runners initialised (lazy).")
    return _runners_cache


# ── PERSISTENT EVENT LOOP ─────────────────────────────────────────────────────
# asyncio.run() creates AND CLOSES a loop after every call.
# ADK's async HTTP clients try to close their connections after the loop is
# already shut — raising "RuntimeError: Event loop is closed".
# Fix: keep one loop alive for the lifetime of the Cloud Run instance, exactly
# like the working chat_agent.py reference.

_loop: asyncio.AbstractEventLoop | None = None

def _get_loop() -> asyncio.AbstractEventLoop:
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
    return _loop


# ── HELPER: Generic ADK runner ────────────────────────────────────────────────

def _run_via_adk_agent(
    runner, session_service, app_name: str, session_id: str, payload: dict,
    max_retries: int = 4,
) -> dict:
    """
    Shared ADK runner helper used by all three agents (jd, resume, pipeline).
    Uses a persistent event loop (never closed between calls) to avoid
    "RuntimeError: Event loop is closed" from ADK's async HTTP teardown.
    Retries with exponential backoff on 429 RESOURCE_EXHAUSTED.
    Always returns a dict — never a raw string.
    """
    import time
    from google.genai.types import Content, Part

    async def _run_async():
        # create session — ignore if already exists
        try:
            await session_service.create_session(
                app_name   = app_name,
                user_id    = "system",
                session_id = session_id,
            )
        except Exception:
            pass

        message = Content(
            role  = "user",
            parts = [Part(text=json.dumps(payload))],
        )

        tool_result  = None   # raw dict returned by the tool call (e.g. jd row)
        final_result = {}     # fallback: agent's final text parsed as JSON

        async for event in runner.run_async(
            user_id     = "system",
            session_id  = session_id,
            new_message = message,
        ):
            # ── Capture tool response (the actual structured data we want) ──
            # ADK emits a tool-result event before the agent's final text.
            # For jd_agent / resume_agent the tool returns the BQ row dict
            # directly — we use that instead of the agent's text summary.
            if (hasattr(event, "content") and event.content
                    and event.content.role == "tool"):
                for part in event.content.parts:
                    if hasattr(part, "function_response") and part.function_response:
                        raw = part.function_response.response
                        if isinstance(raw, dict):
                            tool_result = raw
                        elif isinstance(raw, str):
                            try:
                                tool_result = json.loads(raw)
                            except Exception:
                                pass

            # ── Capture final text response as fallback ───────────────────
            if event.is_final_response():
                if event.content and event.content.parts:
                    text = event.content.parts[0].text or ""
                    try:
                        final_result = json.loads(text)
                    except Exception:
                        final_result = {"raw": text}

        # Prefer tool result (actual data) over agent summary text
        return tool_result if tool_result else final_result

    def _run_sync():
        loop = _get_loop()
        try:
            return loop.run_until_complete(_run_async())
        except RuntimeError as e:
            log.warning("Loop error in _run_via_adk_agent, recreating: %s", e)
            global _loop
            _loop = asyncio.new_event_loop()
            asyncio.set_event_loop(_loop)
            return _loop.run_until_complete(_run_async())

    # ── Retry loop with exponential backoff for 429 ───────────────────────────
    for attempt in range(max_retries + 1):
        try:
            return _run_sync()
        except Exception as e:
            err_str = str(e)
            is_429  = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str
            if is_429 and attempt < max_retries:
                wait = (2 ** attempt) * 5   # 5s, 10s, 20s, 40s
                log.warning(
                    "[%s] 429 RESOURCE_EXHAUSTED attempt %d/%d — retrying in %ds",
                    app_name, attempt + 1, max_retries, wait,
                )
                time.sleep(wait)
                continue
            raise  # non-429 or out of retries — propagate


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

    # ── Fast path ─────────────────────────────────────────────────────────
    if _jd_in_bq(job_id):
        return True

    log.warning("job_id '%s' not in BQ. Checking GCS for JD...", job_id)
    jd_path = f"jd/{job_id}/{job_id}.pdf"
    bucket_obj = gcs_client.bucket(bucket_name)

    if not bucket_obj.blob(jd_path).exists():
        log.error("JD not found at gs://%s/%s", bucket_name, jd_path)
        return False

    # ── GCS-based distributed lock ────────────────────────────────────────
    # Only ONE trigger processes the JD; others wait and poll BQ.
    lock_blob = bucket_obj.blob(f"_locks/{job_id}.lock")
    try:
        # if_generation_match=0 means: only create if it doesn't exist
        # Second trigger hitting this gets a 412 PreconditionFailed → goes to except
        lock_blob.upload_from_string(
            b"locked",
            content_type="text/plain",
            if_generation_match=0,
        )
        log.info("Acquired JD lock for job_id=%s — processing JD.", job_id)
        lock_acquired = True
    except Exception:
        log.info("JD lock already held for job_id=%s — waiting for BQ...", job_id)
        lock_acquired = False

    if not lock_acquired:
        # ── Another trigger won — poll BQ until JD appears (max 60s) ─────
        for attempt in range(12):
            time.sleep(5)
            if _jd_in_bq(job_id):
                log.info("JD now in BQ for job_id=%s after waiting.", job_id)
                return True
            log.info("Waiting for JD in BQ... attempt %d/12", attempt + 1)
        log.error("JD never appeared in BQ for job_id=%s after 60s.", job_id)
        return False

    # ── Lock winner: process the JD then insert into BQ ─────────────────
    try:
        from jd_processing import _process_jd_to_row   # lazy — avoids Vertex AI init at startup
        jd_row = _process_jd_to_row(jd_path)
        if not jd_row:
            log.error("JD processing returned no row for %s", jd_path)
            return False

        r           = jd_row
        emb_literal = "[" + ", ".join(
            str(float(x)) for x in (r.get("jd_embedding") or [])
        ) + "]"

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
            log.info("JD already in BQ for job_id=%s (MERGE no-op).", job_id)

        return True

    except Exception as e:
        log.error("JIT JD processing failed for job_id=%s: %s", job_id, e)
        return False
    finally:
        # ── Always release lock so waiting triggers can proceed ───────────
        try:
            lock_blob.delete()
            log.info("JD lock released for job_id=%s", job_id)
        except Exception:
            pass  # already deleted or never created — fine


def _jd_in_bq(job_id: str) -> bool:
    """Extracted helper so both fast-path and poll loop reuse it."""
    job_query = f"""
        SELECT 1 FROM `{PROJECT_ID}.{DATASET_ID}.jobs`
        WHERE job_id = @job_id LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("job_id", "STRING", job_id)
    ])
    return bool(list(bq_client.query(job_query, job_config=job_config).result()))

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


# ── SHARED: Execute the full pipeline (used by both trigger paths) ────────────

def _execute_pipeline(job_id: str) -> dict:
    log.info("Running pipeline via ADK pipeline_agent for job_id=%s | top_k=%d | top_n=%d", job_id, TOP_K, TOP_N)

    try:
        session_service, _, _, pipeline_runner = _get_runners()

        result = _run_via_adk_agent(
            runner          = pipeline_runner,
            session_service = session_service,
            app_name        = "hr_pipeline",
            session_id      = job_id,
            payload         = {"job_id": job_id, "top_k": TOP_K, "top_n": TOP_N},
        )

        # ── Mark COMPLETED ────────────────────────────────────────────────
        bq_client.query(f"""
            UPDATE `{PROJECT_ID}.{DATASET_ID}.jobs`
            SET pipeline_status = 'COMPLETED',
                pipeline_error  = NULL,
                pipeline_ran_at = CURRENT_TIMESTAMP()
            WHERE job_id = '{job_id}'
        """).result()

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

    # ── 4. Process THIS resume via ADK resume_agent ───────────────────────────
    log.info("Processing resume via ADK resume_agent: %s", file_path)
    try:
        session_service, _, resume_runner, _ = _get_runners()

        candidate_id = _run_via_adk_agent(
            runner          = resume_runner,
            session_service = session_service,
            app_name        = "hr_resume",
            session_id      = f"resume-{job_id}-{parts[2].replace('.pdf', '')}",
            payload         = {"bucket_name": bucket, "file_name": file_path, "job_id": job_id},
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

    # ── 5. Check: are all NEW resumes now in BQ? ─────────────────────────────
    # Get when pipeline last ran for this job
    last_ran_row = list(bq_client.query(f"""
        SELECT pipeline_ran_at FROM `{PROJECT_ID}.{DATASET_ID}.jobs`
        WHERE job_id = @job_id LIMIT 1
    """, job_config=bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("job_id", "STRING", job_id)
    ])).result())
    last_ran_at = last_ran_row[0].pipeline_ran_at if last_ran_row else None

    # Count only PDFs uploaded AFTER last pipeline run
    gcs_bucket_obj = gcs_client.bucket(bucket)
    gcs_new_count = sum(
        1 for b in gcs_bucket_obj.list_blobs(prefix=f"resumes/{job_id}/")
        if b.name.lower().endswith(".pdf")
        and (last_ran_at is None or b.time_created > last_ran_at)
    )
    bq_count = count_pending_in_bq(job_id)

    log.info("New PDFs since last run — GCS: %d | BQ PENDING: %d", gcs_new_count, bq_count)

    if bq_count < gcs_new_count:
        log.info(
            "Not all new resumes processed yet (%d/%d). Returning — pipeline will run later.",
            bq_count, gcs_new_count,
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