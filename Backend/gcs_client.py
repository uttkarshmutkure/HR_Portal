"""
Shared Google Cloud Storage client singleton.
"""

from google.cloud import storage
from config import GCP_PROJECT_ID

gcs_client = storage.Client(project=GCP_PROJECT_ID)