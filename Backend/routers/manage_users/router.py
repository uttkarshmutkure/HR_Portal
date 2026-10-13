import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, status
from google.cloud import bigquery
from pydantic import BaseModel

from bigquery_client import bq_client
from config import DATASET_ID, PROJECT_ID

router = APIRouter(prefix="/api/manage-users", tags=["Manage Users"])

TABLE_ID = f"{PROJECT_ID}.{DATASET_ID}.users"
VALID_ROLES = {"hr", "interviewer", "user"}


class ManageUserRequest(BaseModel):
    type: str
    requester_email: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None
    roles: Optional[List[str]] = None
    user_id: Optional[str] = None
    status: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_active_hr(email: Optional[str]) -> bool:
    """Server-side authorization check — never trust caller claimed role."""
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
    return "hr" in roles


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


# ── Actions ───────────────────────────────────────────────────────────────────

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


def _grant_access(email: Optional[str], name: Optional[str], roles: Optional[List[str]], granted_by: Optional[str]):
    if not email or not name or not roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="email, name, and roles are required"
        )

    bad_roles = [r for r in roles if r not in VALID_ROLES]
    if bad_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role(s): {bad_roles}"
        )

    roles_str = ",".join(sorted(set(roles)))
    existing = _get_user_by_email(email)

    if existing:
        update_query = f"""
            UPDATE `{TABLE_ID}`
            SET name = @name, roles = @roles, status = 'active', granted_by = @granted_by
            WHERE email = @email
        """
        job_config = bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("name", "STRING", name),
            bigquery.ScalarQueryParameter("roles", "STRING", roles_str),
            bigquery.ScalarQueryParameter("granted_by", "STRING", granted_by or ""),
            bigquery.ScalarQueryParameter("email", "STRING", email),
        ])
        bq_client.query(update_query, job_config=job_config).result()
        return {"success": True, "user_id": existing.user_id, "updated_existing": True}

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
        bigquery.ScalarQueryParameter("granted_by", "STRING", granted_by or ""),
    ])
    bq_client.query(insert_query, job_config=job_config).result()
    return {"success": True, "user_id": new_user_id, "updated_existing": False}


def _update_roles(user_id: Optional[str], roles: Optional[List[str]]):
    if not user_id or not roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="user_id and roles are required"
        )

    bad_roles = [r for r in roles if r not in VALID_ROLES]
    if bad_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role(s): {bad_roles}"
        )

    if not _get_user_by_id(user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    roles_str = ",".join(sorted(set(roles)))
    query = f"UPDATE `{TABLE_ID}` SET roles = @roles WHERE user_id = @user_id"
    job_config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("roles", "STRING", roles_str),
        bigquery.ScalarQueryParameter("user_id", "STRING", user_id),
    ])
    bq_client.query(query, job_config=job_config).result()
    return {"success": True}


def _set_status(user_id: Optional[str], target_status: Optional[str], requester_email: Optional[str]):
    if not user_id or target_status not in ("active", "disabled"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="user_id and a valid status ('active' or 'disabled') are required"
        )

    target = _get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target.email == requester_email and target_status == "disabled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot disable your own account"
        )

    query = f"UPDATE `{TABLE_ID}` SET status = @status WHERE user_id = @user_id"
    job_config = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("status", "STRING", target_status),
        bigquery.ScalarQueryParameter("user_id", "STRING", user_id),
    ])
    bq_client.query(query, job_config=job_config).result()
    return {"success": True}


# ── Main Endpoint ─────────────────────────────────────────────────────────────

@router.post("")
def manage_users_endpoint(payload: ManageUserRequest):
    if not _is_active_hr(payload.requester_email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden — HR access required"
        )

    action = payload.type

    if action == "LIST_USERS":
        return _list_users()

    elif action == "GRANT_ACCESS":
        return _grant_access(
            payload.email, payload.name, payload.roles or [], payload.requester_email
        )

    elif action == "UPDATE_ROLES":
        return _update_roles(payload.user_id, payload.roles or [])

    elif action == "SET_STATUS":
        return _set_status(payload.user_id, payload.status, payload.requester_email)

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown action type: {action}"
        )