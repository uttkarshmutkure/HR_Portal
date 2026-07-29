import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  Briefcase, Loader2, AlertCircle, RefreshCw, Plus,
  ChevronDown, ChevronUp, X, Calendar,
  Edit2, Trash2, Play, Trash, CheckCircle, Clock, Upload 
} from 'lucide-react';
import DashboardLayout from '../components/layout/DashboardLayout';
import { listJobs, JobSummary } from '../../services/screening';
import { useToast } from '../components/ToastContext';

const FONT = 'Inter, sans-serif';

// ── Design tokens (matches Dashboard + Landing) ───────────────────────────────
const T = {
  orange:     '#F07C2D', orangeLight: '#FFF7ED', orangeBorder: 'rgba(240,124,45,0.3)',
  navy:       '#1D194B',
  white:      '#FFFFFF', bg: '#F4F6FB',
  gray50:     '#F9FAFB', gray100: '#F3F4F6', gray200: '#E5E7EB',
  gray400:    '#9CA3AF', gray600: '#6B7280',
  text:       '#111827', textSub: '#6B7280',
  green:      '#10B981', greenBg: '#ECFDF5', greenText: '#065F46',
  red:        '#DC2626', redBg:   '#FEF2F2',
  blue:       '#3B82F6', blueBg:  '#EFF6FF', blueText: '#1D4ED8',
  purple:     '#8B5CF6',
};

const DATA_MANAGER_URL = import.meta.env.VITE_DATA_MANAGER_URL;
const SAVE_INTERVIEWER_URL = import.meta.env.VITE_SAVE_INTERVIEWER_URL;
const RUN_PIPELINE_URL = import.meta.env.VITE_RUN_PIPELINE_URL;

// ── Types ──────────────────────────────────────────────────────────────
export interface DaySlot {
  day: string;
  workMode: 'WFO' | 'WFH';           // ← NEW: per-day work mode
  timeRanges: { start: string; end: string }[];
}

// ── Serialization ──────────────────────────────────────────────────────
// Format: "Monday@WFO:09:00-10:00;14:00-15:00,Tuesday@WFH:11:00-12:00"
// The @workMode segment is optional for backwards-compat (legacy rows won't have it).

export const serializeDaySlots = (daySlots: DaySlot[]): string => {
  return daySlots
    .filter(d => d.timeRanges.length > 0)
    .map(d => {
      const modeTag = d.workMode ? `@${d.workMode}` : '';
      return `${d.day}${modeTag}:${d.timeRanges.map(r => `${r.start}-${r.end}`).join(';')}`;
    })
    .join(',');
};

export const deserializeDaySlots = (slotsStr: string): DaySlot[] => {
  if (!slotsStr || slotsStr.trim() === '') return [];
  if (slotsStr.includes('|')) return [];   // legacy format — skip

  return slotsStr.split(',').map(chunk => {
    chunk = chunk.trim();
    const colonIdx = chunk.indexOf(':');
    if (colonIdx < 0) return null;

    const dayPart = chunk.slice(0, colonIdx).trim();   // e.g. "Monday@WFH"
    const rangesPart = chunk.slice(colonIdx + 1).trim();

    // Split day name and optional work mode
    const atIdx = dayPart.indexOf('@');
    const day = atIdx >= 0 ? dayPart.slice(0, atIdx) : dayPart;
    const workMode: 'WFO' | 'WFH' =
      atIdx >= 0 && dayPart.slice(atIdx + 1).toUpperCase() === 'WFH' ? 'WFH' : 'WFO';

    const timeRanges = rangesPart.split(';').map(r => {
      const [start, end] = r.split('-');
      return { start: start?.trim() || '', end: end?.trim() || '' };
    }).filter(r => r.start && r.end);

    return { day, workMode, timeRanges };
  }).filter(Boolean) as DaySlot[];
};

// ── Legacy helpers (kept for existing rows) ───────────────────────────
const getRawSlotsArray = (slotsStr: string): string[] => {
  if (!slotsStr) return [];
  const rawSplits = slotsStr.split(',');
  const parsed: string[] = [];
  let tempDate = '';
  for (let i = 0; i < rawSplits.length; i++) {
    if (rawSplits[i].includes('|')) {
      if (tempDate) { parsed.push(tempDate + ',' + rawSplits[i]); tempDate = ''; }
      else { parsed.push(rawSplits[i]); }
    } else {
      tempDate = rawSplits[i];
    }
  }
  return parsed;
};

const parseSlots = (slotsStr: string): { day: string; date: string; time: string; raw: string }[] => {
  const rawArray = getRawSlotsArray(slotsStr);
  return rawArray.map(s => {
    const pipeIdx = s.indexOf('|');
    const dateSection = pipeIdx >= 0 ? s.slice(0, pipeIdx).trim() : s.trim();
    const timeSection = pipeIdx >= 0 ? s.slice(pipeIdx + 1).trim() : '';
    const firstComma = dateSection.indexOf(',');
    return {
      day: firstComma >= 0 ? dateSection.slice(0, firstComma).trim() : 'Mon',
      date: firstComma >= 0 ? dateSection.slice(firstComma + 1).trim() : dateSection,
      time: timeSection,
      raw: s
    };
  });
};

const formatTime12 = (timeStr: string) => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  let hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${m} ${ampm}`;
};

// ── Work Mode Badge ───────────────────────────────────────────────────
function WorkModeBadge({ mode }: { mode: 'WFO' | 'WFH' | string }) {
  const isWFH = mode === 'WFH';
  return (
    <span style={{
      padding: '2px 7px', borderRadius: '4px',
      fontWeight: 600, fontSize: '9px', fontFamily: FONT, letterSpacing: '0.04em',
      background: isWFH ? T.blueBg  : '#F0FDF4',
      color:      isWFH ? T.blueText : '#15803D',
      border:     `0.5px solid ${isWFH ? '#BFDBFE' : '#BBF7D0'}`,
    }}>
      {mode || 'WFO'}
    </span>
  );
}

// ── InterviewerCard ───────────────────────────────────────────────────
function InterviewerCard({ inv, onEdit, onDelete, onRemoveSlot }: {
  inv: any;
  onEdit: (inv: any) => void;
  onDelete: (id: string) => void;
  onRemoveSlot: (invId: string, slotIndex: number) => void;
}) {
  const [showSlots, setShowSlots] = useState(false);

  const isNewFormat = inv.slots && !inv.slots.includes('|');
  const daySlots = isNewFormat ? deserializeDaySlots(inv.slots || '') : [];
  const legacySlots = !isNewFormat ? parseSlots(inv.slots || '') : [];

  const slotCount = isNewFormat
    ? daySlots.reduce((acc, d) => acc + d.timeRanges.length, 0)
    : legacySlots.length;

  const roundText = inv.round === 'technical' ? 'Round 2' : inv.round === 'hr' ? 'HR Round' : 'Round 1';

  // Collect all distinct work modes across days for the card header badge
  const allModes = isNewFormat
    ? [...new Set(daySlots.map(d => d.workMode || 'WFO'))]
    : [inv.work_mode || 'WFO'];

  return (
    <div style={{ border: `0.5px solid ${T.gray200}`, borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.gray50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: T.orangeLight, border: `0.5px solid ${T.orangeBorder}`, color: T.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, fontFamily: FONT, flexShrink: 0 }}>
            {inv.name.split(' ').map((n: string) => n[0]).join('')}
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: T.text, fontFamily: FONT }}>{inv.name}</div>
            <div style={{ fontSize: '10px', color: T.gray600, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginTop: '1px' }}>
              {inv.role} · {inv.email} <span style={{ color: T.orange, fontWeight: 600 }}>· {roundText}</span>
              {/* Show per-day mode badges, or fallback to top-level work_mode */}
              {allModes.map(m => <WorkModeBadge key={m} mode={m} />)}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => onEdit(inv)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '6px', background: T.white, border: `0.5px solid ${T.gray200}`, color: T.gray600, cursor: 'pointer', transition: 'all .15s' }}
            title="Edit Interviewer"
          >
            <Edit2 size={12} />
          </button>

          <button
            onClick={() => { if (window.confirm('Remove this interviewer completely?')) onDelete(inv.id); }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '6px', background: T.redBg, border: '0.5px solid #FCA5A5', color: T.red, cursor: 'pointer', transition: 'all .15s' }}
            title="Remove Interviewer"
          >
            <Trash2 size={12} />
          </button>

          <button
            onClick={() => setShowSlots(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 500, color: T.gray600, fontFamily: FONT, background: T.white, border: `0.5px solid ${T.gray200}`, padding: '4px 10px', borderRadius: '20px', cursor: 'pointer', transition: 'background .15s', marginLeft: '4px' }}
          >
            <Clock size={12} style={{ color: '#9CA3AF' }} />
            {slotCount} Slot(s)
            <ChevronDown size={12} style={{ color: '#9CA3AF', transform: showSlots ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          </button>
        </div>
      </div>

      {showSlots && (
        <div style={{ padding: '10px 14px', borderTop: `0.5px solid ${T.gray200}`, background: T.white, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {isNewFormat && daySlots.length === 0 && (
            <div style={{ fontSize: '11px', color: '#9CA3AF', padding: '4px 0' }}>No slots available.</div>
          )}

          {isNewFormat && daySlots.map((ds, di) => (
            <div key={di}>
              {/* Day header with work mode badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: FONT }}>{ds.day}</span>
                <WorkModeBadge mode={ds.workMode || 'WFO'} />
              </div>
              {ds.timeRanges.map((tr, ti) => (
                <div key={ti} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', background: T.gray50, borderRadius: '6px', border: `0.5px solid ${T.gray200}`, marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Clock size={11} style={{ color: T.orange, flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', color: T.textSub, fontFamily: FONT }}>{formatTime12(tr.start)} – {formatTime12(tr.end)}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {!isNewFormat && legacySlots.length === 0 && (
            <div style={{ fontSize: '11px', color: '#9CA3AF', padding: '4px 0' }}>No slots available.</div>
          )}
          {!isNewFormat && legacySlots.map((slot, si) => (
            <div key={si} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: T.gray50, borderRadius: '6px', border: `0.5px solid ${T.gray200}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={11} style={{ color: T.orange, flexShrink: 0 }} />
                <span style={{ fontSize: '11px', fontWeight: 600, color: T.text, fontFamily: FONT }}>{slot.day}, {slot.date}</span>
                <span style={{ fontSize: '11px', color: T.gray400 }}>·</span>
                <span style={{ fontSize: '11px', color: T.textSub, fontFamily: FONT }}>{slot.time}</span>
              </div>
              <X
                size={14}
                style={{ cursor: 'pointer', color: '#9CA3AF' }}
                onClick={() => { if (window.confirm('Delete this time slot?')) onRemoveSlot(inv.id, si); }}
                title="Remove this slot"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 30) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

// ── DayScheduler ──────────────────────────────────────────────────────
// Now includes a per-day WFO/WFH toggle next to each enabled day.
function DayScheduler({ value, onChange }: { value: DaySlot[]; onChange: (slots: DaySlot[]) => void }) {
  const getDayData = (day: string): DaySlot =>
    value.find(d => d.day === day) || { day, workMode: 'WFO', timeRanges: [] };

  const isDayEnabled = (day: string) => getDayData(day).timeRanges.length > 0;

  const toggleDay = (day: string) => {
    if (isDayEnabled(day)) {
      onChange(value.filter(d => d.day !== day));
    } else {
      onChange([...value, { day, workMode: 'WFO', timeRanges: [{ start: '09:00', end: '10:00' }] }]);
    }
  };

  const setDayWorkMode = (day: string, mode: 'WFO' | 'WFH') => {
    onChange(value.map(d => d.day === day ? { ...d, workMode: mode } : d));
  };

  const addTimeRange = (day: string) => {
    const existing = getDayData(day);
    const updated: DaySlot = { ...existing, timeRanges: [...existing.timeRanges, { start: '09:00', end: '10:00' }] };
    onChange(value.map(d => d.day === day ? updated : d));
  };

  const removeTimeRange = (day: string, index: number) => {
    const existing = getDayData(day);
    const newRanges = existing.timeRanges.filter((_, i) => i !== index);
    if (newRanges.length === 0) {
      onChange(value.filter(d => d.day !== day));
    } else {
      onChange(value.map(d => d.day === day ? { ...d, timeRanges: newRanges } : d));
    }
  };

  const updateTimeRange = (day: string, index: number, field: 'start' | 'end', val: string) => {
    const existing = getDayData(day);
    const newRanges = existing.timeRanges.map((r, i) => i === index ? { ...r, [field]: val } : r);
    onChange(value.map(d => d.day === day ? { ...d, timeRanges: newRanges } : d));
  };

  const selectStyle: React.CSSProperties = {
    padding: '7px 10px',
    borderRadius: '6px',
    border: '1px solid #E5E7EB',
    fontSize: '12px',
    background: '#fff',
    color: '#374151',
    outline: 'none',
    cursor: 'pointer',
    minWidth: '110px',
    fontFamily: FONT,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>
      {DAYS_OF_WEEK.map(day => {
        const enabled = isDayEnabled(day);
        const dayData = getDayData(day);

        return (
          <div key={day} style={{ borderBottom: '0.5px solid #F3F4F6', paddingBottom: '10px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                {/* Day toggle + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '90px', paddingTop: '8px' }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleDay(day)}
                    style={{ width: '15px', height: '15px', accentColor: '#5B5FCF', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: enabled ? '#111827' : '#9CA3AF', fontFamily: FONT, transition: 'color .15s' }}>
                    {day}
                  </span>
                </div>

                {/* Time ranges + WFO/WFH toggle stacked */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {!enabled && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '7px 0' }}>
                      <select disabled style={{ ...selectStyle, color: '#C0C4CC', flex: 1 }}>
                        <option>Start Time</option>
                      </select>
                      <span style={{ color: '#9CA3AF', fontWeight: 500 }}>—</span>
                      <select disabled style={{ ...selectStyle, color: '#C0C4CC', flex: 1 }}>
                        <option>End Time</option>
                      </select>
                    </div>
                  )}
                  {enabled && dayData.timeRanges.map((range, ri) => (
                    <div key={ri} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <select
                        value={range.start}
                        onChange={e => updateTimeRange(day, ri, 'start', e.target.value)}
                        style={{ ...selectStyle, flex: 1 }}
                      >
                        {TIME_OPTIONS.map(t => <option key={t} value={t}>{formatTime12(t)}</option>)}
                      </select>
                      <span style={{ color: '#9CA3AF', fontWeight: 500, fontSize: '14px' }}>—</span>
                      <select
                        value={range.end}
                        onChange={e => updateTimeRange(day, ri, 'end', e.target.value)}
                        style={{ ...selectStyle, flex: 1 }}
                      >
                        {TIME_OPTIONS.map(t => <option key={t} value={t}>{formatTime12(t)}</option>)}
                      </select>
                      <button onClick={() => removeTimeRange(day, ri)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'flex', alignItems: 'center', padding: '4px' }}>
                        <Trash size={14} />
                      </button>
                      {ri === dayData.timeRanges.length - 1 && (
                        <button onClick={() => addTimeRange(day)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5B5FCF', display: 'flex', alignItems: 'center', padding: '4px' }}>
                          <Plus size={16} />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* WFO/WFH toggle — shown below time rows when day is enabled */}
                  {enabled && (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                      {(['WFO', 'WFH'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setDayWorkMode(day, mode)}
                          style={{
                            padding: '4px 14px',
                            fontSize: '11px',
                            fontWeight: 600,
                            fontFamily: FONT,
                            borderRadius: '6px',
                            border: `1px solid ${dayData.workMode === mode ? (mode === 'WFH' ? '#1D4ED8' : '#15803D') : '#E5E7EB'}`,
                            cursor: 'pointer',
                            transition: 'all .15s',
                            background: dayData.workMode === mode
                              ? (mode === 'WFH' ? '#EFF6FF' : '#F0FDF4')
                              : '#fff',
                            color: dayData.workMode === mode
                              ? (mode === 'WFH' ? '#1D4ED8' : '#15803D')
                              : '#9CA3AF',
                          }}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  )}
                 </div>
              </div>
            </div>
        );
      })}
    </div>
  );
}

function JobRow({ job, autoExpand }: { job: JobSummary; autoExpand?: boolean }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(autoExpand ?? false);
  const [subTab, setSubTab] = useState<'jd' | 'setup'>('jd');

  const [interviewers, setInterviewers] = useState<any[]>([]);

  useEffect(() => {
    fetch(DATA_MANAGER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'GET_INTERVIEWERS', jobId: job.job_id }),
    })
      .then(r => r.json())
      .then(d => { if (d.success) setInterviewers(d.interviewers); })
      .catch(e => console.error('Failed to load interviewers', e));
  }, [job.job_id]);

  const [showModal, setShowModal] = useState(false);
  const [editingInv, setEditingInv] = useState<any>(null);

  const iconColors: Record<number, { bg: string; color: string }> = {
    0: { bg: '#FFF7ED', color: '#F07C2D' }, 1: { bg: '#EFF6FF', color: '#3B82F6' },
    2: { bg: '#F5F3FF', color: '#8B5CF6' }, 3: { bg: '#ECFDF5', color: '#10B981' },
  };
  const ic = iconColors[Math.abs(job.job_id.charCodeAt(0)) % 4];

  const [uploadingResume, setUploadingResume] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleUploadClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevents accordion from toggling open/closed!
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingResume(true);
    const formData = new FormData();
    formData.append('job_id', job.job_id);
    Array.from(files).forEach((f) => formData.append('resumes', f));

    try {
      const UPLOAD_URL = import.meta.env.VITE_UPLOAD_RESUME_URL;
      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        body: formData, // NOTE: Never manually set Content-Type for FormData in fetch()
      });

      if (!res.ok) throw new Error('Upload failed');
      
      showToast(`${files.length} resume(s) sent to bucket! Pipeline incoming...`, 'success');
      startPolling(); // Immediately kick UI into listening mode
    } catch (err) {
      showToast('Failed to upload resumes to storage.', 'error');
    } finally {
      setUploadingResume(false);
      if (fileInputRef.current) fileInputRef.current.value = ''; // Reset input
    }
  };

  const handleResultsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/jobs/${job.job_id}`);
  };

  const [screenStatus, setScreenStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [screenError, setScreenError] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    if (safetyTimeoutRef.current) { clearTimeout(safetyTimeoutRef.current); safetyTimeoutRef.current = null; }
  };

  const startPolling = () => {
    stopPolling();

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(DATA_MANAGER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'GET_JOB_STATUS', jobId: job.job_id }),
        });
        const data = await res.json();
        const status: string = data.pipeline_status ?? '';

        if (status === 'COMPLETED') {
          stopPolling();
          setScreenStatus('success');
          setTimeout(() => setScreenStatus('idle'), 3000);
        } else if (status === 'FAILED') {
          stopPolling();
          setScreenStatus('error');
          setScreenError(data.pipeline_error || 'Pipeline failed — click to retry');
        }
      } catch { /* network blip — keep polling */ }
    }, 5000);

    safetyTimeoutRef.current = setTimeout(() => {
      stopPolling();
      setScreenStatus('error');
      setScreenError('Timed out — pipeline may still be running. Check logs.');
    }, 10 * 60 * 1000);
  };

  useEffect(() => {
    const checkInitialStatus = async () => {
      try {
        const res = await fetch(DATA_MANAGER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'GET_JOB_STATUS', jobId: job.job_id }),
        });
        const data = await res.json();
        const status: string = data.pipeline_status ?? '';

        if (status === 'RUNNING') {
          setScreenStatus('loading');
          startPolling();
        } else if (status === 'FAILED') {
          setScreenStatus('error');
          setScreenError(data.pipeline_error || 'Pipeline failed — click to retry');
        }
      } catch { /* ignore on mount */ }
    };

    checkInitialStatus();
    return () => stopPolling();
  }, [job.job_id]);

  const handleRunScreening = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (screenStatus === 'loading') return;

    setScreenStatus('loading');
    setScreenError(null);

    fetch(RUN_PIPELINE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: job.job_id }),
    }).catch(() => {});

    startPolling();
  };

  const handleDeleteInterviewer = async (invId: string) => {
    const inv = interviewers.find((i: any) => i.id === invId);
    if (!inv) return;

    try {
      const payload = { action: 'DELETE', jobId: job.job_id, round: inv.round || 'round1', interviewer: inv };
      await fetch(SAVE_INTERVIEWER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const delRefresh = await fetch(DATA_MANAGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'GET_INTERVIEWERS', jobId: job.job_id }),
      });
      const delData = await delRefresh.json();
      if (delData.success) setInterviewers(delData.interviewers);
      showToast('Interviewer removed successfully', 'success');
    } catch (e) {
      console.error('Failed to delete interviewer in BigQuery', e);
      showToast('Failed to delete interviewer from database.', 'error');
    }
  };

  const handleRemoveSlotFromCard = async (invId: string, slotIndex: number) => {
    const inv = interviewers.find((i: any) => i.id === invId);
    if (!inv) return;
    const rawSlots = getRawSlotsArray(inv.slots);
    const updatedSlots = rawSlots.filter((_, i) => i !== slotIndex).join(',');
    const updatedInv = { ...inv, slots: updatedSlots };

    try {
      const payload = { jobId: job.job_id, round: updatedInv.round || 'round1', interviewer: updatedInv };
      await fetch(SAVE_INTERVIEWER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const slotRefresh = await fetch(DATA_MANAGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'GET_INTERVIEWERS', jobId: job.job_id }),
      });
      const slotData = await slotRefresh.json();
      if (slotData.success) setInterviewers(slotData.interviewers);
    } catch (e) {
      console.error('Failed to update slot in BigQuery', e);
      alert('Failed to remove slot from database.');
    }
  };

  const openAddModal = () => { setEditingInv(null); setShowModal(true); };
  const openEditModal = (inv: any) => { setEditingInv(inv); setShowModal(true); };

  const [showReferModal, setShowReferModal] = useState(false);

 

  // ── InterviewerModal ───────────────────────────────────────────────
  const InterviewerModal = () => {
    const [name, setName] = useState(editingInv?.name || '');
    const [email, setEmail] = useState(editingInv?.email || '');
    const [role, setRole] = useState(editingInv?.role || '');
    const [round, setRound] = useState(editingInv?.round || 'round1');
    const [isSaving, setIsSaving] = useState(false);

    // Initialize day slots — parse existing or empty
    const [daySlots, setDaySlots] = useState<DaySlot[]>(() => {
      if (editingInv?.slots) {
        const parsed = deserializeDaySlots(editingInv.slots);
        return parsed.length > 0 ? parsed : [];
      }
      return [];
    });

    const handleSave = async () => {
      if (!name || !email) return;
      setIsSaving(true);

      const invId = editingInv ? editingInv.id : Date.now().toString();
      const serializedSlots = serializeDaySlots(daySlots);

      // Derive a top-level work_mode for BQ backward compat:
      // "MIXED" if days have different modes, otherwise the single mode.
      const modes = [...new Set(daySlots.map(d => d.workMode || 'WFO'))];
      const topLevelWorkMode = modes.length === 1 ? modes[0] : modes.length > 1 ? 'MIXED' : 'WFO';

      const newInv = { id: invId, name, email, role, round, work_mode: topLevelWorkMode, slots: serializedSlots };

      const payload = { jobId: job.job_id, round, interviewer: newInv };

      try {
        const response = await fetch(SAVE_INTERVIEWER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to save to BigQuery');

        showToast(editingInv ? 'Interviewer updated successfully' : 'New interviewer added', 'success');
        const refreshRes = await fetch(DATA_MANAGER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'GET_INTERVIEWERS', jobId: job.job_id }),
        });
        const refreshData = await refreshRes.json();
        if (refreshData.success) setInterviewers(refreshData.interviewers);
        setShowModal(false);
      } catch (err) {
        console.error('Error saving interviewer', err);
        showToast('Failed to save interviewer.', 'error');
      } finally {
        setIsSaving(false);
      }
    };

    return (
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}
        onClick={e => e.target === e.currentTarget && setShowModal(false)}
      >
        <div style={{ background: T.white, borderRadius: '14px', width: '100%', maxWidth: '540px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.14)', fontFamily: FONT }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.gray100}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: T.text, fontFamily: FONT }}>{editingInv ? 'Edit Interviewer' : 'Add Interviewer'}</h3>
            <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.gray400, display: 'flex', alignItems: 'center', padding: '2px' }}><X size={16} /></button>
          </div>

          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto', flex: 1 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', display: 'block' }}>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Aditi Sharma" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', display: 'block' }}>Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="aditi@atgeirsolutions.com" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', display: 'block' }}>Role</label>
                <input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Tech Lead" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', display: 'block' }}>Round</label>
                <select
                  value={round}
                  onChange={e => setRound(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '13px', outline: 'none', boxSizing: 'border-box', background: '#fff', appearance: 'auto' }}
                >
                  <option value="round1">Round 1</option>
                  <option value="technical">Round 2</option>
                  <option value="hr">HR Round</option>
                </select>
              </div>
            </div>

            {/* Work mode is now set per-day inside DayScheduler — no global dropdown */}
            <div style={{ marginTop: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '10px', display: 'block' }}>Weekly Availability</label>
              <div style={{ background: '#FAFAFA', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid #EEEFF1' }}>
                  <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid #5B5FCF', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '2px', flexShrink: 0 }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#5B5FCF' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', fontFamily: FONT }}>Weekly availability</div>
                    <div style={{ fontSize: '11px', color: '#6B7280', fontFamily: FONT }}>
                      Check a day, set time slots, and choose <strong>WFO</strong> or <strong>WFH</strong> per day.
                    </div>
                  </div>
                </div>
                <DayScheduler value={daySlots} onChange={setDaySlots} />
                {daySlots.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#9CA3AF', textAlign: 'center', paddingTop: '4px', fontFamily: FONT }}>
                    Check a day above to add availability slots.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ padding: '12px 20px', borderTop: `1px solid ${T.gray100}`, display: 'flex', justifyContent: 'flex-end', gap: '8px', background: T.gray50, flexShrink: 0 }}>
            <button onClick={() => setShowModal(false)} style={{ padding: '7px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 500, background: T.white, border: `1px solid ${T.gray200}`, cursor: 'pointer', color: T.textSub, fontFamily: FONT }}>Cancel</button>
            <button
              onClick={handleSave}
              disabled={!name || !email || isSaving}
              style={{ padding: '7px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 500, background: T.orange, color: T.white, border: 'none', cursor: (!name || !email || isSaving) ? 'not-allowed' : 'pointer', opacity: (!name || !email || isSaving) ? 0.5 : 1, fontFamily: FONT, transition: 'opacity .15s' }}
            >
              {isSaving ? 'Saving…' : editingInv ? 'Save Changes' : 'Save Interviewer'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── ReferFriendModal ───────────────────────────────────────────────
  const ReferFriendModal = () => {
    const [resumeFile, setResumeFile] = useState<File | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [firstName, setFirstName] = useState('');
    const [middleName, setMiddleName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phoneCode, setPhoneCode] = useState('+91');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [gender, setGender] = useState('');
    const [expYears, setExpYears] = useState('');
    const [expMonths, setExpMonths] = useState('');
    const [salaryCurrency, setSalaryCurrency] = useState('INR');
    const [salaryAmount, setSalaryAmount] = useState('');
    const [salaryFreq, setSalaryFreq] = useState('NA');
    const [fitReason, setFitReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const referFileRef = useRef<HTMLInputElement | null>(null);

    const inputStyle: React.CSSProperties = {
      width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB',
      fontSize: '13px', outline: 'none', boxSizing: 'border-box', fontFamily: FONT, color: T.text,
    };
    const labelStyle: React.CSSProperties = {
      fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px', display: 'block', fontFamily: FONT,
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) setResumeFile(f);
    };

    const handleSubmit = async () => {
      setIsSubmitting(true);
      try {
        // TODO: wire to actual referral endpoint once available
        showToast(`Referral submitted for ${firstName} ${lastName}!`, 'success');
        setShowReferModal(false);
      } catch (err) {
        showToast('Failed to submit referral.', 'error');
      } finally {
        setIsSubmitting(false);
      }
    };

    return (
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}
        onClick={e => e.target === e.currentTarget && setShowReferModal(false)}
      >
        <div style={{ background: T.white, borderRadius: '14px', width: '100%', maxWidth: '540px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.14)', fontFamily: FONT }}>
          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.gray100}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: T.text, fontFamily: FONT }}>Refer a friend</h3>
            <button onClick={() => setShowReferModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.gray400, display: 'flex', alignItems: 'center', padding: '2px' }}><X size={18} /></button>
          </div>

          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px', overflowY: 'auto', flex: 1 }}>
            {/* Job Position */}
            <div>
              <label style={labelStyle}>Job Position</label>
              <select value={job.job_id} disabled style={{ ...inputStyle, background: '#F9FAFB', cursor: 'not-allowed', appearance: 'auto' }}>
                <option value={job.job_id}>{job.title}</option>
              </select>
            </div>

            {/* Resume dropzone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${dragOver ? T.orange : '#93E5D0'}`,
                background: dragOver ? T.orangeLight : '#E6FBF6',
                borderRadius: '8px', padding: '28px 16px', textAlign: 'center', cursor: 'pointer', transition: 'all .15s',
              }}
              onClick={() => referFileRef.current?.click()}
            >
              <input type="file" ref={referFileRef} style={{ display: 'none' }} onChange={e => setResumeFile(e.target.files?.[0] ?? null)} />
              <div style={{ fontSize: '13px', color: '#374151', fontFamily: FONT }}>
                {resumeFile ? (
                  <span style={{ fontWeight: 600 }}>{resumeFile.name}</span>
                ) : (
                  <>Drag and drop resume here or <span style={{ color: '#5B5FCF', fontWeight: 600 }}>📎 select from computer.</span></>
                )}
              </div>
              <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px', fontFamily: FONT }}>You can upload file upto 10MB</div>
            </div>

            {/* Name row 1 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle}>First Name</label>
                <input value={firstName} onChange={e => setFirstName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Middle Name</label>
                <input value={middleName} onChange={e => setMiddleName(e.target.value)} style={inputStyle} />
              </div>
            </div>

            {/* Name row 2 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Last Name</label>
                <input value={lastName} onChange={e => setLastName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Mobile Phone</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <select value={phoneCode} onChange={e => setPhoneCode(e.target.value)} style={{ ...inputStyle, width: '72px', flexShrink: 0, background: '#F9FAFB', appearance: 'auto' }}>
                    <option value="+91">+91</option>
                    <option value="+1">+1</option>
                    <option value="+44">+44</option>
                  </select>
                  <input value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle} />
                </div>
              </div>
            </div>

            {/* Email */}
            <div>
              <label style={labelStyle}>Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" style={inputStyle} />
            </div>

            {/* Gender */}
            <div>
              <label style={labelStyle}>Gender</label>
              <select value={gender} onChange={e => setGender(e.target.value)} style={{ ...inputStyle, appearance: 'auto' }}>
                <option value="">Select an option</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>

            {/* Experience */}
            <div>
              <label style={labelStyle}>Experience</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ display: 'flex' }}>
                  <input value={expYears} onChange={e => setExpYears(e.target.value)} placeholder="Ex: 3" style={{ ...inputStyle, borderRadius: '8px 0 0 8px', borderRight: 'none' }} />
                  <span style={{ padding: '10px 14px', background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: '0 8px 8px 0', fontSize: '13px', color: '#374151', fontFamily: FONT, whiteSpace: 'nowrap' }}>Years</span>
                </div>
                <div style={{ display: 'flex' }}>
                  <input value={expMonths} onChange={e => setExpMonths(e.target.value)} style={{ ...inputStyle, borderRadius: '8px 0 0 8px', borderRight: 'none' }} />
                  <span style={{ padding: '10px 14px', background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: '0 8px 8px 0', fontSize: '13px', color: '#374151', fontFamily: FONT, whiteSpace: 'nowrap' }}>Months</span>
                </div>
              </div>
            </div>

            {/* Current Salary */}
            <div>
              <label style={labelStyle}>Current Salary</label>
              <div style={{ display: 'flex' }}>
                <select value={salaryCurrency} onChange={e => setSalaryCurrency(e.target.value)} style={{ ...inputStyle, width: '80px', flexShrink: 0, borderRadius: '8px 0 0 8px', borderRight: 'none', background: '#F9FAFB', appearance: 'auto' }}>
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                </select>
                <input value={salaryAmount} onChange={e => setSalaryAmount(e.target.value)} style={{ ...inputStyle, borderRadius: 0 }} />
                <select value={salaryFreq} onChange={e => setSalaryFreq(e.target.value)} style={{ ...inputStyle, width: '80px', flexShrink: 0, borderRadius: '0 8px 8px 0', borderLeft: 'none', background: '#F9FAFB', appearance: 'auto' }}>
                  <option value="NA">NA</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Annual">Annual</option>
                </select>
              </div>
            </div>

            {/* Fit reason */}
            <div>
              <label style={labelStyle}>Why do you think this person would be a good fit for this position and for the organization?</label>
              <textarea
                value={fitReason}
                onChange={e => setFitReason(e.target.value)}
                placeholder="Type something here"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
          </div>

          <div style={{ padding: '14px 20px', borderTop: `1px solid ${T.gray100}`, display: 'flex', justifyContent: 'flex-end', gap: '8px', background: T.gray50, flexShrink: 0 }}>
            <button onClick={() => setShowReferModal(false)} style={{ padding: '8px 16px', borderRadius: '7px', fontSize: '13px', fontWeight: 500, background: T.white, border: `1px solid ${T.gray200}`, cursor: 'pointer', color: T.textSub, fontFamily: FONT }}>Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!firstName || !lastName || !email || isSubmitting}
              style={{ padding: '8px 20px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, background: '#5B5FCF', color: T.white, border: 'none', cursor: (!firstName || !lastName || !email || isSubmitting) ? 'not-allowed' : 'pointer', opacity: (!firstName || !lastName || !email || isSubmitting) ? 0.6 : 1, fontFamily: FONT }}
            >
              {isSubmitting ? 'Submitting…' : 'Refer'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ borderBottom: `0.5px solid ${T.gray100}` }}>
      {showModal && <InterviewerModal />}
      {showReferModal && <ReferFriendModal />}

      <div onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '13px 18px', cursor: 'pointer', transition: 'background 0.12s' }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.gray50} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        <div style={{ color: T.gray400, display: 'flex', alignItems: 'center' }}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</div>
        <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: ic.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Briefcase size={14} style={{ color: ic.color }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: T.text, fontFamily: FONT }}>{job.title}</div>
            <button
              onClick={(e) => { e.stopPropagation(); setShowReferModal(true); }}
              style={{ padding: '4px 11px', fontSize: '11px', fontWeight: 500, fontFamily: FONT, background: T.white, border: '0.5px solid #C7D2FE', borderRadius: '6px', color: '#5B5FCF', cursor: 'pointer', transition: 'background .12s', flexShrink: 0 }}
            >
              Refer a friend
            </button>
          </div>
          <div style={{ fontSize: '11px', color: T.gray600, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'wrap' }}>
            {job.location && `${job.location} · `}{job.experience_min}–{job.experience_max} yrs ·{' '}
            {job.must_have_skills.slice(0, 3).map((s) => <span key={s} style={{ padding: '1px 7px', borderRadius: '20px', fontSize: '10px', fontWeight: 500, background: T.orangeLight, color: '#9A3412', margin: '0 2px' }}>{s}</span>)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileSelected} 
              accept=".pdf" 
              multiple 
              style={{ display: 'none' }} 
            />

            <button
              onClick={handleUploadClick}
              disabled={uploadingResume || screenStatus === 'loading'}
              title="Upload candidate PDF resumes for this job"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '5px 12px', fontSize: '11px', fontWeight: 500, fontFamily: FONT,
                background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '6px',
                color: T.textSub, cursor: uploadingResume ? 'wait' : 'pointer', transition: 'all .15s'
              }}
            >
              {uploadingResume ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={11} style={{ color: T.blue }} />}
              {uploadingResume ? 'Uploading…' : 'Upload Resumes'}
            </button>
            <button
              onClick={handleRunScreening}
              disabled={screenStatus === 'loading'}
              title={screenError ?? 'Run AI screening pipeline for this job'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '5px 12px', fontSize: '11px', fontWeight: 500, fontFamily: FONT,
                borderRadius: '6px', cursor: screenStatus === 'loading' ? 'not-allowed' : 'pointer',
                border: screenStatus === 'error'   ? '0.5px solid #FCA5A5'
                      : screenStatus === 'success' ? '0.5px solid #6EE7B7'
                      : `0.5px solid ${T.orangeBorder}`,
                background: screenStatus === 'error'   ? T.redBg
                          : screenStatus === 'success' ? T.greenBg
                          : T.orangeLight,
                color: screenStatus === 'error'   ? T.red
                     : screenStatus === 'success' ? '#059669'
                     : '#C2540A',
                opacity: screenStatus === 'loading' ? 0.75 : 1,
                transition: 'all .15s',
              }}
            >
              {screenStatus === 'loading' && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />}
              {screenStatus === 'success' && <CheckCircle size={11} />}
              {screenStatus === 'idle'    && <Play size={11} />}
              {screenStatus === 'error'   && <X size={11} />}
              {screenStatus === 'loading' ? 'Running…' : screenStatus === 'success' ? 'Done!' : screenStatus === 'error' ? (screenError || 'Failed') : 'Run Screening'}
            </button>
            <button onClick={handleResultsClick} style={{ padding: '5px 12px', fontSize: '11px', fontWeight: 500, fontFamily: FONT, background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '6px', color: T.textSub, cursor: 'pointer', transition: 'background .12s' }}>Results</button>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 18px 16px 68px', animation: 'fadeIn 0.2s ease-in-out' }}>
          <div style={{ background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', gap: '0', padding: '0 16px', borderBottom: `0.5px solid ${T.gray200}`, background: T.gray50 }}>
              <button onClick={(e) => { e.stopPropagation(); setSubTab('jd'); }} style={{ background: 'none', border: 'none', padding: '10px 0', marginRight: '20px', fontSize: '12px', fontWeight: 600, fontFamily: FONT, cursor: 'pointer', transition: 'color 0.15s', color: subTab === 'jd' ? T.orange : T.gray600, borderBottom: subTab === 'jd' ? `2px solid ${T.orange}` : '2px solid transparent', marginBottom: '-1px' }}>Job Description</button>
              <button onClick={(e) => { e.stopPropagation(); setSubTab('setup'); }} style={{ background: 'none', border: 'none', padding: '10px 0', fontSize: '12px', fontWeight: 600, fontFamily: FONT, cursor: 'pointer', transition: 'color 0.15s', color: subTab === 'setup' ? T.orange : T.gray600, borderBottom: subTab === 'setup' ? `2px solid ${T.orange}` : '2px solid transparent', marginBottom: '-1px' }}>Hiring Setup</button>
            </div>
            <div style={{ padding: '14px 16px', background: T.white }}>
              {subTab === 'jd' ? (
                <p style={{ fontSize: '12px', lineHeight: 1.65, color: T.textSub, fontFamily: FONT, whiteSpace: 'pre-line', margin: 0 }}>{(job as any).description || `We are seeking a highly skilled ${job.title}...`}</p>
              ) : (
                <div style={{ animation: 'fadeIn 0.2s ease-in-out' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: FONT }}>Assigned Interviewers & Slots</div>
                    <button onClick={openAddModal} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, fontFamily: FONT, background: T.orangeLight, border: `0.5px solid ${T.orangeBorder}`, color: '#C2540A', cursor: 'pointer' }}>
                      <Plus size={12} /> Add Interviewer
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {interviewers.map((inv: any, i: number) => (
                      <InterviewerCard
                        key={inv.id || i}
                        inv={inv}
                        onEdit={openEditModal}
                        onDelete={handleDeleteInterviewer}
                        onRemoveSlot={handleRemoveSlotFromCard}
                      />
                    ))}
                    {interviewers.length === 0 && (
                      <div style={{ fontSize: '12px', color: T.gray400, padding: '20px 0', textAlign: 'center', fontFamily: FONT }}>No interviewers assigned yet.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function JobListPage() {
  const location = useLocation();
  const expandJobId: string | undefined = (location.state as any)?.expandJobId;
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadJobs = async () => {
    try {
      setLoadingJobs(true); setFetchError(null);
      const loadedJobs = await listJobs();
      setJobs(loadedJobs);
    }
    catch (err: any) { setFetchError(err?.message || 'Failed to load jobs'); }
    finally { setLoadingJobs(false); }
  };

  useEffect(() => { loadJobs(); }, []);

  return (
    <DashboardLayout breadcrumb="Dashboard / All Jobs">
      <div style={{ padding: '20px', fontFamily: FONT, background: T.bg, minHeight: '100%' }}>

        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: T.text, letterSpacing: '-0.01em', fontFamily: FONT }}>All Jobs</div>
            <div style={{ fontSize: '11px', color: T.gray400, marginTop: '2px', fontFamily: FONT }}>Manage positions and run AI screening</div>
          </div>
          <button
            onClick={loadJobs}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: T.white, color: T.textSub, border: `0.5px solid ${T.gray200}`, borderRadius: '7px', padding: '7px 13px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: FONT, transition: 'background .12s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.gray50}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = T.white}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Jobs card */}
        <div style={{ background: T.white, border: `0.5px solid ${T.gray200}`, borderRadius: '10px' }}>
          <div style={{ padding: '11px 18px', borderBottom: `0.5px solid ${T.gray100}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '10px 10px 0 0' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: T.text, fontFamily: FONT }}>Job listings</span>
            {!loadingJobs && !fetchError && (
              <span style={{ fontSize: '11px', color: T.gray400, fontFamily: FONT }}>{jobs.length} position{jobs.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {loadingJobs && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '56px 0', color: T.gray400, fontSize: '12px', fontFamily: FONT }}>
              <Loader2 size={16} style={{ color: T.orange, animation: 'spin 1s linear infinite' }} /> Loading jobs…
            </div>
          )}
          {!loadingJobs && fetchError && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '56px 0', color: T.red, fontSize: '12px', fontFamily: FONT }}>
              <AlertCircle size={15} /> {fetchError}
            </div>
          )}
          {!loadingJobs && !fetchError && jobs.map(job => <JobRow key={job.job_id} job={job} autoExpand={expandJobId === job.job_id} />)}
          {!loadingJobs && !fetchError && jobs.length === 0 && (
            <div style={{ padding: '56px 0', textAlign: 'center', fontFamily: FONT }}>
              <Briefcase size={24} color={T.gray200} style={{ margin: '0 auto 8px', display: 'block' }} />
              <div style={{ fontSize: '12px', color: T.gray400 }}>No jobs found.</div>
            </div>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
}