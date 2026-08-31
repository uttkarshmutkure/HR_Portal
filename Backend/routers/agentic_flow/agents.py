"""
agents.py — ADK LlmAgent for the pipeline agent only.
"""

from google.adk.agents import LlmAgent
from google.adk.models.google_llm import Gemini

import config  # ensures GOOGLE_GENAI_USE_VERTEXAI / PROJECT / LOCATION are set

_MODEL = Gemini(model="gemini-3.5-flash")

from routers.agentic_flow.tools import run_pipeline_tool

pipeline_agent = LlmAgent(
    name="pipeline_agent",
    model=_MODEL,
    description=(
        "Runs the full HR screening pipeline: vector search, candidate screening, "
        "ranking, interview question generation, email, and BQ status update."
    ),
    instruction=(
        "You are the pipeline agent. When given a job_id, call run_pipeline with "
        "that job_id to execute the complete screening pipeline end-to-end. "
        "Do not break it into sub-steps — run_pipeline handles everything internally."
    ),
    tools=[run_pipeline_tool],
)