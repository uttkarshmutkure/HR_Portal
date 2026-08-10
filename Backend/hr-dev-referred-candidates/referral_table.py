"""
Referral Table Writer
──────────────────────
Stores the raw form data submitted through the "Refer a friend" UI —
gender, experience, salary, fit reason, and who submitted the referral.

This is SEPARATE from candidates table insertion (handled by
referral_processing.py via the GCS trigger, which extracts resume fields
and marks the candidate as Referred). This table captures what the referrer
typed, which the resume extraction never sees (e.g. current salary,
fit_reason, referred_by).

Linked back to the candidates row via job_id + candidate_email, since the
candidate_id doesn't exist yet at form-submit time (it's generated later,
async, by the GCS trigger once the resume is processed).
"""

import uuid
from datetime import datetime, timezone

from google.cloud import bigquery

PROJECT_ID = "atgeir-moae-dev"
DATASET_ID = "hr_dataset"
TABLE_ID   = "referrals"

bq_client = bigquery.Client(project=PROJECT_ID)


def insert_referral_record(
    job_id: str,
    candidate_id: str,
    candidate_name: str,
    candidate_email: str,
    candidate_phone: str,
    gender: str,
    experience_years: float,
    salary_currency: str,
    salary_amount: str,
    salary_frequency: str,
    fit_reason: str,
    referred_by: str,
    gcs_pdf_path: str,
) -> str:
    """Inserts one row into hr_dataset.referrals. Returns the new referral_id."""
    referral_id = str(uuid.uuid4())

    query = f"""
        INSERT INTO `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`
          (referral_id, job_id, candidate_id, candidate_name, candidate_email, candidate_phone,
           gender, experience_years, salary_currency, salary_amount, salary_frequency,
           fit_reason, referred_by, gcs_pdf_path, submitted_at)
        VALUES
          (@referral_id, @job_id, @candidate_id, @candidate_name, @candidate_email, @candidate_phone,
           @gender, @experience_years, @salary_currency, @salary_amount, @salary_frequency,
           @fit_reason, @referred_by, @gcs_pdf_path, @submitted_at)
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("referral_id", "STRING", referral_id),
            bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
            bigquery.ScalarQueryParameter("candidate_id", "STRING", candidate_id or ""),
            bigquery.ScalarQueryParameter("candidate_name", "STRING", candidate_name or ""),
            bigquery.ScalarQueryParameter("candidate_email", "STRING", candidate_email or ""),
            bigquery.ScalarQueryParameter("candidate_phone", "STRING", candidate_phone or ""),
            bigquery.ScalarQueryParameter("gender", "STRING", gender or ""),
            bigquery.ScalarQueryParameter("experience_years", "FLOAT64", float(experience_years or 0)),
            bigquery.ScalarQueryParameter("salary_currency", "STRING", salary_currency or "INR"),
            bigquery.ScalarQueryParameter("salary_amount", "STRING", salary_amount or ""),
            bigquery.ScalarQueryParameter("salary_frequency", "STRING", salary_frequency or "NA"),
            bigquery.ScalarQueryParameter("fit_reason", "STRING", fit_reason or ""),
            bigquery.ScalarQueryParameter("referred_by", "STRING", referred_by or ""),
            bigquery.ScalarQueryParameter("gcs_pdf_path", "STRING", gcs_pdf_path or ""),
            bigquery.ScalarQueryParameter("submitted_at", "TIMESTAMP", datetime.now(timezone.utc).isoformat()),
        ]
    )
    bq_client.query(query, job_config=job_config).result()
    print(f"  ✓ Referral record saved: referral_id={referral_id} | {candidate_name}")
    return referral_id