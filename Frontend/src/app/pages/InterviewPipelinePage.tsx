import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router';
import { Check, X, Clock, Users, RefreshCw, UserCog, Loader2 } from 'lucide-react';
import DashboardLayout from '../components/layout/DashboardLayout';
import { ShortlistStore } from '../../services/shortlistStore';
import { FeedbackStore } from '../../services/feedbackStore';
import { PipelineStore } from '../../services/pipelineStore';
import { FeedbackTokenService } from '../../services/feedbackTokenService';
import { EmailService } from '../../services/emailService';
import { TopCandidate } from '../../services/screening';
import { useToast } from '../components/ToastContext';
import { useAuth } from '../components/AuthContext';
import { SalaryRules, DEFAULT_SALARY_RULES, GenerateChoiceModal, SalaryDetailsModal } from './OfferGenerationPage';

const GET_CANDIDATE_SLOTS_URL = import.meta.env.VITE_GET_CANDIDATE_SLOTS_URL;
const SAVE_SLOTS_URL = import.meta.env.VITE_SAVE_SLOTS_URL;
// ── Shared Interviewer Store ───────────────────────────────────────────────────
const InterviewerHelper = {
  get: (jobId: string) => {
    try {
      const stored = localStorage.getItem(`interviewers_${jobId}`);
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return [];
  }
};

type RoundTab  = 'round1' | 'round2' | 'hrround' | 'onboarding' | 'hired' | 'archived';
type DetailTab = 'pipeline' | 'feedback' | 'profile' | 'questions' | 'offer';

// ── Status badge helper (legacy local-storage fallback, BQ is source of truth) ─
const getCandidateStatus = (jobId: string, candId: string): string => {
  const r1 = FeedbackStore.load(jobId, candId, 'round1');
  const r2 = FeedbackStore.load(jobId, candId, 'technical');
  const hr = FeedbackStore.load(jobId, candId, 'hr');
  if (hr?.status === 'advanced')           return 'Offer Stage';
  if (hr?.status === 'feedback_submitted') return 'Awaiting Feedback';
  if (r2?.status === 'advanced')           return 'HR Round';
  if (r2?.status === 'feedback_submitted') return 'Awaiting Feedback';
  if (r1?.status === 'advanced')           return 'Round 2';
  if (r1?.status === 'feedback_submitted') return 'Awaiting Feedback';
  if (r1?.status === 'invited')            return 'Awaiting Candidate Response';
  return 'Shortlisted';
};

// ── Full DB-status → UI-badge mapping ─────────────────────────────────────────
//
//  Round      DB status            UI badge
//  ─────────  ───────────────────  ──────────────────────────────────────
//  (none)     —                    Shortlisted
//  round1     invited              Awaiting Candidate Response
//  round1     scheduled            Interview Scheduled
//  round1     feedback_submitted   R1 Feedback Received  (or Awaiting Feedback)
//  round2     invited              Awaiting Candidate Response
//  technical  scheduled            Interview Scheduled
//  technical  feedback_submitted   R2 Feedback Received  (or Awaiting Feedback)
//  hr         scheduled            HR Round
//  hr         feedback_submitted   Feedback Received     (or Awaiting Feedback)
//  hr         advanced             Offer Stage
//  any        reject verdict       Rejected
//
// ── Dual-badge status resolution ─────────────────────────────────────────────
// Each state returns [primary, secondary] badges.
// secondary is null when only one badge is needed.
//
// Full loop for each round:
//   invited          → [Awaiting Candidate Response, null]
//   scheduled        → [Interview Scheduled, Awaiting Feedback]      ← dual
//   feedback advance → [RN Feedback Received, Awaiting Next Slot]    ← dual
//   feedback reject  → [RN Feedback Received, Rejected]              ← dual
//   advanced (slot sent for next) → handled by next round's entries
//
const resolveBQStatus = (
  r1: any, r2: any, hr: any,
  hasFeedback: (round: string) => boolean,
  hasRejection: (round: string) => boolean,
  getVerdict:   (round: string) => string | null
): [string, string | null] => {

  // 100% Crash-Proof Normalizer: Converts null/undefined to strings before Regex
  const norm = (s?: string | null) => String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '');

  // ── HR Round ──────────────────────────────────────────────────────────────
  // (We check if it exists AND isn't just 'not_started')
  if (hr && norm(hr.status) !== 'not_started' && norm(hr.status) !== '') {
    const st = norm(hr.status);
    if (st === 'rejected')             return ['Rejected', null];
    if (st === 'advanced')             return ['Offer Stage', null];
    if (st === 'feedback_submitted') {
      if (hasFeedback('hr')) {
        const v = norm(getVerdict('hr'));
        return v === 'reject' ? ['HR Feedback Received', 'Rejected'] : ['HR Feedback Received', 'Offer Stage'];
      }
      return ['HR Interview Scheduled', 'Awaiting Feedback'];
    }
    if (st === 'scheduled')            return ['HR Interview Scheduled', 'Awaiting Feedback'];
    if (st === 'invited' || st === 'confirmed') return ['Awaiting Candidate Response', null];
  }

  // ── Round 2 ───────────────────────────────────────────────────────────────
  if (r2 && norm(r2.status) !== 'not_started' && norm(r2.status) !== '') {
    const st = norm(r2.status);
    if (st === 'rejected')             return ['Rejected', null];
    if (st === 'feedback_submitted') {
      if (hasFeedback('technical')) {
        const v = norm(getVerdict('technical'));
        return v === 'reject' ? ['R2 Feedback Received', 'Rejected'] : ['R2 Feedback Received', 'Awaiting HR Slot Selection'];
      }
      return ['R2 Interview Scheduled', 'Awaiting Feedback'];
    }
    if (st === 'scheduled')            return ['R2 Interview Scheduled', 'Awaiting Feedback'];
    if (st === 'advanced')             return ['R2 Feedback Received', 'Awaiting HR Slot Selection'];
    if (st === 'invited' || st === 'confirmed') return ['Awaiting Candidate Response', null];
  }

  // ── Round 1 ───────────────────────────────────────────────────────────────
  if (r1 && norm(r1.status) !== 'not_started' && norm(r1.status) !== '') {
    const st = norm(r1.status);
    if (st === 'rejected')             return ['Rejected', null];
    if (st === 'feedback_submitted') {
      if (hasFeedback('round1')) {
        const v = norm(getVerdict('round1'));
        return v === 'reject' ? ['R1 Feedback Received', 'Rejected'] : ['R1 Feedback Received', 'Awaiting R2 Slot Selection'];
      }
      return ['R1 Interview Scheduled', 'Awaiting Feedback'];
    }
    if (st === 'scheduled')            return ['R1 Interview Scheduled', 'Awaiting Feedback'];
    if (st === 'advanced')             return ['R1 Feedback Received', 'Awaiting R2 Slot Selection'];
    if (st === 'invited' || st === 'confirmed') return ['Awaiting Candidate Response', null];
  }

  // Fallback ONLY if no rounds are active
  return ['Shortlisted', null];
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  // ── Base ──────────────────────────────────────────────────────────────────
  'Shortlisted':                  { bg: '#F3F4F6', color: '#4B5563' },
  'Offer Stage':                  { bg: '#ECFDF5', color: '#059669' },
  'Hired':                        { bg: '#DCFCE7', color: '#15803D' },
  'Rejected':                     { bg: '#FEF2F2', color: '#DC2626' },
  'HR Round':                     { bg: '#F5F3FF', color: '#7C3AED' },

  // ── Primary badges ────────────────────────────────────────────────────────
  'Awaiting Candidate Response':  { bg: '#FEF9C3', color: '#B45309' },
  'R1 Interview Scheduled':       { bg: '#DCFCE7', color: '#16A34A' },
  'R2 Interview Scheduled':       { bg: '#DCFCE7', color: '#16A34A' },
  'HR Interview Scheduled':       { bg: '#DCFCE7', color: '#16A34A' },
  'R1 Feedback Received':         { bg: '#EFF6FF', color: '#2563EB' },
  'R2 Feedback Received':         { bg: '#EFF6FF', color: '#2563EB' },
  'HR Feedback Received':         { bg: '#EFF6FF', color: '#2563EB' },

  // ── Secondary badges ──────────────────────────────────────────────────────
  'Awaiting Feedback':            { bg: '#FFF7ED', color: '#EA580C' },
  'Awaiting R2 Slot Selection':   { bg: '#FEF9C3', color: '#B45309' },
  'Awaiting HR Slot Selection':   { bg: '#FEF9C3', color: '#B45309' },
};

const pipelineCache: Record<string, any[]> = {};
const roundsCache: Record<string, Record<string, RoundTab>> = {};
const statusesCache: Record<string, Record<string, [string, string | null]>> = {};
const profileCache: Record<string, any> = {};
const interviewersCache: Record<string, Record<string, Record<string, string | null>>> = {};

// ── Manual Schedule Modal (Round 2 / HR) ────────────────────────────────────────
const ManualScheduleModal = ({ cand, jobId, round, roundLabel, onClose, onSuccess }: {
  cand: any; jobId: string; round: string; roundLabel: string; onClose: () => void; onSuccess: () => void;
}) => {
  const { showToast } = useToast();
  const [slots, setSlots] = useState<{ day: string; start_time: string; end_time: string; work_mode: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ day: string; start_time: string; end_time: string; work_mode: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const DAY_NAME_TO_INDEX: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };
  const nextDateForDay = (dayName: string): string => {
    const targetIdx = DAY_NAME_TO_INDEX[dayName];
    const today = new Date();
    if (targetIdx === undefined) return today.toISOString().slice(0, 10);
    const todayIdx = today.getDay();
    let diff = (targetIdx - todayIdx + 7) % 7;
    if (diff === 0) diff = 7;
    const result = new Date(today);
    result.setDate(today.getDate() + diff);
    const y = result.getFullYear(), m = String(result.getMonth() + 1).padStart(2, '0'), d = String(result.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const fetchSlots = () => {
    setLoading(true);
    setSelected(null);
    fetch(GET_CANDIDATE_SLOTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, candidateId: cand.candidate_id, round, mode: 'manual' }),
    })
      .then(r => r.json())
      .then(data => setSlots(data.success && Array.isArray(data.slots) ? data.slots : []))
      .catch(err => { console.error(err); showToast('Failed to load slots', 'error'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSlots(); /* eslint-disable-next-line */ }, []);

  const handleConfirm = () => {
    if (!selected) return;
    setConfirming(true);

    const payload = {
      jobId,
      candidateId: cand.candidate_id,
      round,
      candidateName: cand.name,
      candidateEmail: cand.email,
      selectedSlots: [{
        raw: `${selected.day}|${selected.start_time}-${selected.end_time}`,
        slot_date: nextDateForDay(selected.day),
        slot_start_time: selected.start_time,
        slot_end_time: selected.end_time,
      }],
    };

    fetch(SAVE_SLOTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(() => {
        showToast(`Interview manually scheduled for ${cand.name}!`, 'success');
        onSuccess();
      })
      .catch(err => {
        console.error(err);
        showToast('Failed to save manual slot.', 'error');
      })
      .finally(() => setConfirming(false));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', backdropFilter: 'blur(3px)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', maxHeight: '92vh', boxShadow: '0 25px 40px rgba(0,0,0,0.12)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #E5E7EB', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827', fontFamily: 'Inter, sans-serif' }}>Manual Slot Selection</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7280', fontFamily: 'Inter, sans-serif' }}>{cand.name} · {roundLabel}</p>
          </div>
          <button onClick={onClose} disabled={confirming} style={{ background: 'none', border: 'none', fontSize: 18, cursor: confirming ? 'not-allowed' : 'pointer', color: '#9CA3AF' }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, fontFamily: 'Inter, sans-serif' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Free Interviewer Slots</label>
            <button
              onClick={fetchSlots}
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, color: '#F07C2D', background: 'none', border: '0.5px solid #FFEDD5', borderRadius: 6, padding: '4px 10px', cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              <RefreshCw size={11} style={loading ? { animation: 'spin 1s linear infinite' } : {}} /> Refresh
            </button>
          </div>

          {loading && <div style={{ fontSize: 13, color: '#6B7280' }}>Loading available slots…</div>}
          {!loading && slots.length === 0 && <div style={{ fontSize: 13, color: '#DC2626' }}>No free slots currently available.</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slots.map((slot, idx) => {
              const isSelected = selected?.day === slot.day && selected?.start_time === slot.start_time && selected?.end_time === slot.end_time;
              const isOnline = slot.work_mode === 'WFH';
              return (
                <button
                  key={idx}
                  onClick={() => setSelected(slot)}
                  style={{
                    padding: '12px 16px', borderRadius: 8,
                    border: `1px solid ${isSelected ? '#F07C2D' : '#E5E7EB'}`,
                    background: isSelected ? '#FFF7ED' : '#fff',
                    color: isSelected ? '#F07C2D' : '#374151',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>{slot.day}, {slot.start_time} - {slot.end_time}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
                      background: isOnline ? '#EFF6FF' : '#F0FDF4',
                      color: isOnline ? '#1D4ED8' : '#15803D',
                      border: `1px solid ${isOnline ? '#BFDBFE' : '#BBF7D0'}`,
                    }}>
                      {isOnline ? 'Online' : 'In-Person (Office)'}
                    </span>
                  </div>
                  {isSelected && (
                    <span style={{ fontSize: 10, background: '#F07C2D', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>Selected</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '0.5px solid #E5E7EB', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button disabled={confirming} onClick={onClose} style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, fontFamily: 'Inter, sans-serif', background: '#F9FAFB', color: '#374151', border: '0.5px solid #E5E7EB', borderRadius: 8, cursor: confirming ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button
            disabled={!selected || confirming}
            onClick={handleConfirm}
            style={{ padding: '9px 20px', fontSize: 13, fontWeight: 600, fontFamily: 'Inter, sans-serif', background: selected ? '#F07C2D' : '#E5E7EB', color: selected ? '#fff' : '#9CA3AF', border: 'none', borderRadius: 8, cursor: !selected || confirming ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {confirming && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
            {confirming ? 'Scheduling...' : 'Confirm & Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default function InterviewPipelinePage() {
  const { showToast } = useToast();
  const { user, activeRole } = useAuth();
  const { jobId }       = useParams<{ jobId: string }>();
  const location        = useLocation();
  const navigate        = useNavigate();
  const jdTitle: string = location.state?.jdTitle ?? jobId ?? 'Job';
  const restoreTab: RoundTab | undefined = location.state?.restoreTab;
  const restoreCandidateId: string | undefined = location.state?.restoreCandidateId;

  const [refreshKey,    setRefreshKey]    = useState(0);
  const [isRefreshing,  setIsRefreshing]  = useState(false);
  const refresh = () => {
    setIsRefreshing(true);
    setRefreshKey(k => k + 1);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // ── Tab & selection state (declared early — used in effects below) ──────────
  const [activeTab,         setActiveTab]         = useState<RoundTab>(restoreTab ?? 'round1');
  const [selectedCandId,    setSelectedCandId]    = useState<string | null>(null);
  const [detailTab,         setDetailTab]         = useState<DetailTab>('pipeline');
  const [feedbackModalCand, setFeedbackModalCand] = useState<TopCandidate | null>(null);
  const [salaryRules, setSalaryRules] = useState<SalaryRules>(DEFAULT_SALARY_RULES);
  const [showGenerateChoiceModal, setShowGenerateChoiceModal] = useState(false);
  const [showSalaryModal, setShowSalaryModal] = useState(false);
  const [pendingOfferTarget, setPendingOfferTarget] = useState<{ cand: TopCandidate; jdTitle: string } | null>(null);

  // ── Live BigQuery profile data ─────────────────────────────────────────────
  const [feedbackData, setFeedbackData] = useState<{ timeline: any[]; feedback: any[] } | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // ── Pipeline membership from PipelineStore (source of truth) ─────────────
  // Get all candidates that have been explicitly added to the pipeline.
  // ShortlistStore is only used to look up full candidate objects by id.
  const [pipelineCandidates, setPipelineCandidates] = useState<any[]>([]);
  const [candidateRounds,    setCandidateRounds]    = useState<Record<string, RoundTab>>({});
  // Dual-badge: [primary, secondary|null] per candidate
  const [candidateStatuses,  setCandidateStatuses]  = useState<Record<string, [string, string | null]>>({});
  // Per-candidate, per-round interviewer email — used to filter visibility for the Interviewer role
  const [candidateInterviewers, setCandidateInterviewers] = useState<Record<string, Record<string, string | null>>>({});
  const [manualCand, setManualCand] = useState<any | null>(null);


  // Only reset detailTab when activeTab changes, not when detailTab itself changes.
  // Having detailTab in the dep array caused a loop: clicking Pipeline tab on onboarding
  // would immediately get overridden back to 'offer'.
  useEffect(() => {
    if (activeTab === 'onboarding') {
      setDetailTab('offer');
    } else {
      setDetailTab('pipeline');
    }
  }, [activeTab]);
  
  // ── Fetch pipeline candidates from BigQuery ──────────────────────────────
  useEffect(() => {
    if (!jobId) return;

    if (refreshKey === 0 && pipelineCache[jobId]) {
      setPipelineCandidates(pipelineCache[jobId]);
      return;
    }

    fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'GET_SHORTLISTED', jobId }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.candidates) {
          const inPipeline = data.candidates.filter((c: any) => 
            c.candidate_result === 'Interview' || 
            c.candidate_result === 'Selected'  ||
            c.candidate_result === 'Hired'     || 
            c.candidate_result === 'Rejected'
          );
          pipelineCache[jobId] = inPipeline; // Save to cache
          setPipelineCandidates(inPipeline);
        }
      })
      .catch(console.error);
  }, [jobId, refreshKey]);

  useEffect(() => {
    if (!jobId || pipelineCandidates.length === 0) return;

    if (refreshKey === 0 && roundsCache[jobId] && statusesCache[jobId] && interviewersCache[jobId]) {
      setCandidateRounds(roundsCache[jobId]);
      setCandidateStatuses(statusesCache[jobId]);
      setCandidateInterviewers(interviewersCache[jobId]);
      return;
    }

    const fetchRounds = async () => {
      const rounds:       Record<string, RoundTab>                     = {};
      const statuses:     Record<string, [string, string|null]>        = {};
      const interviewers: Record<string, Record<string, string|null>>  = {};

      await Promise.all(
        pipelineCandidates.map(async (candidate) => {
          const candId = candidate.candidate_id;
          try {
            const res  = await fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'GET_FULL_PROFILE', jobId, candidateId: candId }),
            });
            const data: { timeline: any[]; feedback: any[] } = await res.json();
            
            profileCache[candId] = data; // Cache profile immediately

            const timeline = data.timeline ?? [];
            const feedback = data.feedback  ?? [];

            const normStr = (s?: string | null) => String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
            
            const hr = timeline.find((t: any) => normStr(t.round) === 'hr');
            const r2 = timeline.find((t: any) => normStr(t.round) === 'technical');
            const r1 = timeline.find((t: any) => normStr(t.round) === 'round1');

            interviewers[candId] = {
              round1:    r1?.interviewer_email ?? null,
              technical: r2?.interviewer_email ?? null,
              hr:        hr?.interviewer_email ?? null,
            };

            const hasFeedback  = (round: string) => feedback.some((fb: any) => normStr(fb.round) === round);
            const hasRejection = (round: string) => feedback.some((fb: any) => normStr(fb.round) === round && normStr(fb.verdict) === 'reject');
            const getVerdict   = (round: string): string | null => {
              const fb = feedback.find((f: any) => normStr(f.round) === round);
              return fb?.verdict ?? null;
            };

            statuses[candId] = resolveBQStatus(r1, r2, hr, hasFeedback, hasRejection, getVerdict);

            // 1. Check if the candidate has passed the round (either marked 'advanced' OR has a passing feedback verdict)
            const r1Pass = normStr(r1?.status) === 'advanced' || (normStr(r1?.status) === 'feedback_submitted' && normStr(getVerdict('round1')) === 'advance');
            const r2Pass = normStr(r2?.status) === 'advanced' || (normStr(r2?.status) === 'feedback_submitted' && normStr(getVerdict('technical')) === 'advance');
            const hrPass = normStr(hr?.status) === 'advanced' || (normStr(hr?.status) === 'feedback_submitted' && normStr(getVerdict('hr')) === 'advance');
            const topResult = normStr(candidate.candidate_result);
            const isGloballyRejected = topResult === 'rejected' || normStr(r1?.status) === 'rejected' || normStr(r2?.status) === 'rejected' || normStr(hr?.status) === 'rejected' || hasRejection('round1') || hasRejection('technical') || hasRejection('hr');
            const isGloballyHired    = topResult === 'hired'    || normStr(hr?.status) === 'hired'    || normStr(hr?.status) === 'accepted';

            if (isGloballyRejected) {
              rounds[candId]   = 'archived';
              statuses[candId] = ['Rejected', null];
            } else if (isGloballyHired) {
              rounds[candId]   = 'hired';
              statuses[candId] = ['Hired', null];
            } else if (hrPass) {
              rounds[candId] = 'onboarding';
            } else if (hr || r2Pass) {
              rounds[candId] = 'hrround';
            } else if (r2 || r1Pass) {
              rounds[candId] = 'round2';
            } else {
              rounds[candId] = 'round1';
            }
          } catch {
            rounds[candId]   = 'round1';
            statuses[candId] = ['Shortlisted', null];
          }
        })
      );

      roundsCache[jobId] = rounds;
      statusesCache[jobId] = statuses;
      interviewersCache[jobId] = interviewers;
      setCandidateRounds(rounds);
      setCandidateStatuses(statuses);
      setCandidateInterviewers(interviewers);
    };

    fetchRounds();
  }, [jobId, refreshKey, pipelineCandidates]);

  // HR sees everyone. An Interviewer only sees a candidate in a given tab if they
  // are the assigned interviewer for that round (or, for Hired/Archived, if they
  // interviewed the candidate in ANY round along the way).
  const bucketRoundKey: Record<RoundTab, string> = {
    round1: 'round1', round2: 'technical', hrround: 'hr',
    onboarding: 'hr', hired: 'hr', archived: 'hr',
  };

  // ── Feedback visibility cascade ─────────────────────────────────────────
  // Interviewer sees feedback up to (and including) the highest round they're
  // assigned to for this candidate. HR sees everything, unfiltered.
  const ROUND_ORDER: Record<string, number> = { round1: 1, technical: 2, hr: 3 };

  const getVisibleFeedback = (candId: string, allFeedback: any[]): any[] => {
    if (activeRole !== 'interviewer') return allFeedback;
    if (!user?.email) return [];

    const perRound = candidateInterviewers[candId];
    if (!perRound) return [];

    let cutoff = 0;
    Object.entries(perRound).forEach(([round, email]) => {
      if (email === user.email) {
        cutoff = Math.max(cutoff, ROUND_ORDER[round] ?? 0);
      }
    });
    if (cutoff === 0) return []; // not assigned to any round for this candidate

    return allFeedback.filter(fb => (ROUND_ORDER[fb.round] ?? 99) <= cutoff);
  };  

  const isVisibleToCurrentUser = (candId: string, bucket: RoundTab): boolean => {
    if (activeRole !== 'interviewer') return true; // HR / no role restriction yet
    if (!user?.email) return false;

    const perRound = candidateInterviewers[candId];
    if (!perRound) return false;

    if (bucket === 'hired' || bucket === 'archived') {
      return Object.values(perRound).some(email => email === user.email);
    }

    return perRound[bucketRoundKey[bucket]] === user.email;
  };

  const candidatesByRound: Record<RoundTab, TopCandidate[]> = {
    round1: [], round2: [], hrround: [], onboarding: [], hired: [], archived: []
  };

  pipelineCandidates.forEach(candidate => {
    const candId = candidate.candidate_id;
    const tab = candidateRounds[candId] ?? 'round1';
    if (isVisibleToCurrentUser(candId, tab)) {
      candidatesByRound[tab].push(candidate);
    }
  });

  // ── Interview Questions ────────────────────────────────────────────────────
  type QuestionCache = { theory: any[]; coding: any[] };
  const [questionsCache, setQuestionsCache] = useState<Map<string, QuestionCache>>(new Map());
  const [loadingKeys,    setLoadingKeys]    = useState<Set<string>>(new Set());

  const [attemptedQs,    setAttemptedQs]    = useState<Set<string>>(new Set());

  const roundMap: Record<RoundTab, string> = {
    round1: 'round1', round2: 'technical', hrround: 'hr', onboarding: 'hr', hired: 'hr', archived: 'hr'
  };
  const questionsCacheKey = selectedCandId ? `${selectedCandId}:${roundMap[activeTab]}` : null;
  const cachedQs          = questionsCacheKey ? questionsCache.get(questionsCacheKey) : undefined;
  const theoryQuestions   = cachedQs?.theory ?? [];
  const codingQuestions   = cachedQs?.coding  ?? [];
  const hasQuestions      = theoryQuestions.length > 0 || codingQuestions.length > 0;
  const isHrTab           = activeTab === 'hrround' || activeTab === 'onboarding';
  const questionsLoading  = !!questionsCacheKey && loadingKeys.has(questionsCacheKey);

  const generateQuestions = async () => {
    if (!jobId || !selectedCandId || !questionsCacheKey) return;
    const key = questionsCacheKey;
    setLoadingKeys(prev => new Set(prev).add(key));
    setAttemptedQs(prev => new Set(prev).add(key));
    try {
      const res  = await fetch(import.meta.env.VITE_GENERATE_QUESTIONS_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, candidateId: selectedCandId, round: roundMap[activeTab] }),
      });
      const data = await res.json();
      if (data.success) {
        setQuestionsCache(prev => new Map(prev).set(key, {
          theory: data.theory_questions ?? [],
          coding: data.coding_questions  ?? [],
        }));
      } else {
        showToast(data.error ?? 'Failed to generate questions', 'error');
      }
    } catch {
      showToast('Network error while generating questions', 'error');
    } finally {
      setLoadingKeys(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  useEffect(() => {
    if (
      questionsCacheKey && 
      !questionsCache.has(questionsCacheKey) && 
      !loadingKeys.has(questionsCacheKey) && 
      !attemptedQs.has(questionsCacheKey)
    ) {
      generateQuestions();
    }
  }, [questionsCacheKey, questionsCache, loadingKeys, attemptedQs]);

  const searchParams   = new URLSearchParams(location.search);
  const urlCandidateId = searchParams.get('candidateId');
  const autoFeedback   = searchParams.get('feedback');

  useEffect(() => {
    if (!urlCandidateId || !jobId || pipelineCandidates.length === 0) return;
    const candidate = pipelineCandidates.find(c => c.candidate_id === urlCandidateId);
    if (!candidate) return;
    setSelectedCandId(candidate.candidate_id);
    const round = candidateRounds[candidate.candidate_id] ?? 'round1';
    setActiveTab(round);
    if (autoFeedback === 'true') setFeedbackModalCand(candidate);
  }, [urlCandidateId, autoFeedback, jobId]);

  useEffect(() => {
    const list = candidatesByRound[activeTab];
    if (list.length === 0) {
      setSelectedCandId(null);
      return;
    }
    // If we were told to restore a specific candidate (e.g. via back-navigation from Offer Copilot)
    // and it exists in this tab, select it once, then clear the marker so normal behavior resumes.
    if (restoreCandidateId && list.find(c => c.candidate_id === restoreCandidateId)) {
      setSelectedCandId(restoreCandidateId);
      return;
    }
    if (!list.find(c => c.candidate_id === selectedCandId)) {
      setSelectedCandId(list[0].candidate_id);
    }
  }, [activeTab, refreshKey, pipelineCandidates]);

  // ── Fetch live profile from BigQuery when candidate changes ────────────────
  useEffect(() => {
    if (!jobId || !selectedCandId) { setFeedbackData(null); return; }

    if (refreshKey === 0 && profileCache[selectedCandId]) {
      setFeedbackData(profileCache[selectedCandId]);
      return;
    }

    setProfileLoading(true);
    fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:        'GET_FULL_PROFILE',
        jobId:       jobId,
        candidateId: selectedCandId,
      }),
    })
      .then(res => res.json())
      .then(data => {
        profileCache[selectedCandId] = data; // Save to cache
        setFeedbackData(data);
      })
      .catch(() => setFeedbackData(null))
      .finally(() => setProfileLoading(false));
  }, [selectedCandId, jobId, refreshKey]);

  const activeCandidates  = candidatesByRound[activeTab];
  const selectedCandidate = activeCandidates.find(c => c.candidate_id === selectedCandId) || null;

  const handleReject = async (cand: TopCandidate, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!jobId) return;
    try {
      await fetch(import.meta.env.VITE_UPDATE_CANDIDATE_STATUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_id: cand.candidate_id, candidate_result: 'Rejected' }),
      });
      refresh();
    } catch (err) {
      console.error("Failed to reject candidate", err);
    }
  };

  const goToOfferCopilot = (rulesOverride?: SalaryRules) => {
    if (!pendingOfferTarget) return;
    navigate(`/jobs/${jobId}/candidates/${pendingOfferTarget.cand.candidate_id}/offer`, {
      state: { cand: pendingOfferTarget.cand, jdTitle: pendingOfferTarget.jdTitle, salaryRules: rulesOverride ?? salaryRules },
    });
    setPendingOfferTarget(null);
  };

  // ── CSS ────────────────────────────────────────────────────────────────────
  const css = `
    .pipe-container { font-family: 'Inter', sans-serif; color: #111827; }
    .page-header { padding: 20px 32px 0; }
    .page-title { font-size: 20px; font-weight: 600; color: #111827; letter-spacing: -0.02em; }
    .page-sub { color: #6B7280; font-size: 12px; margin-top: 4px; }

    .round-tabs { 
      display: grid; 
      grid-template-columns: repeat(6, 1fr); /* 1. Forces an exact 6-way equal split */
      gap: 12px; 
      padding: 20px 32px 16px; 
      width: 100%;
      box-sizing: border-box;
      overflow: hidden;                      /* 2. Physically forbids scrollbar spawning */
    }
    
    scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }

    .round-tabs::-webkit-scrollbar {
      display: none !important;
      width: 0px !important;
      height: 0px !important;
      -webkit-appearance: none !important;
      background: transparent !important;
    }

    /* 2. The Cards: Fixed 58px height, slam Text to the left wall, slam Pill to the right wall */
    .round-tab { 
      height: 58px; 
      padding: 0 14px; 
      border-radius: 10px; 
      font-size: 12px; 
      font-weight: 600; 
      color: #6B7280; 
      border: 0.5px solid #E5E7EB; 
      background: #fff; 
      cursor: pointer; 
      display: flex; 
      align-items: center; 
      justify-content: space-between; /* <── The magic trick */
      text-align: left; 
      line-height: 1.25; 
      transition: all .15s; 
      box-shadow: 0 1px 2px rgba(0,0,0,.03); 
      box-sizing: border-box;
    }
    .round-tab.active { 
      background: #111827; 
      color: #fff; 
      border-color: #111827; 
      box-shadow: 0 4px 12px rgba(17, 24, 39, 0.12);
    }
    .round-tab:hover:not(.active) { 
      background: #F9FAFB; 
      border-color: #D1D5DB;
    }

    /* 3. The Number Pill: Upgraded from a tiny speck to a uniform 24px badge */
    .tab-count { 
      background: #F3F4F6; 
      color: #374151; 
      font-size: 11px; 
      font-weight: 700; 
      height: 24px;
      min-width: 24px;
      padding: 0 7px; 
      border-radius: 12px; 
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-left: 8px;
    }
    .round-tab.active .tab-count { 
      background: rgba(255, 255, 255, 0.2); 
      color: #fff; 
    }

    .content-area { padding: 10px 32px 32px; display: flex; gap: 24px; align-items: flex-start; }
    .candidates-col { flex: 1; min-width: 0; }
    .detail-panel { width: 420px; flex-shrink: 0; position: sticky; top: 80px; }

    .section-card { background: #fff; border-radius: 12px; border: 0.5px solid #E5E7EB; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
    .section-head { padding: 16px 20px; border-bottom: 0.5px solid #F3F4F6; background: #F9FAFB; }
    .section-head h2 { font-size: 14px; font-weight: 600; color: #111827; margin: 0; }
    .section-head .meta { color: #6B7280; font-size: 11px; margin-top: 2px; }

    .cand-row { padding: 14px 20px; border-bottom: 0.5px solid #F3F4F6; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: background .15s; }
    .cand-row:last-child { border-bottom: none; }
    .cand-row:hover { background: #FAFAFA; }
    .cand-row.selected { background: #FFF7ED; box-shadow: inset 3px 0 0 #F07C2D; }

    .cand-left { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
    .cand-info { flex: 1; min-width: 0; }
    .cand-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

    .av { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
    .av-1 { background: #FFF7ED; color: #EA580C; }
    .av-2 { background: #EFF6FF; color: #2563EB; }
    .av-3 { background: #F5F3FF; color: #7C3AED; }

    .c-name { font-size: 13px; font-weight: 600; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .c-meta { font-size: 11px; color: #6B7280; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badges { display: flex; gap: 5px; margin-top: 5px; flex-wrap: wrap; align-items: center; }
    .badge { font-size: 9px; font-weight: 600; padding: 2px 8px; border-radius: 20px; white-space: nowrap; }
    .b-green  { background: #ECFDF5; color: #059669; }
    .b-blue   { background: #EFF6FF; color: #1D4ED8; }
    .b-yellow { background: #FEF9C3; color: #B45309; }
    .b-orange { background: #FFF7ED; color: #EA580C; }
    .b-gray   { background: #F3F4F6; color: #4B5563; }
    .b-red    { background: #FEF2F2; color: #DC2626; border: 0.5px solid #FCA5A5; }
    .b-purple { background: #F5F3FF; color: #7C3AED; }

    .c-score { text-align: right; flex-shrink: 0; }
    .c-score-num { font-size: 17px; font-weight: 700; color: #F07C2D; line-height: 1; }
    .c-score-lbl { font-size: 9px; color: #9CA3AF; text-transform: uppercase; letter-spacing: .05em; margin-top: 3px; }

    .row-acts { display: flex; gap: 5px; align-items: center; }
    .btn-sm { font-size: 11px; font-weight: 500; padding: 6px 10px; border-radius: 6px; border: 0.5px solid #E5E7EB; background: #fff; color: #374151; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all .15s; font-family: 'Inter', sans-serif; white-space: nowrap; }
    .btn-sm:hover { background: #F9FAFB; }
    .btn-sm.primary { background: #F07C2D; color: #fff; border: none; }
    .btn-sm.primary:hover { background: #EA580C; }
    .btn-sm.danger { color: #DC2626; border-color: #FCA5A5; background: #FEF2F2; }
    .btn-sm.danger:hover { background: #FEE2E2; }
    .btn-sm.success { background: #10B981; color: #fff; border: none; }
    .btn-sm.success:hover { background: #059669; }
    .btn-sm:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-icon { width: 30px; height: 30px; padding: 0; justify-content: center; border-radius: 6px; }

    .det-head { padding: 20px; border-bottom: 0.5px solid #F3F4F6; display: flex; gap: 14px; align-items: flex-start; }
    .det-tabs { display: flex; border-bottom: 0.5px solid #F3F4F6; }
    .det-tab { flex: 1; padding: 12px; text-align: center; font-size: 12px; font-weight: 500; color: #6B7280; cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; transition: color .2s; }
    .det-tab.active { color: #F07C2D; border-bottom-color: #F07C2D; font-weight: 600; }
    .det-body { padding: 20px; max-height: calc(100vh - 300px); overflow-y: auto; }

    .r-prog { display: flex; background: #F9FAFB; border-radius: 10px; padding: 16px 20px; margin-bottom: 24px; align-items: center; border: 0.5px solid #E5E7EB; }
    .rp-step { flex: 1; display: flex; flex-direction: column; align-items: center; position: relative; }
    .rp-step:not(:last-child)::after { content: ''; position: absolute; left: 50%; top: 12px; width: 100%; height: 2px; background: #E5E7EB; z-index: 0; }
    .rp-step.done::after { background: #10B981; }
    .rp-c { width: 26px; height: 26px; border-radius: 50%; background: #E5E7EB; color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; position: relative; z-index: 1; border: 2px solid #fff; }
    .rp-step.done .rp-c { background: #10B981; }
    .rp-step.active .rp-c { background: #F07C2D; box-shadow: 0 0 0 3px rgba(240,124,45,0.2); }
    .rp-l { font-size: 10px; color: #9CA3AF; margin-top: 6px; font-weight: 500; }
    .rp-step.active .rp-l { color: #F07C2D; font-weight: 600; }
    .rp-step.done .rp-l { color: #10B981; }

    .tl { display: grid; gap: 0; }
    .tl-i { display: flex; gap: 14px; padding: 0 0 20px 0; position: relative; }
    .tl-i:last-child { padding-bottom: 0; }
    .tl-i:not(:last-child)::after { content: ''; position: absolute; left: 13px; top: 28px; bottom: 0; width: 2px; background: #E5E7EB; }
    .tl-d { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #fff; position: relative; z-index: 1; }
    .tl-done { background: #10B981; } .tl-fail { background: #DC2626; } .tl-act { background: #F07C2D; } .tl-pen { background: #F3F4F6; color: #9CA3AF; }
    .t-tit { font-size: 13px; font-weight: 500; color: #111827; }
    .t-sub { font-size: 11px; color: #6B7280; margin-top: 2px; }

    .modal-bg { position: fixed; inset: 0; background: rgba(17,24,39,0.45); backdrop-filter: blur(3px); z-index: 999; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .modal { background: #fff; border-radius: 16px; width: 100%; max-width: 560px; box-shadow: 0 25px 40px rgba(0,0,0,0.12); overflow: hidden; display: flex; flex-direction: column; max-height: 92vh; }
    .m-head { padding: 20px 24px 16px; border-bottom: 0.5px solid #E5E7EB; flex-shrink: 0; }
    .m-head h3 { margin: 0; font-size: 16px; font-weight: 600; color: #111827; }
    .m-head p { margin: 4px 0 0; font-size: 12px; color: #6B7280; }
    .m-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
    .m-foot { padding: 14px 24px; border-top: 0.5px solid #E5E7EB; display: flex; justify-content: flex-end; gap: 8px; background: #F9FAFB; flex-shrink: 0; }

    .form-l { font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 6px; display: block; }
    .form-i { width: 100%; padding: 9px 12px; border: 0.5px solid #E5E7EB; border-radius: 8px; font-size: 13px; font-family: inherit; margin-bottom: 14px; outline: none; background: #fff; box-sizing: border-box; }
    .form-i:focus { border-color: #F07C2D; box-shadow: 0 0 0 2px rgba(240,124,45,0.12); }
    select.form-i { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; cursor: pointer; }

    .rating-row { display: flex; gap: 8px; margin-bottom: 16px; }
    .rating-btn { width: 38px; height: 38px; border-radius: 50%; border: 1.5px solid #E5E7EB; background: #fff; color: #374151; font-size: 14px; font-weight: 600; cursor: pointer; transition: all .15s; display: flex; align-items: center; justify-content: center; font-family: 'Inter', sans-serif; }
    .rating-btn.active { background: #F07C2D; color: #fff; border-color: #F07C2D; box-shadow: 0 2px 8px rgba(240,124,45,0.3); }
    .verdict-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .verdict-btn { padding: 12px 8px; border-radius: 8px; border: 1px solid #E5E7EB; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s; font-family: 'Inter', sans-serif; color: #374151; display: flex; flex-direction: column; align-items: center; gap: 4px; line-height: 1.4; text-align: center; }
    .verdict-btn:hover { background: #F9FAFB; }
    .verdict-btn.v-advance { border-color: #10B981; color: #059669; background: #F0FDF4; }
    .verdict-btn.v-reject  { border-color: #EF4444; color: #DC2626; background: #FEF2F2; }
    .verdict-btn.v-advance.v-selected { background: #059669; color: #fff; border-color: #059669; }
    .verdict-btn.v-reject.v-selected  { background: #DC2626; color: #fff; border-color: #DC2626; }

    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes typingDot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }
    .prof-section-label { font-size: 11px; font-weight: 600; color: #6B7280; text-transform: uppercase; margin-bottom: 8px; letter-spacing: .05em; }
    .prof-row { display: flex; justify-content: space-between; border-bottom: 0.5px solid #F3F4F6; padding-bottom: 8px; font-size: 12px; margin-bottom: 4px; }
    .prof-row-label { color: #6B7280; }
    .prof-row-value { font-weight: 500; color: #111827; text-align: right; max-width: 220px; word-break: break-word; }
    .flag-item-red    { font-size: 11px; color: #DC2626; background: #FEF2F2; padding: 6px 10px; border-radius: 6px; }
    .flag-item-yellow { font-size: 11px; color: #B45309; background: #FEF9C3; padding: 6px 10px; border-radius: 6px; }

    .m-section { margin-bottom: 20px; }
    .m-section-title { font-size: 11px; font-weight: 700; color: #9CA3AF; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 0.5px solid #F3F4F6; }

    .fb-card { background: #F9FAFB; border: 0.5px solid #E5E7EB; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
    .fb-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .fb-round-label { font-size: 11px; font-weight: 700; color: #F07C2D; text-transform: uppercase; }
    .fb-verdict-pass { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: #ECFDF5; color: #059669; }
    .fb-verdict-fail { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: #FEF2F2; color: #DC2626; }
    .fb-meta-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
    .fb-meta-item { font-size: 11px; color: #6B7280; }
    .fb-meta-item strong { color: #111827; }
    .fb-notes { font-size: 11px; color: #374151; line-height: 1.5; background: #fff; padding: 8px 10px; border-radius: 6px; border: 0.5px solid #E5E7EB; }

    .shimmer { background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%); background-size: 200% 100%; animation: shimmer 1.2s infinite; border-radius: 6px; }
    @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
  `;

  // ── Question Text Renderer ─────────────────────────────────────────────────
  // Handles all schema patterns Gemini produces:
  //   1. Standalone line: "`TableName` table: col1 (desc), col2 (desc)"
  //   2. Inline mention: "Given a table `Employees` with columns `EmpID` (PK), `Name`, `Dept`"
  //   3. Bold schema block: "**Schema:** ..." or "**TableName:** col, col"
  //   4. Plain SQL code blocks: ```sql ... ```
  const renderQuestionText = (text: string) => {
    if (!text) return null;

    // ── Extract any ```sql ... ``` blocks first, replace with placeholders ──
    const codeBlocks: string[] = [];
    const withPlaceholders = text.replace(/```(?:sql)?\n?([\s\S]*?)```/gi, (_, code) => {
      codeBlocks.push(code.trim());
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    const lines = withPlaceholders.split('\n');
    const elements: React.ReactNode[] = [];

    // ── Try to parse "col (desc), col (desc)" column list ──────────────────
    const parseColumns = (colStr: string) => {
      // Split on comma but not inside parens
      const parts: string[] = [];
      let depth = 0, cur = '';
      for (const ch of colStr) {
        if (ch === '(') { depth++; cur += ch; }
        else if (ch === ')') { depth--; cur += ch; }
        else if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      if (cur.trim()) parts.push(cur.trim());
      return parts.map(p => {
        const m = p.match(/^`?([A-Za-z_][A-Za-z0-9_]*)`?\s*(\([^)]*\)|\b(?:PK|FK|INT|VARCHAR|STRING|TEXT|DATE|BOOL|FLOAT|BIGINT|NVARCHAR)[^,]*)?/i);
        return m ? { name: m[1], desc: (m[2] ?? '').replace(/[()]/g, '').trim() } : { name: p.replace(/`/g, ''), desc: '' };
      }).filter(c => c.name.length > 0);
    };

    const renderTable = (tableName: string, cols: { name: string; desc: string }[], key: number) => (
      <div key={key} style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#374151', padding: '4px 10px', borderRadius: '6px 6px 0 0', display: 'inline-block' }}>
          {tableName}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, background: '#fff', border: '0.5px solid #D1D5DB', borderTop: 'none' }}>
          <thead>
            <tr style={{ background: '#F9FAFB' }}>
              <th style={{ padding: '5px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '0.5px solid #E5E7EB', width: '45%' }}>Column</th>
              <th style={{ padding: '5px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '0.5px solid #E5E7EB' }}>Type / Notes</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((col, ci) => (
              <tr key={ci} style={{ borderBottom: ci < cols.length - 1 ? '0.5px solid #F3F4F6' : 'none' }}>
                <td style={{ padding: '4px 10px', fontWeight: 600, color: '#111827', fontFamily: 'monospace', fontSize: 11 }}>{col.name}</td>
                <td style={{ padding: '4px 10px', color: '#6B7280', fontSize: 11 }}>{col.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

    lines.forEach((rawLine, i) => {
      const line = rawLine.trim();
      if (!line) return;

      // ── Code block placeholder ─────────────────────────────────────────
      const codeMatch = line.match(/__CODE_BLOCK_(\d+)__/);
      if (codeMatch) {
        elements.push(
          <pre key={i} style={{ fontSize: 11, background: '#111827', color: '#E5E7EB', padding: '12px 14px', borderRadius: 6, overflowX: 'auto', lineHeight: 1.6, margin: '6px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {codeBlocks[parseInt(codeMatch[1])]}
          </pre>
        );
        return;
      }

      // ── Pattern 1: standalone table def "`TableName` table: col, col" ──
      const standaloneDef = line.match(/^`?([A-Za-z_][A-Za-z0-9_]*)`?\s+table:\s*(.+)$/i);
      if (standaloneDef) {
        elements.push(renderTable(standaloneDef[1], parseColumns(standaloneDef[2]), i));
        return;
      }

      // ── Pattern 2: "**Schema:**" or "Schema:" header — skip, tables follow
      if (/^(\*\*)?schema:?(\*\*)?$/i.test(line)) return;

      // ── Pattern 3: inline "Given a table `X` with columns `A` (desc), `B` (desc)"
      const inlineMatch = line.match(/(?:given\s+(?:a\s+)?(?:the\s+)?)?(?:table|relation)\s+[`'"]?([A-Za-z_][A-Za-z0-9_]*)[`'"]?\s+(?:with\s+)?(?:columns?|fields?)[:\s]+(.+)/i);
      if (inlineMatch) {
        const tableName = inlineMatch[1];
        const colsPart  = inlineMatch[2];
        const cols      = parseColumns(colsPart);
        if (cols.length >= 2) {
          elements.push(renderTable(tableName, cols, i));
          return;
        }
      }

      // ── Pattern 4: "**TableName** (col1, col2, col3)" bold definition ──
      const boldTableMatch = line.match(/^\*\*([A-Za-z_][A-Za-z0-9_\s]*)\*\*\s*[:\(]\s*(.+)/);
      if (boldTableMatch) {
        const possibleCols = parseColumns(boldTableMatch[2].replace(/[()]/g, ''));
        if (possibleCols.length >= 2) {
          elements.push(renderTable(boldTableMatch[1].trim(), possibleCols, i));
          return;
        }
      }

      // ── Default: plain text, strip stray markdown bold ─────────────────
      const cleanLine = line.replace(/\*\*/g, '');
      elements.push(
        <div key={i} style={{ fontSize: 12, color: '#111827', lineHeight: 1.65, marginBottom: 3 }}>
          {cleanLine}
        </div>
      );
    });

    return <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{elements}</div>;
  };

  // ── Pipeline Progress Bar ──────────────────────────────────────────────────
  const renderPipelineProgress = (round: RoundTab) => (
    <div className="r-prog">
      <div className={`rp-step ${round !== 'round1' ? 'done' : 'active'}`}>
        <div className="rp-c">{round !== 'round1' ? <Check size={13}/> : '1'}</div>
        <div className="rp-l">Round 1</div>
      </div>
      <div className={`rp-step ${round === 'hrround' || round === 'onboarding' ? 'done' : round === 'round2' ? 'active' : ''}`}>
        <div className="rp-c">{round === 'hrround' || round === 'onboarding' ? <Check size={13}/> : '2'}</div>
        <div className="rp-l">Round 2</div>
      </div>
      <div className={`rp-step ${round === 'onboarding' ? 'done' : round === 'hrround' ? 'active' : ''}`}>
        <div className="rp-c">{round === 'onboarding' ? <Check size={13}/> : 'H'}</div>
        <div className="rp-l">HR Round</div>
      </div>
      <div className={`rp-step ${round === 'onboarding' ? 'active' : ''}`}>
        <div className="rp-c">🎉</div>
        <div className="rp-l">Offer</div>
      </div>
    </div>
  );

  // ── Live Timeline from BigQuery ────────────────────────────────────────────
  const renderLiveTimeline = (round: RoundTab) => {
    const tl = feedbackData?.timeline ?? [];

    const getRoundStatus = (roundId: string) => {
      const entry = tl.find((t: any) => t.round?.toLowerCase().trim() === roundId);
      return entry?.status?.toLowerCase().trim() ?? null;
    };

    const r1Status = getRoundStatus('round1');
    const r2Status = getRoundStatus('technical');
    const hrStatus = getRoundStatus('hr');

    const timelineSteps = [
      { label: 'AI Screening Passed',  sub: `AI Score: ${Math.round((selectedCandidate?.final_score ?? 0) * 100)}/100`, done: true,    active: false, failed: false },
      { label: 'HR Shortlisted',       sub: 'Moved to interview pipeline',                                              done: true,    active: false, failed: false },
      { label: 'Round 1 — Technical',
        sub:    r1Status ? `Status: ${r1Status}` : (round === 'round1' ? 'Currently in this stage' : 'Pending'),
        done:   !!r1Status && !['invited', 'scheduled', 'confirmed', 'rejected'].includes(r1Status),
        active: round === 'round1' && (!r1Status || r1Status === 'scheduled' || r1Status === 'confirmed'),
        failed: r1Status === 'rejected' }, // <-- Added failed logic
      { label: 'Round 2 — Advanced',
        sub:    r2Status ? `Status: ${r2Status}` : (round === 'round2' ? 'Currently in this stage' : 'Pending'),
        done:   !!r2Status && !['invited', 'scheduled', 'confirmed', 'rejected'].includes(r2Status),
        active: round === 'round2' && (!r2Status || r2Status === 'scheduled' || r2Status === 'confirmed'),
        failed: r2Status === 'rejected' }, // <-- Added failed logic
      { label: 'HR Round',
        sub:    hrStatus ? `Status: ${hrStatus}` : (round === 'hrround' ? 'Currently in this stage' : 'Pending'),
        done:   !!hrStatus && !['invited', 'scheduled', 'confirmed', 'rejected'].includes(hrStatus),
        active: round === 'hrround' && (!hrStatus || hrStatus === 'scheduled' || hrStatus === 'confirmed'),
        failed: hrStatus === 'rejected' }, // <-- Added failed logic
      { label: 'Onboarding',
        sub:    round === 'onboarding' ? 'Currently in this stage' : 'Pending',
        done:   false,
        active: round === 'onboarding',
        failed: false },
    ];

    return (
      <div className="tl">
        {timelineSteps.map((step, i) => (
          <div key={i} className="tl-i">
            <div className={`tl-d ${step.failed ? 'tl-fail' : step.done ? 'tl-done' : step.active ? 'tl-act' : 'tl-pen'}`}>
              {step.failed ? <X size={13}/> : step.done ? <Check size={13}/> : step.active ? <Clock size={13}/> : i + 1}
            </div>
            <div>
              <div className="t-tit" style={{ color: step.failed ? '#DC2626' : '#111827' }}>{step.label}</div>
              <div className="t-sub">{step.sub}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ── Live Feedback History ──────────────────────────────────────────────────
  const renderFeedbackHistory = () => {
    if (profileLoading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2].map(i => <div key={i} className="shimmer" style={{ height: 80 }} />)}
        </div>
      );
    }

    const feedbacks = selectedCandidate
      ? getVisibleFeedback(selectedCandidate.candidate_id, feedbackData?.feedback ?? [])
      : [];
    
    // 1. Resolve current round ID and human-readable label
    const currentRoundId = activeTab === 'round1' ? 'round1' : activeTab === 'round2' ? 'technical' : 'hr';
    const roundName = activeTab === 'round1' ? 'Round 1 (Technical)' : activeTab === 'round2' ? 'Round 2 (Advanced Technical)' : 'HR Round';
    
    const norm = (s?: string | null) => String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    const roundTimeline = (feedbackData?.timeline ?? []).find((t: any) => norm(t.round) === currentRoundId);
    const st = norm(roundTimeline?.status);

    // 2. Check if interview is scheduled (or completed/feedback submitted)
    const isScheduled = ['scheduled', 'confirmed', 'feedback_submitted', 'advanced', 'completed'].includes(st) || feedbacks.some((fb: any) => norm(fb.round) === currentRoundId);

    // 3. Generate secure frontend token matching backend specification
    const feedbackUrl = selectedCandidate && jobId ? (() => {
      const payload = {
        candidateId: selectedCandidate.candidate_id,
        jobId: jobId,
        round: currentRoundId,
        candidateName: selectedCandidate.name,
        jobTitle: jdTitle,
        skills: [],
        exp: Date.now() + 7 * 24 * 3600 * 1000, // 7-day expiration window
      };
      const token = btoa(encodeURIComponent(JSON.stringify(payload)));
      return `${window.location.origin}/feedback/${token}`;
    })() : '';

    const ROUND_LABELS: Record<string, string> = {
      round1: 'Round 1', technical: 'Round 2', hr: 'HR Round'
    };

    return (
      <div>
        {/* ── NEW: Interviewer Evaluation Link Banner ── */}
        {isScheduled && feedbackUrl ? (
          <div style={{ padding: '12px 16px', background: '#EFF6FF', border: '0.5px solid #BFDBFE', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1E40AF' }}>Interviewer Evaluation Link</div>
              <div style={{ fontSize: 11, color: '#3B82F6', marginTop: 2 }}>Share this link with the assigned interviewer to score &amp; submit feedback for {roundName}.</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => { navigator.clipboard.writeText(feedbackUrl); showToast('Feedback link copied!', 'success'); }}
                style={{ padding: '6px 12px', background: '#fff', border: '0.5px solid #93C5FD', color: '#2563EB', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
              >
                Copy Link
              </button>
              <a
                href={feedbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: '6px 12px', background: '#2563EB', color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 500, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontFamily: 'Inter, sans-serif' }}
              >
                Open Form ↗
              </a>
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px 16px', background: '#FFFBEB', border: '0.5px solid #FDE68A', borderRadius: 8, marginBottom: 16, fontSize: 11, color: '#B45309', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>ℹ️</span> <span>Feedback link will be generated automatically once the interview for this round is scheduled.</span>
          </div>
        )}

        {/* ── Existing Submitted Feedback Cards ── */}
        {feedbacks.length === 0 ? (
          <div style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', padding: '20px 0' }}>
            No feedback submitted yet for this candidate.
          </div>
        ) : (
          feedbacks.map((fb: any, i: number) => (
            <div key={i} className="fb-card">
              <div className="fb-card-head">
                <span className="fb-round-label">{ROUND_LABELS[fb.round] ?? fb.round}</span>
                <span className={fb.verdict === 'advance' ? 'fb-verdict-pass' : 'fb-verdict-fail'}>
                  {fb.verdict === 'advance' ? '✓ Advanced' : '✕ Rejected'}
                </span>
              </div>
              <div className="fb-meta-row">
                <span className="fb-meta-item">Rating: <strong>{fb.rating}/5</strong></span>
                {fb.tech_skill     && <span className="fb-meta-item">Tech: <strong>{fb.tech_skill}</strong></span>}
                {fb.communication  && <span className="fb-meta-item">Comm: <strong>{fb.communication}</strong></span>}
                {fb.interviewer_name && <span className="fb-meta-item">By: <strong>{fb.interviewer_name}</strong></span>}
              </div>
              {fb.notes && <div className="fb-notes">{fb.notes}</div>}
            </div>
          ))
        )}
      </div>
    );
  };
  

  // ── Feedback Modal — READ-ONLY VIEW ────────────────────────────────────────
  const InlineFeedbackModal = ({ cand, onClose }: { cand: TopCandidate; onClose: () => void }) => {
    const { showToast } = useToast();
    const roundLabel     = activeTab === 'round1' ? 'Round 1' : activeTab === 'round2' ? 'Round 2' : 'HR Round';
    const currentRoundId = activeTab === 'round1' ? 'round1'  : activeTab === 'round2' ? 'technical' : 'hr';

    const visibleFeedback = getVisibleFeedback(cand.candidate_id, feedbackData?.feedback ?? []);
    const roundFeedback    = visibleFeedback.filter((fb: any) => fb.round === currentRoundId);
    const allFeedback      = visibleFeedback;

    // Derived booleans
    const hasFeedback    = roundFeedback.length > 0;
    const isHrRound      = activeTab === 'hrround';
    const isHrAdvanced   = isHrRound && (feedbackData?.timeline ?? []).find((t: any) => t.round === 'hr')?.status === 'advanced';
    const isHrSubmitted  = isHrRound && hasFeedback;
    const anyRejection   = allFeedback.some((fb: any) => fb.verdict === 'reject');

    // ── Awaiting Feedback: check secondary badge ───────────────────────────
    const [, currentSecondary] = candidateStatuses[cand.candidate_id] ?? ['Shortlisted', null];
    const isAwaitingFeedback = !hasFeedback && currentSecondary === 'Awaiting Feedback';

    // ── HR Accept email ─────────────────────────────────────────────────────
    const handleHrAcceptEmail = () => {
      const selectionHtml = `
        <div style="font-family: Arial, sans-serif; color: #374151; max-width: 600px;">
          <h2 style="color: #1F2937;">Congratulations — You've Been Selected!</h2>
          <p>Dear <strong>${cand.name}</strong>,</p>
          <p>We are pleased to inform you that you have been selected for the position of <strong>${jdTitle}</strong> at Atgeir Solutions.</p>
          <p>Your skills, experience, and interview performance were impressive, and we are excited about the opportunity to have you join our team.</p>
          <p>Our HR team will soon share the offer letter and onboarding details with you.</p>
          <p style="font-weight: 600; color: #059669;">Congratulations and welcome to Atgeir Solutions!</p>
          <p style="margin-top: 24px;">Best regards,<br/><strong>HR Team — Atgeir Solutions</strong></p>
          <div style="margin-top:16px;padding:10px 14px;background:#F9FAFB;border-radius:6px;border:0.5px solid #E5E7EB;font-size:12px;color:#6B7280;">
            For any queries, please reach out to us at <a href="mailto:support@atgeirsolutions.com" style="color:#2563EB;">support@atgeirsolutions.com</a> or call <strong>+91 020-41292883</strong>.
          </div>
        </div>`;
      EmailService.send({ to: cand.email, subject: `You've Been Selected — ${jdTitle} at Atgeir Solutions`, body: selectionHtml });
      showToast(`Selection confirmation sent to ${cand.name}!`, 'success'); // 👈 ADDED TOAST
      onClose();
    };

    // ── HR Reject email ──────────────────────────────────────────────────────
    const handleHrRejectEmail = () => {
      const rejectHtml = `
        <div style="font-family: Arial, sans-serif; color: #374151; max-width: 600px;">
          <h2 style="color: #1F2937;">Application Update — ${jdTitle}</h2>
          <p>Dear <strong>${cand.name}</strong>,</p>
          <p>Thank you for your time and interest in the <strong>${jdTitle}</strong> position at Atgeir Solutions.</p>
          <p>After careful consideration, we regret to inform you that we will not be moving forward with your application at this time.</p>
          <p>We appreciate the effort you put into the interview process and wish you all the best in your future endeavors.</p>
          <p style="margin-top: 24px;">Best regards,<br/><strong>HR Team — Atgeir Solutions</strong></p>
          <div style="margin-top:16px;padding:10px 14px;background:#F9FAFB;border-radius:6px;border:0.5px solid #E5E7EB;font-size:12px;color:#6B7280;">
            For any queries, please reach out to us at <a href="mailto:support@atgeirsolutions.com" style="color:#2563EB;">support@atgeirsolutions.com</a> or call <strong>+91 020-41292883</strong>.
          </div>
        </div>`;
      EmailService.send({ to: cand.email, subject: `Application Update — ${jdTitle}`, body: rejectHtml });
      showToast(`Rejection email sent to ${cand.name}.`, 'success'); // 👈 ADDED TOAST
      onClose();
    };

    return (
      <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="modal">
          <div className="m-head">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3>{roundLabel} Feedback — {cand.name}</h3>
                <p style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {/* Dynamic status pill in modal header */}
                  {(() => {
                    let label = 'Awaiting Feedback';
                    let bg    = '#FFF7ED';
                    let col   = '#EA580C';
                    if (anyRejection)        { label = 'Rejected';           bg = '#FEF2F2'; col = '#DC2626'; }
                    else if (isHrAdvanced)   { label = 'Offer Stage';        bg = '#ECFDF5'; col = '#059669'; }
                    else if (hasFeedback)    {
                      label = isHrRound
                        ? 'Feedback Received'
                        : currentRoundId === 'round1' ? 'R1 Feedback Received' : 'R2 Feedback Received';
                      bg = '#EFF6FF'; col = '#2563EB';
                    }
                    return (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: bg, color: col }}>
                        {label}
                      </span>
                    );
                  })()}
                  <span style={{ fontSize: 12, color: '#6B7280' }}>
                    {hasFeedback ? 'Submitted by interviewer' : 'Waiting for interviewer to submit'}
                  </span>
                </p>
              </div>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#9CA3AF', lineHeight: 1 }}>✕</button>
            </div>
          </div>

          <div className="m-body">
            {/* ── Awaiting Feedback placeholder ────────────────────────────── */}
            {isAwaitingFeedback && (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                  <Clock size={22} style={{ color: '#EA580C' }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Awaiting Feedback</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>
                  The interviewer hasn't submitted feedback yet for this round.
                </div>
              </div>
            )}

            {/* ── No data at all ───────────────────────────────────────────── */}
            {!isAwaitingFeedback && roundFeedback.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF', fontSize: 13 }}>
                No feedback found for this round.
              </div>
            )}

            {/* ── Feedback cards ───────────────────────────────────────────── */}
            {roundFeedback.map((fb: any, i: number) => (
              <div key={i}>
                {/* Verdict banner — rejection highlighted red */}
                <div style={{
                  padding: '12px 16px', borderRadius: 10, marginBottom: 16,
                  background: fb.verdict === 'advance' ? '#ECFDF5' : '#FEF2F2',
                  border: `1px solid ${fb.verdict === 'advance' ? '#6EE7B7' : '#FCA5A5'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: fb.verdict === 'advance' ? '#059669' : '#DC2626', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {fb.verdict === 'advance'
                      ? '✓ Candidate Advanced to Next Round'
                      : <><span style={{ background: '#DC2626', color: '#fff', borderRadius: 4, padding: '1px 7px', fontSize: 11 }}>REJECTED</span> Candidate Rejected</>
                    }
                  </span>
                  <span style={{ fontSize: 11, color: '#6B7280' }}>
                    {fb.submitted_at ? new Date(fb.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </span>
                </div>

                {/* Ratings grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 6 }}>Overall Rating</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[1,2,3,4,5].map(n => (
                        <div key={n} style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: n <= fb.rating ? '#F07C2D' : '#E5E7EB',
                          color: n <= fb.rating ? '#fff' : '#9CA3AF',
                          fontSize: 11, fontWeight: 600,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>{n}</div>
                      ))}
                    </div>
                  </div>
                  <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 6 }}>Interviewer</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{fb.interviewer_name ?? 'Internal Panel'}</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  {fb.tech_skill && (
                    <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 4 }}>Technical Skills</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{fb.tech_skill}</div>
                    </div>
                  )}
                  {fb.communication && (
                    <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 4 }}>Communication</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{fb.communication}</div>
                    </div>
                  )}
                </div>

                {fb.notes && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Detailed Notes</div>
                    <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, background: '#F9FAFB', padding: '12px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB' }}>
                      {fb.notes}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="m-foot">
            {/* HR already advanced → show offer stage confirmation */}
            {isHrAdvanced && (
              <button
                className="btn-sm success"
                style={{ marginRight: 'auto' }}
                onClick={handleHrAcceptEmail}
              >
                ✉ Resend Selection Email
              </button>
            )}

            <button className="btn-sm primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  };

  
  return (
    <DashboardLayout breadcrumb={`Dashboard / Jobs / ${jdTitle} / Shortlisted / Interview Pipeline`}>
      <style>{css}</style>

      {feedbackModalCand && <InlineFeedbackModal cand={feedbackModalCand} onClose={() => setFeedbackModalCand(null)} />}

      {showGenerateChoiceModal && (
        <GenerateChoiceModal
          onContinue={() => { setShowGenerateChoiceModal(false); goToOfferCopilot(); }}
          onFillSalary={() => { setShowGenerateChoiceModal(false); setShowSalaryModal(true); }}
          onClose={() => { setShowGenerateChoiceModal(false); setPendingOfferTarget(null); }}
        />
      )}
      {showSalaryModal && (
        <SalaryDetailsModal
          rules={salaryRules}
          onChange={(rules) => { setSalaryRules(rules); goToOfferCopilot(rules); }}
          onClose={() => { setShowSalaryModal(false); setPendingOfferTarget(null); }}
        />
      )}
      
      <div className="pipe-container">
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div className="page-title">Interview Process</div>
            <div className="page-sub">{   jdTitle} · {pipelineCandidates.length} candidates in pipeline · Track and manage interview rounds</div>
          </div>
          <button
            onClick={refresh}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fff', color: '#374151', border: '0.5px solid #E5E7EB', borderRadius: '7px', padding: '8px 14px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Inter, sans-serif', flexShrink: 0 }}
          >
            <RefreshCw size={12} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} /> Refresh
          </button>
        </div>

        <div className="round-tabs">
          {(['round1','round2','hrround','onboarding','hired','archived'] as RoundTab[]).map(tab => {
            const labels: Record<RoundTab,string> = {
              round1: 'Round 1 — Technical', round2: 'Round 2 — Advanced',
              hrround: 'HR Round', onboarding: 'Onboarding',
              hired: 'Hired', archived: 'Archived'
            };
            return (
              <button key={tab} className={`round-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
                {labels[tab]} <span className="tab-count">{candidatesByRound[tab].length}</span>
              </button>
            );
          })}
        </div>

        <div className="content-area">
          <div className="candidates-col">
            <div className="section-card">
              <div className="section-head">
                <h2>
                  {activeTab === 'round1' ? 'Round 1 — Technical Interview' :
                   activeTab === 'round2' ? 'Round 2 — Advanced Technical' :
                   activeTab === 'hrround' ? 'HR & Culture Fit' : 'Offer & Onboarding'}
                </h2>
                <div className="meta">Manage candidates currently in this stage</div>
              </div>

              {activeCandidates.length === 0 ? (
                <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                  <Users size={32} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.3 }}/>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>No candidates here yet</div>
                  <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>Move candidates from previous rounds to see them here.</div>
                </div>
              ) : (
                activeCandidates.map((cand, idx) => {
                  const [primary, secondary] = candidateStatuses[cand.candidate_id] ?? ['Shortlisted', null];
                  const ps = STATUS_STYLE[primary]   ?? STATUS_STYLE['Shortlisted'];
                  const ss = secondary ? (STATUS_STYLE[secondary] ?? { bg: '#F3F4F6', color: '#4B5563' }) : null;

                  return (
                    <div
                      key={cand.candidate_id}
                      className={`cand-row ${selectedCandId === cand.candidate_id ? 'selected' : ''}`}
                      onClick={() => setSelectedCandId(cand.candidate_id)}
                      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 }}
                    >
                      {/* LEFT: avatar + info */}
                      <div className="cand-left" style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <div className={`av av-${(idx % 3) + 1}`}>
                          {cand.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                        </div>
                        <div className="cand-info">
                          <div className="c-name">{cand.name}</div>
                          <div className="c-meta">{cand.relevant_exp} yrs · {cand.email}</div>
                          <div className="badges">
                            <span className="badge b-green">AI Pass</span>
                            <span className="badge" style={{ background: ps.bg, color: ps.color }}>{primary}</span>
                            {ss && secondary && (
                              <span className="badge" style={{ background: ss.bg, color: ss.color }}>{secondary}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* RIGHT: score + actions */}
                      <div className="cand-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0, width: '100%' }}>
                        <div className="c-score" style={{ alignSelf: 'flex-end' }}>
                          <div className="c-score-num">{Math.round(cand.final_score * 100)}</div>
                          <div className="c-score-lbl">AI Score</div>
                        </div>

                        {activeTab !== 'onboarding' && (
                          <div className="row-acts" onClick={e => e.stopPropagation()} style={{ display: 'flex', flexWrap: 'nowrap', justifyContent: 'flex-end', gap: 6, width: '100%' }}>
                            
                            {/* --- ADD THIS NEW BUTTON --- */}
                            <button 
                              className="btn-sm" 
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCandId(cand.candidate_id);
                                setDetailTab('pipeline');
                              }}
                              style={
                                selectedCandId === cand.candidate_id 
                                  ? { background: '#FFF7ED', color: '#F07C2D', borderColor: '#F07C2D' } 
                                  : {}
                              }
                            >
                              View Pipeline
                            </button>
                            {/* --------------------------- */}

                            {(activeTab === 'round2' || activeTab === 'hrround') && (
                              <button
                                className="btn-sm"
                                onClick={e => { e.stopPropagation(); setManualCand(cand); }}
                                title="Manual Slot Selection"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#F5F3FF', borderColor: '#DDD6FE', color: '#7C3AED', whiteSpace: 'nowrap' }}
                              >
                                <UserCog size={12} /> Manual Slot
                              </button>
                            )}

                            <button 
                              className="btn-sm danger btn-icon" 
                              onClick={e => e.stopPropagation()} 
                              title="Candidate removal is currently disabled and will resume later if required"
                              disabled={true}
                            >
                              <X size={12}/>
                            </button>
                          </div>
                        )}

                        {activeTab === 'onboarding' && (
                          <div className="row-acts" onClick={e => e.stopPropagation()}>
                            <button
                              className="btn-sm primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingOfferTarget({ cand, jdTitle });
                                setShowGenerateChoiceModal(true);
                              }}
                            >
                              Generate Offer →
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {manualCand && (
            <ManualScheduleModal
              cand={manualCand}
              jobId={jobId!}
              round={activeTab === 'round2' ? 'technical' : 'hr'}
              roundLabel={activeTab === 'round2' ? 'Round 2 (Advanced Technical)' : 'HR Round'}
              onClose={() => setManualCand(null)}
              onSuccess={() => { setManualCand(null); setRefreshKey(k => k + 1); }}
            />
          )}

          {/* ── Detail Panel ──────────────────────────────────────────────── */}
          {selectedCandidate && (
            <div className="detail-panel">
              <div className="section-card" style={activeTab === 'onboarding' ? { display: 'flex', flexDirection: 'column', minHeight: 560 } : {}}>
                <div className="det-head">
                  <div className="av av-1" style={{ width: 48, height: 48, fontSize: 16 }}>
                    {selectedCandidate.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                  </div>
                  <div>
                    <div className="c-name" style={{ fontSize: 15 }}>{selectedCandidate.name}</div>
                    <div className="c-meta">{selectedCandidate.relevant_exp} yrs · {selectedCandidate.email}</div>
                    <div className="badges" style={{ marginTop: 8 }}>
                      <span className="badge b-green">AI Pass: {Math.round(selectedCandidate.final_score * 100)}%</span>
                      <span className="badge b-blue">{activeTab.toUpperCase()}</span>
                      {(() => {
                        const [dp, ds] = candidateStatuses[selectedCandidate.candidate_id] ?? ['Shortlisted', null];
                        const dps = STATUS_STYLE[dp] ?? STATUS_STYLE['Shortlisted'];
                        const dss = ds ? (STATUS_STYLE[ds] ?? { bg: '#F3F4F6', color: '#4B5563' }) : null;
                        return <>
                          <span className="badge" style={{ background: dps.bg, color: dps.color }}>{dp}</span>
                          {dss && ds && <span className="badge" style={{ background: dss.bg, color: dss.color }}>{ds}</span>}
                        </>;
                      })()}
                    </div>
                  </div>
                </div>

                {/* ── Detail tabs (always above content) ──────────────── */}
                <div className="det-tabs">
                  {(activeTab === 'onboarding' 
                    ? ['pipeline', 'offer'] 
                    : (activeTab === 'hired' || activeTab === 'archived')
                      ? ['pipeline', 'feedback', 'profile']
                      : ['pipeline', 'feedback', 'profile', 'questions']
                  ).map(t => (
                    <button 
                      key={t} 
                      className={`det-tab ${detailTab === t ? 'active' : ''}`} 
                      onClick={() => setDetailTab(t as DetailTab)}
                    >
                      {t === 'offer' ? 'Generate Offer' : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>

                {/* TAB: Pipeline */}
                {detailTab === 'pipeline' && (
                  <div className="det-body">
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Activity Timeline</div>
                    {renderLiveTimeline(activeTab)}
                  </div>
                )}

                {/* TAB: Generate Offer (Only in Onboarding) */}
                {detailTab === 'offer' && activeTab === 'onboarding' && (
                  <div className="det-body">
                    <div style={{ marginTop: 28, padding: 20, background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12, textAlign: 'center' }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', fontSize: 20 }}>✦</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>Ready to generate an offer?</div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 18 }}>Open the full-screen AI Copilot to draft and finalise the offer letter.</div>
                      <button
                        onClick={() => {
                          setPendingOfferTarget({ cand: selectedCandidate, jdTitle });
                          setShowGenerateChoiceModal(true);
                        }}
                        style={{ background: '#111827', color: '#fff', padding: '10px 22px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
                      >
                        Open Offer Copilot →
                      </button>
                    </div>
                  </div>
                )}

                {/* TAB: Feedback */}
                {detailTab === 'feedback' && (
                  <div className="det-body">
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Interview Feedback</div>
                    {renderFeedbackHistory()}
                  </div>
                )}

                {/* TAB: Profile */}
                {detailTab === 'profile' && (
                  <div className="det-body">
                    <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
                      <div className="prof-row"><span className="prof-row-label">Experience</span><span className="prof-row-value">{selectedCandidate.relevant_exp} years</span></div>
                      <div className="prof-row"><span className="prof-row-label">Email</span><span className="prof-row-value">{selectedCandidate.email}</span></div>
                      {selectedCandidate.phone && (
                        <div className="prof-row"><span className="prof-row-label">Phone</span><span className="prof-row-value">{selectedCandidate.phone}</span></div>
                      )}
                      <div className="prof-row"><span className="prof-row-label">AI Score</span><span className="prof-row-value" style={{ fontWeight: 700, color: '#F07C2D' }}>{Math.round(selectedCandidate.final_score * 100)} / 100</span></div>
                      <div className="prof-row"><span className="prof-row-label">Similarity Score</span><span className="prof-row-value">{Math.round(selectedCandidate.similarity_score * 100)}%</span></div>
                      <div className="prof-row">
                        <span className="prof-row-label">Must-Have Skills</span>
                        <span className="prof-row-value" style={{ fontWeight: 700, color: selectedCandidate.must_have_pct >= 80 ? '#16a34a' : '#DC2626' }}>
                          {selectedCandidate.must_have_pct}%
                        </span>
                      </div>
                      <div className="prof-row"><span className="prof-row-label">Good-to-Have</span><span className="prof-row-value">{selectedCandidate.good_to_have_pct}%</span></div>
                      <div className="prof-row" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                        <span className="prof-row-label">AI Result</span>
                        <span className="prof-row-value" style={{ fontWeight: 600, color: selectedCandidate.overall_result === 'PASS' ? '#16a34a' : selectedCandidate.overall_result === 'HUMAN_REVIEW' ? '#b45309' : '#DC2626' }}>
                          {selectedCandidate.overall_result}
                        </span>
                      </div>
                    </div>

                    {selectedCandidate.overall_reason && (
                      <div style={{ marginBottom: 20 }}>
                        <div className="prof-section-label">AI Summary</div>
                        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, background: '#F9FAFB', padding: '10px 12px', borderRadius: 8, borderLeft: '3px solid #F07C2D' }}>
                          {selectedCandidate.overall_reason}
                        </div>
                      </div>
                    )}

                    {(selectedCandidate.must_have_missing?.length ?? 0) > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <div className="prof-section-label" style={{ color: '#DC2626' }}>Missing Must-Have Skills</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {selectedCandidate.must_have_missing.map(s => <span key={s} className="badge b-red">{s}</span>)}
                        </div>
                      </div>
                    )}

                    {(selectedCandidate.good_to_have_missing?.length ?? 0) > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <div className="prof-section-label" style={{ color: '#b45309' }}>Missing Good-to-Have</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {selectedCandidate.good_to_have_missing.map(s => <span key={s} className="badge b-yellow">{s}</span>)}
                        </div>
                      </div>
                    )}

                    {((selectedCandidate.failed_rules?.length ?? 0) > 0 || (selectedCandidate.flagged_rules?.length ?? 0) > 0) && (
                      <div style={{ marginBottom: 16 }}>
                        <div className="prof-section-label">Flags &amp; Rules</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {selectedCandidate.failed_rules?.map(r => <div key={r} className="flag-item-red">✗ {r}</div>)}
                          {selectedCandidate.flagged_rules?.map(r => <div key={r} className="flag-item-yellow">⚠ {r}</div>)}
                        </div>
                      </div>
                    )}

                    {selectedCandidate.human_review_reason && (
                      <div>
                        <div className="prof-section-label">Human Review Reason</div>
                        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, background: '#FFFBEB', padding: '10px 12px', borderRadius: 8, borderLeft: '3px solid #b45309' }}>
                          {selectedCandidate.human_review_reason}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB: Questions */}
                {detailTab === 'questions' && (
                  <div className="det-body">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Interview Questions</div>
                        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                          {questionsLoading
                            ? 'Generating AI-tailored questions in the background...'
                            : hasQuestions
                              ? isHrTab ? '5 behavioral questions' : '5 theory + 5 coding questions'
                              : 'Failed to auto-generate. Click generate to try again.'}
                        </div>
                      </div>
                      <button className="btn-sm primary" onClick={generateQuestions} disabled={questionsLoading} style={{ gap: 6, minWidth: 124 }}>
                        {questionsLoading
                          ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
                          : <><span style={{ fontSize: 14 }}>✦</span> {hasQuestions ? 'Regenerate' : 'Generate'}</>}
                      </button>
                    </div>

                    {questionsLoading && (
                      <div style={{ textAlign: 'center', padding: '32px 0', color: '#9CA3AF', fontSize: 12 }}>
                        <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 8px' }} />
                        Crafting questions based on resume &amp; JD…
                      </div>
                    )}

                    {/* ── Theory ───────────────────────────────────────────── */}
                    {!questionsLoading && theoryQuestions.length > 0 && (
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '0.5px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ background: '#EFF6FF', color: '#2563EB', padding: '2px 8px', borderRadius: 20, fontSize: 10 }}>Theory</span>
                          {theoryQuestions.length} questions
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {theoryQuestions.map((q: any, i: number) => (
                            <div key={i} style={{ padding: 14, background: '#F9FAFB', borderRadius: 10, border: '0.5px solid #E5E7EB', borderLeft: '3px solid #2563EB' }}>
                              <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.05em', background: '#EFF6FF', padding: '2px 7px', borderRadius: 20 }}>
                                  {q.type?.replace(/_/g, ' ')}
                                </span>
                                <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: q.difficulty === 'Hard' ? '#FEF2F2' : q.difficulty === 'Medium' ? '#FEF9C3' : '#ECFDF5', color: q.difficulty === 'Hard' ? '#DC2626' : q.difficulty === 'Medium' ? '#B45309' : '#059669' }}>{q.difficulty}</span>
                                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#D1D5DB' }}>T{i + 1}</span>
                              </div>
                              <div style={{ marginBottom: 8 }}>{renderQuestionText(q.question)}</div>
                              <details>
                                <summary style={{ fontSize: 11, color: '#6B7280', cursor: 'pointer', fontWeight: 600, userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 10 }}>▶</span> Ideal Answer
                                </summary>
                                <div style={{ marginTop: 8, fontSize: 11, color: '#374151', lineHeight: 1.65, background: '#fff', padding: '10px 12px', borderRadius: 6, border: '0.5px solid #E5E7EB' }}>
                                  {q.ideal_answer}
                                </div>
                              </details>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Coding ───────────────────────────────────────────── */}
                    {!questionsLoading && codingQuestions.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '0.5px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ background: '#FFF7ED', color: '#EA580C', padding: '2px 8px', borderRadius: 20, fontSize: 10 }}>Coding</span>
                          {codingQuestions.length} problems
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {codingQuestions.map((q: any, i: number) => (
                            <div key={i} style={{ padding: 14, background: '#F9FAFB', borderRadius: 10, border: '0.5px solid #E5E7EB', borderLeft: '3px solid #F07C2D' }}>
                              <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: '#EA580C', textTransform: 'uppercase', letterSpacing: '0.05em', background: '#FFF7ED', padding: '2px 7px', borderRadius: 20 }}>Coding</span>
                                <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: q.difficulty === 'Hard' ? '#FEF2F2' : q.difficulty === 'Medium' ? '#FEF9C3' : '#ECFDF5', color: q.difficulty === 'Hard' ? '#DC2626' : q.difficulty === 'Medium' ? '#B45309' : '#059669' }}>{q.difficulty}</span>
                                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#D1D5DB' }}>C{i + 1}</span>
                              </div>
                              {/* Problem statement with smart schema rendering */}
                              <div style={{ marginBottom: 10 }}>{renderQuestionText(q.question)}</div>
                              <details>
                                <summary style={{ fontSize: 11, color: '#6B7280', cursor: 'pointer', fontWeight: 600, userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 10 }}>▶</span> Solution &amp; Explanation
                                </summary>
                                <div style={{ marginTop: 8 }}>
                                  {q.solution_code && (
                                    <pre style={{ fontSize: 11, background: '#111827', color: '#E5E7EB', padding: '12px 14px', borderRadius: 6, overflowX: 'auto', lineHeight: 1.6, margin: '0 0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                      {q.solution_code}
                                    </pre>
                                  )}
                                  {q.explanation && (
                                    <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.65, background: '#fff', padding: '10px 12px', borderRadius: 6, border: '0.5px solid #E5E7EB' }}>
                                      {q.explanation}
                                    </div>
                                  )}
                                </div>
                              </details>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!questionsLoading && !hasQuestions && (
                      <div style={{ textAlign: 'center', padding: '32px 0', color: '#9CA3AF' }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>✦</div>
                        <div style={{ fontSize: 12 }}>No questions yet.</div>
                        <div style={{ fontSize: 11, marginTop: 4 }}>{isHrTab ? 'Hit Generate for behavioral questions.' : 'Hit Generate for 5 theory + 5 coding questions.'}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}