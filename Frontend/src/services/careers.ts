// ─────────────────────────────────────────────────────────────────────────────
// Public Careers API  (NO login required — used by /careers and /careers/:jobId)
//
// .env variables
//   VITE_PUBLIC_JOBS_URL  GET  → { success, jobs: [...] }   (recommended: a dedicated
//                               public function that returns ONLY active jobs and
//                               ONLY public fields). Falls back to VITE_LIST_JOBS_URL.
//   VITE_APPLY_JOB_URL    POST → multipart/form-data application (see CAREERS_SETUP.md)
//   VITE_CAREERS_MOCK     "true" → use built-in sample jobs and a fake apply call,
//                               so the UI can be tested without any backend.
// ─────────────────────────────────────────────────────────────────────────────

export interface PublicJob {
  job_id: string;
  title: string;
  location: string;
  description: string;
  must_have_skills: string[];
  preferred_skills: string[];
  experience_min: number;
  experience_max: number;
  created_at: string | null;
}

export interface ApplicationInput {
  jobId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  phoneCode: string;
  phone: string;
  gender: string;
  expYears: string;
  expMonths: string;
  salaryCurrency: string;
  salaryAmount: string;
  salaryFreq: string;
  coverNote: string;
  resume: File;
}

export type ApplyErrorCode =
  | 'ALREADY_APPLIED'
  | 'JOB_CLOSED'
  | 'INVALID'
  | 'NETWORK'
  | 'SERVER';

export class ApplyError extends Error {
  code: ApplyErrorCode;
  constructor(code: ApplyErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const LIST_URL = (import.meta.env.VITE_PUBLIC_JOBS_URL ||
  import.meta.env.VITE_LIST_JOBS_URL) as string | undefined;
const APPLY_URL = import.meta.env.VITE_APPLY_JOB_URL as string | undefined;
const MOCK = import.meta.env.VITE_CAREERS_MOCK === 'true';

// ── Normalisation ─────────────────────────────────────────────────────────────

const toList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  return [];
};

const toNum = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// Only public fields are copied. recruiter_email, knockout_rules, pipeline_* etc.
// are intentionally dropped even if the backend sends them.
const normalise = (raw: any): PublicJob => ({
  job_id: String(raw.job_id ?? ''),
  title: String(raw.title ?? 'Untitled role'),
  location: String(raw.location ?? '').trim(),
  description: String(raw.description ?? ''),
  must_have_skills: toList(raw.must_have_skills),
  preferred_skills: toList(raw.preferred_skills),
  experience_min: toNum(raw.experience_min),
  experience_max: toNum(raw.experience_max),
  created_at: raw.created_at ? String(raw.created_at) : null,
});

// A job is shown only if it is open. If the backend sends no status, trust it.
const isOpen = (raw: any): boolean => {
  if (raw.status == null || raw.status === '') return true;
  const s = String(raw.status).toLowerCase();
  return s === 'active' || s === 'open';
};

// ── Jobs ──────────────────────────────────────────────────────────────────────

let cache: { at: number; promise: Promise<PublicJob[]> } | null = null;
const CACHE_MS = 60_000;

export const listPublicJobs = (force = false): Promise<PublicJob[]> => {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.promise;

  const promise = (async () => {
    if (MOCK) {
      await sleep(500);
      return MOCK_JOBS;
    }
    if (!LIST_URL) {
      throw new Error('Jobs service is not configured (VITE_PUBLIC_JOBS_URL is missing).');
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      // Plain GET with no custom headers → no CORS preflight
      const res = await fetch(LIST_URL, { signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `Could not load jobs (${res.status})`);
      }
      return (data.jobs as any[]).filter(isOpen).map(normalise);
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('Loading jobs took too long. Please try again.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  })();

  cache = { at: Date.now(), promise };
  // A failed load must not be cached
  promise.catch(() => { if (cache?.promise === promise) cache = null; });
  return promise;
};

// ── Apply ─────────────────────────────────────────────────────────────────────

export const submitApplication = async (input: ApplicationInput): Promise<{ applicationId?: string }> => {
  if (MOCK) {
    await sleep(1400);
    return { applicationId: 'MOCK-' + Date.now() };
  }
  if (!APPLY_URL) {
    throw new ApplyError('SERVER', 'Applications are not available right now. Please try again later.');
  }

  const form = new FormData();
  form.append('job_id', input.jobId);
  form.append('first_name', input.firstName.trim());
  form.append('middle_name', input.middleName.trim());
  form.append('last_name', input.lastName.trim());
  form.append('email', input.email.trim().toLowerCase());
  form.append('phone', `${input.phoneCode}${input.phone.replace(/[^\d]/g, '')}`);
  form.append('gender', input.gender);
  form.append('experience_years', input.expYears);
  form.append('experience_months', input.expMonths);
  form.append('salary_currency', input.salaryCurrency);
  form.append('salary_amount', input.salaryAmount);
  form.append('salary_freq', input.salaryFreq);
  form.append('cover_note', input.coverNote.trim());
  form.append('source', 'careers_page');
  form.append('consent', 'true');
  form.append('resumes', input.resume);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);

  let res: Response;
  try {
    // No Content-Type header: the browser sets the multipart boundary itself
    res = await fetch(APPLY_URL, { method: 'POST', body: form, signal: ctrl.signal });
  } catch {
    throw new ApplyError('NETWORK', 'We could not reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({} as any));

  if (res.ok && data.success !== false && !data.error) {
    return { applicationId: data.application_id };
  }

  const msg: string = data.error || '';
  if (res.status === 409 || data.code === 'ALREADY_APPLIED') {
    throw new ApplyError('ALREADY_APPLIED', 'You have already applied for this job with this email address.');
  }
  if (res.status === 410 || data.code === 'JOB_CLOSED') {
    throw new ApplyError('JOB_CLOSED', 'This job is no longer accepting applications.');
  }
  if (res.status === 400 || res.status === 413 || res.status === 422) {
    throw new ApplyError('INVALID', msg || 'Some of your details were not accepted. Please check the form.');
  }
  throw new ApplyError('SERVER', msg || 'Something went wrong on our side. Please try again in a moment.');
};

// ── "Applied" memory (job ids only — no personal data) ────────────────────────

const APPLIED_KEY = 'careers_applied_job_ids';

export const getAppliedJobIds = (): Set<string> => {
  try {
    const raw = sessionStorage.getItem(APPLIED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
};

export const markJobApplied = (jobId: string): void => {
  try {
    const ids = getAppliedJobIds();
    ids.add(jobId);
    sessionStorage.setItem(APPLIED_KEY, JSON.stringify([...ids]));
  } catch { /* storage unavailable — ignore */ }
};

// ── Helpers / sample data ─────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

// Only used when VITE_CAREERS_MOCK=true
const MOCK_JOBS: PublicJob[] = [
  {
    job_id: 'DE-2026-014',
    title: 'Senior Data Engineer',
    location: 'Pune',
    experience_min: 5,
    experience_max: 9,
    created_at: daysAgo(2),
    must_have_skills: ['Python', 'SQL', 'BigQuery', 'Airflow', 'dbt'],
    preferred_skills: ['Terraform', 'Kafka', 'GCP'],
    description:
      `About the role\nYou will design and run the data platforms our customers use to make decisions every day.\n\nResponsibilities:\n- Build and maintain batch and streaming pipelines on GCP\n- Model data in BigQuery for analytics and ML use cases\n- Review code, mentor engineers and own delivery quality\n- Work directly with customer stakeholders to shape requirements\n\nWhat we are looking for:\n- 5+ years building production data pipelines\n- Strong SQL and Python\n- Experience with orchestration (Airflow or similar)\n- Clear written and verbal communication`,
  },
  {
    job_id: 'CLD-2026-009',
    title: 'Cloud Solutions Architect',
    location: 'Pune / Remote',
    experience_min: 8,
    experience_max: 14,
    created_at: daysAgo(5),
    must_have_skills: ['GCP', 'AWS', 'Solution design', 'Kubernetes'],
    preferred_skills: ['FinOps', 'Security'],
    description:
      `About the role\nLead cloud architecture for enterprise migrations and new platform builds.\n\nResponsibilities:\n- Run discovery workshops and produce target architectures\n- Define landing zones, networking and security baselines\n- Guide delivery teams through implementation\n\nWhat we are looking for:\n- 8+ years in infrastructure or cloud engineering\n- Hands-on experience with at least one major cloud\n- Pre-sales or consulting exposure`,
  },
  {
    job_id: 'FS-2026-021',
    title: 'Full Stack Developer (React + Node.js)',
    location: 'Pune',
    experience_min: 3,
    experience_max: 6,
    created_at: daysAgo(9),
    must_have_skills: ['React', 'TypeScript', 'Node.js', 'REST APIs'],
    preferred_skills: ['Firebase', 'Tailwind CSS', 'Testing'],
    description:
      `About the role\nBuild internal and customer-facing web applications end to end.\n\nResponsibilities:\n- Develop responsive React interfaces\n- Build and document Node.js APIs\n- Write tests and take part in code reviews\n\nWhat we are looking for:\n- 3+ years of full stack experience\n- Solid understanding of web performance and accessibility`,
  },
  {
    job_id: 'DO-2026-006',
    title: 'DevOps Engineer',
    location: 'Remote (India)',
    experience_min: 2,
    experience_max: 5,
    created_at: daysAgo(14),
    must_have_skills: ['CI/CD', 'Docker', 'Terraform', 'Linux'],
    preferred_skills: ['Kubernetes', 'Prometheus'],
    description:
      `About the role\nKeep our delivery pipelines fast and our environments reproducible.\n\nResponsibilities:\n- Maintain CI/CD pipelines\n- Manage infrastructure as code\n- Improve monitoring and incident response`,
  },
  {
    job_id: 'ASE-2026-030',
    title: 'Associate Software Engineer',
    location: 'Pune',
    experience_min: 0,
    experience_max: 2,
    created_at: daysAgo(20),
    must_have_skills: ['Any programming language', 'Data structures', 'SQL basics'],
    preferred_skills: ['Python', 'Git'],
    description:
      `About the role\nStart your career on a real project with a mentor from day one.\n\nWhat you will do:\n- Learn our engineering practices through paired work\n- Ship small features and fixes in your first month\n\nWhat we are looking for:\n- Strong fundamentals and curiosity\n- Freshers and up to 2 years of experience are welcome`,
  },
];
