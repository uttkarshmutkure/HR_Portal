import re
import json

import config
from bigquery_client import bq_client
from genai_client import genai_client

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID
MODEL      = config.GEMINI_MODEL

from google.cloud import bigquery

from google.genai import types

from routers.chat_agent.interviewer_prompt import INTERVIEWER_SQL_SYSTEM_PROMPT_TEMPLATE
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from routers.chat_agent.prompts import build_hr_sql_system_prompt

MODEL = "gemini-3.5-flash"

MAX_RESULT_ROWS = 200          # hard cap on rows pulled back from BigQuery
QUERY_TIMEOUT_SEC = 20

# How long a warm instance trusts its cached distinct-value snapshot before
# re-querying BigQuery.
ENUM_CACHE_TTL_SEC = 6 * 60 * 60  # 6 hours


# ─────────────────────────────────────────────────────────────────────────────
# SCHEMA — the only source of truth the SQL-writing model is given.
# Blocked columns are simply omitted here, so the model never learns they exist.
# ─────────────────────────────────────────────────────────────────────────────

SCHEMA = {
        "candidates": {
            "columns": [
                "candidate_id", "job_id", "name", "email", "phone", "location",
                "last_organization", "minimum_qualification", "total_experience_years",
                "skills", "applied_at", "screening_status", "candidate_result",
                "reject_reason",
            ],
                "notes": (
            "One row per candidate application. Join to jobs via job_id. "
            "'Screened' / 'has been screened' means screening_status = 'COMPLETED' (regardless of "
            "eventual outcome). "
            "candidate_result is the PIPELINE STAGE a screened candidate has reached, with these "
            "exact meanings — use them precisely, this is a business definition, not a guess: "
            "'Archive' = FAILED/eliminated AT THE INITIAL AI SCREENING STAGE (before ever being "
            "shortlisted) — this is what 'failed candidates' / 'failed screening' means. "
            "'Rejected' = a DIFFERENT, LATER stage — the candidate WAS shortlisted/progressed, but "
            "was rejected AFTER the shortlist process (e.g. during/after interviews or human "
            "review). This is what 'rejected candidates' means — NEVER use 'Archive' for this. "
            "'Human Review' = pending manual review, outcome not yet decided. "
            "'Passed' = passed AI screening, awaiting the shortlisting decision. "
            "'Shortlisted' = shortlisted but not yet moved into the interview pipeline. "
            "'Interview' = shortlisted AND already moved into interviews (further along than "
            "'Shortlisted', not a separate/unrelated status). "
            "THEREFORE: 'shortlisted candidates' (broad, common usage) means candidate_result IN "
            "('Shortlisted', 'Interview') — both are shortlisted, one has simply progressed further. "
            "'candidates in interview' / 'interview stage' specifically means candidate_result = "
            "'Interview' only. "
            "'passed candidates' (from screening) means candidate_result = 'Passed' specifically. "
            "'failed candidates' / 'failed screening' means candidate_result = 'Archive' ONLY. "
            "'rejected candidates' means candidate_result = 'Rejected' ONLY — do not confuse with "
            "'Archive', they are different stages with different meanings, per above. "
            "If the user's question is about rejection during/after a specific interview round "
            "rather than the overall pipeline stage, use interview_feedback.verdict = 'reject' "
            "instead (a different table, scoped to one round) — do not conflate the two."
        ),
    },
    "jobs": {
        "columns": [
            "job_id", "title", "description", "must_have_skills", "preferred_skills",
            "experience_min", "experience_max", "location", "recruiter_email",
            "status", "created_at", "pipeline_status", "pipeline_error", "pipeline_ran_at",
        ],
        "notes": "One row per job requisition. status is e.g. 'Active'/'Closed'.",
    },
    "interview_feedback": {
        "columns": [
            "job_id", "candidate_id", "round", "rating", "tech_skill", "communication",
            "notes", "verdict", "interviewer_name", "submitted_at",
        ],
        "notes": (
            "One row PER ROUND per candidate — this is an append-only history, NOT one row per "
            "candidate. When a candidate advances from round1 to technical, their OLD round1 row "
            "still exists alongside the new technical row. "
            "round stores 'round1'/'technical'/'hr'; HR says 'Round 1'=round1, 'Round 2'/'technical "
            "round'=technical, 'HR round'/'final round'=hr. "
            "CRITICAL: 'candidates currently in round X' or 'round X candidates' means candidates "
            "whose HIGHEST/most recent round is X — NOT every candidate who has ever had a round X "
            "row (they may have since advanced past it). See RULES section for the exact query "
            "pattern to use for this. "
            "verdict is 'advance' or 'reject'. Join to candidates via candidate_id, jobs via job_id."
        ),
    },
    "interview_round_questions": {
        "columns": ["candidate_id", "job_id", "round", "questions", "created_at", "updated_at"],
        "notes": (
            "AI-generated interview questions per candidate per round. round stores "
            "'round1'/'technical'/'hr' — see interview_feedback notes for how HR's "
            "'Round 1/2/HR Round' phrasing maps to these stored values."
        ),
    },
        "candidate_slot_selections": {
        "columns": [
            "slot_id", "candidate_id", "job_id", "candidate_name", "candidate_email",
            "round", "status", "email_sent_at", "confirmed_at", "created_at",
            "slot_date", "slot_start_time", "slot_end_time", "interviewer_id",
            "interviewer_name", "interviewer_email", "job_title", "interview_mode",
        ],
            "notes": (
            "One row PER ROUND-INVITE per candidate. round stores 'round1'/'technical'/'hr' — HR "
            "says 'Round 1'=round1, 'Round 2'/'technical round'=technical, 'HR round'=hr. "
            "IMPORTANT — advancing does NOT immediately create a new row for the next round: when a "
            "candidate passes round1, their EXISTING round1 row simply gets status flipped to "
            "'advanced' — a new row with round='technical' only appears later, once they're actually "
            "invited to that next round. This means round+status TOGETHER indicate pipeline stage, "
            "not round alone. See RULES section for the exact, verified round+status combination for "
            "each pipeline stage (Round 1 / Round 2 / HR Round / Onboarding) — use those patterns "
            "precisely rather than inferring your own. "
            "STATUS progression per row: 'invited' (emailed, no slot picked yet — 'awaiting "
            "response'/'yet to respond') → 'scheduled' (picked a time, interview not yet done — "
            "'scheduled'/'upcoming'/'booked') → 'advanced' (interviewer submitted feedback, "
            "candidate passed this round and is now considered to be at the NEXT stage, per the "
            "RULES mapping)."
        ),
    },
    "interviewer_slots": {
        "columns": [
            "slot_id", "Interviewer_id", "job_id", "Interviewer_name", "Interviewer_email",
            "round", "day", "start_time", "end_time", "work_mode", "status", "created_at", "role",
        ],
        "notes": "Availability slots offered by interviewers. Note the capitalized Interviewer_* column names.",
    },
    "offer_letters": {
        "columns": [
            "job_id", "candidate_id", "candidate_name", "candidate_email", "designation",
            "base_ctc", "variable_pay", "esops", "joining_date", "work_location",
            "probation", "reporting_manager", "status", "created_at", "updated_at",
        ],
        "notes": "Offer letters, including compensation. Do not select offer_html (large blob).",
    },
    "referrals": {
        "columns": [
            "referral_id", "job_id", "candidate_id", "candidate_name", "candidate_email",
            "candidate_phone", "gender", "experience_years", "salary_currency",
            "salary_amount", "salary_frequency", "fit_reason", "referred_by", "submitted_at",
        ],
        "notes": "Employee-referred candidates.",
    },
        "users": {
        "columns": ["user_id", "email", "name", "roles", "status", "source", "granted_by", "created_at", "last_login_at"],
        "notes": (
            "Portal users (HR + interviewers). roles is a STRING, not an array — "
            "comma-separated with no fixed order, e.g. 'interviewer', 'hr', 'interviewer,hr', or 'hr,interviewer'. "
            "To check if a user has a given role, use LOWER(roles) LIKE LOWER('%role_name%') — never UNNEST(roles)."
        ),
    },
}

ALLOWED_TABLES = set(SCHEMA.keys())

INTERVIEWER_ALLOWED_TABLES = {
    "interviewer_slots", "candidate_slot_selections",
    "interview_feedback", "interview_round_questions",
}

# ─────────────────────────────────────────────────────────────────────────────
# ENUM DISCOVERY — ask BigQuery for real distinct values at runtime instead of
# hardcoding guesses, so the assistant stays correct as data changes.
# ─────────────────────────────────────────────────────────────────────────────

ENUM_COLUMNS = [
    ("jobs", "status"),
    ("jobs", "title"),
    ("candidates", "screening_status"),
    ("candidates", "candidate_result"),
    ("interview_feedback", "round"),
    ("interview_feedback", "verdict"),
    ("candidate_slot_selections", "status"),
    ("candidate_slot_selections", "round"),
    ("interviewer_slots", "status"),
    ("interviewer_slots", "role"),
    ("offer_letters", "status"),
    ("users", "roles"),
    ("users", "status"),
]

_enum_cache = {"values": None, "fetched_at": 0}


def _fetch_enum_values() -> dict:
    import time
    now = time.time()
    if _enum_cache["values"] is not None and (now - _enum_cache["fetched_at"]) < ENUM_CACHE_TTL_SEC:
        return _enum_cache["values"]

    results = {}
    for table, column in ENUM_COLUMNS:
        try:
            query = f"SELECT DISTINCT {column} FROM `{PROJECT_ID}.{DATASET_ID}.{table}` WHERE {column} IS NOT NULL LIMIT 30"
            rows = list(bq_client.query(query, timeout=QUERY_TIMEOUT_SEC).result())
            values = sorted({str(r[0]) for r in rows if r[0] is not None})
            results[f"{table}.{column}"] = values
        except Exception as e:
            print(f"[chat_agent] enum discovery skipped for {table}.{column}: {e}")

    _enum_cache["values"] = results
    _enum_cache["fetched_at"] = now
    return results


# Columns that must never appear in a generated query, even though the table
# itself is allowed — large blobs, embeddings, storage paths, raw HTML.
BLOCKED_COLUMNS = {
    "resume_embedding", "jd_embedding", "raw_resume_text", "gcs_pdf_path",
    "offer_html", "slot_details_json", "salary_breakup", "salary_rules",
    "ai_screening_results",
}

FORBIDDEN_SQL_KEYWORDS = [
    "insert", "update", "delete", "merge", "drop", "alter", "create",
    "truncate", "grant", "revoke", "call", "execute", "declare", "set ",
]


def _schema_prompt_block() -> str:
    enum_values = _fetch_enum_values()
    indexed = {}
    for key, values in enum_values.items():
        table, column = key.split(".", 1)
        indexed[(table, column)] = values

    lines = []
    for table, meta in SCHEMA.items():
        lines.append(f"- `{PROJECT_ID}.{DATASET_ID}.{table}` ({meta['notes']})")
        lines.append(f"  columns: {', '.join(meta['columns'])}")
        for (t, col), values in indexed.items():
            if t == table and values:
                lines.append(f"    {col} actual stored values: {values}")
    return "\n".join(lines)





def _build_sql_system_prompt(role: str = "hr", caller_email: str = "") -> str:
    schema_block = _schema_prompt_block()
    if role == "interviewer":
        prompt = INTERVIEWER_SQL_SYSTEM_PROMPT_TEMPLATE.replace("{schema_block}", schema_block)
        prompt = prompt.replace("{project_id}", PROJECT_ID).replace("{dataset_id}", DATASET_ID)
        prompt = prompt.replace("{caller_email}", caller_email or "unknown")
        return prompt
    return build_hr_sql_system_prompt(PROJECT_ID, DATASET_ID, schema_block)


def _format_history(history: list) -> str:
    if not history:
        return ""
    lines = ["Recent conversation (for resolving references like 'above', 'these', 'them'):"]
    for turn in history[-6:]:  # last few turns is enough context, keeps prompt small
        role = "User" if turn.get("role") == "user" else "Assistant"
        lines.append(f"{role}: {turn.get('text', '')}")
    return "\n".join(lines)


def _generate_sql(user_message: str, history: list = None, role: str = "hr", caller_email: str = "") -> dict:
    contents = [_build_sql_system_prompt(role, caller_email)]
    history_block = _format_history(history or [])
    if history_block:
        contents.append(history_block)
    contents.append(f"HR user question: {user_message}")

    response = genai_client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )
    try:
        return json.loads(response.text)
    except (json.JSONDecodeError, AttributeError):
        return {"clarify": "I had trouble understanding that request — could you rephrase it?"}


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — SQL guardrail
# ─────────────────────────────────────────────────────────────────────────────

def _validate_sql(sql: str, role: str = "hr", caller_email: str = "") -> str | None:
    """Returns an error string if the query is not allowed, else None."""
    lowered = sql.strip().lower()

    if not lowered.startswith("select") and not lowered.startswith("with"):
        return "Only SELECT queries are permitted."

    for kw in FORBIDDEN_SQL_KEYWORDS:
        if re.search(rf"\b{re.escape(kw.strip())}\b", lowered):
            return f"Query contains a forbidden keyword: {kw.strip()}"

    if re.search(r"select\s+\*", lowered):
        return "SELECT * is not permitted; explicit columns are required."

    if ";" in sql.strip().rstrip(";"):
        return "Multiple statements are not permitted."

    # Every referenced table must be one of the allowed, fully-qualified tables.
    referenced_tables = re.findall(
        rf"`?{re.escape(PROJECT_ID)}\.{re.escape(DATASET_ID)}\.([a-zA-Z_]+)`?",
        sql,
    )
    if not referenced_tables:
        return "Query does not reference an allowed, fully-qualified table."
    for t in referenced_tables:
        if t not in ALLOWED_TABLES:
            return f"Table '{t}' is not permitted."

        # Block sensitive columns by name, wherever they appear in the query text.
    for col in BLOCKED_COLUMNS:
        if re.search(rf"\b{re.escape(col)}\b", sql, flags=re.IGNORECASE):
            return f"Column '{col}' is not permitted."

    if role == "interviewer":
        for t in referenced_tables:
            if t not in INTERVIEWER_ALLOWED_TABLES:
                return f"Table '{t}' is not permitted for interviewer role."
        if not caller_email or caller_email.lower() not in lowered:
            return "Query does not scope to the caller's own email — blocked for interviewer role."

    return None


def _enforce_limit(sql: str, default_limit: int = 100) -> str:
    if re.search(r"\blimit\s+\d+", sql, flags=re.IGNORECASE):
        return sql
    return sql.rstrip().rstrip(";") + f"\nLIMIT {default_limit}"


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Execute against BigQuery
# ─────────────────────────────────────────────────────────────────────────────

def _run_query(sql: str) -> list[dict]:
    job_config = bigquery.QueryJobConfig(
        maximum_bytes_billed=200 * 1024 * 1024,  # 200MB safety cap
    )
    query_job = bq_client.query(sql, job_config=job_config, timeout=QUERY_TIMEOUT_SEC)
    rows = list(query_job.result(max_results=MAX_RESULT_ROWS))

    results = []
    for row in rows:
        record = {}
        for key, value in row.items():
            if hasattr(value, "isoformat"):
                value = value.isoformat()
            record[key] = value
        results.append(record)
    return results


# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Results -> plain-English answer
# ─────────────────────────────────────────────────────────────────────────────

ANSWER_SYSTEM_PROMPT = """You are an HR portal assistant. You will be given the HR user's original
question and the raw query results (JSON rows) that answer it.

Write a clear, well-structured answer for the HR user:
- If there are multiple rows/items, put EACH ONE ON ITS OWN LINE — use real newline characters
  between items, never a single run-on paragraph.
- Use **Name** (double asterisks) only around a candidate/person/job's name to bold it — nothing else.
- After the bolded name, put key details on the same line separated by " · " (e.g. "**Jane Doe** · 3.2 yrs · jane@x.com · Python, SQL").
- If there are zero rows, say so plainly — don't invent data.
- SPECIAL CASE — ambiguous partial name: if the question named a person by a partial name (e.g. just
  a first name) and the results contain MORE THAN ONE clearly different person (different emails/last
  names) who could match, do NOT just list all of them as if that's the answer. Instead ask which one
  they meant, showing each candidate's full name + email so they can pick, e.g.
  "There are a few people named Purushottam — did you mean **Purushottam Kakade**
  (purushottam.k@...) or **Purushottam Sharma** (purushottam.s@...)?"
- Never mention SQL, tables, columns, or that you ran a query. Just answer like a knowledgeable colleague.
- Keep it scannable — short lines, no dense paragraphs.
"""


def _summarize_results(user_message: str, rows: list[dict]) -> str:
    response = genai_client.models.generate_content(
        model=MODEL,
        contents=[
            ANSWER_SYSTEM_PROMPT,
            f"Original question: {user_message}",
            f"Query results (JSON): {json.dumps(rows, default=str)[:12000]}",
        ],
        config=types.GenerateContentConfig(temperature=0.3),
    )
    return (response.text or "").strip()


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT — POST /api/chat-agent
# ─────────────────────────────────────────────────────────────────────────────

router = APIRouter()

@router.post("/api/chat-agent")
async def chat_agent(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}

    user_message = (body.get('message') or '').strip()
    if not user_message:
        return JSONResponse({"error": "Missing 'message'"}, status_code=400)

    role = body.get('role', 'hr')
    caller_email = (body.get('email') or '').strip()

    history = body.get('history', [])
    gen = _generate_sql(user_message, history, role, caller_email)

    if "reply" in gen:
        return JSONResponse({"reply": gen["reply"]})
    if "clarify" in gen:
        return JSONResponse({"reply": gen["clarify"]})

    sql = gen.get("sql", "")
    if not sql:
        return JSONResponse({"reply": "I couldn't turn that into a query. Could you rephrase it?"})

    error = _validate_sql(sql, role, caller_email)
    if error:
        print(f"[chat_agent] BLOCKED SQL ({error}): {sql}")
        fallback_msg = (
            "I'm sorry, I can only share information related to your own interviews."
            if role == "interviewer" else
            "I can't run that request. Try asking about candidates, jobs, interviews, feedback, or offers."
        )
        return JSONResponse({"reply": fallback_msg})

    sql = _enforce_limit(sql)

    try:
        rows = _run_query(sql)
    except Exception as e:
        print(f"[chat_agent] QUERY ERROR: {e} | SQL: {sql}")
        return JSONResponse({"reply": "I ran into an issue fetching that data. Please try rephrasing your question."})

    reply = _summarize_results(user_message, rows)
    return JSONResponse({"reply": reply})