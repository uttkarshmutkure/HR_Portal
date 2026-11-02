import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import CareersLayout from '../components/CareersLayout';
import { HEADING } from '../components/careersUtils';

const FORM_URL = import.meta.env.VITE_CANDIDATE_FORM_URL;
const inputCls = 'w-full rounded-lg border border-[#D5D9E0] bg-white px-3 py-2.5 text-[14px] text-[#050C26] outline-none focus:border-[#F26522] focus:ring-2 focus:ring-[#F26522]/25';

const EMPTY: Record<string, string> = {
  gender: '', mobile: '', education: '', location: '', preferred_location: '', current_employer: '',
  key_skills: '', total_experience_years: '', notice_period_days: '', notice_negotiable: '',
  current_ctc_lpa: '', expected_ctc_lpa: '', offer_in_hand: '', offer_details: '',
  negotiable_days: '',
};
const REQUIRED = Object.keys(EMPTY).filter(k => k !== 'offer_details' && k !== 'negotiable_days');

const call = (body: object) =>
  fetch(FORM_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));

export default function CandidateFormPage() {
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<'loading' | 'form' | 'submitting' | 'done' | 'submitted' | 'invalid'>('loading');
  const [info, setInfo] = useState({ name: '', email: '', job_title: '' });
  const [a, setA] = useState(EMPTY);
  const [showErr, setShowErr] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Candidate form | Atgeir Solutions';
    call({ action: 'GET', token }).then(({ ok, data }) => {
      if (!ok) { setError(data.error || 'This link is invalid.'); setPhase('invalid'); return; }
      setInfo(data);
      setA(p => ({ ...p, mobile: data.mobile || '' }));
      setPhase(data.submitted ? 'submitted' : 'form');
    }).catch(() => { setError('We could not reach the server.'); setPhase('invalid'); });
  }, [token]);

  const set = (k: string, v: string) => setA(p => ({ ...p, [k]: v }));
  const isRequired = (k: string) =>
    k === 'negotiable_days' ? a.notice_negotiable === 'yes' : REQUIRED.includes(k);
  const missing = (k: string) => showErr && isRequired(k) && !a[k].trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErr(true); setError('');
    if ([...REQUIRED, ...(a.notice_negotiable === 'yes' ? ['negotiable_days'] : [])].some(k => !a[k].trim())) return;
    setPhase('submitting');
    const { ok, data } = await call({ action: 'SUBMIT', token, answers: a }).catch(() => ({ ok: false, data: { error: 'Network error. Please try again.' } }));
    if (ok) setPhase('done');
    else if (data.code === 'ALREADY_SUBMITTED') setPhase('submitted');
    else { setError(data.error || 'Something went wrong.'); setPhase('form'); }
  };

  const field = (label: string, k: string, node: React.ReactNode, hint?: string) => (
    <div>
      <label htmlFor={`f-${k}`} className="mb-1.5 block text-[13px] font-semibold text-[#2B3250]">{label}</label>
      {node}
      {hint && <p className="mt-1 text-[12px] text-[#6B7280]">{hint}</p>}
      {missing(k) && <p role="alert" className="mt-1 text-[12px] text-[#B91C1C]">This field is required.</p>}
    </div>
  );
  const text = (k: string, type = 'text') =>
    <input id={`f-${k}`} type={type} value={a[k]} onChange={e => set(k, e.target.value)} className={inputCls} />;
  const select = (k: string, opts: [string, string][]) => (
    <select id={`f-${k}`} value={a[k]} onChange={e => set(k, e.target.value)} className={inputCls}>
      <option value="">Select an option</option>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const YN: [string, string][] = [['yes', 'Yes'], ['no', 'No']];

  const message = (title: string, body: string, ok = true) => (
    <div className="mx-auto max-w-lg rounded-2xl border border-[#E3E6EB] bg-white px-6 py-12 text-center">
      {ok ? <CheckCircle2 size={34} className="mx-auto text-[#059669]" aria-hidden /> : <AlertCircle size={34} className="mx-auto text-[#B91C1C]" aria-hidden />}
      <h1 className={`${HEADING} mt-3 text-[20px] font-semibold text-[#050C26]`}>{title}</h1>
      <p className="mt-2 text-[14px] text-[#495057]">{body}</p>
    </div>
  );

  return (
    <CareersLayout>
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        {phase === 'loading' && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-[#F26522]" /></div>}
        {phase === 'invalid' && message('Link not available', error, false)}
        {phase === 'submitted' && message('Already submitted', 'We have already received your details. Thank you.')}
        {phase === 'done' && message('Thank you', 'Your details have been submitted. Our recruitment team will be in touch.')}
        {(phase === 'form' || phase === 'submitting') && (
          <form onSubmit={submit} noValidate className="space-y-5 rounded-2xl border border-[#E3E6EB] bg-white p-6 sm:p-8">
            <div>
              <h1 className={`${HEADING} m-0 text-[22px] font-bold text-[#050C26]`}>Candidate details</h1>
              <p className="mt-1 text-[14px] text-[#5B6272]">{info.job_title}. Please fill in all fields.</p>
            </div>
            {error && <div role="alert" className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3.5 py-3 text-[13px] text-[#991B1B]">{error}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              {field('Name', 'name', <input id="f-name" value={info.name} readOnly className={`${inputCls} bg-[#F3F4F6]`} />)}
              {field('Email', 'email', <input id="f-email" value={info.email} readOnly className={`${inputCls} bg-[#F3F4F6]`} />)}
              {field('Gender', 'gender', select('gender', [['male', 'Male'], ['female', 'Female'], ['other', 'Other'], ['prefer_not_to_say', 'Prefer not to say']]))}
              {field('Mobile number', 'mobile', text('mobile', 'tel'), 'Include country code, e.g. +91')}
              {field('Education', 'education', select('education', [['graduate', 'Graduate'], ['post_graduate', 'Post Graduate'], ['diploma', 'Diploma']]))}
              {field('Total experience (years)', 'total_experience_years', text('total_experience_years'))}
              {field('Current location', 'location', text('location'))}
              {field('Preferred job location', 'preferred_location', text('preferred_location'))}
            </div>
            {field('Current or last employer', 'current_employer', text('current_employer'))}
            {field('Key skills', 'key_skills', <textarea id="f-key_skills" rows={2} value={a.key_skills} onChange={e => set('key_skills', e.target.value)} className={inputCls} />, 'Separate with commas')}
            <div className="grid gap-4 sm:grid-cols-2">
              {field('Notice period (days)', 'notice_period_days', text('notice_period_days'))}
              {field('Is the notice period negotiable?', 'notice_negotiable', select('notice_negotiable', YN))}
              {a.notice_negotiable === 'yes' && field('Notice period can be reduced to (days)', 'negotiable_days', text('negotiable_days'), 'The minimum number of days you can negotiate down to')}
              {field('Current CTC (LPA)', 'current_ctc_lpa', text('current_ctc_lpa'))}
              {field('Expected CTC (LPA)', 'expected_ctc_lpa', text('expected_ctc_lpa'))}
              {field('Offer in hand?', 'offer_in_hand', select('offer_in_hand', YN))}
              {a.offer_in_hand === 'yes' && field('Offer details (optional)', 'offer_details', text('offer_details'), 'Company and CTC, if you wish to share')}
            </div>
            <button type="submit" disabled={phase === 'submitting'}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#D14D0E] px-6 py-3 text-[15px] font-semibold text-white hover:bg-[#B53F08] disabled:opacity-70">
              {phase === 'submitting' ? <><Loader2 size={16} className="animate-spin" /> Submitting</> : 'Submit'}
            </button>
          </form>
        )}
      </div>
    </CareersLayout>
  );
}