"""
Vector Search Matching
──────────────────────
1. Fetch JD embedding from BigQuery
2. Run VECTOR_SEARCH against all candidates
3. Print raw results with similarity scores

No filters. No rules. Just raw similarity results.
"""

from google.cloud import bigquery

# ── CONFIG ────────────────────────────────────────────────────────────────────

PROJECT_ID = "atgeir-moae-dev"
DATASET_ID = "hr_dataset"

# Paste the Job ID printed by jd_processing.py here
JOB_ID     = "job-001"

TOP_K      = 30    # how many candidates to return

# ─────────────────────────────────────────────────────────────────────────────

bq_client = bigquery.Client(project=PROJECT_ID)


def run_vector_search(job_id: str, top_k: int) -> list:
    """
    Run BigQuery VECTOR_SEARCH to find most similar candidates to the JD.
    Returns raw results with similarity scores.
    """

    query = f"""
        SELECT
            base.candidate_id,
            base.name,
            base.email,
            base.gcs_pdf_path,
            ROUND(1 - distance, 4) AS similarity_score
        FROM
            VECTOR_SEARCH(
                (
                    SELECT
                        candidate_id,
                        name,
                        email,
                        gcs_pdf_path,
                        resume_embedding
                    FROM `atgeir-moae-dev.hr_dataset.candidates`
                ),
                'resume_embedding',
                (
                    SELECT
                        jd_embedding
                    FROM `atgeir-moae-dev.hr_dataset.jobs`
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
    return rows


def print_results(rows: list):
    """Print results in a readable format."""

    print(f"\n{'═' * 55}")
    print(f"  VECTOR SEARCH RESULTS  —  Top {len(rows)} Candidates")
    print(f"{'═' * 55}\n")

    if not rows:
        print("  No candidates found.")
        return

    for i, row in enumerate(rows, start=1):
        score = float(row.similarity_score)

        # Simple visual score bar
        bar_length = int(score * 20)
        bar        = "█" * bar_length + "░" * (20 - bar_length)

        print(f"  Rank #{i}")
        print(f"  Name         : {row.name}")
        print(f"  Email        : {row.email}")
        print(f"  Candidate ID : {row.candidate_id}")
        print(f"  PDF          : {row.gcs_pdf_path}")
        print(f"  Score        : {score}  |{bar}|")
        print(f"  {'─' * 51}")


if __name__ == "__main__":

    print("\n══ Running Vector Search ══")
    print(f"  Job ID : {JOB_ID}")
    print(f"  Top K  : {TOP_K}")

    rows = run_vector_search(JOB_ID, TOP_K)
    print_results(rows)

    print("\n══ Done ══\n")