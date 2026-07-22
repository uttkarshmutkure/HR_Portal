"""
HR Pipeline — ADK Version (Rules Check Only)
─────────────────────────────────────────────
Agent does only:
  1. Fetch JD
  2. Vector Search    → find top 25 candidates
  3. Rules Filter     → check each candidate pass/fail

No ranking. No questions. Just to see how many candidates pass.
"""

import json
from google.cloud import bigquery
import vertexai
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types


# ── CONFIG ────────────────────────────────────────────────────────────────────

PROJECT_ID = "atgeir-moae-dev"
DATASET_ID = "hr_dataset"
LOCATION   = "us-central1"
JOB_ID     = "job-001"   # ← paste your job ID here
TOP_K      = 25                          # candidates from vector search

# ─────────────────────────────────────────────────────────────────────────────


# ── CLIENTS ───────────────────────────────────────────────────────────────────

bq_client = bigquery.Client(project=PROJECT_ID)
vertexai.init(project=PROJECT_ID, location=LOCATION)

# ── CLIENTS ───────────────────────────────────────────────────────

# Add this globally
from google import genai
gemini_client = genai.Client(
    vertexai = True,
    project  = PROJECT_ID,
    location = LOCATION
)
# ─────────────────────────────────────────────────────────────────────────────


# ── TOOL 1: Fetch JD ──────────────────────────────────────────────────────────

def fetch_jd(job_id: str) -> dict:
    """
    Fetch the full job description from BigQuery jobs table.

    Args:
        job_id: unique job ID to fetch.

    Returns:
        Dictionary with full JD details including rules and skills.
    """
    print(f"\n  [Tool] fetch_jd → job_id: {job_id}")

    query = f"""
        SELECT
            job_id, title, description,
            must_have_skills, preferred_skills,
            experience_min, experience_max,
            location, knockout_rules
        FROM `{PROJECT_ID}.{DATASET_ID}.jobs`
        WHERE job_id = @job_id
        LIMIT 1
    """

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("job_id", "STRING", job_id)
        ]
    )

    rows = list(bq_client.query(query, job_config=job_config).result())

    if not rows:
        return {"error": f"No job found for job_id: {job_id}"}

    row = rows[0]
    print(f"  [Tool] JD found: {row.title}")

    return {
        "job_id":           row.job_id,
        "title":            row.title,
        "description":      row.description,
        "must_have_skills": row.must_have_skills,
        "preferred_skills": row.preferred_skills,
        "experience_min":   row.experience_min,
        "experience_max":   row.experience_max,
        "location":         row.location,
        "knockout_rules":   row.knockout_rules,
    }


# ── TOOL 2: Vector Search ─────────────────────────────────────────────────────

def vector_search(job_id: str, top_k: int = 25) -> list:
    """
    Find the most similar candidates to a job using BigQuery vector search.

    Args:
        job_id: job ID to match candidates against.
        top_k : number of top candidates to return.

    Returns:
        List of candidates with name, email, resume text, similarity score.
    """
    print(f"\n  [Tool] vector_search → job_id: {job_id}, top_k: {top_k}")

    query = f"""
    SELECT
        base.candidate_id,
        base.name,
        base.email,
        base.phone,
        base.raw_resume_text,
        base.gcs_pdf_path,
        ROUND(1 - distance, 4) AS similarity_score
    FROM
        VECTOR_SEARCH(
            (
                SELECT
                    candidate_id, name, email, phone,
                    raw_resume_text, gcs_pdf_path,
                    resume_embedding
                FROM `{PROJECT_ID}.{DATASET_ID}.candidates`
                WHERE job_id = @job_id
            ),
            'resume_embedding',
            (
                SELECT
                    jd_embedding
                FROM `{PROJECT_ID}.{DATASET_ID}.jobs`
                WHERE job_id = @job_id
            ),
            'jd_embedding',
            top_k => @top_k,
            distance_type => 'COSINE'
        )
    ORDER BY similarity_score DESC
    """

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
            bigquery.ScalarQueryParameter("top_k",  "INT64",  top_k),
        ]
    )

    rows = list(bq_client.query(query, job_config=job_config).result())

    candidates = []
    for row in rows:
        candidates.append({
            "candidate_id":     row.candidate_id,
            "name":             row.name,
            "email":            row.email,
            "phone":            row.phone,
            "raw_resume_text":  row.raw_resume_text,
            "gcs_pdf_path":     row.gcs_pdf_path,
            "similarity_score": float(row.similarity_score),
        })

    print(f"  [Tool] vector_search returned {len(candidates)} candidates.")
    return candidates


# ── TOOL 3: Check Candidate Rules ─────────────────────────────────────────────

"""
Updated check_candidate_rules function.
Replace your existing check_candidate_rules function with this one.

Fixes included:
  1. Smart experience parsing  (3+, around 4, 3-5 years etc.)
  2. Must skills 70% threshold + fuzzy/synonym matching
  3. Location defaults to India if JD has none
  4. Last org should not be Atgeir Solutions
  5. Employment gap 2+ years in last 2 years → red flag
  6. Minimum qualification check (Bachelor's or as JD mentions)
"""

# ── HIRING COMPANY ────────────────────────────────────────────────────────────
HIRING_COMPANY = "Atgeir Solutions"
# ─────────────────────────────────────────────────────────────────────────────


def check_candidate_rules(
    candidate_name:   str,
    candidate_resume: str,
    must_have_skills: str,
    preferred_skills: str,
    experience_min:   int,
    experience_max:   int,
    location:         str,
    knockout_rules:   str,
) -> dict:
    """
    Check if a single candidate passes all the job rules.
    Uses Gemini to read the resume and evaluate against each rule.

    Args:
        candidate_name   : name of the candidate
        candidate_resume : full resume text of the candidate
        must_have_skills : comma separated must have skills from JD
        preferred_skills : comma separated preferred skills from JD
        experience_min   : minimum years of experience required
        experience_max   : maximum years of experience allowed
        location         : required job location (default India if empty)
        knockout_rules   : JSON string of additional knockout rules

    Returns:
        Dictionary with full evaluation result per rule.
    """
    print(f"\n  [Tool] check_candidate_rules → {candidate_name}")

    # Default location to India if not specified in JD
    effective_location = location if location and location.strip() else "India"

    prompt = f"""
You are a strict but fair HR screening expert.
Evaluate this candidate against each rule below carefully and thoroughly.
Return ONLY a valid JSON object. No explanation. No markdown. Just JSON.

════════════════════════════════════════
HIRING COMPANY: {HIRING_COMPANY}
════════════════════════════════════════

RULE 1 — EXPERIENCE CHECK
  Required range : {experience_min} to {experience_max} years
  Instructions:
  - Read the full resume and calculate total professional experience
  - Be smart about formats: "3+ years" = at least 3, "around 4 years" = 4,
    "3-5 years" = 3 to 5, internships count as 0.5 years each
  - Add up all work experience durations across all roles
  - If candidate has upto and between {experience_min} to {experience_max} then PASS else FAIL

RULE 2 — MUST HAVE SKILLS CHECK
  Must have skills : {must_have_skills}
  Instructions:
  - Check each must-have skill against the full resume
  - Use fuzzy and synonym matching:
      "Apache Spark" matches "PySpark", "Spark Streaming", "Spark SQL"
      "Python" matches "Python3", "Python 3.x"
      "Machine Learning" matches "ML", "scikit-learn", "model training"
      "SQL" matches "MySQL", "PostgreSQL", "T-SQL", "MSSQL"
      "Cloud" matches "AWS", "GCP", "Azure"
  - Candidate PASSES if they have at least 70% of must-have skills
  - Count how many skills match out of total must-have skills
  - Example: 7 out of 10 skills = 70% = PASS

RULE 3 — LOCATION CHECK
  Required location : {effective_location}
  Instructions:
  - Check if candidate is based in or willing to relocate to {effective_location}
  - If resume mentions same city, state, or country → PASS
  - If resume has no location mentioned → assume India → PASS
  - If resume clearly states a different country with no relocation mention → FAIL

RULE 4 — LAST ORGANIZATION CHECK
  Hiring company : {HIRING_COMPANY}
  Instructions:
  - Check the candidate's most recent or current employer
  - If their last or current organization is "{HIRING_COMPANY}" → FAIL
  - Any variation of the name counts: "Atgeir", "Atgeir Solutions Pvt Ltd" etc.
  - If last org is different or not mentioned → PASS

RULE 5 — EMPLOYMENT GAP CHECK
  Instructions:
  - Look at the candidate's work history timeline carefully
  - Check if there is any unexplained gap of 2 or more years
    in the last 5 years of their career
  - Gaps during education do NOT count
  - Gaps with explanation (career break, health, further studies) → note but PASS
  - Unexplained gaps of 2+ years → FAIL
  - If work history is continuous or gaps are less than 2 years → PASS

RULE 6 — MINIMUM QUALIFICATION CHECK
  Instructions:
  - Check the candidate's highest educational qualification
  - Minimum required: Bachelor's degree (B.E., B.Tech, B.Sc, BCA, BA, B.Com or equivalent)
  - If JD knockout rules mention a higher qualification like Master's → check for that
  - If candidate has Bachelor's or higher → PASS
  - If candidate only has diploma or no degree mentioned → FAIL
  - If education is not mentioned at all → mark as uncertain

════════════════════════════════════════
CANDIDATE RESUME:
{candidate_resume[:4000]}
════════════════════════════════════════

Return ONLY this exact JSON structure:
{{
  "overall_passed": true or false,

  "experience": {{
    "passed": true or false,
    "estimated_years": "e.g. 4.5 years",
    "reason": "brief explanation"
  }},

  "must_have_skills": {{
    "passed": true or false,
    "total_required": 0,
    "matched_count": 0,
    "match_percentage": 0,
    "matched_skills": ["list of matched skills"],
    "missing_skills": ["list of missing skills"],
    "reason": "brief explanation"
  }},

  "location": {{
    "passed": true or false,
    "candidate_location": "location found in resume or unknown",
    "reason": "brief explanation"
  }},

  "last_organization": {{
    "passed": true or false,
    "last_org_name": "name of last or current organization",
    "reason": "brief explanation"
  }},

  "employment_gap": {{
    "passed": true or false,
    "gap_found": true or false,
    "gap_duration": "e.g. 2.5 years or none",
    "gap_period": "e.g. 2021-2023 or none",
    "reason": "brief explanation"
  }},

  "qualification": {{
    "passed": true or false,
    "highest_qualification": "e.g. B.Tech Computer Science",
    "reason": "brief explanation"
  }},

  "failed_rules": ["list of rule names that failed, empty if all passed"],
  "overall_reason": "one line summary of why passed or failed"
}}
"""

    response = gemini_client.models.generate_content(
        model    = "gemini-2.5-flash",
        contents = prompt
    )
    raw = response.text.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()

    result = json.loads(raw)

    # ── Print summary ──────────────────────────────────────────────────────────
    status = "✓ PASSED" if result.get("overall_passed") else "✗ FAILED"

    exp   = result.get("experience", {})
    skills = result.get("must_have_skills", {})
    gap   = result.get("employment_gap", {})
    qual  = result.get("qualification", {})
    org   = result.get("last_organization", {})
    loc   = result.get("location", {})

    print(f"""
  ── {candidate_name} → {status} ──
     Experience    : {exp.get('estimated_years')}        → {'✓' if exp.get('passed') else '✗'}
     Must Skills   : {skills.get('matched_count')}/{skills.get('total_required')} ({skills.get('match_percentage')}%) → {'✓' if skills.get('passed') else '✗'}
     Missing Skills: {skills.get('missing_skills')}
     Location      : {loc.get('candidate_location')}     → {'✓' if loc.get('passed') else '✗'}
     Last Org      : {org.get('last_org_name')}          → {'✓' if org.get('passed') else '✗'}
     Gap Check     : {gap.get('gap_duration')}           → {'✓' if gap.get('passed') else '✗'}
     Qualification : {qual.get('highest_qualification')} → {'✓' if qual.get('passed') else '✗'}
     Failed Rules  : {result.get('failed_rules')}
     Reason        : {result.get('overall_reason')}
    """)

    return result


# ── BUILD ADK AGENT ───────────────────────────────────────────────────────────

def build_agent() -> Agent:
    """Build the HR rules checking agent."""

    agent = Agent(
        name        = "hr_rules_agent",
        model       = "gemini-2.5-flash",
        description = "HR agent that finds candidates and checks if they pass job rules.",
        instruction = f"""
You are an HR screening agent. Your job is to find candidates and check if they pass the job rules.

Follow these steps in order:

1. Call fetch_jd with the given job_id to get the full job details and rules.

2. Call vector_search with the job_id and top_k={TOP_K} to get similar candidates.

3. For EVERY candidate returned by vector_search:
   Call check_candidate_rules with:
   - candidate_name   = candidate name
   - candidate_resume = candidate raw_resume_text
   - must_have_skills = from JD
   - experience_min   = from JD
   - experience_max   = from JD
   - location         = from JD
   - knockout_rules   = from JD as string

   You MUST check every single candidate. Do not skip any.

4. After checking all candidates, return a clear summary:
   - Total candidates checked
   - How many passed
   - How many failed
   - For each candidate: name, similarity score, passed or failed, failed rules if any
""",
        tools = [
            fetch_jd,
            vector_search,
            check_candidate_rules,
        ],
    )

    return agent


# ── PRINT RESULTS ─────────────────────────────────────────────────────────────

def print_agent_response(response: str):
    print(f"\n\n{'═' * 60}")
    print("  RULES CHECK RESULTS")
    print(f"{'═' * 60}\n")
    print(response)
    print(f"\n{'═' * 60}\n")


# ── MAIN ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    import asyncio

    print("\n══ HR Rules Check Agent Started (ADK) ══\n")
    print(f"  Job ID : {JOB_ID}")
    print(f"  Top K  : {TOP_K}\n")

    agent           = build_agent()
    session_service = InMemorySessionService()
    runner          = Runner(
        agent           = agent,
        app_name        = "hr_rules_check",
        session_service = session_service,
    )

    goal = f"""
    Job ID: {JOB_ID}

    Step 1 - Fetch the JD.
    Step 2 - Find top {TOP_K} candidates using vector search.
    Step 3 - Check rules for every candidate.
    Step 4 - Show me how many passed and how many failed with details.
    """

    async def run():
        session = await session_service.create_session(
            app_name = "hr_rules_check",
            user_id  = "recruiter-001",
        )

        print("  Agent is running...\n")

        async for event in runner.run_async(
            user_id     = "recruiter-001",
            session_id  = session.id,
            new_message = genai_types.Content(
                role  = "user",
                parts = [genai_types.Part(text=goal)]
            )
        ):
            # Show final response only
            if event.is_final_response():
                final_text = ""
                for part in event.content.parts:
                    if hasattr(part, "text"):
                        final_text += part.text
                print_agent_response(final_text)

    asyncio.run(run())

    print("\n══ Agent Finished ══\n")
