import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { Calendar as CalendarIcon, CheckCircle, CalendarX2, ChevronLeft, ChevronRight, Info } from 'lucide-react';

const FONT = 'Inter, sans-serif';
const COLOR_PRIMARY = '#1D194B';
const COLOR_ACCENT = '#F07C2D';
const BACKGROUND_PAGE = '#F4F3F7';

const toLocalYYYYMMDD = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isExpired = (issuedAtMs: number) => {
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  return Date.now() > issuedAtMs + TWO_DAYS_MS;
};

const getAllowedBusinessDays = (issuedAtMs: number) => {
  const days: string[] = [];
  const current = new Date(issuedAtMs);
  current.setDate(current.getDate() + 1);

  while (days.length < 3) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      days.push(toLocalYYYYMMDD(current));
    }
    current.setDate(current.getDate() + 1);
  }
  return days;
};

const generateTimeGrid = (durationMinutes: number) => {
  const slots = [];
  const startHour = 10;
  const endHour = 17;

  let currentMins = startHour * 60;
  const endMins = endHour * 60;

  const formatTime = (totalMins: number) => {
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h;
    // Handle 12 PM (Noon) correctly
    const finalH = displayH === 0 ? 12 : displayH;
    return `${finalH}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  while (currentMins + durationMinutes <= endMins) {
    const startTimeStr = formatTime(currentMins);
    const endTimeStr = formatTime(currentMins + durationMinutes);
    slots.push(`${startTimeStr} - ${endTimeStr}`);
    
    // Increment by exactly 30 minutes every time, regardless of slot duration
    currentMins += 30; 
  }
  return slots;
};

export default function CandidateSlotPage() {
  const { token } = useParams<{ token: string }>();

  const [invite, setInvite] = useState<{ jobId: string, candidateId: string, round: string, issuedAt: number, candName?: string, candEmail?: string } | null>(null);
  const [error, setError] = useState<'invalid' | 'expired' | null>(null);

  const [allowedDays, setAllowedDays] = useState<string[]>([]);
  const [activeDateStr, setActiveDateStr] = useState<string>('');
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());

  const [selectedSlots, setSelectedSlots] = useState<{ day: string; date: string; time: string; raw: string }[]>([]);
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

        const businessDays = getAllowedBusinessDays(issuedAtMs);
        setAllowedDays(businessDays);
        setActiveDateStr(businessDays[0]);
        setCurrentMonthDate(new Date(businessDays[0]));
      } else {
        setError('invalid');
      }
    } catch (e) {
      setError('invalid');
    }
  }, [token]);

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
              ? 'This interview scheduling link has exceeded the 48-hour validity period. Please contact HR.'
              : 'This link is malformed or invalid. Please check the email and try again.'}
          </p>
        </div>
      </div>
    );
  }

  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const calendarDays = [];
  for (let i = 0; i < firstDayOfMonth; i++) calendarDays.push(null);
  for (let i = 1; i <= daysInMonth; i++) calendarDays.push(new Date(year, month, i));

  const duration = invite.round === 'technical' ? 60 : 30;
  const timeSlots = generateTimeGrid(duration);
  const roundLabel = invite.round === 'round1' ? 'First Round (Technical)' : invite.round === 'technical' ? 'Second Round (Advanced)' : 'HR Round';

  const handleDayClick = (date: Date) => {
    const dateStr = toLocalYYYYMMDD(date);
    if (allowedDays.includes(dateStr)) {
      setActiveDateStr(dateStr);
    }
  };

  const toggleTimeSlot = (time: string) => {
    const [y, m, d] = activeDateStr.split('-').map(Number);
    const activeDateObj = new Date(y, m - 1, d);

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const dayStr = dayNames[activeDateObj.getDay()];
    const dateDisplayStr = `${activeDateObj.getDate()} ${monthNames[activeDateObj.getMonth()]}`;
    const rawStr = `${dayStr}, ${dateDisplayStr}|${time}`;

    const existingIndex = selectedSlots.findIndex(s => s.raw === rawStr);

    if (existingIndex >= 0) {
      setSelectedSlots(selectedSlots.filter((_, i) => i !== existingIndex));
    } else {
      if (selectedSlots.length < 3) {
        setSelectedSlots([...selectedSlots, { day: dayStr, date: dateDisplayStr, time, raw: rawStr }]);
      }
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
      selectedSlots: selectedSlots.map(slot => {
        const [_, timeRange] = slot.raw.split('|');
        const startTime12h = timeRange.split(' - ')[0];

        const convertTo24Hour = (time12h: string) => {
          const [time, modifier] = time12h.split(' ');
          let [hours, minutes] = time.split(':').map(Number);
          if (modifier === 'PM' && hours !== 12) hours += 12;
          if (modifier === 'AM' && hours === 12) hours = 0;
          return { hours, minutes };
        };

        const { hours, minutes } = convertTo24Hour(startTime12h);
        const startDate = new Date();
        startDate.setHours(hours, minutes, 0, 0);
        const endDate = new Date(startDate.getTime() + duration * 60000);

        const format24 = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

        return {
          raw: slot.raw,
          slot_date: activeDateStr,
          slot_start_time: format24(startDate),
          slot_end_time: format24(endDate)
        };
      })
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
                Please mark up to <strong>3 preferences</strong>. Only available business windows (10 AM - 5 PM) across upcoming open pipelines are displayed.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 24 }}>
            <div style={{ flex: '1 1 300px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <button onClick={() => setCurrentMonthDate(new Date(year, month - 1, 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}><ChevronLeft size={20} /></button>
                <div style={{ fontSize: 15, fontWeight: 700, color: COLOR_PRIMARY }}>
                  {currentMonthDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                </div>
                <button onClick={() => setCurrentMonthDate(new Date(year, month + 1, 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}><ChevronRight size={20} /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center', marginBottom: 8 }}>
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d} style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF' }}>{d}</div>)}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {calendarDays.map((date, idx) => {
                  if (!date) return <div key={idx} />;
                  const dateStr = toLocalYYYYMMDD(date);
                  const isAllowed = allowedDays.includes(dateStr);
                  const isActive = activeDateStr === dateStr;

                  return (
                    <button
                      key={idx}
                      onClick={() => handleDayClick(date)}
                      disabled={!isAllowed}
                      style={{
                        padding: '8px 0', borderRadius: '50%', border: 'none',
                        background: isActive ? COLOR_PRIMARY : isAllowed ? '#EEF2F6' : 'transparent',
                        color: isActive ? '#fff' : isAllowed ? COLOR_PRIMARY : '#D1D5DB',
                        fontSize: 13, fontWeight: isActive || isAllowed ? 700 : 400,
                        cursor: isAllowed ? 'pointer' : 'not-allowed'
                      }}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ flex: '1 1 300px', borderLeft: '1px solid #E5E7EB', paddingLeft: 32 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: COLOR_PRIMARY, marginBottom: 16 }}>
                Windows for <span style={{ color: COLOR_ACCENT }}>{activeDateStr}</span>
              </div>

              <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {timeSlots.map(time => {
                  const [y, m, d] = activeDateStr.split('-').map(Number);
                  const activeDateObj = new Date(y, m - 1, d);
                  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

                  const rawStr = `${dayNames[activeDateObj.getDay()]}, ${activeDateObj.getDate()} ${monthNames[activeDateObj.getMonth()]}|${time}`;
                  const choiceOrder = selectedSlots.findIndex(s => s.raw === rawStr);
                  const isSelected = choiceOrder !== -1;

                  return (
                    <button
                      key={time}
                      onClick={() => toggleTimeSlot(time)}
                      disabled={selectedSlots.length >= 3 && !isSelected}
                      style={{
                        padding: '12px 16px', borderRadius: 8,
                        border: `1px solid ${isSelected ? COLOR_ACCENT : '#E5E7EB'}`,
                        background: isSelected ? '#FFF7ED' : '#fff',
                        color: isSelected ? COLOR_ACCENT : '#374151',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                      }}
                    >
                      <span>{time}</span>
                      {isSelected && (
                        <span style={{ fontSize: 10, background: COLOR_ACCENT, color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
                          Preference {choiceOrder + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
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
              {submitting ? 'Submitting Preferences…' : selectedSlots.length > 0 ? `Lock Selection (${selectedSlots.length}/3)` : 'Choose Preferred Blocks'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}