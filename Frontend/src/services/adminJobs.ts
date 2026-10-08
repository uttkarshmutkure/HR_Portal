// ── Admin: Job Management ─────────────────────────────────────────────────
// Talks to hr-dev-manage-jobs via the API Gateway. Every call is superuser-gated
// server-side using requester_email — the frontend's activeRole is never trusted.

const MANAGE_JOBS_URL = import.meta.env.VITE_MANAGE_JOBS_URL;

export interface AdminJob {
  job_id: string;
  title: string;
  description: string;
  must_have_skills: string[];
  preferred_skills: string[];
  experience_min: number;
  experience_max: number;
  location: string;
  recruiter_email: string;
  status: string;
  created_at: string | null;
  pipeline_status: string | null;
  pipeline_error: string | null;
  pipeline_ran_at: string | null;
}

export interface JobFormInput {
  title: string;
  description: string;
  must_have_skills: string[];
  preferred_skills: string[];
  experience_min: number;
  experience_max: number;
  location: string;
  recruiter_email?: string;
}

async function callManageJobs(payload: Record<string, any>): Promise<any> {
  const res = await fetch(MANAGE_JOBS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const listAdminJobs = async (
  requesterEmail: string,
  includeArchived: boolean = true
): Promise<AdminJob[]> => {
  const data = await callManageJobs({
    type: 'LIST_JOBS',
    requester_email: requesterEmail,
    include_archived: includeArchived,
  });
  return data.jobs as AdminJob[];
};

export const createJob = async (
  requesterEmail: string,
  fields: JobFormInput
): Promise<{ job_id: string }> => {
  const data = await callManageJobs({
    type: 'CREATE_JOB',
    requester_email: requesterEmail,
    ...fields,
  });
  return { job_id: data.job_id };
};

export const updateJob = async (
  requesterEmail: string,
  jobId: string,
  fields: Partial<JobFormInput>
): Promise<void> => {
  await callManageJobs({
    type: 'UPDATE_JOB',
    requester_email: requesterEmail,
    job_id: jobId,
    ...fields,
  });
};

export const archiveJob = async (requesterEmail: string, jobId: string): Promise<void> => {
  await callManageJobs({ type: 'ARCHIVE_JOB', requester_email: requesterEmail, job_id: jobId });
};

export const restoreJob = async (requesterEmail: string, jobId: string): Promise<void> => {
  await callManageJobs({ type: 'RESTORE_JOB', requester_email: requesterEmail, job_id: jobId });
};