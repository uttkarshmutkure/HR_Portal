"""
generate_interview_questions — FastAPI route, mirrors the old
`hr-dev-interview-question-generation` Cloud Function (generate_questions).
Fetches job + candidate + prior-round context from BQ, calls Gemini in
parallel (theory + coding) for round1/technical, or a single call for HR,
then persists the result via MERGE.
"""

import json
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from google.cloud import bigquery
from google.genai import types

import config
from bigquery_client import bq_client
from genai_client import genai_client_global
from routers.generate_interview_questions.schemas import (
    TheoryOnlySet, CodingOnlySet,
)
from routers.generate_interview_questions.prompts import (
    ROUND1_INSTRUCTIONS, TECHNICAL_INSTRUCTIONS, HR_INSTRUCTIONS,
)

router = APIRouter()

PROJECT_ID = config.GCP_PROJECT_ID
DATASET_ID = config.BQ_DATASET_ID


def _call_gemini(system_instr, schema, base_context, extra_prompt=""):
    chat = genai_client_global.chats.create(
        model="gemini-3.5-flash",
        config=types.GenerateContentConfig(
            system_instruction=system_instr,
            temperature=0.4,
            response_mime_type="application/json",
            response_schema=schema,
        )
    )
    return json.loads(chat.send_message(base_context + extra_prompt).text)


@router.post("/api/generate-interview-questions")
async def generate_questions(request: Request):
    try:
        req_json     = await request.json()
        job_id       = req_json.get('jobId')
        candidate_id = req_json.get('candidateId')
        round_name   = req_json.get('round', 'round1')

        # ─── FETCH CONTEXT FROM BIGQUERY ───────────────────────────────────

        job_rows = list(bq_client.query(
            f"SELECT title, description, must_have_skills FROM `{PROJECT_ID}.{DATASET_ID}.jobs` "
            f"WHERE job_id = '{job_id}' LIMIT 1"
        ))
        if not job_rows:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        job_details = dict(job_rows[0])

        cand_rows = list(bq_client.query(
            f"SELECT name, skills, raw_resume_text FROM `{PROJECT_ID}.{DATASET_ID}.candidates` "
            f"WHERE job_id = '{job_id}' AND candidate_id = '{candidate_id}' LIMIT 1"
        ))
        if not cand_rows:
            return JSONResponse({"error": "Candidate not found"}, status_code=404)
        candidate = dict(cand_rows[0])

        history_context_text = "No previous round data available."

        if round_name in ['technical', 'hr']:
            history_query = f"""
                SELECT f.round, f.notes, q.questions
                FROM `{PROJECT_ID}.{DATASET_ID}.interview_feedback` f
                LEFT JOIN `{PROJECT_ID}.{DATASET_ID}.interview_round_questions` q
                  ON f.candidate_id = q.candidate_id
                  AND f.job_id = q.job_id
                  AND f.round = q.round
                WHERE f.job_id = @job_id AND f.candidate_id = @cand_id
            """
            job_config = bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("job_id",  "STRING", job_id),
                bigquery.ScalarQueryParameter("cand_id", "STRING", candidate_id)
            ])
            history_rows = [dict(r) for r in bq_client.query(history_query, job_config=job_config)]
            if history_rows:
                history_context_text = json.dumps(history_rows, indent=2)

        is_hr = round_name == 'hr'

        base_context = f"""
        JOB DETAILS:
        Title: {job_details.get('title')}
        Must Have Skills: {job_details.get('must_have_skills')}
        Description: {job_details.get('description')}

        CANDIDATE PROFILE:
        Name: {candidate.get('candidate_name')}
        Skills: {candidate.get('extracted_skills')}
        Resume Extract: {str(candidate.get('resume_text', ''))[:1500]}...

        HISTORICAL INTERVIEWER NOTES & PREVIOUS QUESTIONS:
        {history_context_text}
        """

        # ─── CALL GEMINI ────────────────────────────────────────────────────
        if is_hr:
            result           = _call_gemini(HR_INSTRUCTIONS, TheoryOnlySet, base_context)
            theory_questions = result.get("theory_questions", [])
            coding_questions = []

        else:
            THEORY_INSTR = (
                TECHNICAL_INSTRUCTIONS if round_name == 'technical' else ROUND1_INSTRUCTIONS
            ) + "\n\nGenerate ONLY the theory_questions section. Do NOT generate coding questions."

            CODING_INSTR = (
                TECHNICAL_INSTRUCTIONS if round_name == 'technical' else ROUND1_INSTRUCTIONS
            ) + "\n\nGenerate ONLY the coding_questions section. Do NOT generate theory questions."

            with ThreadPoolExecutor(max_workers=2) as ex:
                f_theory = ex.submit(_call_gemini, THEORY_INSTR, TheoryOnlySet, base_context)
                f_coding = ex.submit(_call_gemini, CODING_INSTR, CodingOnlySet, base_context)
                theory_result = f_theory.result()
                coding_result = f_coding.result()

            theory_questions = theory_result.get("theory_questions", [])
            coding_questions = coding_result.get("coding_questions", [])

        # ─── PERSIST TO BQ ─────────────────────────────────────────────────

        questions_payload = json.dumps({
            "theory_questions": theory_questions,
            "coding_questions":  coding_questions,
        })

        write_query = f"""
            MERGE `{PROJECT_ID}.{DATASET_ID}.interview_round_questions` T
            USING (SELECT @cand_id AS candidate_id, @job_id AS job_id, @round AS round) S
            ON T.candidate_id = S.candidate_id AND T.job_id = S.job_id AND T.round = S.round
            WHEN MATCHED THEN
              UPDATE SET
                questions   = @questions_json,
                updated_at  = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN
              INSERT (candidate_id, job_id, round, questions)
              VALUES (@cand_id, @job_id, @round, @questions_json)
        """

        bq_client.query(write_query, job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("questions_json", "STRING", questions_payload),
            bigquery.ScalarQueryParameter("cand_id",        "STRING", candidate_id),
            bigquery.ScalarQueryParameter("job_id",         "STRING", job_id),
            bigquery.ScalarQueryParameter("round",          "STRING", round_name),
        ])).result()

        return JSONResponse({
            "success":          True,
            "theory_questions": theory_questions,
            "coding_questions":  coding_questions,
        })

    except Exception as e:
        print(f"Error executing Question Generator pipeline: {str(e)}")
        return JSONResponse({"error": str(e)}, status_code=500)