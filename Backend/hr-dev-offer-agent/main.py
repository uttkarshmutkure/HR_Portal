import os
import json
import asyncio
import requests

# ── Must be set BEFORE any ADK/genai imports ─────────────────────────────────
# ADK reads these env vars at import time to decide Vertex AI vs Gemini API.
os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "1"
os.environ["GOOGLE_CLOUD_PROJECT"]      = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
os.environ["GOOGLE_CLOUD_LOCATION"]     = "asia-south1"

from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor

from google.cloud import bigquery
import functions_framework

# ── ADK imports (after env vars) ─────────────────────────────────────────────
from google import genai
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# ── Clients ───────────────────────────────────────────────────────────────────
bq_client     = bigquery.Client()
project_id    = os.environ.get('GOOGLE_CLOUD_PROJECT', 'atgeir-moae-dev')
dataset_id    = os.environ.get('BQ_DATASET_ID', 'hr_dataset')
email_api_url = os.environ.get('EMAIL_API_URL', 'https://wb-gateway-7xpbhfkr.an.gateway.dev/hr-screening/send-email')
test_email    = os.environ.get('TEST_EMAIL', '')

MODEL    = "gemini-2.5-flash"
APP_NAME = "offer_agent_app"

# ── Shared session service ────────────────────────────────────────────────────
session_service = InMemorySessionService()

DEFAULT_SALARY_RULES = {
    "basicPercentOfCTC":  50,     # Basic = 50% of CTC
    "hraPercentOfBasic":  50,     # HRA = 50% of Basic
    "pfPercentOfBasic":   12,     # PF = 12% of Basic
    "medicalAnnual":      15000,
    "conveyanceAnnual":   19200,
    "ltaAnnual":          12000,
    "bonusAnnual":        0,
    "offerValidityDays":  7,
}

import hashlib

def _salary_rules_hash(salary_rules: dict) -> str:
    """Stable short hash of the effective salary rules, used to key chat sessions.
    This ensures that changing the Salary Panel starts a FRESH conversation
    instead of letting old chat history (with stale numbers) leak into new replies."""
    merged = {**DEFAULT_SALARY_RULES, **(salary_rules or {})}
    canonical = json.dumps(merged, sort_keys=True)
    return hashlib.sha1(canonical.encode()).hexdigest()[:8]



# ─────────────────────────────────────────────────────────────────────────────
# EMAIL TEMPLATES
# ─────────────────────────────────────────────────────────────────────────────

SUPPORT_FOOTER = """
    <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;">
        For any queries, contact us at
        <a href="mailto:support@atgeirsolutions.com" style="color:#F07C2D;text-decoration:none;font-weight:500;">support@atgeirsolutions.com</a>
        or call <span style="font-weight:500;color:#6B7280;">+91 020-41292883</span>
    </p>
"""

OFFER_EMAIL_TEMPLATE = """
<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
  <div style="background:#F07C2D;padding:24px 28px;">
    <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.02em;">Atgeir Solutions</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">Offer Letter</div>
  </div>
  <div style="padding:28px;">
    {offer_body}
    <p style="margin:20px 0 0;font-size:13px;color:#374151;">Best regards,<br><strong>Atgeir Solutions HR Team</strong></p>
  </div>
  {support_footer}
</div>
"""


# ─────────────────────────────────────────────────────────────────────────────
# TOOLS
# ─────────────────────────────────────────────────────────────────────────────

def send_email_tool(to_email: str, subject: str, html_body: str) -> str:
    actual_recipient = test_email if test_email else to_email
    try:
        res = requests.post(
            email_api_url,
            json={"to": actual_recipient, "subject": subject, "body": html_body},
            timeout=10
        )
        if res.status_code == 200:
            return "Email sent successfully."
        return f"Failed with status: {res.status_code}"
    except Exception as e:
        return f"Email send error: {str(e)}"


def save_offer_to_db(
    job_id: str,
    candidate_id: str,
    candidate_name: str,
    candidate_email: str,
    designation: str,
    base_ctc: str,
    variable_pay: str,
    joining_date: str,
    work_location: str,
    probation: str,
    reporting_manager: str,
    offer_html: str,
    breakup: dict = None,
    salary_rules_json: str = "",
    status: str = "sent"
) -> str:
    """Save (or overwrite) the offer for this job+candidate, including full salary breakup as JSON."""
    try:
        table = f"{project_id}.{dataset_id}.offer_letters"
        breakup = breakup or {}

        now = datetime.now(timezone.utc).isoformat()

        row = {
            "job_id":            job_id,
            "candidate_id":      candidate_id,
            "candidate_name":    candidate_name,
            "candidate_email":   candidate_email,
            "designation":       designation,
            "base_ctc":          base_ctc,
            "variable_pay":      variable_pay,
            "joining_date":      joining_date or None,
            "work_location":     work_location,
            "probation":         probation,
            "reporting_manager": reporting_manager,
            "offer_html":        offer_html,
            "salary_breakup":    json.dumps(breakup) if breakup else None,
            "salary_rules":      salary_rules_json or None,
            "status":            status,
            "created_at":        now,
            "updated_at":        now,
        }

        # ── Use MERGE (upsert) keyed on job_id + candidate_id ──
        # This ensures regenerating an offer for the SAME candidate always
        # overwrites their single existing row instead of creating duplicates
        # or silently failing to update (which was the old delete+insert bug).
        set_clauses = ", ".join(f"T.{k} = @{k}" for k in row.keys() if k not in ("job_id", "candidate_id", "created_at", "updated_at"))
        insert_cols = ", ".join(row.keys())
        insert_vals = ", ".join(f"@{k}" for k in row.keys())

        merge_q = f"""
            MERGE `{table}` T
            USING (SELECT @job_id AS job_id, @candidate_id AS candidate_id) S
            ON T.job_id = S.job_id AND T.candidate_id = S.candidate_id
            WHEN MATCHED THEN
              UPDATE SET {set_clauses}, T.updated_at = @updated_at_now
            WHEN NOT MATCHED THEN
              INSERT ({insert_cols})
              VALUES ({insert_vals})
        """

        query_params = [
            bigquery.ScalarQueryParameter(k, "STRING", v if v is not None else None)
            for k, v in row.items()
        ]
        query_params.append(bigquery.ScalarQueryParameter("updated_at_now", "STRING", now))

        job_config = bigquery.QueryJobConfig(query_parameters=query_params)
        bq_client.query(merge_q, job_config=job_config).result()

        return "Offer saved to database successfully."
    except Exception as e:
        return f"DB save error: {str(e)}"


def update_offer_draft(
    designation: str = "",
    base_ctc: str = "",
    variable_pay: str = "",
    joining_date: str = "",
    location: str = "",
    probation: str = "",
    reporting_manager: str = "",
    candidate_phone: str = "",
    candidate_address: str = "",
    breakup: dict = None,
    custom_values: dict = None
) -> str:
    """Update the current offer draft with one or more field values extracted from HR's message."""
    updated = {k: v for k, v in {
        "designation":      designation,
        "baseCTC":          base_ctc,
        "variablePay":      variable_pay,
        "joiningDate":      joining_date,
        "location":         location,
        "probation":        probation,
        "reportingManager": reporting_manager,
        "candidatePhone":   candidate_phone,
        "candidateAddress": candidate_address,
        "breakup":          breakup,
        "customValues":     custom_values,
    }.items() if v}
    return json.dumps(updated)


# ─────────────────────────────────────────────────────────────────────────────
# BQ HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_candidate(candidate_id: str) -> dict:
    rows = list(bq_client.query(
        f"SELECT name, email, phone, total_experience_years, skills "
        f"FROM `{project_id}.{dataset_id}.candidates` "
        f"WHERE candidate_id = '{candidate_id}' LIMIT 1"
    ))
    if rows:
        r = rows[0]
        return {
            "name":       r.name,
            "email":      r.email,
            "phone":      r.phone      if hasattr(r, 'phone')   else "",
            "experience": r.total_experience_years,
            "skills":     r.skills or "",
        }
    return {}


def _fetch_job(job_id: str) -> dict:
    rows = list(bq_client.query(
        f"SELECT title FROM `{project_id}.{dataset_id}.jobs` "
        f"WHERE job_id = '{job_id}' LIMIT 1"
    ))
    return {"title": rows[0].title} if rows else {}


def _fetch_prior_offers(job_id: str, candidate_id: str) -> list:
    rows = list(bq_client.query(
        f"SELECT candidate_name, designation, base_ctc, variable_pay, " 
        f"joining_date, work_location, probation, reporting_manager "
        f"FROM `{project_id}.{dataset_id}.offer_letters` "
        f"WHERE job_id = '{job_id}' AND candidate_id != '{candidate_id}' AND status != 'cancelled' "
        f"ORDER BY created_at DESC LIMIT 10"
    ))
    return [
        {
            "candidateName":    r.candidate_name,
            "designation":      r.designation or "",
            "baseCTC":          r.base_ctc or "",
            "variablePay":      r.variable_pay or "",
            "joiningDate":      str(r.joining_date) if r.joining_date else "",
            "location":         r.work_location or "",
            "probation":        r.probation or "",
            "reportingManager": r.reporting_manager or "",
        }
        for r in rows
    ]


# ─────────────────────────────────────────────────────────────────────────────
# AGENT BUILDERS
# ─────────────────────────────────────────────────────────────────────────────

def _build_chat_agent(cand_ctx: dict, job_ctx: dict, prior_offers: list, current_draft: dict, custom_fields: list = None, salary_rules: dict = None) -> LlmAgent:
    salary_rules = {**DEFAULT_SALARY_RULES, **(salary_rules or {})}
    
    custom_instructions = ""
    if custom_fields:
        custom_instructions = f"""
CUSTOM TEMPLATE FIELDS DETECTED:
The HR user uploaded a custom offer letter format that requires these additional fields:
{json.dumps(custom_fields, indent=2)}

When gathering information from HR, ensure you also ask for and populate these custom fields!
To save them, pass a dictionary mapping the field name to its value into the `custom_values` argument of the `update_offer_draft` tool.
"""

    return LlmAgent(
        name="offer_chat_agent",
        model=MODEL,
        description="Conversational HR assistant that helps fill out an offer letter for a candidate.",
        instruction=f"""You are a friendly Offer Generation Assistant helping an HR manager create an offer letter.

CANDIDATE CONTEXT:
{json.dumps(cand_ctx, indent=2)}

JOB CONTEXT:
{json.dumps(job_ctx, indent=2)}

CURRENT OFFER DRAFT (fields filled so far):
{json.dumps(current_draft, indent=2)}

PRIOR OFFERS FOR THIS JOB:
{json.dumps(prior_offers, indent=2)}
{custom_instructions}

PRE-FILLED BASIC INFO:
The candidate's name, email, and phone have already been pulled from our database and pre-filled in the offer letter. Do NOT ask HR to provide these — they are already there.

COMPENSATION & ANNEXURE MATH RULES:
When the user provides a total CTC, you MUST auto-calculate the full Salary Breakup (Monthly and Annual values) and pass it via the 'breakup' dictionary in your tool call.

CALCULATION RULES (Annual) — these come from the HR-configured Salary Panel, use them exactly:
1. Basic: {salary_rules['basicPercentOfCTC']}% of Total CTC
2. HRA: {salary_rules['hraPercentOfBasic']}% of Basic
3. PF: {salary_rules['pfPercentOfBasic']}% of Basic
4. Medical: {salary_rules['medicalAnnual']} annual ({salary_rules['medicalAnnual']//12} monthly)
5. Conveyance: {salary_rules['conveyanceAnnual']} annual ({salary_rules['conveyanceAnnual']//12} monthly)
6. LTA: {salary_rules['ltaAnnual']} annual ({salary_rules['ltaAnnual']//12} monthly)
7. Bonus: {salary_rules['bonusAnnual']} annual (unless HR specifies a different value)
8. Special Allowance: The remaining balance! (Total CTC minus all the fields above).
* Monthly values are exactly Annual / 12.

STRICT JSON BLUEPRINT:
Your 'breakup' dictionary MUST perfectly match this exact structure and key naming:
{{
  "basic": {{ "monthly": "...", "annual": "..." }},
  "hra": {{ "monthly": "...", "annual": "..." }},
  "specialAllowance": {{ "monthly": "...", "annual": "..." }},
  "conveyance": {{ "monthly": "1600", "annual": "19200" }},
  "medical": {{ "monthly": "1250", "annual": "15000" }},
  "lta": {{ "monthly": "1000", "annual": "12000" }},
  "pf": {{ "monthly": "...", "annual": "..." }},
  "bonus": {{ "monthly": "0", "annual": "0" }}
}}

YOUR ROLE:
- **GREETING THE USER:** If the user says hi or starts the conversation, introduce yourself naturally. Explicitly mention that you have pre-filled {cand_ctx.get('name', 'the candidate')}'s basic information (email and phone). Ask if they want to use the default offer letter format, or upload their own.
- **FORMAT SWITCHING:** If the user asks to change the format, upload a new format, or switch back to the default format, warmly acknowledge their request and tell them to click the option provided below. NEVER say you lack a user interface or cannot display clickable options. The system automatically renders the buttons for you.
- **HANDLING FILLING CHOICE:** If the user says they want to "chat to fill the information", acknowledge it and ask what designation and Base CTC they would like to offer to get started.
- **FORM REVIEW:** If the user asks you to check the form they just filled out, evaluate the CURRENT OFFER DRAFT. If crucial fields like Designation, Base CTC, Joining Date, Location, or Reporting Manager are missing, explicitly tell them what is missing and ask them to provide it here in the chat.
- **SHOW YOUR MATH (CRITICAL):** Whenever you calculate the salary breakup based on a newly provided Base CTC, you MUST explicitly list the calculated Annual and Monthly breakdown (Basic, HRA, PF, Special Allowance, etc.) directly in your chat response text so the user can verify the math before proceeding.
- **FORMATTING RULE:** Always use actual line breaks and bullet points when listing questions, options, or salary math so your text is easy to scan.
- Do NOT add any JSON blocks to your reply text — use the update_offer_draft tool instead.""",
        tools=[update_offer_draft],
        generate_content_config=types.GenerateContentConfig(temperature=0.4),
    )


def _build_generate_agent(cand_ctx: dict, job_ctx: dict, draft: dict, send_email: bool, offer_validity_days: int = 7, salary_rules: dict = None) -> LlmAgent:
    salary_rules = {**DEFAULT_SALARY_RULES, **(salary_rules or {})}
    designation          = draft.get('designation', job_ctx.get('title', ''))
    deadline = (datetime.now(timezone.utc) + timedelta(days=offer_validity_days)).strftime('%-d %B %Y')
    offer_email_template = (
    OFFER_EMAIL_TEMPLATE
    .replace('{support_footer}', SUPPORT_FOOTER)
    .replace('{offer_body}', 'OFFER_BODY_PLACEHOLDER')
)

    return LlmAgent(
        name="offer_generate_agent",
        model=MODEL,
        description="Writes a polished offer letter, saves it to BigQuery, and emails it to the candidate.",
        instruction=f"""You are an HR offer letter writer. Your job is to:
1. Write a professional, warm offer letter HTML body for the candidate.
2. Call save_offer_to_db to save it to the database.
3. If SEND EMAIL is True, call send_email_tool to email the candidate.

CANDIDATE: {cand_ctx.get('name', 'Candidate')} ({cand_ctx.get('email', '')})
DESIGNATION: {designation}
OFFER DETAILS: {json.dumps(draft, indent=2)}
SEND EMAIL: {send_email}
ACCEPTANCE DEADLINE: {deadline}
SALARY RULES USED: {json.dumps(salary_rules, indent=2)}

OFFER LETTER WRITING RULES:
- Write ONLY the inner HTML body (no <html>/<head>/<body> tags).
- Use inline styles. Font: Inter/Arial. Accent color: #F07C2D.
- Include: greeting paragraph, congratulations, compensation table (only non-empty fields),
  joining instructions, acceptance deadline, warm closing.
- Compensation table style: border: 1px solid #E5E7EB, alternating #F9FAFB rows.
- Max ~400 words. Professional but warm tone.

AFTER writing the offer body HTML, wrap it in this outer email template and call send_email_tool:
{offer_email_template}

Replace OFFER_BODY_PLACEHOLDER with the offer HTML you wrote.

TOOL CALL ORDER:
1. save_offer_to_db — pass all offer fields + the full wrapped HTML as offer_html + the full breakup dictionary (from OFFER DETAILS above, under the "breakup" key) + salary_rules_json (a JSON string of the SALARY RULES USED shown above)
2. send_email_tool — only if SEND EMAIL is True; use subject "Offer Letter — {designation} at Atgeir Solutions"
""",
        tools=[save_offer_to_db, send_email_tool],
        generate_content_config=types.GenerateContentConfig(temperature=0.2),
    )


# ─────────────────────────────────────────────────────────────────────────────
# ADK RUNNER HELPER
# ─────────────────────────────────────────────────────────────────────────────

async def _run_agent_turn(agent: LlmAgent, session_id: str, user_message: str) -> dict:
    runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)

    existing = await session_service.get_session(app_name=APP_NAME, user_id="hr_user", session_id=session_id)
    if existing is None:
        await session_service.create_session(app_name=APP_NAME, user_id="hr_user", session_id=session_id)

    content      = types.Content(role="user", parts=[types.Part(text=user_message)])
    reply_text   = ""
    tool_results = []

    async for event in runner.run_async(user_id="hr_user", session_id=session_id, new_message=content):
        if hasattr(event, "content") and event.content and event.content.parts:
            for part in event.content.parts:
                if (
                    hasattr(part, "text") and part.text
                    and event.content.role == "model"
                    and not getattr(part, "function_call", None)
                    and not getattr(part, "function_response", None)
                ):
                    reply_text += part.text

                if hasattr(part, "function_call") and part.function_call:
                    tool_results.append({
                        "tool":   part.function_call.name,
                        "result": dict(part.function_call.args or {}),
                        "source": "function_call",
                    })
                if hasattr(part, "function_response") and part.function_response:
                    tool_results.append({
                        "tool":   part.function_response.name,
                        "result": part.function_response.response,
                        "source": "function_response",
                    })

    return {"text": reply_text.strip(), "tool_results": tool_results}


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

@functions_framework.http
def offer_agent(request):
    if request.method == 'OPTIONS':
        return ('', 204, {
            'Access-Control-Allow-Origin':  '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type'
        })
    headers = {'Access-Control-Allow-Origin': '*'}

    try:
        # Handle Multipart Form Data for Custom Document Uploads
        if request.content_type and 'multipart/form-data' in request.content_type:
            action = request.form.get('action')
            if action == 'process_template':
                return _handle_process_template(request, headers)
            return (json.dumps({"error": f"Unknown multipart action: {action}"}), 400, headers)

        # Standard JSON body handler
        body   = request.get_json(silent=True) or {}
        action = body.get('action', 'chat')

        if action == 'chat':
            return _handle_chat(body, headers)
        elif action == 'generate':
            return _handle_generate(body, headers)
        elif action == 'get_offers':
            return _handle_get_offers(body, headers)
        else:
            return (json.dumps({"error": f"Unknown action: {action}"}), 400, headers)

    except Exception as e:
        print(f"[offer_agent] ERROR: {e}")
        return (json.dumps({"error": str(e)}), 500, headers)


# ─────────────────────────────────────────────────────────────────────────────
# ACTION 1 — process_template
# ─────────────────────────────────────────────────────────────────────────────

def _handle_process_template(request, headers: dict):
    uploaded_file = request.files.get('file')

    if not uploaded_file:
        return (json.dumps({"error": "No file uploaded"}), 400, headers)

    file_bytes = uploaded_file.read()
    mime_type = uploaded_file.content_type

    if 'pdf' in uploaded_file.filename.lower() and not mime_type:
        mime_type = 'application/pdf'
    elif 'docx' in uploaded_file.filename.lower() and not mime_type:
        mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    try:
        client = genai.Client()

        prompt = """
        You are an expert HR Document Engineer and Frontend Developer. I have provided an Offer Letter document.
        Your task is to convert this document into a perfect, production-ready HTML template.

        STRICT HTML/CSS RULES:
        1. RECREATE TABLES PERFECTLY: Use properly structured HTML `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, and `<td>` tags. Add inline CSS (`border-collapse: collapse; width: 100%; text-align: left;`) and add `border: 1px solid #E5E7EB; padding: 8px;` to all cells to make the table professional.
        2. PRESERVE ALIGNMENT & LAYOUT: Use inline CSS for text alignment (e.g., `<div style="text-align: right;">` for dates, `<div style="text-align: center; font-weight: bold;">` for titles). 
        3. SPACING & TYPOGRAPHY: Use `<p style="margin-bottom: 16px;">` for paragraphs. Wrap the entire output in a `<div style="font-family: Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #111827;">`.
        4. LOGOS & IMAGES: If there is a logo placeholder (like "[Insert your logo here]"), DO NOT use an `<img>` tag. It will break the parser. Instead, use a styled div block: `<div style="padding: 16px 24px; background: #F3F4F6; border: 1px dashed #D1D5DB; text-align: center; color: #9CA3AF; font-weight: bold; width: fit-content; border-radius: 4px; margin-bottom: 24px;">[Company Logo Placeholder]</div>`.
        5. CLEAN UP ARTIFACTS: Completely remove any page numbers, author watermarks, or repetitive footer texts (e.g., "Page 1 of 3").
        6. MANDATORY PLACEHOLDER FORMAT: You MUST wrap EVERY blank (____), bracketed text ([Name]), or variable field in exact double curly braces. Example: `{{ Designation }}`, `{{ Base CTC }}`. NEVER output a variable name as plain text without the curly braces!
        7. EXACT MATCH: Standardize common fields to EXACTLY these names inside the braces: Designation, Base CTC, Variable Pay, Joining Date, Location, Probation, Reporting Manager, Candidate Name, Candidate Address, Candidate Phone.
        8. NO TRUNCATION (CRITICAL): You MUST process and convert the ENTIRE document from the first page to the very last page. Do not summarize, do not cut corners, and do not stop after the first page or section. If the document contains multiple pages, long terms and conditions, or multiple signature blocks, you must include ALL of them in your final HTML output.

        Ensure you output valid JSON matching this schema exactly:
        {
          "html": "<div style='...'>...</div>",
          "fields": [
            {"name": "Designation", "description": "The job title"},
            {"name": "Custom Allowance", "description": "Specific allowance mentioned in template"}
          ]
        }
        """

        response = client.models.generate_content(
            model=MODEL,
            contents=[
                types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
                prompt
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
                max_output_tokens=8192
            )
        )

        return (response.text, 200, {**headers, "Content-Type": "application/json"})

    except Exception as e:
        print(f"[offer_agent] process_template ERROR: {e}")
        return (json.dumps({"error": str(e)}), 500, headers)


# ─────────────────────────────────────────────────────────────────────────────
# ACTION 2 — chat
# ─────────────────────────────────────────────────────────────────────────────

def _handle_chat(body: dict, headers: dict):
    job_id        = body.get('jobId', '')
    candidate_id  = body.get('candidateId', '')
    user_message  = body.get('message', '')
    current_draft = body.get('currentDraft', {})
    salary_rules = body.get('salaryRules', {})
    history       = body.get('history', [])
    custom_fields = body.get('customFields', [])

    if not job_id or not candidate_id:
        return (json.dumps({"error": "Missing jobId or candidateId"}), 400, headers)

    with ThreadPoolExecutor(max_workers=3) as ex:
        f_cand   = ex.submit(_fetch_candidate, candidate_id)
        f_job    = ex.submit(_fetch_job, job_id)
        f_offers = ex.submit(_fetch_prior_offers, job_id, candidate_id)
        cand_ctx     = f_cand.result()
        job_ctx      = f_job.result()
        prior_offers = f_offers.result()

    session_id = f"chat_{job_id}_{candidate_id}_{_salary_rules_hash(salary_rules)}"
    
    agent = _build_chat_agent(cand_ctx, job_ctx, prior_offers, current_draft, custom_fields, salary_rules)
    result = asyncio.run(_run_agent_turn(agent, session_id, user_message))

    offer_update = {}
    for tr in result["tool_results"]:
        if tr["tool"] == "update_offer_draft":
            try:
                raw = tr["result"]
                source = tr.get("source", "")

                if source == "function_call" and isinstance(raw, dict):
                    arg_map = {
                        "designation":       "designation",
                        "base_ctc":          "baseCTC",
                        "variable_pay":      "variablePay",
                        "joining_date":      "joiningDate",
                        "location":          "location",
                        "probation":         "probation",
                        "reporting_manager": "reportingManager",
                        "candidate_phone":   "candidatePhone",
                        "candidate_address": "candidateAddress",
                        "breakup":           "breakup",
                        "custom_values":     "customValues",
                    }
                    for arg_key, draft_key in arg_map.items():
                        val = raw.get(arg_key)
                        if val:
                            offer_update[draft_key] = val
                    continue

                def _unwrap(v):
                    if isinstance(v, dict):
                        for key in ("result", "output"):
                            if key in v and len(v) == 1:
                                return _unwrap(v[key])
                        return v
                    if isinstance(v, str):
                        v = v.strip()
                        if v:
                            try: return _unwrap(json.loads(v))
                            except json.JSONDecodeError: pass
                    return None

                parsed = _unwrap(raw)
                if isinstance(parsed, dict):
                    offer_update.update({k: v for k, v in parsed.items() if v})
            except Exception as e:
                print(f"[offer_agent] offer_update parse error: {e}")

    options = []
    msg_lower = user_message.lower()
    
    # Show options on first message OR if user asks to change format
    if len(history) == 0 or any(kw in msg_lower for kw in ['upload', 'format', 'template', 'default', 'own']):
        options = ["Use default format", "Upload my own format"]

    return (
        json.dumps({
            "reply": result["text"], 
            "offerUpdate": offer_update, 
            "options": options
        }),
        200,
        {**headers, "Content-Type": "application/json"}
    )


# ─────────────────────────────────────────────────────────────────────────────
# ACTION 3 — generate
# ─────────────────────────────────────────────────────────────────────────────

def _handle_generate(body: dict, headers: dict):
    job_id       = body.get('jobId', '')
    candidate_id = body.get('candidateId', '')
    draft        = body.get('draft', {})
    send_email   = body.get('sendEmail', False)
    salary_rules = body.get('salaryRules', {})
    offer_validity_days = salary_rules.get('offerValidityDays', DEFAULT_SALARY_RULES['offerValidityDays'])

    if not job_id or not candidate_id:
        return (json.dumps({"error": "Missing jobId or candidateId"}), 400, headers)

    with ThreadPoolExecutor(max_workers=2) as ex:
        f_c      = ex.submit(_fetch_candidate, candidate_id)
        f_j      = ex.submit(_fetch_job, job_id)
        cand_ctx = f_c.result()
        job_ctx  = f_j.result()

    session_id = f"generate_{job_id}_{candidate_id}"
    agent      = _build_generate_agent(cand_ctx, job_ctx, draft, send_email, offer_validity_days, salary_rules)
    prompt     = (
        f"Generate and save the offer letter for {cand_ctx.get('name', 'Candidate')}.\n"
        f"JOB ID: {job_id}\nCANDIDATE ID: {candidate_id}\nDRAFT: {json.dumps(draft)}"
    )
    result = asyncio.run(_run_agent_turn(agent, session_id, prompt))

    response_text = result["text"]
    saved_to_bq   = any(
        "saved to database" in str(tr["result"]).lower() or "successfully" in str(tr["result"]).lower()
        for tr in result["tool_results"] if tr["tool"] == "save_offer_to_db"
    )
    email_sent = any(
        "email sent" in str(tr["result"]).lower()
        for tr in result["tool_results"] if tr["tool"] == "send_email_tool"
    ) if send_email else False

    offer_html = ""
    if "<div" in response_text:
        try:
            offer_html = response_text[response_text.index("<div"):]
        except Exception:
            offer_html = response_text

    return (
        json.dumps({
            "offerHtml": offer_html,
            "savedToDB": saved_to_bq,
            "emailSent": email_sent,
            "agentLog":  response_text,
        }),
        200,
        {**headers, "Content-Type": "application/json"}
    )


# ─────────────────────────────────────────────────────────────────────────────
# ACTION 4 — get_offers
# ─────────────────────────────────────────────────────────────────────────────

def _handle_get_offers(body: dict, headers: dict):
    job_id = body.get('jobId', '')
    if not job_id:
        return (json.dumps({"offers": []}), 200, headers)

    rows = list(bq_client.query(
        f"SELECT candidate_id, candidate_name, designation, base_ctc, variable_pay, "
        f"joining_date, work_location, probation, reporting_manager, status, created_at, "
        f"salary_breakup, salary_rules "
        f"FROM `{project_id}.{dataset_id}.offer_letters` "
        f"WHERE job_id = '{job_id}' AND status != 'cancelled' "
        f"ORDER BY created_at DESC"
    ))

    offers = [
        {
            "candidateId":   r.candidate_id,
            "candidateName": r.candidate_name,
            "status":        r.status,
            "createdAt":     r.created_at.isoformat() if r.created_at else "",
            "salaryRules":   json.loads(r.salary_rules) if getattr(r, 'salary_rules', None) else None,
            "draft": {
                "designation":      r.designation       or "",
                "baseCTC":          r.base_ctc          or "",
                "variablePay":      r.variable_pay      or "",
                "joiningDate":      str(r.joining_date) if r.joining_date else "",
                "location":         r.work_location     or "",
                "probation":        r.probation         or "",
                "reportingManager": r.reporting_manager or "",
                "breakup": json.loads(r.salary_breakup) if getattr(r, 'salary_breakup', None) else {},
            },
        }
        for r in rows
    ]

    return (
        json.dumps({"offers": offers}),
        200,
        {**headers, "Content-Type": "application/json"}
    )