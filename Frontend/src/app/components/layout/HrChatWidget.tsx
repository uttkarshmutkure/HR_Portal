import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2, Sparkles, Mic, MicOff } from 'lucide-react';
import { useAuth } from '../AuthContext';

// ── Design tokens (matched to DashboardPage.tsx) ────────────────────────────
const T = {
  orange:      '#F07C2D',
  orangeLight: '#FFF7ED',
  navy:        '#1D194B',
  white:       '#FFFFFF',
  gray100:     '#F3F4F6',
  gray200:     '#E5E7EB',
  gray400:     '#9CA3AF',
  gray600:     '#6B7280',
  text:        '#111827',
  font:        "'Inter', sans-serif",
};

interface ChatMessage {
  id:     string;
  role:   'user' | 'agent';
  text:   string;
}

// ── Backend hook point ───────────────────────────────────────────────────────
// TODO: Replace the body of this function with the real API call once the
// backend agent is built. Everything else in this component stays the same —
// it just awaits whatever string this function resolves to.
//
// Example of what this will look like later:
//   const res = await fetch(import.meta.env.VITE_HR_AGENT_URL, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ message, userEmail: user?.email }),
//   });
//   const data = await res.json();
//   return data.reply;
// Renders backend replies that use simple **bold** markers and real newlines
// as actual formatted React content — no raw asterisks, no dangerouslySetInnerHTML.
function renderFormattedMessage(text: string) {
  return text.split('\n').filter(line => line.trim() !== '').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return (
      <div key={i} style={{ marginBottom: i < text.split('\n').length - 1 ? '6px' : 0 }}>
        {parts.map((part, j) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={j}>{part.slice(2, -2)}</strong>
            : <span key={j}>{part}</span>
        )}
      </div>
    );
  });
}

async function sendMessageToHrAgent(message: string, history: ChatMessage[]): Promise<string> {
  const res = await fetch(import.meta.env.VITE_CHAT_AGENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      history: history.map(m => ({ role: m.role, text: m.text })),
    }),
  });

  if (!res.ok) {
    throw new Error(`Chat agent request failed: ${res.status}`);
  }

  const data = await res.json();
  return data.reply ?? "Sorry, I didn't get a response. Please try again.";
}

export default function HrChatWidget() {
  const { activeRole } = useAuth();
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [listening, setListening] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Speech-to-text setup — uses the browser's built-in Web Speech API.
  // No backend involved; unsupported browsers just won't see the mic button.
  const speechSupported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  useEffect(() => {
    if (!speechSupported) return;
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => (prev ? prev.trim() + ' ' : '') + transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, [speechSupported]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      recognitionRef.current.start();
      setListening(true);
    }
  };

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  // HR-only gate — renders nothing for any other role.
  if (activeRole !== 'hr') return null;

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const reply = await sendMessageToHrAgent(text, messages);
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'agent', text: reply }]);
    } catch {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'agent',
        text: 'Something went wrong reaching the assistant. Please try again.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 1000, fontFamily: T.font }}>

      {/* ── Chat panel ── */}
      {open && (
        <div style={{
          width: '340px',
          height: '460px',
          background: T.white,
          border: `0.5px solid ${T.gray200}`,
          borderRadius: '14px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.14)',
          display: 'flex',
          flexDirection: 'column',
          marginBottom: '12px',
          overflow: 'hidden',
          transformOrigin: 'bottom right',
          animation: 'panelIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) both',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 16px',
            background: 'linear-gradient(135deg, #1D194B, #2A2560)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: T.white }}>HR Assistant</div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', marginTop: '1px' }}>Ask about candidates, jobs, interviews</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', display: 'flex' }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Message list */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '28px', padding: '0 8px' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '14px',
                  background: `linear-gradient(135deg, ${T.orange}, #FFAB6B)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '14px',
                  boxShadow: '0 6px 16px rgba(240,124,45,0.28)',
                }}>
                  <Sparkles size={22} color={T.white} />
                </div>
                <div style={{ fontSize: '13.5px', fontWeight: 600, color: T.text, marginBottom: '4px' }}>
                  Hi there 👋
                </div>
                <div style={{ fontSize: '12px', color: T.gray400, textAlign: 'center', lineHeight: 1.5, marginBottom: '16px' }}>
                  Ask me about candidates, jobs, interviews, or offers.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
                  {[
                    'Show shortlisted candidates for interview? ',
                    'How many active jobs are there?',
                    'Who all have interviewer access?',
                  ].map(suggestion => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      style={{
                        textAlign: 'left',
                        fontSize: '11.5px',
                        color: T.text,
                        background: T.gray100,
                        border: `0.5px solid ${T.gray200}`,
                        borderRadius: '10px',
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontFamily: T.font,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.orangeLight}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = T.gray100}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: m.role === 'user' ? T.orange : T.gray100,
                color: m.role === 'user' ? T.white : T.text,
                padding: '10px 13px',
                borderRadius: '12px',
                borderBottomRightRadius: m.role === 'user' ? '2px' : '12px',
                borderBottomLeftRadius:  m.role === 'agent' ? '2px' : '12px',
                fontSize: '12.5px',
                lineHeight: 1.6,
                boxShadow: m.role === 'user'
                  ? '0 2px 6px rgba(240,124,45,0.25)'
                  : '0 1px 3px rgba(0,0,0,0.06)',
                animation: 'msgIn 0.22s ease both',
              }}>
                {m.role === 'agent' ? renderFormattedMessage(m.text) : m.text}
              </div>
            ))}
            {loading && (
              <div style={{
                alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '4px',
                padding: '12px 14px', background: T.gray100, borderRadius: '12px', borderBottomLeftRadius: '2px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{
                    width: '5px', height: '5px', borderRadius: '50%',
                    background: T.gray600,
                    animation: `typingDot 1.1s ease-in-out ${i * 0.15}s infinite`,
                  }} />
                ))}
              </div>
            )}
          </div>

          {/* Input row */}
          <div style={{ padding: '10px', borderTop: `0.5px solid ${T.gray200}`, display: 'flex', gap: '8px' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={listening ? 'Listening…' : 'Type your question…'}
              disabled={loading}
              style={{
                flex: 1,
                border: `1px solid ${listening ? T.orange : T.gray200}`,
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '12.5px',
                fontFamily: T.font,
                outline: 'none',
                color: T.text,
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = T.orange;
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(240,124,45,0.12)';
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = listening ? T.orange : T.gray200;
                e.currentTarget.style.boxShadow = 'none';
              }}
            />          
            {speechSupported && (
              <button
                onClick={toggleListening}
                disabled={loading}
                aria-label={listening ? 'Stop voice input' : 'Start voice input'}
                                style={{
                  width: '34px', height: '34px', borderRadius: '8px',
                  background: listening ? T.orange : T.gray100,
                  border: `0.5px solid ${listening ? T.orange : T.gray200}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  flexShrink: 0,
                  animation: listening ? 'pulseRing 1.4s ease-in-out infinite' : 'none',
                }}
              >
                {listening ? <Mic size={14} color={T.white} /> : <Mic size={14} color={T.gray600} />}
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              style={{
                width: '34px', height: '34px', borderRadius: '8px',
                background: (loading || !input.trim()) ? T.gray200 : T.orange,
                border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: (loading || !input.trim()) ? 'not-allowed' : 'pointer',
                flexShrink: 0,
              }}
            >
              <Send size={14} color={T.white} />
            </button>
          </div>
        </div>
      )}

            {/* ── Floating toggle button ── */}
      <div style={{ position: 'relative', marginLeft: 'auto', width: '52px' }}>
        {!open && messages.length === 0 && (
          <span style={{
            position: 'absolute', top: '-2px', right: '-2px',
            width: '12px', height: '12px', borderRadius: '50%',
            background: '#22C55E', border: `2px solid ${T.white}`,
            zIndex: 1,
          }} />
        )}
        <button
          onClick={() => setOpen(v => !v)}
          aria-label={open ? 'Close HR assistant' : 'Open HR assistant'}
          style={{
            width: '52px', height: '52px', borderRadius: '50%',
            background: T.orange,
            border: 'none',
            boxShadow: '0 6px 18px rgba(240,124,45,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            transition: 'transform 0.15s',
            animation: !open ? 'toggleBounce 0.6s ease 1s both, breathe 3s ease-in-out 2s infinite' : 'none',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1.06)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1)'}
        >
          {open ? <X size={20} color={T.white} /> : <MessageSquare size={20} color={T.white} />}
        </button>
      </div>

                  <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulseRing {
          0%, 100% { box-shadow: 0 0 0 0 rgba(240,124,45,0.4); }
          50% { box-shadow: 0 0 0 6px rgba(240,124,45,0); }
        }
        @keyframes panelIn {
          from { opacity: 0; transform: scale(0.96) translateY(6px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes msgIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes typingDot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes toggleBounce {
          0%, 100% { transform: scale(1); }
          30% { transform: scale(1.12); }
          60% { transform: scale(0.96); }
        }
        @keyframes breathe {
          0%, 100% { box-shadow: 0 6px 18px rgba(240,124,45,0.4); }
          50% { box-shadow: 0 6px 24px rgba(240,124,45,0.6); }
        }
      `}</style>
    </div>
  );
}