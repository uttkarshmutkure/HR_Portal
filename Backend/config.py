"""
Central configuration — the ONLY place in the codebase that reads os.environ.
Every router/module imports from here instead of calling os.environ.get()
directly.
"""

import os
import sys


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"FATAL: required environment variable '{name}' is not set.")
    return value


# ── Buyer-supplied, required — no fallback to Atgeir's own project ──────────
GCP_PROJECT_ID   = _require("GCP_PROJECT_ID")
BQ_DATASET_ID    = _require("BQ_DATASET_ID")
GCS_BUCKET_NAME  = _require("GCS_BUCKET_NAME")

# ── Optional, with safe defaults ─────────────────────────────────────────────
GCP_LOCATION        = os.environ.get("GOOGLE_CLOUD_LOCATION", "asia-south1")
VERTEX_AI_LOCATION  = os.environ.get("VERTEX_AI_LOCATION", "global")
EMAIL_API_URL = os.environ.get("EMAIL_API_URL", "")
TEST_EMAIL    = os.environ.get("TEST_EMAIL", "")
MATCHMAKER_URL = os.environ.get("MATCHMAKER_URL", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
GEMINI_MODEL        = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")

QUERY_TIMEOUT_SEC   = int(os.environ.get("QUERY_TIMEOUT_SEC", "20"))
MAX_RESULT_ROWS     = int(os.environ.get("MAX_RESULT_ROWS", "200"))
ENUM_CACHE_TTL_SEC  = int(os.environ.get("ENUM_CACHE_TTL_SEC", str(6 * 60 * 60)))

os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")
os.environ["GOOGLE_CLOUD_PROJECT"]  = GCP_PROJECT_ID
os.environ["GOOGLE_CLOUD_LOCATION"] = GCP_LOCATION