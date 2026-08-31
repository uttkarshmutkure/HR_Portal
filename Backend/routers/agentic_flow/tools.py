"""
tools.py — thin ADK tool wrapper for the pipeline agent only.
jd/resume tools are omitted since gcs_resume_trigger is not yet ported.
"""

from google.adk.tools import FunctionTool

from shared.full_pipeline import run_pipeline

run_pipeline_tool = FunctionTool(run_pipeline)