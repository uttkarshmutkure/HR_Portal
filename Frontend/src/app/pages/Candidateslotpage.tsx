import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { Calendar as CalendarIcon, CheckCircle, CalendarX2, Info } from 'lucide-react';

const FONT = 'Inter, sans-serif';
const COLOR_PRIMARY = '#1D194B';
const COLOR_ACCENT = '#F07C2D';
const BACKGROUND_PAGE = '#F4F3F7';
const GET_CANDIDATE_SLOTS_URL = import.meta.env.VITE_GET_CANDIDATE_SLOTS_URL;

const toLocalYYYYMMDD = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const DAY_NAME_TO_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

// Returns the date (YYYY-MM-DD) of the next upcoming occurrence of the given day name.
// If today IS that day, it rolls forward to next week (since "today" slots are excluded
// by the backend anyway).
const nextDateForDay = (dayName: string): string => {
  const targetIdx = DAY_NAME_TO_INDEX[dayName];
  if (targetIdx === undefined) return toLocalYYYYMMDD(new Date());

  const today = new Date();
  const todayIdx = today.getDay();
  let diff = (targetIdx - todayIdx + 7) % 7;
  if (diff === 0) diff = 7; // if same day, jump to next week

  const result = new Date(today);
  result.setDate(today.getDate() + diff);
  return toLocalYYYYMMDD(result);
};

const isExpired = (issuedAtMs: number) => {
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  return Date.now() > issuedAtMs + TWO_HOURS_MS;
};

export default function CandidateSlotPage() {
  const { token } = useParams<{ token: string }>();

  const [invite, setInvite] = useState<{ jobId: string, candidateId: string, round: string, issuedAt: number, candName?: string, candEmail?: string } | null>(null);
  const [error, setError] = useState<'invalid' | 'expired' | null>(null);

  const [activeDateStr, setActiveDateStr] = useState<string>('');

  const [realSlots, setRealSlots] = useState<{ day: string; start_time: string; end_time: string; work_mode: string }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);

  const [selectedSlots, setSelectedSlots] = useState<{ day: string; start_time: string; end_time: string; work_mode: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    try {
      const cleanToken = token?.trim().replace(/[\r\n\s]+/g, '') || '';
      const base64 = cleanToken.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(base64);

      const parts = decoded.split('::');
      if (parts.length >= 5 && parts[3] === 'slot') {
        const issuedAtMs = parseInt(parts[4], 10);

        if (isExpired(issuedAtMs)) {
          setError('expired');
          return;
        }

        const candName = parts.length > 5 ? decodeURIComponent(parts[5]) : undefined;
        const candEmail = parts.length > 6 ? decodeURIComponent(parts[6]) : undefined;

        setInvite({
          jobId: parts[0],
          candidateId: parts[1],
          round: parts[2],
          issuedAt: issuedAtMs,
          candName,
          candEmail
        });

        setActiveDateStr(toLocalYYYYMMDD(new Date()));
      } else {
        setError('invalid');
      }
    } catch (e) {
      setError('invalid');
    }
  }, [token]);

  useEffect(() => {
    if (!invite) return;
    setSlotsLoading(true);

    fetch(GET_CANDIDATE_SLOTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: invite.jobId, candidateId: invite.candidateId, round: invite.round }),
    })
      .then(r => r.json())
        .then(data => {
        if (data.success && Array.isArray(data.slots)) {
          setRealSlots(data.slots);
        } else {
          setRealSlots([]);
        }
      })
      .catch(err => console.error('[SlotPage] Failed to fetch slots:', err))
      .finally(() => setSlotsLoading(false));
  }, [invite]);

  if (error || !invite) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 20px', fontFamily: FONT, background: BACKGROUND_PAGE, minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 400, background: '#fff', padding: 32, borderRadius: 16, border: '1px solid #E5E7EB' }}>
          <div style={{ width: 48, height: 48, background: '#FEF2F2', color: '#DC2626', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            {error === 'expired' ? <CalendarX2 size={24} /> : <CalendarIcon size={24} />}
          </div>
          <h2 style={{ fontSize: 18, color: COLOR_PRIMARY, marginBottom: 8, fontWeight: 700 }}>{error === 'expired' ? 'Link Expired' : 'Invalid Link'}</h2>
          <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
            {error === 'expired'
              ? 'This interview scheduling link has exceeded the 2-hour validity period. Please contact HR.'
              : 'This link is malformed or invalid. Please check the email and try again.'}
          </p>
        </div>
      </div>
    );
  }

  const duration = invite.round === 'technical' ? 60 : 30;
  const roundLabel = invite.round === 'round1' ? 'First Round (Technical)' : invite.round === 'technical' ? 'Second Round (Advanced)' : 'HR Round';

  const toggleRealSlot = (slot: { day: string; start_time: string; end_time: string; work_mode: string }) => {
    const existingIndex = selectedSlots.findIndex(
      s => s.day === slot.day && s.start_time === slot.start_time && s.end_time === slot.end_time
    );

    if (existingIndex >= 0) {
      setSelectedSlots(selectedSlots.filter((_, i) => i !== existingIndex));
    } else {
      setSelectedSlots([...selectedSlots, slot]);
    }
  };

  const handleConfirm = () => {
    if (selectedSlots.length === 0) return;
    setSubmitting(true);

    const payload = {
      jobId: invite.jobId,
      candidateId: invite.candidateId,
      round: invite.round,
      candidateName: invite.candName,
      candidateEmail: invite.candEmail,
      selectedSlots: selectedSlots.map(slot => ({
        raw: `${slot.day}|${slot.start_time}-${slot.end_time}`,
        slot_date: nextDateForDay(slot.day),
        slot_start_time: slot.start_time,
        slot_end_time: slot.end_time
      }))
    };

    // ── Fire and forget — show confirmation immediately, CF runs in background ──
    fetch(import.meta.env.VITE_SAVE_SLOTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(err => {
      // Silently log — candidate already sees success screen, HR can follow up
      console.error('[SlotPage] Background CF error:', err);
    });

    // Show success screen immediately without waiting for CF response
    setSuccess(true);
    setSubmitting(false);
  };

  if (success) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 20px', fontFamily: FONT, background: BACKGROUND_PAGE, minHeight: '100vh' }}>
        <div style={{ background: '#fff', padding: 40, borderRadius: 16, border: '1px solid #E5E7EB', boxShadow: '0 10px 25px rgba(29,25,75,0.05)', textAlign: 'center', maxWidth: 440, width: '100%' }}>
          <div style={{ width: 56, height: 56, background: '#ECFDF5', color: '#10B981', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <CheckCircle size={28} />
          </div>
          <h2 style={{ margin: '0 0 10px', fontSize: 20, color: COLOR_PRIMARY, fontWeight: 700 }}>Preferences Confirmed</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
            Thank you! Your preferred slots have been logged. The Atgeir HR team will trigger a calendar invite shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 20px', fontFamily: FONT, background: BACKGROUND_PAGE, minHeight: '100vh', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 760 }}>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-block', background: '#fff', padding: '10px 20px', border: '1px solid #E5E7EB', borderRadius: 12, marginBottom: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.01)' }}>
            <img src="/company-logo.png" alt="Atgeir Logo" style={{ height: 32, display: 'block' }} />
          </div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: COLOR_PRIMARY, letterSpacing: '-0.02em' }}>Select Interview Availability</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#6B7280', fontWeight: 500 }}>
            {roundLabel} ({duration} mins)
          </p>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB', padding: 32, boxShadow: '0 10px 25px rgba(29,25,75,0.03)' }}>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: '#FFF7ED', padding: 16, borderRadius: 10, border: '1px solid #FFEDD5', marginBottom: 24 }}>
            <Info size={18} style={{ color: COLOR_ACCENT, flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_PRIMARY, marginBottom: 4 }}>Scheduling Parameters</div>
              <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>
                Please select from the interviewer-provided time windows below.
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLOR_PRIMARY, marginBottom: 16 }}>
              Available Interview Slots
            </div>

            {slotsLoading && (
              <div style={{ fontSize: 13, color: '#6B7280' }}>Loading available slots…</div>
            )}

            {!slotsLoading && realSlots.length === 0 && (
              <div style={{ fontSize: 13, color: '#DC2626' }}>No slots are currently available. Please contact HR.</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {realSlots.map((slot, idx) => {
                const isSelected = selectedSlots.some(
                  s => s.day === slot.day && s.start_time === slot.start_time && s.end_time === slot.end_time
                );
                const isOnline = slot.work_mode === 'WFH';
                return (
                  <button
                    key={idx}
                    onClick={() => toggleRealSlot(slot)}
                    style={{
                      padding: '12px 16px', borderRadius: 8,
                      border: `1px solid ${isSelected ? COLOR_ACCENT : '#E5E7EB'}`,
                      background: isSelected ? '#FFF7ED' : '#fff',
                      color: isSelected ? COLOR_ACCENT : '#374151',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span>{slot.day}, {slot.start_time} - {slot.end_time}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
                        background: isOnline ? '#EFF6FF' : '#F0FDF4',
                        color: isOnline ? '#1D4ED8' : '#15803D',
                        border: `1px solid ${isOnline ? '#BFDBFE' : '#BBF7D0'}`,
                      }}>
                        {isOnline ? 'Online' : 'In-Person (Office)'}
                      </span>
                    </div>
                    {isSelected && (
                      <span style={{ fontSize: 10, background: COLOR_ACCENT, color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
                        Selected
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {!slotsLoading && (
              <div style={{ marginTop: 16, padding: '12px 16px', background: '#F9FAFB', border: '1px dashed #E5E7EB', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>
                  None of these slots match your preference?
                </div>
                <div style={{ fontSize: 12, color: COLOR_PRIMARY, fontWeight: 600 }}>
                  Contact HR at <a href="mailto:support@atgeirsolutions.com" style={{ color: COLOR_ACCENT, textDecoration: 'none' }}>support@atgeirsolutions.com</a> to schedule manually.
                </div>
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 24 }}>
            <button
              onClick={handleConfirm}
              disabled={selectedSlots.length === 0 || submitting}
              style={{
                width: '100%', padding: '14px', borderRadius: 8, border: 'none',
                background: selectedSlots.length > 0 ? COLOR_PRIMARY : '#E5E7EB',
                color: selectedSlots.length > 0 ? '#fff' : '#9CA3AF',
                fontSize: 14, fontWeight: 700, fontFamily: FONT,
                cursor: selectedSlots.length > 0 ? 'pointer' : 'not-allowed',
                boxShadow: selectedSlots.length > 0 ? '0 4px 12px rgba(29,25,75,0.15)' : 'none'
              }}
            >
              {submitting ? 'Submitting Preferences…' : selectedSlots.length > 0 ? `Lock Selection (${selectedSlots.length})` : 'Choose a Slot'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}