import os
import uuid
from google.cloud import bigquery
import functions_framework

bq_client = bigquery.Client()

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID = os.environ.get("BQ_DATASET_ID", "hr_dataset")
JOBS_TABLE = f"{PROJECT_ID}.{DATASET_ID}.jobs"
USERS_TABLE = f"{PROJECT_ID}.{DATASET_ID}.users"

CORS_HEADERS = {"Access-Control-Allow-Origin": "*"}

# Columns an admin is allowed to edit, with their BigQuery types.
EDITABLE_FIELDS = {
    "title": "STRING",
    "description": "STRING",
    "must_have_skills": "STRING",
    "preferred_skills": "STRING",
    "experience_min": "INT64",
    "experience_max": "INT64",
    "location": "STRING",
    "recruiter_email": "STRING",
}
SKILL_FIELDS = ("must_have_skills", "preferred_skills")
INT_FIELDS = ("experience_min", "experience_max")


def _cors_preflight():
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
    }
    return ("", 204, headers)


def _param(name, value, bq_type):
    return bigquery.ScalarQueryParameter(name, bq_type, value)


def _is_active_superuser(email):
    """Server-side authorization — never trust the caller's claimed role."""
    if not email:
        return False
    query = f"SELECT status, roles FROM `{USERS_TABLE}` WHERE email = @email LIMIT 1"
    cfg = bigquery.QueryJobConfig(query_parameters=[_param("email", email, "STRING")])
    rows = list(bq_client.query(query, job_config=cfg).result())
    if not rows or rows[0].status != "active":
        return False
    roles = [r.strip() for r in (rows[0].roles or "").split(",")]
    return "superuser" in roles


def _get_job(job_id):
    query = f"SELECT * FROM `{JOBS_TABLE}` WHERE job_id = @job_id LIMIT 1"
    cfg = bigquery.QueryJobConfig(query_parameters=[_param("job_id", job_id, "STRING")])
    rows = list(bq_client.query(query, job_config=cfg).result())
    return rows[0] if rows else None


def _normalize_skills(value):
    """Accepts a list or a comma-separated string; stores a comma-separated string."""
    if isinstance(value, list):
        items = value
    else:
        items = str(value or "").split(",")
    cleaned = [s.strip() for s in items if s and s.strip()]
    return ",".join(cleaned)


def _split_skills(value):
    return [s.strip() for s in (value or "").split(",") if s.strip()]


def _clean_fields(body):
    """Pull editable fields out of the payload and normalize them. Returns (fields, error)."""
    fields = {}
    for key in EDITABLE_FIELDS:
        if key not in body:
            continue
        val = body[key]
        if key in SKILL_FIELDS:
            val = _normalize_skills(val)
        elif key in INT_FIELDS:
            try:
                val = int(val)
            except (TypeError, ValueError):
                return None, f"{key} must be a whole number"
            if val < 0:
                return None, f"{key} cannot be negative"
        else:
            val = str(val).strip() if val is not None else None
        fields[key] = val
    return fields, None


def _list_jobs(include_archived):
    where = "" if include_archived else "WHERE COALESCE(status, '') != 'archived'"
    query = f"""
        SELECT job_id, title, description, must_have_skills, preferred_skills,
               experience_min, experience_max, location, recruiter_email, status,
               created_at, pipeline_status, pipeline_error, pipeline_ran_at
        FROM `{JOBS_TABLE}`
        {where}
        ORDER BY created_at DESC
    """
    jobs = []
    for r in bq_client.query(query).result():
        jobs.append({
            "job_id": r.job_id,
            "title": r.title,
            "description": r.description,
            "must_have_skills": _split_skills(r.must_have_skills),
            "preferred_skills": _split_skills(r.preferred_skills),
            "experience_min": r.experience_min,
            "experience_max": r.experience_max,
            "location": r.location,
            "recruiter_email": r.recruiter_email,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "pipeline_status": r.pipeline_status,
            "pipeline_error": r.pipeline_error,
            "pipeline_ran_at": r.pipeline_ran_at.isoformat() if r.pipeline_ran_at else None,
        })
    return ({"success": True, "total": len(jobs), "jobs": jobs}, 200)


def _create_job(body, requester_email):
    fields, err = _clean_fields(body)
    if err:
        return ({"success": False, "error": err}, 400)

    required = ("title", "description", "must_have_skills", "experience_min", "experience_max")
    missing = [k for k in required if fields.get(k) in (None, "")]
    if missing:
        return ({"success": False, "error": f"Missing required field(s): {missing}"}, 400)
    if fields["experience_min"] > fields["experience_max"]:
        return ({"success": False, "error": "experience_min cannot be greater than experience_max"}, 400)

    job_id = f"job-{uuid.uuid4().hex[:8]}"
    # jd_embedding is intentionally omitted (see notes) — it defaults to an empty array.
    query = f"""
        INSERT INTO `{JOBS_TABLE}`
            (job_id, title, description, must_have_skills, preferred_skills,
             experience_min, experience_max, location, recruiter_email, status, created_at)
        VALUES
            (@job_id, @title, @description, @must_have_skills, @preferred_skills,
             @experience_min, @experience_max, @location, @recruiter_email, 'active',
             CURRENT_TIMESTAMP())
    """
    cfg = bigquery.QueryJobConfig(query_parameters=[
        _param("job_id", job_id, "STRING"),
        _param("title", fields["title"], "STRING"),
        _param("description", fields["description"], "STRING"),
        _param("must_have_skills", fields["must_have_skills"], "STRING"),
        _param("preferred_skills", fields.get("preferred_skills", ""), "STRING"),
        _param("experience_min", fields["experience_min"], "INT64"),
        _param("experience_max", fields["experience_max"], "INT64"),
        _param("location", fields.get("location"), "STRING"),
        _param("recruiter_email", fields.get("recruiter_email") or requester_email, "STRING"),
    ])
    bq_client.query(query, job_config=cfg).result()
    return ({"success": True, "job_id": job_id}, 200)


def _update_job(body):
    job_id = body.get("job_id")
    if not job_id:
        return ({"success": False, "error": "job_id is required"}, 400)

    existing = _get_job(job_id)
    if not existing:
        return ({"success": False, "error": "Job not found"}, 404)

    fields, err = _clean_fields(body)
    if err:
        return ({"success": False, "error": err}, 400)
    if not fields:
        return ({"success": False, "error": "No editable fields provided"}, 400)

    for key in ("title", "description", "must_have_skills"):
        if key in fields and not fields[key]:
            return ({"success": False, "error": f"{key} cannot be empty"}, 400)

    new_min = fields.get("experience_min", existing.experience_min)
    new_max = fields.get("experience_max", existing.experience_max)
    if new_min is not None and new_max is not None and new_min > new_max:
        return ({"success": False, "error": "experience_min cannot be greater than experience_max"}, 400)

    set_clause = ", ".join(f"{k} = @{k}" for k in fields)
    params = [_param(k, v, EDITABLE_FIELDS[k]) for k, v in fields.items()]
    params.append(_param("job_id", job_id, "STRING"))

    query = f"UPDATE `{JOBS_TABLE}` SET {set_clause} WHERE job_id = @job_id"
    bq_client.query(query, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
    return ({"success": True}, 200)


def _set_job_status(job_id, new_status):
    if not job_id:
        return ({"success": False, "error": "job_id is required"}, 400)
    if not _get_job(job_id):
        return ({"success": False, "error": "Job not found"}, 404)

    query = f"UPDATE `{JOBS_TABLE}` SET status = @status WHERE job_id = @job_id"
    cfg = bigquery.QueryJobConfig(query_parameters=[
        _param("status", new_status, "STRING"),
        _param("job_id", job_id, "STRING"),
    ])
    bq_client.query(query, job_config=cfg).result()
    return ({"success": True}, 200)


@functions_framework.http
def manage_jobs(request):
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

        if action == "LIST_JOBS":
            result, code = _list_jobs(bool(body.get("include_archived", True)))
        elif action == "CREATE_JOB":
            result, code = _create_job(body, requester_email)
        elif action == "UPDATE_JOB":
            result, code = _update_job(body)
        elif action == "ARCHIVE_JOB":
            result, code = _set_job_status(body.get("job_id"), "archived")
        elif action == "RESTORE_JOB":
            # Restores to 'closed', not 'active', so restoring never silently reopens hiring.
            result, code = _set_job_status(body.get("job_id"), "closed")
        else:
            result, code = ({"success": False, "error": f"Unknown action type: {action}"}, 400)

        return (result, code, CORS_HEADERS)

    except Exception as e:
        print(f"Error in manage_jobs: {e}")
        return ({"success": False, "error": str(e)}, 500, CORS_HEADERS)