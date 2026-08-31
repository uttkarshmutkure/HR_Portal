from google.cloud import bigquery
from config import GCP_PROJECT_ID

bq_client = bigquery.Client(project=GCP_PROJECT_ID)