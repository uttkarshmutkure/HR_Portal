import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft, MapPin, Briefcase, Clock, Link2, Check, RefreshCw, AlertCircle, Hash,
} from 'lucide-react';
import CareersLayout from '../components/CareersLayout';
import JobRow from '../components/JobRow';
import JobDescription from '../components/JobDescription';
import ApplyModal from '../components/ApplyModal';
import { HEADING, byNewest, fmtExperience, postedAgo } from '../components/careersUtils';
import { PublicJob, getAppliedJobIds, listPublicJobs } from '../../services/careers';

const applyBtn =
  'rounded-lg bg-[#D14D0E] px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#B53F08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]';

export default function CareerJobPage() {
  const { jobId = '' } = useParams();
  const [jobs, setJobs] = useState<PublicJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyFor, setApplyFor] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(() => getAppliedJobIds());
  const [copied, setCopied] = useState(false);

  const load = useCallback((force = false) => {
    setError(null);
    setJobs(null);
    listPublicJobs(force).then(setJobs).catch(e => setError(e.message || 'Could not load this job.'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const job = useMemo(() => jobs?.find(j => j.job_id === jobId) ?? null, [jobs, jobId]);
  const others = useMemo(
    () => (jobs ?? []).filter(j => j.job_id !== jobId).sort(byNewest).slice(0, 4),
    [jobs, jobId]
  );

  useEffect(() => {
    document.title = job ? `${job.title} | Careers at Atgeir Solutions` : 'Careers at Atgeir Solutions';
    window.scrollTo({ top: 0 });
  }, [job]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — nothing to do */ }
  };

  const isApplied = !!job && applied.has(job.job_id);

  const applyControl = (full = false) =>
    isApplied ? (
      <div className={`inline-flex items-center justify-center gap-2 rounded-lg bg-[#ECFDF5] px-5 py-3 text-[15px] font-semibold text-[#047857] ${full ? 'w-full' : ''}`}>
        <Check size={17} aria-hidden /> You have applied
      </div>
    ) : (
      <button type="button" onClick={() => job && setApplyFor(job.job_id)} className={`${applyBtn} ${full ? 'w-full' : ''}`}>
        Apply now
      </button>
    );

  return (
    <CareersLayout>
      <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-14">
        <Link to="/careers"
          className="mb-5 inline-flex items-center gap-1.5 rounded-md py-1 text-[14px] font-medium text-[#495057] hover:text-[#050C26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]">
          <ArrowLeft size={16} aria-hidden /> All open positions
        </Link>

        {/* Loading */}
        {jobs === null && !error && (
          <div className="grid gap-8 lg:grid-cols-[1fr_320px]" aria-hidden>
            <div className="space-y-4 rounded-2xl border border-[#E3E6EB] bg-white p-7">
              <div className="h-8 w-2/3 animate-pulse rounded bg-[#E9ECEF]" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-[#EEF0F3]" />
              <div className="mt-6 space-y-2.5">
                {[100, 94, 88, 97, 60].map((w, i) => <div key={i} className="h-3.5 animate-pulse rounded bg-[#EEF0F3]" style={{ width: `${w}%` }} />)}
              </div>
            </div>
            <div className="h-56 animate-pulse rounded-2xl bg-[#E9ECEF]" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-6 py-12 text-center">
            <AlertCircle size={26} className="text-[#B91C1C]" aria-hidden />
            <p className="m-0 text-[15px] font-semibold text-[#7F1D1D]">We could not load this job</p>
            <p className="m-0 text-[13px] text-[#991B1B]">{error}</p>
            <button type="button" onClick={() => load(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#D14D0E] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#B53F08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]">
              <RefreshCw size={15} aria-hidden /> Try again
            </button>
          </div>
        )}

        {/* Not found / closed */}
        {jobs && !job && (
          <div className="rounded-2xl border border-[#E3E6EB] bg-white px-6 py-12 text-center">
            <h1 className={`${HEADING} m-0 text-[22px] font-semibold !leading-snug text-[#050C26]`}>This job is no longer open</h1>
            <p className="mx-auto mt-2 max-w-[46ch] text-[14px] text-[#5B6272]">
              The position may have been filled or the link may be incorrect. Here are other roles you can apply for.
            </p>
            <Link to="/careers" className={`${applyBtn} mt-5 inline-block`}>See all open positions</Link>
          </div>
        )}

        {/* Job */}
        {job && (
          <div className="grid items-start gap-8 lg:grid-cols-[1fr_320px]">
            <article className="rounded-2xl border border-[#E3E6EB] bg-white p-6 sm:p-8">
              <h1 className={`${HEADING} m-0 text-[28px] font-bold !leading-tight tracking-tight text-[#050C26] sm:text-[34px]`}>{job.title}</h1>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[14px] text-[#495057]">
                {job.location && <span className="inline-flex items-center gap-1.5"><MapPin size={15} className="text-[#F26522]" aria-hidden />{job.location}</span>}
                <span className="inline-flex items-center gap-1.5"><Briefcase size={15} className="text-[#F26522]" aria-hidden />{fmtExperience(job.experience_min, job.experience_max)}</span>
                {postedAgo(job.created_at) && <span className="inline-flex items-center gap-1.5"><Clock size={15} className="text-[#F26522]" aria-hidden />{postedAgo(job.created_at)}</span>}
              </div>

              <hr className="my-6 border-[#E9ECEF]" />

              <JobDescription text={job.description} />

              {(job.must_have_skills.length > 0 || job.preferred_skills.length > 0) && (
                <div className="mt-8 space-y-6 border-t border-[#E9ECEF] pt-6">
                  {job.must_have_skills.length > 0 && (
                    <div>
                      <h2 className={`${HEADING} m-0 mb-2.5 text-[16px] font-semibold !leading-snug text-[#050C26]`}>Skills you need</h2>
                      <ul className="flex flex-wrap gap-2">
                        {job.must_have_skills.map(s => <li key={s} className="rounded-md bg-[#050C26] px-2.5 py-1 text-[13px] font-medium text-white">{s}</li>)}
                      </ul>
                    </div>
                  )}
                  {job.preferred_skills.length > 0 && (
                    <div>
                      <h2 className={`${HEADING} m-0 mb-2.5 text-[16px] font-semibold !leading-snug text-[#050C26]`}>Nice to have</h2>
                      <ul className="flex flex-wrap gap-2">
                        {job.preferred_skills.map(s => <li key={s} className="rounded-md bg-[#EEF0F6] px-2.5 py-1 text-[13px] font-medium text-[#2B3250]">{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </article>

            {/* Summary card */}
            <aside className="space-y-3 lg:sticky lg:top-24">
              <div className="rounded-2xl border border-[#E3E6EB] bg-white p-5">
                {applyControl(true)}
                <dl className="mt-5 space-y-3 text-[14px]">
                  <div className="flex justify-between gap-4"><dt className="text-[#5B6272]">Location</dt><dd className="m-0 text-right font-medium">{job.location || 'Not specified'}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-[#5B6272]">Experience</dt><dd className="m-0 text-right font-medium">{fmtExperience(job.experience_min, job.experience_max)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="inline-flex items-center gap-1 text-[#5B6272]"><Hash size={13} aria-hidden />Job ID</dt><dd className="m-0 text-right font-medium">{job.job_id}</dd></div>
                </dl>
                <button type="button" onClick={copyLink}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#D5D9E0] bg-white px-4 py-2.5 text-[14px] font-semibold text-[#2B3250] transition-colors hover:bg-[#F3F4F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]">
                  {copied ? <><Check size={16} className="text-[#047857]" aria-hidden /> Link copied</> : <><Link2 size={16} aria-hidden /> Copy link to this job</>}
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* Other positions */}
        {jobs && others.length > 0 && (
          <section className="mt-12" aria-labelledby="other-jobs">
            <div className="mb-4 flex items-end justify-between gap-4">
              <h2 id="other-jobs" className={`${HEADING} m-0 text-[20px] font-semibold !leading-snug text-[#050C26]`}>Other open positions</h2>
              <Link to="/careers" className="rounded-md text-[14px] font-semibold text-[#B53F08] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]">
                View all
              </Link>
            </div>
            <ul className="space-y-3">
              {others.map(j => (
                <JobRow key={j.job_id} job={j} applied={applied.has(j.job_id)} onApply={x => setApplyFor(x.job_id)} showSkills={false} />
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Mobile apply bar */}
      {job && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#E3E6EB] bg-white/95 px-4 py-3 backdrop-blur lg:hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <p className="m-0 min-w-0 flex-1 truncate text-[14px] font-semibold text-[#050C26]">{job.title}</p>
            <div className="shrink-0">{applyControl()}</div>
          </div>
        </div>
      )}

      {applyFor && jobs && (
        <ApplyModal
          jobs={jobs}
          initialJobId={applyFor}
          appliedIds={applied}
          onClose={() => setApplyFor(null)}
          onApplied={id => setApplied(prev => new Set(prev).add(id))}
        />
      )}
    </CareersLayout>
  );
}
