export type RoundKind = 'technical' | 'hr';
export interface InterviewRound { id: string; label: string; short: string; kind: RoundKind }

export const MAX_ROUNDS = 6;

export const DEFAULT_ROUNDS: InterviewRound[] = [
  { id: 'round1',    label: 'Round 1 (Technical)',          short: 'R1', kind: 'technical' },
  { id: 'technical', label: 'Round 2 (Advanced Technical)', short: 'R2', kind: 'technical' },
  { id: 'hr',        label: 'HR Round',                     short: 'HR', kind: 'hr' },
];

export const normalizeRounds = (raw: any): InterviewRound[] => {
  if (Array.isArray(raw) && raw.length > 0) return raw;
  return DEFAULT_ROUNDS;
};

export const newRoundId = () => `r_${Math.random().toString(36).slice(2, 7)}`;
export const roundIndex = (rounds: InterviewRound[], id: string) =>
  rounds.findIndex(r => r.id === id);