import os
import json
import functions_framework
from concurrent.futures import ThreadPoolExecutor
from google.cloud import bigquery
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

# Initialize Clients
bq_client = bigquery.Client()
ai_client = genai.Client(
    vertexai=True,
    project=os.environ.get('GOOGLE_CLOUD_PROJECT', 'atgeir-moae-dev'),
    location='asia-south1'
)

project_id = os.environ.get('GOOGLE_CLOUD_PROJECT', 'atgeir-moae-dev')
dataset_id = os.environ.get('BQ_DATASET_ID', 'hr_dataset')

# ─── 1. DEFINE STRUCTURED OUTPUT SCHEMA ───────────────────────────────────────

class TheoryQuestion(BaseModel):
    type: str       = Field(description="Category: e.g., 'Core Concept', 'Scenario-Based', 'Architecture', 'Behavioral'")
    difficulty: str = Field(description="'Easy', 'Medium', or 'Hard'")
    question: str   = Field(description="The exact question to ask the candidate")
    ideal_answer: str = Field(description="Detailed explanation of the correct answer or key points to listen for")

class CodingQuestion(BaseModel):
    difficulty: str     = Field(description="'Easy', 'Medium', or 'Hard'")
    question: str       = Field(description="The coding problem statement with clear input/output requirements")
    solution_code: str  = Field(description="A clean, well-commented solution in the most relevant language for the role")
    explanation: str    = Field(description="Step-by-step explanation of the approach, time complexity, and space complexity")

class TheoryOnlySet(BaseModel):
    theory_questions: list[TheoryQuestion] = Field(description="Exactly 5 theory/behavioral questions")

class CodingOnlySet(BaseModel):
    coding_questions: list[CodingQuestion] = Field(description="Exactly 5 coding/practical questions")

# ─── 2. PROMPTS ────────────────────────────────────────────────────────────────

ROUND1_INSTRUCTIONS = """
You are the Atgeir Solutions Expert Interview Architect. Generate tailored interview questions for Round 1.

ROUND 1 — Generate TWO sections:

THEORY (5 questions):
- Easy to Medium difficulty
- Focus on verifying core technical concepts from the JD and Resume
- Types: Core Concept, Scenario-Based

CODING (5 questions):
- Easy difficulty only
- Basic data structures (arrays, strings, hashmaps, linked lists) and simple algorithms (loops, sorting, searching)
- NO complex dynamic programming, graphs, or tree traversals
- Problems should be solvable in 10-15 minutes
- Each must include: clear problem statement, a simple clean solution with comments, and a brief explanation of approach and O(n) complexity

Format strictly as JSON with keys: theory_questions, coding_questions.
"""

TECHNICAL_INSTRUCTIONS = """
You are the Atgeir Solutions Expert Interview Architect. Generate tailored interview questions for Round 2 (Technical).

Analyze 'Previous Notes' to target weak areas identified in Round 1. DO NOT repeat previous questions.

ROUND 2 — Generate TWO sections:

THEORY (5 questions):
- Medium difficulty
- Focus on system design basics, architecture patterns, and applied problem-solving relevant to the role
- Types: Architecture, Scenario-Based, Core Concept
- Avoid overly academic or PhD-level theory

CODING (5 questions):
- Easy to Medium difficulty only
- Basic algorithms: simple sorting, two-pointer, sliding window, basic recursion
- Basic data structures: arrays, hashmaps, stacks, queues — NO advanced trees, graphs, or DP
- Problems should be solvable in 15-20 minutes
- Each must include: clear problem statement, a clean readable solution with comments, and a brief explanation with time complexity

Format strictly as JSON with keys: theory_questions, coding_questions.
"""

HR_INSTRUCTIONS = """
You are the Atgeir Solutions Expert Interview Architect. Generate tailored HR interview questions.

HR ROUND — Generate ONE section:

THEORY (5 questions):
- Behavioral and cultural fit questions
- Probe soft skills, communication, conflict resolution, leadership, and team collaboration
- Difficulty is contextual based on previous technical notes

Format strictly as JSON with key: theory_questions (no coding_questions for HR).
"""

@functions_framework.http
def generate_questions(request):
    if request.method == 'OPTIONS':
        return ('', 204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type'
        })
    headers = {'Access-Control-Allow-Origin': '*'}

    try:
        req_json     = request.get_json(silent=True)
        job_id       = req_json.get('jobId')
        candidate_id = req_json.get('candidateId')
        round_name   = req_json.get('round', 'round1')

        # ─── 3. FETCH CONTEXT FROM BIGQUERY ───────────────────────────────────

        job_rows = list(bq_client.query(
            f"SELECT title, description, must_have_skills FROM `{project_id}.{dataset_id}.jobs` "
            f"WHERE job_id = '{job_id}' LIMIT 1"
        ))
        if not job_rows:
            return (json.dumps({"error": "Job not found"}), 404, headers)
        job_details = dict(job_rows[0])

        cand_rows = list(bq_client.query(
            f"SELECT name, skills, raw_resume_text FROM `{project_id}.{dataset_id}.candidates` "
            f"WHERE job_id = '{job_id}' AND candidate_id = '{candidate_id}' LIMIT 1"
        ))
        if not cand_rows:
            return (json.dumps({"error": "Candidate not found"}), 404, headers)
        candidate = dict(cand_rows[0])

        history_context_text = "No previous round data available."

        if round_name in ['technical', 'hr']:
            history_query = f"""
                SELECT f.round, f.notes, q.questions
                FROM `{project_id}.{dataset_id}.interview_feedback` f
                LEFT JOIN `{project_id}.{dataset_id}.interview_round_questions` q
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

        # ─── 4. SEPARATE SCHEMAS FOR PARALLEL CALLS ───────────────────────────

        is_hr = round_name == 'hr'

        # ─── 5. BUILD PROMPT ───────────────────────────────────────────────────

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

        # ─── 6. CALL GEMINI ────────────────────────────────────────────────────
        # HR: single theory call.
        # Round1/Technical: two parallel calls (theory + coding) to avoid timeout.

        def call_gemini(system_instr, schema, extra_prompt=""):
            chat = ai_client.chats.create(
                model="gemini-2.5-flash",
                config=types.GenerateContentConfig(
                    system_instruction=system_instr,
                    temperature=0.4,
                    response_mime_type="application/json",
                    response_schema=schema,
                )
            )
            return json.loads(chat.send_message(base_context + extra_prompt).text)

        if is_hr:
            result          = call_gemini(HR_INSTRUCTIONS, TheoryOnlySet)
            theory_questions = result.get("theory_questions", [])
            coding_questions = []

        else:
            # Parallel: theory call + coding call simultaneously
            THEORY_INSTR = (
                TECHNICAL_INSTRUCTIONS if round_name == 'technical' else ROUND1_INSTRUCTIONS
            ) + "\n\nGenerate ONLY the theory_questions section. Do NOT generate coding questions."

            CODING_INSTR = (
                TECHNICAL_INSTRUCTIONS if round_name == 'technical' else ROUND1_INSTRUCTIONS
            ) + "\n\nGenerate ONLY the coding_questions section. Do NOT generate theory questions."

            with ThreadPoolExecutor(max_workers=2) as ex:
                f_theory = ex.submit(call_gemini, THEORY_INSTR, TheoryOnlySet)
                f_coding = ex.submit(call_gemini, CODING_INSTR, CodingOnlySet)
                theory_result = f_theory.result()
                coding_result = f_coding.result()

            theory_questions = theory_result.get("theory_questions", [])
            coding_questions = coding_result.get("coding_questions", [])

        # ─── 8. PERSIST TO BQ ─────────────────────────────────────────────────

        questions_payload = json.dumps({
            "theory_questions": theory_questions,
            "coding_questions":  coding_questions,
        })

        write_query = f"""
            MERGE `{project_id}.{dataset_id}.interview_round_questions` T
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

        return (json.dumps({
            "success":          True,
            "theory_questions": theory_questions,
            "coding_questions":  coding_questions,
        }), 200, headers)

    except Exception as e:
        print(f"Error executing Question Generator pipeline: {str(e)}")
        return (json.dumps({"error": str(e)}), 500, headers)