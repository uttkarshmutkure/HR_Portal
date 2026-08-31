from fastapi import FastAPI

from routers.chat_agent import router as chat_agent_router
from routers.check_login import router as check_login_router
from routers.resume_uploader import router as resume_uploader_router
from routers.update_candidate_status import router as update_candidate_status_router
from routers.save_interviewer import router as save_interviewer_router
from routers.resume_downloader import router as resume_downloader_router
from routers.get_candidate_slots import router as get_candidate_slots_router
from routers.job_listing import router as job_listing_router
from routers.generate_interview_questions import router as generate_interview_questions_router
from routers.data_manager import router as data_manager_router
from routers.send_email import router as send_email_router
from routers.offer_agent import router as offer_agent_router
from routers.save_candidate_slots import router as save_candidate_slots_router
from routers.automatchmaker import router as automatchmaker_router
from routers.agentic_flow import router as agentic_flow_router
from routers.refer_candidate import router as refer_candidate_router

app = FastAPI(title="Atgeir HireDesk Backend")

app.include_router(chat_agent_router)
app.include_router(check_login_router)
app.include_router(resume_uploader_router)
app.include_router(update_candidate_status_router)
app.include_router(save_interviewer_router)
app.include_router(resume_downloader_router)
app.include_router(get_candidate_slots_router)
app.include_router(job_listing_router)
app.include_router(generate_interview_questions_router)
app.include_router(data_manager_router)
app.include_router(send_email_router)
app.include_router(offer_agent_router)
app.include_router(save_candidate_slots_router)
app.include_router(automatchmaker_router)
app.include_router(agentic_flow_router)
app.include_router(refer_candidate_router)

@app.get("/healthz")
def healthz():
    return {"status": "ok"}