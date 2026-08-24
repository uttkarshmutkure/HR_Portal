import { createBrowserRouter } from "react-router";
import LandingPage             from "./pages/LandingPage";
import DashboardPage           from "./pages/DashboardPage"; 
import JobListPage             from "./pages/JobListPage";
import JobResultsPage          from "./pages/JobResultsPage";
import CandidateDetailPage     from "./pages/CandidateDetailPage";
import ShortlistedPage         from "./pages/ShortlistedPage";
import InterviewPipelinePage   from "./pages/InterviewPipelinePage";
import CandidateTimelinePage   from "./pages/CandidateTimelinePage";
import FeedbackFormPage        from "./pages/Feedbackformpage";
import CandidateSlotPage       from "./pages/Candidateslotpage";
import OfferGenerationPage     from "./pages/OfferGenerationPage"; // <-- NEW IMPORT
import LoginPage               from "./pages/LoginPage";
import ProtectedRoute          from "./components/ProtectedRoute";

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
    path: "/login",
    Component: LoginPage,
  },
  {
    path: "/dashboard", 
    element: (
      <ProtectedRoute allowedRoles={["hr"]}>
        <DashboardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/jobs",
    element: (
      <ProtectedRoute>
        <JobListPage />
      </ProtectedRoute>
    ),
  },
  
  // ── Global Sidebar Hub Routes ──
  {
    path: "/shortlisted",
    element: (
      <ProtectedRoute allowedRoles={["hr"]}>
        <GlobalShortlistedPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/interviews",
    element: (
      <ProtectedRoute>
        <GlobalInterviewsPage />
      </ProtectedRoute>
    ),
  },
  // {
  //   path: "/timeline",
  //   Component: GlobalTimelinePage,
  // },
  {
    path: "/feedback",
    element: (
      <ProtectedRoute>
        <GlobalFeedbackPage />
      </ProtectedRoute>
    ),
  },

  // ── Dynamic / Specific Job & Candidate Routes ──
  {
    path: "/jobs/:jobId/candidates/:candidateId/timeline",
    element: (
      <ProtectedRoute>
        <CandidateTimelinePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/jobs/:jobId/candidates/:candidateId",
    element: (
      <ProtectedRoute>
        <CandidateDetailPage />
      </ProtectedRoute>
    ),
  },
  // ── NEW: Dedicated Offer Copilot Route ──
  {
    path: "/jobs/:jobId/candidates/:candidateId/offer",
    element: (
      <ProtectedRoute>
        <OfferGenerationPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/jobs/:jobId/shortlisted",
    element: (
      <ProtectedRoute>
        <ShortlistedPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/jobs/:jobId/pipeline",
    element: (
      <ProtectedRoute>
        <InterviewPipelinePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/jobs/:jobId",
    element: (
      <ProtectedRoute>
        <JobResultsPage />
      </ProtectedRoute>
    ),
  },
  
  // ── Public feedback link (no auth) ──
  {
    path: "/feedback/:token",
    Component: FeedbackFormPage,
  },

  // ── Public candidate review link (no auth) — reuses the same feedback form ──
  {
    path: "/candidate-review/:token",
    Component: FeedbackFormPage,
  },

  // ── Public slot selection link (no auth) ──
  {
    path: "/schedule/:token",
    Component: CandidateSlotPage,
  },
]);