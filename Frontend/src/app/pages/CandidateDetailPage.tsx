import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router';
import { Phone, Mail, FileText, Check, X, AlertCircle, Download, Loader2, Bot, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import DashboardLayout from '../components/layout/DashboardLayout';
import { TopCandidate, getResumeUrl } from '../../services/screening';
import { ResultsStore } from '../../services/resultsStore';

const FONT = 'Inter, sans-serif';

// ── Unified Flat Panel ─────────────────────────────────────────────────────────
function Panel({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden', marginBottom: '12px' }}>
      <div style={{ padding: '13px 16px', borderBottom: '0.5px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827', fontFamily: FONT }}>{title}</span>
        {badge}
      </div>
      <div style={{ padding: '16px' }}>
        {children}
      </div>
    </div>
  );
}

// ── Score bar ──────────────────────────────────────────────────────────────────
function ScoreBar({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  const pct   = Math.min(value * 100, 100);
  const color = pct >= 70 ? '#10B981' : pct >= 40 ? '#F07C2D' : '#DC2626';
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', color: '#6B7280', fontFamily: FONT }}>{label}</span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827', fontFamily: FONT }}>
          {suffix ?? `${pct.toFixed(0)}%`}
        </span>
      </div>
      <div style={{ height: '5px', borderRadius: '3px', background: '#F3F4F6', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '3px', width: `${pct}%`, background: color, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

// ── Resume Panel ───────────────────────────────────────────────────────────────
function ResumePanel({ candidateId }: { candidateId: string }) {
  const [loading, setLoading] = useState(true);
  const [error,   setError  ] = useState(false);
  const [aiScore, setAiScore] = useState<number | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const resumeUrl = getResumeUrl(candidateId);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(false);
    setAiScore(null);

    fetch(resumeUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

        // 1. Pluck our custom header out of the stream
        const scoreHeader = res.headers.get('X-AI-Generated-Percentage');
        if (scoreHeader !== null && scoreHeader !== 'unknown') {
          const parsed = parseInt(scoreHeader, 10);
          if (!isNaN(parsed)) setAiScore(parsed);
        } else {
          setAiScore(0); // Fallback if header got stripped by a proxy
        }

        // 2. Turn the raw PDF bytes into a local browser URL
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);

        if (isMounted) {
          setBlobUrl(objUrl);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch resume preview:', err);
        if (isMounted) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl); // Prevent browser memory leaks
    };
  }, [resumeUrl]);

  // Color logic: For AI detection, Low % is Good (Green), High % is Bad (Red)
  const getScoreTheme = (score: number) => {
    if (score <= 25) return { bg: '#ECFDF5', text: '#065F46', border: '#D1FAE5' }; // Safe
    if (score <= 65) return { bg: '#FFFBEB', text: '#B45309', border: '#FEF3C7' }; // Warning
    return                  { bg: '#FEF2F2', text: '#991B1B', border: '#FEE2E2' }; // Danger
  };

  const theme = aiScore !== null ? getScoreTheme(aiScore) : null;

  return (
    <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden', position: 'sticky', top: '20px' }}>
      <div style={{ padding: '13px 16px', borderBottom: '0.5px solid #F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827', fontFamily: FONT }}>Resume Document</span>
        
        {/* Container holding the new Score Badge + Download Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          
          {!loading && aiScore !== null && theme && (
            <div 
              title="Estimated probability this resume was written by an LLM"
              style={{
                display: 'flex', 
                alignItems: 'center', 
                gap: '4px',
                padding: '3px 8px', 
                borderRadius: '12px', 
                fontSize: '11px', 
                fontWeight: 600,
                background: theme.bg,
                color: theme.text,
                border: `0.5px solid ${theme.border}`,
                fontFamily: FONT,
                cursor: 'help'
              }}
            >
              <Bot size={12} />
              <span>{aiScore}% AI</span>
            </div>
          )}

          <a
            href={resumeUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: '#F9FAFB', border: '0.5px solid #E5E7EB', color: '#374151', fontFamily: FONT, textDecoration: 'none' }}
          >
            <Download size={11} /> Download
          </a>
        </div>
      </div>

      <div 
        style={{ 
          position: 'relative', 
          height: '800px', 
          background: '#F9FAFB', 
          overflow: 'hidden' // <── The chopping block
        }}
      >
        {loading && !error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <Loader2 size={20} style={{ color: '#F07C2D', animation: 'spin 1s linear infinite', marginBottom: '8px' }} />
            <p style={{ fontSize: '12px', color: '#9CA3AF', fontFamily: FONT }}>Analyzing document…</p>
          </div>
        )}

        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <FileText size={32} style={{ color: '#D1D5DB', marginBottom: '12px' }} />
            <p style={{ fontSize: '12px', color: '#9CA3AF', fontFamily: FONT, marginBottom: '14px' }}>Preview unavailable</p>
            <a href={resumeUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, background: '#1D194B', color: '#fff', fontFamily: FONT, textDecoration: 'none' }}>
              Open directly
            </a>
          </div>
        )}

        {blobUrl && !error && (
          <object
            data={`${blobUrl}#view=FitH&toolbar=0`}
            type="application/pdf"
            style={{
              width: '100%',
              height: 'calc(100% + 22px)', /* 1. Stretch it 22px past the bottom */
              marginBottom: '-22px',       /* 2. Yank the layout floor back up */
              border: 'none',
              overflow: 'hidden'
            }}
            onLoad={() => setLoading(false)}
          >
            {/* Fallback triggered if user is on a browser without a PDF reader */}
            <div style={{ padding: '30px', textAlign: 'center' }}>
              <p style={{ fontSize: '12px', color: '#6B7280', fontFamily: FONT, marginBottom: '10px' }}>Unable to embed PDF preview.</p>
              <a href={resumeUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 12px', background: '#F07C2D', color: '#fff', borderRadius: '6px', fontSize: '11px', textDecoration: 'none', fontFamily: FONT }}>Download PDF</a>
            </div>
          </object>
        )}
      </div>
    </div>
  );
}

// ── AI Key Notes Accordion ─────────────────────────────────────────────────────
function ResumeNotesDropdown({ jobId, candidateId }: { jobId: string; candidateId: string }) {
  const [isOpen, setIsOpen]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [notes, setNotes]     = useState<{
    summary?: string;
    top_skills?: string[];
    education?: string;
    key_experience?: string[];
  } | null>(null);

  const handleToggle = async () => {
    if (notes || loading) {
      setIsOpen(!isOpen);
      return;
    }

    setIsOpen(true);
    setLoading(true);
    setError(null);

    try {
      const DATA_MANAGER_URL = import.meta.env.VITE_DATA_MANAGER_URL;
      const res = await fetch(DATA_MANAGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'GET_RESUME_KEY_NOTES', jobId, candidateId }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to extract notes');

      setNotes(data.notes);
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: '#fff', border: isOpen ? '1px solid #F07C2D' : '0.5px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden', marginBottom: '12px', transition: 'border-color .2s' }}>
      
      {/* Clickable Header Bar */}
      <div 
        onClick={handleToggle}
        style={{ padding: '13px 16px', background: isOpen ? '#FFF7ED' : '#fff', borderBottom: isOpen ? '0.5px solid #FED7AA' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background .15s' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={15} style={{ color: '#F07C2D' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827', fontFamily: FONT }}>AI Resume Key Notes</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!notes && !loading && (
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#C2540A', background: '#FFEDD5', padding: '2px 8px', borderRadius: '12px' }}>
              Click to Generate
            </span>
          )}
          {isOpen ? <ChevronUp size={16} color="#9CA3AF" /> : <ChevronDown size={16} color="#9CA3AF" />}
        </div>
      </div>

      {/* Expandable Body */}
      {isOpen && (
        <div style={{ padding: '16px', animation: 'fadeIn 0.2s ease-in-out' }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#6B7280', fontSize: '12px', padding: '10px 0' }}>
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite', color: '#F07C2D' }} />
              <span>Scanning raw text database & summarizing…</span>
            </div>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#DC2626', fontSize: '12px' }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {notes && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {notes.summary && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Executive Summary</div>
                  <p style={{ fontSize: '12px', color: '#374151', lineHeight: 1.55, margin: 0 }}>{notes.summary}</p>
                </div>
              )}

              {notes.top_skills && notes.top_skills.length > 0 && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Core Competencies</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {notes.top_skills.map((sk, i) => (
                      <span key={i} style={{ fontSize: '11px', fontWeight: 500, background: '#EFF6FF', color: '#1D4ED8', padding: '2px 9px', borderRadius: '4px', border: '0.5px solid #BFDBFE' }}>{sk}</span>
                    ))}
                  </div>
                </div>
              )}

              {notes.education && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Education</div>
                  <div style={{ fontSize: '12px', fontWeight: 500, color: '#111827' }}>🎓 {notes.education}</div>
                </div>
              )}

              {notes.key_experience && notes.key_experience.length > 0 && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Key Career Highlights</div>
                  <ul style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {notes.key_experience.map((kp, i) => (
                      <li key={i} style={{ fontSize: '12px', color: '#374151', lineHeight: 1.45 }}>{kp}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CandidateDetailPage() {
  const { jobId, candidateId } = useParams<{ jobId: string; candidateId: string }>();
  const location  = useLocation();
  const navigate  = useNavigate();

  // Robust Loading
  const [candidate, setCandidate] = useState<TopCandidate | null>(location.state?.candidate ?? null);
  const jdTitle: string = (location.state?.jdTitle ?? jobId ?? '').trim();

  useEffect(() => {
    if (!candidate && jobId && candidateId) {
      const result = ResultsStore.load(jobId);
      if (result) {
        const allCandidates = [...result.top_candidates, ...result.all_passed, ...result.all_human_review, ...result.all_failed];
        const found = allCandidates.find(c => c.candidate_id === candidateId);
        if (found) setCandidate(found);
      }
    }
  }, [jobId, candidateId, candidate]);

  if (!candidate) {
    return (
      <DashboardLayout breadcrumb="Dashboard / Jobs / Candidate">
        <div style={{ padding: '40px', textAlign: 'center', fontSize: '13px', color: '#6B7280', fontFamily: FONT }}>
          Candidate data not found. Return to the job list.
        </div>
      </DashboardLayout>
    );
  }

  const allGaps = [...new Set([
    ...(candidate.must_have_missing || []), 
    ...(candidate.good_to_have_missing || [])
  ])];

  const failed = candidate.failed_rules || [];
  const flagged = candidate.flagged_rules || [];

  const rulesCheck = [
    { name: 'Experience',    status: failed.includes('experience')     ? 'fail' : flagged.includes('experience')     ? 'review' : 'pass' },
    { name: 'Must Have',     status: failed.includes('must_have')      ? 'fail' : flagged.includes('must_have')      ? 'review' : 'pass' },
    { name: 'Location',      status: failed.includes('location')       ? 'fail' : flagged.includes('location')       ? 'review' : 'pass' },
    { name: 'Last Org',      status: failed.includes('last_org')       ? 'fail' : flagged.includes('last_org')       ? 'review' : 'pass' },
    { name: 'Emp. Gap',      status: failed.includes('employment_gap') ? 'fail' : flagged.includes('employment_gap') ? 'review' : 'pass' },
    { name: 'Qualification', status: failed.includes('qualification')  ? 'fail' : flagged.includes('qualification')  ? 'review' : 'pass' },
  ];

  const qTypeColor: Record<string, string> = {
    skill_based: '#F07C2D', validation: '#3B82F6', technical: '#10B981', behavioural: '#8B5CF6',
  };

  const initials    = candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const resultStyle =
    candidate.overall_result === 'PASS'         ? { bg: '#ECFDF5',  color: '#065F46' } :
    candidate.overall_result === 'HUMAN_REVIEW' ? { bg: '#FFFBEB', color: '#B45309' } :
                                                  { bg: '#FEF2F2', color: '#991B1B' };

  return (
    <DashboardLayout breadcrumb={`Dashboard / Jobs${jdTitle ? ` / ${jdTitle}` : ''} / ${candidate.name}`}>
      <div style={{ padding: '20px', fontFamily: FONT }}>

        {/* ── Close button — top right corner ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
          <button
            onClick={() => navigate(-1)}
            title="Go back"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32,
              borderRadius: '8px',
              border: '0.5px solid #E5E7EB',
              background: '#fff',
              cursor: 'pointer',
              color: '#6B7280',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = '#FEF2F2';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#FCA5A5';
              (e.currentTarget as HTMLButtonElement).style.color = '#DC2626';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = '#fff';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#E5E7EB';
              (e.currentTarget as HTMLButtonElement).style.color = '#6B7280';
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: '14px', alignItems: 'start' }}>

          {/* ── Left column ── */}
          <div>
            {/* Clean Profile Header */}
            <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '20px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '10px', background: '#F9FAFB', border: '0.5px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: '16px', fontWeight: 600, fontFamily: FONT, flexShrink: 0 }}>
                  {initials}
                </div>
                <div>
                  <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', fontFamily: FONT, letterSpacing: '-0.02em', marginBottom: '4px' }}>{candidate.name}</h1>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: '#6B7280', fontFamily: FONT }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Mail size={12} /> {candidate.email}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Phone size={12} /> {candidate.phone}</span>
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#F07C2D', fontFamily: FONT, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '4px' }}>
                  {(candidate.final_score * 100).toFixed(0)}%
                </div>
                <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, fontFamily: FONT, ...resultStyle }}>
                  {candidate.overall_result === 'HUMAN_REVIEW' ? 'REVIEW' : candidate.overall_result}
                </span>
              </div>
            </div>

            <ResumeNotesDropdown 
              jobId={jobId ?? ''} 
              candidateId={candidate.candidate_id} 
            />

            {/* Score Breakdown */}
            <Panel title="Score Breakdown">
              <ScoreBar label="Similarity Score"    value={candidate.similarity_score} />
              <ScoreBar label="Must Have Skills"    value={candidate.must_have_pct / 100} />
              <ScoreBar label="Good to Have Skills" value={candidate.good_to_have_pct / 100} />
              <ScoreBar label="Relevant Experience" value={Math.min(candidate.relevant_exp / 10, 1)} suffix={`${candidate.relevant_exp} yrs`} />
            </Panel>

            {/* Rules Check */}
            <Panel title="Rules Evaluation">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {rulesCheck.map(rule => (
                  <div key={rule.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: '8px', background: '#F9FAFB', border: '0.5px solid #E5E7EB' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {rule.status === 'pass'   ? <Check       size={14} style={{ color: '#10B981' }} /> :
                       rule.status === 'fail'   ? <X           size={14} style={{ color: '#DC2626' }} /> :
                                                  <AlertCircle size={14} style={{ color: '#F59E0B' }} />}
                      <span style={{ fontSize: '12px', fontWeight: 500, color: '#374151', fontFamily: FONT }}>{rule.name}</span>
                    </div>
                    <span style={{
                      fontSize: '10px', fontWeight: 600, fontFamily: FONT,
                      ...(rule.status === 'pass'   ? { color: '#10B981' } :
                          rule.status === 'fail'   ? { color: '#DC2626' } :
                                                     { color: '#F59E0B' }),
                    }}>
                      {rule.status === 'pass' ? 'PASS' : rule.status === 'fail' ? 'FAIL' : 'FLAG'}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Skill Gaps */}
            <Panel title="Identified Skill Gaps">
              {allGaps.length === 0
                ? <p style={{ fontSize: '12px', color: '#10B981', fontFamily: FONT }}>✓ Perfect match. No skill gaps identified.</p>
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {allGaps.map(gap => (
                      <span key={gap} style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: '#FFF7ED', border: '0.5px solid rgba(240,124,45,0.2)', color: '#C2540A', fontFamily: FONT }}>{gap}</span>
                    ))}
                  </div>
              }
            </Panel>

            {/* Interview Questions */}
            <Panel title="AI-Suggested Interview Questions" badge={<span style={{ fontSize: '10px', color: '#9CA3AF' }}>{(candidate.questions ?? []).length} questions</span>}>
              {(candidate.questions ?? []).length === 0
                ? <p style={{ fontSize: '12px', color: '#9CA3AF', fontFamily: FONT }}>No questions generated for this candidate.</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {(candidate.questions ?? []).map((q, i) => (
                      <div key={i} style={{ padding: '12px 14px', borderRadius: '8px', background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderLeft: `3px solid ${qTypeColor[q.type] ?? '#E5E7EB'}` }}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 600, color: '#fff', background: qTypeColor[q.type] ?? '#9CA3AF', fontFamily: FONT, marginBottom: '6px', letterSpacing: '0.04em' }}>
                          {q.type.replace('_', ' ').toUpperCase()}
                        </span>
                        <p style={{ fontSize: '12px', lineHeight: 1.6, color: '#374151', fontFamily: FONT }}>{q.question}</p>
                      </div>
                    ))}
                  </div>
              }
            </Panel>
          </div>

          {/* ── Right column: Resume ── */}
          <div>
            <ResumePanel candidateId={candidate.candidate_id} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}