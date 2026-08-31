import json

from fastapi import APIRouter, Request, Response
from google.cloud import bigquery

import config
from bigquery_client import bq_client

router = APIRouter()

project_id = config.GCP_PROJECT_ID
dataset_id = config.BQ_DATASET_ID

def _resp(body_json_str: str, status: int = 200) -> Response:
    return Response(content=body_json_str, media_type="application/json", status_code=status)

@router.post("/api/data-manager")
async def handle_candidate_data(request: Request):
    try:
        data = await request.json()
        if not data:
            return _resp(json.dumps({'error': 'No JSON body'}), 400)

        action = data.get('type')

        # ── MARK_INVITED ───────────────────────────────────────────────────────
        if action == 'MARK_INVITED':
            job_id         = data.get('jobId')
            candidate_id   = data.get('candidateId')
            candidate_name = data.get('candidateName', '')
            candidate_email= data.get('candidateEmail', '')
            round_name     = data.get('round', 'round1')

            if not all([job_id, candidate_id, round_name]):
                return _resp(json.dumps({'error': 'Missing required fields'}), 400)

            merge_query = f"""
                MERGE `{project_id}.{dataset_id}.candidate_slot_selections` T
                USING (
                    SELECT
                        @job_id         AS job_id,
                        @candidate_id   AS candidate_id,
                        @round          AS round,
                        @candidate_name AS candidate_name,
                        @candidate_email AS candidate_email
                ) S
                ON T.job_id = S.job_id
                    AND T.candidate_id = S.candidate_id
                    AND T.round = S.round
                WHEN MATCHED AND T.status NOT IN ('scheduled', 'advanced', 'rejected') THEN
                    UPDATE SET status = 'invited'
                WHEN NOT MATCHED THEN INSERT (
                    slot_id, job_id, candidate_id, candidate_name, candidate_email,
                    round, status, confirmed_at
                ) VALUES (
                    CONCAT(S.candidate_id, '_', S.round), S.job_id, S.candidate_id, S.candidate_name, S.candidate_email,
                    S.round, 'invited', CURRENT_TIMESTAMP()
                )
            """
            params = [
                bigquery.ScalarQueryParameter('job_id',          'STRING', job_id),
                bigquery.ScalarQueryParameter('candidate_id',    'STRING', candidate_id),
                bigquery.ScalarQueryParameter('round',           'STRING', round_name),
                bigquery.ScalarQueryParameter('candidate_name',  'STRING', candidate_name),
                bigquery.ScalarQueryParameter('candidate_email', 'STRING', candidate_email),
            ]
            bq_client.query(merge_query, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
            
            # ── Move candidate out of the Shortlisted phase ──
            update_cand_query = f"""
                UPDATE `{project_id}.{dataset_id}.candidates`
                SET candidate_result = 'Interview'
                WHERE job_id = @job_id AND candidate_id = @candidate_id
            """
            bq_client.query(update_cand_query, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
            
            return _resp(json.dumps({'success': True}), 200)

        # ── SAVE_FEEDBACK ──────────────────────────────────────────────────────
        elif action == 'SAVE_FEEDBACK':
            job_id        = data.get('jobId')
            candidate_id  = data.get('candidateId')
            round_name    = data.get('round')
            rating        = data.get('rating')
            tech_skill    = data.get('techSkill', '')
            communication = data.get('communication', '')
            notes         = data.get('notes', '')
            verdict       = data.get('verdict')

            if not all([job_id, candidate_id, round_name, rating, verdict]):
                return _resp(json.dumps({'error': 'Missing required fields'}), 400)

            feedback_query = f"""
                MERGE `{project_id}.{dataset_id}.interview_feedback` T
                USING (
                    SELECT
                        @job_id        AS job_id,
                        @candidate_id  AS candidate_id,
                        @round         AS round,
                        @rating        AS rating,
                        @tech_skill    AS tech_skill,
                        @communication AS communication,
                        @notes         AS notes,
                        @verdict       AS verdict,
                        'Internal Panel'     AS interviewer_name,
                        CURRENT_TIMESTAMP()  AS submitted_at
                ) S
                ON T.job_id = S.job_id
                    AND T.candidate_id = S.candidate_id
                    AND T.round = S.round
                WHEN MATCHED THEN UPDATE SET
                    rating        = S.rating,
                    tech_skill    = S.tech_skill,
                    communication = S.communication,
                    notes         = S.notes,
                    verdict       = S.verdict,
                    submitted_at  = S.submitted_at
                WHEN NOT MATCHED THEN INSERT (
                    job_id, candidate_id, round, rating,
                    tech_skill, communication, notes,
                    verdict, interviewer_name, submitted_at
                ) VALUES (
                    S.job_id, S.candidate_id, S.round, S.rating,
                    S.tech_skill, S.communication, S.notes,
                    S.verdict, S.interviewer_name, S.submitted_at
                )
            """
            feedback_params = [
                bigquery.ScalarQueryParameter('job_id',        'STRING', job_id),
                bigquery.ScalarQueryParameter('candidate_id',  'STRING', candidate_id),
                bigquery.ScalarQueryParameter('round',         'STRING', round_name),
                bigquery.ScalarQueryParameter('rating',        'INT64',  int(rating)),
                bigquery.ScalarQueryParameter('tech_skill',    'STRING', tech_skill),
                bigquery.ScalarQueryParameter('communication', 'STRING', communication),
                bigquery.ScalarQueryParameter('notes',         'STRING', notes),
                bigquery.ScalarQueryParameter('verdict',       'STRING', verdict),
            ]
            bq_client.query(feedback_query, job_config=bigquery.QueryJobConfig(query_parameters=feedback_params)).result()

            if verdict == 'advance':
                status_value = 'advanced'
            elif verdict == 'hold':
                status_value = 'on_hold'
            else:
                status_value = 'rejected'

            status_query = f"""
                MERGE `{project_id}.{dataset_id}.candidate_slot_selections` T
                USING (
                    SELECT
                        @job_id       AS job_id,
                        @candidate_id AS candidate_id,
                        @round        AS round,
                        @status       AS status,
                        CURRENT_TIMESTAMP() AS confirmed_at
                ) S
                ON T.job_id = S.job_id
                    AND T.candidate_id = S.candidate_id
                    AND T.round = S.round
                WHEN MATCHED THEN UPDATE SET
                    status       = S.status,
                    confirmed_at = S.confirmed_at
                WHEN NOT MATCHED THEN INSERT (
                    job_id, candidate_id, round, status, confirmed_at
                ) VALUES (
                    S.job_id, S.candidate_id, S.round, S.status, S.confirmed_at
                )
            """
            status_params = [
                bigquery.ScalarQueryParameter('job_id',        'STRING', job_id),
                bigquery.ScalarQueryParameter('candidate_id',  'STRING', candidate_id),
                bigquery.ScalarQueryParameter('round',         'STRING', round_name),
                bigquery.ScalarQueryParameter('status',        'STRING', status_value),
            ]
            bq_client.query(status_query, job_config=bigquery.QueryJobConfig(query_parameters=status_params)).result()
            return _resp(json.dumps({'success': True}), 200)

        # ── GET_FULL_PROFILE ───────────────────────────────────────────────────
        elif action == 'GET_FULL_PROFILE':
            job_id       = data.get('jobId')
            candidate_id = data.get('candidateId')

            if not all([job_id, candidate_id]):
                return _resp(json.dumps({'error': 'Missing jobId or candidateId'}), 400)

            profile_params = [
                bigquery.ScalarQueryParameter('job_id',       'STRING', job_id),
                bigquery.ScalarQueryParameter('candidate_id', 'STRING', candidate_id),
            ]

            timeline_query = f"""
                SELECT round, status, confirmed_at, interviewer_email
                FROM (
                    SELECT round, status, confirmed_at, interviewer_email,
                           ROW_NUMBER() OVER (PARTITION BY round ORDER BY confirmed_at DESC) AS rn
                    FROM `{project_id}.{dataset_id}.candidate_slot_selections`
                    WHERE job_id = @job_id AND candidate_id = @candidate_id
                )
                WHERE rn = 1
                ORDER BY confirmed_at ASC
            """
            timeline_rows = bq_client.query(timeline_query, job_config=bigquery.QueryJobConfig(query_parameters=profile_params)).result()
            timeline = [
                {
                    'round':              row.round,
                    'status':             row.status,
                    'confirmed_at':       row.confirmed_at.isoformat() if row.confirmed_at else None,
                    'interviewer_email':  row.interviewer_email,
                }
                for row in timeline_rows
            ]

            feedback_query = f"""
                SELECT round, rating, tech_skill, communication,
                       notes, verdict, interviewer_name, submitted_at
                FROM `{project_id}.{dataset_id}.interview_feedback`
                WHERE job_id = @job_id AND candidate_id = @candidate_id
                ORDER BY submitted_at ASC
            """
            feedback_rows = bq_client.query(feedback_query, job_config=bigquery.QueryJobConfig(query_parameters=profile_params)).result()
            feedback = [
                {
                    'round':            row.round,
                    'rating':           row.rating,
                    'tech_skill':       row.tech_skill,
                    'communication':    row.communication,
                    'notes':            row.notes,
                    'verdict':          row.verdict,
                    'interviewer_name': row.interviewer_name,
                    'submitted_at':     row.submitted_at.isoformat() if row.submitted_at else None,
                }
                for row in feedback_rows
            ]
            return _resp(json.dumps({'timeline': timeline, 'feedback': feedback}), 200)

        # ── CHECK_FEEDBACK ─────────────────────────────────────────────────────
        elif action == 'CHECK_FEEDBACK':
            job_id       = data.get('jobId')
            candidate_id = data.get('candidateId')
            round_name   = data.get('round')

            if not all([job_id, candidate_id, round_name]):
                return _resp(json.dumps({'error': 'Missing required fields'}), 400)

            check_query = f"""
                SELECT verdict
                FROM `{project_id}.{dataset_id}.interview_feedback`
                WHERE job_id = @job_id AND candidate_id = @candidate_id AND round = @round
                LIMIT 1
            """
            check_params = [
                bigquery.ScalarQueryParameter('job_id',       'STRING', job_id),
                bigquery.ScalarQueryParameter('candidate_id', 'STRING', candidate_id),
                bigquery.ScalarQueryParameter('round',        'STRING', round_name),
            ]
            rows = list(bq_client.query(check_query, job_config=bigquery.QueryJobConfig(query_parameters=check_params)).result())

            # Fetch candidate email/name — technical/hr rows may have blank email
            # (frontend didn't pass candidateEmail when saving those slots),
            # so look across all rounds and take the latest non-empty one.
            contact_query = f"""
                SELECT candidate_email, candidate_name
                FROM `{project_id}.{dataset_id}.candidate_slot_selections`
                WHERE job_id = @job_id AND candidate_id = @candidate_id
                  AND candidate_email IS NOT NULL AND candidate_email != ''
                ORDER BY confirmed_at DESC
                LIMIT 1
            """
            contact_params = [
                bigquery.ScalarQueryParameter('job_id',       'STRING', job_id),
                bigquery.ScalarQueryParameter('candidate_id', 'STRING', candidate_id),
            ]
            contact_rows = list(bq_client.query(contact_query, job_config=bigquery.QueryJobConfig(query_parameters=contact_params)).result())
            candidate_email = contact_rows[0].candidate_email if contact_rows else ''
            candidate_name  = contact_rows[0].candidate_name  if contact_rows else ''

            return _resp(json.dumps({
                'alreadySubmitted': len(rows) > 0,
                'candidateEmail':   candidate_email,
                'candidateName':    candidate_name,
            }), 200)

        # ── CHECK_PIPELINE_STATUS ──────────────────────────────────────────────
        elif action in ('CHECK_PIPELINE_STATUS', 'GET_JOB_STATUS'):
            job_id = data.get('jobId')
            if not job_id:
                return _resp(json.dumps({'error': 'Missing jobId'}), 400)

            status_query = f"""
                SELECT pipeline_status
                FROM `{project_id}.{dataset_id}.jobs`
                WHERE job_id = @job_id
                LIMIT 1
            """
            status_params = [bigquery.ScalarQueryParameter('job_id', 'STRING', job_id)]
            rows = list(bq_client.query(status_query, job_config=bigquery.QueryJobConfig(query_parameters=status_params)).result())
            current_status = rows[0].pipeline_status if rows and rows[0].pipeline_status else 'IDLE'
            return _resp(json.dumps({'status': current_status}), 200)

        # ── GET_INTERVIEWERS ───────────────────────────────────────────────────
        elif action == 'GET_INTERVIEWERS':
            job_id     = data.get('jobId')
            round_name = data.get('round')

            if not job_id:
                return _resp(json.dumps({'error': 'Missing jobId'}), 400)

            where_round = "AND `round` = @round" if round_name else ""
            params = [bigquery.ScalarQueryParameter('job_id', 'STRING', job_id)]
            if round_name:
                params.append(bigquery.ScalarQueryParameter('round', 'STRING', round_name))

            query = f"""
                SELECT
                    Interviewer_id,
                    Interviewer_name,
                    Interviewer_email,
                    `round`,
                    role,
                    day,
                    start_time,
                    end_time,
                    work_mode,
                    status
                FROM `{project_id}.{dataset_id}.interviewer_slots`
                WHERE job_id = @job_id
                {where_round}
                ORDER BY `round`, Interviewer_name
            """
            rows = list(bq_client.query(
                query,
                job_config=bigquery.QueryJobConfig(query_parameters=params)
            ).result())

            # Group flat per-slot rows back into one entry per interviewer
            interviewers_map = {}
            for row in rows:
                key = (row.Interviewer_id, row.round)
                if key not in interviewers_map:
                    interviewers_map[key] = {
                        'id':          row.Interviewer_id,
                        'name':        row.Interviewer_name,
                        'email':       row.Interviewer_email,
                        'role':        row.role,          
                        'round':       row.round,
                        'work_mode':   row.work_mode,
                        'slotDetails': [],
                    }
                interviewers_map[key]['slotDetails'].append({
                    'day':        row.day,
                    'start_time': row.start_time,
                    'end_time':   row.end_time,
                    'status':     row.status,
                    'work_mode':  row.work_mode,
                })

            interviewers = list(interviewers_map.values())
            return _resp(json.dumps({'success': True, 'interviewers': interviewers}), 200)
        

        # ── GET_CANDIDATES ─────────────────────────────────────────────────────
        # Called by JobResultsPage to load all screening results from BQ.
        # Replaces ResultsStore (localStorage).
        # Returns candidates grouped by result type to match PipelineResult shape.
        elif action == 'GET_CANDIDATES':
            job_id = data.get('jobId')
            if not job_id:
                return _resp(json.dumps({'error': 'Missing jobId'}), 400)

            query = f"""
                SELECT
                    candidate_id,
                    name,
                    email,
                    phone,
                    candidate_result,
                    screening_status,
                    ai_screening_results,
                    reject_reason
                FROM `{project_id}.{dataset_id}.candidates`
                WHERE job_id = @job_id
                  AND screening_status = 'COMPLETED'
            """
            params = [bigquery.ScalarQueryParameter('job_id', 'STRING', job_id)]
            rows = list(bq_client.query(
                query,
                job_config=bigquery.QueryJobConfig(query_parameters=params)
            ).result())

            all_candidates = []
            for row in rows:
                ai_data = {}
                if row.ai_screening_results:
                    if isinstance(row.ai_screening_results, str):
                        try: ai_data = json.loads(row.ai_screening_results)
                        except: pass
                    else:
                        ai_data = row.ai_screening_results

                all_candidates.append({
                    'candidate_id':        row.candidate_id,
                    'name':                row.name,
                    'email':               row.email,
                    'phone':               row.phone or '',
                    'candidate_result':    row.candidate_result,
                    'reject_reason':       row.reject_reason or '',
                    
                    'final_score':         float(ai_data.get('final_score', 0)),
                    'similarity_score':    float(ai_data.get('similarity_score', 0)),
                    'overall_result':      ai_data.get('overall_result', ''),
                    
                    'overall_reason':      ai_data.get('overall_reason', ''),
                    'human_review_reason': ai_data.get('human_review_reason', ''),
                    'failed_rules':        ai_data.get('failed_rules', []),
                    'flagged_rules':       ai_data.get('flagged_rules', []),
                    
                    'relevant_exp':        ai_data.get('relevant_exp', ''),
                    'must_have_pct':       float(ai_data.get('must_have_pct', 0)),
                    'must_have_skills':    ai_data.get('must_have_skills', []),
                    'must_have_missing':   ai_data.get('must_have_missing', []),
                    'good_to_have_pct':    float(ai_data.get('good_to_have_pct', 0)),
                    'good_to_have_missing': ai_data.get('good_to_have_missing', []),
                    'questions':           ai_data.get('questions', [])
                })

            all_candidates.sort(key=lambda x: x['final_score'], reverse=True)

            # Filter out rejected candidates from the main AI tabs
            rejected = [c for c in all_candidates if c['candidate_result'] == 'Rejected']
            referred = [c for c in all_candidates if c['candidate_result'] == 'Referred']
            passed   = [c for c in all_candidates if c['overall_result'] == 'PASS' and c['candidate_result'] not in ('Rejected', 'Referred')]
            review   = [c for c in all_candidates if c['overall_result'] == 'HUMAN_REVIEW' and c['candidate_result'] not in ('Rejected', 'Referred')]
            failed   = [c for c in all_candidates if c['overall_result'] not in ('PASS', 'HUMAN_REVIEW') and c['candidate_result'] not in ('Rejected', 'Referred')]
            top      = passed[:5]

            return _resp(json.dumps({
                'success':          True,
                'top_candidates':   top,
                'all_passed':       passed,
                'all_human_review': review,
                'all_failed':       failed,
                'all_rejected':     rejected,
                'all_referred':     referred,
                'total_candidates': len(all_candidates),
                'passed':           len(passed),
                'human_review':     len(review),
                'failed':           len(failed),
                'rejected':         len(rejected),
                'referred':         len(referred),
            }), 200)

        # ── GET_SHORTLISTED ────────────────────────────────────────────────────
        # Called by ShortlistedPage to load shortlisted candidates from BQ.
        # Replaces ShortlistStore (localStorage).
        elif action == 'GET_SHORTLISTED':
            job_id = data.get('jobId')
            if not job_id:
                return _resp(json.dumps({'error': 'Missing jobId'}), 400)

            query = f"""
                    SELECT
                        candidate_id,
                        name,
                        email,
                        phone,
                        candidate_result,
                        ai_screening_results
                    FROM `{project_id}.{dataset_id}.candidates`
                    WHERE job_id = @job_id
                        AND candidate_result IN ('Shortlisted', 'Referred', 'Interview', 'Selected', 'Hired')
                """
            params = [bigquery.ScalarQueryParameter('job_id', 'STRING', job_id)]
            rows = list(bq_client.query(
                query,
                job_config=bigquery.QueryJobConfig(query_parameters=params)
            ).result())

            candidates = []
            for row in rows:
                ai_data = {}
                if row.ai_screening_results:
                    if isinstance(row.ai_screening_results, str):
                        try:
                            ai_data = json.loads(row.ai_screening_results)
                        except:
                            pass
                    else:
                        ai_data = row.ai_screening_results

                candidates.append({
                    'candidate_id':      row.candidate_id,
                    'name':              row.name,
                    'email':             row.email,
                    'phone':             row.phone or '',
                    'candidate_result':  row.candidate_result,
                    'final_score':       float(ai_data.get('final_score', 0)),
                    'overall_result':    ai_data.get('overall_result', ''),
                    'must_have_pct':     float(ai_data.get('must_have_pct', 0)),
                    'must_have_skills':  ai_data.get('must_have_skills', []),
                    'must_have_missing': ai_data.get('must_have_missing', []),
                    'relevant_exp':      ai_data.get('relevant_exp', ''),
                    'good_to_have_pct':   float(ai_data.get('good_to_have_pct', 0)),
                    'good_to_have_missing': ai_data.get('good_to_have_missing', []),
                    'failed_rules':       ai_data.get('failed_rules', []),
                    'flagged_rules':      ai_data.get('flagged_rules', []),
                    'questions':          ai_data.get('questions', [])
                })
                
            # Sort by final score descending before returning
            candidates.sort(key=lambda x: x['final_score'], reverse=True)

            return _resp(json.dumps({'success': True, 'candidates': candidates}), 200)

        # ── UPDATE_JOB_STATUS ──────────────────────────────────────────────────
        elif action == 'UPDATE_JOB_STATUS':
            job_id = data.get('jobId')
            new_status = data.get('status')
            
            if not job_id or not new_status:
                return _resp(json.dumps({'error': 'Missing jobId or status'}), 400)
                
            update_query = f"""
                UPDATE `{project_id}.{dataset_id}.jobs`
                SET status = @status
                WHERE job_id = @job_id
            """
            params = [
                bigquery.ScalarQueryParameter('status', 'STRING', new_status),
                bigquery.ScalarQueryParameter('job_id', 'STRING', job_id),
            ]
            
            try:
                bq_client.query(update_query, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
                return _resp(json.dumps({'success': True}), 200)
            except Exception as e:
                return _resp(json.dumps({'error': str(e)}), 500)
        
        elif action == 'REJECT_CANDIDATE':
            job_id       = data.get('jobId')
            candidate_id = data.get('candidateId')
            reason       = data.get('reason', '')

            if not all([job_id, candidate_id]):
                return _resp(json.dumps({'error': 'Missing required fields'}), 400)

            reject_query = f"""
                UPDATE `{project_id}.{dataset_id}.candidates`
                SET candidate_result = 'Rejected',
                    reject_reason = @reason
                WHERE job_id = @job_id AND candidate_id = @candidate_id
            """
            params = [
                bigquery.ScalarQueryParameter('job_id', 'STRING', job_id),
                bigquery.ScalarQueryParameter('candidate_id', 'STRING', candidate_id),
                bigquery.ScalarQueryParameter('reason', 'STRING', reason),
            ]
            bq_client.query(reject_query, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
            
            return _resp(json.dumps({'success': True}), 200)

        # ── SAVE_CANDIDATE_REVIEW ─────────────────────────────────────────────
        elif action == 'SAVE_CANDIDATE_REVIEW':
            job_id     = data.get('jobId')
            cand_id    = data.get('candidateId')
            cand_name  = data.get('candidateName')
            round_name = data.get('round')
            rating     = data.get('rating')
            advice     = data.get('advice', '').strip()

            if not all([job_id, cand_id, rating]):
                return _resp(json.dumps({'error': 'Missing essential review parameters'}), 400)

            insert_query = f"""
                INSERT INTO `{project_id}.{dataset_id}.candidate_reviews`
                (review_id, job_id, candidate_id, candidate_name, round, experience_rating, advice_notes, submitted_at)
                VALUES (GENERATE_UUID(), @job_id, @cand_id, @cand_name, @round_name, @rating, @advice, CURRENT_TIMESTAMP())
            """
            params = [
                bigquery.ScalarQueryParameter('job_id',     'STRING', job_id),
                bigquery.ScalarQueryParameter('cand_id',    'STRING', cand_id),
                bigquery.ScalarQueryParameter('cand_name',  'STRING', cand_name),
                bigquery.ScalarQueryParameter('round_name', 'STRING', round_name),
                bigquery.ScalarQueryParameter('rating',     'INT64',  int(rating)),
                bigquery.ScalarQueryParameter('advice',     'STRING', advice),
            ]
            bq_client.query(insert_query, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
            
            return _resp(json.dumps({'success': True}), 200)
        
        # ── GET_RESUME_KEY_NOTES ───────────────────────────────────────────────
        elif action == 'GET_RESUME_KEY_NOTES':
            job_id       = data.get('jobId')
            candidate_id = data.get('candidateId')

            if not all([job_id, candidate_id]):
                return _resp(json.dumps({'error': 'Missing jobId or candidateId'}), 400)

            # 1. Grab raw text directly from BQ
            q = f"""
                SELECT raw_resume_text
                FROM `{project_id}.{dataset_id}.candidates`
                WHERE job_id = @job_id AND candidate_id = @candidate_id
                LIMIT 1
            """
            q_params = [
                bigquery.ScalarQueryParameter('job_id', 'STRING', job_id),
                bigquery.ScalarQueryParameter('candidate_id', 'STRING', candidate_id)
            ]
            rows = list(bq_client.query(q, job_config=bigquery.QueryJobConfig(query_parameters=q_params)).result())
            raw_text = rows[0].raw_resume_text if rows and rows[0].raw_resume_text else ""

            if not raw_text.strip():
                return _resp(json.dumps({'error': 'No raw resume text stored for this candidate'}), 404)

            # 2. Fast LLM Extraction
            import re
            from google import genai

            gemini = genai.Client(vertexai=True, project=project_id, location="us-central1")
            
            prompt = f"""
            Analyze the following raw resume text and extract executive Key Notes for an HR recruiter.
            Return STRICTLY a JSON object matching this exact structure:
            {{
              "summary": "A punchy 2-sentence professional overview",
              "top_skills": ["Skill 1", "Skill 2", "Skill 3", "Skill 4", "Skill 5"],
              "education": "Highest degree earned & University Name",
              "key_experience": ["Highlight milestone 1", "Major achievement 2", "Key responsibility 3"]
            }}

            Resume Text:
            {raw_text[:4500]}
            """

            resp = gemini.models.generate_content(model="gemini-2.5-flash", contents=prompt)

            # Strip markdown fences safely
            clean = re.sub(r"^```(?:json)?\s*", "", resp.text.strip())
            clean = re.sub(r"\s*```$", "", clean).strip()

            try:
                notes_json = json.loads(clean)
            except Exception:
                notes_json = {"summary": resp.text[:300], "top_skills": [], "education": "N/A", "key_experience": []}

            return _resp(json.dumps({'success': True, 'notes': notes_json}), 200)

        else:
            return _resp(json.dumps({'error': f'Unknown action: {action}'}), 400)
        

    except Exception as e:
        print(f'Error in handle_candidate_data: {e}')
        return _resp(json.dumps({'error': str(e)}), 500)