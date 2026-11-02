"""
Preboarding Documents — Cloud Function (HTTP)
─────────────────────────────────────────────
After a candidate accepts the offer, they upload Aadhaar + PAN within a deadline
(default 3 days). HR verifies each document. "Hired" is blocked until both are
verified (enforced in update_candidate_status as well).

Auth model
  • Candidate actions  (get_public, upload)      → server-signed token (HMAC-SHA256)
  • Server-to-server   (create, run_reminders)   → X-Internal-Key header
  • HR actions         (list, get_document, verify, reject, resend, extend, create)
                                                  → Google ID token + HR_EMAILS allowlist
                                                    (when HR_AUTH_ENABLED=true)

Overall status is derived on read (never stored):
  docs_pending | docs_submitted | docs_verified | docs_rejected | overdue
"""

import base64, hashlib, hmac, html, json, logging, os, re, time, uuid
from datetime import datetime, timedelta, timezone

import functions_framework
import requests
from google.auth.transport import requests as grequests
from google.cloud import bigquery, storage
from google.oauth2 import id_token

# ── CONFIG ────────────────────────────────────────────────────────────────────
PROJECT_ID        = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID        = os.environ.get("BQ_DATASET_ID", "hr_dataset")
BUCKET_NAME       = os.environ.get("PREBOARDING_BUCKET", f"{PROJECT_ID}-preboarding-docs")
SECRET            = os.environ.get("PREBOARDING_SECRET", "").strip()
INTERNAL_KEY      = os.environ.get("INTERNAL_API_KEY", "").strip()
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "").rstrip("/")
EMAIL_SERVICE_URL = os.environ.get("EMAIL_SERVICE_URL", "")
DEADLINE_DAYS     = int(os.environ.get("DEADLINE_DAYS", "3"))
HR_AUTH_ENABLED   = os.environ.get("HR_AUTH_ENABLED", "false").lower() == "true"
GOOGLE_CLIENT_ID  = os.environ.get("GOOGLE_CLIENT_ID", "")
HR_EMAILS         = {e.strip().lower() for e in os.environ.get("HR_EMAILS", "").split(",") if e.strip()}

TABLE     = f"`{PROJECT_ID}.{DATASET_ID}.preboarding`"
DOC_TYPES = {"aadhaar": "Aadhaar Card", "pan": "PAN Card"}
MAX_BYTES = 5 * 1024 * 1024
IST       = timezone(timedelta(hours=5, minutes=30))

HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age":       "3600",
    "Content-Type":                 "application/json",
}

bq  = bigquery.Client(project=PROJECT_ID)
gcs = storage.Client(project=PROJECT_ID)


class ApiError(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.message, self.code = message, code


def _ok(payload):
    return (json.dumps({"success": True, **payload}), 200, HEADERS)

def _err(message, code):
    return (json.dumps({"success": False, "message": message}), code, HEADERS)


# ── BigQuery helpers ──────────────────────────────────────────────────────────
def _run(sql, **params):
    out = []
    for k, v in params.items():
        t = ("BOOL" if isinstance(v, bool) else "INT64" if isinstance(v, int)
             else "TIMESTAMP" if isinstance(v, datetime) else "STRING")
        out.append(bigquery.ScalarQueryParameter(k, t, v))
    return bq.query(sql, job_config=bigquery.QueryJobConfig(query_parameters=out)).result()

def _get_record(cid, jid):
    rows = list(_run(f"SELECT * FROM {TABLE} WHERE candidate_id=@c AND job_id=@j LIMIT 1", c=cid, j=jid))
    return dict(rows[0].items()) if rows else None

def _iso(v):
    return v.astimezone(timezone.utc).isoformat() if isinstance(v, datetime) else None

def _present(rec):
    """DB row → API shape, with the overall status derived."""
    now  = datetime.now(timezone.utc)
    docs = {t: {"status": rec.get(f"{t}_status") or "missing",
                "reason": rec.get(f"{t}_reason"),
                "uploaded_at": _iso(rec.get(f"{t}_uploaded_at"))} for t in DOC_TYPES}
    sts = [d["status"] for d in docs.values()]
    if all(s == "verified" for s in sts):                    status = "docs_verified"
    elif all(s in ("uploaded", "verified") for s in sts):    status = "docs_submitted"
    elif rec["deadline"] < now:                              status = "overdue"
    elif any(s == "rejected" for s in sts):                  status = "docs_rejected"
    else:                                                    status = "docs_pending"
    return {"candidate_id": rec["candidate_id"], "job_id": rec["job_id"],
            "candidate_name": rec.get("candidate_name"), "candidate_email": rec.get("candidate_email"),
            "job_title": rec.get("job_title"), "deadline": _iso(rec["deadline"]),
            "status": status, "documents": docs}


# ── Signed tokens ─────────────────────────────────────────────────────────────
def _b64e(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def _b64d(s): return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def make_token(cid, jid, ttl_days=30):
    if not SECRET:
        raise ApiError("Server misconfigured: PREBOARDING_SECRET not set.", 500)
    p = _b64e(json.dumps({"c": cid, "j": jid, "exp": int(time.time()) + ttl_days * 86400},
                         separators=(",", ":")).encode())
    return f"{p}.{_b64e(hmac.new(SECRET.encode(), p.encode(), hashlib.sha256).digest())}"

def verify_token(token):
    """Returns payload dict or None. The upload DEADLINE is enforced from the DB
    (so HR can extend it); the token exp is only a long outer bound."""
    if not SECRET or not token or token.count(".") != 1:
        return None
    p, sig = token.split(".")
    expected = _b64e(hmac.new(SECRET.encode(), p.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        data = json.loads(_b64d(p))
    except Exception:
        return None
    return data if data.get("exp", 0) >= time.time() else None


# ── Auth ──────────────────────────────────────────────────────────────────────
def _is_internal(request):
    key = request.headers.get("X-Internal-Key", "").strip()
    return bool(INTERNAL_KEY) and hmac.compare_digest(key, INTERNAL_KEY)

def _hr_identity(request, body):
    if not HR_AUTH_ENABLED:
        logging.warning("HR_AUTH_ENABLED is false — HR endpoints are NOT authenticated.")
        return body.get("hr_email") or "unverified-hr"
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        info = id_token.verify_oauth2_token(auth[7:], grequests.Request(), GOOGLE_CLIENT_ID or None)
    except Exception as e:
        logging.warning("ID token rejected: %s", e)
        return None
    email = (info.get("email") or "").lower()
    return email if info.get("email_verified") and email in HR_EMAILS else None


# ── Files ─────────────────────────────────────────────────────────────────────
def _sniff(raw):
    """Detect type from magic bytes — never trust the client's content-type."""
    if raw.startswith(b"%PDF"):               return "application/pdf", "pdf"
    if raw.startswith(b"\xff\xd8\xff"):       return "image/jpeg", "jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):  return "image/png", "png"
    return None

def _safe(s): return re.sub(r"[^A-Za-z0-9_.-]", "_", s)


# ── Email ─────────────────────────────────────────────────────────────────────
def _send_email(to, subject, body_html):
    to = os.environ.get("TEST_EMAIL") or to
    if not EMAIL_SERVICE_URL:
        logging.warning("EMAIL_SERVICE_URL not set — email to %s skipped.", to)
        return False
    try:
        r = requests.post(EMAIL_SERVICE_URL, json={"to": to, "subject": subject, "body": body_html}, timeout=15)
        return r.ok
    except Exception as e:
        logging.error("Email failed: %s", e)
        return False

def _email_for(rec, kind, doc_label="", reason=""):
    token    = make_token(rec["candidate_id"], rec["job_id"])
    link     = f"{FRONTEND_BASE_URL}/preboarding/{token}"
    name     = html.escape(rec.get("candidate_name") or "Candidate")
    title    = html.escape(rec.get("job_title") or "the position")
    deadline = rec["deadline"].astimezone(IST).strftime("%d %b %Y, %I:%M %p IST")
    intro = {
        "new":      f"Congratulations on accepting the offer for <strong>{title}</strong>! To complete your joining formalities, please upload your <strong>Aadhaar card</strong> and <strong>PAN card</strong>.",
        "reminder": f"This is a friendly reminder to upload your <strong>Aadhaar card</strong> and <strong>PAN card</strong> for <strong>{title}</strong>. The deadline is close.",
        "rejected": f"Your <strong>{html.escape(doc_label)}</strong> could not be accepted. Reason: <em>{html.escape(reason)}</em>. Please upload a corrected copy.",
    }[kind]
    button_text = "Upload Corrected Document" if kind == "rejected" else "Upload Documents"
    body = f"""
            <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
            <div style="background:#F07C2D;padding:24px 28px;">
                <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.02em;">Atgeir Solutions</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">Hiring Team</div>
            </div>
            <div style="padding:28px;">
                <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear <strong>{name}</strong>,</p>
                <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">{intro}</p>
                <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
                <div style="font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">Document Checklist</div>
                <table style="width:100%;border-collapse:collapse;">
                    <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;width:110px;">Documents</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">Aadhaar Card, PAN Card</td></tr>
                    <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;">Formats</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">PDF, JPG or PNG (max 5 MB each)</td></tr>
                    <tr><td style="padding:6px 0;font-size:13px;color:#6B7280;">Deadline</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">{deadline}</td></tr>
                </table>
                </div>
                <a href="{link}" style="display:inline-block;background:#F07C2D;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:20px;">{button_text}</a>
                <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">This link is <strong>personal</strong>, so please do not share it with others.</p>
                <p style="margin:16px 0 0;font-size:13px;color:#374151;">Best regards,<br><strong>Atgeir Solutions Hiring Team</strong></p>
                <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;">
                For any queries, contact us at
                <a href="mailto:support@atgeirsolutions.com" style="color:#F07C2D;text-decoration:none;font-weight:500;">support@atgeirsolutions.com</a>
                or call <span style="font-weight:500;color:#6B7280;">+91 020-41292883</span>
                </p>
            </div>
            </div>"""
    subject = {"new": "Action required: upload your Aadhaar & PAN",
               "reminder": "Reminder: preboarding documents due soon",
               "rejected": f"Please re-upload your {doc_label}"}[kind]
    return _send_email(rec["candidate_email"], subject, body)


# ── Candidate (token) actions ─────────────────────────────────────────────────
def _candidate_from_token(token):
    data = verify_token(token or "")
    if not data:
        raise ApiError("This link is invalid or has expired. Please contact HR.", 401)
    rec = _get_record(data["c"], data["j"])
    if not rec:
        raise ApiError("Record not found.", 404)
    return rec

def get_public(body):
    v = _present(_candidate_from_token(body.get("token")))
    return _ok({"candidate_name": v["candidate_name"], "job_title": v["job_title"],
                "deadline": v["deadline"], "status": v["status"], "documents": v["documents"]})

def upload(body, f):
    rec = _candidate_from_token(body.get("token"))
    t = body.get("doc_type")
    if t not in DOC_TYPES:               raise ApiError("doc_type must be 'aadhaar' or 'pan'.")
    if f is None:                        raise ApiError("No file received.")
    if rec["deadline"] < datetime.now(timezone.utc):
        raise ApiError("The upload deadline has passed. Please contact HR for an extension.", 410)
    if (rec.get(f"{t}_status") or "missing") == "verified":
        raise ApiError("This document is already verified.", 409)
    raw = f.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:             raise ApiError("File is larger than 5 MB.", 413)
    kind = _sniff(raw)
    if not kind:                         raise ApiError("Only PDF, JPG or PNG files are accepted.", 415)
    mime, ext = kind
    path = f"{_safe(rec['job_id'])}/{_safe(rec['candidate_id'])}/{t}_{uuid.uuid4().hex}.{ext}"
    bucket = gcs.bucket(BUCKET_NAME)
    bucket.blob(path).upload_from_string(raw, content_type=mime)
    _run(f"""UPDATE {TABLE} SET {t}_status='uploaded', {t}_path=@p, {t}_mime=@m,
             {t}_uploaded_at=CURRENT_TIMESTAMP(), {t}_reason=NULL, {t}_reviewed_by=NULL,
             updated_at=CURRENT_TIMESTAMP() WHERE candidate_id=@c AND job_id=@j""",
         p=path, m=mime, c=rec["candidate_id"], j=rec["job_id"])
    old = rec.get(f"{t}_path")
    if old:
        try: bucket.blob(old).delete()
        except Exception: pass
    v = _present(_get_record(rec["candidate_id"], rec["job_id"]))
    return _ok({"status": v["status"], "documents": v["documents"]})


# ── Server / HR actions ───────────────────────────────────────────────────────
def create(body):
    cid, jid = body.get("candidate_id"), body.get("job_id")
    name, email = body.get("candidate_name"), body.get("candidate_email")
    if not (cid and jid and name and email):
        raise ApiError("candidate_id, job_id, candidate_name and candidate_email are required.")
    ok = list(_run(f"SELECT 1 FROM `{PROJECT_ID}.{DATASET_ID}.offer_letters` "
                   f"WHERE job_id=@j AND candidate_id=@c AND status='accepted' LIMIT 1", j=jid, c=cid))
    if not ok:
        raise ApiError("The offer has not been accepted yet.", 409)
    deadline = datetime.now(timezone.utc) + timedelta(days=DEADLINE_DAYS)
    res = _run(f"""MERGE {TABLE} T USING (SELECT @c AS candidate_id, @j AS job_id) S
                   ON T.candidate_id=S.candidate_id AND T.job_id=S.job_id
                   WHEN NOT MATCHED THEN INSERT
                     (candidate_id, job_id, candidate_name, candidate_email, job_title, deadline,
                      created_at, last_link_sent_at, reminder_sent, aadhaar_status, pan_status, updated_at)
                   VALUES (@c, @j, @n, @e, @t, @d, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), FALSE,
                           'missing', 'missing', CURRENT_TIMESTAMP())""",
               c=cid, j=jid, n=name, e=email, t=body.get("job_title") or "", d=deadline)
    rec = _get_record(cid, jid)
    if (res.num_dml_affected_rows or 0) == 0:
        return _ok({"already_exists": True, "record": _present(rec)})
    return _ok({"already_exists": False, "email_sent": _email_for(rec, "new"), "record": _present(rec)})

def _need_record(body):
    cid, jid = body.get("candidate_id"), body.get("job_id")
    rec = _get_record(cid, jid) if cid and jid else None
    if not rec: raise ApiError("Preboarding record not found.", 404)
    return rec

def list_for_job(body):
    if not body.get("job_id"): raise ApiError("job_id is required.")
    rows = _run(f"SELECT * FROM {TABLE} WHERE job_id=@j", j=body["job_id"])
    return _ok({"records": [_present(dict(r.items())) for r in rows]})

def get_document(body):
    rec, t = _need_record(body), body.get("doc_type")
    if t not in DOC_TYPES: raise ApiError("doc_type must be 'aadhaar' or 'pan'.")
    path = rec.get(f"{t}_path")
    if not path or (rec.get(f"{t}_status") or "missing") == "missing":
        raise ApiError("No document uploaded.", 404)
    data = gcs.bucket(BUCKET_NAME).blob(path).download_as_bytes()
    return _ok({"mime": rec.get(f"{t}_mime"), "data": base64.b64encode(data).decode()})

def verify(body, hr):
    rec, t = _need_record(body), body.get("doc_type")
    if t not in DOC_TYPES: raise ApiError("doc_type must be 'aadhaar' or 'pan'.")
    res = _run(f"""UPDATE {TABLE} SET {t}_status='verified', {t}_reason=NULL, {t}_reviewed_by=@by,
                   updated_at=CURRENT_TIMESTAMP()
                   WHERE candidate_id=@c AND job_id=@j AND {t}_status='uploaded'""",
               by=hr, c=rec["candidate_id"], j=rec["job_id"])
    if (res.num_dml_affected_rows or 0) == 0:
        raise ApiError("Only an uploaded (pending review) document can be verified.", 409)
    return _ok({"record": _present(_get_record(rec["candidate_id"], rec["job_id"]))})

def reject(body, hr):
    rec, t = _need_record(body), body.get("doc_type")
    reason = (body.get("reason") or "").strip()
    if t not in DOC_TYPES: raise ApiError("doc_type must be 'aadhaar' or 'pan'.")
    if not reason:         raise ApiError("A rejection reason is required.")
    res = _run(f"""UPDATE {TABLE} SET {t}_status='rejected', {t}_reason=@r, {t}_reviewed_by=@by,
                   deadline=GREATEST(deadline, TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 3 DAY)),
                   reminder_sent=FALSE, updated_at=CURRENT_TIMESTAMP()
                   WHERE candidate_id=@c AND job_id=@j AND {t}_status IN ('uploaded','verified')""",
               r=reason, by=hr, c=rec["candidate_id"], j=rec["job_id"])
    if (res.num_dml_affected_rows or 0) == 0:
        raise ApiError("There is no uploaded document to reject.", 409)
    rec = _get_record(rec["candidate_id"], rec["job_id"])
    sent = _email_for(rec, "rejected", doc_label=DOC_TYPES[t], reason=reason)
    return _ok({"email_sent": sent, "record": _present(rec)})

def resend(body):
    rec = _need_record(body)
    sent = _email_for(rec, "new")
    _run(f"UPDATE {TABLE} SET last_link_sent_at=CURRENT_TIMESTAMP() WHERE candidate_id=@c AND job_id=@j",
         c=rec["candidate_id"], j=rec["job_id"])
    return _ok({"email_sent": sent})

def extend(body):
    rec = _need_record(body)
    try: days = int(body.get("days", 0))
    except (TypeError, ValueError): days = 0
    if not 1 <= days <= 14: raise ApiError("days must be between 1 and 14.")
    _run(f"""UPDATE {TABLE} SET deadline=TIMESTAMP_ADD(GREATEST(deadline, CURRENT_TIMESTAMP()), INTERVAL @d DAY),
             reminder_sent=FALSE, updated_at=CURRENT_TIMESTAMP() WHERE candidate_id=@c AND job_id=@j""",
         d=days, c=rec["candidate_id"], j=rec["job_id"])
    return _ok({"record": _present(_get_record(rec["candidate_id"], rec["job_id"]))})

def run_reminders():
    """Hit hourly by Cloud Scheduler. Reminds ~24h before the deadline."""
    rows = list(_run(f"""SELECT * FROM {TABLE}
        WHERE reminder_sent IS NOT TRUE AND deadline > CURRENT_TIMESTAMP()
          AND deadline <= TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
          AND NOT (aadhaar_status IN ('uploaded','verified') AND pan_status IN ('uploaded','verified'))"""))
    n = 0
    for r in rows:
        rec = dict(r.items())
        if _email_for(rec, "reminder"):
            _run(f"UPDATE {TABLE} SET reminder_sent=TRUE WHERE candidate_id=@c AND job_id=@j",
                 c=rec["candidate_id"], j=rec["job_id"])
            n += 1
    return _ok({"reminders_sent": n})


# ── Entry point ───────────────────────────────────────────────────────────────
@functions_framework.http
def preboarding(request):
    if request.method == "OPTIONS":
        return ("", 204, HEADERS)

    if (request.content_type or "").startswith("multipart/"):
        body = request.form.to_dict()
    else:
        body = request.get_json(silent=True) or {}
    action = body.get("action")
    logging.info("preboarding action=%s", action)

    try:
        if action == "get_public":  return get_public(body)
        if action == "upload":      return upload(body, request.files.get("file"))

        if action == "run_reminders":
            if not _is_internal(request): raise ApiError("Unauthorized.", 401)
            return run_reminders()

        if action == "create" and _is_internal(request):
            return create(body)

        if action in ("create", "list", "get_document", "verify", "reject", "resend", "extend"):
            hr = _hr_identity(request, body)
            if not hr: raise ApiError("Unauthorized.", 401)
            if action == "create":       return create(body)
            if action == "list":         return list_for_job(body)
            if action == "get_document": return get_document(body)
            if action == "verify":       return verify(body, hr)
            if action == "reject":       return reject(body, hr)
            if action == "resend":       return resend(body)
            if action == "extend":       return extend(body)

        raise ApiError("Unknown action.", 400)
    except ApiError as e:
        return _err(e.message, e.code)
    except Exception as e:
        logging.exception("preboarding failed")
        return _err("Internal error.", 500)