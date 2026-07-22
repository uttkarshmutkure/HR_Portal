import os
from google.cloud import bigquery

# Initialize BQ client once per instance
bq_client = bigquery.Client()

def book_interview_in_db(interviewer_id: str, candidate_id: str, job_id: str, round_id: str, date: str, start_time: str, end_time: str) -> str:
    """
    Updates the BigQuery database to lock in an interview slot.
    Call this tool ONLY AFTER you have found a matching time slot.
    """
    try:
        project_id = os.environ.get('GOOGLE_CLOUD_PROJECT', 'atgeir-moae-dev')
        dataset_id = os.environ.get('BQ_DATASET_ID', 'hr_dataset')

        # 1. Lock interviewer slot
        update_query = f"""
            UPDATE `{project_id}.{dataset_id}.interviewer_slots`
            SET status = 'booked'
            WHERE slot_id = @inv_id
        """
        bq_client.query(update_query, job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("inv_id", "STRING", interviewer_id)
        ])).result()
        
        # 2. Update candidate status
        cand_update = f"""
            UPDATE `{project_id}.{dataset_id}.candidate_slot_selections`
            SET status = 'scheduled', 
                slot_date = @date, 
                slot_start_time = @start, 
                slot_end_time = @end
            WHERE candidate_id = @cand_id AND job_id = @job_id AND round = @round
        """
        bq_client.query(cand_update, job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("date", "STRING", date),
            bigquery.ScalarQueryParameter("start", "STRING", start_time),
            bigquery.ScalarQueryParameter("end", "STRING", end_time),
            bigquery.ScalarQueryParameter("cand_id", "STRING", candidate_id),
            bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
            bigquery.ScalarQueryParameter("round", "STRING", round_id)
        ])).result()
        
        return "Database successfully updated. The slot is now booked."
    except Exception as e:
        return f"Database error: {str(e)}"