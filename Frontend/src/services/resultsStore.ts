/**
 * ResultsStore
 * ─────────────
 * Persists pipeline results in localStorage keyed by job_id.
 * Solves the problem where navigating back and clicking "View Results"
 * loses the result because location.state is cleared on back navigation.
 *
 * Each entry is wrapped with a savedAt timestamp so the UI can show
 * "last updated X minutes ago" and detect stale automated-pipeline results.
 *
 * Usage:
 *   ResultsStore.save(jobId, result)    // called after pipeline run or API fetch
 *   ResultsStore.load(jobId)            // returns PipelineResult | null
 *   ResultsStore.savedAt(jobId)         // returns Date | null
 *   ResultsStore.clear(jobId)           // optional cleanup
 */

import { PipelineResult } from './screening';

const PREFIX  = 'hr_pipeline_result_';

interface StoredEntry {
  result:  PipelineResult;
  savedAt: string; // ISO-8601
}

export const ResultsStore = {

  save(jobId: string, result: PipelineResult): void {
    try {
      const entry: StoredEntry = {
        result,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(`${PREFIX}${jobId}`, JSON.stringify(entry));
    } catch (e) {
      console.warn('ResultsStore.save failed:', e);
    }
  },

  load(jobId: string): PipelineResult | null {
    try {
      const raw = localStorage.getItem(`${PREFIX}${jobId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Support both the new { result, savedAt } shape and the legacy bare shape
      return ('result' in parsed ? parsed.result : parsed) as PipelineResult;
    } catch (e) {
      console.warn('ResultsStore.load failed:', e);
      return null;
    }
  },

  savedAt(jobId: string): Date | null {
    try {
      const raw = localStorage.getItem(`${PREFIX}${jobId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return 'savedAt' in parsed ? new Date(parsed.savedAt) : null;
    } catch (e) {
      return null;
    }
  },

  clear(jobId: string): void {
    try {
      localStorage.removeItem(`${PREFIX}${jobId}`);
    } catch (e) {
      console.warn('ResultsStore.clear failed:', e);
    }
  },

};