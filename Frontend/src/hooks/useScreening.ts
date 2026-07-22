import { useState } from "react";
import { runPipeline, PipelineResult } from "../services/screening";

export const useScreening = () => {
  const [loading, setLoading] = useState(false);
  const [error,   setError  ] = useState<string | null>(null);

  const startScreening = async (jobId: string): Promise<PipelineResult> => {
    try {
      setLoading(true);
      setError(null);
      const data = await runPipeline(jobId);
      return data;
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to run screening";
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, startScreening };
};