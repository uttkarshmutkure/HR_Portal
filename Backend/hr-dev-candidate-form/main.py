import base64, hashlib, hmac, json, logging, os, re, time
import functions_framework
from google.cloud import bigquery, storage

log = logging.getLogger(__name__)
bq = bigquery.Client()
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
DATASET_ID = os.environ.get("BQ_DATASET_ID", "hr_dataset")
CAND = f"`{PROJECT_ID}.{DATASET_ID}.candidates`"
JOBS = f"`{PROJECT_ID}.{DATASET_ID}.jobs`"
SECRET = os.environ.get("FORM_TOKEN_SECRET", "").encode()
TTL = 30 * 24 * 3600  # links valid 30 days
gcs = storage.Client()
BUCKET = os.environ.get("GCS_BUCKET_NAME", "hr-data-source-at")
JD_FOLDER = os.environ.get("JD_FOLDER", "jd")
CAREERS_BASE = os.environ.get("CAREERS_BASE_URL", "")

CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "3600"}

def _json(p, c): return (json.dumps(p), c, {**CORS, "Content-Type": "application/json"})
def _b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def _unb64(s): return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
def _mac(body): return _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())

def _sign(job_id, cid):
    body = _b64(json.dumps({"j": job_id, "c": cid, "x": int(time.time()) + TTL}).encode())
    return f"{body}.{_mac(body)}"

def _verify(token):
    try:
        body, sig = (token or "").split(".")
        if not hmac.compare_digest(sig, _mac(body)): return None
        p = json.loads(_unb64(body))
        return (p["j"], p["c"]) if p["x"] > time.time() else None
    except Exception:
        return None

def _q(sql, **params):
    cfg = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter(k, "STRING", v) for k, v in params.items()])
    return bq.query(sql, job_config=cfg).result()

def _candidate(job_id, cid):
    rows = list(_q(f"""SELECT c.name, c.email, c.phone, c.screening_form_submitted_at, j.title
                       FROM {CAND} c JOIN {JOBS} j ON j.job_id = c.job_id
                       WHERE c.job_id=@j AND c.candidate_id=@c LIMIT 1""", j=job_id, c=cid))
    return rows[0] if rows else None

EDU = {"graduate", "post_graduate", "diploma"}
GENDER = {"male", "female", "other", "prefer_not_to_say"}
YN = {"yes", "no"}

def _text(v, n=200): return re.sub(r"[\x00-\x1f\x7f]", " ", str(v or "")).strip()[:n]
def _num(v, lo, hi):
    try: n = float(str(v).replace(",", ""))
    except ValueError: return None
    return n if lo <= n <= hi else None

def _validate(a):
    out, errs = {}, []
    def need(k, ok, msg):
        if ok: out[k] = ok if ok is not True else a.get(k)
        else: errs.append(msg)
    need("gender", a.get("gender") in GENDER and a["gender"], "Gender is required")
    mob = re.sub(r"[\s-]", "", str(a.get("mobile") or ""))
    need("mobile", re.fullmatch(r"\+?\d{7,15}", mob) and mob, "Valid mobile number is required")
    need("education", a.get("education") in EDU and a["education"], "Education is required")
    for k, label in (("location", "Location"), ("preferred_location", "Preferred job location"),
                     ("current_employer", "Current or last employer")):
        need(k, _text(a.get(k)), f"{label} is required")
    need("key_skills", _text(a.get("key_skills"), 500), "Key skills are required")
    for k, hi, label in (("total_experience_years", 60, "Total experience"), ("notice_period_days", 365, "Notice period"),
                         ("current_ctc_lpa", 1000, "Current CTC"), ("expected_ctc_lpa", 1000, "Expected CTC")):
        n = _num(a.get(k), 0, hi)
        if n is None: errs.append(f"{label} is invalid")
        else: out[k] = n
    for k, label in (("notice_negotiable", "Negotiable notice period"), ("offer_in_hand", "Offer in hand")):
        need(k, a.get(k) in YN and a[k], f"{label} is required")
    if out.get("notice_negotiable") == "yes":
        n = _num(a.get("negotiable_days"), 0, 365)
        if n is None: errs.append("Negotiable notice days is invalid")
        else: out["negotiable_days"] = n
    if _text(a.get("offer_details")): out["offer_details"] = _text(a["offer_details"])
    return out, errs


def _serve_jd(request):
    job_id = (request.args.get("job_id") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{1,63}", job_id):
        return ("Invalid job_id", 400)

    bucket = gcs.bucket(BUCKET)
    blob = None
    for path in (f"{JD_FOLDER}/{job_id}/{job_id}.pdf", f"{JD_FOLDER}/{job_id}.pdf"):
        b = bucket.blob(path)
        if b.exists():
            blob = b
            break

    if blob is None:
        if CAREERS_BASE:   # no PDF found, so show the careers page instead
            return ("", 302, {"Location": f"{CAREERS_BASE.rstrip('/')}/careers/{job_id}"})
        return ("Job description not found", 404)

    return (blob.download_as_bytes(), 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": f'inline; filename="{job_id}.pdf"',
        "Cache-Control": "public, max-age=300",
    })

# ── Public: candidate opens / submits the form ──
@functions_framework.http
def candidate_form_http(request):
    if request.method == "OPTIONS": return ("", 204, CORS)
    if request.method == "GET": return _serve_jd(request)
    b = request.get_json(silent=True) or {}
    ids = _verify(b.get("token"))
    if not ids: return _json({"error": "This link is invalid or has expired."}, 401)
    job_id, cid = ids
    row = _candidate(job_id, cid)
    if not row: return _json({"error": "Candidate not found."}, 404)

    if b.get("action") == "GET":
        return _json({"name": row.name, "email": row.email, "mobile": row.phone or "",
                      "job_title": row.title, "submitted": row.screening_form_submitted_at is not None}, 200)

    if b.get("action") == "SUBMIT":
        answers, errs = _validate(b.get("answers") or {})
        if errs: return _json({"error": "; ".join(errs)}, 400)
        answers.update({"name": row.name, "email": row.email})   # taken from DB, not the browser
        res = _q(f"""UPDATE {CAND} SET screening_form = PARSE_JSON(@d),
                         screening_form_submitted_at = CURRENT_TIMESTAMP()
                     WHERE job_id=@j AND candidate_id=@c AND screening_form_submitted_at IS NULL""",
                 d=json.dumps(answers), j=job_id, c=cid)
        if (res.num_dml_affected_rows or 0) == 0:
            return _json({"error": "This form has already been submitted.", "code": "ALREADY_SUBMITTED"}, 409)
        return _json({"success": True}, 200)
    return _json({"error": "Unknown action"}, 400)

# ── HR only (keep behind your gateway auth): create link + mark sent ──
@functions_framework.http
def create_form_link_http(request):
    if request.method == "OPTIONS": return ("", 204, CORS)
    b = request.get_json(silent=True) or {}
    job_id, cid = (b.get("job_id") or "").strip(), (b.get("candidate_id") or "").strip()
    if not job_id or not cid or not _candidate(job_id, cid):
        return _json({"error": "Candidate not found."}, 404)
    _q(f"UPDATE {CAND} SET screening_form_sent_at = CURRENT_TIMESTAMP() WHERE job_id=@j AND candidate_id=@c",
       j=job_id, c=cid)
    return _json({"token": _sign(job_id, cid)}, 200)