import { useEffect, useState } from 'react';
import { Loader2, Plus, X, Briefcase, Archive, RotateCcw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useToast } from '../ToastContext';
import {
  listAdminJobs, createJob, updateJob, archiveJob, restoreJob,
  AdminJob, JobFormInput,
} from '../../../services/adminJobs';

const FONT = 'Inter, sans-serif';
const T = {
  orange: '#F07C2D', orangeLight: '#FFF7ED', orangeBorder: 'rgba(240,124,45,0.3)',
  navy: '#1D194B', white: '#FFFFFF', bg: '#F4F6FB',
  gray50: '#F9FAFB', gray100: '#F3F4F6', gray200: '#E5E7EB',
  gray400: '#9CA3AF', gray600: '#6B7280', text: '#111827', textSub: '#6B7280',
  green: '#10B981', greenBg: '#ECFDF5', greenText: '#065F46',
  red: '#DC2626', redBg: '#FEF2F2',
  gray500text: '#4B5563',
};

function StatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const styles: Record<string, { bg: string; color: string }> = {
    active: { bg: T.greenBg, color: T.greenText },
    closed: { bg: T.gray100, color: T.gray600 },
    archived: { bg: '#F3F4F6', color: '#6B7280' },
  };
  const style = styles[s] || styles.closed;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600,
      fontFamily: FONT, background: style.bg, color: style.color, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

// ── Create / Edit modal ──────────────────────────────────────────────────
function JobFormModal({ editingJob, onClose, onSaved }: {
  editingJob: AdminJob | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [title, setTitle] = useState(editingJob?.title || '');
  const [description, setDescription] = useState(editingJob?.description || '');
  const [mustHave, setMustHave] = useState((editingJob?.must_have_skills || []).join(', '));
  const [preferred, setPreferred] = useState((editingJob?.preferred_skills || []).join(', '));
  const [expMin, setExpMin] = useState(String(editingJob?.experience_min ?? ''));
  const [expMax, setExpMax] = useState(String(editingJob?.experience_max ?? ''));
  const [location, setLocation] = useState(editingJob?.location || '');
  const [recruiterEmail, setRecruiterEmail] = useState(editingJob?.recruiter_email || '');
  const [isSaving, setIsSaving] = useState(false);

  const isValid = title.trim() && description.trim() && mustHave.trim() &&
    expMin !== '' && expMax !== '' && Number(expMin) <= Number(expMax);

  const handleSave = async () => {
    if (!isValid || !user?.email) return;
    setIsSaving(true);

    const fields: JobFormInput = {
      title: title.trim(),
      description: description.trim(),
      must_have_skills: mustHave.split(',').map(s => s.trim()).filter(Boolean),
      preferred_skills: preferred.split(',').map(s => s.trim()).filter(Boolean),
      experience_min: Number(expMin),
      experience_max: Number(expMax),
      location: location.trim(),
      recruiter_email: recruiterEmail.trim() || undefined,
    };

    try {
      if (editingJob) {
        await updateJob(user.email, editingJob.job_id, fields);
        showToast('Job updated successfully', 'success');
      } else {
        await createJob(user.email, fields);
        showToast('Job created successfully', 'success');
      }
      onSaved();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to save job', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB',
    fontSize: '13px', outline: 'none', boxSizing: 'border-box', fontFamily: FONT,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', display: 'block',
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: T.white, borderRadius: '14px', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.14)', fontFamily: FONT }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.gray100}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: T.text }}>
            {editingJob ? 'Edit Job' : 'Add Job'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.gray400, display: 'flex', padding: '2px' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto', flex: 1 }}>
          {!editingJob && (
            <div style={{
              display: 'flex', gap: '8px', padding: '10px 12px', background: '#FFFBEB',
              border: '0.5px solid #FCD34D', borderRadius: '8px',
            }}>
              <AlertTriangle size={13} color="#B45309" style={{ flexShrink: 0, marginTop: '1px' }} />
              <span style={{ fontSize: '11px', color: '#92400E', lineHeight: 1.5 }}>
                Jobs created here don't yet have an AI matching profile — don't run screening
                on this job until that's enabled.
              </span>
            </div>
          )}

          <div>
            <label style={labelStyle}>Job Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Senior Backend Engineer" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Role responsibilities, requirements..."
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle}>Must-Have Skills <span style={{ color: T.gray400, fontWeight: 400 }}>(comma separated)</span></label>
            <input value={mustHave} onChange={e => setMustHave(e.target.value)} placeholder="Python, SQL, AWS" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Preferred Skills <span style={{ color: T.gray400, fontWeight: 400 }}>(comma separated, optional)</span></label>
            <input value={preferred} onChange={e => setPreferred(e.target.value)} placeholder="Docker, Kubernetes" style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Min Experience (yrs)</label>
              <input type="number" min={0} value={expMin} onChange={e => setExpMin(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Max Experience (yrs)</label>
              <input type="number" min={0} value={expMax} onChange={e => setExpMax(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Location</label>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Pune, India / Remote" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Recruiter Email <span style={{ color: T.gray400, fontWeight: 400 }}>(defaults to you)</span></label>
            <input value={recruiterEmail} onChange={e => setRecruiterEmail(e.target.value)} placeholder={user?.email || ''} style={inputStyle} />
          </div>

          {expMin !== '' && expMax !== '' && Number(expMin) > Number(expMax) && (
            <p style={{ fontSize: '11px', color: T.red, margin: 0 }}>Min experience can't be greater than max.</p>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: `1px solid ${T.gray100}`, display: 'flex', justifyContent: 'flex-end', gap: '8px', background: T.gray50, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 500, background: T.white, border: `1px solid ${T.gray200}`, cursor: 'pointer', color: T.textSub }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid || isSaving}
            style={{
              padding: '7px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 500,
              background: T.orange, color: T.white, border: 'none',
              cursor: (!isValid || isSaving) ? 'not-allowed' : 'pointer',
              opacity: (!isValid || isSaving) ? 0.5 : 1,
            }}
          >
            {isSaving ? 'Saving…' : editingJob ? 'Save Changes' : 'Create Job'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm dialog for archive / restore ─────────────────────────────────
function ConfirmDialog({ message, confirmLabel, confirmColor, onConfirm, onCancel, isLoading }: {
  message: string; confirmLabel: string; confirmColor: string;
  onConfirm: () => void; onCancel: () => void; isLoading: boolean;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '24px 28px', width: '340px', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', fontFamily: FONT }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>Are you sure?</div>
        <div style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.6, marginBottom: '20px' }}>{message}</div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button disabled={isLoading} onClick={onCancel} style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 500, background: '#F9FAFB', color: '#374151', border: '0.5px solid #E5E7EB', borderRadius: '7px', cursor: isLoading ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button disabled={isLoading} onClick={onConfirm} style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 500, background: confirmColor, color: '#fff', border: 'none', borderRadius: '7px', cursor: isLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: isLoading ? 0.7 : 1 }}>
            {isLoading && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────
export default function JobsTab() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<AdminJob | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AdminJob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadJobs = async () => {
    if (!user?.email) return;
    setLoading(true);
    setError(null);
    try {
      setJobs(await listAdminJobs(user.email, true));
    } catch (err: any) {
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadJobs(); }, [user?.email]);

  const openAddModal = () => { setEditingJob(null); setShowForm(true); };
  const openEditModal = (j: AdminJob) => { setEditingJob(j); setShowForm(true); };

  const isArchived = (j: AdminJob) => (j.status || '').toLowerCase() === 'archived';
  const visibleJobs = jobs.filter(j => showArchived ? isArchived(j) : !isArchived(j));

  const handleConfirmAction = async () => {
    if (!confirmTarget || !user?.email) return;
    setIsProcessing(true);
    try {
      if (isArchived(confirmTarget)) {
        await restoreJob(user.email, confirmTarget.job_id);
        showToast(`${confirmTarget.title} restored (set to Closed)`, 'success');
      } else {
        await archiveJob(user.email, confirmTarget.job_id);
        showToast(`${confirmTarget.title} archived`, 'success');
      }
      setConfirmTarget(null);
      loadJobs();
    } catch (err: any) {
      showToast(err.message || 'Failed to update job', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT }}>
      {showForm && (
        <JobFormModal
          editingJob={editingJob}
          onClose={() => setShowForm(false)}
          onSaved={loadJobs}
        />
      )}
      {confirmTarget && (
        <ConfirmDialog
          message={
            isArchived(confirmTarget)
              ? `Restore "${confirmTarget.title}"? It will be set to Closed, not reopened as Active.`
              : `Archive "${confirmTarget.title}"? It will be hidden from the main job lists until restored.`
          }
          confirmLabel={isArchived(confirmTarget) ? 'Restore' : 'Archive'}
          confirmColor={isArchived(confirmTarget) ? T.green : T.red}
          onConfirm={handleConfirmAction}
          onCancel={() => !isProcessing && setConfirmTarget(null)}
          isLoading={isProcessing}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: T.text }}>Job Postings</div>
          <div style={{ fontSize: '11px', color: T.textSub, marginTop: '2px' }}>
            {visibleJobs.length} {showArchived ? 'archived' : 'active/closed'} job{visibleJobs.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowArchived(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '7px',
              fontSize: '12px', fontWeight: 500, cursor: 'pointer',
              background: showArchived ? T.navy : T.white,
              color: showArchived ? T.white : T.textSub,
              border: `0.5px solid ${showArchived ? T.navy : T.gray200}`,
            }}
          >
            <Archive size={13} /> {showArchived ? 'Showing Archived' : 'Show Archived'}
          </button>
          <button
            onClick={openAddModal}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 500, background: T.orange, color: T.white, border: 'none', cursor: 'pointer' }}
          >
            <Plus size={13} /> Add Job
          </button>
        </div>
      </div>

      <div style={{ background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '10px', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
            <Loader2 size={16} color={T.orange} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : error ? (
          <div style={{ padding: '40px', textAlign: 'center', color: T.red, fontSize: '12px' }}>{error}</div>
        ) : visibleJobs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <Briefcase size={22} color={T.gray200} style={{ margin: '0 auto 8px', display: 'block' }} />
            <p style={{ fontSize: '12px', color: T.gray400, margin: 0 }}>
              {showArchived ? 'No archived jobs.' : 'No jobs yet — click Add Job to create one.'}
            </p>
          </div>
        ) : (
          visibleJobs.map((j, i) => (
            <div
              key={j.job_id}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                borderBottom: i < visibleJobs.length - 1 ? `0.5px solid ${T.gray100}` : 'none',
              }}
            >
              <div style={{
                width: '34px', height: '34px', borderRadius: '8px', background: T.orangeLight,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Briefcase size={14} color={T.orange} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: T.text }}>{j.title}</div>
                <div style={{ fontSize: '11px', color: T.gray600, marginTop: '1px' }}>
                  {j.job_id} {j.location && `· ${j.location}`} · {j.experience_min}–{j.experience_max} yrs
                </div>
              </div>

              <StatusBadge status={j.status} />

              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                {!isArchived(j) && (
                  <button
                    onClick={() => openEditModal(j)}
                    style={{ padding: '5px 10px', fontSize: '11px', fontWeight: 500, background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '6px', color: T.textSub, cursor: 'pointer' }}
                  >
                    Edit
                  </button>
                )}
                <button
                  onClick={() => setConfirmTarget(j)}
                  title={isArchived(j) ? 'Restore job' : 'Archive job'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '5px 10px', fontSize: '11px', fontWeight: 500, borderRadius: '6px', cursor: 'pointer',
                    background: isArchived(j) ? T.greenBg : T.redBg,
                    color: isArchived(j) ? T.greenText : T.red,
                    border: `0.5px solid ${isArchived(j) ? '#6EE7B7' : '#FCA5A5'}`,
                  }}
                >
                  {isArchived(j) ? <RotateCcw size={11} /> : <Archive size={11} />}
                  {isArchived(j) ? 'Restore' : 'Archive'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}