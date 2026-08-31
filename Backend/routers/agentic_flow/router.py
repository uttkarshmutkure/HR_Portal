"""
agentic_flow — FastAPI route, mirrors the old `hr-dev-agentic-flow` Cloud
Function's `run_pipeline_http` entry point ONLY (manual "Run Screening"
button). The GCS Eventarc trigger (gcs_resume_trigger) and the ADK
agent/tool layer are intentionally not ported — Kubernetes has no GCS
event-trigger mechanism, and the ADK indirection existed only to route a
Cloud Function cold-start through a single tool call, which FastAPI doesn't
need. This route calls shared/full_pipeline.py's run_pipeline() directly.
"""

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from google.cloud import bigquery
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai.types import Content, Part

import config
from bigquery_client import bq_client
from gcs_client import gcs_client
from routers.agentic_flow.orchestrator import pipeline_agent
from shared.jd_processing import _process_jd_to_row
from shared.resume_processing import process_resume_from_gcs, _is_already_processed

router = APIRouter()

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID
TOP_K = config.TOP_K
TOP_N = config.TOP_N
BUCKET_NAME = config.GCS_BUCKET_NAME

_session_service = InMemorySessionService()
_pipeline_runner = Runner(
    agent=pipeline_agent,
    app_name="hr_pipeline",
    session_service=_session_service,
)


async def _run_pipeline_via_agent(job_id: str, top_k: int, top_n: int) -> dict:
    """Routes the pipeline call through the ADK pipeline_agent instead of
    calling run_pipeline() directly."""
    session_id = job_id
    try:
        await _session_service.create_session(
            app_name="hr_pipeline", user_id="system", session_id=session_id,
        )
    except Exception:
        pass  # session already exists

    message = Content(
        role="user",
        parts=[Part(text=json.dumps({"job_id": job_id, "top_k": top_k, "top_n": top_n}))],
    )

    tool_result = None
    final_result = {}

    async for event in _pipeline_runner.run_async(
        user_id="system", session_id=session_id, new_message=message,
    ):
        if hasattr(event, "content") and event.content and event.content.role == "tool":
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

        if event.is_final_response():
            if event.content and event.content.parts:
                text = event.content.parts[0].text or ""
                try:
                    final_result = json.loads(text)
                except Exception:
                    final_result = {"raw": text}

    return tool_result if tool_result else final_result

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
    return int(rows[0].cnt) if rows else 0


def claim_pipeline_run(job_id: str) -> bool:
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

def _jd_in_bq(job_id: str) -> bool:
    job_query = f"""
        SELECT 1 FROM `{PROJECT_ID}.{DATASET_ID}.jobs`
        WHERE job_id = @job_id LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("job_id", "STRING", job_id)
    ])
    return bool(list(bq_client.query(job_query, job_config=job_config).result()))


def _ensure_job_exists(job_id: str) -> bool:
    """JIT-process the JD from GCS if it's not already in BQ. Simplified from
    the original gcs_resume_trigger's ensure_job_exists — no GCS lock needed
    here since this route only ever runs one request at a time per manual
    click, not concurrent event triggers."""
    if _jd_in_bq(job_id):
        return True

    jd_path = f"jd/{job_id}/{job_id}.pdf"
    bucket_obj = gcs_client.bucket(BUCKET_NAME)
    if not bucket_obj.blob(jd_path).exists():
        return False

    jd_row = _process_jd_to_row(jd_path)
    if not jd_row:
        return False

    r = jd_row
    emb_literal = "[" + ", ".join(str(float(x)) for x in (r.get("jd_embedding") or [])) + "]"

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
    bq_client.query(merge_query, job_config=merge_config).result()
    return True


def _sync_new_resumes_from_bucket(job_id: str) -> int:
    """Scans resume/{job_id}/ in GCS and processes any PDFs not yet in BQ.
    Returns the count of newly processed resumes."""
    prefix = f"resume/{job_id}/"
    bucket_obj = gcs_client.bucket(BUCKET_NAME)
    pdf_blobs = [
        b.name for b in bucket_obj.list_blobs(prefix=prefix)
        if b.name.lower().endswith(".pdf")
    ]

    new_count = 0
    for file_path in pdf_blobs:
        if _is_already_processed(file_path, job_id):
            continue
        try:
            process_resume_from_gcs(BUCKET_NAME, file_path, job_id)
            new_count += 1
        except Exception as e:
            print(f"[agentic-flow] Failed to process {file_path}: {e}")

    return new_count

async def _execute_pipeline(job_id: str) -> dict:
    try:
        result = await _run_pipeline_via_agent(job_id, top_k=TOP_K, top_n=TOP_N)

        bq_client.query(f"""
            UPDATE `{PROJECT_ID}.{DATASET_ID}.jobs`
            SET pipeline_status = 'COMPLETED',
                pipeline_error  = NULL,
                pipeline_ran_at = CURRENT_TIMESTAMP()
            WHERE job_id = '{job_id}'
        """).result()

        return result

    except Exception as e:
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
        raise


@router.post("/api/agentic-flow")
async def run_pipeline_http(request: Request):
    """Manual HTTP trigger for the UI Run Screening button. POST { "job_id": "job-001" }
    Mirrors gcs_resume_trigger's processing logic (JD JIT-processing + new
    resume sync from GCS) but invoked manually instead of on file upload."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    job_id = body.get("job_id")

    if not job_id:
        return JSONResponse({"error": "job_id is required"}, status_code=400)

    if not _ensure_job_exists(job_id):
        return JSONResponse({"error": f"job_id '{job_id}' not found in BQ and no JD PDF found in GCS"}, status_code=404)

    new_resumes = _sync_new_resumes_from_bucket(job_id)
    print(f"[agentic-flow] Synced {new_resumes} new resume(s) from bucket for job_id={job_id}")

    pending = count_pending_in_bq(job_id)
    
    if pending == 0:
        return JSONResponse({"error": "No PENDING candidates found. Upload resumes first."}, status_code=400)

    if not claim_pipeline_run(job_id):
        return JSONResponse({
            "status":  "already_running",
            "message": "Pipeline is already running for this job. Please wait.",
        })

    try:
        result = await _execute_pipeline(job_id)
        return JSONResponse(result)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)