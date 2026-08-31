"""
db_tool — books a matched interview slot into BigQuery: locks the
interviewer slot, updates the candidate's row, and auto-grants interviewer
login access (mirrors save-interviewer's grant logic). Unchanged logic,
now using the shared bq_client and config.py.
"""

import uuid

from google.cloud import bigquery

import config
from bigquery_client import bq_client

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID


def book_interview_in_db(interviewer_id: str, interviewer_name: str, interviewer_email: str,
                          candidate_id: str, job_id: str, job_title: str, round_id: str,
                          date: str, start_time: str, end_time: str, work_mode: str) -> str:
    """
    Updates the BigQuery database to lock in an interview slot.
    Call this tool ONLY AFTER you have found a matching time slot.
    """
    try:
        update_query = f"""
            UPDATE `{PROJECT_ID}.{DATASET_ID}.interviewer_slots`
            SET status = 'booked'
            WHERE slot_id = @inv_id
        """
        bq_client.query(update_query, job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("inv_id", "STRING", interviewer_id)
        ])).result()

        cand_update = f"""
            UPDATE `{PROJECT_ID}.{DATASET_ID}.candidate_slot_selections`
            SET status = 'scheduled',
                slot_date = @date,
                slot_start_time = @start,
                slot_end_time = @end,
                interviewer_id = @interviewer_id,
                interviewer_name = @interviewer_name,
                interviewer_email = @interviewer_email,
                job_title = @job_title,
                interview_mode = @work_mode
            WHERE candidate_id = @cand_id AND job_id = @job_id AND round = @round
        """
        bq_client.query(cand_update, job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("date", "STRING", date),
            bigquery.ScalarQueryParameter("start", "STRING", start_time),
            bigquery.ScalarQueryParameter("end", "STRING", end_time),
            bigquery.ScalarQueryParameter("cand_id", "STRING", candidate_id),
            bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
            bigquery.ScalarQueryParameter("round", "STRING", round_id),
            bigquery.ScalarQueryParameter("interviewer_id", "STRING", interviewer_id),
            bigquery.ScalarQueryParameter("interviewer_name", "STRING", interviewer_name),
            bigquery.ScalarQueryParameter("interviewer_email", "STRING", interviewer_email),
            bigquery.ScalarQueryParameter("job_title", "STRING", job_title),
            bigquery.ScalarQueryParameter("work_mode", "STRING", work_mode),
        ])).result()

        if interviewer_email:
            users_table_id = f"{PROJECT_ID}.{DATASET_ID}.users"
            grant_query = f"""
                MERGE `{users_table_id}` T
                USING (SELECT @email AS email) S
                ON T.email = S.email
                WHEN MATCHED AND NOT CONTAINS_SUBSTR(T.roles, 'interviewer') THEN
                    UPDATE SET roles = CONCAT(T.roles, ',interviewer')
                WHEN NOT MATCHED THEN
                    INSERT (user_id, email, name, roles, status, source, granted_by, created_at)
                    VALUES (
                        @user_id, @email, @name, 'interviewer', 'active',
                        'auto_via_assignment', 'system', CURRENT_TIMESTAMP()
                    )
            """
            grant_config = bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("user_id", "STRING", str(uuid.uuid4())),
                bigquery.ScalarQueryParameter("email", "STRING", interviewer_email),
                bigquery.ScalarQueryParameter("name", "STRING", interviewer_name),
            ])
            bq_client.query(grant_query, job_config=grant_config).result()

        return "Database successfully updated. The slot is now booked."
    except Exception as e:
        return f"Database error: {str(e)}"