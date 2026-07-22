"""
Resume Processing Pipeline — Updated
──────────────────────────────────────
1. List all PDF files inside GCS folder
2. For each PDF:
   a. Extract text using PyMuPDF
   b. Extract structured fields using Gemini 2.5 Flash:
        - name, email, phone
        - work history (with dates)  → we calculate experience using real current date
        - minimum qualification
        - location
        - last organization
        - skills list
   c. Calculate total_experience_years in Python using real current date
   d. Generate embedding using Vertex AI
   e. Store everything in BigQuery

Requirements:
    pip install pymupdf google-cloud-storage google-cloud-bigquery
                google-cloud-aiplatform google-genai
"""

import json
import uuid
from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta
from dateutil import parser as dateparser

import fitz
from google.cloud import storage, bigquery
import vertexai
from vertexai.language_models import TextEmbeddingModel
from google import genai


# ── CONFIG ────────────────────────────────────────────────────────────────────

PROJECT_ID  = "atgeir-moae-dev"
BUCKET_NAME = "hr-data-source-at"
FOLDER_PATH = "resume/Python_Developers"
DATASET_ID  = "hr_dataset"
TABLE_ID    = "candidates"
LOCATION    = "us-central1"
JOB_ID      = "job-002"

# ─────────────────────────────────────────────────────────────────────────────


# ── CLIENTS ───────────────────────────────────────────────────────────────────

gcs_client      = storage.Client(project=PROJECT_ID)
bq_client       = bigquery.Client(project=PROJECT_ID)
vertexai.init(project=PROJECT_ID, location=LOCATION)
embedding_model = TextEmbeddingModel.from_pretrained("text-embedding-004")
gemini_client   = genai.Client(
    vertexai = True,
    project  = PROJECT_ID,
    location = LOCATION
)

# ─────────────────────────────────────────────────────────────────────────────


# ── STEP 1: List all PDFs in GCS folder ───────────────────────────────────────

def list_pdfs_in_folder() -> list:
    print(f"\n  Listing PDFs in gs://{BUCKET_NAME}/{FOLDER_PATH}/...")
    bucket    = gcs_client.bucket(BUCKET_NAME)
    blobs     = bucket.list_blobs(prefix=FOLDER_PATH)
    pdf_files = [
        blob.name for blob in blobs
        if blob.name.lower().endswith(".pdf")
    ]
    print(f"  Found {len(pdf_files)} PDF files.")
    return pdf_files


# ── STEP 2: Extract text from PDF ─────────────────────────────────────────────

def extract_text_from_pdf(file_name: str) -> str:
    print(f"  Downloading gs://{BUCKET_NAME}/{file_name} ...")
    bucket    = gcs_client.bucket(BUCKET_NAME)
    blob      = bucket.blob(file_name)
    pdf_bytes = blob.download_as_bytes()
    doc       = fitz.open(stream=pdf_bytes, filetype="pdf")
    text      = ""
    for page in doc:
        text += page.get_text()
    doc.close()
    text = text.strip()
    print(f"  Extracted {len(text)} characters.")
    return text


# ── STEP 3: Extract structured fields using Gemini ───────────────────────────

def extract_resume_fields(resume_text: str, current_date: str) -> dict:
    """
    Extract all structured fields from resume using Gemini 2.5 Flash.

    For work history we extract raw start/end dates.
    We pass the real current date so Gemini uses it for "Present" roles
    instead of guessing.

    Returns dict with all extracted fields.
    """
    print("  Extracting structured fields via Gemini 2.5 Flash...")

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
     Bachelor, Bachelors, UG, Undergraduate  → "Bachelor's"

     M.Tech, ME, MBA, MCA, M.Sc, MSc, MS,
     Master, Masters, PG, PGDM, PGDCA,
     Post Graduate, PG Diploma              → "Master's"

     PhD, Ph.D, Doctorate                   → "PhD"

     Diploma, Polytechnic, ITI              → "Diploma"
     (only if no Bachelor's or higher found)

     12th, HSC, Higher Secondary            → "12th"
     (only if no Diploma or higher found)

   Examples:
     Diploma + B.Tech found  → return "Bachelor's"
     B.Tech + MBA found      → return "Master's"
     Only Diploma found      → return "Diploma"
     Nothing found           → return "not mentioned"

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
  "phone"                 : "...",.
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

    response = gemini_client.models.generate_content(
        model    = "gemini-2.5-flash",
        contents = prompt
    )
    raw = response.text.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()

    fields = json.loads(raw)
    print(f"  Extracted: {fields.get('name')} | {fields.get('email')} | {fields.get('location')}")
    print(f"  Last Org : {fields.get('last_organization')}")
    print(f"  Qual     : {fields.get('minimum_qualification')}")
    print(f"  Skills   : {len(fields.get('skills', []))} skills found")
    return fields


# ── STEP 4: Calculate total experience using Python ───────────────────────────

def calculate_total_experience(work_history: list) -> float:
    """
    Calculate total years of experience from work history.
    Uses Python date math — not LLM prediction.

    Logic:
    - Add up all role durations
    - Handles overlapping roles (e.g. freelance + full time)
      by merging overlapping date ranges
    - Returns total years as float e.g. 3.5

    Args:
        work_history: list of roles with start_date and end_date in YYYY-MM format

    Returns:
        Total experience in years as float.
    """
    if not work_history:
        return 0.0

    # Parse all date ranges
    date_ranges = []
    for role in work_history:
        try:
            start = dateparser.parse(role.get("start_date", ""), default=datetime(2000, 1, 1))
            end   = dateparser.parse(role.get("end_date", ""),   default=datetime.now())

            if start and end and end >= start:
                date_ranges.append((start, end))
        except Exception:
            continue

    if not date_ranges:
        return 0.0

    # Sort by start date
    date_ranges.sort(key=lambda x: x[0])

    # Merge overlapping ranges to avoid double counting
    merged = [date_ranges[0]]
    for start, end in date_ranges[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            # Overlapping — extend the last range if needed
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    # Calculate total months across all merged ranges
    total_months = 0
    for start, end in merged:
        diff         = relativedelta(end, start)
        total_months += diff.years * 12 + diff.months

    total_years = round(total_months / 12, 2)
    print(f"  Experience calculated: {total_years} years ({total_months} months across {len(merged)} roles)")
    return total_years


# ── STEP 5: Generate embedding using Vertex AI ────────────────────────────────

def generate_embedding(resume_text: str) -> list:
    print("  Generating embedding via Vertex AI...")
    result    = embedding_model.get_embeddings([resume_text[:3000]])
    embedding = result[0].values
    print(f"  Embedding generated ({len(embedding)} floats).")
    return embedding


# ── STEP 6: Store candidate in BigQuery ───────────────────────────────────────

def store_in_bigquery(
    job_id:                  str,
    name:                    str,
    email:                   str,
    phone:                   str,
    location:                str,
    last_organization:       str,
    minimum_qualification:   str,
    total_experience_years:  float,
    skills:                  list,
    raw_resume_text:         str,
    embedding:               list,
    gcs_pdf_path:            str,
) -> str:
    print("  Storing in BigQuery...")

    table_ref    = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"
    candidate_id = str(uuid.uuid4())

    row = {
        "candidate_id":           candidate_id,
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
    }

    errors = bq_client.insert_rows_json(table_ref, [row])
    if errors:
        raise RuntimeError(f"BigQuery insert failed: {errors}")

    print(f"  Stored. Candidate ID: {candidate_id}")
    return candidate_id


# ── PROCESS ONE RESUME ────────────────────────────────────────────────────────

def process_resume(file_name: str):
    print(f"\n{'─' * 55}")
    print(f"  File: {file_name}")
    print(f"{'─' * 55}")

    # Current date — passed to Gemini so it uses real date for "Present" roles
    current_date = datetime.now().strftime("%Y-%m")
    print(f"  Current date: {current_date}")

    # Step 1 — Extract text from PDF
    raw_resume_text = extract_text_from_pdf(file_name)
    if not raw_resume_text:
        print("  ✗ No text found in PDF. Skipping.\n")
        return

    # Step 2 — Extract structured fields via Gemini
    try:
        fields = extract_resume_fields(raw_resume_text, current_date)
    except Exception as e:
        print(f"  ✗ Gemini extraction failed: {e}. Skipping.")
        return

    # Step 3 — Calculate experience using Python date math
    total_experience_years = calculate_total_experience(
        fields.get("work_history", [])
    )

    # Step 4 — Generate embedding
    embedding = generate_embedding(raw_resume_text)

    # Step 5 — Store in BigQuery
    gcs_pdf_path = f"gs://{BUCKET_NAME}/{file_name}"
    candidate_id = store_in_bigquery(
        job_id                  = JOB_ID,
        name                    = fields.get("name")                 or "Unknown",
        email                   = fields.get("email")                or "Unknown",
        phone                   = fields.get("phone")                or "Unknown",
        location                = fields.get("location")             or "India",
        last_organization       = fields.get("last_organization")    or "Unknown",
        minimum_qualification   = fields.get("minimum_qualification") or "not mentioned",
        total_experience_years  = total_experience_years,
        skills                  = fields.get("skills")               or [],
        raw_resume_text         = raw_resume_text,
        embedding               = embedding,
        gcs_pdf_path            = gcs_pdf_path,
    )

    print(f"\n  ✓ Done — '{fields.get('name')}' | Exp: {total_experience_years} yrs | ID: {candidate_id}\n")


# ── MAIN ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    print("\n══ Resume Processing Pipeline Started ══")

    pdf_files = list_pdfs_in_folder()

    if not pdf_files:
        print("\n✗ No PDF files found.")
    else:
        for i, file_name in enumerate(pdf_files, start=1):
            print(f"\n[{i}/{len(pdf_files)}]")
            try:
                process_resume(file_name)
            except Exception as e:
                print(f"  ✗ Failed: {e}\n")
                continue

    print("\n══ Pipeline Finished ══\n")