import { TopCandidate } from './screening';

export interface ShortlistEntry {
  candidate: TopCandidate;
  jdTitle: string;
  shortlistedAt: string; // ISO string
}

export interface RejectedEntry {
  candidateId: string;
  rejectedAt: string;
}

const SHORTLIST_KEY = (jobId: string) => `shortlist_${jobId}`;
const REJECTED_KEY  = (jobId: string) => `rejected_${jobId}`;

export const ShortlistStore = {
  // ── Shortlisted ────────────────────────────────────────────────────────────

  getShortlisted(jobId: string): ShortlistEntry[] {
    try {
      const raw = localStorage.getItem(SHORTLIST_KEY(jobId));
      return raw ? (JSON.parse(raw) as ShortlistEntry[]) : [];
    } catch {
      return [];
    }
  },

  addShortlisted(jobId: string, candidate: TopCandidate, jdTitle: string): void {
    const existing = ShortlistStore.getShortlisted(jobId);
    const alreadyIn = existing.some(e => e.candidate.candidate_id === candidate.candidate_id);
    if (alreadyIn) return;
    const updated: ShortlistEntry[] = [
      ...existing,
      { candidate, jdTitle, shortlistedAt: new Date().toISOString() },
    ];
    localStorage.setItem(SHORTLIST_KEY(jobId), JSON.stringify(updated));
  },

  removeShortlisted(jobId: string, candidateId: string): void {
    const existing = ShortlistStore.getShortlisted(jobId);
    const updated = existing.filter(e => e.candidate.candidate_id !== candidateId);
    localStorage.setItem(SHORTLIST_KEY(jobId), JSON.stringify(updated));
  },

  isShortlisted(jobId: string, candidateId: string): boolean {
    return ShortlistStore.getShortlisted(jobId).some(
      e => e.candidate.candidate_id === candidateId,
    );
  },

  // ── Rejected ───────────────────────────────────────────────────────────────

  getRejected(jobId: string): RejectedEntry[] {
    try {
      const raw = localStorage.getItem(REJECTED_KEY(jobId));
      return raw ? (JSON.parse(raw) as RejectedEntry[]) : [];
    } catch {
      return [];
    }
  },

  addRejected(jobId: string, candidateId: string): void {
    const existing = ShortlistStore.getRejected(jobId);
    const alreadyIn = existing.some(e => e.candidateId === candidateId);
    if (alreadyIn) return;
    const updated: RejectedEntry[] = [
      ...existing,
      { candidateId, rejectedAt: new Date().toISOString() },
    ];
    localStorage.setItem(REJECTED_KEY(jobId), JSON.stringify(updated));
    // Also remove from shortlist if previously shortlisted
    ShortlistStore.removeShortlisted(jobId, candidateId);
  },

  isRejected(jobId: string, candidateId: string): boolean {
    return ShortlistStore.getRejected(jobId).some(e => e.candidateId === candidateId);
  },

  removeRejected(jobId: string, candidateId: string): void {
    const existing = ShortlistStore.getRejected(jobId);
    const updated = existing.filter(e => e.candidateId !== candidateId);
    localStorage.setItem(REJECTED_KEY(jobId), JSON.stringify(updated));
  },
};