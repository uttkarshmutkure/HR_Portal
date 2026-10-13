const BASE_URL = import.meta.env.VITE_OFFER_AGENT_URL as string;
 
// ── Types (mirrors OfferDraft in InterviewPipelinePage) ───────────────────────
export interface OfferDraft {
  designation:     string;
  baseCTC:         string;
  variablePay:     string;
  esops:           string;
  joiningDate:     string;
  location:        string;
  probation:       string;
  reportingManager:string;
}
 
export interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
}
 
export interface SavedOffer {
  candidateId:   string;
  candidateName: string;
  draft:         OfferDraft;
  status:        string;
  createdAt:     string;
}
 
// ── 1. Send a chat message ────────────────────────────────────────────────────
// Call this instead of the local simulateBotReply when you want Gemini to reply.
export async function sendOfferChat(params: {
  jobId:        string;
  candidateId:  string;
  message:      string;
  history:      ChatMessage[];
  currentDraft: Partial<OfferDraft>;
}): Promise<{ reply: string; offerUpdate: Partial<OfferDraft> }> {
  const res = await fetch(BASE_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ action: "chat", ...params }),
  });
  if (!res.ok) throw new Error(`Chat request failed: ${res.status}`);
  return res.json();
}
 
// ── 2. Generate polished offer letter + save to BQ + optionally send email ───
export async function generateOffer(params: {
  jobId:       string;
  candidateId: string;
  draft:       OfferDraft;
  sendEmail:   boolean;
}): Promise<{ offerHtml: string; savedToDB: boolean; emailSent: boolean }> {
  const res = await fetch(BASE_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ action: "generate", ...params }),
  });
  if (!res.ok) throw new Error(`Generate request failed: ${res.status}`);
  return res.json();
}
 
// ── 3. Get all saved offers for a job (for the "copy" feature) ───────────────
export async function getJobOffers(jobId: string): Promise<SavedOffer[]> {
  const res = await fetch(BASE_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ action: "get_offers", jobId }),
  });
  if (!res.ok) throw new Error(`Get offers request failed: ${res.status}`);
  const data = await res.json();
  return data.offers ?? [];
}