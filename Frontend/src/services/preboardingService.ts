// src/services/preboardingService.ts
const ENDPOINT = import.meta.env.VITE_PREBOARDING_URL as string;

export type DocType = 'aadhaar' | 'pan';
export type DocStatus = 'missing' | 'uploaded' | 'verified' | 'rejected';
export type PreboardingStatus = 'docs_pending' | 'docs_submitted' | 'docs_verified' | 'docs_rejected' | 'overdue';

export interface DocInfo { status: DocStatus; reason: string | null; uploaded_at: string | null }
export interface PreboardingRecord {
  candidate_id: string; job_id: string; candidate_name: string; candidate_email: string;
  job_title: string; deadline: string; status: PreboardingStatus;
  documents: Record<DocType, DocInfo>;
}
export interface PreboardingPublicView {
  candidate_name: string; job_title: string; deadline: string;
  status: PreboardingStatus; documents: Record<DocType, DocInfo>;
}

// HR calls need a Google ID token once HR_AUTH_ENABLED=true on the backend.
// Register a provider once at app start, e.g. setPreboardingAuthProvider(async () => user.idToken)
let authProvider: (() => Promise<string | null>) | null = null;
export const setPreboardingAuthProvider = (fn: () => Promise<string | null>) => { authProvider = fn; };

async function post<T = any>(body: object, hr = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (hr && authProvider) {
    const t = await authProvider();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message ?? 'Request failed');
  return data as T;
}

export const PreboardingService = {
  // ── Candidate (public, token-based) ─────────────────────────────────────────
  getPublic: (token: string) =>
    post<{ success: true } & PreboardingPublicView>({ action: 'get_public', token }),

  async uploadDocument(token: string, docType: DocType, file: File) {
    const fd = new FormData();
    fd.append('action', 'upload'); fd.append('token', token);
    fd.append('doc_type', docType); fd.append('file', file);
    // No Content-Type header: the browser sets the multipart boundary.
    const res = await fetch(ENDPOINT, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.message ?? 'Upload failed');
    return data as { status: PreboardingStatus; documents: Record<DocType, DocInfo> };
  },

  // ── HR ──────────────────────────────────────────────────────────────────────
  async listForJob(jobId: string): Promise<Record<string, PreboardingRecord>> {
    const d = await post<{ records: PreboardingRecord[] }>({ action: 'list', job_id: jobId }, true);
    return Object.fromEntries(d.records.map(r => [r.candidate_id, r]));
  },
  create: (p: { candidate_id: string; job_id: string; candidate_name: string; candidate_email: string; job_title: string }) =>
    post<{ already_exists: boolean; email_sent?: boolean; record: PreboardingRecord }>({ action: 'create', ...p }, true),
  resend: (candidate_id: string, job_id: string) =>
    post<{ email_sent: boolean }>({ action: 'resend', candidate_id, job_id }, true),
  extend: (candidate_id: string, job_id: string, days: number) =>
    post({ action: 'extend', candidate_id, job_id, days }, true),
  verify: (candidate_id: string, job_id: string, doc_type: DocType) =>
    post({ action: 'verify', candidate_id, job_id, doc_type }, true),
  reject: (candidate_id: string, job_id: string, doc_type: DocType, reason: string) =>
    post<{ email_sent: boolean }>({ action: 'reject', candidate_id, job_id, doc_type, reason }, true),

  /** Fetches the private file and returns a temporary blob: URL (never a public link). */
  async documentBlobUrl(candidate_id: string, job_id: string, doc_type: DocType): Promise<string> {
    const d = await post<{ mime: string; data: string }>({ action: 'get_document', candidate_id, job_id, doc_type }, true);
    const bytes = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: d.mime }));
  },
};