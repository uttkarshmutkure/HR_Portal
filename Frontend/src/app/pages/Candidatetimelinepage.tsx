import { useParams, useLocation, Link } from 'react-router';
import { ArrowLeft, CheckCircle, XCircle, Clock, Mail, Award, Briefcase, MessageSquare } from 'lucide-react';
import DashboardLayout from '../components/layout/DashboardLayout';
import { TopCandidate } from '../../services/screening';
import { FeedbackStore, CandidateRoundState } from '../../services/feedbackStore';

const FONT = 'Inter, sans-serif';

const ROUNDS = [
  { id: 'round1',    label: 'Round 1',  sublabel: 'First Interview'     },
  { id: 'technical', label: 'Round 2',  sublabel: 'Technical Interview' },
  { id: 'hr',        label: 'Round 3',  sublabel: 'HR Round'            },
];

// ── Timeline item (dot + connector + content) ───────────────────────────────────
function TlItem({ dotColor, title, subtitle, badge, badgeBg, badgeColor, isLast }: {
  dotColor: string; title: string; subtitle: string;
  badge?: string; badgeBg?: string; badgeColor?: string; isLast?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: '12px', padding: '10px 16px', borderBottom: isLast ? 'none' : '0.5px solid #F9FAFB', alignItems: 'flex-start' }}>
      {/* Dot + connector */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, flexShrink: 0 }}>
        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: '2px' }} />
        {!isLast && <div style={{ width: '1px', flex: 1, background: '#E5E7EB', marginTop: '3px', minHeight: '24px' }} />}
      </div>
      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, marginLeft: '10px', paddingBottom: '8px' }}>
        <div style={{ fontSize: '12px', fontWeight: 500, color: '#111827', fontFamily: FONT }}>{title}</div>
        <div style={{ fontSize: '10px', color: '#6B7280', fontFamily: FONT, marginTop: '1px' }}>{subtitle}</div>
        {badge && (
          <span style={{ display: 'inline-flex', padding: '1px 7px', borderRadius: '20px', fontSize: '10px', fontWeight: 500, fontFamily: FONT, marginTop: '4px', background: badgeBg, color: badgeColor }}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CandidateTimelinePage() {
  const { jobId, candidateId } = useParams<{ jobId: string; candidateId: string }>();
  const location = useLocation();

  const candidate: TopCandidate | null = location.state?.candidate ?? null;
  const jdTitle: string                = location.state?.jdTitle   ?? jobId ?? '';

  if (!candidate || !jobId) {
    return (
      <DashboardLayout breadcrumb="Dashboard / Candidate Timeline">
        <div style={{ padding: '32px', textAlign: 'center', fontSize: '13px', color: '#9CA3AF', fontFamily: FONT }}>Candidate data not found.</div>
      </DashboardLayout>
    );
  }

  const roundStates = ROUNDS.map(r => ({
    ...r,
    state: FeedbackStore.load(jobId, candidate.candidate_id, r.id) ?? null,
  }));

  const initials   = candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const isRejected = roundStates.some(r => r.state?.status === 'rejected');
  const isHired    = roundStates.every(r => r.state?.status === 'advanced');
  const allGaps    = [...new Set([...candidate.must_have_missing, ...candidate.good_to_have_missing])];

  // Build timeline events from round states
  const timelineEvents: Array<{ dotColor: string; title: string; subtitle: string; badge?: string; badgeBg?: string; badgeColor?: string }> = [
    { dotColor: '#10B981', title: 'Resume uploaded & AI screening completed', subtitle: 'AI automated · Gemini', badge: `AI Score: ${Math.round(candidate.final_score * 100)}/100`, badgeBg: '#ECFDF5', badgeColor: '#065F46' },
    { dotColor: '#10B981', title: 'HR shortlisted candidate',                 subtitle: 'HR decision',            badge: 'Moved to pipeline',                                       badgeBg: '#EFF6FF', badgeColor: '#1E40AF' },
  ];

  roundStates.forEach(r => {
    const s = r.state?.status;
    if (!s || s === 'not_started' || s === 'pending') return;
    if (r.state?.invitedAt) {
      timelineEvents.push({ dotColor: '#F07C2D', title: `${r.label} invite sent`, subtitle: new Date(r.state.invitedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + new Date(r.state.invitedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), badge: 'Email dispatched', badgeBg: '#FFF7ED', badgeColor: '#9A3412' });
    }
    if (r.state?.feedback) {
      const rec = r.state.feedback.recommendation;
      timelineEvents.push({ dotColor: '#10B981', title: `${r.label} feedback submitted by interviewer`, subtitle: r.sublabel, badge: `Recommendation: ${rec === 'advance' ? 'Advance' : 'Reject'}`, badgeBg: rec === 'advance' ? '#ECFDF5' : '#FEF2F2', badgeColor: rec === 'advance' ? '#065F46' : '#991B1B' });
    }
    if (s === 'advanced' && r.id !== 'round1') {
      timelineEvents.push({ dotColor: '#F07C2D', title: `${r.label} — Technical invite sent`, subtitle: 'Awaiting interview', badge: 'Awaiting interview', badgeBg: '#FFF7ED', badgeColor: '#9A3412' });
    }
  });

  // First round with feedback (for right sidebar panel)
  const firstFeedbackRound = roundStates.find(r => r.state?.feedback);

  return (
    <DashboardLayout breadcrumb={`Dashboard / Jobs / ${jdTitle} / Shortlisted / Interview Pipeline / ${candidate.name} / Timeline`}>
      <div style={{ padding: '20px', fontFamily: FONT }}>

        {/* Back + header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 600, color: '#111827', letterSpacing: '-0.02em' }}>Candidate Timeline</div>
            <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>{candidate.name} · {jdTitle}</div>
          </div>
          <Link
            to={`/jobs/${jobId}/pipeline`}
            state={{ jdTitle }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fff', color: '#374151', border: '0.5px solid #E5E7EB', borderRadius: '7px', padding: '8px 14px', fontSize: '12px', fontWeight: 500, fontFamily: FONT, textDecoration: 'none' }}
          >
            <ArrowLeft size={12} /> Back to Pipeline
          </Link>
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '14px', alignItems: 'start' }}>

          {/* Left: Timeline panel */}
          <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', borderBottom: '0.5px solid #F3F4F6' }}>
              <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827', fontFamily: FONT }}>Full activity timeline</span>
            </div>
            {timelineEvents.map((ev, i) => (
              <TlItem
                key={i}
                dotColor={ev.dotColor}
                title={ev.title}
                subtitle={ev.subtitle}
                badge={ev.badge}
                badgeBg={ev.badgeBg}
                badgeColor={ev.badgeColor}
                isLast={i === timelineEvents.length - 1}
              />
            ))}
            {timelineEvents.length === 0 && (
              <div style={{ padding: '10px 16px' }}>
                <TlItem dotColor="#10B981" title="Resume uploaded & AI screening completed" subtitle="AI automated · Gemini" badge={`AI Score: ${Math.round(candidate.final_score * 100)}/100`} badgeBg="#ECFDF5" badgeColor="#065F46" isLast />
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Candidate profile panel */}
            <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ padding: '13px 16px', borderBottom: '0.5px solid #F3F4F6' }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827', fontFamily: FONT }}>Candidate profile</span>
              </div>
              <div style={{ padding: '14px 16px' }}>
                {/* Avatar + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F07C2D', fontSize: '16px', fontWeight: 700, flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', fontFamily: FONT }}>{candidate.name}</div>
                    <div style={{ fontSize: '11px', color: '#6B7280', fontFamily: FONT }}>{candidate.relevant_exp} yrs exp · {candidate.email.split('@')[1] ? 'MH' : ''}</div>
                  </div>
                </div>

                {/* Score + round mini cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  <div style={{ background: '#F9FAFB', borderRadius: '7px', padding: '8px 10px' }}>
                    <div style={{ fontSize: '9px', color: '#9CA3AF', fontFamily: FONT, marginBottom: '2px' }}>AI Score</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#F07C2D', fontFamily: FONT }}>{Math.round(candidate.final_score * 100)}</div>
                  </div>
                  <div style={{ background: '#F9FAFB', borderRadius: '7px', padding: '8px 10px' }}>
                    <div style={{ fontSize: '9px', color: '#9CA3AF', fontFamily: FONT, marginBottom: '2px' }}>Round</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', fontFamily: FONT }}>
                      {roundStates.filter(r => r.state?.status === 'advanced').length + 1} of {ROUNDS.length}
                    </div>
                  </div>
                </div>

                {/* Skills */}
                <div style={{ fontSize: '10px', color: '#9CA3AF', fontFamily: FONT, marginBottom: '5px' }}>Skills</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                  {(candidate.must_have_skills ?? []).slice(0, 3).map(s => (
                    <span key={s} style={{ padding: '1px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 500, background: '#FFF7ED', color: '#9A3412', fontFamily: FONT }}>{s}</span>
                  ))}
                  {(candidate.good_to_have_skills ?? []).slice(0, 2).map(s => (
                    <span key={s} style={{ padding: '1px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 500, background: '#F9FAFB', color: '#6B7280', fontFamily: FONT }}>{s}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Round 1 feedback panel (or whichever round has feedback first) */}
            {firstFeedbackRound && firstFeedbackRound.state?.feedback && (
              <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden' }}>
                <div style={{ padding: '13px 16px', borderBottom: '0.5px solid #F3F4F6' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827', fontFamily: FONT }}>{firstFeedbackRound.label} feedback</span>
                </div>
                <div style={{ padding: '12px 14px' }}>
                  {/* Skill scores grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
                    {firstFeedbackRound.state.feedback.skillRatings.map(sr => (
                      <div key={sr.skill} style={{ background: '#F9FAFB', borderRadius: '6px', padding: '7px 9px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', color: '#6B7280', fontFamily: FONT }}>{sr.skill}</span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#111827', fontFamily: FONT }}>{sr.score}/10</span>
                      </div>
                    ))}
                  </div>
                  {/* Notes */}
                  {firstFeedbackRound.state.feedback.notes && (
                    <>
                      <div style={{ fontSize: '10px', color: '#9CA3AF', fontFamily: FONT, marginBottom: '3px' }}>Notes</div>
                      <div style={{ fontSize: '11px', color: '#374151', fontFamily: FONT, background: '#F9FAFB', borderRadius: '6px', padding: '8px', lineHeight: 1.5 }}>
                        {firstFeedbackRound.state.feedback.notes}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Skill gaps */}
            {allGaps.length > 0 && (
              <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '14px 16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: '#111827', fontFamily: FONT, marginBottom: '10px' }}>Skill Gaps</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {allGaps.map(gap => (
                    <span key={gap} style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 500, background: '#FFF7ED', border: '0.5px solid rgba(240,124,45,0.3)', color: '#9A3412', fontFamily: FONT }}>{gap}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}