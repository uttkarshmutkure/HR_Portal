import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { CheckCircle, XCircle, AlertTriangle, Star } from 'lucide-react';

const FONT = 'Inter, sans-serif';

// ── Token payload shape, produced by feedback_tool.py's generate_candidate_review_link:
//    base64( urlEncode( JSON.stringify(payload) ) )
//    — same encode/decode pattern already used for feedbackUrl in InterviewPipelinePage.tsx
interface ReviewTokenPayload {
  candidateId: string;
  jobId: string;
  round: string;
  candidateName: string;
  jobTitle: string;
  skills?: string[];
  exp: number;
}

const parseReviewToken = (token: string): ReviewTokenPayload | null => {
  try {
    const json = decodeURIComponent(atob(token));
    const parsed = JSON.parse(json);
    if (!parsed.candidateId || !parsed.jobId || !parsed.round) return null;
    return parsed;
  } catch {
    return null;
  }
};

const isTokenExpired = (payload: ReviewTokenPayload): boolean => {
  if (!payload.exp) return false;
  return Date.now() > payload.exp;
};

const ROUND_LABELS: Record<string, string> = {
  round1:    'Round 1 (Technical)',
  technical: 'Round 2 (Advanced Technical)',
  hr:        'HR Round',
};

// --- CSS for Star Animations and Standard Styling (mirrors FeedbackFormPage) ---
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

// Helper component for Star Rating Rows (same as FeedbackFormPage's StarRow)
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

export default function CandidateReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [payload, setPayload]       = useState<ReviewTokenPayload | null>(null);
  const [tokenError, setTokenError] = useState<'invalid' | 'expired' | 'already_submitted' | null>(null);

  const [processRating, setProcessRating]   = useState<number | null>(null);
  const [clarityRating, setClarityRating]   = useState<number | null>(null);
  const [interviewerRating, setInterviewerRating] = useState<number | null>(null);
  const [overallExpRating, setOverallExpRating]   = useState<number | null>(null);

  const [comments,    setComments]    = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!token) { setTokenError('invalid'); return; }
    const parsed = parseReviewToken(token);
    if (!parsed) { setTokenError('invalid'); return; }
    if (isTokenExpired(parsed)) { setTokenError('expired'); return; }

    fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:        'CHECK_CANDIDATE_REVIEW',
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
          setPayload(parsed);
        }
      })
      .catch(() => {
        // If the check itself fails, don't block the candidate from leaving a review —
        // the backend SAVE step below will be the real source of truth.
        setPayload(parsed);
      });
  }, [token]);

  const overallRating = (() => {
    const vals = [processRating, clarityRating, interviewerRating, overallExpRating].filter((v): v is number => v !== null);
    if (vals.length === 0) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();

  const requiredFilled = processRating !== null && clarityRating !== null && interviewerRating !== null && overallExpRating !== null;
  const canSubmit = requiredFilled;

  if (tokenError === 'invalid') {
    return <StatusScreen icon={<XCircle size={22} color="#DC2626"/>} title="Invalid Link" message="This review link is malformed or doesn't exist. Please check the email and try again." color="red" />;
  }
  if (tokenError === 'expired') {
    return <StatusScreen icon={<AlertTriangle size={22} color="#F07C2D"/>} title="Link Expired" message="This review link has expired. Please contact HR if you'd still like to share your feedback." color="yellow" />;
  }
  if (tokenError === 'already_submitted') {
    return <StatusScreen icon={<CheckCircle size={22} color="#10B981"/>} title="Already Submitted" message="You've already shared your interview experience for this round. Thank you!" color="green" />;
  }
  if (!payload) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#F9FAFB', fontFamily: FONT }}>
        <img src="/company-logo.png" alt="Atgeir Solutions" style={{ height: 32, opacity: 0.5, animation: 'pulse 2s infinite' }} />
      </div>
    );
  }

  if (submitted) {
    return <StatusScreen
      icon={<CheckCircle size={22} color="#10B981"/>}
      title="Thank You!"
      message={`Your feedback on your interview experience for the ${payload.jobTitle} position has been recorded. We appreciate you taking the time to share it.`}
      color="green"
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
          type:              'SAVE_CANDIDATE_REVIEW',
          jobId:             payload.jobId,
          candidateId:       payload.candidateId,
          round:             payload.round,
          rating:            overallRating,
          processRating:     processRating,
          clarityRating:     clarityRating,
          interviewerRating: interviewerRating,
          overallExpRating:  overallExpRating,
          comments:          comments,
        }),
      });

      if (!res.ok) throw new Error(`Failed to save review: ${res.status}`);

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
          <h1 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600, color: '#111827', letterSpacing: '-0.01em' }}>Rate Your Interview Experience</h1>
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
              <div style={{ fontSize: 10, fontWeight: 600, color: '#EA580C', textTransform: 'uppercase', marginBottom: 2 }}>Position</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{payload.jobTitle}</div>
            </div>
          </div>

          <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.6, marginBottom: 20 }}>
            We'd love to hear about your interview experience so we can keep improving our hiring process. This is completely candid — your feedback here doesn't affect your candidacy.
          </p>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#111827', display: 'block', marginBottom: 10 }}>
              Your Experience <span style={{ color: '#DC2626' }}>*</span>
            </label>

            <StarRow label="Communication Before Interview" value={processRating} onChange={setProcessRating} />
            <StarRow label="Clarity of Interview Process" value={clarityRating} onChange={setClarityRating} />
            <StarRow label="Interviewer Professionalism" value={interviewerRating} onChange={setInterviewerRating} />
            <StarRow label="Overall Experience" value={overallExpRating} onChange={setOverallExpRating} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#F3F4F6', borderRadius: 8, border: '0.5px solid #E5E7EB', marginTop: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Average Rating</span>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>
                {overallRating > 0 ? overallRating.toFixed(1) : '-'} <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 500 }}>/ 5</span>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 28 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#111827', display: 'block', marginBottom: 6 }}>Additional Comments (Optional)</label>
            <textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              rows={4}
              placeholder="Anything you'd like us to know — what went well, what could be better..."
              style={{ width: '100%', padding: '12px', border: '0.5px solid #E5E7EB', borderRadius: 8, fontSize: 12, fontFamily: FONT, outline: 'none', minHeight: 96, boxSizing: 'border-box', lineHeight: 1.5 }}
            />
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
              border: canSubmit ? 'none' : '0.5px solid #E5E7EB',
              fontSize: 13, fontWeight: 600, fontFamily: FONT,
              cursor: canSubmit ? 'pointer' : 'not-allowed', transition: 'all .2s',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit Feedback'}
          </button>
        </div>
      </div>
    </div>
  );
}