import { createBrowserRouter } from "react-router";
import LandingPage             from "./pages/LandingPage";
import DashboardPage           from "./pages/DashboardPage"; 
import JobListPage             from "./pages/JobListPage";
import JobResultsPage          from "./pages/JobResultsPage";
import CandidateDetailPage     from "./pages/CandidateDetailPage";
import ShortlistedPage         from "./pages/ShortlistedPage";
import InterviewPipelinePage   from "./pages/InterviewPipelinePage";
import CandidateTimelinePage   from "./pages/CandidateTimelinePage";
import FeedbackFormPage        from "./pages/FeedbackFormPage";
import CandidateSlotPage       from "./pages/Candidateslotpage";
import OfferGenerationPage     from "./pages/OfferGenerationPage"; // <-- NEW IMPORT

// ── Import the Global Hub Pages ──
import { 
  GlobalShortlistedPage, 
  GlobalInterviewsPage, 
  //GlobalTimelinePage, 
  GlobalFeedbackPage 
} from "./pages/GlobalSidebarPages";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: LandingPage,
  },
  {
    path: "/dashboard", 
    Component: DashboardPage,
  },
  {
    path: "/jobs",
    Component: JobListPage,
  },
  
  // ── Global Sidebar Hub Routes ──
  {
    path: "/shortlisted",
    Component: GlobalShortlistedPage,
  },
  {
    path: "/interviews",
    Component: GlobalInterviewsPage,
  },
  // {
  //   path: "/timeline",
  //   Component: GlobalTimelinePage,
  // },
  {
    path: "/feedback",
    Component: GlobalFeedbackPage,
  },

  // ── Dynamic / Specific Job & Candidate Routes ──
  {
    path: "/jobs/:jobId/candidates/:candidateId/timeline",
    Component: CandidateTimelinePage,
  },
  {
    path: "/jobs/:jobId/candidates/:candidateId",
    Component: CandidateDetailPage,
  },
  // ── NEW: Dedicated Offer Copilot Route ──
  {
    path: "/jobs/:jobId/candidates/:candidateId/offer",
    Component: OfferGenerationPage,
  },
  {
    path: "/jobs/:jobId/shortlisted",
    Component: ShortlistedPage,
  },
  {
    path: "/jobs/:jobId/pipeline",
    Component: InterviewPipelinePage,
  },
  {
    path: "/jobs/:jobId",
    Component: JobResultsPage,
  },
  
  // ── Public feedback link (no auth) ──
  {
    path: "/feedback/:token",
    Component: FeedbackFormPage,
  },
  
  // ── Public slot selection link (no auth) ──
  {
    path: "/schedule/:token",
    Component: CandidateSlotPage,
  },
]);