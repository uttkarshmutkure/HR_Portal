import os
import uuid
from google.cloud import bigquery
import functions_framework

bq_client = bigquery.Client()

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID = os.environ.get("BQ_DATASET_ID", "hr_dataset")
TABLE_ID = f"{PROJECT_ID}.{DATASET_ID}.users"

VALID_ROLES = {"hr", "interviewer", "superuser"}
CORS_HEADERS = {"Access-Control-Allow-Origin": "*"}


def _cors_preflight():
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
    }
    return ("", 204, headers)


def _is_active_superuser(email: str) -> bool:
    """Server-side authorization check — never trust the caller's claimed role."""
    if not email:
        return False
    query = f"""
        SELECT status, roles
        FROM `{TABLE_ID}`
        WHERE email = @email
        LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("email", "STRING", email)]
    )
    rows = list(bq_client.query(query, job_config=job_config).result())
    if not rows:
        return False
    row = rows[0]
    if row.status != "active":
        return False
    roles = [r.strip() for r in (row.roles or "").split(",")]
    return "superuser" in roles


def _get_user_by_id(user_id: str):
    query = f"SELECT * FROM `{TABLE_ID}` WHERE user_id = @user_id LIMIT 1"
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("user_id", "STRING", user_id)]
    )
    rows = list(bq_client.query(query, job_config=job_config).result())
    return rows[0] if rows else None


def _get_user_by_email(email: str):
    query = f"SELECT * FROM `{TABLE_ID}` WHERE email = @email LIMIT 1"
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("email", "STRING", email)]
    )
    rows = list(bq_client.query(query, job_config=job_config).result())
    return rows[0] if rows else None


def _list_users():
    query = f"""
        SELECT user_id, email, name, roles, status, source, granted_by, created_at, last_login_at
        FROM `{TABLE_ID}`
        ORDER BY name
    """
    rows = list(bq_client.query(query).result())
    users = []
    for row in rows:
        users.append({
            "user_id": row.user_id,
            "email": row.email,
            "name": row.name,
            "roles": [r.strip() for r in (row.roles or "").split(",") if r.strip()],
            "status": row.status,
            "source": row.source,
            "granted_by": row.granted_by,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "last_login_at": row.last_login_at.isoformat() if row.last_login_at else None,
        })
    return {"success": True, "users": users}


def _grant_access(email, name, roles, granted_by):
    if not email or not name or not roles:
        return ({"success": False, "error": "email, name, and roles are required"}, 400)

    bad_roles = [r for r in roles if r not in VALID_ROLES]
    if bad_roles:
        return ({"success": False, "error": f"Invalid role(s): {bad_roles}"}, 400)

    roles_str = ",".join(sorted(set(roles)))
    existing = _get_user_by_email(email)

    if existing:
        # Re-grant / update an existing (possibly disabled) user instead of duplicating.
        update_query = f"""
            UPDATE `{TABLE_ID}`
            SET name = @name, roles = @roles, status = 'active', granted_by = @granted_by
            WHERE email = @email
        """
        job_config = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("name", "STRING", name),
            bigquery.ScalarQueryParameter("roles", "STRING", roles_str),
            bigquery.ScalarQueryParameter("granted_by", "STRING", granted_by),
            bigquery.ScalarQueryParameter("email", "STRING", email),
        ])
        bq_client.query(update_query, job_config=job_config).result()
        return ({"success": True, "user_id": existing.user_id, "updated_existing": True}, 200)

    new_user_id = str(uuid.uuid4())
    insert_query = f"""
        INSERT INTO `{TABLE_ID}`
            (user_id, email, name, roles, status, source, granted_by, created_at, last_login_at)
        VALUES
            (@user_id, @email, @name, @roles, 'active', 'admin_panel', @granted_by, CURRENT_TIMESTAMP(), NULL)
    """
    job_config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("user_id", "STRING", new_user_id),
        bigquery.ScalarQueryParameter("email", "STRING", email),
        bigquery.ScalarQueryParameter("name", "STRING", name),
        bigquery.ScalarQueryParameter("roles", "STRING", roles_str),
        bigquery.ScalarQueryParameter("granted_by", "STRING", granted_by),
    ])
    bq_client.query(insert_query, job_config=job_config).result()
    return ({"success": True, "user_id": new_user_id, "updated_existing": False}, 200)


def _update_roles(user_id, roles):
    if not user_id or not roles:
        return ({"success": False, "error": "user_id and roles are required"}, 400)

    bad_roles = [r for r in roles if r not in VALID_ROLES]
    if bad_roles:
        return ({"success": False, "error": f"Invalid role(s): {bad_roles}"}, 400)

    if not _get_user_by_id(user_id):
        return ({"success": False, "error": "User not found"}, 404)

    roles_str = ",".join(sorted(set(roles)))
    query = f"UPDATE `{TABLE_ID}` SET roles = @roles WHERE user_id = @user_id"
    job_config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("roles", "STRING", roles_str),
        bigquery.ScalarQueryParameter("user_id", "STRING", user_id),
    ])
    bq_client.query(query, job_config=job_config).result()
    return ({"success": True}, 200)


def _set_status(user_id, status, requester_email):
    if not user_id or status not in ("active", "disabled"):
        return ({"success": False, "error": "user_id and a valid status ('active' or 'disabled') are required"}, 400)

    target = _get_user_by_id(user_id)
    if not target:
        return ({"success": False, "error": "User not found"}, 404)

    if target.email == requester_email and status == "disabled":
        return ({"success": False, "error": "You cannot disable your own account"}, 400)

    query = f"UPDATE `{TABLE_ID}` SET status = @status WHERE user_id = @user_id"
    job_config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("status", "STRING", status),
        bigquery.ScalarQueryParameter("user_id", "STRING", user_id),
    ])
    bq_client.query(query, job_config=job_config).result()
    return ({"success": True}, 200)


@functions_framework.http
def manage_users(request):
    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return ({"success": False, "error": "Method not allowed"}, 405, CORS_HEADERS)

    try:
        body = request.get_json(silent=True)
        if not body:
            return ({"success": False, "error": "Invalid JSON payload"}, 400, CORS_HEADERS)

        action = body.get("type")
        requester_email = body.get("requester_email")

        if not _is_active_superuser(requester_email):
            return ({"success": False, "error": "Forbidden — superuser access required"}, 403, CORS_HEADERS)

        if action == "LIST_USERS":
            return (_list_users(), 200, CORS_HEADERS)

        elif action == "GRANT_ACCESS":
            result, status_code = _grant_access(
                body.get("email"), body.get("name"), body.get("roles", []), requester_email
            )
            return (result, status_code, CORS_HEADERS)

        elif action == "UPDATE_ROLES":
            result, status_code = _update_roles(body.get("user_id"), body.get("roles", []))
            return (result, status_code, CORS_HEADERS)

        elif action == "SET_STATUS":
            result, status_code = _set_status(
                body.get("user_id"), body.get("status"), requester_email
            )
            return (result, status_code, CORS_HEADERS)

        else:
            return ({"success": False, "error": f"Unknown action type: {action}"}, 400, CORS_HEADERS)

    except Exception as e:
        print(f"Error in manage_users: {e}")
        return ({"success": False, "error": str(e)}, 500, CORS_HEADERS)