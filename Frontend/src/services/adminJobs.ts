// ── Admin: Job Management ─────────────────────────────────────────────────
// Talks to hr-dev-manage-jobs. Every call is HR-gated server-side using
// requester_email — the frontend's activeRole is never trusted.

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
  input: { jobId: string; designation?: string; file: File }
): Promise<{ job_id: string }> => {
  const form = new FormData();
  form.append('type', 'CREATE_JOB');
  form.append('requester_email', requesterEmail);
  form.append('job_id', input.jobId.trim());
  if (input.designation?.trim()) form.append('designation', input.designation.trim());
  form.append('file', input.file);

  // No Content-Type header here — the browser sets the multipart boundary itself
  const res = await fetch(MANAGE_JOBS_URL, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
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

export const deleteJob = async (requesterEmail: string, jobId: string): Promise<void> => {
  await callManageJobs({ type: 'DELETE_JOB', requester_email: requesterEmail, job_id: jobId });
};