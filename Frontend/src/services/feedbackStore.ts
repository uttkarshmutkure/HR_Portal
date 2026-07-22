// ── Feedback Store ────────────────────────────────────────────────────────────
// Stores submitted interviewer feedback per candidate per round

export type RoundStatus = 'pending' | 'invited' | 'feedback_submitted' | 'advanced' | 'rejected';

export interface SkillRating {
  skill: string;
  score: number; // 1–10
}

export interface RoundFeedback {
  candidateId:   string;
  jobId:         string;
  round:         string;
  submittedAt:   number;
  interviewerName: string;
  skillRatings:  SkillRating[];
  overallScore:  number;       // 1–10
  notes:         string;
  recommendation: 'advance' | 'reject';
}

export interface CandidateRoundState {
  candidateId: string;
  jobId:       string;
  round:       string;
  status:      RoundStatus;
  invitedAt?:  number;
  feedback?:   RoundFeedback;
}

const KEY = (jobId: string, candidateId: string, round: string) =>
  `feedback:${jobId}:${candidateId}:${round}`;

export const FeedbackStore = {
  save(state: CandidateRoundState): void {
    localStorage.setItem(KEY(state.jobId, state.candidateId, state.round), JSON.stringify(state));
  },

  load(jobId: string, candidateId: string, round: string): CandidateRoundState | null {
    const raw = localStorage.getItem(KEY(jobId, candidateId, round));
    return raw ? JSON.parse(raw) : null;
  },

  markInvited(jobId: string, candidateId: string, round: string): void {
    const existing = FeedbackStore.load(jobId, candidateId, round);
    FeedbackStore.save({
      candidateId, jobId, round,
      status: 'invited',
      invitedAt: Date.now(),
      feedback: existing?.feedback,
    });
  },

  submitFeedback(feedback: RoundFeedback): void {
    const state = FeedbackStore.load(feedback.jobId, feedback.candidateId, feedback.round);
    FeedbackStore.save({
      candidateId: feedback.candidateId,
      jobId:       feedback.jobId,
      round:       feedback.round,
      status:      'feedback_submitted',
      invitedAt:   state?.invitedAt,
      feedback,
    });
  },

  advanceCandidate(jobId: string, candidateId: string, round: string): void {
    const existing = FeedbackStore.load(jobId, candidateId, round);
    if (existing) FeedbackStore.save({ ...existing, status: 'advanced' });
  },

  rejectCandidate(jobId: string, candidateId: string, round: string): void {
    const existing = FeedbackStore.load(jobId, candidateId, round);
    if (existing) FeedbackStore.save({ ...existing, status: 'rejected' });
  },

  // Get all rounds for a candidate across a job
  getAllRounds(jobId: string, candidateId: string): CandidateRoundState[] {
    const rounds = ['round1', 'technical', 'hr'];
    return rounds
      .map(r => FeedbackStore.load(jobId, candidateId, r))
      .filter(Boolean) as CandidateRoundState[];
  },
};