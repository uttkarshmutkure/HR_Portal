import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { Star, Send, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';

const FONT = 'Inter, sans-serif';

interface TokenPayload {
  candidateId: string;
  jobId: string;
  round: string;
  candidateName: string;
  jobTitle: string;
  exp: number;
}

export default function CandidateReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [meta,        setMeta       ] = useState<TokenPayload | null>(null);
  const [loading,     setLoading    ] = useState(true);
  const [error,       setError      ] = useState<string | null>(null);

  // ── Form State ──
  const [rating,      setRating     ] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [advice,      setAdvice     ] = useState('');
  const [submitting,  setSubmitting ] = useState(false);
  const [submitted,   setSubmitted  ] = useState(false);

  // Unpack Base64 Token
  useEffect(() => {
    try {
      if (!token) throw new Error("No review token provided in URL.");
      const decoded: TokenPayload = JSON.parse(decodeURIComponent(atob(token)));
      
      if (Date.now() > decoded.exp) {
        throw new Error("This interview review link has officially expired.");
      }
      setMeta(decoded);
    } catch (err: any) {
      setError(err.message || "Failed to verify secure candidate token.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meta || rating === 0) return;

    setSubmitting(true);
    try {
      const response = await fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:          'SAVE_CANDIDATE_REVIEW',
          jobId:         meta.jobId,
          candidateId:   meta.candidateId,
          candidateName: meta.candidateName,
          round:         meta.round,
          rating:        rating,
          advice:        advice.trim()
        })
      });

      const res = await response.json();
      if (res.success) {
        setSubmitted(true);
      } else {
        throw new Error(res.error || "Database rejected review submission");
      }
    } catch (err: any) {
      alert(err.message || "A network failure occurred while transmitting.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ padding: 50, textAlign: 'center', fontFamily: FONT, color: '#6B7280' }}>Verifying secure session token...</div>;
  
  if (error || !meta) return (
    <div style={{ maxWidth: 460, margin: '80px auto', padding: 32, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 14, fontFamily: FONT, color: '#991B1B', textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
      <AlertCircle size={38} style={{ margin: '0 auto 12px' }} />
      <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>Session Authentication Failed</h3>
      <p style={{ fontSize: 13, margin: 0, color: '#B91C1C' }}>{error}</p>
    </div>
  );

  if (submitted) return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: 40, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, fontFamily: FONT, textAlign: 'center', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)' }}>
      <CheckCircle2 size={48} style={{ color: '#10B981', margin: '0 auto 16px' }} />
      <h2 style={{ fontSize: 20, color: '#111827', margin: '0 0 8px', letterSpacing: '-0.02em' }}>Thank You, {meta.candidateName.split(' ')[0]}!</h2>
      <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0 }}>
        Your evaluation has been stored securely. We rely heavily on direct feedback from our candidates to continuously improve our hiring workflows.
      </p>
    </div>
  );

  return (
    <div style={{ maxWidth: 520, margin: '60px auto', padding: '0 20px', fontFamily: FONT }}>
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden', boxShadow: '0 10px 30px 0 rgba(0,0,0,0.04)' }}>
        
        {/* Top Branding Banner */}
        <div style={{ background: '#111827', color: '#fff', padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#F07C2D', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            <Sparkles size={13} /> Candidate Experience Audit
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>{meta.jobTitle}</h1>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>Interview Round: <span style={{ color: '#fff', fontWeight: 500 }}>{meta.round.replace('_', ' ').toUpperCase()}</span></div>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 28 }}>
          
          {/* Star Rating Section */}
          <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12, padding: '20px', marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 14, textAlign: 'center' }}>
              How would you rate your interview experience? <span style={{ color: '#DC2626' }}>*</span>
            </label>
            
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4, transition: 'transform 0.1s',
                    transform: (hoverRating || rating) >= star ? 'scale(1.15)' : 'scale(1)'
                  }}
                >
                  <Star
                    size={30}
                    fill={(hoverRating || rating) >= star ? '#F07C2D' : 'none'}
                    color={(hoverRating || rating) >= star ? '#F07C2D' : '#D1D5DB'}
                  />
                </button>
              ))}
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#9CA3AF', marginTop: 10, minHeight: 16 }}>
              {rating === 1 && "1 Star — Poor experience"}
              {rating === 2 && "2 Stars — Below average"}
              {rating === 3 && "3 Stars — Average / Standard"}
              {rating === 4 && "4 Stars — Great experience"}
              {rating === 5 && "5 Stars — Exceptional / Flawless"}
            </div>
          </div>

          {/* Text Advice Section */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
              What is your best advice to help us improve?
            </label>
            <span style={{ display: 'block', fontSize: 11, color: '#6B7280', marginBottom: 10 }}>
              (e.g., Were the technical expectations fair? Was the interviewer punctual and respectful?)
            </span>
            <textarea
              rows={4}
              value={advice}
              onChange={e => setAdvice(e.target.value)}
              placeholder="Share your candid thoughts here..."
              style={{
                width: '100%', padding: 14, borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 13, fontFamily: FONT,
                outline: 'none', boxSizing: 'border-box', background: '#fff', lineHeight: 1.5, color: '#111827'
              }}
              onFocus={e => e.target.style.borderColor = '#F07C2D'}
              onBlur={e => e.target.style.borderColor = '#E5E7EB'}
            />
          </div>

          <button
            type="submit"
            disabled={rating === 0 || submitting}
            style={{
              width: '100%', padding: 14, background: rating === 0 ? '#F3F4F6' : '#F07C2D', color: rating === 0 ? '#9CA3AF' : '#fff',
              border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: rating === 0 ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.15s', fontFamily: FONT
            }}
          >
            <Send size={15} /> {submitting ? "Transmitting Audit..." : "Submit Anonymous Review"}
          </button>
        </form>
      </div>
    </div>
  );
}