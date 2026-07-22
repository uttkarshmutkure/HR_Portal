import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Briefcase, Users, Award, Clock, Loader2, ArrowRight, X, MoreHorizontal, Check } from 'lucide-react';
import DashboardLayout from '../components/layout/DashboardLayout';
import { listJobs, JobSummary } from '../../services/screening';

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  orange:     '#F07C2D',
  orangeLight:'#FFF7ED',
  navy:       '#1D194B',
  white:      '#FFFFFF',
  bg:         '#F4F6FB',
  gray50:     '#F9FAFB',
  gray100:    '#F3F4F6',
  gray200:    '#E5E7EB',
  gray400:    '#9CA3AF',
  gray600:    '#6B7280',
  text:       '#111827',
  textSub:    '#6B7280',
  font:       "'Inter', sans-serif",
  green:      '#10B981', greenBg:  '#ECFDF5', greenText: '#065F46',
  blue:       '#3B82F6', blueBg:   '#EFF6FF',
  purple:     '#8B5CF6', purpleBg: '#F5F3FF',
  red:        '#DC2626', red2:     '#16A34A',
};

const DATA_MANAGER_URL = import.meta.env.VITE_DATA_MANAGER_URL;

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, accent, bg, value, label, trend }: {
  icon: any; accent: string; bg: string;
  value: number | string; label: string; trend?: string;
}) {
  return (
    <div style={{
      background: T.white, border: `0.5px solid ${T.gray200}`,
      borderRadius: '10px', padding: '14px 16px', transition: 'all 0.2s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '7px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={15} color={accent} />
        </div>
        {trend && <span style={{ fontSize: '10px', fontWeight: 500, color: '#16A34A', fontFamily: T.font }}>{trend}</span>}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: T.text, letterSpacing: '-0.03em', fontFamily: T.font }}>{value}</div>
      <div style={{ fontSize: '11px', color: T.textSub, fontFamily: T.font, marginTop: '2px' }}>{label}</div>
    </div>
  );
}

// ── Job Row ───────────────────────────────────────────────────────────────────
function CompactJobRow({ job, isSelected, onToggle, onManage, onRefresh }: {
  job: JobSummary; isSelected: boolean;
  onToggle: () => void; onManage: () => void; onRefresh: () => void;
}) {
  const isActive = job.status.toLowerCase() === 'active';
  const [menuOpen, setMenuOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const iconColors: Record<number, { bg: string; color: string }> = {
    0: { bg: '#FFF7ED', color: '#F07C2D' },
    1: { bg: '#EFF6FF', color: '#3B82F6' },
    2: { bg: '#F5F3FF', color: '#8B5CF6' },
    3: { bg: '#ECFDF5', color: '#10B981' },
  };
  const ic = iconColors[Math.abs(job.job_id.charCodeAt(0)) % 4];

  const toggleStatus = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    setIsUpdating(true);
    const newStatus = isActive ? 'Closed' : 'Active';
    try {
      const res = await fetch(DATA_MANAGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'UPDATE_JOB_STATUS', jobId: job.job_id, status: newStatus }),
      });
      const data = await res.json();
      if (data.success) onRefresh();
    } catch (err) {
      console.error('Error updating status:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: '11px',
          padding: '11px 16px',
          borderBottom: `0.5px solid ${T.gray100}`,
          cursor: 'pointer', transition: 'all 0.15s',
          background: isSelected ? '#FFF7F2' : T.white,
          borderLeft: `3px solid ${isSelected ? T.orange : 'transparent'}`,
        }}
        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = T.gray50; }}
        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = T.white; }}
      >
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: ic.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Briefcase size={14} color={ic.color} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: isSelected ? '#C2540A' : T.text, fontFamily: T.font, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {job.title}
          </div>
          <div style={{ fontSize: '10px', color: T.gray400, fontFamily: T.font, marginTop: '1px' }}>
            {job.location && `${job.location} · `}{job.experience_min}–{job.experience_max} yrs
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {isUpdating ? (
            <Loader2 size={13} color={T.orange} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              padding: '2px 7px', borderRadius: '20px', fontSize: '10px', fontWeight: 500, fontFamily: T.font,
              ...(isActive ? { background: T.greenBg, color: T.greenText } : { background: T.gray50, color: T.gray600 }),
            }}>
              {isActive && <span style={{ width: '4px', height: '4px', background: T.green, borderRadius: '50%', display: 'inline-block' }} />}
              {isActive ? 'Active' : 'Closed'}
            </span>
          )}
          <button
            aria-label="Job options"
            disabled={isUpdating}
            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
            style={{
              width: '24px', height: '24px', borderRadius: '5px',
              border: `0.5px solid ${T.gray200}`,
              background: menuOpen ? T.gray100 : T.white,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: isUpdating ? 'not-allowed' : 'pointer',
              flexShrink: 0, opacity: isUpdating ? 0.5 : 1,
            }}
          >
            <MoreHorizontal size={13} color={T.gray600} />
          </button>
        </div>
      </div>

      {/* Dropdown — exactly original options */}
      {menuOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9 }} onClick={e => { e.stopPropagation(); setMenuOpen(false); }} />
          <div style={{
            position: 'absolute', right: 12, top: 44, zIndex: 50,
            background: T.white, border: `0.5px solid ${T.gray200}`,
            borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            minWidth: '140px', overflow: 'hidden',
          }}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(false); onManage(); }}
              style={{ width: '100%', padding: '9px 14px', fontSize: '12px', fontWeight: 500, color: T.text, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: T.font, display: 'flex', alignItems: 'center', gap: '7px' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.gray50}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
            >
              <Briefcase size={12} color={T.orange} /> Manage
            </button>
            <button
              onClick={toggleStatus}
              style={{ width: '100%', padding: '9px 14px', fontSize: '12px', fontWeight: 500, color: isActive ? T.red : T.red2, background: 'none', border: 'none', borderTop: `0.5px solid ${T.gray200}`, cursor: 'pointer', textAlign: 'left', fontFamily: T.font, display: 'flex', alignItems: 'center', gap: '7px' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.gray50}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
            >
              {isActive
                ? <><X size={12} color={T.red} /> Mark as Closed</>
                : <><Check size={12} color={T.red2} /> Mark as Active</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate();
  const [refreshJobsKey, setRefreshJobsKey] = useState(0);
  const [jobs, setJobs]                     = useState<JobSummary[]>([]);
  const [loadingJobs, setLoadingJobs]       = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [selectedJobId, setSelectedJobId]   = useState<string | null>(null);
  const [jobTab, setJobTab]                 = useState<'all' | 'active' | 'closed'>('all');

  const [stats, setStats] = useState({ activeJobs: 0, screened: 0, shortlisted: 0, interviews: 0, passRate: 0 });

  const [funnelStages, setFunnelStages] = useState([
    { label: 'Shortlisted',       n: 0, pct: 0, color: T.orange },
    { label: 'Technical Round 1', n: 0, pct: 0, color: T.blue   },
    { label: 'Technical Round 2', n: 0, pct: 0, color: T.purple },
    { label: 'HR Round',          n: 0, pct: 0, color: T.green  },
  ]);

  const [activityFeed, setActivityFeed] = useState<Array<{ color: string; text: string; time: string }>>([]);

  // Load jobs
  useEffect(() => {
    const load = async () => {
      setLoadingJobs(true);
      try { setJobs(await listJobs()); }
      catch (err) { console.error('Failed to load jobs', err); }
      finally { setLoadingJobs(false); }
    };
    load();
  }, [refreshJobsKey]);

  // Recalculate metrics from BigQuery — identical logic to original
  useEffect(() => {
    if (loadingJobs) return;
    let isMounted = true;
    setLoadingMetrics(true);

    const fetchMetrics = async () => {
      let activeCount = 0, totalScreened = 0, totalShortlisted = 0, totalInterviews = 0;
      let r1Count = 0, techCount = 0, hrCount = 0;
      const dynamicActivities: Array<{ color: string; text: string; time: string; ts: number }> = [];
      const jobsToProcess = selectedJobId ? jobs.filter(j => j.job_id === selectedJobId) : jobs;

      await Promise.all(jobsToProcess.map(async (job) => {
        if (job.status.toLowerCase() === 'active') activeCount++;
        try {
          const candRes  = await fetch(DATA_MANAGER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'GET_CANDIDATES',  jobId: job.job_id }) });
          const candData = await candRes.json();
          if (candData.success) totalScreened += candData.total_candidates || 0;

          const shortRes  = await fetch(DATA_MANAGER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'GET_SHORTLISTED', jobId: job.job_id }) });
          const shortData = await shortRes.json();
          const shortlisted = shortData.candidates || [];
          totalShortlisted += shortlisted.length;

          await Promise.all(shortlisted.map(async (cand: any) => {
            const profRes  = await fetch(DATA_MANAGER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'GET_FULL_PROFILE', jobId: job.job_id, candidateId: cand.candidate_id }) });
            const profData = await profRes.json();
            const timeline = (profData.timeline || []).sort((a: any, b: any) => new Date(b.confirmed_at).getTime() - new Date(a.confirmed_at).getTime());

            const r1State   = timeline.find((t: any) => t.round === 'round1');
            const techState = timeline.find((t: any) => t.round === 'technical');
            const hrState   = timeline.find((t: any) => t.round === 'hr');

            const INACTIVE = ['not_started', 'rejected', 'Shortlisted'];
            let currentlyInInterview = false;
            if      (hrState   && !INACTIVE.includes(hrState.status))   { hrCount++;   currentlyInInterview = true; }
            else if (techState && !INACTIVE.includes(techState.status)) { techCount++; currentlyInInterview = true; }
            else if (r1State   && !INACTIVE.includes(r1State.status))   { r1Count++;   currentlyInInterview = true; }
            if (currentlyInInterview) totalInterviews++;

            const jobPrefix = selectedJobId ? '' : `[${job.title}] `;
            if      (hrState?.status === 'advanced')   dynamicActivities.push({ color: T.green,  text: `${jobPrefix}${cand.name} passed the HR Round`,          time: 'Recently', ts: hrState.confirmed_at   ? new Date(hrState.confirmed_at).getTime()   : Date.now() });
            else if (techState?.status === 'advanced') dynamicActivities.push({ color: T.purple, text: `${jobPrefix}${cand.name} advanced to HR Round`,         time: 'Recently', ts: techState.confirmed_at  ? new Date(techState.confirmed_at).getTime()  : Date.now() });
            else if (r1State?.status === 'advanced')   dynamicActivities.push({ color: T.blue,   text: `${jobPrefix}${cand.name} advanced to Technical Round`,  time: 'Recently', ts: r1State.confirmed_at    ? new Date(r1State.confirmed_at).getTime()    : Date.now() });
            else if (r1State?.status === 'invited')    dynamicActivities.push({ color: T.orange, text: `${jobPrefix}Invite sent to ${cand.name}`,                time: 'Recently', ts: r1State.confirmed_at    ? new Date(r1State.confirmed_at).getTime()    : Date.now() });
          }));
        } catch (e) {
          console.error(`Error loading metrics for job ${job.job_id}`, e);
        }
      }));

      if (!isMounted) return;

      const passRate = totalScreened > 0 ? Math.round((totalShortlisted / totalScreened) * 100) : 0;
      setStats({ activeJobs: activeCount, screened: totalScreened, shortlisted: totalShortlisted, interviews: totalInterviews, passRate });
      setFunnelStages([
        { label: 'Shortlisted',       n: totalShortlisted, pct: totalShortlisted > 0 ? 100 : 0,                                                                    color: T.orange },
        { label: 'Technical Round 1', n: r1Count,   pct: totalShortlisted > 0 ? Math.round((r1Count   / totalShortlisted) * 100) : 0, color: T.blue   },
        { label: 'Technical Round 2', n: techCount, pct: totalShortlisted > 0 ? Math.round((techCount / totalShortlisted) * 100) : 0, color: T.purple },
        { label: 'HR Round',          n: hrCount,   pct: totalShortlisted > 0 ? Math.round((hrCount   / totalShortlisted) * 100) : 0, color: T.green  },
      ]);
      setActivityFeed(
        dynamicActivities.length > 0
          ? dynamicActivities.sort((a, b) => b.ts - a.ts).slice(0, 4).map(({ color, text, time }) => ({ color, text, time }))
          : [{ color: T.gray400, text: selectedJobId ? 'No recent activity for this job' : 'System online and ready', time: 'Just now' }]
      );
      setLoadingMetrics(false);
    };

    fetchMetrics();
    return () => { isMounted = false; };
  }, [jobs, selectedJobId, loadingJobs]);

  const selectedJobObj = jobs.find(j => j.job_id === selectedJobId);
  const filteredJobs   = jobs
    .filter(j => jobTab === 'all' ? true : jobTab === 'active' ? j.status.toLowerCase() === 'active' : j.status.toLowerCase() !== 'active')
    .slice(0, 6);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <DashboardLayout breadcrumb="Dashboard">
      <div style={{ padding: '20px', fontFamily: T.font, background: T.bg, minHeight: '100%' }}>

        {/* ── Page header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: T.text, letterSpacing: '-0.02em', fontFamily: T.font }}>
              {selectedJobObj ? `Job Metrics: ${selectedJobObj.title}` : 'Screening Dashboard'}
            </div>
            <div style={{ fontSize: '11px', color: T.textSub, marginTop: '2px', fontFamily: T.font }}>
              {selectedJobObj
                ? `Filtering dashboard for ${selectedJobObj.location ?? 'this role'}`
                : `${today} · ${stats.activeJobs} active position${stats.activeJobs !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
          {selectedJobId ? (
            <StatCard icon={Briefcase} accent={T.orange} bg={T.orangeLight}
              value={selectedJobObj?.status.toLowerCase() === 'active' ? 'Active' : 'Closed'}
              label="Job Status" trend="Selected" />
          ) : (
            <StatCard icon={Briefcase} accent={T.orange} bg={T.orangeLight}
              value={stats.activeJobs} label="Active jobs"
              trend={stats.activeJobs > 0 ? 'Live' : undefined} />
          )}
          <StatCard icon={Users}  accent={T.blue}   bg={T.blueBg}   value={stats.screened}    label="Candidates screened" trend={selectedJobId ? 'For this job' : 'All Jobs'} />
          <StatCard icon={Award}  accent={T.purple} bg={T.purpleBg} value={stats.shortlisted} label="Shortlisted"          trend={`${stats.passRate}% pass rate`} />
          <StatCard icon={Clock}  accent={T.green}  bg={T.greenBg}  value={stats.interviews}  label="In interviews"        trend="Active pipeline" />
        </div>

        {/* ── Main grid ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: '14px', alignItems: 'start' }}>

          {/* Jobs list panel — no overflow:hidden so the dropdown menu isn't clipped */}
          <div style={{ background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '10px' }}>

            {/* Panel header */}
            <div style={{ padding: '11px 16px', borderBottom: `0.5px solid ${T.gray100}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '10px 10px 0 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                {(['all', 'active', 'closed'] as const).map(tab => {
                  const label = tab === 'all' ? 'Recent Jobs' : tab === 'active' ? 'Active' : 'Closed';
                  const active = jobTab === tab;
                  return (
                    <button key={tab} onClick={() => setJobTab(tab)} style={{
                      padding: '4px 11px', borderRadius: '5px', fontSize: '12px', fontWeight: 500,
                      cursor: 'pointer', fontFamily: T.font, transition: 'all 0.12s',
                      background: active ? T.navy    : 'transparent',
                      color:      active ? T.white   : T.gray600,
                      border:     active ? 'none'    : '0.5px solid transparent',
                    }}>
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Original right-side controls: clear selection OR Manage All Jobs */}
              {selectedJobId ? (
                <button onClick={() => setSelectedJobId(null)} style={{ fontSize: '11px', color: T.gray600, background: 'rgba(29,25,75,0.05)', padding: '4px 8px', borderRadius: '5px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500, fontFamily: T.font }}>
                  Clear selection <X size={10} />
                </button>
              ) : (
                <button onClick={() => navigate('/jobs')} style={{ fontSize: '11px', color: T.orange, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500, fontFamily: T.font }}>
                  Manage All Jobs <ArrowRight size={10} />
                </button>
              )}
            </div>

            {/* Rows */}
            {loadingJobs ? (
              <div style={{ padding: '48px', display: 'flex', justifyContent: 'center' }}>
                <Loader2 size={16} color={T.orange} style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            ) : filteredJobs.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <Briefcase size={24} color={T.gray200} style={{ margin: '0 auto 8px', display: 'block' }} />
                <p style={{ fontSize: '12px', color: T.gray400, fontFamily: T.font, margin: 0 }}>
                  No {jobTab !== 'all' ? jobTab : ''} jobs found
                </p>
              </div>
            ) : (
              filteredJobs.map(job => (
                <CompactJobRow
                  key={job.job_id}
                  job={job}
                  isSelected={selectedJobId === job.job_id}
                  onToggle={() => setSelectedJobId(selectedJobId === job.job_id ? null : job.job_id)}
                  onManage={() => navigate('/jobs', { state: { expandJobId: job.job_id } })}
                  onRefresh={() => setRefreshJobsKey(k => k + 1)}
                />
              ))
            )}
          </div>

          {/* Right sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Pipeline funnel */}
            <div style={{ background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ padding: '11px 16px', borderBottom: `0.5px solid ${T.gray100}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: T.text, fontFamily: T.font }}>Pipeline funnel</span>
                {selectedJobId && <span style={{ fontSize: '9px', color: T.orange, background: T.orangeLight, padding: '2px 6px', borderRadius: '4px', fontFamily: T.font }}>Filtered</span>}
              </div>
              <div style={{ padding: '12px 14px' }}>
                {loadingMetrics ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
                    <Loader2 size={14} color={T.orange} style={{ animation: 'spin 1s linear infinite' }} />
                  </div>
                ) : (
                  funnelStages.map((s, i) => (
                    <div key={s.label} style={{ marginBottom: i < funnelStages.length - 1 ? '10px' : 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', color: T.gray600, fontFamily: T.font }}>{s.label}</span>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: T.text, fontFamily: T.font }}>{s.n}</span>
                      </div>
                      <div style={{ height: '5px', background: T.gray100, borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${s.pct}%`, background: s.color, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Activity feed */}
            <div style={{ background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ padding: '11px 16px', borderBottom: `0.5px solid ${T.gray100}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: T.text, fontFamily: T.font }}>Activity</span>
                {selectedJobId && <span style={{ fontSize: '9px', color: T.orange, background: T.orangeLight, padding: '2px 6px', borderRadius: '4px', fontFamily: T.font }}>Filtered</span>}
              </div>
              {loadingMetrics ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                  <Loader2 size={14} color={T.orange} style={{ animation: 'spin 1s linear infinite' }} />
                </div>
              ) : (
                activityFeed.map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: '10px', padding: '9px 14px',
                    borderBottom: i < activityFeed.length - 1 ? `0.5px solid ${T.gray100}` : 'none',
                    alignItems: 'flex-start',
                  }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.color, marginTop: '4px', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '11px', color: T.text, fontFamily: T.font, lineHeight: 1.45 }}>{item.text}</div>
                      <div style={{ fontSize: '10px', color: T.gray400, fontFamily: T.font, marginTop: '1px' }}>{item.time}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        :focus-visible { outline: 2px solid ${T.orange}; outline-offset: 2px; }
      `}</style>
    </DashboardLayout>
  );
}