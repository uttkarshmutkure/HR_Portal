import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search, RefreshCw, AlertCircle, SearchX } from 'lucide-react';
import CareersLayout from '../components/CareersLayout';
import JobRow from '../components/JobRow';
import ApplyModal from '../components/ApplyModal';
import {
  EXPERIENCE_FILTERS, HEADING, byNewest, matchesExperience,
} from '../components/careersUtils';
import { PublicJob, getAppliedJobIds, listPublicJobs } from '../../services/careers';

const selectCls =
  'w-full rounded-lg border border-[#D5D9E0] bg-white px-3 py-2.5 text-[14px] text-[#050C26] outline-none transition focus:border-[#F26522] focus:ring-2 focus:ring-[#F26522]/25';

export default function CareersPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const loc = params.get('location') ?? '';
  const exp = params.get('exp') ?? 'any';

  const [jobs, setJobs] = useState<PublicJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyFor, setApplyFor] = useState<PublicJob | null>(null);
  const [applied, setApplied] = useState<Set<string>>(() => getAppliedJobIds());

  const load = useCallback((force = false) => {
    setError(null);
    setJobs(null);
    listPublicJobs(force).then(setJobs).catch(e => setError(e.message || 'Could not load jobs.'));
  }, []);

  useEffect(() => {
    document.title = 'Careers at Atgeir Solutions';
    load();
  }, [load]);

  // Filters live in the URL so a filtered view can be shared and Back works
  const setFilter = (key: string, value: string, empty: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === empty) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const locations = useMemo(() => {
    const set = new Set<string>();
    (jobs ?? []).forEach(j => j.location && set.add(j.location));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [jobs]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (jobs ?? [])
      .filter(j => !loc || j.location === loc)
      .filter(j => matchesExperience(j, exp))
      .filter(j => {
        if (!term) return true;
        const hay = [j.title, j.location, ...j.must_have_skills, ...j.preferred_skills].join(' ').toLowerCase();
        return term.split(/\s+/).every(w => hay.includes(w));
      })
      .sort(byNewest);
  }, [jobs, q, loc, exp]);

  const hasFilters = !!(q || loc || exp !== 'any');
  const clearFilters = () => setParams({}, { replace: true });

  return (
    <CareersLayout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-[#050C26] text-white">
        {/* Rising bars from the Atgeir mark — the one decorative element on the page */}
        <svg aria-hidden className="pointer-events-none absolute -bottom-10 right-0 hidden h-[340px] w-[420px] text-[#F26522] opacity-[0.09] md:block" viewBox="0 0 420 340" fill="currentColor">
          <rect x="40" y="220" width="64" height="120" />
          <rect x="124" y="140" width="64" height="200" />
          <rect x="208" y="60" width="64" height="280" />
          <path d="M300 70 L346 14 L392 70 M346 14 V340" stroke="currentColor" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>

        <div className="relative mx-auto w-full max-w-6xl px-4 pb-14 pt-14 sm:px-6 sm:pb-16 sm:pt-16">
          <h1 className={`${HEADING} m-0 max-w-[18ch] text-[34px] font-bold !leading-[1.12] tracking-tight sm:text-[46px]`}>
            Work on data and cloud problems that matter
          </h1>
          <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-[#D1D3D4]">
            Browse every open role and apply in a few minutes. You do not need an account.
          </p>

          <div className="mt-8 max-w-xl">
            <label htmlFor="job-search" className="sr-only">Search jobs by title, skill or location</label>
            <div className="relative">
              <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]" aria-hidden />
              <input
                id="job-search"
                type="search"
                value={q}
                onChange={e => setFilter('q', e.target.value, '')}
                placeholder="Search by job title, skill or location"
                className="w-full rounded-xl border border-transparent bg-white py-3.5 pl-11 pr-4 text-[15px] text-[#050C26] placeholder:text-[#6B7280] outline-none transition focus:border-[#F26522] focus:ring-4 focus:ring-[#F26522]/30"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className={`${HEADING} m-0 text-[20px] font-semibold !leading-snug text-[#050C26]`}>Open positions</h2>
            <p className="mt-0.5 text-[13px] text-[#5B6272]" aria-live="polite">
              {jobs === null && !error ? 'Loading…'
                : error ? ''
                : `${visible.length} ${visible.length === 1 ? 'role' : 'roles'}${hasFilters ? ' match your filters' : ' open now'}`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center">
            <div className="sm:w-48">
              <label htmlFor="f-location" className="sr-only">Location</label>
              <select id="f-location" value={loc} onChange={e => setFilter('location', e.target.value, '')} className={selectCls} disabled={!jobs}>
                <option value="">All locations</option>
                {locations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="sm:w-44">
              <label htmlFor="f-exp" className="sr-only">Experience</label>
              <select id="f-exp" value={exp} onChange={e => setFilter('exp', e.target.value, 'any')} className={selectCls} disabled={!jobs}>
                {EXPERIENCE_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            {hasFilters && (
              <button type="button" onClick={clearFilters}
                className="col-span-2 rounded-lg px-3 py-2 text-[13px] font-semibold text-[#B53F08] hover:bg-[#FFF3EB] focus-visible:outline-2 focus-visible:outline-[#F26522] sm:col-span-1">
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Loading */}
        {jobs === null && !error && (
          <ul className="space-y-3" aria-hidden>
            {[0, 1, 2, 3].map(i => (
              <li key={i} className="rounded-xl border border-[#E3E6EB] bg-white p-5">
                <div className="h-5 w-1/3 animate-pulse rounded bg-[#E9ECEF]" />
                <div className="mt-3 h-3.5 w-1/2 animate-pulse rounded bg-[#EEF0F3]" />
                <div className="mt-4 flex gap-2">
                  <div className="h-5 w-16 animate-pulse rounded bg-[#EEF0F3]" />
                  <div className="h-5 w-20 animate-pulse rounded bg-[#EEF0F3]" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Error */}
        {error && (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-6 py-10 text-center">
            <AlertCircle size={26} className="text-[#B91C1C]" aria-hidden />
            <div>
              <p className="m-0 text-[15px] font-semibold text-[#7F1D1D]">We could not load the job list</p>
              <p className="mt-1 text-[13px] text-[#991B1B]">{error}</p>
            </div>
            <button type="button" onClick={() => load(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#D14D0E] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#B53F08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]">
              <RefreshCw size={15} aria-hidden /> Try again
            </button>
          </div>
        )}

        {/* Empty */}
        {jobs && visible.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#CBD0DA] bg-white px-6 py-14 text-center">
            <SearchX size={28} className="text-[#8A92A3]" aria-hidden />
            {jobs.length === 0 ? (
              <>
                <p className={`${HEADING} m-0 text-[17px] font-semibold text-[#050C26]`}>No open positions right now</p>
                <p className="m-0 max-w-[42ch] text-[14px] text-[#5B6272]">New roles are posted here as soon as they open. Please check back soon.</p>
              </>
            ) : (
              <>
                <p className={`${HEADING} m-0 text-[17px] font-semibold text-[#050C26]`}>No roles match your search</p>
                <p className="m-0 max-w-[42ch] text-[14px] text-[#5B6272]">Try a different keyword, or remove a filter to see more roles.</p>
                <button type="button" onClick={clearFilters}
                  className="mt-1 rounded-lg border border-[#D5D9E0] bg-white px-4 py-2 text-[14px] font-semibold text-[#2B3250] hover:bg-[#F3F4F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]">
                  Clear filters
                </button>
              </>
            )}
          </div>
        )}

        {/* List */}
        {jobs && visible.length > 0 && (
          <ul className="space-y-3">
            {visible.map(j => (
              <JobRow key={j.job_id} job={j} applied={applied.has(j.job_id)} onApply={setApplyFor} />
            ))}
          </ul>
        )}
      </section>

      {applyFor && jobs && (
        <ApplyModal
          jobs={jobs}
          initialJobId={applyFor.job_id}
          appliedIds={applied}
          onClose={() => setApplyFor(null)}
          onApplied={id => setApplied(prev => new Set(prev).add(id))}
        />
      )}
    </CareersLayout>
  );
}
