import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router';
import { ArrowLeft, FileText, MessageSquare, Upload, Copy, ChevronRight, Paperclip } from 'lucide-react';
import DashboardLayout from '../components/layout/DashboardLayout';
import { useToast } from '../components/ToastContext';
import { TopCandidate } from '../../services/screening';

// ── Types & Interfaces ───────────────────────────────────────────────────────
interface SalaryBreakupRow { monthly: string; annual: string; }
interface SalaryBreakup {
  basic: SalaryBreakupRow; hra: SalaryBreakupRow; specialAllowance: SalaryBreakupRow;
  conveyance: SalaryBreakupRow; medical: SalaryBreakupRow; lta: SalaryBreakupRow;
  pf: SalaryBreakupRow; bonus: SalaryBreakupRow;
}

const BREAKUP_ROWS: { key: keyof SalaryBreakup; label: string }[] = [
  { key: 'basic', label: 'Basic' },
  { key: 'hra', label: 'HRA' },
  { key: 'specialAllowance', label: 'Special Allowance' },
  { key: 'conveyance', label: 'Conveyance' },
  { key: 'medical', label: 'Medical' },
  { key: 'lta', label: 'LTA' },
  { key: 'pf', label: 'PF (Employer Contribution)' },
  { key: 'bonus', label: 'Bonus (Annual)' },
];

const EMPTY_BREAKUP_ROW: SalaryBreakupRow = { monthly: '', annual: '' };
const EMPTY_BREAKUP: SalaryBreakup = {
  basic: { ...EMPTY_BREAKUP_ROW }, hra: { ...EMPTY_BREAKUP_ROW },
  specialAllowance: { ...EMPTY_BREAKUP_ROW }, conveyance: { ...EMPTY_BREAKUP_ROW },
  medical: { ...EMPTY_BREAKUP_ROW }, lta: { ...EMPTY_BREAKUP_ROW },
  pf: { ...EMPTY_BREAKUP_ROW }, bonus: { ...EMPTY_BREAKUP_ROW },
};

const parseAmount = (s: string | undefined): number => {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
};

const fmtAmount = (n: number): string =>
  n === 0 ? '' : n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

interface OfferDraft {
  baseCTC: string; variablePay: string; joiningDate: string;
  location: string; probation: string; reportingManager: string; designation: string;
  candidateAddress: string; candidatePhone: string; breakup: SalaryBreakup;
  customValues: Record<string, string>;
}

const CORE_DRAFT_FIELDS: (keyof OfferDraft)[] = [
  'designation', 'baseCTC', 'variablePay', 
  'joiningDate', 'location', 'probation', 'reportingManager',
];

const EMPTY_DRAFT: OfferDraft = {
  baseCTC: '', variablePay: '', joiningDate: '',
  location: '', probation: '3 months', reportingManager: '',
  designation: '', candidateAddress: '', candidatePhone: '',
  breakup: { ...EMPTY_BREAKUP },
  customValues: {}, 
};

export interface SalaryRules {
  basicPercentOfCTC: number;
  hraPercentOfBasic: number;
  pfPercentOfBasic: number;
  medicalAnnual: number;
  conveyanceAnnual: number;
  ltaAnnual: number;
  bonusAnnual: number;
  offerValidityDays: number;
}

export const DEFAULT_SALARY_RULES: SalaryRules = {
  basicPercentOfCTC: 50,
  hraPercentOfBasic: 50,
  pfPercentOfBasic: 12,
  medicalAnnual: 15000,
  conveyanceAnnual: 19200,
  ltaAnnual: 12000,
  bonusAnnual: 0,
  offerValidityDays: 7,
};

interface CandidateOfferCard { id: string; name: string; draft: OfferDraft; }
type ChatMsg = {
  role: 'bot' | 'user';
  text: string;
  options?: string[];
  candidateCards?: CandidateOfferCard[];
};

// ── Shared style tokens ───────────────────────────────────────────────────────
const ORANGE = '#F07C2D';
const ORANGE_LIGHT = '#FFF7ED';
const BORDER = '#E5E7EB';
const TEXT_DARK = '#111827';
const TEXT_MID = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const BG_SOFT = '#F9FAFB';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`,
  borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box',
  color: TEXT_DARK, background: '#fff',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: TEXT_MID,
  display: 'block', marginBottom: 4,
};

// ── Main Page Component ───────────────────────────────────────────────────────
export default function OfferGenerationPage() {
  const { jobId, candidateId } = useParams<{ jobId: string; candidateId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const cand: TopCandidate = location.state?.cand;
  const jdTitle: string = location.state?.jdTitle || 'Job';

  const [pipelineCandidates, setPipelineCandidates] = useState<TopCandidate[]>([]);
  const [savedOffers, setSavedOffers] = useState<Record<string, OfferDraft>>({});

  // ── NEW: LocalStorage keys and logic for auto-saving ──
  const storageKey = `atgeir_offer_${jobId}_${candidateId}`;

  const [draft, setDraft] = useState<OfferDraft>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try { return JSON.parse(saved).draft || EMPTY_DRAFT; } catch (e) {}
    }
    return { 
      ...EMPTY_DRAFT, 
      designation: jdTitle,
      candidatePhone: (cand as any)?.phone || '',
      candidateAddress: (cand as any)?.address || ''
    };
  });

  const [msgs, setMsgs] = useState<ChatMsg[]>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try { return JSON.parse(saved).msgs || []; } catch (e) {}
    }
    return [];
  });

  const [templateHtml, setTemplateHtml] = useState<string | null>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try { return JSON.parse(saved).templateHtml || null; } catch (e) {}
    }
    return null;
  });

  const [customFields, setCustomFields] = useState<{name: string, description: string}[]>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try { return JSON.parse(saved).customFields || []; } catch (e) {}
    }
    return [];
  });

  const [signature, setSignature] = useState<{ url: string, x: number, y: number, width: number, height: number } | null>(null);
  const [salaryRules, setSalaryRules] = useState<SalaryRules>(() => {
    if (location.state?.salaryRules) return location.state.salaryRules;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved).salaryRules;
        if (parsed) return parsed;
      } catch (e) {}
    }
    return DEFAULT_SALARY_RULES;
  });
  const [showGenerateChoiceModal, setShowGenerateChoiceModal] = useState(false);
  const [showSalaryModal, setShowSalaryModal] = useState(false);

  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const OFFER_API = (import.meta.env.VITE_OFFER_AGENT_URL as string) ?? '';

  // Redirect if no candidate passed
  useEffect(() => {
    if (!cand) navigate(`/jobs/${jobId}/pipeline`);
  }, [cand, navigate, jobId]);

  // Sync state to local storage whenever it changes
  useEffect(() => {
    if (jobId && candidateId) {
      localStorage.setItem(storageKey, JSON.stringify({ draft, msgs, templateHtml, customFields, salaryRules }));
    }
  }, [draft, msgs, templateHtml, customFields, salaryRules, jobId, candidateId, storageKey]);

  // Fetch pipeline candidates for "Copy from candidate" feature
  useEffect(() => {
    if (!jobId) return;
    fetch(import.meta.env.VITE_DATA_MANAGER_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'GET_SHORTLISTED', jobId }),
    }).then(r => r.json()).then(data => {
      if (data.success && data.candidates) setPipelineCandidates(data.candidates);
    }).catch(console.error);
  }, [jobId]);

  // Load saved offers from DB
  useEffect(() => {
    if (!jobId || !OFFER_API) return;
    fetch(OFFER_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_offers', jobId }),
    }).then(r => r.json()).then(data => {
      const map: Record<string, OfferDraft> = {};
      (data.offers ?? []).forEach((o: any) => { map[o.candidateId] = o.draft; });
      setSavedOffers(map);
    });
  }, [jobId]);

  if (!cand) return null;

  const addUserMsg = (text: string) => setMsgs(p => [...p, { role: 'user', text }]);
  const addBotMsg = (text: string, options?: string[], candidateCards?: CandidateOfferCard[]) =>
    setMsgs(p => [...p, { role: 'bot', text, options, candidateCards }]);
  const mergeDraft = (patch: Partial<OfferDraft>) => setDraft(p => ({ ...p, ...patch }));

  return (
    <DashboardLayout breadcrumb={`Dashboard / Jobs / ${jdTitle} / Pipeline / Generate Offer`}>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', padding: '20px 32px', boxSizing: 'border-box' }}>

        {/* Page Header — back button always visible; title/subtitle hide once chat starts to save space
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: msgs.length === 0 ? 20 : 12, flexShrink: 0 }}>
          <button
            onClick={() => navigate(`/jobs/${jobId}/pipeline`, {
              state: { jdTitle, restoreTab: 'onboarding', restoreCandidateId: candidateId },
            })}
            style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', color: TEXT_DARK, flexShrink: 0 }}
          >
            <ArrowLeft size={16} />
          </button>
          {msgs.length === 0 && (
            <div>
              <h1 style={{ fontSize: 19, fontWeight: 700, color: TEXT_DARK, margin: 0 }}>
                Generate Offer — {cand.name}
              </h1>
              <div style={{ fontSize: 12, color: TEXT_MID, marginTop: 2 }}>
                {jdTitle} · {jobId} · Offer Copilot active
              </div>
            </div>
          )}
        </div> */}

        {/* Main Workspace */}
        <div style={{ flex: 1, minHeight: 0, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden', display: 'flex' }}>
          <OfferChatPanel
            cand={cand} jdTitle={jdTitle} jobId={jobId ?? ''}
            candidateId={candidateId ?? ''}
            onBack={() => navigate(`/jobs/${jobId}/pipeline`, {
              state: { jdTitle, restoreTab: 'onboarding', restoreCandidateId: candidateId },
            })}
            msgs={msgs} draft={draft} input={input} typing={typing}
            savedOffers={savedOffers} OFFER_API={OFFER_API}
            pipelineCandidates={pipelineCandidates}
            onSetInput={setInput}
            onSetDraft={mergeDraft}
            onAddUserMsg={addUserMsg}
            onAddBotMsg={addBotMsg}
            onSetTyping={setTyping}
            onMergeOfferUpdate={(update: Partial<OfferDraft>) => mergeDraft(update)}
            onSaveOfferLocal={(d: OfferDraft) =>
              setSavedOffers(p => ({ ...p, [cand.candidate_id]: d }))
            }
            showToast={showToast}
            templateHtml={templateHtml}
            setTemplateHtml={setTemplateHtml}
            customFields={customFields}
            setCustomFields={setCustomFields}
            signature={signature}
            setSignature={setSignature}
            salaryRules={salaryRules}
            showGenerateChoiceModal={showGenerateChoiceModal}
            setShowGenerateChoiceModal={setShowGenerateChoiceModal}
            showSalaryModal={showSalaryModal}
            setShowSalaryModal={setShowSalaryModal}
            setSalaryRules={setSalaryRules}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}

// ── OfferChatPanel — the full state-machine engine ───────────────────────────
interface OfferChatPanelProps {
  cand: TopCandidate;
  jdTitle: string;
  jobId: string;
  candidateId: string;
  msgs: ChatMsg[];
  draft: OfferDraft;
  input: string;
  typing: boolean;
  savedOffers: Record<string, OfferDraft>;
  OFFER_API: string;
  pipelineCandidates: TopCandidate[];
  onSetInput: (val: string) => void;
  onSetDraft: (patch: Partial<OfferDraft>) => void;
  onAddUserMsg: (text: string) => void;
  onAddBotMsg: (text: string, options?: string[], candidateCards?: CandidateOfferCard[]) => void;
  onSetTyping: (typing: boolean) => void;
  onMergeOfferUpdate: (update: Partial<OfferDraft>) => void;
  onSaveOfferLocal: (offer: OfferDraft) => void;
  showToast: (msg: string, type?: string) => void;
  templateHtml: string | null;
  setTemplateHtml: (val: string | null) => void;
  customFields: {name: string, description: string}[];
  setCustomFields: (val: {name: string, description: string}[]) => void;
  signature: { url: string, x: number, y: number, width: number, height: number } | null;
  setSignature: React.Dispatch<React.SetStateAction<{ url: string, x: number, y: number, width: number, height: number } | null>>;
  salaryRules: SalaryRules;
  showGenerateChoiceModal: boolean;
  setShowGenerateChoiceModal: (val: boolean) => void;
  showSalaryModal: boolean;
  setShowSalaryModal: (val: boolean) => void;
  setSalaryRules: (val: SalaryRules) => void;
  onBack: () => void;
}

function EmailPreviewModal({ subject, body, onSubjectChange, onBodyChange, onConfirm, onClose }: {
  subject: string; body: string;
  onSubjectChange: (v: string) => void; onBodyChange: (v: string) => void;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 520, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: TEXT_DARK }}>Review Offer Email</div>
        <div style={{ fontSize: 12, color: TEXT_MID, marginBottom: 16 }}>Edit the subject or message before sending. The offer letter PDF is attached automatically.</div>

        <label style={labelStyle}>Subject</label>
        <input
          value={subject}
          onChange={e => onSubjectChange(e.target.value)}
          style={{ ...inputStyle, marginBottom: 14 }}
        />

        <label style={labelStyle}>Message</label>
        <textarea
          value={body}
          onChange={e => onBodyChange(e.target.value)}
          rows={12}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', fontSize: 13, cursor: 'pointer', color: TEXT_DARK }}>Cancel</button>
          <button onClick={onConfirm} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#10B981', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Send Offer</button>
        </div>
      </div>
    </div>
  );
}

function OfferChatPanel({
  cand, jdTitle, jobId, candidateId, msgs, draft, input, typing,
  savedOffers, OFFER_API, pipelineCandidates,
  onSetInput, onSetDraft, onAddUserMsg, onAddBotMsg, onSetTyping,
  onMergeOfferUpdate, onSaveOfferLocal, showToast,
  templateHtml, setTemplateHtml, customFields, setCustomFields, signature, setSignature,
  salaryRules, showGenerateChoiceModal, setShowGenerateChoiceModal, showSalaryModal, setShowSalaryModal, setSalaryRules,
  onBack
}: OfferChatPanelProps) {

  // ── View state machine ──
  const [viewMode, setViewMode] = useState<'chat-only' | 'chat-preview' | 'form-preview'>('chat-only');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [pendingPdfBase64, setPendingPdfBase64] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, typing]);

  // Restore the correct view mode if there is existing state loaded from storage
  useEffect(() => {
    if (msgs.length > 0 && viewMode === 'chat-only') {
      setViewMode('chat-preview');
    }
  }, [msgs, viewMode]);

  const candId = cand.candidate_id;
  const safeBreakup = draft.breakup ?? EMPTY_BREAKUP;
  const filledCount = CORE_DRAFT_FIELDS.filter(k => (draft[k] as string || '').trim() !== '').length;
  const totalFields = CORE_DRAFT_FIELDS.length;
  const firstName = cand.name?.split(' ')[0] || 'Candidate';
  const todayStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const totalMonthly = BREAKUP_ROWS.reduce((s, r) => s + parseAmount(safeBreakup[r.key].monthly), 0);
  const totalAnnual  = BREAKUP_ROWS.reduce((s, r) => s + parseAmount(safeBreakup[r.key].annual), 0);

  // ── Bot text renderer (bold via **) ──
  const renderBotText = (text: string) => {
    return text.split('\n').map((line, lineIndex) => {
      if (!line.trim()) return <div key={lineIndex} style={{ height: 6 }} />; 

      const isBullet = line.trim().startsWith('* ') || line.trim().startsWith('- ');
      let cleanLine = line;
      
      if (isBullet) {
        cleanLine = line.trim().substring(2); 
      }

      const formattedLine = cleanLine.split('**').map((part, i) =>
        i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
      );

      return (
        <div key={lineIndex} style={{
          display: isBullet ? 'flex' : 'block',
          gap: 6,
          marginBottom: 4,
          paddingLeft: isBullet ? 4 : 0
        }}>
          {isBullet && <span style={{ color: ORANGE, fontWeight: 'bold' }}>•</span>}
          <div>{formattedLine}</div>
        </div>
      );
    });
  };

  // ── File Upload Handler ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // ── NEW: Handle Signature Image Uploads ──
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setSignature({ url: ev.target.result as string, x: 50, y: 50, width: 150, height: 50 });
          onAddUserMsg(`Uploaded signature: ${file.name}`);
          onAddBotMsg("Signature uploaded! 👉 You can now drag and drop it anywhere on the live preview document.");
        }
      };
      reader.readAsDataURL(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    onAddUserMsg(`Uploaded template: ${file.name}`);
    onSetTyping(true);

    const formData = new FormData();
    formData.append('action', 'process_template');
    formData.append('jobId', jobId);
    formData.append('candidateId', candidateId);
    formData.append('file', file);

    try {
      const res = await fetch(OFFER_API, {
        method: 'POST',
        body: formData, 
      });
      const data = await res.json();
      
      onSetTyping(false);
      if (data.html) {
        setTemplateHtml(data.html);
        setCustomFields(data.fields || []);
        setViewMode('chat-preview');
        onAddBotMsg(`I've processed your template and opened it on the right! I detected ${data.fields?.length || 0} custom fields. Let's start filling them. What is the Designation and Base CTC?`);
      } else {
        onAddBotMsg("Sorry, I couldn't process that file. Please make sure it's a valid PDF or DOCX.", ['Upload my own format', 'Use default format']);
      }
    } catch (err) {
      onSetTyping(false);
      onAddBotMsg("Upload failed. Please check your connection.", ['Upload my own format']);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''; 
    }
  };

  // ── Option button handler ──
  const handleOption = async (option: string) => {
    onAddUserMsg(option);

    if (option === 'Use default format') {
      setTemplateHtml(null);
      setCustomFields([]);
      setViewMode('chat-preview');
      onSetTyping(true);
      
      setTimeout(() => {
        onSetTyping(false);
        const existingOffers = Object.entries(savedOffers).filter(([id]: any) => id !== candId);
        
        const nextOptions = ['Fill a form', 'Chat with me'];
        if (existingOffers.length > 0) {
          nextOptions.push('Copy from another candidate');
        }
        
        onAddBotMsg("Great! I've opened the document on the right. How would you like to fill in the rest of the details?", nextOptions);
      }, 500);
    }
    else if (option === 'Upload my own format') {
      fileInputRef.current?.click();
    }
    else if (option === 'Fill a form') {
      setViewMode('form-preview');
      onSetTyping(true);
      setTimeout(() => {
        onSetTyping(false);
        onAddBotMsg("I've opened the form on the left. Fill in the details, and the offer letter will update live on the right. Hit **Confirm & Return to Chat** when you're done!");
      }, 500);
    }
    else if (option === 'Chat with me') {
      onSetTyping(true);
      try {
        const res = await fetch(OFFER_API, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'chat', jobId, candidateId: candId,
            message: "I want to chat to fill the information. What details do you need from me?",
            history: msgs.map((m: any) => ({ role: m.role, text: m.text })),
            currentDraft: draft,
            customFields: customFields,
            templateMode: !!templateHtml,
            salaryRules,
          }),
        });
        const data = await res.json();
        onSetTyping(false);
        onAddBotMsg(data.reply ?? "Let's get started. What designation and Base CTC would you like to offer?");
      } catch {
        onSetTyping(false);
        onAddBotMsg("Let's get started. What designation and Base CTC would you like to offer?");
      }
    }
    else if (option === 'Copy from another candidate') {
      const existing = Object.entries(savedOffers).filter(([id]: any) => id !== candId);
      const cards: CandidateOfferCard[] = existing.map(([id, savedDraft]: any) => {
        const c = pipelineCandidates.find((p: any) => p.candidate_id === id);
        return { id, name: c ? c.name : id, draft: savedDraft };
      });
      onSetTyping(true);
      setTimeout(() => {
        onSetTyping(false);
        onAddBotMsg(`Here are other candidates from this same job (${jobId}) who already have offers. Pick one to copy their details:`, undefined, cards);
      }, 500);
    }
  };

  // ── Copy candidate handler ──
  const handleCopyCandidate = (card: CandidateOfferCard) => {
    onAddUserMsg(`Copy from ${card.name}`);
    const { candidateAddress, candidatePhone, ...copyFields } = card.draft;
    onMergeOfferUpdate(copyFields);
    
    onSetTyping(true);
    setTimeout(() => {
      onSetTyping(false);
      onAddBotMsg(`Copied offer details from **${card.name}**. You can see them in the preview. Tweak anything via chat or just **Send the Offer** when you're ready.`);
    }, 500);
  };

  // ── Form submission handler (Triggers AI review) ──
  const handleFormSubmit = async () => {
    setViewMode('chat-preview');
    onSetTyping(true);
    try {
      const res = await fetch(OFFER_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat', jobId, candidateId: candId,
          message: "I have filled the form. Please check the current draft. If any core fields (Designation, Base CTC, Joining Date, Location, Reporting Manager) are missing, let me know what's left. Also, please auto-calculate the salary breakup based on the Base CTC.",
          history: msgs.map((m: any) => ({ role: m.role, text: m.text })),
          currentDraft: draft,
          customFields: customFields,
          templateMode: !!templateHtml,
          salaryRules,
        }),
      });
      const data = await res.json();
      onSetTyping(false);
      onAddBotMsg(data.reply ?? "Details saved! Check the live preview. Let me know if you need to update anything else.");
      if (data.offerUpdate && Object.keys(data.offerUpdate).length > 0) {
        onMergeOfferUpdate(data.offerUpdate);
      }
    } catch {
      onSetTyping(false);
      onAddBotMsg("Details saved! Check the live preview. Let me know if you need to update anything else.");
    }
  };

  // ── Chat send ──
  const handleChatSend = async () => {
    const msg = input.trim();
    if (!msg) return;

    onAddUserMsg(msg);
    onSetInput('');

    if (/\b(form|fill form)\b/i.test(msg)) {
      onSetTyping(true);
      setTimeout(() => {
        onSetTyping(false);
        onAddBotMsg('Switching to the form view!');
        setViewMode('form-preview');
      }, 450);
      return;
    }

    onSetTyping(true);
    try {
      const res = await fetch(OFFER_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat', jobId, candidateId: candId, message: msg,
          history: msgs.map((m: any) => ({ role: m.role, text: m.text })),
          currentDraft: draft,
          customFields: customFields,
          templateMode: !!templateHtml,
          salaryRules,
        }),
      });
      const data = await res.json();
      onSetTyping(false);
      
      onAddBotMsg(data.reply ?? 'Sorry, something went wrong.', data.options);
      
      if (data.offerUpdate && Object.keys(data.offerUpdate).length > 0) {
        onMergeOfferUpdate(data.offerUpdate);
        if (viewMode === 'chat-only') setViewMode('chat-preview');
      }
    } catch {
      onSetTyping(false);
      onAddBotMsg('Network error. Please try again.');
    }
  };

  // ── Step 1: Generate PDF + open the editable email preview modal ──
  const handlePrepareSendOffer = async () => {
    if (!draft.baseCTC || !draft.joiningDate) return;
    onSetTyping(true);

    try {
      const contentEl = document.getElementById('offer-letter-content');
      if (!contentEl) throw new Error('Preview content not found');

      const clone = contentEl.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.no-print').forEach(el => el.remove());

      const actualWidth = contentEl.getBoundingClientRect().width || 800;
      const scaleRatio = 800 / actualWidth;

      const sigWrapper = clone.querySelector('#signature-wrapper') as HTMLElement | null;
      if (sigWrapper) {
        const curLeft = parseFloat(sigWrapper.style.left) || 0;
        const curTop = parseFloat(sigWrapper.style.top) || 0;
        const curWidth = parseFloat(sigWrapper.style.width) || 0;
        const curHeight = parseFloat(sigWrapper.style.height) || 0;
        sigWrapper.style.left = `${curLeft * scaleRatio}px`;
        sigWrapper.style.top = `${curTop * scaleRatio}px`;
        sigWrapper.style.width = `${curWidth * scaleRatio}px`;
        sigWrapper.style.height = `${curHeight * scaleRatio}px`;
      }

      const scaledHtml = clone.innerHTML;

      const iframe = document.createElement('iframe');
      iframe.style.position = 'absolute';
      iframe.style.width = '800px';
      iframe.style.height = '1200px';
      iframe.style.top = '-9999px';
      document.body.appendChild(iframe);

      const base64Data = await new Promise<string>((resolve, reject) => {
        iframe.onload = async () => {
          try {
            const iWin = iframe.contentWindow as any;
            const element = iWin.document.getElementById('clean-render');

            const opt = {
              margin:       10,
              filename:     `Offer_Letter_${firstName}.pdf`,
              image:        { type: 'jpeg', quality: 1.0 },
              html2canvas:  { scale: 2, useCORS: true },
              jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            const pdfDataUri = await iWin.html2pdf().set(opt).from(element).outputPdf('datauristring');
            resolve(pdfDataUri.split(',')[1]);
          } catch (e) {
            reject(e);
          }
        };

        const iframeDoc = iframe.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.open();
          iframeDoc.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <style>
                  body { margin: 0; padding: 20px; font-family: Arial, sans-serif; background: #fff; }
                  * { box-sizing: border-box; }
                </style>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script>
              </head>
              <body>
                <div id="clean-render" style="position: relative;">${scaledHtml}</div>
              </body>
            </html>
          `);
          iframeDoc.close();
        }
      });

      document.body.removeChild(iframe);

      const validityDays = salaryRules.offerValidityDays || 7;

      const defaultBody = `Dear ${cand.name},\n\nCongratulations!\n\nWe are delighted to offer you the position of ${draft.designation || jdTitle} at Atgeir Solutions.\n\nPlease find your offer letter attached with this email. Kindly review the document and share your acceptance within ${validityDays} days of receiving this offer.\n\nIf you have any questions regarding the offer or onboarding process, feel free to contact us.\n\nWe look forward to welcoming you to the team.\n\nBest regards,\nHR Team — Atgeir Solutions`;

      setEmailSubject(`Offer Letter — ${draft.designation || jdTitle} at Atgeir Solutions`);
      setEmailBody(defaultBody);
      setPendingPdfBase64(base64Data);
      setShowEmailModal(true);
      onSetTyping(false);

    } catch (err) {
      onSetTyping(false);
      onAddBotMsg('Failed to prepare the offer PDF. Please try again.');
      console.error(err);
    }
  };

  // ── Step 2: Actually send after HR confirms/edits in the modal ──
  const handleConfirmSendOffer = async () => {
    setShowEmailModal(false);
    onSetTyping(true);

    try {
      const emailHtml = `<div style="font-family: Arial, sans-serif; color: #374151; max-width: 600px; white-space: pre-wrap;">${emailBody}</div>`;

      const emailRes = await fetch(import.meta.env.VITE_SEND_EMAIL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'mutkureu@gmail.com',
          subject: emailSubject,
          body: emailHtml,
          attachments: [
            {
              filename: `Offer_Letter_${firstName}.pdf`,
              content: pendingPdfBase64,
              encoding: 'base64'
            }
          ]
        })
      });

      if (!emailRes.ok) throw new Error('Email backend failed to send.');

      await fetch(OFFER_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', jobId, candidateId: candId, draft, sendEmail: false, salaryRules }),
      });

      onSetTyping(false);
      showToast?.(`Offer sent to ${cand.name}!`, 'success');
      onAddBotMsg(`✅ Offer letter has been sent to **${cand.name}** with the PDF attached.`);

    } catch (err) {
      onSetTyping(false);
      onAddBotMsg('Failed to send the offer. Please check your connection and try again.');
      console.error(err);
    }
  };

  const bounceCss = `@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }`;

  if (viewMode === 'chat-only') {
    return (
      <>
        <style>{bounceCss}</style>
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*" onChange={handleFileUpload} />
        <div style={{ width: '100%', height: '100%', background: '#fff', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
          <div style={{ width: '100%', maxWidth: 640, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <ChatMessages msgs={msgs} typing={typing} messagesEndRef={messagesEndRef} jdTitle={jdTitle} jobId={jobId} cand={cand} handleOption={handleOption} handleCopyCandidate={handleCopyCandidate} renderBotText={renderBotText} />
            <ChatInputBar 
              input={input} 
              onSetInput={onSetInput} 
              onSend={handleChatSend} 
              onAttach={() => fileInputRef.current?.click()} 
              placeholder="Say hi to get started…" 
            />          </div>
        </div>
      </>
    );
  }

  if (viewMode === 'form-preview') {
    return (
      <>
        <style>{bounceCss}</style>
        {showGenerateChoiceModal && (
          <GenerateChoiceModal
            onContinue={() => { setShowGenerateChoiceModal(false); handlePrepareSendOffer(); }}
            onFillSalary={() => { setShowGenerateChoiceModal(false); setShowSalaryModal(true); }}
            onClose={() => setShowGenerateChoiceModal(false)}
          />
        )}
        {showSalaryModal && (
          <SalaryDetailsModal
            rules={salaryRules}
            onChange={setSalaryRules}
            onClose={() => setShowSalaryModal(false)}
          />
        )}
        {showEmailModal && (
          <EmailPreviewModal
            subject={emailSubject}
            body={emailBody}
            onSubjectChange={setEmailSubject}
            onBodyChange={setEmailBody}
            onConfirm={handleConfirmSendOffer}
            onClose={() => setShowEmailModal(false)}
          />
        )}
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,.png,.jpg,.jpeg" onChange={handleFileUpload} />
        <div style={{ display: 'flex', width: '100%', height: '100%' }}>
          <div style={{ width: '50%', borderRight: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', background: '#fff', minWidth: 0 }}>
            <OfferForm draft={draft} onSetDraft={onSetDraft} filledCount={filledCount} totalFields={totalFields} onSubmitForm={handleFormSubmit} />
          </div>
          <PreviewPanel draft={draft} cand={cand} jdTitle={jdTitle} safeBreakup={safeBreakup} totalMonthly={totalMonthly} totalAnnual={totalAnnual} firstName={firstName} todayStr={todayStr} filledCount={filledCount} totalFields={totalFields} handleSendOffer={handlePrepareSendOffer} templateHtml={templateHtml} signature={signature} setSignature={setSignature} />
      </div>
    </>
  );
}

  return (
    <>
      <style>{bounceCss}</style>
      {showGenerateChoiceModal && (
        <GenerateChoiceModal
          onContinue={() => { setShowGenerateChoiceModal(false); handlePrepareSendOffer(); }}
          onFillSalary={() => { setShowGenerateChoiceModal(false); setShowSalaryModal(true); }}
          onClose={() => setShowGenerateChoiceModal(false)}
        />
      )}
      {showSalaryModal && (
        <SalaryDetailsModal
          rules={salaryRules}
          onChange={setSalaryRules}
          onClose={() => setShowSalaryModal(false)}
        />
      )}
      {showEmailModal && (
        <EmailPreviewModal
          subject={emailSubject}
          body={emailBody}
          onSubjectChange={setEmailSubject}
          onBodyChange={setEmailBody}
          onConfirm={handleConfirmSendOffer}
          onClose={() => setShowEmailModal(false)}
        />
      )}
      <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,.png,.jpg,.jpeg" onChange={handleFileUpload} />
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <div style={{ width: '32%', minWidth: 320, maxWidth: 420, flexShrink: 0, borderRight: `1px solid ${BORDER}`, background: '#fff', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '13px 18px', borderBottom: `1px solid ${BORDER}`, background: '#fff', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button
              onClick={onBack}
              title="Back to pipeline"
              style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', color: TEXT_DARK, flexShrink: 0 }}
            >
              <ArrowLeft size={14} />
            </button>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #F07C2D, #EA580C)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#fff', flexShrink: 0 }}>✦</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: TEXT_DARK }}>Offer Copilot</div>
              <div style={{ fontSize: 10, color: TEXT_MID }}>Chat updates the document live</div>
            </div>
            <button onClick={() => setViewMode('form-preview')} title="Switch to form" style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 7, border: `1px solid ${BORDER}`, background: BG_SOFT, color: TEXT_MID, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <FileText size={11} /> Form
            </button>
          </div>
          <ChatMessages msgs={msgs} typing={typing} messagesEndRef={messagesEndRef} jdTitle={jdTitle} jobId={jobId} cand={cand} handleOption={handleOption} handleCopyCandidate={handleCopyCandidate} renderBotText={renderBotText} />
          <ChatInputBar 
            input={input} 
            onSetInput={onSetInput} 
            onSend={handleChatSend} 
            onAttach={() => fileInputRef.current?.click()} 
            placeholder="Type here to update document…" 
          />
        </div>
        <PreviewPanel draft={draft} cand={cand} jdTitle={jdTitle} safeBreakup={safeBreakup} totalMonthly={totalMonthly} totalAnnual={totalAnnual} firstName={firstName} todayStr={todayStr} filledCount={filledCount} totalFields={totalFields} handleSendOffer={handlePrepareSendOffer} templateHtml={templateHtml} signature={signature} setSignature={setSignature} />
      </div>
    </>
  );
}

// ── Dynamic Custom Template Renderer ──────────────────────────────────────────
function CustomTemplatePreview({ html, draft }: { html: string; draft: OfferDraft }) {
  const standardValues: Record<string, string> = {
    'Designation': draft.designation,
    'Base CTC': draft.baseCTC,
    'Variable Pay': draft.variablePay,
    'Joining Date': draft.joiningDate,
    'Location': draft.location,
    'Probation': draft.probation,
    'Reporting Manager': draft.reportingManager,
    'Candidate Name': '', 
    'Candidate Phone': draft.candidatePhone,
    'Candidate Address': draft.candidateAddress,
  };

  const processedHtml = html.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match, key) => {
    const k = key.trim();
    if (standardValues[k]) return standardValues[k];
    if (draft.customValues && draft.customValues[k]) return draft.customValues[k];
    return `<span style="color: #D1D5DB; border-bottom: 1px solid #9CA3AF;">&nbsp;&nbsp;${k}&nbsp;&nbsp;</span>`;
  });

  return (
    <div style={{ background: '#fff', padding: '56px 64px', maxWidth: 700, margin: '0 auto', boxShadow: '0 4px 24px rgba(0,0,0,0.09)', borderRadius: 2 }}>
      <div id="offer-letter-content" dangerouslySetInnerHTML={{ __html: processedHtml }} />
    </div>
  );
}

// ── OfferLetterPreview — matches the Offer_Letter.docx template exactly ──────
function OfferLetterPreview({ draft, cand, jdTitle, safeBreakup, totalMonthly, totalAnnual, firstName, todayStr }: {
  draft: OfferDraft; cand: any; jdTitle: string; safeBreakup: SalaryBreakup;
  totalMonthly: number; totalAnnual: number; firstName: string; todayStr: string;
}) {
  const blank = (w = 120) => (
    <span style={{ display: 'inline-block', borderBottom: '1px solid #9CA3AF', minWidth: w, color: '#D1D5DB' }}>&nbsp;</span>
  );

  return (
    <div style={{
      background: '#fff', color: '#1F2937', fontFamily: 'Arial, sans-serif',
      fontSize: 13, lineHeight: 1.8, padding: '56px 64px',
      maxWidth: 700, margin: '0 auto',
      boxShadow: '0 4px 24px rgba(0,0,0,0.09)', borderRadius: 2,
    }}>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, letterSpacing: '0.1em', marginBottom: 36, textDecoration: 'underline' }}>
        OFFER LETTER
      </div>
      <div style={{ textAlign: 'right', marginBottom: 24, fontSize: 12 }}>Date:&nbsp;{todayStr}</div>
      <div style={{ marginBottom: 24, fontSize: 13 }}>
        <div>To</div>
        <div style={{ marginLeft: 24 }}>
          <div>{cand.name ? `Mr./Ms. ${cand.name}` : blank(180)}</div>
          <div>{draft.candidateAddress || blank(260)}&nbsp;(residential address)</div>
        </div>
      </div>
      <div style={{ marginBottom: 24, fontSize: 13 }}>Phone No:&nbsp;{draft.candidatePhone || blank(200)}</div>
      <div style={{ marginBottom: 20, fontSize: 13 }}><strong>Sub: Offer Letter</strong></div>
      <p style={{ margin: '0 0 14px' }}>Dear {firstName || blank(100)},</p>
      <p style={{ margin: '0 0 14px' }}>We are pleased to offer you the post of <strong>{draft.designation || jdTitle || blank(140)}</strong> based at <strong>{draft.location || blank(100)}</strong>.</p>
      <p style={{ margin: '0 0 14px' }}>The compensation structure is enclosed for your reference as Annexure.</p>
      <p style={{ margin: '0 0 14px' }}>Your employment with the Company will be subject to strict adherence to the policies and procedures of the Company.</p>
      <p style={{ margin: '0 0 14px' }}>You will be on probation for <span style={{ textDecoration: 'underline' }}>{draft.probation || 'six months'}</span>.</p>
      <p style={{ margin: '0 0 14px' }}>This offer is subject to background verification and medical fitness.</p>
      <p style={{ margin: '0 0 14px' }}>On acceptance of the terms and conditions as per this offer letter, you will be able to terminate your employment with the Company by giving one (1) month notice to the Company and vice versa. You shall not be eligible to avail leave during the notice period.</p>
      {draft.reportingManager && <p style={{ margin: '0 0 14px' }}>You will be reporting to <strong>{draft.reportingManager}</strong>.</p>}
      {draft.variablePay && <p style={{ margin: '0 0 14px' }}>Variable Pay: <strong>{draft.variablePay}</strong></p>}
      <p style={{ margin: '0 0 14px' }}>We welcome you to join the Company and would be happy if you can sign the duplicate copy of this letter in token of your acceptance of the offer of employment with the Company.</p>
      <p style={{ margin: '0 0 14px' }}>If you have any question, please clarify from the undersigned.</p>
      <p style={{ margin: '0 0 14px' }}>With regards,</p>
      <div style={{ marginTop: 40, marginBottom: 48 }}>
        <div style={{ borderTop: '1px solid #374151', width: 180, paddingTop: 6, fontSize: 12 }}>____________________________</div>
        <div style={{ borderTop: '1px solid #374151', width: 180, paddingTop: 6, fontSize: 12, marginTop: 4 }}>____________________________</div>
        <div style={{ fontWeight: 700, fontSize: 12, marginTop: 6 }}>HR – Head</div>
      </div>
      <div style={{ borderTop: '1px solid #D1D5DB', paddingTop: 20, marginBottom: 40, fontSize: 13 }}>
        <p style={{ margin: '0 0 10px' }}>I accept the aforesaid terms &amp; conditions and this offer of employment. I shall keep the contents of this document confidential.</p>
        <p style={{ margin: '0 0 18px' }}>I will join on {draft.joiningDate || blank(140)}.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
          <div>Name:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{blank(200)}</div>
          <div>Signature:&nbsp;&nbsp;&nbsp;{blank(200)}</div>
          <div>Date:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{blank(200)}</div>
        </div>
      </div>
      <div style={{ borderTop: '2px solid #1F2937', paddingTop: 32 }}>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, marginBottom: 20, letterSpacing: '0.04em' }}>Annexure</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#F3F4F6' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, border: '1px solid #D1D5DB' }}>Components*</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, border: '1px solid #D1D5DB' }}>Monthly (INR)</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, border: '1px solid #D1D5DB' }}>Annual (INR)</th>
            </tr>
          </thead>
          <tbody>
            {BREAKUP_ROWS.map((row, i) => (
              <tr key={row.key} style={{ background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>
                <td style={{ padding: '7px 10px', border: '1px solid #E5E7EB' }}>{row.label}</td>
                <td style={{ padding: '7px 10px', border: '1px solid #E5E7EB', textAlign: 'right', color: safeBreakup[row.key].monthly ? TEXT_DARK : TEXT_LIGHT }}>{safeBreakup[row.key].monthly ? Number(safeBreakup[row.key].monthly).toLocaleString('en-IN') : ''}</td>
                <td style={{ padding: '7px 10px', border: '1px solid #E5E7EB', textAlign: 'right', color: safeBreakup[row.key].annual ? TEXT_DARK : TEXT_LIGHT }}>{safeBreakup[row.key].annual ? Number(safeBreakup[row.key].annual).toLocaleString('en-IN') : ''}</td>
              </tr>
            ))}
            <tr style={{ background: '#F3F4F6' }}>
              <td style={{ padding: '8px 10px', fontWeight: 700, border: '1px solid #D1D5DB' }}>Total</td>
              <td style={{ padding: '8px 10px', fontWeight: 700, border: '1px solid #D1D5DB', textAlign: 'right' }}>{totalMonthly ? fmtAmount(totalMonthly) : ''}</td>
              <td style={{ padding: '8px 10px', fontWeight: 700, border: '1px solid #D1D5DB', textAlign: 'right' }}>{totalAnnual ? fmtAmount(totalAnnual) : ''}</td>
            </tr>
            <tr style={{ background: '#F3F4F6' }}>
              <td style={{ padding: '8px 10px', fontWeight: 700, border: '1px solid #D1D5DB' }}>CTC</td>
              <td style={{ padding: '8px 10px', fontWeight: 700, border: '1px solid #D1D5DB', textAlign: 'right' }}>{totalMonthly ? fmtAmount(totalMonthly) : (draft.baseCTC || '')}</td>
              <td style={{ padding: '8px 10px', fontWeight: 700, border: '1px solid #D1D5DB', textAlign: 'right' }}>{totalAnnual ? fmtAmount(totalAnnual) : ''}</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: TEXT_MID, marginTop: 10 }}>* The components can vary depending on the company and the way it would want to structure the salary.</p>
      </div>
    </div>
  );
}

// ── ChatMessages — extracted to top level ────────────────────────────────────
function ChatMessages({ msgs, typing, messagesEndRef, jdTitle, jobId, cand, handleOption, handleCopyCandidate, renderBotText }: {
  msgs: ChatMsg[]; typing: boolean; messagesEndRef: React.RefObject<HTMLDivElement | null>;
  jdTitle: string; jobId: string; cand: any;
  handleOption: (opt: string) => void;
  handleCopyCandidate: (card: CandidateOfferCard) => void;
  renderBotText: (text: string) => React.ReactNode;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {msgs.length === 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, textAlign: 'center', padding: '60px 24px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg, #F07C2D, #EA580C)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', boxShadow: '0 4px 12px rgba(240,124,45,0.3)' }}>✦</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT_DARK, marginBottom: 6 }}>Offer Copilot</div>
            <div style={{ fontSize: 13, color: TEXT_MID, maxWidth: 300, lineHeight: 1.6 }}>Say hi to start generating an offer letter for <strong>{cand.name}</strong>.</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 }}>
            {[
              { icon: <FileText size={13} />, label: 'Fill a form' },
              { icon: <MessageSquare size={13} />, label: 'Chat with me' },
              { icon: <Copy size={13} />, label: 'Copy from another' },
              { icon: <Upload size={13} />, label: 'Upload format' },
            ].map(hint => (
              <div key={hint.label} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', background: BG_SOFT, border: `1px solid ${BORDER}`, borderRadius: 20, fontSize: 11, color: TEXT_MID }}>
                {hint.icon} {hint.label}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: TEXT_LIGHT, marginTop: 4 }}>{jdTitle} · {jobId}</div>
        </div>
      )}

      {msgs.map((msg: ChatMsg, i: number) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 8 }}>
          <div style={{ maxWidth: '95%', padding: '10px 14px', borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px', background: msg.role === 'user' ? ORANGE : '#fff', color: msg.role === 'user' ? '#fff' : TEXT_DARK, fontSize: 12, lineHeight: 1.5, border: msg.role === 'bot' ? `1px solid ${BORDER}` : 'none', boxShadow: msg.role === 'bot' ? '0 1px 3px rgba(0,0,0,0.04)' : 'none' }}>
            {msg.role === 'bot' ? renderBotText(msg.text) : msg.text}
          </div>
          {msg.options && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {msg.options.map((opt: string) => (
                <button key={opt} onClick={() => handleOption(opt)} style={{ padding: '6px 12px', borderRadius: 16, border: `1px solid ${ORANGE}`, background: ORANGE_LIGHT, color: ORANGE, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s' }}>
                  {opt}
                </button>
              ))}
            </div>
          )}
          {msg.candidateCards && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '90%' }}>
              {msg.candidateCards.map((card: CandidateOfferCard) => (
                <div key={card.id} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>{card.name}</div>
                    <div style={{ fontSize: 11, color: TEXT_MID, marginTop: 2 }}>{card.draft.designation || 'No designation'} · {card.draft.baseCTC || 'No CTC'}</div>
                  </div>
                  <button onClick={() => handleCopyCandidate(card)} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: ORANGE, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Copy size={11} /> Copy
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {typing && (
        <div style={{ padding: '10px 14px', background: '#fff', borderRadius: '4px 18px 18px 18px', border: `1px solid ${BORDER}`, width: 'fit-content', display: 'flex', gap: 4, alignItems: 'center' }}>
          {[0, 1, 2].map(d => <div key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: TEXT_LIGHT, animation: `bounce 1.2s ${d * 0.2}s infinite` }} />)}
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

// ── ChatInputBar — extracted to top level ──────────
function ChatInputBar({ input, onSetInput, onSend, onAttach, placeholder = 'Type a message...' }: {
  input: string; onSetInput: (v: string) => void; onSend: () => void; onAttach: () => void; placeholder?: string;
}) {
  return (
    <div style={{ padding: '10px 14px', background: '#fff', borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: BG_SOFT, borderRadius: 24, border: `1px solid ${BORDER}`, padding: '4px 6px 4px 14px' }}>
        
        {/* NEW: Attachment Button */}
        <button 
          onClick={onAttach} 
          style={{ background: 'none', border: 'none', color: TEXT_MID, cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center' }} 
          title="Upload document template"
        >
          <Paperclip size={16} />
        </button>

        <input value={input} onChange={e => onSetInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && onSend()} placeholder={placeholder} style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, outline: 'none', color: TEXT_DARK }} />
        <button onClick={onSend} disabled={!input.trim()} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: input.trim() ? ORANGE : '#E5E7EB', cursor: input.trim() ? 'pointer' : 'default', color: '#fff', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}>↑</button>
      </div>
    </div>
  );
}

// ── OfferForm — extracted to top level ───────────────────────────────────────
function OfferForm({ draft, onSetDraft, filledCount, totalFields, onSubmitForm }: {
  draft: OfferDraft; onSetDraft: (patch: Partial<OfferDraft>) => void;
  filledCount: number; totalFields: number; onSubmitForm: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}`, background: BG_SOFT, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT_DARK }}>Offer Details</div>
          <div style={{ fontSize: 11, color: TEXT_MID, marginTop: 1 }}>Preview updates as you type</div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: filledCount === totalFields ? '#10B981' : TEXT_MID, background: filledCount === totalFields ? '#D1FAE5' : '#F3F4F6', padding: '3px 10px', borderRadius: 12 }}>
          {filledCount}/{totalFields} filled
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FormSection title="Role">
            <FormField label="Designation" value={draft.designation} onChange={v => onSetDraft({ designation: v })} placeholder="e.g. Senior Software Engineer" />
            <FormField label="Reporting Manager" value={draft.reportingManager} onChange={v => onSetDraft({ reportingManager: v })} placeholder="e.g. Priya Sharma" />
            <FormField label="Work Location" value={draft.location} onChange={v => onSetDraft({ location: v })} placeholder="e.g. Pune / Remote" />
          </FormSection>
          <FormSection title="Compensation">
            <FormField label="Base CTC" value={draft.baseCTC} onChange={v => onSetDraft({ baseCTC: v })} placeholder="e.g. ₹18 LPA" />
            <div style={{ fontSize: 10, color: TEXT_MID, marginTop: -8, marginBottom: 4, paddingLeft: 2 }}>* Salary breakup will auto-calculate after submitting. You can tweak it later via chat.</div>
            <FormField label="Variable Pay" value={draft.variablePay} onChange={v => onSetDraft({ variablePay: v })} placeholder="e.g. ₹2 LPA" />
          </FormSection>
          <FormSection title="Timeline">
            <FormField label="Joining Date" value={draft.joiningDate} onChange={v => onSetDraft({ joiningDate: v })} placeholder="e.g. 1 August 2026" />
            <FormField label="Probation Period" value={draft.probation} onChange={v => onSetDraft({ probation: v })} placeholder="e.g. 3 months" />
          </FormSection>
          <FormSection title="Candidate Details">
            <FormField label="Residential Address" value={draft.candidateAddress} onChange={v => onSetDraft({ candidateAddress: v })} placeholder="Full address" />
            <FormField label="Phone Number" value={draft.candidatePhone} onChange={v => onSetDraft({ candidatePhone: v })} placeholder="e.g. +91 98765 43210" />
          </FormSection>
        </div>
      </div>

      <div style={{ padding: '14px 20px', borderTop: `1px solid ${BORDER}`, background: '#fff', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
        <button onClick={onSubmitForm} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: TEXT_DARK, color: '#fff', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Confirm & Return to Chat <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── PreviewPanel — extracted to top level ────────────────────────────────────
function PreviewPanel({ 
  draft, cand, jdTitle, safeBreakup, totalMonthly, totalAnnual, 
  firstName, todayStr, filledCount, totalFields, handleSendOffer, templateHtml,
  signature, setSignature
}: {
  draft: OfferDraft; cand: any; jdTitle: string; safeBreakup: SalaryBreakup;
  totalMonthly: number; totalAnnual: number; firstName: string; todayStr: string;
  filledCount: number; totalFields: number; handleSendOffer: () => void;
  templateHtml?: string | null; 
  signature: { url: string, x: number, y: number, width: number, height: number } | null;
  setSignature: React.Dispatch<React.SetStateAction<{ url: string, x: number, y: number, width: number, height: number } | null>>;
}) {
  const handleDownloadPDF = () => {
    const content = document.getElementById('offer-letter-content');
    if (!content) return;

    const clone = content.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.no-print').forEach(el => el.remove());

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Offer_Letter_${firstName}</title>
            <style>
              body { margin: 0; padding: 20px 40px; font-family: Arial, sans-serif; -webkit-print-color-adjust: exact; color-adjust: exact; }
              @media print { @page { margin: 0.5cm; } }
            </style>
          </head>
          <body>
            ${clone.innerHTML}
            <script>setTimeout(() => { window.print(); window.close(); }, 250);</script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG_SOFT, minWidth: 0 }}>
      <div style={{ padding: '11px 20px', borderBottom: `1px solid ${BORDER}`, background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK, display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileText size={13} style={{ color: ORANGE }} /> Live Preview
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 11, color: filledCount === totalFields ? '#10B981' : TEXT_MID, fontWeight: 600 }}>{filledCount}/{totalFields} fields filled</div>
          <button onClick={handleDownloadPDF} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: '#fff', color: TEXT_DARK, transition: 'background 0.15s', display: 'flex', alignItems: 'center', gap: 6 }} onMouseOver={(e) => e.currentTarget.style.background = '#F9FAFB'} onMouseOut={(e) => e.currentTarget.style.background = '#fff'}>
            Download PDF
          </button>
          <button onClick={handleSendOffer} disabled={!draft.baseCTC || !draft.joiningDate} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: (!draft.baseCTC || !draft.joiningDate) ? 'default' : 'pointer', background: (!draft.baseCTC || !draft.joiningDate) ? '#E5E7EB' : '#10B981', color: (!draft.baseCTC || !draft.joiningDate) ? '#9CA3AF' : '#fff', transition: 'background 0.15s' }}>
            Send Offer to {firstName}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
        <div 
          id="offer-letter-content" 
          style={{ position: 'relative' }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            setSignature(prev => prev ? { ...prev, x: e.clientX - rect.left - prev.width / 2, y: e.clientY - rect.top - prev.height / 2 } : null);
          }}
        >
          {/* THE FLOATING SIGNATURE */}
          {signature && (
            <div id="signature-wrapper" style={{ position: 'absolute', left: signature.x, top: signature.y, width: signature.width, height: signature.height, zIndex: 50 }}>
              <img
                src={signature.url}
                alt="Signature"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', 'signature')}
                style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab', objectFit: 'fill' }}
              />

              {/* DELETE BUTTON */}
              <div
                className="no-print"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSignature(null); }}
                style={{
                  position: 'absolute', top: -10, right: -10, width: 18, height: 18,
                  borderRadius: '50%', background: '#EF4444', border: '2px solid #fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1, userSelect: 'none',
                }}
                title="Remove signature"
              >
                ×
              </div>

              {/* RIGHT EDGE — horizontal resize */}
              <div
                className="no-print"
                onMouseDown={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  const startX = e.clientX;
                  const startWidth = signature.width;
                  const onMove = (me: MouseEvent) => {
                    const newWidth = Math.min(500, Math.max(40, startWidth + (me.clientX - startX)));
                    setSignature(prev => prev ? { ...prev, width: newWidth } : null);
                  };
                  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
                style={{ position: 'absolute', right: -4, top: '50%', transform: 'translateY(-50%)', width: 8, height: 24, borderRadius: 4, background: ORANGE, border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', cursor: 'ew-resize' }}
                title="Drag to resize width"
              />

              {/* BOTTOM EDGE — vertical resize */}
              <div
                className="no-print"
                onMouseDown={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  const startY = e.clientY;
                  const startHeight = signature.height;
                  const onMove = (me: MouseEvent) => {
                    const newHeight = Math.min(500, Math.max(20, startHeight + (me.clientY - startY)));
                    setSignature(prev => prev ? { ...prev, height: newHeight } : null);
                  };
                  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
                style={{ position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)', width: 24, height: 8, borderRadius: 4, background: ORANGE, border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', cursor: 'ns-resize' }}
                title="Drag to resize height"
              />

              {/* CORNER — diagonal resize (both) */}
              <div
                className="no-print"
                onMouseDown={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startWidth = signature.width;
                  const startHeight = signature.height;
                  const onMove = (me: MouseEvent) => {
                    const newWidth = Math.min(500, Math.max(40, startWidth + (me.clientX - startX)));
                    const newHeight = Math.min(500, Math.max(20, startHeight + (me.clientY - startY)));
                    setSignature(prev => prev ? { ...prev, width: newWidth, height: newHeight } : null);
                  };
                  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
                style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, borderRadius: '50%', background: ORANGE, border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', cursor: 'nwse-resize' }}
                title="Drag to resize"
              />
            </div>
          )}

          {/* THE DOCUMENT CONTENT */}
          {templateHtml ? (
            <CustomTemplatePreview html={templateHtml} draft={draft} />
          ) : (
            <OfferLetterPreview draft={draft} cand={cand} jdTitle={jdTitle} safeBreakup={safeBreakup} totalMonthly={totalMonthly} totalAnnual={totalAnnual} firstName={firstName} todayStr={todayStr} />
          )}
        </div>
      </div>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', background: BG_SOFT, borderBottom: `1px solid ${BORDER}`, fontSize: 12, fontWeight: 700, color: TEXT_DARK }}>{title}</div>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

export function GenerateChoiceModal({ onContinue, onFillSalary, onClose }: { onContinue: () => void; onFillSalary: () => void; onClose: () => void; }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 360 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: TEXT_DARK }}>Generate Offer</div>
        <div style={{ fontSize: 13, color: TEXT_MID, marginBottom: 20 }}>Do you want to continue generating the offer, or set custom salary breakup rules first?</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onFillSalary} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', fontSize: 13, cursor: 'pointer', color: TEXT_DARK }}>Fill Salary Details</button>
          <button onClick={onContinue} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: ORANGE, color: '#fff', fontSize: 13, cursor: 'pointer' }}>Continue</button>
        </div>
      </div>
    </div>
  );
}

export function SalaryDetailsModal({ rules, onChange, onClose }: { rules: SalaryRules; onChange: (r: SalaryRules) => void; onClose: () => void; }) {
  const [local, setLocal] = useState<SalaryRules>(rules);
  const field = (key: keyof SalaryRules, label: string) => (
    <div key={key}>
      <label style={labelStyle}>{label}</label>
      <input type="number" value={local[key]} onChange={e => setLocal(p => ({ ...p, [key]: Number(e.target.value) }))} style={inputStyle} />
    </div>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 420, maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: TEXT_DARK }}>Salary Breakup Rules</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {field('basicPercentOfCTC', 'Basic (% of CTC)')}
          {field('hraPercentOfBasic', 'HRA (% of Basic)')}
          {field('pfPercentOfBasic', 'PF (% of Basic)')}
          {field('medicalAnnual', 'Medical (Annual ₹)')}
          {field('conveyanceAnnual', 'Conveyance (Annual ₹)')}
          {field('ltaAnnual', 'LTA (Annual ₹)')}
          {field('bonusAnnual', 'Bonus (Annual ₹)')}
          {field('offerValidityDays', 'Offer Validity (Days)')}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', fontSize: 13, cursor: 'pointer', color: TEXT_DARK }}>Cancel</button>
          <button onClick={() => { onChange(local); onClose(); }} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: ORANGE, color: '#fff', fontSize: 13, cursor: 'pointer' }}>Save & Close</button>
        </div>
      </div>
    </div>
  );
}