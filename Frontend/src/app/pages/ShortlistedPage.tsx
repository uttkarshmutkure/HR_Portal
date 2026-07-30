import { useState, useEffect, useMemo } from 'react';
import { useParams, useLocation, Link } from 'react-router';
import { Users, ArrowLeft, ArrowRight, Eye, Calendar, Loader2, Search } from 'lucide-react';
import DashboardLayout from '../components/layout/DashboardLayout';
import { EmailService } from '../../services/emailService';
import { listJobs } from '../../services/screening';
import { useToast } from '../components/ToastContext';

const FONT = 'Inter, sans-serif';
const DATA_MANAGER_URL = import.meta.env.VITE_DATA_MANAGER_URL;

const AVATAR_COLORS = [
  { bg: '#FFF7ED', color: '#F07C2D' },
  { bg: '#EFF6FF', color: '#3B82F6' },
  { bg: '#F5F3FF', color: '#8B5CF6' },
  { bg: '#ECFDF5', color: '#10B981' },
  { bg: '#FEF2F2', color: '#EF4444' },
];

const makeSlotToken = (jobId: string, cand: any, round: string) => {
  const rawToken = `${jobId}::${cand.candidate_id}::${round}::slot::${Date.now()}::${encodeURIComponent(cand.name)}::${encodeURIComponent(cand.email)}`;
  return btoa(rawToken).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

// ── Schedule Modal ─────────────────────────────────────────────────────────────
const ScheduleModal = ({ cand, jobId, jdTitle, interviewers, onClose, onSuccess }: {
  cand: any; jobId: string; jdTitle: string; interviewers: any[]; onClose: () => void; onSuccess: () => void;
}) => {
  const { showToast } = useToast();
  const [isSending, setIsSending] = useState(false); // <-- Add loading state
  
  const token = useMemo(() => makeSlotToken(jobId, cand, 'round1'), [jobId, cand]);
  const link  = `${window.location.origin}/schedule/${token}`;

  const handleSend = async () => { // <-- Make async
    setIsSending(true);
    
    try {
      // <-- Add await here so the UI waits for BQ to update
      await fetch(DATA_MANAGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'MARK_INVITED', jobId,
          candidateId: cand.candidate_id,
          candidateName: cand.name,
          candidateEmail: cand.email,
          round: 'round1',
        }),
      });

      const htmlBody = `
        <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">

          <!-- Header -->
          <div style="background:#F07C2D;padding:24px 28px;">
            <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.02em;">Atgeir Solutions</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">Hiring Team</div>
          </div>

          <!-- Body -->
          <div style="padding:28px;">
            <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear <strong>${cand.name}</strong>,</p>
            <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
              Following the review of your application for the <strong>${jdTitle}</strong> position, we are pleased to advance you to the interview stage.
            </p>
            <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
              Kindly use the button below to share your availability. You may select up to <strong>three (3)</strong> preferred time slots.
            </p>

            <!-- CTA Button -->
            <a href="${link}" style="display:inline-block;background:#F07C2D;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:20px;">Select Interview Slot</a>

            <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">
              This link is <strong>personal</strong> — please do not share it with others.
            </p>
            <p style="margin:16px 0 0;font-size:13px;color:#374151;">
              Best regards,<br/><strong>Atgeir Solutions Hiring Team</strong>
            </p>
          </div>

          <!-- Support Footer -->
          <div style="padding:0 28px 20px;">
            <p style="margin:0;font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;">
              For any queries, contact us at
              <a href="mailto:support@atgeirsolutions.com" style="color:#F07C2D;text-decoration:none;font-weight:500;">support@atgeirsolutions.com</a>
              or call <span style="font-weight:500;color:#6B7280;">+91 020-41292883</span>
            </p>
          </div>

        </div>
      `;

      EmailService.send({ to: cand.email, subject: `Interview Invitation — ${jdTitle}`, body: htmlBody });
      navigator.clipboard.writeText(link).catch(() => {});
      showToast(`Slot invitation sent to ${cand.name}!`, 'success');
      
      // Trigger refresh only AFTER everything succeeds
      onSuccess(); 
    } catch (err) {
      console.warn('MARK_INVITED failed:', err);
      showToast('Failed to update candidate status.', 'error');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', backdropFilter: 'blur(3px)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', maxHeight: '92vh', boxShadow: '0 25px 40px rgba(0,0,0,0.12)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #E5E7EB', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827', fontFamily: FONT }}>Schedule & Move to Pipeline</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7280', fontFamily: FONT }}>{cand.name} · Round 1 (Technical)</p>
          </div>
          <button onClick={onClose} disabled={isSending} style={{ background: 'none', border: 'none', fontSize: 18, cursor: isSending ? 'not-allowed' : 'pointer', color: '#9CA3AF' }}>✕</button>
        </div>
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, fontFamily: FONT }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Candidate Email Preview</label>
            <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '12px 14px', fontSize: 12, color: '#374151', lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: '#F07C2D', marginBottom: 6 }}>Atgeir Solutions — Hiring Team</div>
              <div>Dear <strong>{cand.name}</strong>,</div>
              <div style={{ marginTop: 6 }}>Following the review of your application for the <strong>{jdTitle}</strong> position, we are pleased to advance you to the interview stage.</div>
              <div style={{ marginTop: 6 }}>Kindly use the button below to share your availability. You may select up to <strong>3</strong> preferred time slots.</div>
              <div style={{ marginTop: 10, display: 'inline-block', background: '#F07C2D', color: '#fff', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>Select Interview Slot</div>
              <div style={{ marginTop: 10, fontSize: 11, color: '#9CA3AF', borderTop: '1px solid #E5E7EB', paddingTop: 8 }}>
                For queries: support@atgeirsolutions.com · +91 020-41292883
              </div>
            </div>
          </div>
          <div style={{ background: '#EFF6FF', border: '0.5px solid #BFDBFE', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#1E40AF' }}>
            📎 Slot selection link will be included in the email automatically.
          </div>
          {interviewers.length === 0 && (
            <div style={{ marginTop: 12, background: '#FFFBEB', border: '0.5px solid #FCD34D', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#B45309' }}>
              ⚠ No interviewers configured for this job. Add interviewers in the Hiring Setup tab first.
            </div>
          )}
        </div>
        <div style={{ padding: '16px 24px', borderTop: '0.5px solid #E5E7EB', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button disabled={isSending} onClick={onClose} style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, fontFamily: FONT, background: '#F9FAFB', color: '#374151', border: '0.5px solid #E5E7EB', borderRadius: 8, cursor: isSending ? 'not-allowed' : 'pointer' }}>Cancel</button>
          
          {/* <-- Add loader and disable logic to button --> */}
          <button disabled={isSending} onClick={handleSend} style={{ padding: '9px 20px', fontSize: 13, fontWeight: 600, fontFamily: FONT, background: '#F07C2D', color: '#fff', border: 'none', borderRadius: 8, cursor: isSending ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: isSending ? 0.7 : 1 }}>
            {isSending && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
            {isSending ? 'Sending...' : 'Send Invite & Move to Pipeline'}
          </button>

        </div>
      </div>
    </div>
  );
};

// ── Candidate Row ──────────────────────────────────────────────────────────────
function CandidateRow({ candidate, rank, jobId, jdTitle, onOpenSchedule }: {
  candidate: any; rank: number; jobId: string; jdTitle: string; onOpenSchedule: (c: any) => void;
}) {
  const avatarStyle = AVATAR_COLORS[rank % AVATAR_COLORS.length];
  const initials    = candidate.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const score       = `${(candidate.final_score * 100).toFixed(0)}%`;

  const isMoved = candidate.candidate_result === 'Interview' || candidate.candidate_result === 'Selected';

  return (
    <div
      style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '14px 16px', borderBottom: '0.5px solid #F9FAFB', position: 'relative' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#FAFAFA'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
    >
      <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: avatarStyle.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: avatarStyle.color, fontSize: '11px', fontWeight: 600, flexShrink: 0, marginTop: '2px' }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0, marginLeft: '1px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
          <span style={{ fontSize: '12px', fontWeight: 500, color: '#111827', fontFamily: FONT }}>{candidate.name}</span>
          
          {/* Only show 'HR Shortlisted' if they haven't been moved yet. Removed AI Pass & In Pipeline */}
          {!isMoved && (
            <span style={{ fontSize: '9px', background: '#EFF6FF', color: '#1E40AF', padding: '1px 6px', borderRadius: '20px', fontWeight: 500 }}>
              HR Shortlisted
            </span>
          )}
        </div>
        
        <div style={{ fontSize: '10px', color: '#6B7280', fontFamily: FONT, marginBottom: '5px' }}>
          {candidate.relevant_exp} yrs · {candidate.email}
        </div>
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          <span style={{ padding: '1px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 500, background: '#FFF7ED', color: '#9A3412' }}>
            Must-Have: {candidate.must_have_pct}%
          </span>
          {(candidate.must_have_missing || []).slice(0, 2).map((s: string) => (
            <span key={s} style={{ padding: '1px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 500, background: '#FEF2F2', color: '#DC2626' }}>{s}</span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', marginLeft: '10px', flexShrink: 0 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#F07C2D', fontFamily: FONT }}>{score}</div>
          <div style={{ fontSize: '9px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: FONT }}>AI score</div>
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <Link
            to={`/jobs/${jobId}/candidates/${candidate.candidate_id}`}
            state={{ candidate, jdTitle }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '10px', fontWeight: 500, fontFamily: FONT, background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '5px', color: '#374151', textDecoration: 'none' }}
          >
            <Eye size={11} /> View
          </Link>
          {isMoved ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '10px', fontWeight: 600, fontFamily: FONT, background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: '5px', color: '#6B7280' }}>
              ✓ Moved
            </span>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onOpenSchedule(candidate); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '10px', fontWeight: 500, fontFamily: FONT, background: '#EFF6FF', border: '0.5px solid #BFDBFE', borderRadius: '5px', color: '#1D4ED8', cursor: 'pointer' }}
            >
              <Calendar size={11} /> Schedule & Move
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ShortlistedPage() {
  const { jobId }   = useParams<{ jobId: string }>();
  const location    = useLocation();
  const { showToast } = useToast();

  const [jdTitle,      setJdTitle     ] = useState<string>(location.state?.jdTitle ?? jobId ?? 'Job');
  const [candidates,   setCandidates  ] = useState<any[]>([]);
  const [interviewers, setInterviewers] = useState<any[]>([]);
  const [loading,      setLoading     ] = useState(true);
  const [scheduleCand, setScheduleCand] = useState<any | null>(null);
  const [refreshKey,   setRefreshKey  ] = useState(0);
  const [searchQuery,  setSearchQuery ] = useState('');

  // Load job title
  useEffect(() => {
    if (jobId && jdTitle === jobId) {
      listJobs().then(jobs => {
        const match = jobs.find(j => j.job_id === jobId);
        if (match?.title) setJdTitle(match.title);
      }).catch(console.error);
    }
  }, [jobId, jdTitle]);

  // Load shortlisted candidates + interviewers from BQ
  useEffect(() => {
    if (!jobId) return;
    setLoading(true);

    Promise.all([
      fetch(DATA_MANAGER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'GET_SHORTLISTED', jobId }),
      }).then(r => r.json()),
      fetch(DATA_MANAGER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'GET_INTERVIEWERS', jobId }),
      }).then(r => r.json()),
    ])
      .then(([candData, invData]) => {
        if (candData.success) setCandidates(candData.candidates || []);
        else showToast('Failed to load shortlisted candidates', 'error');
        if (invData.success) setInterviewers(invData.interviewers || []);
      })
      .catch(err => { console.error(err); showToast('Failed to load data', 'error'); })
      .finally(() => setLoading(false));
  }, [jobId, refreshKey]);

  const filteredCandidates = candidates.filter(c => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q);
  });

  if (!jobId) return <div>Job not found</div>;

  return (
    <DashboardLayout breadcrumb={`Dashboard / Jobs / ${jdTitle} / Shortlisted`}>
      <div style={{ padding: '20px', fontFamily: FONT }}>

        {scheduleCand && (
          <ScheduleModal
            cand={scheduleCand}
            jobId={jobId}
            jdTitle={jdTitle}
            interviewers={interviewers}
            onClose={() => setScheduleCand(null)}
            onSuccess={() => { setScheduleCand(null); setRefreshKey(k => k + 1); }}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 600, color: '#111827', letterSpacing: '-0.02em' }}>Shortlisted Candidates</div>
            <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
              {jdTitle} · {candidates.length} candidates shortlisted
            </div>
          </div>
          {candidates.length > 0 && (
            <Link
              to={`/jobs/${jobId}/pipeline`}
              state={{ jdTitle }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#F07C2D', color: '#fff', borderRadius: '7px', padding: '8px 14px', fontSize: '12px', fontWeight: 500, fontFamily: FONT, textDecoration: 'none' }}
            >
              Go to Interviews <ArrowRight size={12} />
            </Link>
          )}
        </div>

        <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '13px 16px', borderBottom: '0.5px solid #F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827', fontFamily: FONT, flexShrink: 0 }}>Candidates — sorted by AI score</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ position: 'relative', width: '200px' }}>
                <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', pointerEvents: 'none' }} />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search candidates…"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '6px 10px 6px 30px',
                    fontSize: '12px',
                    fontFamily: FONT,
                    borderRadius: '6px',
                    border: '0.5px solid #E5E7EB',
                    outline: 'none',
                    color: '#111827',
                    background: '#fff',
                  }}
                />
              </div>
              <span style={{ fontSize: '10px', color: '#6B7280', fontFamily: FONT, flexShrink: 0 }}>{filteredCandidates.length} total</span>
            </div>
          </div>

          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 20px' }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#F07C2D' }} />
            </div>
          )}

          {!loading && filteredCandidates.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 20px', textAlign: 'center' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#F9FAFB', border: '0.5px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                <Users size={20} style={{ color: '#9CA3AF' }} />
              </div>
              {candidates.length === 0 ? (
                <>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: '#374151', fontFamily: FONT, marginBottom: '4px' }}>No shortlisted candidates yet</div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', fontFamily: FONT, marginBottom: '16px' }}>Go back to results and shortlist candidates to see them here.</div>
                  <Link to={`/jobs/${jobId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '7px', background: '#1D194B', color: '#fff', fontSize: '12px', fontWeight: 500, fontFamily: FONT, textDecoration: 'none' }}>
                    <ArrowLeft size={13} /> Back to Results
                  </Link>
                </>
              ) : (
                <div style={{ fontSize: '13px', fontWeight: 500, color: '#374151', fontFamily: FONT }}>No candidates match your search.</div>
              )}
            </div>
          )}

          {!loading && filteredCandidates.map((candidate, index) => (
            <CandidateRow
              key={candidate.candidate_id}
              candidate={candidate}
              rank={index + 1}
              jobId={jobId}
              jdTitle={jdTitle}
              onOpenSchedule={setScheduleCand}
            />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}