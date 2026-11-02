import os
from google.cloud import bigquery
import functions_framework

bq_client = bigquery.Client()


@functions_framework.http
def check_login(request):
    # 1. Handle CORS Preflight
    if request.method == "OPTIONS":
        headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "3600",
        }
        return ("", 204, headers)

    headers = {"Access-Control-Allow-Origin": "*"}

    if request.method != "POST":
        return ({"error": "Method not allowed"}, 405, headers)

    try:
        request_json = request.get_json(silent=True)
        if not request_json:
            return ({"error": "Invalid JSON payload"}, 400, headers)

        email = (request_json.get("email") or "").strip().lower()
        if not email:
            return ({"error": "Missing email"}, 400, headers)

        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
        dataset_id = os.environ.get("BQ_DATASET_ID", "hr_dataset")
        table_id = f"{project_id}.{dataset_id}.users"

        query = f"""
            SELECT user_id, email, name, roles, status
            FROM `{table_id}`
            WHERE LOWER(email) = @email
            LIMIT 1
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("email", "STRING", email)]
        )
        results = list(bq_client.query(query, job_config=job_config).result())

        if not results:
            return ({"allowed": False, "reason": "No account found for this email."}, 200, headers)

        row = results[0]

        if row.status != "active":
            return ({"allowed": False, "reason": "This account has been disabled."}, 200, headers)

        user_roles = [r.strip() for r in (row.roles or "").split(",") if r.strip()]
        if not user_roles:
            return ({"allowed": False, "reason": "No role is assigned to this account."}, 200, headers)

        # Update last_login_at
        update_query = f"""
            UPDATE `{table_id}`
            SET last_login_at = CURRENT_TIMESTAMP()
            WHERE LOWER(email) = @email
        """
        bq_client.query(update_query, job_config=job_config).result()

        return (
            {
                "allowed": True,
                "user": {
                    "id": row.user_id,
                    "email": row.email,
                    "name": row.name,
                    "roles": user_roles,
                },
            },
            200,
            headers,
        )

    except Exception as e:
        print(f"Error checking login: {e}")
        return ({"error": "Something went wrong. Please try again."}, 500, headers)