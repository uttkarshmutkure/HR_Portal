# agents.py

from google.adk.agents import LlmAgent
from google.adk.models.google_llm import Gemini
import os

os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "TRUE"
os.environ["GOOGLE_CLOUD_PROJECT"] = "atgeir-moae-dev"
os.environ["GOOGLE_CLOUD_LOCATION"] = "global"

from tools import (
    process_jd_tool,
    process_resume_tool,
    run_pipeline_tool,
)

# Matches the working chat_agent.py pattern exactly:
# LlmAgent + Gemini() — auth via GOOGLE_GENAI_USE_VERTEXAI=1 env var
_MODEL = Gemini(model="gemini-3.5-flash")

jd_agent = LlmAgent(
    name="jd_agent",
    model=_MODEL,
    description="Process JD and prepare structured job data.",
    instruction=(
        "You are the JD agent. Use the JD processing tool to extract job details "
        "from the JD PDF and prepare structured JD data."
    ),
    tools=[process_jd_tool],
)

resume_agent = LlmAgent(
    name="resume_agent",
    model=_MODEL,
    description="Process resumes and prepare candidate data.",
    instruction=(
        "You are the resume agent. Use the resume processing tool to extract "
        "candidate details and save them in BigQuery."
    ),
    tools=[process_resume_tool],
)

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