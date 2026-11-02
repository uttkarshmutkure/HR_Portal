import { useState, useEffect } from 'react';
import { useParams, useLocation, Link } from 'react-router';
import { Briefcase, CheckCircle, AlertTriangle, Users, ArrowRight, Check, X, Eye, RefreshCw, Loader2, Clock, Mail } from 'lucide-react';
import { EmailService } from '../../services/emailService';
import DashboardLayout from '../components/layout/DashboardLayout';
import { useToast } from '../components/ToastContext';

const FONT = 'Inter, sans-serif';
type TabType = 'TOP5' | 'ALL_PASSED' | 'HUMAN_REVIEW' | 'FAILED' | 'REJECTED' | 'REFERRED';

const DATA_MANAGER_URL       = import.meta.env.VITE_DATA_MANAGER_URL;
const UPDATE_STATUS_URL      = import.meta.env.VITE_UPDATE_CANDIDATE_STATUS_URL;
const CREATE_FORM_LINK_URL = import.meta.env.VITE_CREATE_FORM_LINK_URL;

// ── Confirmation Dialog ────────────────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel, confirmColor, isLoading = false }: {
  message: string; onConfirm: () => void; onCancel: () => void;
  confirmLabel: string; confirmColor: string; isLoading?: boolean;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '24px 28px', width: '340px', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', fontFamily: FONT }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>Are you sure?</div>
        <div style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.6, marginBottom: '20px' }}>{message}</div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button disabled={isLoading} onClick={onCancel} style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 500, fontFamily: FONT, background: '#F9FAFB', color: '#374151', border: '0.5px solid #E5E7EB', borderRadius: '7px', cursor: isLoading ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button disabled={isLoading} onClick={onConfirm} style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 500, fontFamily: FONT, background: confirmColor, color: '#fff', border: 'none', borderRadius: '7px', cursor: isLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: isLoading ? 0.7 : 1 }}>
            {isLoading && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reject Dialog with Notes ───────────────────────────────────────────────────
function RejectDialog({ candidateName, onConfirm, onCancel, isLoading = false }: { 
  candidateName: string; onConfirm: (reason: string) => void; onCancel: () => void; isLoading?: boolean; 
}) {
  const [reason, setReason] = useState('');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '24px 28px', width: '380px', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', fontFamily: FONT }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>Reject {candidateName}</div>
        <div style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.6, marginBottom: '16px' }}>
          Please provide a reason for rejecting this candidate. These notes will be saved to the database.
        </div>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="E.g., Lack of hands-on Azure experience..."
          rows={3}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '12px', outline: 'none', boxSizing: 'border-box', marginBottom: '20px', fontFamily: FONT, resize: 'none', lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button disabled={isLoading} onClick={onCancel} style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 500, fontFamily: FONT, background: '#F9FAFB', color: '#374151', border: '0.5px solid #E5E7EB', borderRadius: '7px', cursor: isLoading ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button disabled={isLoading || !reason.trim()} onClick={() => onConfirm(reason)} style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 500, fontFamily: FONT, background: '#DC2626', color: '#fff', border: 'none', borderRadius: '7px', cursor: (isLoading || !reason.trim()) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: (isLoading || !reason.trim()) ? 0.7 : 1 }}>
            {isLoading && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
            Reject Candidate
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Send JD + Form Modal (preview, then send) ──────────────────────────────────
function SendFormModal({ cand, jobId, jobTitle, onClose, onSent }: {
  cand: any; jobId: string; jobTitle: string; onClose: () => void; onSent: () => void;
}) {
  const { showToast } = useToast();
  const [sending, setSending] = useState(false);
  const jdLink = `${window.location.origin}/careers/${jobId}`;

  const handleSend = async () => {
    setSending(true);
    try {
      // 1. Ask the backend for a signed form link (also records "form sent")
      const r = await fetch(CREATE_FORM_LINK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, candidate_id: cand.candidate_id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) throw new Error(d.error || 'Could not create form link');
      const formLink = `${window.location.origin}/candidate-form/${d.token}`;

      // 2. Build and send the email
      const htmlBody = `
        <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
          <div style="background:#F07C2D;padding:24px 28px;">
            <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.02em;">Atgeir Solutions</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">Hiring Team</div>
          </div>
          <div style="padding:28px;">
            <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear <strong>${cand.name}</strong>,</p>
            <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
              Thank you for your interest in the <strong>${jobTitle}</strong> position. Following the initial screening of your profile, we would like to take the next step with you.
            </p>
            <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
              Please review the job description and fill in a short details form so we can understand your profile better.
            </p>
            <a href="${jdLink}" style="display:inline-block;background:#fff;color:#F07C2D;border:1px solid #F07C2D;text-decoration:none;padding:9px 20px;border-radius:8px;font-size:13px;font-weight:600;margin:0 8px 20px 0;">View Job Description</a>
            <a href="${formLink}" style="display:inline-block;background:#F07C2D;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:20px;">Fill Candidature Form</a>
            <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">
              This link is <strong>personal</strong> — please do not share it with others.
            </p>
            <p style="margin:16px 0 0;font-size:13px;color:#374151;">
              Best regards,<br/><strong>Atgeir Solutions Hiring Team</strong>
            </p>
          </div>
          <div style="padding:0 28px 20px;">
            <p style="margin:0;font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;">
              For any queries, contact us at
              <a href="mailto:support@atgeirsolutions.com" style="color:#F07C2D;text-decoration:none;font-weight:500;">support@atgeirsolutions.com</a>
              or call <span style="font-weight:500;color:#6B7280;">+91 020-41292883</span>
            </p>
          </div>
        </div>
      `;
      EmailService.send({ to: cand.email, subject: `Next step — ${jobTitle}`, body: htmlBody });
      showToast(`Details request sent to ${cand.name}`, 'success');
      onSent();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send email.', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', backdropFilter: 'blur(3px)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', maxHeight: '92vh', boxShadow: '0 25px 40px rgba(0,0,0,0.12)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #E5E7EB', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827', fontFamily: FONT }}>Request Details</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7280', fontFamily: FONT }}>{cand.name} · {cand.email}</p>
          </div>
          <button onClick={onClose} disabled={sending} style={{ background: 'none', border: 'none', fontSize: 18, cursor: sending ? 'not-allowed' : 'pointer', color: '#9CA3AF' }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, fontFamily: FONT }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Email Preview</label>
          <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '12px 14px', fontSize: 12, color: '#374151', lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: '#F07C2D', marginBottom: 6 }}>Atgeir Solutions — Hiring Team</div>
            <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>Subject: Next step — {jobTitle}</div>
            <div>Dear <strong>{cand.name}</strong>,</div>
            <div style={{ marginTop: 6 }}>Thank you for your interest in the <strong>{jobTitle}</strong> position. Following the initial screening of your profile, we would like to take the next step with you.</div>
            <div style={{ marginTop: 6 }}>Please review the job description and fill in a short details form so we can understand your profile better.</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ background: '#fff', color: '#F07C2D', border: '1px solid #F07C2D', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>View Job Description</span>
              <span style={{ background: '#F07C2D', color: '#fff', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>Fill Candidature Form</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: '#9CA3AF', borderTop: '1px solid #E5E7EB', paddingTop: 8 }}>
              For queries: support@atgeirsolutions.com · +91 020-41292883
            </div>
          </div>
          {cand.screening_form_sent_at && (
            <div style={{ marginTop: 12, background: '#FFFBEB', border: '0.5px solid #FCD34D', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#B45309' }}>
              ⚠ A form was already sent to this candidate. Sending again creates a new link.
            </div>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '0.5px solid #E5E7EB', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button disabled={sending} onClick={onClose} style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, fontFamily: FONT, background: '#F9FAFB', color: '#374151', border: '0.5px solid #E5E7EB', borderRadius: 8, cursor: sending ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button disabled={sending || !cand.email} onClick={handleSend} style={{ padding: '9px 20px', fontSize: 13, fontWeight: 600, fontFamily: FONT, background: '#F07C2D', color: '#fff', border: 'none', borderRadius: 8, cursor: sending ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: sending ? 0.7 : 1 }}>
            {sending && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
            {sending ? 'Sending...' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, accent, bg, value, label }: { icon: any; accent: string; bg: string; value: number | string; label: string }) {
  return (
    <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '7px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={15} style={{ color: accent }} />
        </div>
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: '#111827', letterSpacing: '-0.03em', fontFamily: FONT }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#6B7280', fontFamily: FONT, marginTop: '2px' }}>{label}</div>
    </div>
  );
}

// ── Candidate Row ──────────────────────────────────────────────────────────────
function CandidateRow({ candidate, rank, jobId, isFailed, onRefresh, onSendForm }: {
  candidate: any; rank: number; jobId: string; isFailed: boolean; onRefresh: () => void; onSendForm: (c: any) => void;
}) {
  const { showToast } = useToast();
  const [confirm, setConfirm] = useState<'shortlist' | 'reject' | 'remove' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const advancedStages = ['Shortlisted', 'Interview', 'Selected', 'Hired'];
  const isAdvanced     = advancedStages.includes(candidate.candidate_result);
  const isRejected     = candidate.candidate_result === 'Rejected';

  const initials    = candidate.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const resultBadge =
    isRejected                                  ? { bg: '#FEF2F2', color: '#991B1B' } :
    candidate.overall_result === 'PASS'         ? { bg: '#ECFDF5', color: '#065F46' } :
    candidate.overall_result === 'HUMAN_REVIEW' ? { bg: '#FFFBEB', color: '#B45309' } :
                                                  { bg: '#FEF2F2', color: '#991B1B' };

  const formSent     = !!candidate.screening_form_sent_at;
  const formReceived = !!candidate.screening_form_submitted_at;

  const updateStatus = async (result: string) => {
    try {
      const res = await fetch(UPDATE_STATUS_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_id: candidate.candidate_id, candidate_result: result }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      console.warn('Failed to update candidate status in BQ:', err);
      showToast(`Failed to update status: ${err.message}`, 'error');
      throw err;
    }
  };

  const handleShortlistConfirmed = async () => {
    setIsProcessing(true);
    try {
      await updateStatus('Shortlisted');
      setConfirm(null);
      showToast(`${candidate.name} has been shortlisted!`, 'success');
      onRefresh();
    } catch { /* error already shown */ }
    finally { setIsProcessing(false); }
  };

  const handleRejectConfirmed = async (reason: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch(DATA_MANAGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'REJECT_CANDIDATE',
          jobId: jobId,
          candidateId: candidate.candidate_id,
          reason
        }),
      });

      if (!res.ok) throw new Error('Failed to reject candidate');

      setConfirm(null);
      showToast(`${candidate.name} has been rejected.`, 'success');
      onRefresh();
    } catch (err: any) {
      showToast(`Failed to update status: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveConfirmed = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch(UPDATE_STATUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'DELETE_CANDIDATE', candidate_id: candidate.candidate_id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      setConfirm(null);
      showToast(`${candidate.name} has been removed.`, 'success');
      onRefresh();
    } catch (err: any) {
      console.warn('Failed to remove candidate:', err);
      showToast(`Failed to remove: ${err.message}`, 'error');
    }
    finally { setIsProcessing(false); }
  };

  return (
    <>
      {confirm === 'shortlist' && (
        <ConfirmDialog
          message={`Do you want to shortlist ${candidate.name}? They will be added to the shortlist for further review.`}
          confirmLabel="Yes, Shortlist" confirmColor="#F07C2D"
          onConfirm={handleShortlistConfirmed} onCancel={() => !isProcessing && setConfirm(null)}
          isLoading={isProcessing}
        />
      )}
      {confirm === 'reject' && (
        <RejectDialog
          candidateName={candidate.name}
          onConfirm={handleRejectConfirmed} onCancel={() => !isProcessing && setConfirm(null)}
          isLoading={isProcessing}
        />
      )}
      {confirm === 'remove' && (
        <ConfirmDialog
          message={`Permanently remove ${candidate.name}? This deletes their record from the database and cannot be undone.`}
          confirmLabel="Yes, Remove" confirmColor="#111827"
          onConfirm={handleRemoveConfirmed} onCancel={() => !isProcessing && setConfirm(null)}
          isLoading={isProcessing}
        />
      )}
      <div
        style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '16px 20px', borderBottom: '0.5px solid #F9FAFB', transition: 'background 0.1s' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#FAFAFA'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        {/* Avatar + Rank */}
        <div style={{ position: 'relative', flexShrink: 0, marginTop: '2px' }}>
          <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#F9FAFB', border: '0.5px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: '13px', fontWeight: 600, fontFamily: FONT }}>
            {initials}
          </div>
          {!isFailed && !isRejected && rank <= 5 && (
            <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '16px', height: '16px', borderRadius: '50%', background: rank === 1 ? '#F07C2D' : '#1D194B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: '#fff', fontFamily: FONT, border: '1.5px solid #fff' }}>
              {rank}
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827', fontFamily: FONT }}>{candidate.name}</span>

            <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: '20px', fontSize: '9px', fontWeight: 600, fontFamily: FONT, background: resultBadge.bg, color: resultBadge.color }}>
              {isRejected ? 'REJECTED' : candidate.overall_result === 'HUMAN_REVIEW' ? 'Review' : candidate.overall_result}
            </span>

            {isAdvanced && (
              <span style={{ fontSize: '9px', background: '#EFF6FF', color: '#1E40AF', padding: '2px 8px', borderRadius: '20px', fontWeight: 600, fontFamily: FONT }}>
                {candidate.candidate_result === 'Shortlisted' ? 'Shortlisted' : 'In Pipeline'}
              </span>
            )}

            {formReceived && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px', background: '#ECFDF5', color: '#065F46', padding: '2px 8px', borderRadius: '20px', fontWeight: 600, fontFamily: FONT }}>
                <Check size={9} /> Form received
              </span>
            )}
            {!formReceived && formSent && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px', background: '#FFFBEB', color: '#B45309', padding: '2px 8px', borderRadius: '20px', fontWeight: 600, fontFamily: FONT }}>
                <Clock size={9} /> Awaiting form
              </span>
            )}
          </div>

          <div style={{ fontSize: '11px', color: '#6B7280', fontFamily: FONT, marginBottom: '6px' }}>
            {candidate.relevant_exp} yrs · {candidate.email} {candidate.phone ? `· ${candidate.phone}` : ''}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {(candidate.must_have_skills || []).slice(0, 4).map((s: string) => (
              <span key={s} style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 500, background: '#FFF7ED', color: '#9A3412', fontFamily: FONT }}>{s}</span>
            ))}
          </div>

          {candidate.overall_result === 'HUMAN_REVIEW' && candidate.human_review_reason && candidate.human_review_reason !== 'none' && !isRejected && (
            <div style={{ marginTop: '8px', fontSize: '10px', color: '#B45309', display: 'flex', alignItems: 'flex-start', gap: '5px', background: '#FFFBEB', padding: '6px 10px', borderRadius: '6px', border: '0.5px solid #FCD34D' }}>
              <AlertTriangle size={12} style={{ marginTop: '1px', flexShrink: 0 }} />
              <span style={{ lineHeight: 1.4 }}>{candidate.human_review_reason}</span>
            </div>
          )}

          {isFailed && candidate.overall_reason && !isRejected && (
            <div style={{ marginTop: '8px', fontSize: '10px', color: '#991B1B', display: 'flex', alignItems: 'flex-start', gap: '5px', background: '#FEF2F2', padding: '6px 10px', borderRadius: '6px', border: '0.5px solid #FCA5A5' }}>
              <X size={12} style={{ marginTop: '1px', flexShrink: 0 }} />
              <span style={{ lineHeight: 1.4 }}>{candidate.overall_reason}</span>
            </div>
          )}

          {isRejected && candidate.reject_reason && (
            <div style={{ marginTop: '8px', fontSize: '10px', color: '#991B1B', display: 'flex', alignItems: 'flex-start', gap: '5px', background: '#FEF2F2', padding: '6px 10px', borderRadius: '6px', border: '0.5px solid #FCA5A5' }}>
              <X size={12} style={{ marginTop: '1px', flexShrink: 0 }} />
              <span style={{ lineHeight: 1.4 }}><strong>Rejection Notes:</strong> {candidate.reject_reason}</span>
            </div>
          )}
        </div>

        {/* Right: Score + Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px', flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#F07C2D', fontFamily: FONT, lineHeight: 1 }}>
              {(candidate.final_score * 100).toFixed(0)}%
            </div>
            <div style={{ fontSize: '9px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: FONT, marginTop: '3px' }}>AI Match</div>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <Link
              to={`/jobs/${jobId}/candidates/${candidate.candidate_id}`}
              state={{ candidate, jdTitle: '' }}
              style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 500, fontFamily: FONT, background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '6px', color: '#374151', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Eye size={12} /> View
            </Link>

            {!isFailed && !isRejected && !formReceived && (
              <button
                onClick={() => onSendForm(candidate)}
                title={formSent ? 'Send the details request again' : 'Email the job description and the candidature form to the candidate'}
                style={{
                  padding: '6px 12px', fontSize: '11px', fontWeight: 500, fontFamily: FONT,
                  borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
                  background: formSent ? '#fff' : '#FFF7ED',
                  color:      formSent ? '#6B7280' : '#C2540A',
                  border:     formSent ? '0.5px solid #E5E7EB' : '0.5px solid rgba(240,124,45,0.35)',
                }}
              >
                <Mail size={12} /> {formSent ? 'Resend Request' : 'Request Details'}
              </button>
            )}

            {!isFailed && !isAdvanced && !isRejected && (
              <>
                <button onClick={() => setConfirm('shortlist')} style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 500, fontFamily: FONT, background: '#F07C2D', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Check size={12} /> Shortlist
                </button>
                <button onClick={() => setConfirm('reject')} style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 500, fontFamily: FONT, background: '#fff', color: '#DC2626', border: '0.5px solid #E5E7EB', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <X size={12} /> Reject
                </button>
              </>
            )}

            {(isRejected || isFailed) && (
              <button
                disabled
                onClick={() => setConfirm('remove')}
                title="Candidate removal is currently disabled"
                style={{
                  padding: '6px 12px', fontSize: '11px', fontWeight: 500, fontFamily: FONT,
                  background: '#f9fafb', color: '#9ca3af', border: '0.5px solid #E5E7EB',
                  borderRadius: '6px', cursor: 'not-allowed', display: 'flex',
                  alignItems: 'center', gap: '4px', opacity: 0.6
                }}
              >
                <X size={12} /> Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Time-ago helper ────────────────────────────────────────────────────────────
function formatTimeAgo(date: Date): string {
  const diffMs  = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function JobResultsPage() {
  const { jobId }  = useParams<{ jobId: string }>();
  const location   = useLocation();
  const { showToast } = useToast();

  const [activeTab,    setActiveTab   ] = useState<TabType>('TOP5');
  const [candidates,   setCandidates  ] = useState<any>(location.state?.candidates || null);
  const [fetchStatus,  setFetchStatus ] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [fetchError,   setFetchError  ] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [refreshKey,   setRefreshKey  ] = useState(0);
  const [formCand,     setFormCand    ] = useState<any | null>(null);

  // ── Load candidates from BQ on mount ────────────────────────────────────────
  const loadCandidates = async () => {
    if (!jobId || fetchStatus === 'loading') return;
    setFetchStatus('loading');
    setFetchError(null);
    try {
      const res  = await fetch(DATA_MANAGER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'GET_CANDIDATES', jobId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setCandidates(data);
      setLastFetchedAt(new Date());
      setFetchStatus('success');
    } catch (err: any) {
      setFetchError(err.message || 'Failed to fetch results');
      setFetchStatus('error');
      showToast('Failed to load candidates from BQ', 'error');
    } finally {
      setTimeout(() => { setFetchStatus('idle'); setFetchError(null); }, 4000);
    }
  };

  useEffect(() => { loadCandidates(); }, [jobId, refreshKey]);

  if (!jobId) return <div>Job not found</div>;

  const isNotAdvanced = (c: any) => !['Shortlisted', 'Interview', 'Selected', 'Hired', 'Rejected'].includes(c.candidate_result);

  const topCandidates         = (candidates?.top_candidates   ?? []).filter(isNotAdvanced);
  const allPassedCandidates   = (candidates?.all_passed       ?? []).filter(isNotAdvanced);
  const referredCandidates    = candidates?.all_referred      ?? [];
  const allFailedCandidates   = (candidates?.all_failed       ?? []).filter(isNotAdvanced);
  const humanReviewCandidates = (candidates?.all_human_review ?? []).filter(isNotAdvanced);
  const allRejectedCandidates = candidates?.all_rejected      ?? [];
  
  const totalScreened         = candidates?.total_candidates ?? 0;
  const passedCount = allPassedCandidates.length;
  const reviewCount = humanReviewCandidates.length;
  const failedCount = allFailedCandidates.length;
  const referredTabCount = referredCandidates.length;
  
  const allScreenedCandidates = [
    ...(candidates?.all_passed ?? []),
    ...(candidates?.all_human_review ?? []),
    ...(candidates?.all_failed ?? []),
    ...(candidates?.all_rejected ?? [])
  ];
  const shortlistedCount = allScreenedCandidates.filter((c: any) => 
    ['Shortlisted', 'Interview', 'Selected', 'Hired'].includes(c.candidate_result)
  ).length;

  const currentCandidates: any[] =
    activeTab === 'TOP5'         ? topCandidates :
    activeTab === 'ALL_PASSED'   ? allPassedCandidates :
    activeTab === 'HUMAN_REVIEW' ? humanReviewCandidates :
    activeTab === 'REJECTED'     ? allRejectedCandidates :
    activeTab === 'REFERRED'     ? referredCandidates :
    allFailedCandidates;

  const TABS = [
    { id: 'TOP5'         as TabType, label: `Top ${topCandidates.length}` },
    { id: 'ALL_PASSED'   as TabType, label: 'All Passed' },
    { id: 'REFERRED'     as TabType, label: `Referred (${referredTabCount})` },
    { id: 'HUMAN_REVIEW' as TabType, label: 'Human Review' },
    { id: 'FAILED'       as TabType, label: 'Failed' },
    { id: 'REJECTED'     as TabType, label: 'Rejected' },
  ];

  return (
    <DashboardLayout breadcrumb={`Dashboard / Jobs / ${jobId}`}>
      <div style={{ padding: '20px', fontFamily: FONT }}>

        {formCand && (
          <SendFormModal
            cand={formCand}
            jobId={jobId}
            jobTitle={candidates?.job_title || jobId}
            onClose={() => setFormCand(null)}
            onSent={() => { setFormCand(null); setRefreshKey(k => k + 1); }}
          />
        )}
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 600, color: '#111827', letterSpacing: '-0.02em' }}>Screening Results</div>
            <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
              {jobId} · {totalScreened} candidates screened
            </div>
            {lastFetchedAt && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '5px', fontSize: '10px', color: '#9CA3AF', fontFamily: FONT }}>
                <Clock size={10} /> Last updated {formatTimeAgo(lastFetchedAt)}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Refresh button */}
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={fetchStatus === 'loading'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', fontSize: '12px', fontWeight: 500, fontFamily: FONT,
                borderRadius: '7px', cursor: fetchStatus === 'loading' ? 'not-allowed' : 'pointer',
                border: fetchStatus === 'error' ? '0.5px solid #FCA5A5' : fetchStatus === 'success' ? '0.5px solid #6EE7B7' : '0.5px solid #E5E7EB',
                background: fetchStatus === 'error' ? '#FEF2F2' : fetchStatus === 'success' ? '#ECFDF5' : '#fff',
                color: fetchStatus === 'error' ? '#DC2626' : fetchStatus === 'success' ? '#059669' : '#374151',
                opacity: fetchStatus === 'loading' ? 0.7 : 1,
              }}
            >
              {fetchStatus === 'loading' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
              {fetchStatus === 'loading' ? 'Loading…' : fetchStatus === 'success' ? 'Updated!' : fetchStatus === 'error' ? (fetchError || 'Failed') : 'Refresh'}
            </button>

            {shortlistedCount > 0 && (
              <Link
                to={`/jobs/${jobId}/shortlisted`}
                state={{ jdTitle: candidates?.job_title || jobId }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#F07C2D', color: '#fff', border: 'none', borderRadius: '7px', padding: '8px 14px', fontSize: '12px', fontWeight: 500, fontFamily: FONT, textDecoration: 'none' }}
              >
                <Users size={13} /> View Shortlisted ({shortlistedCount}) <ArrowRight size={13} />
              </Link>
            )}
          </div>
        </div>

        {/* No results */}
        {!candidates && fetchStatus !== 'loading' && (
          <div style={{ textAlign: 'center', padding: '80px 0', background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#F9FAFB', border: '0.5px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <Briefcase size={20} style={{ color: '#9CA3AF' }} />
            </div>
            <p style={{ fontSize: '13px', fontWeight: 500, color: '#111827', fontFamily: FONT, marginBottom: '4px' }}>No screening results yet</p>
            <p style={{ fontSize: '11px', color: '#6B7280', fontFamily: FONT }}>Upload resumes to GCS and the pipeline runs automatically.</p>
          </div>
        )}

        {fetchStatus === 'loading' && !candidates && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#F07C2D' }} />
            <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '12px', fontFamily: FONT }}>Loading candidates from BQ…</p>
          </div>
        )}

        {candidates && (
          <>
            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '18px' }}>
              <StatCard icon={Users}         accent="#1D194B" bg="#F9FAFB" value={totalScreened} label="Total Screened" />
              <StatCard icon={CheckCircle}   accent="#10B981" bg="#ECFDF5" value={passedCount}   label="Passed" />
              <StatCard icon={AlertTriangle} accent="#F59E0B" bg="#FFFBEB" value={reviewCount}   label="Human Review" />
              <StatCard icon={X}             accent="#DC2626" bg="#FEF2F2" value={failedCount}   label="Failed" />
            </div>

            {/* Main Panel */}
            <div style={{ background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ padding: '13px 16px', borderBottom: '0.5px solid #F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827', fontFamily: FONT }}>Candidates</span>
                <div style={{ display: 'flex', gap: '3px' }}>
                  {TABS.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      style={{
                        padding: '5px 14px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
                        cursor: 'pointer', fontFamily: FONT,
                        background: activeTab === tab.id ? '#F9FAFB' : 'transparent',
                        color: activeTab === tab.id ? '#111827' : '#6B7280',
                        border: activeTab === tab.id ? '0.5px solid #E5E7EB' : '0.5px solid transparent',
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                {currentCandidates.map((candidate, index) => (
                  <CandidateRow
                    key={candidate.candidate_id}
                    candidate={candidate}
                    rank={index + 1}
                    jobId={jobId}
                    isFailed={activeTab === 'FAILED' || activeTab === 'REJECTED'}
                    onRefresh={() => setRefreshKey(k => k + 1)}
                    onSendForm={setFormCand}
                  />
                ))}
                {currentCandidates.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#9CA3AF', fontSize: '12px', fontFamily: FONT }}>
                    No candidates found in this category.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}