"""
Resume Processing Pipeline  —  Optimized
─────────────────────────────────────────
Key optimizations vs original:
  1. ThreadPoolExecutor  — process N resumes in parallel (default 10 workers)
  2. Batch embeddings    — one Vertex AI call for up to 5 texts at once
  3. Batch BQ inserts    — one insert_rows_json call per batch instead of one per resume
  4. GCS batch download  — threads overlap network I/O with CPU work
  5. Gemini async        — concurrent Gemini calls across threads
  6. process_resume_from_gcs no longer mutates a global (thread-safe rewrite)
"""

import json
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import fitz
from dateutil import parser as dateparser
from dateutil.relativedelta import relativedelta
from google.cloud import bigquery, storage
from google import genai
import vertexai
from vertexai.language_models import TextEmbeddingModel
import time


# ── CONFIG ────────────────────────────────────────────────────────────────────

PROJECT_ID      = "atgeir-moae-dev"
BUCKET_NAME     = "hr-data-source-at"
FOLDER_PATH     = "resume/Python_Developers"
DATASET_ID      = "hr_dataset"
TABLE_ID        = "candidates"
LOCATION        = "us-central1"
JOB_ID          = "job-002"

MAX_WORKERS     = 10   # parallel resume threads
EMBED_BATCH_SIZE = 5   # Vertex AI allows up to 5 texts per call
BQ_BATCH_SIZE   = 50   # rows to accumulate before flushing to BigQuery

# ─────────────────────────────────────────────────────────────────────────────


# ── CLIENTS (module-level singletons, created once) ───────────────────────────

gcs_client      = storage.Client(project=PROJECT_ID)
bq_client       = bigquery.Client(project=PROJECT_ID)
vertexai.init(project=PROJECT_ID, location=LOCATION)
embedding_model = TextEmbeddingModel.from_pretrained("text-embedding-004")
gemini_client   = genai.Client(
    vertexai = True,
    project  = PROJECT_ID,
    location = LOCATION,
)

# ─────────────────────────────────────────────────────────────────────────────


# ── STEP 1: List PDFs ─────────────────────────────────────────────────────────

def list_pdfs_in_folder(bucket_name: str = BUCKET_NAME,
                         folder_path: str = FOLDER_PATH) -> list[str]:
    print(f"\n  Listing PDFs in gs://{bucket_name}/{folder_path}/...")
    bucket    = gcs_client.bucket(bucket_name)
    pdf_files = [
        blob.name
        for blob in bucket.list_blobs(prefix=folder_path)
        if blob.name.lower().endswith(".pdf")
    ]
    print(f"  Found {len(pdf_files)} PDF files.")
    return pdf_files


# ── STEP 2: Extract text (unchanged — already fast) ───────────────────────────

def extract_text_from_pdf(file_name: str,
                           bucket_name: str = BUCKET_NAME) -> str:
    bucket    = gcs_client.bucket(bucket_name)
    pdf_bytes = bucket.blob(file_name).download_as_bytes()
    doc       = fitz.open(stream=pdf_bytes, filetype="pdf")
    text      = "".join(page.get_text() for page in doc)
    doc.close()
    return text.strip()


# ── STEP 3: Gemini field extraction (unchanged prompt, same model) ────────────

def extract_resume_fields(resume_text: str, current_date: str, retries: int = 4, backoff: float = 5.0) -> dict:
    prompt = f"""
You are a precise resume parser. Extract the following fields from the resume below.
Return ONLY a valid JSON object. No explanation. No markdown. Just JSON.

Today's date is: {current_date}
Use this date for any role marked as "Present", "Current", "Till date", or "Ongoing".

Fields to extract:

1. name          : full name of the candidate (string)
2. email         : email address (string or null)
3. phone         : phone number (string or null)

4. work_history  : list of all work experiences

   For each role extract:
   - company    : company/organization name
   - title      : job title
   - start_date : start date in YYYY-MM format e.g. "2022-05"
                  if only year mentioned use YYYY-01 e.g. "2022-01"
   - end_date   : end date in YYYY-MM format
                  if "Present" / "Current" / "Ongoing" use today: {current_date}
   - is_current : true if this is their current job, false otherwise

5. minimum_qualification:
   Find the HIGHEST degree the candidate holds anywhere in the resume.
   Degree hierarchy: PhD > Master's > Bachelor's > Diploma > 12th
   Always return the highest one found.

   Mapping:
     B.Tech, B.E., BE, B.Sc, BCA, BA, B.Com,
     Bachelor, Bachelors, UG, Undergraduate  -> "Bachelor's"

     M.Tech, ME, MBA, MCA, M.Sc, MSc, MS,
     Master, Masters, PG, PGDM, PGDCA,
     Post Graduate, PG Diploma              -> "Master's"

     PhD, Ph.D, Doctorate                   -> "PhD"

     Diploma, Polytechnic, ITI              -> "Diploma"
     (only if no Bachelor's or higher found)

     12th, HSC, Higher Secondary            -> "12th"
     (only if no Diploma or higher found)

   Examples:
     Diploma + B.Tech found  -> return "Bachelor's"
     B.Tech + MBA found      -> return "Master's"
     Only Diploma found      -> return "Diploma"
     Nothing found           -> return "not mentioned"

6. location      : candidate's current city and country (string or null)
                   e.g. "Pune, India" or "Bangalore, India"

7. last_organization : name of the most recent or current employer (string or null)
                       Use the company from the most recent work_history entry.

8. skills        : flat list of ALL skills mentioned anywhere in the resume
                   Include: programming languages, databases, tools, frameworks,
                   cloud platforms, methodologies, certifications, concepts
                   Return as a JSON array of strings
                   e.g. ["Python", "SQL", "Apache Spark", "AWS", "Docker"]

Resume:
{resume_text[:5000]}

Return exactly this JSON structure:
{{
  "name"                  : "...",
  "email"                 : "...",
  "phone"                 : "...",
  "work_history"          : [
    {{
      "company"    : "...",
      "title"      : "...",
      "start_date" : "YYYY-MM",
      "end_date"   : "YYYY-MM",
      "is_current" : true or false
    }}
  ],
  "minimum_qualification" : "Bachelor's or Master's or PhD or Diploma or not mentioned",
  "location"              : "...",
  "last_organization"     : "...",
  "skills"                : ["skill1", "skill2", "..."]
}}
"""
    
    # NEW: Wrap the API call in a retry loop
    for attempt in range(1, retries + 1):
        try:
            response = gemini_client.models.generate_content(
                model    = "gemini-2.5-flash",
                contents = prompt,
            )
            raw    = response.text.strip().replace("```json", "").replace("```", "").strip()
            return json.loads(raw)
            
        except Exception as e:
            msg = str(e).lower()
            is_rate_limit = "429" in msg or "quota" in msg or "exhausted" in msg
            if attempt < retries and is_rate_limit:
                wait = backoff * attempt
                print(f"  ⚠ Rate limit hit in resume_processing (attempt {attempt}/{retries}). Retrying in {wait}s...")
                time.sleep(wait)
            else:
                raise            

# ── STEP 4: Experience calc (pure Python, fast) ───────────────────────────────

def calculate_total_experience(work_history: list) -> float:
    if not work_history:
        return 0.0

    date_ranges = []
    for role in work_history:
        try:
            start = dateparser.parse(role.get("start_date", ""), default=datetime(2000, 1, 1))
            end   = dateparser.parse(role.get("end_date",   ""), default=datetime.now())
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
        (relativedelta(e, s).years * 12 + relativedelta(e, s).months)
        for s, e in merged
    )
    return round(total_months / 12, 2)


# ── STEP 5a: Batch embeddings — one API call for multiple texts ───────────────

def generate_embeddings_batch(texts: list[str]) -> list[list]:
    """
    Send up to EMBED_BATCH_SIZE texts in a single Vertex AI call.
    Returns a list of embedding vectors in the same order as `texts`.
    """
    results = embedding_model.get_embeddings([t[:3000] for t in texts])
    return [r.values for r in results]


# ── STEP 5b: Single-text wrapper (used inside per-resume thread) ──────────────

def generate_embedding(resume_text: str) -> list:
    return embedding_model.get_embeddings([resume_text[:3000]])[0].values


# ── STEP 6: BigQuery — batch insert ──────────────────────────────────────────

def flush_to_bigquery(rows: list[dict]) -> None:
    """Insert a list of row dicts via DML (no streaming buffer — immediately mutable)."""
    if not rows:
        return

    # BQ DML doesn't support FLOAT64 REPEATED or STRING REPEATED params, so
    # resume_embedding and skills are inlined as array literals.
    # All text fields use @params — safe against quotes, newlines, special chars.
    for r in rows:
        emb_literal    = "[" + ", ".join(str(float(x)) for x in (r.get("resume_embedding") or [])) + "]"
        skills_literal = "[" + ", ".join(
            "'" + str(s).replace("'", "''") + "'" for s in (r.get("skills") or [])
        ) + "]"
        query = f"""
            INSERT INTO `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`
              (candidate_id, job_id, name, email, phone, location,
               last_organization, minimum_qualification, total_experience_years,
               skills, raw_resume_text, resume_embedding, gcs_pdf_path,
               applied_at, screening_status, candidate_result)
            VALUES
              (@candidate_id, @job_id, @name, @email, @phone, @location,
               @last_organization, @minimum_qualification, @total_experience_years,
               {skills_literal}, @raw_resume_text, {emb_literal}, @gcs_pdf_path,
               @applied_at, @screening_status, @candidate_result)
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("candidate_id",           "STRING", r.get("candidate_id")           or ""),
                bigquery.ScalarQueryParameter("job_id",                 "STRING", r.get("job_id")                 or ""),
                bigquery.ScalarQueryParameter("name",                   "STRING", r.get("name")                   or ""),
                bigquery.ScalarQueryParameter("email",                  "STRING", r.get("email")                  or ""),
                bigquery.ScalarQueryParameter("phone",                  "STRING", r.get("phone")                  or ""),
                bigquery.ScalarQueryParameter("location",               "STRING", r.get("location")               or ""),
                bigquery.ScalarQueryParameter("last_organization",      "STRING", r.get("last_organization")      or ""),
                bigquery.ScalarQueryParameter("minimum_qualification",  "STRING", r.get("minimum_qualification")  or ""),
                bigquery.ScalarQueryParameter("total_experience_years", "FLOAT64",float(r.get("total_experience_years") or 0)),
                bigquery.ScalarQueryParameter("raw_resume_text",        "STRING", r.get("raw_resume_text")        or ""),
                bigquery.ScalarQueryParameter("gcs_pdf_path",           "STRING", r.get("gcs_pdf_path")           or ""),
                bigquery.ScalarQueryParameter("applied_at",             "TIMESTAMP", r.get("applied_at")             or ""),
                bigquery.ScalarQueryParameter("screening_status",       "STRING", r.get("screening_status")       or ""),
                bigquery.ScalarQueryParameter("candidate_result",       "STRING", r.get("candidate_result")       or ""),
            ]
        )
        bq_client.query(query, job_config=job_config).result()

    print(f"  ✓ Flushed {len(rows)} rows to BigQuery (DML).")


def build_bq_row(
    job_id, name, email, phone, location, last_organization,
    minimum_qualification, total_experience_years, skills,
    raw_resume_text, embedding, gcs_pdf_path,
) -> dict:
    return {
        "candidate_id":           str(uuid.uuid4()),
        "job_id":                 job_id,
        "name":                   name,
        "email":                  email,
        "phone":                  phone,
        "location":               location,
        "last_organization":      last_organization,
        "minimum_qualification":  minimum_qualification,
        "total_experience_years": total_experience_years,
        "skills":                 skills,
        "raw_resume_text":        raw_resume_text,
        "resume_embedding":       embedding,
        "gcs_pdf_path":           gcs_pdf_path,
        "applied_at":             datetime.now(timezone.utc).isoformat(),
        "screening_status":       "PENDING",
        "candidate_result":       "Not Screened",
    }


# ── CORE: Process one resume, return a BQ row dict ────────────────────────────

def _process_resume_to_row(
    file_name:   str,
    bucket_name: str = BUCKET_NAME,
    job_id:      str = JOB_ID,
) -> dict | None:
    """
    Download → parse → extract fields → embed.
    Returns a BQ row dict (does NOT write to BQ — caller batches writes).
    Returns None on any failure so the batch loop can skip it.
    """
    current_date = datetime.now().strftime("%Y-%m")
    try:
        raw_text = extract_text_from_pdf(file_name, bucket_name)
        if not raw_text:
            print(f"  ✗ No text in {file_name}. Skipping.")
            return None

        fields    = extract_resume_fields(raw_text, current_date)
        exp_years = calculate_total_experience(fields.get("work_history", []))
        embedding = generate_embedding(raw_text)

        row = build_bq_row(
            job_id                 = job_id,
            name                   = fields.get("name")                  or "Unknown",
            email                  = fields.get("email")                 or "Unknown",
            phone                  = fields.get("phone")                 or "Unknown",
            location               = fields.get("location")              or "India",
            last_organization      = fields.get("last_organization")     or "Unknown",
            minimum_qualification  = fields.get("minimum_qualification") or "not mentioned",
            total_experience_years = exp_years,
            skills                 = fields.get("skills")                or [],
            raw_resume_text        = raw_text,
            embedding              = embedding,
            gcs_pdf_path           = f"gs://{bucket_name}/{file_name}",
        )
        print(f"  ✓ {fields.get('name')} | {exp_years} yrs | {file_name}")
        return row

    except Exception as exc:
        print(f"  ✗ Failed [{file_name}]: {exc}")
        return None


# ── BATCH PIPELINE (main entry point) ─────────────────────────────────────────

def run_batch_pipeline(
    bucket_name: str = BUCKET_NAME,
    folder_path: str = FOLDER_PATH,
    job_id:      str = JOB_ID,
    max_workers: int = MAX_WORKERS,
) -> None:
    """
    Parallel resume processing:
      - MAX_WORKERS threads each run download + Gemini + embed concurrently
      - BQ rows are accumulated and flushed in batches of BQ_BATCH_SIZE
    """
    pdf_files = list_pdfs_in_folder(bucket_name, folder_path)
    if not pdf_files:
        print("✗ No PDFs found.")
        return

    print(f"\n  Processing {len(pdf_files)} resumes with {max_workers} parallel workers...\n")

    bq_batch:  list[dict] = []
    completed: int        = 0

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(_process_resume_to_row, f, bucket_name, job_id): f
            for f in pdf_files
        }

        for future in as_completed(futures):
            row = future.result()
            completed += 1

            if row:
                bq_batch.append(row)

            # Flush when batch is full
            if len(bq_batch) >= BQ_BATCH_SIZE:
                flush_to_bigquery(bq_batch)
                bq_batch = []

            print(f"  Progress: {completed}/{len(pdf_files)}")

    # Flush remainder
    flush_to_bigquery(bq_batch)
    print(f"\n  ✓ All done. {completed} resumes processed.\n")


# ── GCS TRIGGER MODE (thread-safe, no global mutation) ────────────────────────

def _is_already_processed(file_name: str, job_id: str) -> bool:
    """
    Idempotency guard: returns True if this GCS file is already in BQ.
    Prevents duplicate rows on GCS re-triggers (e.g. after a 429 retry).
    """
    query = f"""
        SELECT 1
        FROM `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`
        WHERE job_id      = @job_id
          AND gcs_pdf_path = @gcs_pdf_path
        LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("job_id",       "STRING", job_id),
            bigquery.ScalarQueryParameter("gcs_pdf_path", "STRING", f"gs://{BUCKET_NAME}/{file_name}"),
        ]
    )
    rows = list(bq_client.query(query, job_config=job_config).result())
    return len(rows) > 0


def process_resume_from_gcs(
    bucket_name: str,
    file_name:   str,
    job_id:      str,
) -> str:
    """
    Called by main.py when a new PDF is uploaded via GCS trigger.
    Thread-safe: accepts all params explicitly, no global writes.
    Uses DML INSERT (not streaming) so rows are immediately mutable.
    Returns candidate_id.
    """
    print(f"\n  [GCS Trigger] gs://{bucket_name}/{file_name}  job={job_id}")

    # ── Idempotency guard ──────────────────────────────────────────────────────
    if _is_already_processed(file_name, job_id):
        print(f"  ⚠ Already processed — skipping duplicate trigger: {file_name}")
        # Return the existing candidate_id from BQ
        query = f"""
            SELECT candidate_id
            FROM `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`
            WHERE job_id      = @job_id
              AND gcs_pdf_path = @gcs_pdf_path
            LIMIT 1
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("job_id",       "STRING", job_id),
                bigquery.ScalarQueryParameter("gcs_pdf_path", "STRING", f"gs://{bucket_name}/{file_name}"),
            ]
        )
        rows = list(bq_client.query(query, job_config=job_config).result())
        return rows[0].candidate_id if rows else None

    row = _process_resume_to_row(file_name, bucket_name, job_id)
    if row is None:
        raise ValueError(f"No extractable text in {file_name}")

    # ── DML INSERT (no streaming buffer — rows immediately mutable) ────────────
    # resume_embedding (FLOAT64 REPEATED) and skills (STRING REPEATED) must be
    # inlined as array literals. All text fields use @params.
    emb_literal    = "[" + ", ".join(str(float(x)) for x in (row.get("resume_embedding") or [])) + "]"
    skills_literal = "[" + ", ".join(
        "'" + str(s).replace("\\", "").replace("'", "''").replace("\n", " ").strip() + "'"
        for s in (row.get("skills") or [])
    ) + "]"
    # INSERT ... WHERE NOT EXISTS is the atomic dedup guard.
    # The separate _is_already_processed() check above handles the common case fast,
    # but concurrent triggers can still race past it before BQ DML propagates (~1-2s).
    # This WHERE NOT EXISTS makes the INSERT itself idempotent — only one row per
    # gcs_pdf_path will ever land, even under heavy burst uploads.
    query = f"""
        MERGE `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}` AS target
        USING (
            SELECT @job_id AS job_id, @gcs_pdf_path AS gcs_pdf_path
        ) AS source
        ON  target.job_id       = source.job_id
        AND target.gcs_pdf_path = source.gcs_pdf_path

        WHEN NOT MATCHED THEN
        INSERT (candidate_id, job_id, name, email, phone, location,
                last_organization, minimum_qualification, total_experience_years,
                skills, raw_resume_text, resume_embedding, gcs_pdf_path,
                applied_at, screening_status, candidate_result)
        VALUES (@candidate_id, @job_id, @name, @email, @phone, @location,
                @last_organization, @minimum_qualification, @total_experience_years,
                {skills_literal}, @raw_resume_text, {emb_literal}, @gcs_pdf_path,
                @applied_at, @screening_status, @candidate_result)

        WHEN MATCHED
        AND target.screening_status = 'PENDING' THEN
        UPDATE SET
            name                   = @name,
            email                  = @email,
            phone                  = @phone,
            location               = @location,
            last_organization      = @last_organization,
            minimum_qualification  = @minimum_qualification,
            total_experience_years = @total_experience_years,
            skills                 = {skills_literal},
            raw_resume_text        = @raw_resume_text,
            resume_embedding       = {emb_literal}
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("candidate_id",           "STRING",  row.get("candidate_id")           or ""),
            bigquery.ScalarQueryParameter("job_id",                 "STRING",  row.get("job_id")                 or ""),
            bigquery.ScalarQueryParameter("name",                   "STRING",  row.get("name")                   or ""),
            bigquery.ScalarQueryParameter("email",                  "STRING",  row.get("email")                  or ""),
            bigquery.ScalarQueryParameter("phone",                  "STRING",  row.get("phone")                  or ""),
            bigquery.ScalarQueryParameter("location",               "STRING",  row.get("location")               or ""),
            bigquery.ScalarQueryParameter("last_organization",      "STRING",  row.get("last_organization")      or ""),
            bigquery.ScalarQueryParameter("minimum_qualification",  "STRING",  row.get("minimum_qualification")  or ""),
            bigquery.ScalarQueryParameter("total_experience_years", "FLOAT64", float(row.get("total_experience_years") or 0)),
            bigquery.ScalarQueryParameter("raw_resume_text",        "STRING",  row.get("raw_resume_text")        or ""),
            bigquery.ScalarQueryParameter("gcs_pdf_path",           "STRING",  row.get("gcs_pdf_path")           or ""),
            bigquery.ScalarQueryParameter("applied_at",             "TIMESTAMP",  row.get("applied_at")             or ""),
            bigquery.ScalarQueryParameter("screening_status",       "STRING",  row.get("screening_status")       or ""),
            bigquery.ScalarQueryParameter("candidate_result",       "STRING",  row.get("candidate_result")       or ""),
        ]
    )
    bq_client.query(query, job_config=job_config).result()

    print(f"  ✓ GCS Trigger Done — {row['name']} | {row['candidate_id']}")
    return row["candidate_id"]


# ── MAIN ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n══ Resume Processing Pipeline Started (Optimized) ══")
    run_batch_pipeline()
    print("══ Pipeline Finished ══\n")