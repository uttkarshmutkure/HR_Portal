import api from "./api";

// ── Base URLs ─────────────────────────────────────────────────────────────────
// VITE_API_BASE_URL       → candidate screening pipeline (run_pipeline)
// VITE_LIST_JOBS_URL      → list jobs Cloud Function (list_jobs)
//
// Add to your .env:
//   VITE_LIST_JOBS_URL=https://<region>-<project>.cloudfunctions.net/list-jobs

import axios from "axios";

const listJobsApi = axios.create({
  baseURL: import.meta.env.VITE_LIST_JOBS_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
});

// ── Types matching your pipeline's return shape ───────────────────────────────

export interface InterviewQuestion {
  type: "skill_gap" | "validation" | "technical" | "behavioural";
  question: string;
}

export interface TopCandidate {
  candidate_id:         string;
  name:                 string;
  email:                string;
  phone:                string;
  similarity_score:     number;
  overall_result:       "PASS" | "HUMAN_REVIEW" | "FAIL";
  must_have_pct:        number;
  good_to_have_pct:     number;
  final_score:          number;
  relevant_exp:         number;
  must_have_missing:    string[];
  good_to_have_missing: string[];
  failed_rules:         string[];
  flagged_rules:        string[];
  human_review_reason:  string;
  overall_reason:       string;
  questions:            InterviewQuestion[];
}

export interface PipelineResult {
  success:          boolean;
  job_id:           string;
  jd_title:         string;
  total_candidates: number;
  passed:           number;
  human_review:     number;
  failed:           number;
  top_candidates:   TopCandidate[];   // top N only
  all_passed:       TopCandidate[];   // all passed, ranked
  all_failed:       TopCandidate[];   // all failed
  all_human_review: TopCandidate[];   // all human review
  runtime_seconds:  number;
}

// ── Job list types — matches BigQuery jobs table ──────────────────────────────

export interface JobSummary {
  job_id:           string;
  title:            string;
  location:         string;
  description:      string;
  must_have_skills: string[];   // parsed from comma-separated string by Cloud Function
  preferred_skills: string[];   // parsed from comma-separated string by Cloud Function
  experience_min:   number;
  experience_max:   number;
  status:           string;     // "active" | "closed" — lowercase from BigQuery
  recruiter_email:  string;
  knockout_rules:   { rule: string }[];
  created_at:       string;     // ISO datetime string
}

export interface ListJobsResult {
  success: boolean;
  total:   number;
  jobs:    JobSummary[];
}

// ── Health check ──────────────────────────────────────────────────────────────

export const healthCheck = async (): Promise<boolean> => {
  const res = await api.get("/?action=health");
  return res.data?.status === "ok";
};

// ── List all jobs from BigQuery ───────────────────────────────────────────────

export const listJobs = async (status?: string): Promise<JobSummary[]> => {
  const params = status ? { status } : {};
  const res    = await listJobsApi.get("", { params });

  if (!res.data.success) {
    throw new Error(res.data.error || "Failed to fetch jobs");
  }

  return res.data.jobs as JobSummary[];
};

// ── Run the full pipeline for a job ──────────────────────────────────────────

export const runPipeline = async (
  jobId: string,
  topK: number = 30,
  topN: number = 5
): Promise<PipelineResult> => {
  const res = await api.post("", {
    action: "run_pipeline",
    job_id: jobId,
    top_k:  topK,
    top_n:  topN,
  });

  if (!res.data.success) {
    throw new Error(res.data.error || "Pipeline failed");
  }

  return res.data as PipelineResult;
};

// ── Resume URL helper ─────────────────────────────────────────────────────────

export const getResumeUrl = (candidateId: string): string => {
  const base = import.meta.env.VITE_RESUME_URL as string;
  return `${base}?candidate_id=${encodeURIComponent(candidateId)}`;
};