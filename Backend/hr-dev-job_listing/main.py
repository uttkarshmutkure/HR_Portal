"""
List Jobs Cloud Function
─────────────────────────────────────────────────
Entry point : list_jobs  (HTTP trigger)
Runtime     : Python 3.12
Region      : asia-south1

Supported routes:
  GET  /                          → list all jobs
  GET  /?status=active            → filter by status
  POST / {"status": "active"}     → same via body
  GET  /?action=health            → health check

Returns every job row from BigQuery hr_dataset.jobs table,
stripping the heavy jd_embedding column.

CORS headers included for React frontend consumption.
"""

import json
import functions_framework
from google.cloud import bigquery
from datetime import datetime


# ── CONFIG ────────────────────────────────────────────────────────────────────

PROJECT_ID = "atgeir-moae-dev"
DATASET_ID = "hr_dataset"
TABLE_ID   = "jobs"

# ── CORS ──────────────────────────────────────────────────────────────────────

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
    return (json.dumps(data, default=_serialize), status, headers)


def _error(message: str, status: int = 400):
    return _json_response({"success": False, "error": message}, status)


def _serialize(obj):
    """JSON serializer for BigQuery types (date, datetime, Decimal)."""
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")


# ── BigQuery query ────────────────────────────────────────────────────────────

def fetch_jobs(status_filter: str | None = None) -> list[dict]:
    """
    Query the jobs table and return all rows.
    Excludes jd_embedding (768-float array) — too large for frontend.
    Optionally filter by status (case-insensitive).
    """
    client = bigquery.Client(project=PROJECT_ID)

    # Build WHERE clause only when a filter is given
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

    rows   = client.query(query, job_config=job_config).result()
    result = []

    for row in rows:
        record = dict(row)

        # must_have_skills and preferred_skills stored as comma-separated strings
        # Split into arrays for easier frontend consumption
        for field in ("must_have_skills", "preferred_skills"):
            raw = record.get(field) or ""
            record[field] = [s.strip() for s in raw.split(",") if s.strip()]

        result.append(record)

    return result


# ── Entry point ───────────────────────────────────────────────────────────────

@functions_framework.http
def list_jobs(request):
    """
    Cloud Function HTTP entry point.
    Deploy with: --entry-point list_jobs
    """

    # Handle CORS preflight
    if request.method == "OPTIONS":
        return _cors_preflight()

    # Health check
    action = request.args.get("action", "")
    if action == "health":
        return _json_response({
            "success": True,
            "service": "List Jobs",
            "status" : "ok",
        })

    # Accept status filter from query param or JSON body
    status_filter = request.args.get("status", None)

    if request.method == "POST":
        try:
            body = request.get_json(silent=True) or {}
        except Exception:
            return _error("Invalid JSON body")
        status_filter = body.get("status", status_filter)

    # Fetch from BigQuery
    try:
        jobs = fetch_jobs(status_filter=status_filter)
        return _json_response({
            "success"  : True,
            "total"    : len(jobs),
            "jobs"     : jobs,
        })
    except Exception as e:
        return _error(f"Failed to fetch jobs: {str(e)}", 500)