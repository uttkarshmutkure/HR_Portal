# Public Careers Site: setup notes

Anyone can open `/careers` without logging in, browse all open jobs, open a job, and apply
to one or several jobs. Applying works like Keka: **Apply** opens a modal with the job
position, a resume dropzone, then personal details.

## What was added

| File | Purpose |
|---|---|
| `src/services/careers.ts` | Public API calls (jobs list, apply), "applied" memory, mock mode |
| `src/app/pages/CareersPage.tsx` | `/careers` listing: search, location + experience filters, apply from the list |
| `src/app/pages/CareerJobPage.tsx` | `/careers/:jobId` detail, sticky apply card, other open positions |
| `src/app/components/ApplyModal.tsx` | The Keka-style apply form |
| `src/app/components/{CareersLayout,JobRow,JobDescription,careersUtils}.*` | Shared UI |
| `src/app/routes.tsx` | **You edit this by hand**: add 2 imports + 2 public routes (see the chat instructions) |

`/` is still your login page. Link candidates to `/careers`.

## 1. Try it now, no backend needed

```
# .env.local
VITE_CAREERS_MOCK=true
```

Run `npm run dev` and open http://localhost:5173/careers. It shows 5 sample jobs and fakes
the submit. **Never set this in production.**

## 2. Environment variables for real use

```
VITE_PUBLIC_JOBS_URL=https://<region>-<project>.cloudfunctions.net/public-jobs
VITE_APPLY_JOB_URL=https://<region>-<project>.cloudfunctions.net/apply-job
```

If `VITE_PUBLIC_JOBS_URL` is not set it falls back to `VITE_LIST_JOBS_URL` (your existing
`list-jobs`). That works, but see the security notes below.

## 3. Backend you need to build: `apply-job`

The zip contained only the frontend, so this part is yours. It should **not** be the
existing `refer-candidate` function (that one marks the person as *shortlisted*) or
`upload-resume` (it takes only a file, no contact details).

`POST multipart/form-data`

| Field | Notes |
|---|---|
| `job_id` | must exist and be active |
| `first_name`, `middle_name`, `last_name` | middle may be empty |
| `email` | lower-cased by the client |
| `phone` | country code + digits, e.g. `+919876543210` |
| `gender`, `experience_years`, `experience_months` | optional |
| `salary_currency`, `salary_amount`, `salary_freq` | optional (`Annual` / `Monthly`) |
| `cover_note` | optional, max 1000 chars |
| `resume` | PDF/DOC/DOCX, up to 10 MB |
| `source` | always `careers_page` |
| `consent` | always `true`; store it with a timestamp |

Responses the UI understands:

| Case | HTTP | Body |
|---|---|---|
| Success | 200 | `{ "success": true, "application_id": "..." }` |
| Same email already applied to this job | 409 | `{ "success": false, "code": "ALREADY_APPLIED" }` |
| Job closed | 410 | `{ "success": false, "code": "JOB_CLOSED" }` |
| Bad input / file too large | 400 / 413 / 422 | `{ "error": "message shown to the candidate" }` |
| Anything else | 5xx | `{ "error": "..." }` |

Store the resume where `upload-resume` stores resumes for that `job_id`, so your existing
screening pipeline picks these candidates up with no other change.

## 4. Security: this is a public, unauthenticated write endpoint

- **Validate on the server.** The file type and size checks in the browser are only for
  UX. Check size and real file type (magic bytes), and sanitise the filename.
- **Bot protection.** The form has a hidden honeypot field, which only stops basic bots.
  Add reCAPTCHA v3 or Firebase App Check (you already use Firebase) plus per-IP rate limiting.
- **De-duplicate** on `(job_id, lower(email))`.
- **CORS**: allow only your careers domain.
- **Public jobs endpoint**: your current `list-jobs` returns `recruiter_email` and
  `knockout_rules`. The careers UI discards them, but anyone can still see them in the
  browser's network tab. Create a `public-jobs` function that returns only active jobs and
  only: `job_id, title, location, description, must_have_skills, preferred_skills,
  experience_min, experience_max, created_at`.
- **Privacy**: a consent checkbox is included. Add a link to your privacy policy in the
  consent text in `ApplyModal.tsx`, and decide how long you keep applicant data.

## 5. Behaviour worth knowing

- Candidates can change the **Job position** dropdown inside the modal, and after applying
  can click **Apply to another job**. Their details and resume are kept **in memory only**
  (gone on refresh) so they don't retype them.
- Jobs already applied to show "Applied" for that browser session (only job IDs are kept,
  in `sessionStorage`; no personal data).
- Filters sync to the URL, e.g. `/careers?q=python&location=Pune&exp=3-5`.
- The site is a client-rendered SPA, so Google Jobs will index it less well than a
  server-rendered page. If SEO matters, add pre-rendering later.
- Resume auto-fill (Keka reads the resume and pre-fills fields) is not included. It needs
  a parsing endpoint; the form is ready to receive that.

## 6. Pre-existing issue found (not changed)

`routes.tsx` imports `./pages/CandidateTimelinePage` and `./pages/CandidateSlotPage`, but
the files are named `Candidatetimelinepage.tsx` and `Candidateslotpage.tsx`. This builds on
Windows/macOS but **fails on Linux** (CI, Docker, most build servers). Rename the files to
match the imports.
