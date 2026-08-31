import config  # noqa: F401 — sets env vars before genai.Client() below
from google import genai

genai_client = genai.Client()
genai_client_global = genai.Client(
    vertexai=True,
    project=config.GCP_PROJECT_ID,
    location=config.VERTEX_AI_LOCATION,
)