// ── Feedback Token Service ────────────────────────────────────────────────────
// Tokens are base64-encoded JSON: { candidateId, jobId, round, candidateName, jobTitle, skills, exp }
// exp = Unix timestamp (ms) 7 days from creation
// No crypto needed — this is a convenience link, not a security boundary

export type InterviewRound = 'round1' | 'technical' | 'hr';

export interface FeedbackTokenPayload {
  candidateId: string;
  jobId:        string;
  round:        InterviewRound;
  candidateName: string;
  jobTitle:     string;
  skills?:      string[];  // must_have_skills pulled from job
  exp:          number;     // Date.now() + 7 days// add this
  candidateEmail?: string;  // add this
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const FeedbackTokenService = {
  generate(payload: Omit<FeedbackTokenPayload, 'exp'>): string {
    const full: FeedbackTokenPayload = {
      ...payload,
      exp: Date.now() + SEVEN_DAYS_MS,
    };
    return btoa(encodeURIComponent(JSON.stringify(full)));
  },

  parse(token: string): FeedbackTokenPayload | null {
    try {
      const decoded = JSON.parse(decodeURIComponent(atob(token)));
      return decoded as FeedbackTokenPayload;
    } catch {
      return null;
    }
  },

  isExpired(payload: FeedbackTokenPayload): boolean {
    return Date.now() > payload.exp;
  },

  getFeedbackUrl(token: string): string {
    return `${window.location.origin}/feedback/${token}`;
  },
};