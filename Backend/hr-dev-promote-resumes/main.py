"""
promote-resumes — Cloud Function (HTTP, called by Cloud Scheduler every minute)

Moves resumes from the STAGING bucket (no trigger) to the MAIN bucket (trigger)
in small batches, ONLY for jobs HR approved by clicking "Execute"
(promotion_requests.status = REQUESTED / RUNNING).

Each run:
  1. Find approved jobs
  2. Mark approved jobs with an empty staging folder as DONE
  3. Check how many resumes the AI is still processing (backpressure)
  4. Move a small batch for ONE job (the oldest approved one)
  5. Save progress in promotion_requests
"""

import json
import logging
import os
import uuid

import functions_framework
from google.api_core.exceptions import NotFound, PreconditionFailed
from google.cloud import bigquery, storage

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ── CONFIG ────────────────────────────────────────────────────────────────────
PROJECT_ID     = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID     = os.environ.get("BQ_DATASET_ID", "hr_dataset")
STAGING_BUCKET = os.environ.get("GCS_STAGING_BUCKET_NAME", "hr-data-staging-at")
MAIN_BUCKET    = os.environ.get("GCS_BUCKET_NAME", "hr-data-source-at")

MAX_IN_FLIGHT = int(os.environ.get("MAX_IN_FLIGHT", "15"))  # resumes the AI may process at once
BATCH_CAP     = int(os.environ.get("BATCH_CAP", "20"))      # max moved per run
STALE_MINUTES = int(os.environ.get("STALE_MINUTES", "15"))  # ignore old status rows

ACTIVE_STEPS = ("uploaded", "extracting", "retrying", "saving_to_bq")
PROMO_TABLE  = f"`{PROJECT_ID}.{DATASET_ID}.promotion_requests`"

# ── CLIENTS ───────────────────────────────────────────────────────────────────
gcs = storage.Client(project=PROJECT_ID)
bq  = bigquery.Client(project=PROJECT_ID)


# ── HELPERS ───────────────────────────────────────────────────────────────────
def _in_flight() -> int:
    """How many resumes the AI is processing right now (from resume_status)."""
    steps = ", ".join(f"'{s}'" for s in ACTIVE_STEPS)
    q = f"""
        SELECT COUNT(*) AS cnt
        FROM `{PROJECT_ID}.{DATASET_ID}.resume_status`
        WHERE step IN ({steps})
          AND updated_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {STALE_MINUTES} MINUTE)
    """
    rows = list(bq.query(q).result())
    return int(rows[0].cnt) if rows else 0


def _approved_jobs() -> list:
    """Jobs HR clicked Execute for, oldest request first."""
    q = f"""SELECT job_id FROM {PROMO_TABLE}
            WHERE status IN ('REQUESTED', 'RUNNING')
            ORDER BY requested_at"""
    return [r.job_id for r in bq.query(q).result()]


def _staged_by_job(allowed: set) -> dict:
    """{job_id: [blobs]} for approved jobs only."""
    by_job = {}
    for b in gcs.bucket(STAGING_BUCKET).list_blobs(prefix="resumes/"):
        if not b.name.lower().endswith(".pdf"):
            continue
        parts = b.name.split("/")
        if len(parts) >= 3 and parts[1] in allowed:
            by_job.setdefault(parts[1], []).append(b)
    return by_job


def _set_status(job_id: str, status: str, add_promoted: int = 0) -> None:
    q = f"""
        UPDATE {PROMO_TABLE}
        SET status         = @status,
            promoted_count = IFNULL(promoted_count, 0) + @n,
            updated_at     = CURRENT_TIMESTAMP(),
            completed_at   = IF(@status = 'DONE', CURRENT_TIMESTAMP(), completed_at)
        WHERE job_id = @job_id
    """
    cfg = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("status", "STRING", status),
        bigquery.ScalarQueryParameter("n", "INT64", add_promoted),
        bigquery.ScalarQueryParameter("job_id", "STRING", job_id),
    ])
    bq.query(q, job_config=cfg).result()


def _promote(blob) -> str:
    """Copy staging -> main, then delete from staging.
    Returns 'promoted' or 'renamed'.

    If a file with the same name already exists in main, copying is refused
    (if_generation_match=0). Skipping it would mean NO storage event fires, so the
    resume would never reach the AI and would silently vanish. Instead we copy it
    under a unique name so the trigger always fires. Real duplicates are still
    caught later in BigQuery (file_hash / email / phone MERGE).
    """
    staging = gcs.bucket(STAGING_BUCKET)
    main    = gcs.bucket(MAIN_BUCKET)
    try:
        # if_generation_match=0 -> only copy if the file doesn't exist in main
        staging.copy_blob(blob, main, blob.name, if_generation_match=0)
        outcome = "promoted"
    except PreconditionFailed:
        stem, ext = os.path.splitext(blob.name)
        new_name  = f"{stem}__{uuid.uuid4().hex[:8]}{ext}"
        staging.copy_blob(blob, main, new_name, if_generation_match=0)
        log.warning("Name clash in main for %s -> promoted as %s", blob.name, new_name)
        outcome = "renamed"
    try:
        blob.delete()
    except NotFound:
        pass
    return outcome


# ── ENTRY POINT ───────────────────────────────────────────────────────────────
@functions_framework.http
def promote_resumes_http(request):
    # 1. Which jobs did HR approve?
    approved = _approved_jobs()
    if not approved:
        return (json.dumps({"status": "idle", "reason": "no approved jobs"}), 200)

    # 2. Approved jobs with nothing left in staging are finished
    staged = _staged_by_job(set(approved))
    for jid in approved:
        if not staged.get(jid):
            _set_status(jid, "DONE")
            log.info("job=%s has nothing left in staging -> DONE", jid)
    approved = [j for j in approved if staged.get(j)]
    if not approved:
        return (json.dumps({"status": "idle", "reason": "all approved jobs done"}), 200)

    # 3. Backpressure: how much room does the AI have right now?
    in_flight = _in_flight()
    capacity  = min(MAX_IN_FLIGHT - in_flight, BATCH_CAP)
    if capacity <= 0:
        log.info("Throttled: in_flight=%d", in_flight)
        return (json.dumps({"status": "throttled", "in_flight": in_flight}), 200)

    # 4. Work on ONE job at a time (the oldest approved one)
    job_id = approved[0]
    files  = sorted(staged[job_id], key=lambda b: b.time_created)
    batch  = files[:capacity]

    promoted, already, failed, renamed = 0, 0, 0, 0
    for blob in batch:
        try:
            outcome = _promote(blob)
            if outcome == "renamed":
                renamed += 1
            promoted += 1
        except Exception as e:
            failed += 1
            log.error("Promote failed for %s: %s", blob.name, e, exc_info=True)

    moved     = promoted + already
    remaining = len(files) - moved

    # 5. Save progress; DONE only when this job's staging folder is empty
    _set_status(job_id, "DONE" if remaining <= 0 else "RUNNING", add_promoted=moved)

    log.info("job=%s promoted=%d (renamed=%d) failed=%d remaining=%d in_flight_before=%d",
             job_id, promoted, renamed, failed, remaining, in_flight)
    return (json.dumps({
        "status": "ok", "job_id": job_id, "promoted": promoted,
        "renamed_on_clash": renamed, "failed": failed,
        "remaining_for_job": remaining, "in_flight_before": in_flight,
    }), 200)