"""
job_listing — FastAPI route, mirrors the old `hr-dev-job_listing` Cloud
Function (list_jobs). Supports GET (query param) and POST (JSON body) status
filtering, plus a ?action=health check.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from google.cloud import bigquery

import config
from bigquery_client import bq_client

router = APIRouter()

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID
TABLE_ID   = "jobs"


def _error(message: str, status: int = 400):
    return JSONResponse({"success": False, "error": message}, status_code=status)


def _serialize_row(record: dict) -> dict:
    for key, value in record.items():
        if hasattr(value, "isoformat"):
            record[key] = value.isoformat()
    return record


# ── BigQuery query ────────────────────────────────────────────────────────────

def fetch_jobs(status_filter: str | None = None) -> list[dict]:
    """
    Query the jobs table and return all rows.
    Excludes jd_embedding (768-float array) — too large for frontend.
    Optionally filter by status (case-insensitive).
    """
    where_clause = ""
    params       = []

    if status_filter:
        where_clause = "WHERE LOWER(status) = LOWER(@status)"
        params.append(
            bigquery.ScalarQueryParameter("status", "STRING", status_filter)
        )

    query = f"""
        SELECT
            job_id,
            title,
            location,
            description,
            must_have_skills,
            preferred_skills,
            experience_min,
            experience_max,
            status,
            recruiter_email,
            created_at
        FROM `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`
        {where_clause}
        ORDER BY created_at DESC
    """

    job_config = bigquery.QueryJobConfig(query_parameters=params) if params else None

    rows   = bq_client.query(query, job_config=job_config).result()
    result = []

    for row in rows:
        record = dict(row)

        # must_have_skills and preferred_skills stored as comma-separated strings
        for field in ("must_have_skills", "preferred_skills"):
            raw = record.get(field) or ""
            record[field] = [s.strip() for s in raw.split(",") if s.strip()]

        result.append(_serialize_row(record))

    return result


# ── Entry point ───────────────────────────────────────────────────────────────

@router.get("/api/job-listing")
@router.post("/api/job-listing")
async def list_jobs(request: Request):
    # Health check
    action = request.query_params.get("action", "")
    if action == "health":
        return JSONResponse({
            "success": True,
            "service": "List Jobs",
            "status" : "ok",
        })

    # Accept status filter from query param or JSON body
    status_filter = request.query_params.get("status", None)

    if request.method == "POST":
        try:
            body = await request.json()
        except Exception:
            body = {}
        status_filter = (body or {}).get("status", status_filter)

    try:
        jobs = fetch_jobs(status_filter=status_filter)
        return JSONResponse({
            "success": True,
            "total"  : len(jobs),
            "jobs"   : jobs,
        })
    except Exception as e:
        return _error(f"Failed to fetch jobs: {str(e)}", 500)