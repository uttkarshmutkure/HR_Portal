import { Link } from 'react-router';
import { MapPin, Briefcase, Clock, Check } from 'lucide-react';
import type { PublicJob } from '../../services/careers';
import { HEADING, fmtExperience, postedAgo } from './careersUtils';

interface Props {
  job: PublicJob;
  applied: boolean;
  onApply: (job: PublicJob) => void;
  showSkills?: boolean;
}

export default function JobRow({ job, applied, onApply, showSkills = true }: Props) {
  const posted = postedAgo(job.created_at);
  const skills = job.must_have_skills.slice(0, 4);
  const extra = job.must_have_skills.length - skills.length;

  return (
    <li className="group relative rounded-xl border border-[#E3E6EB] bg-white transition-[border-color,box-shadow] duration-200 hover:border-[#F26522]/60 hover:shadow-[0_10px_28px_-14px_rgba(5,12,38,0.28)] focus-within:border-[#F26522]/60">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <h3 className="m-0">
            {/* Stretched link: the whole row opens the job, buttons sit above it */}
            <Link
              to={`/careers/${encodeURIComponent(job.job_id)}`}
              className={`${HEADING} text-[17px] font-semibold !leading-snug text-[#050C26] outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-[#F26522]`}
            >
              {job.title}
            </Link>
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[#5B6272]">
            {job.location && (
              <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-[#F26522]" aria-hidden />{job.location}</span>
            )}
            <span className="inline-flex items-center gap-1.5"><Briefcase size={14} className="text-[#F26522]" aria-hidden />{fmtExperience(job.experience_min, job.experience_max)}</span>
            {posted && (
              <span className="inline-flex items-center gap-1.5"><Clock size={14} className="text-[#F26522]" aria-hidden />{posted}</span>
            )}
          </div>

          {showSkills && skills.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Key skills">
              {skills.map(s => (
                <li key={s} className="rounded-md bg-[#EEF0F6] px-2 py-0.5 text-[12px] font-medium text-[#2B3250]">{s}</li>
              ))}
              {extra > 0 && <li className="px-1 py-0.5 text-[12px] text-[#5B6272]">+{extra} more</li>}
            </ul>
          )}
        </div>

        <div className="relative z-10 flex shrink-0 items-center gap-2">
          {applied ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#ECFDF5] px-3.5 py-2 text-[13px] font-semibold text-[#047857]">
              <Check size={15} aria-hidden /> Applied
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onApply(job)}
              className="rounded-lg bg-[#D14D0E] px-5 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-[#B53F08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]"
            >
              Apply
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
