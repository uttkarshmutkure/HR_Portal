import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { ArrowRight, Users, GitMerge, Clock, MessageSquare, Loader2, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import DashboardLayout from '../components/layout/DashboardLayout';
import { listJobs, JobSummary } from '../../services/screening';

const FONT = 'Inter, sans-serif';

// ── Types ──────────────────────────────────────────────────────────────────────
interface FeedbackItem {
  job:              JobSummary;
  candidate:        { candidate_id: string; name: string; email: string };
  round:            string;
  rating:           number | null;
  tech_skill:       string | null;
  communication:    string | null;
  notes:            string | null;
  verdict:          string | null;
  interviewer_name: string | null;
  submitted_at:     string | null;
}

// ── 1. Global Shortlisted Hub ──────────────────────────────────────────────────
export function GlobalShortlistedPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const loadData = async () => {
      try {
        const fetchedJobs = await listJobs();
        const activeJobs = fetchedJobs.filter(j => j.status.toLowerCase() === 'active');
        setJobs(fetchedJobs);

        // Fetch actual counts from BigQuery for each active job
        const newCounts: Record<string, number> = {};
        await Promise.all(
          activeJobs.map(async (job) => {
            try {
              const res = await fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'GET_SHORTLISTED', jobId: job.job_id }),
              });
              if (res.ok) {
                const data = await res.json();
                newCounts[job.job_id] = data.candidates?.length || 0;
              } else {
                newCounts[job.job_id] = 0;
              }
            } catch {
              newCounts[job.job_id] = 0;
            }
          })
        );
        setCounts(newCounts);
      } catch (e) {
        console.error("Failed to load jobs", e);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, []);

  return (
    <DashboardLayout breadcrumb="Dashboard / Shortlisted Candidates">
      <div style={{ padding: '20px', fontFamily: FONT, maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', letterSpacing: '-0.02em' }}>Shortlisted Candidates</h1>
          <p style={{ fontSize: '13px', color: '#6B7280', marginTop: '4px' }}>Shortlists are managed per-job. Select a job below to view its shortlisted candidates.</p>
        </div>

        {loading ? <Loader2 size={24} style={{ color: '#F07C2D', animation: 'spin 1s linear infinite' }} /> : (
          <div style={{ display: 'grid', gap: '12px' }}>
            {jobs.filter(j => j.status.toLowerCase() === 'active').map(job => {
              const count = counts[job.job_id] || 0; 
              return (
                <Link
                  key={job.job_id}
                  to={`/jobs/${job.job_id}/shortlisted`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '12px', textDecoration: 'none', transition: 'all 0.2s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#F07C2D'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#E5E7EB'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Users size={18} color="#F07C2D" />
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>{job.title}</div>
                      <div style={{ fontSize: '12px', color: '#6B7280' }}>{job.location}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>{count}</div>
                      <div style={{ fontSize: '10px', color: '#6B7280', textTransform: 'uppercase' }}>Shortlisted</div>
                    </div>
                    <ArrowRight size={16} color="#9CA3AF" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// ── 2. Global Interviews Pipeline Hub ──────────────────────────────────────────
export function GlobalInterviewsPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);

  useEffect(() => { listJobs().then(setJobs); }, []);

  return (
    <DashboardLayout breadcrumb="Dashboard / Interview Pipelines">
      <div style={{ padding: '20px', fontFamily: FONT, maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', letterSpacing: '-0.02em' }}>Interview Pipelines</h1>
          <p style={{ fontSize: '13px', color: '#6B7280', marginTop: '4px' }}>Select an active job to manage its interview stages and send invites.</p>
        </div>

        <div style={{ display: 'grid', gap: '12px' }}>
          {jobs.filter(j => j.status.toLowerCase() === 'active').map(job => (
            <Link
              key={job.job_id}
              to={`/jobs/${job.job_id}/pipeline`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '12px', textDecoration: 'none', transition: 'all 0.2s' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#3B82F6'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#E5E7EB'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <GitMerge size={18} color="#3B82F6" />
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>{job.title}</div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Active Pipeline</div>
                </div>
              </div>
              <ArrowRight size={16} color="#9CA3AF" />
            </Link>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}

// ── 3. Global Timeline Hub ─────────────────────────────────────────────────────
export function GlobalTimelinePage() {
  const navigate = useNavigate();
  return (
    <DashboardLayout breadcrumb="Dashboard / Timelines">
      <div style={{ padding: '60px 20px', fontFamily: FONT, display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '14px', padding: '40px', textAlign: 'center', maxWidth: '440px', width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: '#F5F3FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Clock size={28} style={{ color: '#8B5CF6' }} />
          </div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginBottom: '10px' }}>Timelines are Candidate-Specific</h2>
          <p style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.6, marginBottom: '24px' }}>To view a full activity history, please navigate to an Interview Pipeline and select a specific candidate's timeline.</p>
          <button onClick={() => navigate('/interviews')} style={{ padding: '10px 20px', borderRadius: '8px', background: '#1D194B', color: '#fff', fontSize: '13px', fontWeight: 500, border: 'none', cursor: 'pointer' }}>Go to Pipelines</button>
        </div>
      </div>
    </DashboardLayout>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────────
const ROUND_LABELS: Record<string, string> = {
  round1:    'Round 1',
  technical: 'Round 2',
  hr:        'HR Round',
};

const ROUND_STYLE: Record<string, { bg: string; color: string }> = {
  round1:    { bg: '#FFF7ED', color: '#EA580C' },
  technical: { bg: '#EFF6FF', color: '#2563EB' },
  hr:        { bg: '#F5F3FF', color: '#7C3AED' },
};

const AV_COLORS = [
  { bg: '#FFF7ED', color: '#EA580C' },
  { bg: '#EFF6FF', color: '#2563EB' },
  { bg: '#F5F3FF', color: '#7C3AED' },
  { bg: '#ECFDF5', color: '#059669' },
];

function getAvColor(name: string) {
  return AV_COLORS[name.charCodeAt(0) % AV_COLORS.length];
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// ── Rating dots ────────────────────────────────────────────────────────────────
function RatingDots({ rating }: { rating: number }) {
  return (
    <div style={{ display: 'flex', gap: '3px' }}>
      {[1, 2, 3, 4, 5].map(n => (
        <div key={n} style={{
          width: '18px', height: '18px', borderRadius: '50%',
          background: n <= rating ? '#F07C2D' : '#F3F4F6',
          color: n <= rating ? '#fff' : '#9CA3AF',
          fontSize: '8px', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{n}</div>
      ))}
    </div>
  );
}

// ── Single expandable feedback card ───────────────────────────────────────────
function FeedbackCard({ item, defaultExpanded = false }: { item: FeedbackItem; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const av = getAvColor(item.candidate.name);
  const isAdvance = item.verdict === 'advance';
  const roundStyle = ROUND_STYLE[item.round] ?? { bg: '#F3F4F6', color: '#374151' };
  const roundLabel = ROUND_LABELS[item.round] ?? item.round;

  return (
    <div style={{
      background: '#fff',
      border: '0.5px solid #E5E7EB',
      borderRadius: '10px',
      overflow: 'hidden',
      transition: 'box-shadow 0.15s',
    }}>
      {/* ── Header row (always visible) ── */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#FAFAFA'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}
      >
        {/* Avatar */}
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: av.bg, color: av.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>
          {initials(item.candidate.name)}
        </div>

        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{item.candidate.name}</span>
            {/* Round badge */}
            <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: roundStyle.bg, color: roundStyle.color }}>
              {roundLabel}
            </span>
            {/* Verdict badge */}
            <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', display: 'inline-flex', alignItems: 'center', gap: '3px', background: isAdvance ? '#ECFDF5' : '#FEF2F2', color: isAdvance ? '#059669' : '#DC2626' }}>
              {isAdvance ? <Check size={9} /> : <X size={9} />}
              {isAdvance ? 'Advanced' : 'Rejected'}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
            {item.job.title}
            {item.interviewer_name && ` · By ${item.interviewer_name}`}
            {item.submitted_at && ` · ${new Date(item.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
          </div>
        </div>

        {/* Rating summary */}
        {item.rating != null && (
          <div style={{ textAlign: 'right', flexShrink: 0, marginRight: '8px' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#F07C2D', lineHeight: 1 }}>{item.rating}<span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 400 }}>/5</span></div>
            <div style={{ fontSize: '9px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rating</div>
          </div>
        )}

        {/* Chevron */}
        <div style={{ color: '#9CA3AF', flexShrink: 0 }}>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '0.5px solid #F3F4F6' }}>

          {/* Skills row */}
          {(item.tech_skill || item.communication) && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
              {item.tech_skill && (
                <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '8px 12px' }}>
                  <div style={{ fontSize: '9px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: '2px' }}>Technical</div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#111827' }}>{item.tech_skill}</div>
                </div>
              )}
              {item.communication && (
                <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '8px 12px' }}>
                  <div style={{ fontSize: '9px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: '2px' }}>Communication</div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#111827' }}>{item.communication}</div>
                </div>
              )}
              {item.rating != null && (
                <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '8px 12px' }}>
                  <div style={{ fontSize: '9px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: '6px' }}>Overall Rating</div>
                  <RatingDots rating={item.rating} />
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {item.notes && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: '#374151', lineHeight: 1.6, background: '#F9FAFB', borderRadius: '8px', padding: '10px 12px', borderLeft: '3px solid #F07C2D' }}>
              {item.notes}
            </div>
          )}

          {/* No detail fallback */}
          {!item.tech_skill && !item.communication && !item.rating && !item.notes && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: '#9CA3AF' }}>No additional details provided.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Summary stat pill ──────────────────────────────────────────────────────────
function StatPill({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '10px 16px', textAlign: 'center', minWidth: '80px' }}>
      <div style={{ fontSize: '20px', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  );
}

// ── 4. Global Feedback Inbox ───────────────────────────────────────────────────
export function GlobalFeedbackPage() {
  const [allFeedback, setAllFeedback] = useState<FeedbackItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [filter, setFilter]           = useState<'all' | 'advanced' | 'rejected'>('all');
  const [roundFilter, setRoundFilter] = useState<'all' | 'round1' | 'technical' | 'hr'>('all');

  useEffect(() => {
    const fetchAllFeedback = async () => {
      try {
        setLoading(true);
        setError(null);

        const jobs = await listJobs();
        const activeJobs = jobs.filter(j => j.status.toLowerCase() === 'active');
        const items: FeedbackItem[] = [];

        await Promise.all(
          activeJobs.map(async (job) => {
            try {
              // 1. Fetch live shortlisted candidates from BigQuery instead of local storage
              const shortRes = await fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'GET_SHORTLISTED', jobId: job.job_id }),
              });
              
              if (!shortRes.ok) return;
              const shortData = await shortRes.json();
              const shortlisted = shortData.candidates || [];

              // 2. Fetch the full profile (which contains the feedback) for each candidate
              await Promise.all(
                shortlisted.map(async (cand: any) => {
                  try {
                    const res = await fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        type:        'GET_FULL_PROFILE',
                        jobId:       job.job_id,
                        candidateId: cand.candidate_id,
                      }),
                    });
                    if (!res.ok) return;
                    const data = await res.json();
                    
                    (data.feedback ?? []).forEach((fb: any) => {
                      items.push({
                        job,
                        candidate:        { candidate_id: cand.candidate_id, name: cand.name, email: cand.email },
                        round:            fb.round,
                        rating:           fb.rating           ?? null,
                        tech_skill:       fb.tech_skill       ?? null,
                        communication:    fb.communication    ?? null,
                        notes:            fb.notes            ?? null,
                        verdict:          fb.verdict          ?? null,
                        interviewer_name: fb.interviewer_name ?? null,
                        submitted_at:     fb.submitted_at     ?? null,
                      });
                    });
                  } catch { /* skip */ }
                })
              );
            } catch { /* skip job */ }
          })
        );

        items.sort((a, b) => {
          const ta = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
          const tb = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
          return tb - ta;
        });

        setAllFeedback(items);
      } catch (err: any) {
        setError('Failed to load feedback. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchAllFeedback();
  }, []);

  const advanced  = allFeedback.filter(f => f.verdict === 'advance').length;
  const rejected  = allFeedback.filter(f => f.verdict === 'reject').length;
  const avgRating = allFeedback.filter(f => f.rating != null).length > 0
    ? (allFeedback.reduce((s, f) => s + (f.rating ?? 0), 0) / allFeedback.filter(f => f.rating != null).length).toFixed(1)
    : '—';

  const filtered = allFeedback
    .filter(f => filter === 'all' ? true : filter === 'advanced' ? f.verdict === 'advance' : f.verdict !== 'advance')
    .filter(f => roundFilter === 'all' ? true : f.round === roundFilter);

  return (
    <DashboardLayout breadcrumb="Dashboard / Feedback Inbox">
      <div style={{ padding: '20px 24px', fontFamily: FONT, maxWidth: '880px' }}>

        {/* ── Page header ── */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '17px', fontWeight: 600, color: '#111827', letterSpacing: '-0.02em' }}>Feedback Inbox</div>
          <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
            Interviewer feedback across all active jobs
            {!loading && allFeedback.length > 0 && ` · ${allFeedback.length} submission${allFeedback.length !== 1 ? 's' : ''}`}
          </div>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#6B7280', fontSize: '13px', padding: '48px 0', justifyContent: 'center' }}>
            <Loader2 size={16} style={{ color: '#F07C2D', animation: 'spin 1s linear infinite' }} />
            Loading feedback…
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ── Error ── */}
        {error && !loading && (
          <div style={{ background: '#FEF2F2', border: '0.5px solid #FCA5A5', borderRadius: '10px', padding: '14px 18px', fontSize: '13px', color: '#DC2626' }}>
            {error}
          </div>
        )}

        {/* ── Empty ── */}
        {!loading && !error && allFeedback.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '12px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F9FAFB', border: '0.5px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <MessageSquare size={22} color="#9CA3AF" />
            </div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#374151' }}>No feedback submitted yet</div>
            <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>Feedback will appear here once interviewers submit it.</div>
          </div>
        )}

        {/* ── Main content ── */}
        {!loading && !error && allFeedback.length > 0 && (
          <>
            {/* Summary stats */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <StatPill value={allFeedback.length} label="Total"    color="#111827" />
              <StatPill value={advanced}           label="Advanced" color="#059669" />
              <StatPill value={rejected}           label="Rejected" color="#DC2626" />
              <StatPill value={avgRating}          label="Avg Rating" color="#F07C2D" />
            </div>

            {/* Filters */}
            <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Verdict filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#6B7280', fontWeight: 700, minWidth: '44px' }}>Verdict</span>
                {(['all', 'advanced', 'rejected'] as const).map(v => (
                  <button key={v} onClick={() => setFilter(v)} style={{
                    padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', fontFamily: FONT,
                    background: filter === v ? '#111827' : 'transparent',
                    color: filter === v ? '#fff' : '#6B7280',
                    border: filter === v ? 'none' : '0.5px solid #E5E7EB',
                  }}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>

              <div style={{ height: '0.5px', background: '#E5E7EB' }} />

              {/* Round filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#6B7280', fontWeight: 700, minWidth: '44px' }}>Round</span>
                {([
                  { key: 'all', label: 'All' },
                  { key: 'round1', label: 'Round 1' },
                  { key: 'technical', label: 'Round 2' },
                  { key: 'hr', label: 'HR' },
                ] as const).map(({ key, label }) => (
                  <button key={key} onClick={() => setRoundFilter(key)} style={{
                    padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', fontFamily: FONT,
                    background: roundFilter === key ? '#111827' : 'transparent',
                    color: roundFilter === key ? '#fff' : '#6B7280',
                    border: roundFilter === key ? 'none' : '0.5px solid #E5E7EB',
                  }}>
                    {label}
                  </button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#9CA3AF' }}>
                  {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* Feedback list */}
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', fontSize: '13px', color: '#9CA3AF' }}>
                No feedback matches the selected filters.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filtered.map((item, i) => (
                  <FeedbackCard key={i} item={item} defaultExpanded={i === 0} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}