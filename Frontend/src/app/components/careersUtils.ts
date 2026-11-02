import { formatDistanceToNow } from 'date-fns';
import type { PublicJob } from '../../services/careers';

// Brand tokens (from brand-colors-guide.md). Kept as constants so Tailwind
// arbitrary values stay consistent across the careers pages.
export const HEADING = "font-['Poppins',sans-serif]";

export const fmtExperience = (min: number, max: number): string => {
  if (!max || max >= 40) return min > 0 ? `${min}+ years` : 'Any experience';
  if (min === max) return `${min} ${min === 1 ? 'year' : 'years'}`;
  return `${min}–${max} years`;
};

export const postedAgo = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `Posted ${formatDistanceToNow(d, { addSuffix: true })}`;
};

export const byNewest = (a: PublicJob, b: PublicJob): number =>
  new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();

export const EXPERIENCE_FILTERS = [
  { value: 'any',   label: 'Any experience', min: 0,  max: Infinity },
  { value: '0-2',   label: '0–2 years',      min: 0,  max: 2 },
  { value: '3-5',   label: '3–5 years',      min: 3,  max: 5 },
  { value: '6-10',  label: '6–10 years',     min: 6,  max: 10 },
  { value: '10+',   label: '10+ years',      min: 10, max: Infinity },
] as const;

// A job matches a bucket if its experience range overlaps the bucket.
export const matchesExperience = (job: PublicJob, bucket: string): boolean => {
  const b = EXPERIENCE_FILTERS.find(f => f.value === bucket);
  if (!b || b.value === 'any') return true;
  const jobMax = !job.experience_max || job.experience_max >= 40 ? Infinity : job.experience_max;
  return job.experience_min <= b.max && jobMax >= b.min;
};
