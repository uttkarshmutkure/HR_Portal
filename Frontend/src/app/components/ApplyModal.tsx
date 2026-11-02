import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { X, UploadCloud, FileText, Trash2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  ApplyError,
  PublicJob,
  markJobApplied,
  submitApplication,
} from '../../services/careers';
import { HEADING } from './careersUtils';

// ── Form model ────────────────────────────────────────────────────────────────

interface Draft {
  firstName: string; middleName: string; lastName: string;
  phoneCode: string; phone: string; email: string; gender: string;
  expYears: string; expMonths: string;
  salaryCurrency: string; salaryAmount: string; salaryFreq: string;
  coverNote: string;
  resume: File | null;
}

const EMPTY: Draft = {
  firstName: '', middleName: '', lastName: '',
  phoneCode: '+91', phone: '', email: '', gender: '',
  expYears: '', expMonths: '',
  salaryCurrency: 'INR', salaryAmount: '', salaryFreq: 'Annual',
  coverNote: '', resume: null,
};

// Kept in memory only (never written to storage). It lets a candidate apply to a
// second job without retyping, and survives an accidental close of the modal.
// It disappears on page refresh.
let savedDraft: Draft = { ...EMPTY };

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const RESUME_EXT = /\.pdf$/i;                                       
const MAX_NOTE = 1000;

const COUNTRY_CODES = [
  ['IN', '+91'], ['US/CA', '+1'], ['GB', '+44'], ['AE', '+971'], ['SG', '+65'], ['AU', '+61'],
  ['DE', '+49'], ['FR', '+33'], ['NL', '+31'], ['IE', '+353'], ['IT', '+39'], ['ES', '+34'],
  ['SE', '+46'], ['CH', '+41'], ['JP', '+81'], ['SA', '+966'], ['QA', '+974'], ['ZA', '+27'],
  ['NG', '+234'], ['KE', '+254'], ['BD', '+880'], ['LK', '+94'], ['NP', '+977'], ['PK', '+92'],
  ['PH', '+63'], ['MY', '+60'], ['ID', '+62'], ['NZ', '+64'], ['BR', '+55'], ['MX', '+52'],
] as const;

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'];

const fmtSize = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// ── Validation ────────────────────────────────────────────────────────────────

type Field =
  | 'jobId' | 'resume' | 'firstName' | 'lastName' | 'email' | 'phone'
  | 'expYears' | 'expMonths' | 'salaryAmount' | 'consent';

// Order used to move focus to the first problem
const FIELD_ORDER: Field[] = [
  'jobId', 'resume', 'firstName', 'lastName', 'phone', 'email',
  'expYears', 'expMonths', 'salaryAmount', 'consent',
];

const validate = (d: Draft, jobId: string, consent: boolean): Partial<Record<Field, string>> => {
  const e: Partial<Record<Field, string>> = {};
  if (!jobId) e.jobId = 'Choose the job you are applying for.';
  if (!d.resume) e.resume = 'Upload your resume to continue.';
  if (!d.firstName.trim()) e.firstName = 'Enter your first name.';
  if (!d.lastName.trim()) e.lastName = 'Enter your last name.';

  if (!d.email.trim()) e.email = 'Enter your email address.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) e.email = 'Enter a valid email address, like name@example.com.';

  const digits = d.phone.replace(/[^\d]/g, '');
  if (!digits) e.phone = 'Enter your mobile number.';
  else if (digits.length < 6 || digits.length > 14) e.phone = 'Enter a valid mobile number.';

  if (d.expYears !== '' && !(/^\d{1,2}$/.test(d.expYears) && +d.expYears <= 60)) e.expYears = 'Years must be a whole number from 0 to 60.';
  if (d.expMonths !== '' && !(/^\d{1,2}$/.test(d.expMonths) && +d.expMonths <= 11)) e.expMonths = 'Months must be from 0 to 11.';
  if (d.salaryAmount !== '' && !/^\d+(\.\d{1,2})?$/.test(d.salaryAmount.replace(/,/g, ''))) e.salaryAmount = 'Enter the amount as a number.';

  if (!consent) e.consent = 'Please agree so we can process your application.';
  return e;
};

// ── Small UI pieces ───────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-[#D5D9E0] bg-white px-3 py-2.5 text-[14px] text-[#050C26] placeholder:text-[#8A92A3] outline-none transition focus:border-[#F26522] focus:ring-2 focus:ring-[#F26522]/25';
const inputErrCls = '!border-[#DC2626] focus:!border-[#DC2626] focus:!ring-[#DC2626]/20';
const addonCls = 'flex items-center border border-[#D5D9E0] bg-[#F3F4F6] px-3 text-[13px] text-[#495057] whitespace-nowrap';

function FieldWrap({
  label, htmlFor, optional, error, hint, children,
}: { label: string; htmlFor?: string; optional?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold !leading-snug text-[#2B3250]">
        {label}
        {optional && <span className="ml-1.5 font-normal text-[#6B7280]">(optional)</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-[12px] text-[#6B7280]">{hint}</p>}
      {error && (
        <p id={htmlFor ? `${htmlFor}-err` : undefined} role="alert" className="mt-1 text-[12px] text-[#B91C1C]">{error}</p>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface Props {
  jobs: PublicJob[];
  initialJobId: string;
  appliedIds: Set<string>;
  onClose: () => void;
  onApplied: (jobId: string) => void;
}

export default function ApplyModal({ jobs, initialJobId, appliedIds, onClose, onApplied }: Props) {
  const [jobId, setJobId] = useState(initialJobId);
  const [draft, setDraft] = useState<Draft>(savedDraft);
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<'form' | 'submitting' | 'success'>('form');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [doneJob, setDoneJob] = useState<PublicJob | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);

  const selectedJob = useMemo(() => jobs.find(j => j.job_id === jobId) ?? null, [jobs, jobId]);
  const sortedJobs = useMemo(() => [...jobs].sort((a, b) => a.title.localeCompare(b.title)), [jobs]);
  const errors = validate(draft, jobId, consent);
  const showErr = (f: Field) => (touched[f] || submitted) && errors[f];
  const busy = status === 'submitting';

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft(prev => {
      const next = { ...prev, [k]: v };
      savedDraft = next;
      return next;
    });
  };
  const blur = (f: Field) => setTouched(t => ({ ...t, [f]: true }));

  // ── Dialog behaviour: scroll lock, focus in/out, Escape, Tab trap ──
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  // Document-level so Escape/Tab keep working even when the focused element was
  // removed (e.g. after the success screen) or disabled (while submitting).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (e.key === 'Escape') {
        if (!busy) { e.preventDefault(); onClose(); }
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled])'
      );
      if (focusables.length === 0) { e.preventDefault(); dialog.focus(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && dialog.contains(active) && active !== dialog;
      if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // ── Resume handling ──
  const acceptFile = (file: File | undefined | null) => {
    if (!file) return;
    if (!RESUME_EXT.test(file.name)) { setFileError('Upload a PDF file.'); return; }
    if (file.size > MAX_RESUME_BYTES) { setFileError(`That file is ${fmtSize(file.size)}. The limit is 10 MB.`); return; }
    if (file.size === 0) { setFileError('That file is empty. Choose another one.'); return; }
    setFileError(null);
    set('resume', file);
    blur('resume');
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  // ── Submit ──
  const focusFirstError = (errs: Partial<Record<Field, string>>) => {
    const first = FIELD_ORDER.find(f => errs[f]);
    if (!first) return;
    requestAnimationFrame(() => document.getElementById(`apply-${first}`)?.focus());
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setSubmitError(null);

    const errs = validate(draft, jobId, consent);
    if (Object.keys(errs).length > 0) { focusFirstError(errs); return; }
    if (!selectedJob || !draft.resume) return;

    // Bots fill hidden fields; humans never see this one. Pretend success, send nothing.
    if (honeypotRef.current?.value) { setDoneJob(selectedJob); setStatus('success'); return; }

    setStatus('submitting');
    try {
      await submitApplication({
        jobId,
        firstName: draft.firstName, middleName: draft.middleName, lastName: draft.lastName,
        email: draft.email, phoneCode: draft.phoneCode, phone: draft.phone, gender: draft.gender,
        expYears: draft.expYears, expMonths: draft.expMonths,
        salaryCurrency: draft.salaryCurrency, salaryAmount: draft.salaryAmount.replace(/,/g, ''), salaryFreq: draft.salaryFreq,
        coverNote: draft.coverNote, resume: draft.resume,
      });
      markJobApplied(jobId);
      onApplied(jobId);
      setDoneJob(selectedJob);
      setStatus('success');
    } catch (err) {
      if (err instanceof ApplyError && (err.code === 'ALREADY_APPLIED')) {
        markJobApplied(jobId);
        onApplied(jobId);
      }
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setStatus('form');
      requestAnimationFrame(() => {
        dialogRef.current?.focus();
        dialogRef.current?.querySelector<HTMLElement>('[data-scroll]')?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  };

  const applyToAnother = () => {
    setStatus('form');
    setJobId('');
    setSubmitted(false);
    setTouched({});
    setConsent(false);
    setSubmitError(null);
    setDoneJob(null);
    requestAnimationFrame(() => document.getElementById('apply-jobId')?.focus());
  };

  // ── Render ──
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#050C26]/70 backdrop-blur-[3px] sm:items-center sm:p-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-title"
        tabIndex={-1}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl outline-none sm:h-auto sm:max-h-[92vh] sm:max-w-[580px] sm:rounded-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-200"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#E9ECEF] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="apply-title" className={`${HEADING} m-0 text-[18px] font-semibold !leading-snug text-[#050C26]`}>
              {status === 'success' ? 'Application submitted' : 'Apply for this job'}
            </h2>
            {status !== 'success' && selectedJob && (
              <p className="mt-0.5 truncate text-[13px] text-[#5B6272]">{selectedJob.title}{selectedJob.location ? ` · ${selectedJob.location}` : ''}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="-mr-1 rounded-md p-1.5 text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#050C26] focus-visible:outline-2 focus-visible:outline-[#F26522] disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        {status === 'success' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center sm:py-14">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#ECFDF5] text-[#059669]">
              <CheckCircle2 size={30} aria-hidden />
            </span>
            <div className="max-w-[40ch]">
              <p className={`${HEADING} m-0 text-[17px] font-semibold text-[#050C26]`}>Thanks, {draft.firstName.trim()}.</p>
              <p className="mt-2 text-[14px] leading-relaxed text-[#495057]">
                We have received your application for <strong className="font-semibold text-[#050C26]">{doneJob?.title}</strong>.
                Our recruitment team will review your profile and contact you at {draft.email.trim()} if it is a match.
              </p>
            </div>
            <div className="mt-2 flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <button type="button" onClick={onClose}
                className="rounded-lg border border-[#D5D9E0] bg-white px-5 py-2.5 text-[14px] font-semibold text-[#2B3250] transition-colors hover:bg-[#F3F4F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]">
                Close
              </button>
              {jobs.some(j => j.job_id !== doneJob?.job_id && !appliedIds.has(j.job_id)) && (
                <button type="button" onClick={applyToAnother} autoFocus
                  className="rounded-lg bg-[#D14D0E] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#B53F08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]">
                  Apply to another job
                </button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div data-scroll className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              {submitError && (
                <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3.5 py-3 text-[13px] text-[#991B1B]">
                  <AlertCircle size={17} className="mt-px shrink-0" aria-hidden />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Job position — stays editable so candidates can apply to other roles */}
              <FieldWrap label="Job position" htmlFor="apply-jobId" error={showErr('jobId') || undefined}>
                <select
                  id="apply-jobId"
                  value={jobId}
                  onChange={e => setJobId(e.target.value)}
                  onBlur={() => blur('jobId')}
                  disabled={busy}
                  aria-invalid={!!showErr('jobId')}
                  aria-describedby={showErr('jobId') ? 'apply-jobId-err' : undefined}
                  className={`${inputCls} ${showErr('jobId') ? inputErrCls : ''}`}
                >
                  <option value="">Select a job</option>
                  {sortedJobs.map(j => (
                    <option key={j.job_id} value={j.job_id} disabled={appliedIds.has(j.job_id)}>
                      {j.title}{j.location ? ` — ${j.location}` : ''}{appliedIds.has(j.job_id) ? ' (already applied)' : ''}
                    </option>
                  ))}
                </select>
              </FieldWrap>

              {/* Resume dropzone */}
              <div>
                {draft.resume ? (
                  <div className="flex items-center gap-3 rounded-lg border border-[#BFE8D9] bg-[#F0FBF7] px-3.5 py-3">
                    <FileText size={22} className="shrink-0 text-[#047857]" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[14px] font-semibold text-[#050C26]">{draft.resume.name}</p>
                      <p className="m-0 text-[12px] text-[#5B6272]">{fmtSize(draft.resume.size)}</p>
                    </div>
                    <button type="button" id="apply-resume" onClick={() => fileRef.current?.click()} disabled={busy}
                      className="rounded-md px-2 py-1 text-[13px] font-semibold text-[#B53F08] hover:bg-white focus-visible:outline-2 focus-visible:outline-[#F26522]">
                      Replace
                    </button>
                    <button type="button" onClick={() => set('resume', null)} disabled={busy} aria-label="Remove resume"
                      className="rounded-md p-1.5 text-[#6B7280] hover:bg-white hover:text-[#B91C1C] focus-visible:outline-2 focus-visible:outline-[#F26522]">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    id="apply-resume"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    disabled={busy}
                    aria-describedby="apply-resume-help"
                    className={`flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522] ${
                      dragOver ? 'border-[#F26522] bg-[#FFF3EB]'
                        : showErr('resume') || fileError ? 'border-[#DC2626] bg-[#FEF2F2]'
                        : 'border-[#F7B28A] bg-[#FFF8F3] hover:border-[#F26522]'
                    }`}
                  >
                    <UploadCloud size={26} className="text-[#F26522]" aria-hidden />
                    <span className="text-[14px] text-[#2B3250]">
                      Drag and drop your resume here or <span className="font-semibold text-[#B53F08] underline underline-offset-2">select from your computer</span>
                    </span>
                    <span id="apply-resume-help" className="text-[12px] text-[#6B7280]">PDF only, up to 10 MB</span>
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  tabIndex={-1}
                  onChange={e => { acceptFile(e.target.files?.[0]); e.target.value = ''; }}
                />
                {(fileError || showErr('resume')) && (
                  <p role="alert" className="mt-1.5 text-[12px] text-[#B91C1C]">{fileError || errors.resume}</p>
                )}
              </div>

              {/* Name */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FieldWrap label="First name" htmlFor="apply-firstName" error={showErr('firstName') || undefined}>
                  <input id="apply-firstName" autoComplete="given-name" value={draft.firstName} disabled={busy}
                    onChange={e => set('firstName', e.target.value)} onBlur={() => blur('firstName')}
                    aria-invalid={!!showErr('firstName')} aria-describedby={showErr('firstName') ? 'apply-firstName-err' : undefined}
                    className={`${inputCls} ${showErr('firstName') ? inputErrCls : ''}`} />
                </FieldWrap>
                <FieldWrap label="Middle name" htmlFor="apply-middleName" optional>
                  <input id="apply-middleName" autoComplete="additional-name" value={draft.middleName} disabled={busy}
                    onChange={e => set('middleName', e.target.value)} className={inputCls} />
                </FieldWrap>
                <FieldWrap label="Last name" htmlFor="apply-lastName" error={showErr('lastName') || undefined}>
                  <input id="apply-lastName" autoComplete="family-name" value={draft.lastName} disabled={busy}
                    onChange={e => set('lastName', e.target.value)} onBlur={() => blur('lastName')}
                    aria-invalid={!!showErr('lastName')} aria-describedby={showErr('lastName') ? 'apply-lastName-err' : undefined}
                    className={`${inputCls} ${showErr('lastName') ? inputErrCls : ''}`} />
                </FieldWrap>
              </div>

              {/* Phone + Email */}
              <FieldWrap label="Mobile phone" htmlFor="apply-phone" error={showErr('phone') || undefined}>
                <div className="flex gap-2">
                  <select aria-label="Country calling code" value={draft.phoneCode} disabled={busy}
                    onChange={e => set('phoneCode', e.target.value)}
                    className={`${inputCls} !w-[104px] shrink-0 bg-[#F9FAFB]`}>
                    {COUNTRY_CODES.map(([iso, code]) => <option key={code} value={code}>{iso} {code}</option>)}
                  </select>
                  <input id="apply-phone" type="tel" inputMode="tel" autoComplete="tel-national" value={draft.phone} disabled={busy}
                    onChange={e => set('phone', e.target.value)} onBlur={() => blur('phone')}
                    aria-invalid={!!showErr('phone')} aria-describedby={showErr('phone') ? 'apply-phone-err' : undefined}
                    className={`${inputCls} ${showErr('phone') ? inputErrCls : ''}`} />
                </div>
              </FieldWrap>

              <FieldWrap label="Email" htmlFor="apply-email" error={showErr('email') || undefined}>
                <input id="apply-email" type="email" autoComplete="email" value={draft.email} disabled={busy}
                  onChange={e => set('email', e.target.value)} onBlur={() => blur('email')}
                  aria-invalid={!!showErr('email')} aria-describedby={showErr('email') ? 'apply-email-err' : undefined}
                  className={`${inputCls} ${showErr('email') ? inputErrCls : ''}`} />
              </FieldWrap>

              <FieldWrap label="Gender" htmlFor="apply-gender" optional>
                <select id="apply-gender" value={draft.gender} disabled={busy} onChange={e => set('gender', e.target.value)} className={inputCls}>
                  <option value="">Select an option</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </FieldWrap>

              {/* Experience */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldWrap label="Total experience" htmlFor="apply-expYears" optional error={showErr('expYears') || undefined}>
                  <div className="flex">
                    <input id="apply-expYears" inputMode="numeric" placeholder="e.g. 3" value={draft.expYears} disabled={busy}
                      onChange={e => set('expYears', e.target.value)} onBlur={() => blur('expYears')}
                      aria-invalid={!!showErr('expYears')} aria-describedby={showErr('expYears') ? 'apply-expYears-err' : undefined}
                      className={`${inputCls} !rounded-r-none !border-r-0 ${showErr('expYears') ? inputErrCls : ''}`} />
                    <span className={`${addonCls} rounded-r-lg`}>Years</span>
                  </div>
                </FieldWrap>
                <FieldWrap label="Months" htmlFor="apply-expMonths" error={showErr('expMonths') || undefined}>
                  <div className="flex">
                    <input id="apply-expMonths" inputMode="numeric" placeholder="e.g. 6" value={draft.expMonths} disabled={busy}
                      onChange={e => set('expMonths', e.target.value)} onBlur={() => blur('expMonths')}
                      aria-invalid={!!showErr('expMonths')} aria-describedby={showErr('expMonths') ? 'apply-expMonths-err' : undefined}
                      className={`${inputCls} !rounded-r-none !border-r-0 ${showErr('expMonths') ? inputErrCls : ''}`} />
                    <span className={`${addonCls} rounded-r-lg`}>Months</span>
                  </div>
                </FieldWrap>
              </div>

              {/* Current salary */}
              <FieldWrap label="Current salary" htmlFor="apply-salaryAmount" optional error={showErr('salaryAmount') || undefined}>
                <div className="flex">
                  <select aria-label="Currency" value={draft.salaryCurrency} disabled={busy}
                    onChange={e => set('salaryCurrency', e.target.value)}
                    className={`${inputCls} !w-[84px] shrink-0 !rounded-r-none !border-r-0 bg-[#F9FAFB]`}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input id="apply-salaryAmount" inputMode="decimal" value={draft.salaryAmount} disabled={busy}
                    onChange={e => set('salaryAmount', e.target.value)} onBlur={() => blur('salaryAmount')}
                    aria-invalid={!!showErr('salaryAmount')} aria-describedby={showErr('salaryAmount') ? 'apply-salaryAmount-err' : undefined}
                    className={`${inputCls} !rounded-none ${showErr('salaryAmount') ? inputErrCls : ''}`} />
                  <select aria-label="Pay frequency" value={draft.salaryFreq} disabled={busy}
                    onChange={e => set('salaryFreq', e.target.value)}
                    className={`${inputCls} !w-[100px] shrink-0 !rounded-l-none !border-l-0 bg-[#F9FAFB]`}>
                    <option value="Annual">Annual</option>
                    <option value="Monthly">Monthly</option>
                  </select>
                </div>
              </FieldWrap>

              <FieldWrap label="Anything you would like us to know?" htmlFor="apply-coverNote" optional>
                <textarea id="apply-coverNote" rows={3} maxLength={MAX_NOTE} value={draft.coverNote} disabled={busy}
                  onChange={e => set('coverNote', e.target.value)}
                  placeholder="Why this role? Notice period? Links to your work?"
                  className={`${inputCls} resize-y`} />
                <p className="mt-1 text-right text-[11px] text-[#6B7280]">{draft.coverNote.length}/{MAX_NOTE}</p>
              </FieldWrap>

              {/* Consent */}
              <div>
                <label className="flex cursor-pointer items-start gap-2.5 text-[13px] !font-normal leading-snug text-[#2B3250]">
                  <input id="apply-consent" type="checkbox" checked={consent} disabled={busy}
                    onChange={e => { setConsent(e.target.checked); blur('consent'); }}
                    aria-invalid={!!showErr('consent')} aria-describedby={showErr('consent') ? 'apply-consent-err' : undefined}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#D14D0E]" />
                  <span>I agree that Atgeir Solutions may store and process my details and resume to assess my application for this and other suitable roles.</span>
                </label>
                {showErr('consent') && <p id="apply-consent-err" role="alert" className="mt-1 text-[12px] text-[#B91C1C]">{errors.consent}</p>}
              </div>

              {/* Honeypot: invisible to people, tempting to bots */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>Website<input ref={honeypotRef} name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
              </div>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-[#E9ECEF] bg-[#F9FAFB] px-5 py-3.5 sm:px-6">
              <button type="button" onClick={onClose} disabled={busy}
                className="rounded-lg border border-[#D5D9E0] bg-white px-5 py-2.5 text-[14px] font-semibold text-[#2B3250] transition-colors hover:bg-[#F3F4F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522] disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={busy}
                className="inline-flex min-w-[110px] items-center justify-center gap-2 rounded-lg bg-[#D14D0E] px-6 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#B53F08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522] disabled:cursor-wait disabled:opacity-80">
                {busy ? (<><Loader2 size={16} className="animate-spin" aria-hidden /> Submitting</>) : 'Apply'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
