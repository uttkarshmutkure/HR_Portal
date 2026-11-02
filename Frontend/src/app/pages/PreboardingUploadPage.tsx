import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CheckCircle, XCircle, AlertTriangle, FileText, Upload, Trash2, Eye } from 'lucide-react';

const API = import.meta.env.VITE_PREBOARDING_URL;
const FONT = 'Inter, sans-serif';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];

type Doc = { status: 'missing' | 'uploaded' | 'verified' | 'rejected'; reason: string | null };
type View = { candidate_name: string; job_title: string; deadline: string; status: string; documents: Record<string, Doc> };

const DOCS: [string, string][] = [['aadhaar', 'Aadhaar Card'], ['pan', 'PAN Card']];
const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  missing:  { label: 'Not uploaded',            bg: '#F3F4F6', color: '#6B7280' },
  uploaded: { label: 'Submitted, under review', bg: '#EFF6FF', color: '#2563EB' },
  verified: { label: 'Verified',                bg: '#ECFDF5', color: '#059669' },
  rejected: { label: 'Rejected, re-upload',     bg: '#FEF2F2', color: '#DC2626' },
};

function StatusScreen({ icon, title, message, bg }: { icon: React.ReactNode; title: string; message: string; bg: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#F9FAFB', fontFamily: FONT, padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 400, background: '#fff', padding: 32, borderRadius: 12, border: '0.5px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <div style={{ width: 50, height: 50, background: bg, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>{icon}</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 8px' }}>{title}</h2>
        <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.6, margin: 0 }}>{message}</p>
      </div>
    </div>
  );
}

export default function PreboardingUploadPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [staged, setStaged] = useState<Record<string, File | null>>({ aadhaar: null, pan: null });
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  useEffect(() => {
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_public', token }) })
      .then(r => r.json())
      .then(d => d.success ? setView(d) : setError(d.message || 'Invalid link'))
      .catch(() => setError('Could not reach the server. Please try again.'));
  }, [token]);

  const pick = (type: string, file: File) => {
    setMsg(null);
    if (file.size > MAX_BYTES) { setMsg({ text: 'File is larger than 5 MB.', ok: false }); return; }
    if (!ALLOWED.includes(file.type)) { setMsg({ text: 'Only PDF, JPG or PNG files are accepted.', ok: false }); return; }
    setStaged(s => ({ ...s, [type]: file }));
    setAgree(false);
  };
  const clear = (type: string) => { setStaged(s => ({ ...s, [type]: null })); setAgree(false); };
  const preview = (f: File) => window.open(URL.createObjectURL(f), '_blank');

  if (error) return <StatusScreen icon={<XCircle size={22} color="#DC2626" />} bg="#FEF2F2" title="Link Problem" message={error} />;
  if (!view) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#F9FAFB' }}>
      <img src="/company-logo.png" alt="Atgeir Solutions" style={{ height: 32, opacity: 0.5 }} />
    </div>
  );

  const expired = new Date(view.deadline) < new Date();
  const stagedCount = DOCS.filter(([t]) => staged[t]).length;
  const covered = DOCS.every(([t]) => staged[t] || ['uploaded', 'verified'].includes(view.documents[t].status));
  const canSubmit = stagedCount > 0 && covered && agree && !submitting && !expired;
  const allSubmitted = DOCS.every(([t]) => ['uploaded', 'verified'].includes(view.documents[t].status));

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setMsg(null);
    let latest = view;
    try {
      for (const [t, label] of DOCS) {
        const f = staged[t];
        if (!f) continue;
        const fd = new FormData();
        fd.append('action', 'upload'); fd.append('token', token!); fd.append('doc_type', t); fd.append('file', f);
        const d = await fetch(API, { method: 'POST', body: fd }).then(r => r.json());
        if (!d.success) throw new Error(`${label}: ${d.message || 'Upload failed'}`);
        latest = { ...latest, status: d.status, documents: d.documents };
        setView(latest);
        setStaged(s => ({ ...s, [t]: null }));
      }
      setAgree(false);
      setJustSubmitted(true);
    } catch (e: any) {
      setMsg({ text: e.message || 'Upload failed. Please try again.', ok: false });
    } finally { setSubmitting(false); }
  };

  if (justSubmitted && allSubmitted && stagedCount === 0) {
    return (
      <StatusScreen
        icon={<CheckCircle size={22} color="#10B981" />} bg="#ECFDF5"
        title="Documents Submitted"
        message={`Thank you, ${view.candidate_name}. Your documents have been sent to our HR team for verification. You will hear from us only if something needs to be corrected.`}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: FONT, padding: '40px 20px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-block', background: '#fff', padding: '10px 20px', borderRadius: 10, border: '0.5px solid #E5E7EB', boxShadow: '0 2px 8px rgba(0,0,0,0.03)', marginBottom: 16 }}>
            <img src="/company-logo.png" alt="Atgeir Solutions" style={{ height: 28, display: 'block' }} />
          </div>
          <h1 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600, color: '#111827', letterSpacing: '-0.01em' }}>Preboarding Documents</h1>
          <p style={{ margin: 0, fontSize: 12, color: '#6B7280', fontWeight: 500 }}>Upload your Aadhaar and PAN cards to complete your joining formalities</p>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #E5E7EB', padding: 28, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
          <div style={{ background: '#FFF7ED', border: '0.5px solid #FFEDD5', borderRadius: 8, padding: '12px 16px', marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div><div style={{ fontSize: 10, fontWeight: 600, color: '#EA580C', textTransform: 'uppercase', marginBottom: 2 }}>Candidate</div><div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{view.candidate_name}</div></div>
            <div><div style={{ fontSize: 10, fontWeight: 600, color: '#EA580C', textTransform: 'uppercase', marginBottom: 2 }}>Position</div><div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{view.job_title}</div></div>
            <div><div style={{ fontSize: 10, fontWeight: 600, color: '#EA580C', textTransform: 'uppercase', marginBottom: 2 }}>Deadline</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: expired ? '#DC2626' : '#111827' }}>
                {new Date(view.deadline).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}{expired && ' (passed)'}
              </div></div>
          </div>

          {expired && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#FEF2F2', border: '0.5px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#DC2626' }}>
              <AlertTriangle size={16} /> The deadline has passed. Please contact HR for an extension.
            </div>
          )}
          {allSubmitted && !expired && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#ECFDF5', border: '0.5px solid #A7F3D0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#059669' }}>
              <CheckCircle size={16} /> Both documents are submitted. HR will review them shortly.
            </div>
          )}

          <label style={{ fontSize: 12, fontWeight: 600, color: '#111827', display: 'block', marginBottom: 10 }}>Required Documents <span style={{ color: '#DC2626' }}>*</span></label>

          {DOCS.map(([t, label]) => {
            const d = view.documents[t];
            const s = STATUS[d.status];
            const f = staged[t];
            const locked = expired || d.status === 'verified';
            return (
              <div key={t} style={{ border: `0.5px solid ${f ? '#F07C2D' : '#E5E7EB'}`, background: f ? '#FFFBF7' : '#F9FAFB', borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: s.bg, color: s.color }}>{s.label}</span>
                </div>
                {d.reason && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 6 }}>Reason: {d.reason}</div>}

                {f && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 6, padding: '8px 10px' }}>
                    <FileText size={15} color="#F07C2D" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <div style={{ fontSize: 10, color: '#9CA3AF' }}>{(f.size / 1024).toFixed(0)} KB · Not submitted yet</div>
                    </div>
                    <button type="button" onClick={() => preview(f)} title="Preview" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#6B7280' }}><Eye size={15} /></button>
                    <button type="button" onClick={() => clear(t)} disabled={submitting} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#DC2626' }}><Trash2 size={15} /></button>
                  </div>
                )}

                {!locked && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '7px 14px', borderRadius: 8, background: '#fff', color: '#F07C2D', border: '0.5px solid #F07C2D', fontSize: 12, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
                    <Upload size={13} /> {f ? 'Choose a different file' : d.status === 'missing' ? 'Choose file' : 'Replace file'}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={submitting} style={{ display: 'none' }}
                      onChange={e => { const file = e.target.files?.[0]; if (file) pick(t, file); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            );
          })}

          {msg && (
            <div style={{ background: msg.ok ? '#ECFDF5' : '#FEF2F2', border: `0.5px solid ${msg.ok ? '#A7F3D0' : '#FCA5A5'}`, borderRadius: 8, padding: '10px 14px', margin: '4px 0 12px', fontSize: 12, color: msg.ok ? '#059669' : '#DC2626' }}>{msg.text}</div>
          )}

          {stagedCount > 0 && (
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12, color: '#374151', lineHeight: 1.5, margin: '16px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} disabled={submitting} style={{ marginTop: 2, accentColor: '#F07C2D' }} />
              I confirm that the selected documents are clear, valid and belong to me, and I want to send them to HR.
            </label>
          )}

          <button onClick={submit} disabled={!canSubmit}
            style={{ width: '100%', padding: 12, borderRadius: 8, background: canSubmit ? '#F07C2D' : '#F9FAFB', color: canSubmit ? '#fff' : '#9CA3AF', border: canSubmit ? 'none' : '0.5px solid #E5E7EB', fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: canSubmit ? 'pointer' : 'not-allowed', transition: 'all .2s', marginTop: stagedCount > 0 ? 0 : 12 }}>
            {submitting ? 'Submitting…' : expired ? 'Deadline Passed' : 'Confirm & Submit Documents'}
          </button>
          {stagedCount > 0 && !covered && (
            <p style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', margin: '8px 0 0' }}>Select both documents to continue.</p>
          )}

          <p style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', margin: '16px 0 0' }}>PDF, JPG or PNG, max 5 MB each. This link is personal, so please don't share it.</p>
        </div>
      </div>
    </div>
  );
}