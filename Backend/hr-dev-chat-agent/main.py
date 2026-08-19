import os
import re
import json

# ── Must be set BEFORE any ADK/genai imports ─────────────────────────────────
os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "1"
os.environ["GOOGLE_CLOUD_PROJECT"]      = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
os.environ["GOOGLE_CLOUD_LOCATION"]     = "asia-south1"

from google.cloud import bigquery
import functions_framework

from google import genai
from google.genai import types

# ── Clients ───────────────────────────────────────────────────────────────────
bq_client  = bigquery.Client()
genai_client = genai.Client()

project_id = os.environ.get('GOOGLE_CLOUD_PROJECT', 'atgeir-moae-dev')
dataset_id = os.environ.get('BQ_DATASET_ID', 'hr_dataset')

MODEL = "gemini-2.5-flash"

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
            "ai_screening_results", "reject_reason",
        ],
        "notes": "One row per candidate application. Join to jobs via job_id.",
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
            "One row PER ROUND per candidate — a new row is added the moment a candidate is "
            "invited to a round, even before any interview happens or feedback exists. This is "
            "THE SOURCE OF TRUTH for 'what round is candidate X currently in' — a candidate's "
            "current round is whichever round has their MOST RECENT row here (by created_at), "
            "not interview_feedback (which only has rows for interviews that were actually "
            "completed and reviewed). round stores 'round1'/'technical'/'hr' — HR says "
            "'Round 1'=round1, 'Round 2'/'technical round'=technical, 'HR round'/'final round'=hr."
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

# ─────────────────────────────────────────────────────────────────────────────
# ENUM DISCOVERY — ask BigQuery for real distinct values at runtime instead of
# hardcoding guesses, so the assistant stays correct as data changes.
# ─────────────────────────────────────────────────────────────────────────────

ENUM_COLUMNS = [
    ("jobs", "status"),
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
            query = f"SELECT DISTINCT {column} FROM `{project_id}.{dataset_id}.{table}` WHERE {column} IS NOT NULL LIMIT 30"
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
        lines.append(f"- `{project_id}.{dataset_id}.{table}` ({meta['notes']})")
        lines.append(f"  columns: {', '.join(meta['columns'])}")
        for (t, col), values in indexed.items():
            if t == table and values:
                lines.append(f"    {col} actual stored values: {values}")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Natural language -> SQL
# ─────────────────────────────────────────────────────────────────────────────

SQL_SYSTEM_PROMPT_TEMPLATE = f"""You are a BigQuery SQL generator for an internal HR portal assistant.

You may ONLY use these tables and columns (nothing else exists, and nothing else is permitted).
Where a column has "actual stored values" listed, those are LIVE, real values queried moments ago
from the real table — trust them over any assumption you might otherwise make about casing or wording.

{{schema_block}}

RULES:
1. Output STRICT JSON only, matching one of these two shapes — no prose, no markdown fences:
   {{"sql": "SELECT ..."}}
   {{"clarify": "A short question to ask the HR user because their request is ambiguous or unanswerable with this schema."}}
2. The query must be a single SELECT statement. Never write INSERT/UPDATE/DELETE/MERGE/DROP/ALTER/CREATE or any DDL/DML.
3. Never use SELECT * — always list explicit columns from the schema above.
4. Never reference a table or column that isn't listed above.
5. Always fully qualify table names as `{project_id}.{dataset_id}.<table>`.
6. Always include a LIMIT clause (100 or fewer, unless the user clearly wants a count/aggregate).
7. Use JOINs on job_id / candidate_id where the question spans multiple tables (e.g. candidate name + interview verdict).
8. Prefer aggregate queries (COUNT, AVG, etc.) when the user asks "how many" / "average" rather than returning raw rows.
9. CURRENT-ROUND QUERIES: whenever the user asks "who is in round X" / "round X candidates" /
   "candidates currently at HR round" etc., use candidate_slot_selections (NOT interview_feedback —
   that table only has rows for completed/reviewed interviews and misses candidates still awaiting
   response). Rank rounds (round1=1, technical=2, hr=3), take each candidate's MOST RECENT row by
   created_at, and keep only candidates whose most recent round equals the requested round. Use this
   pattern:

   WITH ranked AS (
     SELECT candidate_id, job_id, round, created_at,
       ROW_NUMBER() OVER (PARTITION BY candidate_id, job_id ORDER BY created_at DESC) AS rn
     FROM `{project_id}.{dataset_id}.candidate_slot_selections`
   )
   SELECT candidate_id, job_id FROM ranked
   WHERE rn = 1 AND LOWER(round) = LOWER('<target_round>')

   Join this back to candidates for names/emails as needed. Only use interview_feedback instead if
   the user specifically asks about feedback, verdicts, ratings, or completed interviews.
10. For fixed/categorical values (statuses, verdicts, rounds — anything listed in "actual stored values"), match case-insensitively with LOWER(column) = LOWER('value').

11. If a column's "actual stored values" list is shown above, pick the closest matching value(s) from that real list rather than inventing one.
12. Some columns store multiple values as a comma-separated STRING (not a true array) — their notes will say so explicitly (e.g. users.roles). For those, use LOWER(column) LIKE LOWER('%value%'), never UNNEST. Only use UNNEST on a column explicitly documented as an actual ARRAY type.
13. For PEOPLE'S NAMES, EMAILS, and JOB TITLES — free-text fields, not fixed categories — never require an exact or full match. HR users routinely type partial names (a first name only, a nickname, a partial title). ALWAYS use LOWER(column) LIKE LOWER('%value%') for these fields so partial input still matches.
14. If the user's question refers back to a previous answer — explicitly ("above", "these", "them")
    OR implicitly (a short follow-up like "what about their experience" / "and their emails" that
    doesn't name any people/jobs on its own and only makes sense as a continuation) — look at the
    conversation history provided below and identify exactly which people/rows they mean. Prefer
    matching by email if the previous assistant reply included one, otherwise by full name. Build
    your WHERE clause to filter to ONLY those specific people (e.g. WHERE LOWER(email) IN
    (LOWER('a@x.com'), LOWER('b@x.com'))). When in doubt about whether a question is a continuation,
    check: does this question contain enough information to run standalone? If not, it's a
    continuation — use the history.
15. If the request is dangerous, destructive, unrelated to HR data, or clearly outside the schema, respond with {{"clarify": "..."}} with a short, natural, friendly question — never mention SQL, queries, or that you are a query generator.
"""


def _build_sql_system_prompt() -> str:
    return SQL_SYSTEM_PROMPT_TEMPLATE.replace("{schema_block}", _schema_prompt_block())


def _format_history(history: list) -> str:
    if not history:
        return ""
    lines = ["Recent conversation (for resolving references like 'above', 'these', 'them'):"]
    for turn in history[-6:]:  # last few turns is enough context, keeps prompt small
        role = "User" if turn.get("role") == "user" else "Assistant"
        lines.append(f"{role}: {turn.get('text', '')}")
    return "\n".join(lines)


def _generate_sql(user_message: str, history: list = None) -> dict:
    contents = [_build_sql_system_prompt()]
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

def _validate_sql(sql: str) -> str | None:
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
        rf"`?{re.escape(project_id)}\.{re.escape(dataset_id)}\.([a-zA-Z_]+)`?",
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
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

@functions_framework.http
def chat_agent(request):
    if request.method == 'OPTIONS':
        return ('', 204, {
            'Access-Control-Allow-Origin':  '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
        })
    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}

    try:
        body = request.get_json(silent=True) or {}
        user_message = (body.get('message') or '').strip()

        if not user_message:
            return (json.dumps({"error": "Missing 'message'"}), 400, headers)

        # ── Step 1: NL -> SQL ──
        history = body.get('history', [])
        gen = _generate_sql(user_message, history)

        if "clarify" in gen:
            return (json.dumps({"reply": gen["clarify"]}), 200, headers)

        sql = gen.get("sql", "")
        if not sql:
            return (json.dumps({"reply": "I couldn't turn that into a query. Could you rephrase it?"}), 200, headers)

        # ── Step 2: Guardrail ──
        error = _validate_sql(sql)
        if error:
            print(f"[chat_agent] BLOCKED SQL ({error}): {sql}")
            return (json.dumps({"reply": "I can't run that request. Try asking about candidates, jobs, interviews, feedback, or offers."}), 200, headers)

        sql = _enforce_limit(sql)

        # ── Step 3: Execute ──
        try:
            rows = _run_query(sql)
        except Exception as e:
            print(f"[chat_agent] QUERY ERROR: {e} | SQL: {sql}")
            return (json.dumps({"reply": "I ran into an issue fetching that data. Please try rephrasing your question."}), 200, headers)

        # ── Step 4: Summarize ──
        reply = _summarize_results(user_message, rows)

        return (json.dumps({"reply": reply}), 200, headers)

    except Exception as e:
        print(f"[chat_agent] ERROR: {e}")
        return (json.dumps({"error": str(e)}), 500, headers)