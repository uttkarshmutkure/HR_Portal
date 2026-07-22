import { TopCandidate } from './screening';

// ─────────────────────────────────────────────────────────────────────────────
// Email Service
// DEV:  No real emails sent — logs a styled preview to the console.
//       The UI reads the returned EmailPayload to show a preview modal + copy link.
// PROD: Set VITE_APP_ENV=production → fires POST to VITE_SEND_EMAIL_URL
//
// Dev test address: mutkureu@gmail.com
// ─────────────────────────────────────────────────────────────────────────────

const IS_PROD   = import.meta.env.VITE_APP_ENV === 'production';
const DEV_EMAIL = 'mutkureu@gmail.com';

export interface EmailPayload {
  to:      string;
  subject: string;
  body:    string;
}

// ── Internal dispatcher ───────────────────────────────────────────────────────
async function dispatch(payload: EmailPayload, label: string, color: string, isRecruiter: boolean = false): Promise<void> {
  // 🚀 THE INTERCEPTOR: Route to personal email unless it's explicitly flagged as a recruiter
  const finalTo = isRecruiter ? payload.to : DEV_EMAIL;
  const payloadToSend = { ...payload, to: finalTo };

  if (!IS_PROD) {
    console.log(`%c[EmailService] ${label}`, `color: ${color}; font-weight: bold;`);
    console.log({ ...payloadToSend, _note: `DEV — original candidate email was: ${payload.to}` });
    return;
  }
  
  // In Production, send via the dedicated API Gateway URL
  try {
    const emailUrl = import.meta.env.VITE_SEND_EMAIL_URL;
    if (!emailUrl) {
      throw new Error("VITE_SEND_EMAIL_URL is missing in your .env file!");
    }

    await fetch(emailUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payloadToSend),
    });
  } catch (error) {
    console.error(`[EmailService] Failed to send email: ${label}`, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export const EmailService = {

  // ── Original methods ───────────────────────────────────────────────────────

  sendShortlistEmail(candidate: TopCandidate, jdTitle: string): void {
    dispatch(
      {
        to:      candidate.email,
        subject: `Your application for "${jdTitle}" has been shortlisted!`,
        body: `Dear ${candidate.name},\n\nWe are pleased to inform you that your application for the position of "${jdTitle}" has been reviewed and you have been shortlisted for the next stage.\n\nOur team will be in touch shortly with further details about the interview process.\n\nBest regards,\nHR Team`,
      },
      'SHORTLIST EMAIL SENT',
      '#16A34A',
    );
  },

  sendRejectionEmail(candidate: TopCandidate, jdTitle: string): void {
    dispatch(
      {
        to:      candidate.email,
        subject: `Update on your application for "${jdTitle}"`,
        body: `Dear ${candidate.name},\n\nThank you for your interest in the "${jdTitle}" position and for taking the time to apply. After careful consideration, we regret to inform you that we will not be moving forward with your application at this time.\n\nWe appreciate your effort and encourage you to apply for future openings that match your skills and experience.\n\nBest regards,\nHR Team`,
      },
      'REJECTION EMAIL SENT',
      '#DC2626',
    );
  },

  sendInterviewEmail(candidate: TopCandidate, jdTitle: string): void {
    dispatch(
      {
        to:      candidate.email,
        subject: `Interview Invitation — "${jdTitle}"`,
        body: `Dear ${candidate.name},\n\nCongratulations! We would like to invite you for an interview for the position of "${jdTitle}". Our team will reach out to you shortly to schedule a convenient time.\n\nBest regards,\nHR Team`,
      },
      'INTERVIEW INVITE EMAIL SENT',
      '#2563EB',
    );
  },

  // ── New methods for interview pipeline ─────────────────────────────────────

  buildRoundInvite(candidate: TopCandidate, jdTitle: string, round: 'Round 1' | 'Technical' | 'HR Round'): EmailPayload {
    return {
      to:      candidate.email,
      subject: `Interview Invitation — ${round} | ${jdTitle}`,
      body: `Dear ${candidate.name},\n\nCongratulations! You have been selected to proceed to the ${round} interview for the role of "${jdTitle}".\n\nOur team will share further details and scheduling information shortly.\n\nBest regards,\nHR Team`,
    };
  },

  buildFeedbackLink(interviewerEmail: string, candidateName: string, round: string, feedbackUrl: string): EmailPayload {
    return {
      to:      interviewerEmail,
      subject: `Feedback form — ${round} interview for ${candidateName}`,
      body: `Hi,\n\nPlease submit your feedback for ${candidateName}'s ${round} interview using the secure link below.\n\n${feedbackUrl}\n\nThis link expires in 7 days. Please do not share it with others.\n\nThank you,\nHR Team`,
    };
  },

  async send(payload: EmailPayload, isRecruiter: boolean = false): Promise<void> {
    const label = payload.subject.slice(0, 40);
    await dispatch(payload, label, '#F07C2D', isRecruiter);
  },

  sendOfferLetter(candidate: TopCandidate, jdTitle: string): void {
    dispatch(
      {
        to:      candidate.email,
        subject: `Offer Letter — ${jdTitle}`,
        body: `Dear ${candidate.name},\n\nWe are delighted to extend an offer for the role of "${jdTitle}".\n\nPlease find the formal offer letter attached. Kindly review and revert at your earliest convenience.\n\nWelcome to the team!\n\nBest regards,\nHR Team`,
      },
      'OFFER LETTER SENT',
      '#7C3AED',
    );
  },
};