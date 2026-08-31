# tools.py
# Thin ADK tool wrappers — NO logic changes.

from google.adk.tools import FunctionTool

from jd_processing import _process_jd_to_row
from resume_processing import process_resume_from_gcs
from Backend.shared.full_pipeline import (
    fetch_jd_with_clusters,
    vector_search_and_fetch,
    fetch_all_resumes,
    process_single_candidate,
    generate_questions_for_candidate,
    send_recruiter_email,
    run_pipeline,          # ← wrap the full pipeline as one tool
)

process_jd_tool        = FunctionTool(_process_jd_to_row)
process_resume_tool    = FunctionTool(process_resume_from_gcs)
run_pipeline_tool      = FunctionTool(run_pipeline)            # ← replaces 6 broken individual tools

# Individual tools kept for potential direct use
fetch_jd_clusters_tool = FunctionTool(fetch_jd_with_clusters)
vector_search_tool     = FunctionTool(vector_search_and_fetch)
fetch_resumes_tool     = FunctionTool(fetch_all_resumes)
screen_candidate_tool  = FunctionTool(process_single_candidate)
generate_questions_tool= FunctionTool(generate_questions_for_candidate)
send_email_tool        = FunctionTool(send_recruiter_email)