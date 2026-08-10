"""
Referral Candidate Processing
──────────────────────────────
Triggered by PDF uploads to:  gs://hr-data-source-at/referral_candidates/{job_id}/{file}.pdf

Reuses resume_processing.py's normal extraction + insert path UNCHANGED
(name, email, phone, skills, embedding — everything, exactly like a regular
resume). The ONLY difference for referrals is what happens AFTER insert:
we immediately UPDATE that one row to mark it as Referred/shortlisted,
so it never sits in PENDING waiting for the screening pipeline.
"""

from google.cloud import bigquery

from resume_processing import _process_resume_to_row, flush_to_bigquery

# ── CONFIG (match resume_processing.py) ───────────────────────────────────────

PROJECT_ID = "atgeir-moae-dev"
DATASET_ID = "hr_dataset"
TABLE_ID   = "candidates"

# NOTE: confirm this matches whatever your GET_SHORTLISTED / data-manager query
# filters on for candidate_result. If that query only checks for 'Passed',
# update it to also include 'Referred' — otherwise referred candidates won't
# appear in the shortlist UI.
REFERRED_RESULT_LABEL     = "Referred"
REFERRED_SCREENING_STATUS = "COMPLETED"

# ─────────────────────────────────────────────────────────────────────────────

bq_client = bigquery.Client(project=PROJECT_ID)


def _mark_as_referred(candidate_id: str) -> None:
    """Flip the just-inserted row from PENDING/Not Screened to Referred/COMPLETED.
    ai_screening_results is left NULL — there's nothing to screen since this
    candidate never goes through the pipeline."""
    query = f"""
        UPDATE `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`
        SET
            screening_status = @screening_status,
            candidate_result = @candidate_result,
            ai_screening_results = NULL
        WHERE candidate_id = @candidate_id
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("candidate_id", "STRING", candidate_id),
            bigquery.ScalarQueryParameter("screening_status", "STRING", REFERRED_SCREENING_STATUS),
            bigquery.ScalarQueryParameter("candidate_result", "STRING", REFERRED_RESULT_LABEL),
        ]
    )
    bq_client.query(query, job_config=job_config).result()
    print(f"  ✓ Marked as {REFERRED_RESULT_LABEL}: candidate_id={candidate_id}")


def process_referral_from_gcs(bucket_name: str, file_name: str, job_id: str) -> str | None:
    """
    Full pipeline: extract fields + embedding exactly like a normal resume
    (via resume_processing._process_resume_to_row), insert it the normal way,
    then immediately mark it Referred so it skips the screening queue.

    Returns the new candidate_id, or None if the PDF was unreadable.
    """
    row = _process_resume_to_row(file_name, bucket_name, job_id)
    if row is None:
        return None

    # Insert exactly like a normal resume (PENDING / Not Screened initially)
    flush_to_bigquery([row])

    # Then flip status so it's immediately shortlisted, no pipeline wait
    _mark_as_referred(row["candidate_id"])

    return row["candidate_id"]