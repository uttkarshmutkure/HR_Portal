"""
check_login — FastAPI route, mirrors the old `hr-dev-check-login` Cloud Function.

Same change as chat_agent: project_id/dataset_id come from config.py (which
requires GCP_PROJECT_ID and BQ_DATASET_ID to be set), instead of
os.environ.get(..., "atgeir-moae-dev") inline.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from google.cloud import bigquery

import config
from bigquery_client import bq_client

router = APIRouter()

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID
TABLE_ID   = f"{PROJECT_ID}.{DATASET_ID}.users"


@router.post("/api/check-login")
async def check_login(request: Request):
    try:
        request_json = await request.json()
    except Exception:
        request_json = None

    if not request_json:
        return JSONResponse({"error": "Invalid JSON payload"}, status_code=400)

    email = request_json.get("email")
    requested_role = request_json.get("role")  # "hr" or "interviewer"

    if not email or not requested_role:
        return JSONResponse({"error": "Missing email or role"}, status_code=400)

    query = f"""
        SELECT
            ANY_VALUE(user_id) AS user_id,
            email,
            ANY_VALUE(name) AS name,
            STRING_AGG(DISTINCT role, ',') AS roles,
            ANY_VALUE(status) AS status
        FROM `{TABLE_ID}`, UNNEST(SPLIT(roles, ',')) AS role
        WHERE email = @email
        GROUP BY email
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("email", "STRING", email),
        ]
    )

    try:
        results = list(bq_client.query(query, job_config=job_config).result())

        if not results:
            return JSONResponse({"allowed": False, "reason": "No account found for this email."})

        row = results[0]

        if row.status != "active":
            return JSONResponse({"allowed": False, "reason": "This account has been disabled."})

        user_roles = [r.strip() for r in row.roles.split(",")]

        if requested_role not in user_roles:
            role_label = "HR" if requested_role == "hr" else "Interviewer"
            return JSONResponse({"allowed": False, "reason": f"You don't have permission to log in as {role_label}."})

        # Update last_login_at
        update_query = f"""
            UPDATE `{TABLE_ID}`
            SET last_login_at = CURRENT_TIMESTAMP()
            WHERE email = @email
        """
        bq_client.query(update_query, job_config=job_config).result()

        return JSONResponse({
            "allowed": True,
            "user": {
                "id": row.user_id,
                "email": row.email,
                "name": row.name,
                "roles": user_roles,
            },
        })

    except Exception as e:
        print(f"Error checking login: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)