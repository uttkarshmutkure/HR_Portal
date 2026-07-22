"""
HR Screening Pipeline — Cloud Function Entry Point
───────────────────────────────────────────────────
Entry point : candidate_screening  (HTTP trigger)
Runtime     : Python 3.12
Region      : asia-south1
"""

import json
import functions_framework
from google.cloud import bigquery
from FullPipeline import run_pipeline as _run_pipeline

# Initialize BigQuery Client
bq_client = bigquery.Client()

# ── Database Status Helper ────────────────────────────────────────────────────
def set_job_pipeline_status(job_id: str, status: str):
    """Updates the pipeline_status in the BigQuery jobs table."""
    try:
        query = """
            UPDATE `atgeir-moae-dev.hr_dataset.jobs`
            SET pipeline_status = @status
            WHERE job_id = @job_id
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("status", "STRING", status),
                bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
            ]
        )
        bq_client.query(query, job_config=job_config).result()
        print(f"[{job_id}] Status updated to: {status}")
    except Exception as e:
        print(f"Failed to update BigQuery status for {job_id}: {e}")

# ── CORS helper ───────────────────────────────────────────────────────────────
CORS_HEADERS = {
    "Access-Control-Allow-Origin" : "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age"      : "3600",
}

def _cors_preflight():
    return ("", 204, CORS_HEADERS)

def _json_response(data: dict, status: int = 200):
    headers = {**CORS_HEADERS, "Content-Type": "application/json"}
    return (json.dumps(data), status, headers)

def _error(message: str, status: int = 400):
    return _json_response({"success": False, "error": message}, status)

# ── Entry point ───────────────────────────────────────────────────────────────
@functions_framework.http
def candidate_screening(request):
    if request.method == "OPTIONS":
        return _cors_preflight()

    action = request.args.get("action", "")
    if action == "health" or request.method == "GET":
        return _json_response({
            "success": True,
            "service": "HR Screening Pipeline",
            "status" : "ok",
        })

    try:
        body = request.get_json(silent=True) or {}
    except Exception:
        return _error("Invalid JSON body")

    action  = body.get("action", action) or "run_pipeline"
    job_id  = body.get("job_id",  "").strip()
    top_k   = int(body.get("top_k", 30))
    top_n   = int(body.get("top_n",  5))

    if action == "run_pipeline":
        if not job_id:
            return _error("'job_id' is required for action=run_pipeline")

        try:
            # 1. Lock the frontend button by setting status to RUNNING
            set_job_pipeline_status(job_id, 'RUNNING')
            
            # 2. Run the heavy AI pipeline
            result = _run_pipeline(job_id=job_id, top_k=top_k, top_n=top_n)
            
            # 3. Unlock the frontend button upon success
            set_job_pipeline_status(job_id, 'COMPLETED')
            return _json_response({"success": True, **result})
            
        except ValueError as e:
            set_job_pipeline_status(job_id, 'FAILED')
            return _error(str(e), 404)
        except Exception as e:
            set_job_pipeline_status(job_id, 'FAILED')
            return _error(f"Pipeline error: {str(e)}", 500)

    return _error(f"Unknown action: '{action}'. Supported: run_pipeline, health")