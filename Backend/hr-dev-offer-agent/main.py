import os
import json
import asyncio
import requests

# ── Must be set BEFORE any ADK/genai imports ───────────────────────os.environ["GOOGLE_CLOUD_LOCATION"]     = "global"──────────
# ADK reads these env vars at import time to decide Vertex AI vs Gemini API.
os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "1"
os.environ["GOOGLE_CLOUD_PROJECT"]      = os.environ.get("GOOGLE_CLOUD_PROJECT", "atgeir-moae-dev")
os.environ["GOOGLE_CLOUD_LOCATION"]     = "global"

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

MODEL    = "gemini-3.5-flash"
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
    status: str = "sent",
    employee_type: str = "regular",
    intern_end_date: str = "",
    intern_stipend: str = "",
    consulting_fee_monthly: str = "",
    tax_percent: str = "",
    contract_duration: str = "",
) -> str:
    """Save (or overwrite) the offer for this job+candidate, including full salary breakup as JSON."""
    try:
        table = f"{project_id}.{dataset_id}.offer_letters"
        breakup = breakup or {}
 
        now = datetime.now(timezone.utc).isoformat()
 
        row = {
            "job_id":                job_id,
            "candidate_id":          candidate_id,
            "candidate_name":        candidate_name,
            "candidate_email":       candidate_email,
            "designation":           designation,
            "base_ctc":              base_ctc,
            "variable_pay":          variable_pay,
            "joining_date":          joining_date or None,
            "work_location":         work_location,
            "probation":             probation,
            "reporting_manager":     reporting_manager,
            "offer_html":            offer_html,
            "salary_breakup":        json.dumps(breakup) if breakup else None,
            "salary_rules":          salary_rules_json or None,
            "status":                status,
            "employee_type":         employee_type or "regular",
            "intern_end_date":       intern_end_date or None,
            "intern_stipend":        intern_stipend or None,
            "consulting_fee_monthly": consulting_fee_monthly or None,
            "tax_percent":           tax_percent or None,
            "contract_duration":     contract_duration or None,
            "created_at":            now,
            "updated_at":            now,
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
        print(f"[offer_agent] DB save error: {e}")
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
    custom_values: dict = None,
    employee_type: str = "",
    intern_end_date: str = "",
    intern_stipend: str = "",
    consulting_fee_monthly: str = "",
    tax_percent: str = "",
    contract_duration: str = "",
) -> str:
    """Update the current offer draft with one or more field values extracted from HR's message.
 
    employee_type must be one of: 'regular', 'intern', 'consultant', 'custom'.
    - For 'intern': use intern_stipend (flat monthly amount) and intern_end_date. Do NOT fill breakup/PF.
    - For 'consultant': use consulting_fee_monthly, tax_percent (default 10), and contract_duration. Do NOT fill breakup/PF.
    - For 'regular': use base_ctc + breakup as usual.
    """
    updated = {k: v for k, v in {
        "designation":          designation,
        "baseCTC":              base_ctc,
        "variablePay":          variable_pay,
        "joiningDate":          joining_date,
        "location":             location,
        "probation":            probation,
        "reportingManager":     reporting_manager,
        "candidatePhone":       candidate_phone,
        "candidateAddress":     candidate_address,
        "breakup":              breakup,
        "customValues":         custom_values,
        "employeeType":         employee_type,
        "internEndDate":        intern_end_date,
        "internStipend":        intern_stipend,
        "consultingFeeMonthly": consulting_fee_monthly,
        "taxPercent":           tax_percent,
        "contractDuration":     contract_duration,
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
 
EMPLOYEE TYPES — ASK THIS EARLY (CRITICAL):
Before diving into salary numbers, you MUST find out what kind of offer this is, unless CURRENT OFFER DRAFT already has an "employeeType" set. There are four kinds:
1. **Regular / Experienced** — a normal full-time employee. Uses the standard Basic/HRA/PF/etc. salary breakup.
2. **Intern** — a fixed-duration internship. Uses a flat monthly stipend (no Basic/HRA/PF breakup, no PF, no probation — instead has an internship end date).
3. **Consultant** — a contract-based professional engagement, NOT an employee. Uses a flat monthly Consulting Fee with a flat {salary_rules.get('consultantTaxPercent', 10)}% TDS/tax deduction (no PF, no Basic/HRA breakup, no probation — instead has a contract duration).
4. **Custom** — HR uploads their own template/format; you just fill in whatever fields that template needs (handled separately — do not ask about it unless the user mentions uploading a template).
 
Ask naturally, e.g. "Is this offer for a regular full-time hire, an intern, or a consultant?" Once you know, call update_offer_draft with employee_type set to one of: "regular", "intern", "consultant". Adapt every question after that to match the type (see rules below).
 
COMPENSATION & ANNEXURE MATH RULES:
 
**If employeeType is "regular"**: When the user provides a total CTC, you MUST auto-calculate the full Salary Breakup (Monthly and Annual values) and pass it via the 'breakup' dictionary in your tool call.
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

STRICT JSON BLUEPRINT for 'breakup' (regular employees ONLY):
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
 
**If employeeType is "intern"**: Do NOT ask for CTC or compute a breakup. Just ask for the flat monthly stipend amount and pass it as intern_stipend. Ask for the internship end date (or duration, e.g. "6 months from joining") and pass it as intern_end_date. There is no PF and no probation for interns — never mention PF or probation to the user for an intern offer.
 
**If employeeType is "consultant"**: Do NOT ask for CTC or compute a Basic/HRA/PF breakup. Ask for the flat monthly consulting fee and pass it as consulting_fee_monthly. Ask for the contract duration (e.g. "6 months", "1 year") and pass it as contract_duration. Tax is a flat 10% TDS deduction by default — pass tax_percent as "10" unless HR specifies a different rate. There is no PF and no probation for consultants — never mention PF or probation to the user for a consultant offer. Show the math: Fee minus TDS equals Net Payable, both monthly and annual.

HELP & HOW-TO QUESTIONS (CRITICAL):
If the HR user asks a "how do I..." / "how does this work" / "I'm stuck" / "help" style question about USING THE TOOL (not about offer content), answer clearly and directly using the facts below. Do NOT call update_offer_draft for these — just explain in plain text.

- **How to fill details**: There are two ways — (1) "Chat with me": just type answers here and I'll fill the offer as we talk, or (2) "Fill a form": click the Form button (top-right of this chat, or the button shown after picking employee type) to get a structured form on the left with a live preview on the right.
- **How to upload a custom/ready-made letter**: Click the paperclip icon 📎 next to the message box (or the "Upload my own format" button when offered). Choose a PDF or DOCX file that already has all details filled in — it gets converted and shown exactly as uploaded, ready to send with no further editing needed. Max file size is 5MB.
- **How to switch between employee types (Regular/Intern/Consultant)**: This is decided per-candidate at the very start of the conversation. If you picked the wrong one, just tell me — e.g. "actually this should be a Consultant offer" — and I'll switch and re-ask the relevant questions.
- **How to add a signature**: Upload an image file (PNG/JPG) of the signature the same way as a template — via the paperclip icon 📎. It appears as a movable, resizable box on the live preview (right side). Drag it into place, resize using the small handles on its edges/corner, then click the green **Save** button on the signature toolbar to lock its position. Click **Edit** afterward if you need to reposition it, or click the small red × to remove it entirely.
- **How to download or send the offer**: Once the required fields are filled (or a custom letter is uploaded), the **Download PDF** and **Send Offer** buttons become active in the top-right of the live preview panel. Send Offer opens an editable email preview first — you can tweak the subject/message before it actually goes out.
- **How to copy details from another candidate**: If other candidates in this same job already have offers, a "Copy from another candidate" option appears — click it, then pick whose details to copy in as a starting point (you can still edit anything afterward).
- **How to change salary calculation rules (Basic %, HRA %, PF %, etc.)**: These are configured in the Salary Panel, reachable from the "Fill Salary Details" option when generating an offer — HR can adjust the percentages/fixed amounts used in every Basic/HRA/PF calculation.

If the question doesn't match any of the above, answer as helpfully as you can based on general knowledge of the flow, and invite them to rephrase if you're not sure what they're asking.

YOUR ROLE:
- **GREETING THE USER:** If the user says hi or starts the conversation, introduce yourself naturally. Explicitly mention that you have pre-filled {cand_ctx.get('name', 'the candidate')}'s basic information (email and phone). Ask what type of offer this is: Regular, Intern, or Consultant. Also mention that if they already have a ready-made offer letter (e.g. a signed PDF or Word doc), they can upload it directly instead of filling anything in, and it'll be sent to the candidate exactly as-is.
- **HANDLING FILLING CHOICE:** If the user says they want to "chat to fill the information", acknowledge it and, if employeeType isn't known yet, ask what type of offer this is first; otherwise ask for the fields relevant to that type (see COMPENSATION & ANNEXURE MATH RULES above) to get started.
- **UPLOAD MENTION (CRITICAL):** After the user tells you the employee type (whether by typing it or clicking a button), briefly remind them in your very next reply that they can also just attach/upload a ready-made offer letter (using the paperclip icon) instead of filling in details, if they'd prefer that route.
- **FORMAT SWITCHING:** If the user asks to upload their own format/template, warmly acknowledge their request and tell them to click the option provided below. NEVER say you lack a user interface or cannot display clickable options. The system automatically renders the buttons for you.
- **FORM REVIEW:** If the user asks you to check the form they just filled out, evaluate the CURRENT OFFER DRAFT against the fields relevant to its employeeType. For "regular": Designation, Base CTC, Joining Date, Location, Reporting Manager. For "intern": Designation, Intern Stipend, Joining Date, Intern End Date, Location. For "consultant": Designation, Consulting Fee, Joining Date, Contract Duration, Location. Explicitly tell them what is missing and ask them to provide it here in the chat.
- **SHOW YOUR MATH (CRITICAL):** Whenever you calculate figures based on newly provided pay info, explicitly list the calculated breakdown (Basic/HRA/PF for regular; Fee/TDS/Net for consultant) directly in your chat response text so the user can verify the math before proceeding.
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
EMPLOYEE TYPE: {draft.get('employeeType', 'regular')}
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
 
EMPLOYEE-TYPE-SPECIFIC WRITING RULES (CRITICAL — follow exactly for EMPLOYEE TYPE above):
- **regular**: Standard employment letter. Table shows Basic/HRA/PF/etc. from OFFER DETAILS['breakup']. Mention probation period from OFFER DETAILS['probation']. Never mention TDS or "contract".
- **intern**: This is a fixed-duration internship, NOT regular employment. Do NOT mention PF, probation, or "employee" — say "intern"/"internship" instead. Table shows a single row: Monthly Stipend = OFFER DETAILS['internStipend']. State the internship runs until OFFER DETAILS['internEndDate']. Explicitly note no PF or other statutory employment benefits apply.
- **consultant**: This is a contract-based professional engagement, NOT employment. Do NOT mention PF, probation, or "employee" — say "consultant"/"engagement"/"contract" instead. Table shows: Consulting Fee (monthly = OFFER DETAILS['consultingFeeMonthly'], annual = monthly×12), TDS Deducted (OFFER DETAILS['taxPercent']]% of fee), Net Payable (fee minus TDS). State the contract duration is OFFER DETAILS['contractDuration']. Explicitly note this does not constitute an employer-employee relationship and no PF or other statutory employment benefits apply.

AFTER writing the offer body HTML, wrap it in this outer email template and call send_email_tool:
{offer_email_template}

Replace OFFER_BODY_PLACEHOLDER with the offer HTML you wrote.

TOOL CALL ORDER:
1. save_offer_to_db — pass all offer fields + the full wrapped HTML as offer_html + the full breakup dictionary (from OFFER DETAILS above, under the "breakup" key, empty {{}} if not a regular offer) + salary_rules_json (a JSON string of the SALARY RULES USED shown above) + employee_type (from OFFER DETAILS['employeeType'], default "regular") + intern_end_date/intern_stipend (from OFFER DETAILS, if employeeType is "intern") + consulting_fee_monthly/tax_percent/contract_duration (from OFFER DETAILS, if employeeType is "consultant")
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
        You are an expert HR Document Engineer. I have provided a ready-made, already-filled-in Offer Letter document.
        Your task is to convert this document into a pixel-faithful HTML copy — a READ-ONLY reproduction to be sent
        to the candidate exactly as-is. Do NOT create any placeholders or blanks. This is NOT a template to be filled
        in later; it is a finished document HR has already completed and just wants converted to HTML for sending.

        STRICT HTML/CSS RULES:
        1. RECREATE TABLES PERFECTLY: Use properly structured HTML `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, and `<td>` tags. Add inline CSS (`border-collapse: collapse; width: 100%; text-align: left;`) and add `border: 1px solid #E5E7EB; padding: 8px;` to all cells to make the table professional.
        2. PRESERVE ALIGNMENT & LAYOUT: Use inline CSS for text alignment (e.g., `<div style="text-align: right;">` for dates, `<div style="text-align: center; font-weight: bold;">` for titles).
        3. SPACING & TYPOGRAPHY: Use `<p style="margin-bottom: 16px;">` for paragraphs. Wrap the entire output in a `<div style="font-family: Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #111827;">`.
        4. LOGOS & IMAGES: If there is a company logo, DO NOT use an `<img>` tag (it will break the parser). Instead, use a styled div block: `<div style="padding: 16px 24px; background: #F3F4F6; border: 1px dashed #D1D5DB; text-align: center; color: #9CA3AF; font-weight: bold; width: fit-content; border-radius: 4px; margin-bottom: 24px;">[Company Logo]</div>`.
        5. CLEAN UP ARTIFACTS: Completely remove any page numbers, author watermarks, or repetitive footer texts (e.g., "Page 1 of 3").
        6. KEEP ALL ACTUAL CONTENT AS-IS: Reproduce every name, number, date, and value exactly as it appears in the source document. Do NOT blank anything out, do NOT invent placeholders, and do NOT use curly braces {{ }} anywhere in the output.
        7. NO TRUNCATION (CRITICAL): You MUST process and convert the ENTIRE document from the first page to the very last page. Do not summarize, do not cut corners, and do not stop after the first page or section. If the document contains multiple pages, long terms and conditions, or multiple signature blocks, you must include ALL of them in your final HTML output.

        Ensure you output valid JSON matching this schema exactly:
        {
          "html": "<div style='...'>...</div>"
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

    employee_type_known = bool(current_draft.get('employeeType')) or bool(offer_update.get('employeeType'))

    # On the very first message, ask which employee type this offer is for.
    if len(history) == 0 and not employee_type_known:
        options = ["Regular / Experienced", "Intern", "Consultant"]
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
        f"salary_breakup, salary_rules, employee_type, intern_end_date, intern_stipend, "
        f"consulting_fee_monthly, tax_percent, contract_duration "
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
                "designation":          r.designation       or "",
                "baseCTC":              r.base_ctc          or "",
                "variablePay":          r.variable_pay      or "",
                "joiningDate":          str(r.joining_date) if r.joining_date else "",
                "location":             r.work_location     or "",
                "probation":            r.probation         or "",
                "reportingManager":     r.reporting_manager or "",
                "breakup": json.loads(r.salary_breakup) if getattr(r, 'salary_breakup', None) else {},
                "employeeType":         getattr(r, 'employee_type', None) or "regular",
                "internEndDate":        getattr(r, 'intern_end_date', None) or "",
                "internStipend":        getattr(r, 'intern_stipend', None) or "",
                "consultingFeeMonthly": getattr(r, 'consulting_fee_monthly', None) or "",
                "taxPercent":           getattr(r, 'tax_percent', None) or "10",
                "contractDuration":     getattr(r, 'contract_duration', None) or "",
            },
        }
        for r in rows
    ]

    return (
        json.dumps({"offers": offers}),
        200,
        {**headers, "Content-Type": "application/json"}
    )