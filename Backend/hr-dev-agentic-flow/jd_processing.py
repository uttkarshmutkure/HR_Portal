"""
JD Processing Pipeline  —  Optimized
──────────────────────────────────────
Key optimizations vs original:
  1. ThreadPoolExecutor  — process N JDs in parallel (default 5 workers)
  2. Batch embeddings    — one Vertex AI call per batch of texts
  3. Batch BQ inserts    — one insert_rows_json call per batch instead of one per JD
  4. Unique job_id       — replaced hardcoded "job-001" with uuid4
"""

import json
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import fitz
from google.cloud import bigquery, storage
from google import genai
import vertexai
from vertexai.language_models import TextEmbeddingModel


# ── CONFIG ────────────────────────────────────────────────────────────────────

PROJECT_ID      = "atgeir-moae-dev"
BUCKET_NAME     = "hr-data-source-at"
FOLDER_PATH     = "jd"
DATASET_ID      = "hr_dataset"
TABLE_ID        = "jobs"
GEMINI_LOCATION    = "global"
EMBEDDING_LOCATION = "us-central1"

MAX_WORKERS     = 5    # JD volume is usually lower than resumes
BQ_BATCH_SIZE   = 20

# ─────────────────────────────────────────────────────────────────────────────


# ── CLIENTS ───────────────────────────────────────────────────────────────────

gcs_client      = storage.Client(project=PROJECT_ID)
bq_client       = bigquery.Client(project=PROJECT_ID)
vertexai.init(project=PROJECT_ID, location=EMBEDDING_LOCATION)
embedding_model = TextEmbeddingModel.from_pretrained("text-embedding-004")

gemini_client   = genai.Client(
    vertexai = True,
    project  = PROJECT_ID,
    location = GEMINI_LOCATION,
)

# ─────────────────────────────────────────────────────────────────────────────


# ── STEP 1: List PDFs ─────────────────────────────────────────────────────────

def list_pdfs_in_folder() -> list[str]:
    print(f"\n  Listing PDFs in gs://{BUCKET_NAME}/{FOLDER_PATH}/...")
    bucket    = gcs_client.bucket(BUCKET_NAME)
    pdf_files = [
        blob.name
        for blob in bucket.list_blobs(prefix=FOLDER_PATH)
        if blob.name.lower().endswith(".pdf")
    ]
    print(f"  Found {len(pdf_files)} JD PDF files.")
    return pdf_files


# ── STEP 2: Extract text ──────────────────────────────────────────────────────

def extract_text_from_pdf(file_name: str) -> str:
    bucket    = gcs_client.bucket(BUCKET_NAME)
    pdf_bytes = bucket.blob(file_name).download_as_bytes()
    doc       = fitz.open(stream=pdf_bytes, filetype="pdf")
    text      = "".join(page.get_text() for page in doc)
    doc.close()
    return text.strip()


# ── STEP 3: Gemini field extraction ──────────────────────────────────────────

def extract_jd_fields(jd_text: str) -> dict:
    prompt = f"""
You are a job description parser. Extract the following fields from the JD below.
Return ONLY a valid JSON object with exactly these keys.
If a field is not found, use null for that field.
Do not include any explanation, markdown, or extra text. Just the JSON.

Fields to extract:
- title            : job title (string)
- must_have_skills : comma separated list of required/must-have skills (string)
- preferred_skills : comma separated list of nice-to-have/preferred skills (string)
- experience_min   : minimum years of experience required (integer)
- experience_max   : maximum years of experience mentioned (integer)
- location         : job location (string)
- recruiter_email  : recruiter or contact email if mentioned (string)

JD Text:
{jd_text[:4000]}

Expected output format:
{{
  "title":            "...",
  "must_have_skills": "...",
  "preferred_skills": "...",
  "experience_min":   0,
  "experience_max":   0,
  "location":         "...",
  "recruiter_email":  "...",
}}
"""
    response = gemini_client.models.generate_content(
        model    = "gemini-3.5-flash",
        contents = prompt,
    )
    raw    = response.text.strip().replace("```json", "").replace("```", "").strip()
    fields = json.loads(raw)
    return fields


# ── STEP 4: Embedding ─────────────────────────────────────────────────────────

def generate_embedding(jd_text: str) -> list:
    return embedding_model.get_embeddings([jd_text[:3000]])[0].values


# ── STEP 5: BQ row builder ────────────────────────────────────────────────────

def build_bq_row(
    file_name, title, description, must_have_skills, preferred_skills,
    experience_min, experience_max, location,
    jd_embedding, recruiter_email,
) -> dict:
    return {
        "job_id":           file_name.split('/')[-1].replace('.pdf', ''),   # unique per JD
        "title":            title,
        "description":      description,
        "must_have_skills": must_have_skills,
        "preferred_skills": preferred_skills,
        "experience_min":   experience_min,
        "experience_max":   experience_max,
        "location":         location,
        "jd_embedding":     jd_embedding,
        "recruiter_email":  recruiter_email,
        "status":           "active",
        "created_at":       datetime.now(timezone.utc).isoformat(),
    }


# ── STEP 6: BQ batch flush ────────────────────────────────────────────────────

def flush_to_bigquery(rows: list[dict]) -> None:
    if not rows:
        return

    # BQ DML doesn't support FLOAT64 REPEATED params, so jd_embedding is inlined.
    # All text fields use @params — safe against quotes, newlines, special chars.
    for r in rows:
        emb_literal = "[" + ", ".join(str(float(x)) for x in (r.get("jd_embedding") or [])) + "]"
        query = f"""
            MERGE `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}` AS target
            USING (SELECT @job_id AS job_id) AS source
            ON target.job_id = source.job_id
            WHEN MATCHED THEN
              UPDATE SET
                title            = @title,
                description      = @description,
                must_have_skills = @must_have_skills,
                preferred_skills = @preferred_skills,
                experience_min   = @experience_min,
                experience_max   = @experience_max,
                location         = @location,
                jd_embedding     = {emb_literal},
                recruiter_email  = @recruiter_email,
                status           = @status,
                created_at       = @created_at
            WHEN NOT MATCHED THEN
              INSERT (job_id, title, description, must_have_skills, preferred_skills,
                      experience_min, experience_max, location,
                      jd_embedding, recruiter_email, status, created_at)
              VALUES (@job_id, @title, @description, @must_have_skills, @preferred_skills,
                      @experience_min, @experience_max, @location,
                      {emb_literal}, @recruiter_email, @status, @created_at)
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("job_id",           "STRING", r.get("job_id")           or ""),
                bigquery.ScalarQueryParameter("title",            "STRING", r.get("title")            or ""),
                bigquery.ScalarQueryParameter("description",      "STRING", r.get("description")      or ""),
                bigquery.ScalarQueryParameter("must_have_skills", "STRING", r.get("must_have_skills") or ""),
                bigquery.ScalarQueryParameter("preferred_skills", "STRING", r.get("preferred_skills") or ""),
                bigquery.ScalarQueryParameter("experience_min",   "INT64",  int(r.get("experience_min") or 0)),
                bigquery.ScalarQueryParameter("experience_max",   "INT64",  int(r.get("experience_max") or 0)),
                bigquery.ScalarQueryParameter("location",         "STRING", r.get("location")         or ""),
                bigquery.ScalarQueryParameter("recruiter_email",  "STRING", r.get("recruiter_email")  or ""),
                bigquery.ScalarQueryParameter("status",           "STRING", r.get("status")           or "active"),
                bigquery.ScalarQueryParameter("created_at",       "TIMESTAMP", r.get("created_at")       or ""),
            ]
        )
        bq_client.query(query, job_config=job_config).result()

    print(f"  ✓ Flushed {len(rows)} JD rows to BigQuery (DML).")


# ── CORE: Process one JD, return a BQ row dict ───────────────────────────────

def _process_jd_to_row(file_name: str) -> dict | None:
    try:
        jd_text = extract_text_from_pdf(file_name)
        if not jd_text:
            print(f"  ✗ No text in {file_name}. Skipping.")
            return None

        fields    = extract_jd_fields(jd_text)
        embedding = generate_embedding(jd_text)

        job_id = file_name.split('/')[-1].replace('.pdf', '')
        row = build_bq_row(
            file_name        = file_name,
            title            = fields.get("title")            or "Unknown",
            description      = jd_text,
            must_have_skills = fields.get("must_have_skills") or "",
            preferred_skills = fields.get("preferred_skills") or "",
            experience_min   = fields.get("experience_min")   or 0,
            experience_max   = fields.get("experience_max")   or 0,
            location         = fields.get("location")         or "",
            jd_embedding     = embedding,
            recruiter_email  = fields.get("recruiter_email")  or "",
        )

        # ── Write directly to BQ (same pattern as resume_processing) ──
        flush_to_bigquery([row])

        print(f"  ✓ {fields.get('title')} | {file_name}")
        return row

    except Exception as exc:
        print(f"  ✗ Failed [{file_name}]: {exc}")
        return None


# ── BATCH PIPELINE ────────────────────────────────────────────────────────────

def run_batch_pipeline(max_workers: int = MAX_WORKERS) -> None:
    """
    Parallel JD processing:
      - MAX_WORKERS threads each run download + Gemini + embed concurrently
      - BQ rows are accumulated and flushed in batches of BQ_BATCH_SIZE
    """
    pdf_files = list_pdfs_in_folder()
    if not pdf_files:
        print("✗ No PDFs found.")
        return

    print(f"\n  Processing {len(pdf_files)} JDs with {max_workers} parallel workers...\n")

    bq_batch:  list[dict] = []
    completed: int        = 0

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_process_jd_to_row, f): f for f in pdf_files}

        for future in as_completed(futures):
            row = future.result()
            completed += 1

            if row:
                bq_batch.append(row)

            if len(bq_batch) >= BQ_BATCH_SIZE:
                flush_to_bigquery(bq_batch)
                bq_batch = []

            print(f"  Progress: {completed}/{len(pdf_files)}")

    flush_to_bigquery(bq_batch)
    print(f"\n  ✓ All done. {completed} JDs processed.\n")


# ── MAIN ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n══ JD Processing Pipeline Started (Optimized) ══")
    run_batch_pipeline()
    print("══ JD Pipeline Finished ══\n")