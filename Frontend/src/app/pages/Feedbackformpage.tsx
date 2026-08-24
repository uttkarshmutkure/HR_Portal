import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { CheckCircle, XCircle, AlertTriangle, PauseCircle, Star } from 'lucide-react';
import { FeedbackTokenService, FeedbackTokenPayload } from '../../services/feedbackTokenService';
import { EmailService } from '../../services/emailService';

const FONT = 'Inter, sans-serif';

const makeSlotToken = (jobId: string, candidateId: string, candName: string, candEmail: string, round: string) => {
  const raw = `${jobId}::${candidateId}::${round}::slot::${Date.now()}::${encodeURIComponent(candName)}::${encodeURIComponent(candEmail)}`;
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const ROUND_LABELS: Record<string, string> = {
  round1:    'Round 1 (Technical)',
  technical: 'Round 2 (Advanced Technical)',
  hr:        'HR Round',
};

const NEXT_ROUND: Record<string, string | null> = {
  round1:    'technical',
  technical: 'hr',
  hr:        null,
};

const NEXT_ROUND_LABELS: Record<string, string> = {
  technical: 'Round 2 (Advanced Technical)',
  hr:        'HR Round',
};

// --- CSS for Star Animations and Standard Styling ---
const formCss = `
  @keyframes starPop {
    0% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.35); opacity: 0.6; }
    100% { transform: scale(1); opacity: 1; }
  }
  .star-btn {
    transition: transform 0.15s ease-in-out;
  }
  .star-btn:hover {
    transform: scale(1.15);
  }
  .star-pop-active {
    animation: starPop 0.35s ease-out 1;
  }
`;

function StatusScreen({ icon, title, message, color }: { icon: React.ReactNode; title: string; message: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#F9FAFB', fontFamily: FONT, padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 400, background: '#fff', padding: 32, borderRadius: 12, border: '0.5px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <div style={{ width: 50, height: 50, background: color === 'red' ? '#FEF2F2' : color === 'green' ? '#ECFDF5' : color === 'blue' ? '#EFF6FF' : '#FFF7ED', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          {icon}
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 8px' }}>{title}</h2>
        <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.6, margin: 0 }}>{message}</p>
      </div>
    </div>
  );
}

// Helper component for Star Rating Rows
function StarRow({ label, value, onChange }: { label: string, value: number | null, onChange: (v: number) => void }) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const [clickedValue, setClickedValue] = useState<number | null>(null);

  const getLabel = (val: number | null) => {
    if (val === 1) return 'Very Poor';
    if (val === 2) return 'Poor';
    if (val === 3) return 'Average';
    if (val === 4) return 'Good';
    if (val === 5) return 'Excellent';
    return 'Select Rating';
  };

  const displayValue = hoverValue !== null ? hoverValue : value;

  const handleStarClick = (n: number) => {
    onChange(n);
    setClickedValue(n);
    // Reset the click state so the animation can play again if clicked repeatedly
    setTimeout(() => setClickedValue(null), 350); 
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#F9FAFB', borderRadius: 8, border: '0.5px solid #E5E7EB', marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>{label}</span>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 11, color: displayValue ? '#F07C2D' : '#9CA3AF', fontWeight: 600, minWidth: 70, textAlign: 'right' }}>
          {getLabel(displayValue)}
        </span>
        
        <div style={{ display: 'flex', gap: 2 }} onMouseLeave={() => setHoverValue(null)}>
          {[1, 2, 3, 4, 5].map(n => {
            const isActive = displayValue !== null && n <= displayValue;
            const isJustClicked = clickedValue === n;

            return (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHoverValue(n)}
                onClick={() => handleStarClick(n)}
                className={`star-btn ${isJustClicked ? 'star-pop-active' : ''}`}
                style={{
                  background: 'none', border: 'none', padding: 4,
                  cursor: 'pointer', outline: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Star
                  size={20}
                  fill={isActive ? '#F07C2D' : 'transparent'}
                  color={isActive ? '#F07C2D' : '#D1D5DB'}
                  style={{ transition: 'fill 0.15s, color 0.15s' }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function FeedbackFormPage() {
  const { token } = useParams<{ token: string }>();
  const [payload, setPayload]       = useState<FeedbackTokenPayload | null>(null);
  const [tokenError, setTokenError] = useState<'invalid' | 'expired' | 'already_submitted' | null>(null);

  const [techRating, setTechRating] = useState<number | null>(null);
  const [commRating, setCommRating] = useState<number | null>(null);
  const [aptRating, setAptRating]   = useState<number | null>(null);
  const [dbRating, setDbRating]     = useState<number | null>(null);
  const [roleFitRating, setRoleFitRating] = useState<number | null>(null);

  const [notes,         setNotes]         = useState('');
  const [verdict,       setVerdict]       = useState<'advance' | 'reject' | 'hold' | null>(null);
  const [submitting,    setSubmitting]    = useState(false);
  const [submitted,     setSubmitted]     = useState(false);
  const [submitError,   setSubmitError]   = useState('');

  useEffect(() => {
    if (!token) { setTokenError('invalid'); return; }
    const parsed = FeedbackTokenService.parse(token);
    if (!parsed) { setTokenError('invalid'); return; }
    if (FeedbackTokenService.isExpired(parsed)) { setTokenError('expired'); return; }

    fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:        'CHECK_FEEDBACK',
        jobId:       parsed.jobId,
        candidateId: parsed.candidateId,
        round:       parsed.round,
      }),
    })
      .then(res => res.json())
      .then(result => {
        if (result.alreadySubmitted) {
          setTokenError('already_submitted');
        } else {
          setPayload({ ...parsed, skills: parsed.skills || [], candidateEmail: result.candidateEmail || '', candidateName: result.candidateName || parsed.candidateName });
                }
              })
              .catch(() => {
                setPayload({ ...parsed, skills: parsed.skills || [] });
              });
  }, [token]);

  const isTechRound = payload?.round === 'round1' || payload?.round === 'technical';
  const isHrRound   = payload?.round === 'hr';

  let overallRating = 0;
  if (isTechRound) {
    const total = (techRating || 0) + (commRating || 0) + (aptRating || 0) + (dbRating || 0);
    overallRating = total / 4;
  } else if (isHrRound) {
    const total = (roleFitRating || 0) + (aptRating || 0);
    overallRating = total / 2;
  }

  const requiredFilled = isTechRound 
    ? techRating !== null && commRating !== null && aptRating !== null && dbRating !== null
    : isHrRound 
    ? roleFitRating !== null && aptRating !== null 
    : false;

  const canSubmit = requiredFilled && verdict !== null;

  useEffect(() => {
    if (verdict === 'advance' && (!requiredFilled || overallRating < 2.5)) {
      setVerdict(null);
    }
  }, [overallRating, requiredFilled, verdict]);
  // ────────────────────────────────────────────────────────

  if (tokenError === 'invalid') {
    return <StatusScreen icon={<XCircle size={22} color="#DC2626"/>} title="Invalid Link" message="This feedback link is malformed or doesn't exist. Please check the email and try again." color="red" />;
  }
  if (tokenError === 'expired') {
    return <StatusScreen icon={<AlertTriangle size={22} color="#F07C2D"/>} title="Link Expired" message="This feedback link expired after 7 days. Please contact HR to get a new link." color="yellow" />;
  }
  if (tokenError === 'already_submitted') {
    return <StatusScreen icon={<CheckCircle size={22} color="#10B981"/>} title="Already Submitted" message="Feedback for this interview round has already been submitted. Thank you!" color="green" />;
  }
  if (!payload) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#F9FAFB', fontFamily: FONT }}>
        <img src="/company-logo.png" alt="Atgeir Solutions" style={{ height: 32, opacity: 0.5, animation: 'pulse 2s infinite' }} />
      </div>
    );
  }

  if (submitted) {
    const isAdvance = verdict === 'advance';
    const isHold    = verdict === 'hold';
    
    return <StatusScreen
      icon={isAdvance ? <CheckCircle size={22} color="#10B981"/> : isHold ? <PauseCircle size={22} color="#3B82F6"/> : <XCircle size={22} color="#DC2626"/>}
      title={isAdvance ? (isHrRound ? 'Moving to Offer Stage!' : 'Candidate Advanced!') : isHold ? 'Candidate on Hold' : 'Candidate Rejected'}
      message={isAdvance
        ? isHrRound
          ? `${payload.candidateName} has successfully completed all interview rounds and has been moved to the Offer Stage.`
          : `${payload.candidateName} has been moved to the next round. They will receive a slot selection email shortly.`
        : isHold 
        ? `Your feedback has been recorded. ${payload.candidateName} has been placed on hold pending further review.`
        : `Your feedback has been recorded. ${payload.candidateName} has been informed of the outcome.`}
      color={isAdvance ? 'green' : isHold ? 'blue' : 'red'}
    />;
  }

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError('');

    try {
      const res = await fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:          'SAVE_FEEDBACK',
          jobId:         payload.jobId,
          candidateId:   payload.candidateId,
          round:         payload.round,
          rating:        overallRating, 
          techSkill:     techRating,
          communication: commRating,
          aptitude:      aptRating,
          database:      dbRating,
          roleFit:       roleFitRating,
          notes:         notes,
          verdict:       verdict,
        }),
      });

      if (!res.ok) throw new Error(`Failed to save feedback: ${res.status}`);

      const toEmail = (payload as any).candidateEmail || '';

      if (verdict === 'advance') {
        if (isHrRound) {
          // HR round: candidate selected → send selection email
          const selectionHtml = `
            <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
              <div style="background:#F07C2D;padding:24px 28px;">
                <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.02em;">Atgeir Solutions</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">Hiring Team</div>
              </div>
              <div style="padding:28px;">
                <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear <strong>${payload.candidateName}</strong>,</p>
                <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6;">
                  We are thrilled to inform you that you have been <strong>selected</strong> for the position of <strong>${payload.jobTitle}</strong> at Atgeir Solutions!
                </p>
                <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6;">
                  Your skills, experience, and performance throughout the interview process were impressive, and we are excited to have you join our team.
                </p>
                <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
                  Our HR team will be in touch shortly with the offer letter and onboarding details.
                </p>
                <p style="margin:0;font-size:14px;font-weight:600;color:#059669;">Congratulations and welcome to Atgeir Solutions!</p>
                <p style="margin:16px 0 0;font-size:13px;color:#374151;">Best regards,<br><strong>Atgeir Solutions HR Team</strong></p>
                <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;">
                  For any queries, contact us at
                  <a href="mailto:support@atgeirsolutions.com" style="color:#F07C2D;text-decoration:none;font-weight:500;">support@atgeirsolutions.com</a>
                  or call <span style="font-weight:500;color:#6B7280;">+91 020-41292883</span>
                </p>
              </div>
            </div>`;
          await EmailService.send({ to: toEmail, subject: `You've Been Selected — ${payload.jobTitle} at Atgeir Solutions`, body: selectionHtml });
        } else {
          // Other rounds: invite to next round slot selection
          const nextRound = NEXT_ROUND[payload.round];
          if (nextRound) {
            const slotToken = makeSlotToken(payload.jobId, payload.candidateId, payload.candidateName, '', nextRound);
            const slotLink  = `${window.location.origin}/schedule/${slotToken}`;
            const nextLabel = NEXT_ROUND_LABELS[nextRound];
            const emailBody = `
              <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
                <div style="background:#F07C2D;padding:24px 28px;">
                  <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.02em;">Atgeir Solutions</div>
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">Hiring Team</div>
                </div>
                <div style="padding:28px;">
                  <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear <strong>${payload.candidateName}</strong>,</p>
                  <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
                    Congratulations! You've successfully cleared the <strong>${ROUND_LABELS[payload.round]}</strong>.
                    We'd like to invite you to the next stage: <strong>${nextLabel}</strong>.
                  </p>
                  <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
                    Please use the button below to share your availability. You may select up to <strong>three (3)</strong> preferred time slots.
                  </p>
                  <a href="${slotLink}" style="display:inline-block;background:#F07C2D;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:20px;">Select Slots for ${nextLabel}</a>
                  <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">This link is <strong>personal</strong> — please do not share it with others.</p>
                  <p style="margin:16px 0 0;font-size:13px;color:#374151;">Best regards,<br><strong>Atgeir Solutions Hiring Team</strong></p>
                  <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;">
                    For any queries, contact us at
                    <a href="mailto:support@atgeirsolutions.com" style="color:#F07C2D;text-decoration:none;font-weight:500;">support@atgeirsolutions.com</a>
                    or call <span style="font-weight:500;color:#6B7280;">+91 020-41292883</span>
                  </p>
                </div>
              </div>`;
            await EmailService.send({ to: toEmail, subject: `Invitation to ${nextLabel} — ${payload.jobTitle}`, body: emailBody });
          }
        }
      } else if (verdict === 'reject') {
        const rejectHtml = `
          <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
            <div style="background:#111827;padding:24px 28px;">
              <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.02em;">Atgeir Solutions</div>
              <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:2px;">Hiring Team</div>
            </div>
            <div style="padding:28px;">
              <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear <strong>${payload.candidateName}</strong>,</p>
              <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
                Thank you for interviewing for the <strong>${payload.jobTitle}</strong> position at Atgeir Solutions.
                After careful consideration, we regret to inform you that we will not be moving forward at this time.
              </p>
              <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">We appreciate the time you invested and wish you the very best in your career journey.</p>
              <p style="margin:16px 0 0;font-size:13px;color:#374151;">Best regards,<br><strong>Atgeir Solutions Hiring Team</strong></p>
              <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;">
                For any queries, contact us at
                <a href="mailto:support@atgeirsolutions.com" style="color:#F07C2D;text-decoration:none;font-weight:500;">support@atgeirsolutions.com</a>
                or call <span style="font-weight:500;color:#6B7280;">+91 020-41292883</span>
              </p>
            </div>
          </div>`;
        await EmailService.send({ to: toEmail, subject: `Update on your application — ${payload.jobTitle}`, body: rejectHtml });
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const roundLabel = ROUND_LABELS[payload.round] ?? payload.round;

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: FONT, padding: '40px 20px', boxSizing: 'border-box' }}>
      <style>{formCss}</style>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-block', background: '#fff', padding: '10px 20px', borderRadius: 10, border: '0.5px solid #E5E7EB', boxShadow: '0 2px 8px rgba(0,0,0,0.03)', marginBottom: 16 }}>
            <img src="/company-logo.png" alt="Atgeir Solutions Logo" style={{ height: 28, display: 'block' }} />
          </div>
          <h1 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600, color: '#111827', letterSpacing: '-0.01em' }}>Interview Feedback Form</h1>
          <p style={{ margin: 0, fontSize: 12, color: '#6B7280', fontWeight: 500 }}>
            {roundLabel}
          </p>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #E5E7EB', padding: 28, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>

          <div style={{ background: '#FFF7ED', border: '0.5px solid #FFEDD5', borderRadius: 8, padding: '12px 16px', marginBottom: 24, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#EA580C', textTransform: 'uppercase', marginBottom: 2 }}>Candidate</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{payload.candidateName}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#EA580C', textTransform: 'uppercase', marginBottom: 2 }}>Position Target</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{payload.jobTitle}</div>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#111827', display: 'block', marginBottom: 10 }}>
              Performance Metrics <span style={{ color: '#DC2626' }}>*</span>
            </label>

            {isTechRound && (
              <>
                <StarRow label="Communication" value={commRating} onChange={setCommRating} />
                <StarRow label="Technical" value={techRating} onChange={setTechRating} />
                <StarRow label="Aptitude" value={aptRating} onChange={setAptRating} />
                <StarRow label="Database Concepts" value={dbRating} onChange={setDbRating} />
              </>
            )}

            {isHrRound && (
              <>
                <StarRow label="Role Fit & Alignment" value={roleFitRating} onChange={setRoleFitRating} />
                <StarRow label="Aptitude" value={aptRating} onChange={setAptRating} />
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#F3F4F6', borderRadius: 8, border: '0.5px solid #E5E7EB', marginTop: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Overall Rating</span>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>
                {overallRating > 0 ? overallRating.toFixed(1) : '-'} <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 500 }}>/ 5</span>
              </div>
            </div>
          </div>
            
          {(payload.skills?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#111827', display: 'block', marginBottom: 6 }}>Mandatory Job Skills Verified</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {payload.skills.map(s => (
                  <span key={s} style={{ fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 20, background: '#EFF6FF', color: '#1E40AF', border: '0.5px solid #BFDBFE' }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 28 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#111827', display: 'block', marginBottom: 6 }}>Detailed Evaluation Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              placeholder="Provide specific technical insights, strengths, or gaps noticed..."
              style={{ width: '100%', padding: '12px', border: '0.5px solid #E5E7EB', borderRadius: 8, fontSize: 12, fontFamily: FONT, outline: 'none', minHeight: 96, boxSizing: 'border-box', lineHeight: 1.5 }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#111827', display: 'block', marginBottom: 10 }}>
              Final Pipeline Decision <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              
              <button
                type="button"
                onClick={() => setVerdict('advance')}
                disabled={!requiredFilled || overallRating < 2.5}
                // --- ADDED DYNAMIC TOOLTIP ---
                title={
                  !requiredFilled 
                    ? "Please complete all performance metrics first" 
                    : overallRating < 2.5 
                      ? "Deactivated because overall rating is below 2.5" 
                      : isHrRound ? "Move candidate to Offer Stage" : "Advance candidate to the next round"
                }
                style={{
                  padding: '12px 8px', borderRadius: 8, fontFamily: FONT,
                  border: `0.5px solid ${verdict === 'advance' ? '#10B981' : '#E5E7EB'}`,
                  background: verdict === 'advance' ? '#10B981' : '#fff',
                  color: verdict === 'advance' ? '#fff' : '#374151',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transition: 'all .15s',
                  cursor: (!requiredFilled || overallRating < 2.5) ? 'not-allowed' : 'pointer',
                  opacity: (!requiredFilled || overallRating < 2.5) ? 0.4 : 1,
                }}
              >
                <CheckCircle size={18} color={verdict === 'advance' ? '#fff' : '#10B981'} />
                <span style={{ fontSize: 12, fontWeight: 500 }}>{isHrRound ? 'Offer Stage' : 'Advance'}</span>
                
              </button>

              <button
                type="button"
                onClick={() => setVerdict('hold')}
                disabled={!requiredFilled}
                title={!requiredFilled ? "Please complete all performance metrics first" : "Place candidate on hold"}
                style={{
                  padding: '12px 8px', borderRadius: 8, fontFamily: FONT,
                  border: `0.5px solid ${verdict === 'hold' ? '#3B82F6' : '#E5E7EB'}`,
                  background: verdict === 'hold' ? '#3B82F6' : '#fff',
                  color: verdict === 'hold' ? '#fff' : '#374151',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transition: 'all .15s',
                  cursor: !requiredFilled ? 'not-allowed' : 'pointer',
                  opacity: !requiredFilled ? 0.4 : 1,
                }}
              >
                <PauseCircle size={18} color={verdict === 'hold' ? '#fff' : '#3B82F6'} />
                <span style={{ fontSize: 12, fontWeight: 500 }}>Hold</span>
              </button>

              <button
                type="button"
                onClick={() => setVerdict('reject')}
                disabled={!requiredFilled}
                title={!requiredFilled ? "Please complete all performance metrics first" : "Reject candidate"}
                style={{
                  padding: '12px 8px', borderRadius: 8, fontFamily: FONT,
                  border: `0.5px solid ${verdict === 'reject' ? '#DC2626' : '#E5E7EB'}`,
                  background: verdict === 'reject' ? '#DC2626' : '#fff',
                  color: verdict === 'reject' ? '#fff' : '#374151',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transition: 'all .15s',
                  cursor: !requiredFilled ? 'not-allowed' : 'pointer',
                  opacity: !requiredFilled ? 0.4 : 1,
                }}
              >
                <XCircle size={18} color={verdict === 'reject' ? '#fff' : '#DC2626'} />
                <span style={{ fontSize: 12, fontWeight: 500 }}>Reject</span>
              </button>
            </div>
          </div>

          {submitError && (
            <div style={{ background: '#FEF2F2', border: '0.5px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#DC2626' }}>
              {submitError}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            style={{
              width: '100%', padding: '12px', borderRadius: 8,
              background: canSubmit ? '#F07C2D' : '#F9FAFB',
              color: canSubmit ? '#fff' : '#9CA3AF',
              border: canSubmit ? 'none' : '0.5px solid #E5E7EB', // <-- Keep only this border property
              fontSize: 13, fontWeight: 600, fontFamily: FONT,
              cursor: canSubmit ? 'pointer' : 'not-allowed', transition: 'all .2s',
            }}
          >
            {submitting ? 'Processing Submission…' : 'Finalize & Log Feedback'}
          </button>
        </div>
      </div>
    </div>
  );
}