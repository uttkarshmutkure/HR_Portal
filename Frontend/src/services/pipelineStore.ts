// ── PipelineStore ──────────────────────────────────────────────────────────────
// Single source of truth for "which candidates are in the interview pipeline".
// ShortlistedPage writes here on Schedule & Move / Undo Move.
// InterviewPipelinePage reads exclusively from here (no ShortlistStore filtering).
// BigQuery is write-only (audit/email) — never read for pipeline membership.

export interface PipelineEntry {
  candidateId: string;
  jobId:       string;
  addedAt:     number;   // epoch ms
}

const KEY = (jobId: string) => `pipeline_candidates_${jobId}`;

export const PipelineStore = {
  /** Add a candidate to the pipeline (idempotent). */
  add(jobId: string, candidateId: string): void {
    const current = PipelineStore.getAll(jobId);
    if (current.some(e => e.candidateId === candidateId)) return;
    current.push({ candidateId, jobId, addedAt: Date.now() });
    try {
      localStorage.setItem(KEY(jobId), JSON.stringify(current));
    } catch (e) {
      console.error('PipelineStore.add', e);
    }
  },

  /** Remove a candidate from the pipeline. */
  remove(jobId: string, candidateId: string): void {
    const updated = PipelineStore.getAll(jobId).filter(e => e.candidateId !== candidateId);
    try {
      localStorage.setItem(KEY(jobId), JSON.stringify(updated));
    } catch (e) {
      console.error('PipelineStore.remove', e);
    }
  },

  /** Returns all pipeline entries for a job (ordered by addedAt). */
  getAll(jobId: string): PipelineEntry[] {
    try {
      const raw = localStorage.getItem(KEY(jobId));
      return raw ? (JSON.parse(raw) as PipelineEntry[]) : [];
    } catch {
      return [];
    }
  },

  /** Quick membership check. */
  has(jobId: string, candidateId: string): boolean {
    return PipelineStore.getAll(jobId).some(e => e.candidateId === candidateId);
  },
};