"""
HR Screening Pipeline — Core Logic
────────────────────────────────────
Imported by main.py (Cloud Function entry point).
All BigQuery, Vertex AI, and email logic lives here.

Flow:
  1. Fetch JD + generate must_have and good_to_have clusters (once)
  2. Vector Search → Top K candidates
  3. Batch fetch ALL resumes in one BQ query
  4. Process ALL candidates in parallel (ThreadPoolExecutor):
     a. Identify relevant roles → Python calculates relevant experience
     b. Rules check using relevant experience + must_have clusters
     c. Good to have skill check (only for PASS / HUMAN_REVIEW)
     d. Calculate weighted final score
  5. Rank PASS candidates by final score → select Top N
  6. Generate interview questions in parallel (one thread per top candidate)
  7. Send email to recruiter

Weights:
  Similarity Score : 50%
  Must Have Match  : 30%
  Good to Have     : 20%
"""

import json
import logging
import os
import smtplib
import time
from concurrent.futures  import ThreadPoolExecutor, as_completed
from datetime            import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText

logging.basicConfig(
    level  = logging.INFO,
    format = "%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

from dateutil.relativedelta import relativedelta
from dateutil               import parser as dateparser
from google.cloud           import bigquery
import vertexai
from google import genai


# ── CONFIG (from environment variables with sane defaults) ────────────────────

PROJECT_ID     = os.environ.get("GOOGLE_CLOUD_PROJECT",  "atgeir-moae-dev")
DATASET_ID     = os.environ.get("BQ_DATASET_ID",         "hr_dataset")
LOCATION       = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
HIRING_COMPANY = os.environ.get("HIRING_COMPANY",        "Atgeir Solutions")

# Email — store these as Secret Manager secrets in production
GMAIL_SENDER       = os.environ.get("GMAIL_SENDER",       "uttkarsh.mutkure@atgeirsolutions.com")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "mvcybxqdwlnmwvza")
RECRUITER_EMAIL    = os.environ.get("RECRUITER_EMAIL",    "mutkureu@gmail.com")

# Parallelism — tune to your Gemini API quota
MAX_WORKERS_CANDIDATES = int(os.environ.get("MAX_WORKERS_CANDIDATES", "10"))
MAX_WORKERS_QUESTIONS  = int(os.environ.get("MAX_WORKERS_QUESTIONS",  "5"))

# Scoring weights
WEIGHT_SIMILARITY   = 0.5
WEIGHT_MUST_HAVE    = 0.3
WEIGHT_GOOD_TO_HAVE = 0.2


# ── CLIENTS (module-level; reused across requests in the same instance) ───────

bq_client = bigquery.Client(project=PROJECT_ID)

vertexai.init(project=PROJECT_ID, location=LOCATION)
gemini_client = genai.Client(
    vertexai = True,
    project  = PROJECT_ID,
    location = LOCATION,
)


# ── HELPER: LLM call with retry on 429 ───────────────────────────────────────

def llm_generate(prompt: str, retries: int = 3, backoff: float = 5.0) -> str:
    for attempt in range(1, retries + 1):
        try:
            response = gemini_client.models.generate_content(
                model    = "gemini-2.5-flash",
                contents = prompt,
            )
            return response.text.strip()
        except Exception as e:
            msg = str(e).lower()
            is_rate_limit = "429" in msg or "quota" in msg or "rate" in msg
            if attempt < retries and is_rate_limit:
                wait = backoff * attempt
                log.warning("Rate limit hit (attempt %d/%d). Retrying in %.0fs…", attempt, retries, wait)
                time.sleep(wait)
            else:
                raise
    raise RuntimeError("llm_generate: all retries exhausted")


def llm_json(prompt: str, retries: int = 3) -> dict | list:
    import re
    for attempt in range(1, retries + 1):
        raw   = llm_generate(prompt)
        clean = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        clean = re.sub(r"\s*```$", "", clean).strip()
        # Extract first JSON object or array — tolerates surrounding prose/noise
        match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", clean)
        if match:
            clean = match.group(1)
        try:
            return json.loads(clean)
        except json.JSONDecodeError as e:
            if attempt < retries:
                log.warning("llm_json parse failed (attempt %d/%d): %s — retrying…", attempt, retries, e)
            else:
                raise


# ── HELPER: Calculate experience from role list ───────────────────────────────

def calculate_experience_from_roles(roles: list) -> float:
    if not roles:
        return 0.0

    current_date = datetime.now()
    date_ranges  = []

    for role in roles:
        try:
            start_str = role.get("start_date", "")
            end_str   = role.get("end_date",   "")
            if not start_str:
                continue
            start = dateparser.parse(start_str, default=datetime(2000, 1, 1))
            end   = current_date if not end_str or end_str.lower() in [
                "present", "current", "ongoing", ""
            ] else dateparser.parse(end_str, default=current_date)
            if start and end and end >= start:
                date_ranges.append((start, end))
        except Exception:
            continue

    if not date_ranges:
        return 0.0

    date_ranges.sort(key=lambda x: x[0])
    merged = [date_ranges[0]]
    for start, end in date_ranges[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    total_months = sum(
        relativedelta(end, start).years * 12 + relativedelta(end, start).months
        for start, end in merged
    )
    return round(total_months / 12, 2)


# ── HELPER: Calculate weighted final score ────────────────────────────────────

def calculate_final_score(
    similarity_score       : float,
    must_have_percentage   : float,
    good_to_have_percentage: float,
) -> float:
    return round(
        similarity_score        * WEIGHT_SIMILARITY   +
        must_have_percentage    * WEIGHT_MUST_HAVE    +
        good_to_have_percentage * WEIGHT_GOOD_TO_HAVE,
        4,
    )


# ── STEP 1: Fetch JD + Generate Clusters ─────────────────────────────────────

def fetch_jd_with_clusters(job_id: str) -> dict:
    log.info("Fetching JD → %s", job_id)

    query = f"""
        SELECT
            job_id, title, description,
            must_have_skills, preferred_skills,
            experience_min, experience_max,
            location
        FROM `{PROJECT_ID}.{DATASET_ID}.jobs`
        WHERE job_id = @job_id
        LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("job_id", "STRING", job_id)]
    )
    rows = list(bq_client.query(query, job_config=job_config).result())
    if not rows:
        raise ValueError(f"No job found: {job_id}")

    row = rows[0]
    log.info("JD: %s | Exp: %s-%s yrs", row.title, row.experience_min, row.experience_max)

    jd = {
        "job_id":           row.job_id,
        "title":            row.title,
        "description":      row.description,
        "must_have_skills": row.must_have_skills,
        "preferred_skills": row.preferred_skills,
        "experience_min":   row.experience_min,
        "experience_max":   row.experience_max,
        "location":         row.location or "India",
    }

    log.info("Generating skill clusters…")
    clusters = generate_skill_clusters(
        must_have_skills = row.must_have_skills,
        preferred_skills = row.preferred_skills,
        jd_description   = row.description,
    )

    jd["must_have_clusters"]    = clusters["must_have_clusters"]
    jd["good_to_have_clusters"] = clusters["good_to_have_clusters"]

    log.info("Must Have Clusters (%d):", len(clusters["must_have_clusters"]))
    for c in clusters["must_have_clusters"]:
        log.info("  → %s: %s", c["cluster_name"], c["keywords"])

    log.info("Good to Have Clusters (%d):", len(clusters["good_to_have_clusters"]))
    for c in clusters["good_to_have_clusters"]:
        log.info("  → %s: %s", c["cluster_name"], c["keywords"])

    return jd


def generate_skill_clusters(
    must_have_skills: str,
    preferred_skills: str,
    jd_description  : str,
) -> dict:
    prompt = f"""
You are an HR skills analyst. Create TWO separate sets of skill clusters.

Must Have Skills : {must_have_skills}
Good to Have     : {preferred_skills}
JD Description   : {jd_description[:500]}

Instructions:
- must_have_clusters    → from must have skills ONLY. Do NOT include good to have.
- good_to_have_clusters → from preferred/good to have skills ONLY. Do NOT include must have.
- Group related skills logically (3 to 5 clusters per set)
- Include synonyms and related terms in keywords
  e.g. SQL cluster → SQL, T-SQL, PL/SQL, MySQL, PostgreSQL, MS SQL Server
- Every skill must appear in at least one cluster

Return ONLY this JSON. No explanation. No markdown:
{{
  "must_have_clusters": [
    {{"cluster_name": "short name", "keywords": ["keyword1", "synonym1"]}}
  ],
  "good_to_have_clusters": [
    {{"cluster_name": "short name", "keywords": ["keyword1", "synonym1"]}}
  ]
}}
"""
    return llm_json(prompt)


# ── STEP 2: Vector Search + Fetch Candidates ──────────────────────────────────

def vector_search_and_fetch(job_id: str, top_k: int) -> list:
    log.info("Running vector search → top_k: %d", top_k)

    vector_query = f"""
        SELECT
            base.candidate_id,
            ROUND(1 - distance, 4) AS similarity_score
        FROM VECTOR_SEARCH(
            (SELECT candidate_id, resume_embedding FROM `{PROJECT_ID}.{DATASET_ID}.candidates` WHERE job_id = @job_id AND screening_status = 'PENDING'),
            'resume_embedding',
            (SELECT jd_embedding FROM `{PROJECT_ID}.{DATASET_ID}.jobs` WHERE job_id = @job_id),
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
    vector_rows   = list(bq_client.query(vector_query, job_config=job_config).result())
    candidate_ids = [r.candidate_id for r in vector_rows]
    similarity_map = {r.candidate_id: float(r.similarity_score) for r in vector_rows}

    if not candidate_ids:
        log.warning("No candidates found for job_id: %s", job_id)
        return []

    ids_str    = ", ".join([f"'{cid}'" for cid in candidate_ids])
    fetch_rows = list(bq_client.query(f"""
        SELECT candidate_id, name, email, phone,
               location, last_organization,
               minimum_qualification,
               total_experience_years, skills
        FROM `{PROJECT_ID}.{DATASET_ID}.candidates`
        WHERE candidate_id IN ({ids_str})
    """).result())

    candidates = []
    for row in fetch_rows:
        candidates.append({
            "candidate_id":           row.candidate_id,
            "name":                   row.name,
            "email":                  row.email,
            "phone":                  row.phone,
            "location":               row.location              or "India",
            "last_organization":      row.last_organization     or "Unknown",
            "minimum_qualification":  row.minimum_qualification or "not mentioned",
            "total_experience_years": float(row.total_experience_years or 0),
            "skills":                 row.skills                if row.skills else [],
            "similarity_score":       similarity_map.get(row.candidate_id, 0.0),
        })

    candidates.sort(key=lambda x: x["similarity_score"], reverse=True)
    log.info("Fetched %d candidates.", len(candidates))
    return candidates


# ── STEP 3: Batch fetch ALL resumes in one BQ query ──────────────────────────

def fetch_all_resumes(candidate_ids: list) -> dict:
    if not candidate_ids:
        return {}

    log.info("Batch fetching %d resumes…", len(candidate_ids))
    ids_str = ", ".join([f"'{cid}'" for cid in candidate_ids])
    rows    = list(bq_client.query(f"""
        SELECT candidate_id, raw_resume_text
        FROM `{PROJECT_ID}.{DATASET_ID}.candidates`
        WHERE candidate_id IN ({ids_str})
    """).result())

    result = {r.candidate_id: r.raw_resume_text or "" for r in rows}
    log.info("Resumes fetched: %d", len(result))
    return result


# ── STEP 4a: Identify Relevant Roles ─────────────────────────────────────────

def identify_relevant_roles(
    candidate_name   : str,
    candidate_resume : str,
    jd_title         : str,
    jd_skills        : str,
    jd_description   : str,
) -> dict:
    current_date = datetime.now().strftime("%Y-%m")

    prompt = f"""
You are an expert HR analyst. Analyze each work role in this resume
and determine relevance to our specific JD.

Today's date : {current_date}
Use this for "Present", "Current", "Ongoing" roles.

OUR JD:
  Title   : {jd_title}
  Skills  : {jd_skills}
  Details : {jd_description[:600]}

RESUME:
{candidate_resume[:4000]}

For each role:
1. Read ACTUAL responsibilities — not just job title
2. Compare work against our JD skills and requirements
3. Assign overlap (0.0 to 1.0):
   1.0 → directly matches JD
   0.8 → heavily overlaps
   0.6 → 60% overlap (minimum to count as relevant)
   0.4 → partial overlap
   0.2 → rare overlap
   0.0 → no overlap (sales, marketing, HR, finance)
4. relevant = true if overlap >= 0.60

For dates: YYYY-MM format. "Present"/"Current" → {current_date}. Year only → YYYY-01.

multi_domain rules:
  true  → candidate has IRRELEVANT technical domain:
           Software Development, DevOps, Cybersecurity,
           Mechanical/Electrical Engineering, Embedded, Networking
  false → all other domains are RELATED to the JD role:
           Data Analysis, Analytics, BI, Cloud, Database Admin, ML

Return ONLY this JSON. No explanation. No markdown:
{{
  "relevant_roles": [
    {{"company": "name", "title": "title", "start_date": "YYYY-MM", "end_date": "YYYY-MM", "overlap": 0.0, "reason": "why relevant"}}
  ],
  "irrelevant_roles": [
    {{"company": "name", "title": "title", "start_date": "YYYY-MM", "end_date": "YYYY-MM", "overlap": 0.0, "reason": "why not relevant"}}
  ],
  "multi_domain" : true or false,
  "domains_found": ["distinct domains found"]
}}
"""
    result = llm_json(prompt)
    result["relevant_experience_years"]   = calculate_experience_from_roles(result.get("relevant_roles",   []))
    result["irrelevant_experience_years"] = calculate_experience_from_roles(result.get("irrelevant_roles", []))
    return result


# ── STEP 4b: Rules Check ──────────────────────────────────────────────────────

def check_candidate_rules(
    candidate_name            : str,
    candidate_resume          : str,
    candidate_skills          : str,
    relevant_experience_years : float,
    total_experience_years    : float,
    multi_domain              : bool,
    domains_found             : str,
    minimum_qualification     : str,
    candidate_location        : str,
    last_organization         : str,
    must_have_clusters        : list,
    must_have_skills          : str,
    experience_min            : int,
    experience_max            : int,
    required_location         : str,
) -> dict:
    effective_location = required_location if required_location and required_location.strip() else "India"
    current_date       = datetime.now().strftime("%Y-%m-%d")
    two_years_ago      = (datetime.now() - relativedelta(years=2)).strftime("%Y-%m-%d")

    clusters_text = ""
    for i, c in enumerate(must_have_clusters, 1):
        clusters_text += f"""
  Cluster {i} — {c['cluster_name']}
    Keywords : {', '.join(c['keywords'])}
    Intent   : Does the candidate satisfy the PURPOSE of this cluster?
               Judge by meaning — not exact keyword match.
               e.g. JIRA → implies Agile, PySpark → implies Spark,
               SSIS/ADF/Informatica → implies ETL experience.
"""

    prompt = f"""
You are a strict but fair HR screening expert.
Evaluate this candidate. Return ONLY valid JSON. No explanation. No markdown.

HIRING COMPANY : {HIRING_COMPANY}
TODAY          : {current_date}
TWO YEARS AGO  : {two_years_ago}

PRE-CALCULATED VALUES (use directly — do not recalculate):
  Relevant exp  : {relevant_experience_years} years
  Total exp     : {total_experience_years} years
  Qualification : {minimum_qualification}
  Location      : {candidate_location}
  Last org      : {last_organization}
  Skills        : {candidate_skills}
  Multi-domain  : {multi_domain}
  Domains       : {domains_found}

════════════════════════════════════════
RULE 1 — EXPERIENCE
  Relevant exp : {relevant_experience_years} yrs
  Required     : {experience_min} to {experience_max} yrs
  Buffer       : up to {round(experience_max * 1.15, 1)} yrs is acceptable

  A. {experience_min} <= {relevant_experience_years} <= {round(experience_max * 1.15, 1)} → PASS
  B. {relevant_experience_years} < {experience_min} AND multi_domain=true AND total >= {experience_min} → HUMAN_REVIEW
  C. {relevant_experience_years} > {round(experience_max * 1.15, 1)} AND skills strong → HUMAN_REVIEW
  D. {relevant_experience_years} < {experience_min} * 0.80 AND multi_domain=false → FAIL

RULE 2 — MUST HAVE SKILLS
  Candidate skills : {candidate_skills}
  Total clusters   : {len(must_have_clusters)}

  Evaluate candidate against these REQUIRED clusters only.
  Judge by INTENT — not exact keyword match:
{clusters_text}
  Cluster matched = true if candidate satisfies the intent.
  Match % = matched / {len(must_have_clusters)} clusters.
  PASS if >= 70% matched.

RULE 3 — LOCATION
  Required  : {effective_location}
  Candidate : {candidate_location}
  PASS if same city/state/country or not mentioned (assume India).
  FAIL only if clearly different country with no relocation mention.

RULE 4 — LAST ORGANIZATION
  FAIL if last org matches {HIRING_COMPANY} in any variation.
  PASS otherwise.

RULE 5 — EMPLOYMENT GAP
  Find the most recent date mentioned anywhere in the resume
  (job end date, certification date, education date, project date — anything).
  Compare with today ({current_date}):
  - Present/Current role → PASS
  - Most recent date on or after {two_years_ago} → PASS
  - Most recent date before {two_years_ago} + reason mentioned
    (medical/maternity/studies/personal/family/career break) → PASS flagged
  - Most recent date before {two_years_ago} + no reason → FAIL

RULE 6 — QUALIFICATION
  Pre-extracted highest qualification: {minimum_qualification}
  PASS if: Bachelor's / Master's / PhD
  FAIL if: Diploma / 12th / not mentioned
  Use this value directly. Do not re-read resume.

RESUME (for gap check only):
{candidate_resume[:3000]}

overall_result:
  PASS         → all rules passed
  HUMAN_REVIEW → any rule is human_review OR gap flagged OR multi_domain with good skills
  FAIL         → any critical rule failed

Return ONLY this JSON:
{{
  "overall_result"  : "PASS or HUMAN_REVIEW or FAIL",
  "overall_passed"  : true if PASS or HUMAN_REVIEW else false,
  "experience": {{
    "result"        : "PASS or HUMAN_REVIEW or FAIL",
    "relevant_years": {relevant_experience_years},
    "total_years"   : {total_experience_years},
    "reason"        : "explanation"
  }},
  "must_have_skills": {{
    "passed"          : true or false,
    "clusters_total"  : {len(must_have_clusters)},
    "clusters_matched": 0,
    "match_percentage": 0,
    "matched_clusters": [],
    "missing_clusters": [],
    "reason"          : "explanation"
  }},
  "location"         : {{"passed": true or false, "reason": "explanation"}},
  "last_organization": {{"passed": true or false, "reason": "explanation"}},
  "employment_gap"   : {{
    "passed"      : true or false,
    "gap_found"   : true or false,
    "gap_duration": "duration or none",
    "gap_reason"  : "reason or none",
    "flagged"     : true or false,
    "reason"      : "explanation"
  }},
  "qualification"      : {{"passed": true or false, "qualification_found": "what was found", "reason": "explanation"}},
  "human_review_reason": "why human review or none",
  "failed_rules"       : [],
  "flagged_rules"      : [],
  "overall_reason"     : "one line summary"
}}
"""
    return llm_json(prompt)


# ── STEP 4c: Good to Have Check ───────────────────────────────────────────────

def check_good_to_have(
    candidate_skills     : str,
    good_to_have_clusters: list,
) -> dict:
    if not good_to_have_clusters:
        return {
            "clusters_total": 0, "clusters_matched": 0,
            "match_percentage": 0.0, "matched_clusters": [], "missing_clusters": []
        }

    clusters_text = ""
    for i, c in enumerate(good_to_have_clusters, 1):
        clusters_text += f"  Cluster {i} — {c['cluster_name']}: {', '.join(c['keywords'])}\n"

    prompt = f"""
You are an HR skills analyst checking optional bonus skills.
Check which good-to-have clusters this candidate matches.
Judge by intent — not exact keyword match.

Candidate skills : {candidate_skills}

Good to Have Clusters:
{clusters_text}

Return ONLY this JSON. No explanation. No markdown:
{{
  "matched_clusters": ["cluster names that matched"],
  "missing_clusters": ["cluster names that did not match"]
}}
"""
    result    = llm_json(prompt)
    matched   = result.get("matched_clusters", [])
    missing   = result.get("missing_clusters", [])
    total     = len(good_to_have_clusters)
    match_pct = round(len(matched) / total, 4) if total > 0 else 0.0

    return {
        "clusters_total"  : total,
        "clusters_matched": len(matched),
        "match_percentage": match_pct,
        "matched_clusters": matched,
        "missing_clusters": missing,
    }


# ── STEP 4 (PARALLEL): Process one candidate end-to-end ──────────────────────
#
# Optimization: good_to_have only needs candidate skills — it is fully
# independent of roles and rules. So we fire it in a background thread
# immediately alongside the roles→rules serial chain.
#
# Timeline (before):  roles(5s) → rules(5s) → good_to_have(3s) = 13s
# Timeline (after):   roles(5s) → rules(5s)                     = 10s
#                     good_to_have(3s) ← already done in background
# Saves ~3s per candidate.
# ─────────────────────────────────────────────────────────────────────────────

def process_single_candidate(candidate: dict, jd: dict, resume_cache: dict) -> dict | None:
    name         = candidate["name"]
    candidate_id = candidate["candidate_id"]

    resume = resume_cache.get(candidate_id, "")
    if not resume:
        log.warning("No resume found for %s — skipping.", name)
        return None

    # ── Fire good_to_have immediately in background ───────────────────────────
    # It only needs candidate["skills"] — no dependency on roles or rules output.
    # We use a single background thread so it runs in parallel with 4a → 4b.
    with ThreadPoolExecutor(max_workers=1) as gth_pool:
        gth_future = gth_pool.submit(
            check_good_to_have,
            str(candidate["skills"]),
            jd["good_to_have_clusters"],
        )

        # 4a — Relevant roles (serial start of the dependent chain)
        try:
            relevance = identify_relevant_roles(
                candidate_name   = name,
                candidate_resume = resume,
                jd_title         = jd["title"],
                jd_skills        = jd["must_have_skills"],
                jd_description   = jd["description"],
            )
        except Exception as e:
            log.error("identify_relevant_roles failed [%s]: %s", name, e)
            gth_future.cancel()
            return None

        rel_exp = relevance["relevant_experience_years"]
        log.info("[%s] Relevant: %d roles → %.2f yrs", name, len(relevance.get("relevant_roles", [])), rel_exp)

        # 4b — Rules check (depends on roles output — still serial after 4a)
        try:
            rules_result = check_candidate_rules(
                candidate_name            = name,
                candidate_resume          = resume,
                candidate_skills          = str(candidate["skills"]),
                relevant_experience_years = rel_exp,
                total_experience_years    = candidate["total_experience_years"],
                multi_domain              = relevance["multi_domain"],
                domains_found             = str(relevance["domains_found"]),
                minimum_qualification     = candidate["minimum_qualification"],
                candidate_location        = candidate["location"],
                last_organization         = candidate["last_organization"],
                must_have_clusters        = jd["must_have_clusters"],
                must_have_skills          = jd["must_have_skills"],
                experience_min            = jd["experience_min"],
                experience_max            = jd["experience_max"],
                required_location         = jd["location"],
            )
        except Exception as e:
            log.error("check_candidate_rules failed [%s]: %s", name, e)
            gth_future.cancel()
            return None

        overall = rules_result.get("overall_result", "FAIL")
        skills  = rules_result.get("must_have_skills", {})

        # 4c — Collect good_to_have result (already running in background)
        # For FAIL candidates we discard the result — but we still .result()
        # to avoid leaving a dangling thread.
        good_to_have_result = {
            "clusters_total": 0, "clusters_matched": 0,
            "match_percentage": 0.0, "matched_clusters": [], "missing_clusters": []
        }
        try:
            gth_raw = gth_future.result()   # waits only if not yet done
            if overall in ["PASS", "HUMAN_REVIEW"]:
                good_to_have_result = gth_raw
        except Exception as e:
            log.error("check_good_to_have failed [%s]: %s", name, e)

    # 4d — Final score
    must_have_pct    = (skills.get("match_percentage", 0) or 0) / 100
    good_to_have_pct = good_to_have_result.get("match_percentage", 0.0)
    final_score      = calculate_final_score(
        similarity_score        = candidate["similarity_score"],
        must_have_percentage    = must_have_pct,
        good_to_have_percentage = good_to_have_pct,
    )

    log.info("[%s] → %s | score=%s", name, overall, final_score)

    return {
        "candidate_id"        : candidate_id,
        "name"                : name,
        "email"               : candidate["email"],
        "phone"               : candidate["phone"],
        "similarity_score"    : candidate["similarity_score"],
        "overall_result"      : overall,
        "must_have_pct"       : round(must_have_pct * 100),
        "must_have_missing"   : skills.get("missing_clusters", []),
        "good_to_have_matched": good_to_have_result.get("matched_clusters", []),
        "good_to_have_missing": good_to_have_result.get("missing_clusters", []),
        "good_to_have_pct"    : round(good_to_have_pct * 100),
        "final_score"         : final_score,
        "relevant_exp"        : rel_exp,
        "failed_rules"        : rules_result.get("failed_rules",        []),
        "flagged_rules"        : rules_result.get("flagged_rules",        []),
        "human_review_reason" : rules_result.get("human_review_reason", ""),
        "overall_reason"      : rules_result.get("overall_reason",       ""),
        "raw_resume"          : resume,
    }


# ── STEP 5: Generate Interview Questions ──────────────────────────────────────

def generate_interview_questions(
    candidate_name       : str,
    candidate_resume     : str,
    jd_title             : str,
    jd_description       : str,
    must_have_skills     : str,
    must_have_missing    : list,
    good_to_have_missing : list,
) -> list:
    all_gaps = list(set(must_have_missing + good_to_have_missing))

    prompt = f"""
You are an expert technical interviewer preparing for a candidate interview.
Generate exactly 5 personalised interview questions for this specific candidate.

════════════════════════════════════════
JOB:
  Title       : {jd_title}
  Description : {jd_description[:1500]}
  Must Have   : {must_have_skills}

SKILL GAPS:
  {all_gaps if all_gaps else "No major gaps identified — ask about depth"}
════════════════════════════════════════

CANDIDATE RESUME:
{candidate_resume[:4000]}
════════════════════════════════════════

Generate EXACTLY these 5 questions in this fixed order:

Q1 — skill_gap      : First missing skill / weakest area vs JD.
Q2 — skill_gap      : Second missing / different weak area. Must differ from Q1.
Q3 — validation     : ONE specific impressive claim from resume — ask them to elaborate.
Q4 — technical      : Deep technical question for this role and candidate level.
Q5 — behavioural    : Situation-based, relevant to this type of work.

Rules:
- Every question must be specific to THIS candidate and THIS JD
- Q3 must reference a specific claim from the resume
- No generic questions

Return ONLY this JSON. No explanation. No markdown:
[
  {{"type": "skill_gap",    "question": "question text"}},
  {{"type": "skill_gap",    "question": "question text"}},
  {{"type": "validation",   "question": "question text"}},
  {{"type": "technical",    "question": "question text"}},
  {{"type": "behavioural",  "question": "question text"}}
]
"""
    questions = llm_json(prompt)
    log.info("Questions generated for %s", candidate_name)
    return questions


def generate_questions_for_candidate(candidate: dict, jd: dict) -> dict:
    try:
        candidate["questions"] = generate_interview_questions(
            candidate_name       = candidate["name"],
            candidate_resume     = candidate["raw_resume"],
            jd_title             = jd["title"],
            jd_description       = jd["description"],
            must_have_skills     = jd["must_have_skills"],
            must_have_missing    = candidate.get("must_have_missing",    []),
            good_to_have_missing = candidate.get("good_to_have_missing", []),
        )
    except Exception as e:
        log.error("Questions failed for %s: %s", candidate["name"], e)
        candidate["questions"] = []
    return candidate


# ── STEP 6: Send Email ────────────────────────────────────────────────────────

def send_recruiter_email(top_candidates: list, jd_title: str, job_id: str) -> bool:
    log.info("Sending email to: %s", RECRUITER_EMAIL)

    body = f"""<!DOCTYPE html>
<html>
<head>
<style>
  body        {{ font-family: Inter, Arial, sans-serif; color: #1f2937; background: #f9fafb; margin: 0; padding: 20px; }}
  .container  {{ max-width: 800px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
  h1          {{ color: #1e40af; font-size: 24px; margin-bottom: 4px; }}
  h2          {{ color: #1e40af; font-size: 18px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-top: 32px; }}
  .subtitle   {{ color: #6b7280; font-size: 14px; margin-bottom: 24px; }}
  .stat-row   {{ display: flex; gap: 16px; margin-bottom: 24px; }}
  .stat       {{ background: #eff6ff; border-radius: 8px; padding: 12px 20px; text-align: center; flex: 1; }}
  .stat-num   {{ font-size: 28px; font-weight: 700; color: #1e40af; }}
  .stat-label {{ font-size: 12px; color: #6b7280; }}
  .card       {{ border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; margin-bottom: 20px; }}
  .rank-badge {{ display: inline-block; background: #1e40af; color: white; border-radius: 20px; padding: 2px 12px; font-size: 12px; font-weight: 600; margin-bottom: 8px; }}
  .score-row  {{ display: flex; gap: 12px; margin: 12px 0; flex-wrap: wrap; }}
  .score-item {{ background: #f3f4f6; border-radius: 6px; padding: 6px 12px; font-size: 13px; }}
  .score-val  {{ font-weight: 700; color: #1e40af; }}
  .gap-box    {{ background: #fff7ed; border-left: 3px solid #f97316; padding: 8px 12px; border-radius: 4px; margin: 8px 0; font-size: 13px; }}
  .q-item     {{ margin: 8px 0; padding: 10px 14px; background: #f9fafb; border-radius: 6px; font-size: 14px; }}
  .q-type     {{ display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-right: 8px; }}
  .skill_gap  {{ background: #fef3c7; color: #92400e; }}
  .validation {{ background: #dbeafe; color: #1e40af; }}
  .technical  {{ background: #d1fae5; color: #065f46; }}
  .behavioural{{ background: #ede9fe; color: #5b21b6; }}
  .footer     {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; text-align: center; }}
</style>
</head>
<body>
<div class="container">
  <h1>HR Screening Results</h1>
  <p class="subtitle">Job: <strong>{jd_title}</strong> &nbsp;|&nbsp; ID: {job_id}</p>
  <div class="stat-row">
    <div class="stat"><div class="stat-num">{len(top_candidates)}</div><div class="stat-label">Top Candidates</div></div>
    <div class="stat"><div class="stat-num">{len([c for c in top_candidates if c['overall_result'] == 'PASS'])}</div><div class="stat-label">Fully Passed</div></div>
    <div class="stat"><div class="stat-num">{len([c for c in top_candidates if c['overall_result'] == 'HUMAN_REVIEW'])}</div><div class="stat-label">Human Review</div></div>
  </div>
  <h2>Top Candidates</h2>
"""

    for rank, c in enumerate(top_candidates, start=1):
        questions = c.get("questions", [])
        all_gaps  = list(set(c.get("must_have_missing", []) + c.get("good_to_have_missing", [])))

        body += f"""
  <div class="card">
    <span class="rank-badge">Rank #{rank}</span>
    <h3 style="margin:4px 0">{c['name']} <span style="color:#6b7280;font-weight:400;font-size:14px">[{c['overall_result']}]</span></h3>
    <p style="color:#6b7280;font-size:13px;margin:4px 0">{c['email']} &nbsp;|&nbsp; {c.get('phone','N/A')}</p>
    <div class="score-row">
      <div class="score-item">Final Score <span class="score-val">{c['final_score']}</span></div>
      <div class="score-item">Similarity <span class="score-val">{c['similarity_score']}</span></div>
      <div class="score-item">Must Have <span class="score-val">{c['must_have_pct']}%</span></div>
      <div class="score-item">Good to Have <span class="score-val">{c['good_to_have_pct']}%</span></div>
      <div class="score-item">Relevant Exp <span class="score-val">{c['relevant_exp']} yrs</span></div>
    </div>
"""
        if all_gaps:
            body += f'    <div class="gap-box"><strong>Skill Gaps:</strong> {", ".join(all_gaps)}</div>\n'

        if c.get("human_review_reason") and c["human_review_reason"] not in ["none", ""]:
            body += f'    <div class="gap-box"><strong>⚠ Human Review:</strong> {c["human_review_reason"]}</div>\n'

        body += "    <p style='font-weight:600;margin:12px 0 6px'>Interview Questions:</p>\n"
        for i, q in enumerate(questions, 1):
            qtype = q.get("type", "technical")
            body += f'    <div class="q-item"><span class="q-type {qtype}">{qtype.upper().replace("_"," ")}</span><strong>Q{i}.</strong> {q["question"]}</div>\n'

        body += "  </div>\n"

    body += """
  <div class="footer">Generated by HR Screening Pipeline &nbsp;|&nbsp; Atgeir Solutions</div>
</div>
</body>
</html>"""

    try:
        msg            = MIMEMultipart("alternative")
        msg["Subject"] = f"HR Screening Results — {jd_title} ({len(top_candidates)} Candidates)"
        msg["From"]    = GMAIL_SENDER
        msg["To"]      = RECRUITER_EMAIL
        msg.attach(MIMEText(body, "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(GMAIL_SENDER, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_SENDER, RECRUITER_EMAIL, msg.as_string())

        log.info("Email sent to %s", RECRUITER_EMAIL)
        return True

    except Exception as e:
        log.error("Email failed: %s", e)
        return False


# ── MAIN PIPELINE ─────────────────────────────────────────────────────────────

def run_pipeline(job_id: str, top_k: int = 30, top_n: int = 5) -> dict:
    """
    Callable from Cloud Function (main.py) or local CLI.
    Returns summary dict — raw_resume is stripped before returning to caller.
    """
    pipeline_start = time.time()

    log.info("══ HR Screening Pipeline (Parallel) ══")
    log.info("Job: %s | top_k=%d | top_n=%d", job_id, top_k, top_n)
    log.info("Workers — candidates: %d | questions: %d", MAX_WORKERS_CANDIDATES, MAX_WORKERS_QUESTIONS)

    # Step 1
    t0 = time.time()
    jd = fetch_jd_with_clusters(job_id)
    log.info("Step 1 done in %.1fs", time.time() - t0)

    # Fetch ALL candidate IDs for this job BEFORE vector search trims to top_k
    all_job_candidate_ids_query = f"""
        SELECT candidate_id
        FROM `{PROJECT_ID}.{DATASET_ID}.candidates`
        WHERE job_id = @job_id AND screening_status = 'PENDING'
    """
    job_config_all = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("job_id", "STRING", job_id)]
    )
    all_job_candidate_ids = [
        r.candidate_id
        for r in bq_client.query(all_job_candidate_ids_query, job_config=job_config_all).result()
    ]
    log.info("Total PENDING candidates for job: %d", len(all_job_candidate_ids))

    # Step 2
    t0         = time.time()
    candidates = vector_search_and_fetch(job_id, top_k)
    if not candidates:
        return {"error": "No candidates found", "job_id": job_id}
    log.info("Step 2 done in %.1fs", time.time() - t0)

    # Step 3
    t0           = time.time()
    resume_cache = fetch_all_resumes([c["candidate_id"] for c in candidates])
    log.info("Step 3 done in %.1fs", time.time() - t0)

    # Step 4 — parallel screening
    t0 = time.time()
    log.info("Screening %d candidates (%d workers)…", len(candidates), MAX_WORKERS_CANDIDATES)

    results = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS_CANDIDATES) as executor:
        futures = {
            executor.submit(process_single_candidate, c, jd, resume_cache): c
            for c in candidates
        }
        for future in as_completed(futures):
            try:
                result = future.result()
                if result:
                    results.append(result)
            except Exception as e:
                cand = futures[future]
                log.error("Unhandled error for %s: %s", cand["name"], e)

    log.info("Step 4 done in %.1fs | %d candidates processed", time.time() - t0, len(results))

    # Step 5 — rank
    passed       = sorted([r for r in results if r["overall_result"] == "PASS"],         key=lambda x: x["final_score"], reverse=True)
    human_review = sorted([r for r in results if r["overall_result"] == "HUMAN_REVIEW"], key=lambda x: x["final_score"], reverse=True)
    failed       = [r for r in results if r["overall_result"] == "FAIL"]

    top_candidates = (passed + human_review)[:top_n]

    log.info("Results: %d PASS | %d HUMAN_REVIEW | %d FAIL", len(passed), len(human_review), len(failed))
    for i, c in enumerate(top_candidates, 1):
        log.info("  %d. %s [%s] score=%s", i, c["name"], c["overall_result"], c["final_score"])

    # Step 6 — parallel question generation
    t0 = time.time()
    log.info("Generating questions (%d workers)…", MAX_WORKERS_QUESTIONS)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS_QUESTIONS) as executor:
        top_candidates = list(executor.map(
            lambda c: generate_questions_for_candidate(c, jd),
            top_candidates,
        ))
    log.info("Step 6 done in %.1fs", time.time() - t0)

    # Step 7 — email
    send_recruiter_email(
        top_candidates = top_candidates,
        jd_title       = jd["title"],
        job_id         = job_id,
    )

    # ── Step 8 — Update BQ status for all candidates in one batch ────────────
    #
    # Single UPDATE via UNNEST STRUCT array covers all candidates (passed /
    # review / failed) in one BQ round-trip. No buffer wait needed because
    # resumes are now inserted via DML (not streaming insert_rows_json).
    # ─────────────────────────────────────────────────────────────────────────

    def _batch_update_bq_status(result_groups: dict, all_candidate_ids: list) -> None:
        all_data = []
        screened_ids = set()

        for result_label, candidate_list in result_groups.items():
            for c in candidate_list:
                screened_ids.add(c["candidate_id"])
                
                # Bundle all AI metrics into a single dictionary
                ai_metrics = {
                    "similarity_score": float(c.get("similarity_score", 0.0)),
                    "final_score": float(c.get("final_score", 0.0)),
                    "overall_result": c.get("overall_result", ""),
                    "overall_reason": c.get("overall_reason", ""),
                    "human_review_reason": c.get("human_review_reason", ""),
                    "must_have_pct": float(c.get("must_have_pct", 0.0)),
                    "must_have_missing": c.get("must_have_missing", []),
                    
                    # ── FIXED KEYS TO MATCH FRONTEND EXPECTATIONS ──
                    "good_to_have_pct": float(c.get("good_to_have_pct", 0.0)),
                    "good_to_have_missing": c.get("good_to_have_missing", []),
                    "failed_rules": c.get("failed_rules", []),
                    "flagged_rules": c.get("flagged_rules", []),
                    "questions": c.get("questions", []),
                    # ───────────────────────────────────────────────
                    
                    "relevant_exp": str(c.get("relevant_exp", ""))
                }
                
                # Convert to JSON string and safely escape single quotes for the SQL query
                ai_json_str = json.dumps(ai_metrics).replace("'", "\\'")

                all_data.append({
                    "candidate_id": c["candidate_id"],
                    "result_label": result_label,
                    "ai_json": ai_json_str
                })

        # Handle candidates that were not in the top K
        for cid in all_candidate_ids:
            if cid not in screened_ids:
                empty_metrics = json.dumps({
                    "similarity_score": 0.0, "final_score": 0.0, "overall_result": "Not Eligible",
                    "overall_reason": "", "human_review_reason": "", "must_have_pct": 0.0,
                    "must_have_missing": [], 
                    "good_to_have_pct": 0.0,
                    "good_to_have_missing": [],
                    "failed_rules": [],
                    "flagged_rules": [],
                    "questions": [],
                    "relevant_exp": ""
                })
                all_data.append({
                    "candidate_id": cid,
                    "result_label": "Archive",
                    "ai_json": empty_metrics
                })

        if not all_data:
            return

        # Construct the STRUCT rows mapped to the BigQuery schema
        struct_rows = ", ".join([
            f"STRUCT('{d['candidate_id']}' AS candidate_id, '{d['result_label']}' AS result_label, "
            f"SAFE.PARSE_JSON('{d['ai_json']}') AS ai_results)"
            for d in all_data
        ])

        update_query = f"""
           UPDATE `{PROJECT_ID}.{DATASET_ID}.candidates` AS c
            SET
            screening_status = 'COMPLETED',
            candidate_result = result_map.result_label,
            ai_screening_results = result_map.ai_results
            FROM (
            SELECT * FROM UNNEST([{struct_rows}])
            ) AS result_map
            WHERE c.candidate_id = result_map.candidate_id
        """

        try:
            bq_client.query(update_query).result()
            log.info("BQ JSON status update done — %d total", len(all_data))
        except Exception as e:
            log.error("Batch BQ status update failed: %s", e)

    # Single batch UPDATE across all groups
    _batch_update_bq_status({
        "Passed"      : passed,
        "Human Review": human_review,
        "Archive"     : failed,
    }, all_candidate_ids=all_job_candidate_ids)

    total_time = time.time() - pipeline_start
    log.info("══ Pipeline complete in %.1fs (%.1f min) ══", total_time, total_time / 60)

    return {
        "job_id"          : job_id,
        "jd_title"        : jd["title"],
        "total_candidates": len(candidates),
        "passed"          : len(passed),
        "human_review"    : len(human_review),
        "failed"          : len(failed),
        "top_candidates"  : [
            {k: v for k, v in c.items() if k != "raw_resume"}
            for c in top_candidates          # top N — for Top 5 tab
        ],
        "all_passed"      : [
            {k: v for k, v in c.items() if k != "raw_resume"}
            for c in passed                  # ALL passed, ranked by score
        ],
        "all_failed"      : [
            {k: v for k, v in c.items() if k != "raw_resume"}
            for c in failed                  # ALL failed candidates
        ],
        "all_human_review": [
            {k: v for k, v in c.items() if k != "raw_resume"}
            for c in human_review            # ALL human review candidates
        ],
        "runtime_seconds" : round(total_time, 1),
    }