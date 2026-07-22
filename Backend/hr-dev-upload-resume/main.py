import json
import logging
import os
import functions_framework
from google.cloud import storage

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# Reusable module-level GCS client
gcs_client = storage.Client()

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
}


@functions_framework.http
def upload_resumes_http(request):
    """
    Dedicated HTTP Bridge: React UI -> GCS Bucket -> Eventarc Trigger
    """
    # 1. Handle Preflight CORS
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)

    if request.method != "POST":
        return (json.dumps({"error": "Method not allowed"}), 405, CORS_HEADERS)

    try:
        job_id = request.form.get("job_id")
        files = request.files.getlist("resumes")

        if not job_id or not files:
            return (
                json.dumps({"error": "Missing 'job_id' or 'resumes' in payload"}),
                400,
                CORS_HEADERS,
            )

        bucket_name = os.environ.get("GCS_BUCKET_NAME", "hr-data-source-at")
        bucket = gcs_client.bucket(bucket_name)

        uploaded_files = []
        for f in files:
            if not f.filename.lower().endswith(".pdf"):
                continue

            # Strip malicious pathing characters strictly
            clean_name = "".join(c for c in f.filename if c.isalnum() or c in "._- ")

            # TARGET PATH: resume/{job_id}/{clean_name}
            blob = bucket.blob(f"resume/{job_id}/{clean_name}")

            f.seek(0)
            blob.upload_from_file(f, content_type="application/pdf")
            uploaded_files.append(clean_name)

        log.info(
            "Uploaded %d resumes to gs://%s/resume/%s/",
            len(uploaded_files),
            bucket_name,
            job_id,
        )

        return (
            json.dumps({
                "success": True,
                "job_id": job_id,
                "count": len(uploaded_files),
                "files": uploaded_files,
            }),
            200,
            CORS_HEADERS,
        )

    except Exception as e:
        log.error("Upload bridge threw exception: %s", str(e), exc_info=True)
        return (json.dumps({"error": str(e)}), 500, CORS_HEADERS)