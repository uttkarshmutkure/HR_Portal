export interface Job {
  id: string;
  title: string;
  department: string;
  location: string;
  experienceRange: string;
  datePosted: string;
  status: 'Active' | 'Closed';
  candidatesScreened: number;
  passed: number;
  humanReview: number;
  failed: number;
}

export interface Candidate {
  id: string;
  jobId: string;
  rank: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  status: 'PASSED' | 'HUMAN_REVIEW' | 'FAILED';
  finalScore: number;
  similarityScore: number;
  mustHavePercent: number;
  goodToHavePercent: number;
  relevantExperienceYears: number;
  skillGaps: string[];
  humanReviewReason?: string;
  interviewQuestions: InterviewQuestion[];
  rulesCheck: RuleCheck[];
}

export interface InterviewQuestion {
  id: string;
  type: 'SKILL_GAP' | 'VALIDATION' | 'TECHNICAL' | 'BEHAVIOURAL';
  question: string;
}

export interface RuleCheck {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'flagged';
}

export const mockJobs: Job[] = [
  {
    id: 'job-001',                      // ← matches JD pipeline (job_id = "job-001")
    title: 'Senior Full Stack Developer',
    department: 'Engineering',
    location: 'San Francisco, CA',
    experienceRange: '5-8 years',
    datePosted: '2026-04-20',
    status: 'Active',
    candidatesScreened: 45,
    passed: 8,
    humanReview: 12,
    failed: 25,
  },
  {
    id: 'job-002',                      // ← matches resume pipeline (JOB_ID = "job-002")
    title: 'Product Manager',
    department: 'Product',
    location: 'New York, NY',
    experienceRange: '4-6 years',
    datePosted: '2026-04-18',
    status: 'Active',
    candidatesScreened: 32,
    passed: 5,
    humanReview: 8,
    failed: 19,
  },
  // Jobs 3-5 below have no real backend data yet.
  // Clicking "Run Screening" on them will get a 404 from the Cloud Function
  // until you ingest JDs and resumes for those IDs in BigQuery.
  // Safe to keep for UI preview; just don't run screening on them.
  {
    id: 'job-003',
    title: 'UX/UI Designer',
    department: 'Design',
    location: 'Remote',
    experienceRange: '3-5 years',
    datePosted: '2026-04-15',
    status: 'Closed',
    candidatesScreened: 28,
    passed: 3,
    humanReview: 6,
    failed: 19,
  },
  {
    id: 'job-004',
    title: 'DevOps Engineer',
    department: 'Engineering',
    location: 'Austin, TX',
    experienceRange: '6-10 years',
    datePosted: '2026-04-12',
    status: 'Active',
    candidatesScreened: 19,
    passed: 4,
    humanReview: 5,
    failed: 10,
  },
  {
    id: 'job-005',
    title: 'Data Scientist',
    department: 'Analytics',
    location: 'Boston, MA',
    experienceRange: '5-7 years',
    datePosted: '2026-04-10',
    status: 'Active',
    candidatesScreened: 37,
    passed: 6,
    humanReview: 9,
    failed: 22,
  },
];

export const mockCandidates: Candidate[] = [
  {
    id: '1',
    jobId: 'job-001',
    rank: 1,
    name: 'Sarah Johnson',
    email: 'sarah.johnson@email.com',
    phone: '+1 (555) 123-4567',
    location: 'San Francisco, CA',
    status: 'PASSED',
    finalScore: 0.89,
    similarityScore: 0.92,
    mustHavePercent: 95,
    goodToHavePercent: 85,
    relevantExperienceYears: 7,
    skillGaps: ['AWS Lambda'],
    interviewQuestions: [
      { id: 'q1', type: 'TECHNICAL', question: 'Explain your approach to building scalable microservices architecture.' },
      { id: 'q2', type: 'SKILL_GAP', question: 'Describe your experience with AWS cloud services and serverless patterns.' },
      { id: 'q3', type: 'BEHAVIOURAL', question: 'Tell me about a time you had to refactor a legacy codebase.' },
    ],
    rulesCheck: [
      { id: 'r1', name: 'Experience', status: 'pass' },
      { id: 'r2', name: 'Must Have Skills', status: 'pass' },
      { id: 'r3', name: 'Location', status: 'pass' },
      { id: 'r4', name: 'Last Organization', status: 'pass' },
      { id: 'r5', name: 'Employment Gap', status: 'flagged' },
      { id: 'r6', name: 'Qualification', status: 'pass' },
    ],
  },
  {
    id: '2',
    jobId: 'job-001',
    rank: 2,
    name: 'Michael Chen',
    email: 'michael.chen@email.com',
    phone: '+1 (555) 234-5678',
    location: 'San Jose, CA',
    status: 'PASSED',
    finalScore: 0.85,
    similarityScore: 0.88,
    mustHavePercent: 90,
    goodToHavePercent: 82,
    relevantExperienceYears: 6,
    skillGaps: ['React Hooks', 'TypeScript'],
    interviewQuestions: [
      { id: 'q4', type: 'SKILL_GAP', question: 'How have you implemented state management in React applications?' },
      { id: 'q5', type: 'TECHNICAL', question: 'Describe your experience with database optimization and query performance.' },
      { id: 'q6', type: 'VALIDATION', question: 'Walk through a recent project where you worked on both frontend and backend.' },
    ],
    rulesCheck: [
      { id: 'r1', name: 'Experience', status: 'pass' },
      { id: 'r2', name: 'Must Have Skills', status: 'pass' },
      { id: 'r3', name: 'Location', status: 'pass' },
      { id: 'r4', name: 'Last Organization', status: 'pass' },
      { id: 'r5', name: 'Employment Gap', status: 'pass' },
      { id: 'r6', name: 'Qualification', status: 'pass' },
    ],
  },
  {
    id: '3',
    jobId: 'job-001',
    rank: 3,
    name: 'Emily Rodriguez',
    email: 'emily.rodriguez@email.com',
    phone: '+1 (555) 345-6789',
    location: 'Oakland, CA',
    status: 'HUMAN_REVIEW',
    finalScore: 0.72,
    similarityScore: 0.75,
    mustHavePercent: 80,
    goodToHavePercent: 68,
    relevantExperienceYears: 4,
    skillGaps: ['Node.js', 'System Design', 'Database Design'],
    humanReviewReason: 'Below minimum experience threshold but shows strong potential and rapid growth trajectory',
    interviewQuestions: [
      { id: 'q7', type: 'SKILL_GAP', question: 'What backend technologies have you worked with and in what capacity?' },
      { id: 'q8', type: 'VALIDATION', question: 'Describe your experience building RESTful APIs from scratch.' },
      { id: 'q9', type: 'BEHAVIOURAL', question: 'How do you approach learning new technologies quickly?' },
    ],
    rulesCheck: [
      { id: 'r1', name: 'Experience', status: 'fail' },
      { id: 'r2', name: 'Must Have Skills', status: 'flagged' },
      { id: 'r3', name: 'Location', status: 'pass' },
      { id: 'r4', name: 'Last Organization', status: 'pass' },
      { id: 'r5', name: 'Employment Gap', status: 'pass' },
      { id: 'r6', name: 'Qualification', status: 'pass' },
    ],
  },
  {
    id: '4',
    jobId: 'job-001',
    rank: 4,
    name: 'David Park',
    email: 'david.park@email.com',
    phone: '+1 (555) 456-7890',
    location: 'Palo Alto, CA',
    status: 'HUMAN_REVIEW',
    finalScore: 0.68,
    similarityScore: 0.70,
    mustHavePercent: 75,
    goodToHavePercent: 62,
    relevantExperienceYears: 5,
    skillGaps: ['React', 'Node.js', 'TypeScript', 'GraphQL'],
    humanReviewReason: 'Different primary tech stack (Python/Django) but strong fundamentals and team leadership experience',
    interviewQuestions: [
      { id: 'q10', type: 'VALIDATION', question: 'How would you leverage your Python experience when working with Node.js?' },
      { id: 'q11', type: 'TECHNICAL', question: 'What are the key differences you have noticed between Django and Express.js?' },
      { id: 'q12', type: 'SKILL_GAP', question: 'Describe your experience with TypeScript and static typing in JavaScript.' },
    ],
    rulesCheck: [
      { id: 'r1', name: 'Experience', status: 'pass' },
      { id: 'r2', name: 'Must Have Skills', status: 'fail' },
      { id: 'r3', name: 'Location', status: 'pass' },
      { id: 'r4', name: 'Last Organization', status: 'pass' },
      { id: 'r5', name: 'Employment Gap', status: 'pass' },
      { id: 'r6', name: 'Qualification', status: 'pass' },
    ],
  },
  {
    id: '5',
    jobId: 'job-001',
    rank: 5,
    name: 'James Wilson',
    email: 'james.wilson@email.com',
    phone: '+1 (555) 567-8901',
    location: 'Seattle, WA',
    status: 'FAILED',
    finalScore: 0.45,
    similarityScore: 0.48,
    mustHavePercent: 50,
    goodToHavePercent: 40,
    relevantExperienceYears: 2,
    skillGaps: ['React', 'Node.js', 'TypeScript', 'AWS', 'System Design', 'Database Design'],
    interviewQuestions: [
      { id: 'q13', type: 'VALIDATION', question: 'Describe the most complex project you have worked on independently.' },
      { id: 'q14', type: 'TECHNICAL', question: 'What steps would you take to debug a production issue in a React application?' },
    ],
    rulesCheck: [
      { id: 'r1', name: 'Experience', status: 'fail' },
      { id: 'r2', name: 'Must Have Skills', status: 'fail' },
      { id: 'r3', name: 'Location', status: 'fail' },
      { id: 'r4', name: 'Last Organization', status: 'pass' },
      { id: 'r5', name: 'Employment Gap', status: 'pass' },
      { id: 'r6', name: 'Qualification', status: 'pass' },
    ],
  },
  {
    id: '6',
    jobId: 'job-001',
    rank: 6,
    name: 'Lisa Martinez',
    email: 'lisa.martinez@email.com',
    phone: '+1 (555) 678-9012',
    location: 'Los Angeles, CA',
    status: 'FAILED',
    finalScore: 0.38,
    similarityScore: 0.42,
    mustHavePercent: 45,
    goodToHavePercent: 35,
    relevantExperienceYears: 1,
    skillGaps: ['React', 'Node.js', 'TypeScript', 'AWS', 'System Design', 'Database Design', 'GraphQL', 'Docker'],
    interviewQuestions: [
      { id: 'q15', type: 'BEHAVIOURAL', question: 'Why are you interested in this senior-level position?' },
    ],
    rulesCheck: [
      { id: 'r1', name: 'Experience', status: 'fail' },
      { id: 'r2', name: 'Must Have Skills', status: 'fail' },
      { id: 'r3', name: 'Location', status: 'fail' },
      { id: 'r4', name: 'Last Organization', status: 'fail' },
      { id: 'r5', name: 'Employment Gap', status: 'pass' },
      { id: 'r6', name: 'Qualification', status: 'fail' },
    ],
  },
];

export const getJobById = (id: string): Job | undefined => {
  return mockJobs.find(job => job.id === id);
};

export const getCandidatesByJobId = (jobId: string): Candidate[] => {
  return mockCandidates.filter(candidate => candidate.jobId === jobId);
};

export const getCandidateById = (id: string): Candidate | undefined => {
  return mockCandidates.find(candidate => candidate.id === id);
};