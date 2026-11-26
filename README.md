# Contour LMS Lite

A mini-LMS for booking and managing student consultations, with an admin view of every consultation in the system.

> **Status:** work in progress. Database, API and UI are in place; README sections still being finalised.

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router) + TypeScript
- [Supabase](https://supabase.com): Postgres, Auth, `@supabase/supabase-js`, `@supabase/ssr`
- [shadcn/ui](https://ui.shadcn.com) + Tailwind CSS
- Bootstrapped from the official [`with-supabase`](https://github.com/vercel/next.js/tree/canary/examples/with-supabase) Next.js example

## Prerequisites

- Node.js 20+ (developed on Node 22)
- Docker (for the local Supabase stack)

The Supabase CLI is a pinned dev dependency, so `npm install` provides it and nothing needs to be installed globally.

## Setup

```bash
npm install
npm run db:start            # starts local Supabase in Docker, applies migrations
cp .env.example .env.local  # then paste the publishable key printed by db:start
                            # (also available via `npx supabase status`)
npm run dev                 # http://localhost:3000
```

| Service          | URL                       |
| ---------------- | ------------------------- |
| App              | http://localhost:3000     |
| Supabase Studio  | http://127.0.0.1:54323    |
| Mailpit (emails) | http://127.0.0.1:54324    |

Email confirmation is turned off for the local stack, so new sign-ups can log in straight away.

### Demo accounts (local seed)

| Email                 | Password      | Role    |
| --------------------- | ------------- | ------- |
| `admin@example.com`   | `password123` | admin   |
| `student@example.com` | `password123` | student |
| `riley@example.com`   | `password123` | student (fills Marcus's calendar) |
| `marcus.lindqvist@tutors.example.com` | `password123` | tutor (one of 15) |

New sign-ups are always students. To promote a user to admin (this is also the production procedure):

```sql
update public.profiles set role = 'admin' where id = '<auth user id>';
```

### Scripts

| Script              | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | Next.js dev server                                     |
| `npm run lint`      | ESLint                                                 |
| `npm run typecheck` | TypeScript, no emit                                    |
| `npm run db:start`  | Start local Supabase                                   |
| `npm run db:stop`   | Stop local Supabase                                    |
| `npm run db:reset`  | Recreate the local DB from migrations + seed           |
| `npm run db:types`  | Generate TypeScript types from the local schema        |
| `npm run db:test`   | Run the pgTAP RLS / privilege tests                    |
| `npm run test:pages`| Page/role-gating smoke test (needs `npm run dev`; `BASE=` to override the URL) |
| `npm run test:api`  | End-to-end API smoke test (needs `npm run dev`; `BASE=` to override the URL) |

## Implementation summary

### Pages

| Path | Who | What |
| ---- | --- | ---- |
| `/` | anyone | Landing page, with sign in / sign up, or a link to your dashboard |
| `/auth/*` | anyone | Login, sign-up, forgot / update password (from the starter template) |
| `/dashboard` | signed in | Sends you to your role's area |
| `/student` | student | My consultations: tabs, complete toggle, reschedule dialog, cancel |
| `/student/book` | student | Book: subject → tutor (booked-out badges + recommendations) → slot → details |
| `/tutor` | tutor | My sessions (read-only) |
| `/admin` | admin | All consultations, with subject, tutor, status and sort filters (read-only) |

Each role area's layout checks the role on the server and redirects anyone else (D38). The first page of each list is server-rendered, and "Load more" and every change go through the API (D41).

### API

Every endpoint needs a session (a JSON 401 otherwise) and returns JSON. Errors look like `{ error: { code, message, details? } }`.

| Method | Path | Who | Purpose |
| ------ | ---- | --- | ------- |
| GET    | `/api/me` | any | Current user and role |
| GET    | `/api/subjects` | any | Subjects with their tutors |
| GET    | `/api/subjects/:id/availability?from&to&tutorId&at` | any | Free slots per tutor, booked-out flags, recommended alternative tutors |
| GET    | `/api/consultations?cursor&limit&status&order` | student, tutor | My bookings (student) or my sessions (tutor) |
| POST   | `/api/consultations` | student | Book `{ firstName, lastName, reason, scheduledAt, subjectId, tutorId }` |
| GET    | `/api/consultations/:id` | owner, its tutor, admin | One consultation |
| POST   | `/api/consultations/:id/reschedule` | owner | `{ scheduledAt, tutorId? }` |
| PUT    | `/api/consultations/:id/completion` | owner | Mark complete (only once it has ended) |
| DELETE | `/api/consultations/:id/completion` | owner | Mark incomplete |
| POST   | `/api/consultations/:id/cancel` | owner | Soft cancel |
| GET    | `/api/admin/consultations?…&studentId&tutorId&subjectId` | admin | Every consultation |

**Layers:**
- **`app/api/**/route.ts`:** thin HTTP handlers.
- **`lib/api/route.ts`:** the `authedRoute()` wrapper (auth, CSRF, zod parsing, error mapping).
- **`lib/server/*.ts`:** the service layer (queries and business rules). Server components call it directly too.
- **`lib/validation.ts`:** zod schemas shared with the client-side forms.
- **`lib/dto.ts`:** response types.

Lists use cursor (keyset) pagination, and `nextCursor` is `null` on the last page.

## Database schema & migrations

Migrations live in `supabase/migrations/`. The local seed is `supabase/seed.sql`.

```
auth.users ─1:1─ profiles (role: student | tutor | admin)
                    │
     tutor ─────────┼──< tutor_subjects >── subjects
       │            │
       └──< tutor_availability (weekly windows, Melbourne time)
                    │
   student / tutor ─┴──< consultations (subject_id + tutor_id → tutor_subjects)

consultations
  id, student_id (default auth.uid()), subject_id, tutor_id
  first_name, last_name, reason               (the booking form)
  scheduled_at, ends_at (= +60 min, trigger)  (slots on the hour)
  completed_at  null = incomplete             (only after ends_at)
  cancelled_at  soft cancel, row then immutable
  created_at / updated_at
```

**How access and booking rules are enforced** (see `docs/DECISIONS.md` for the reasoning):
- RLS is enabled on every table. A single role helper, `private.current_user_role()`, is `SECURITY DEFINER` and isn't exposed by the API.
- **Students** read, book and update only their own consultations.
- **Tutors** read only the consultations booked with them.
- **Admins** read everything.
- Tutors and admins can't change any consultation.
- Column-level grants restrict what can be written. There's no `DELETE` grant.
- Exclusion constraints make double-booking a tutor, or a student, impossible, even with concurrent requests.
- A trigger enforces the booking rules: the slot is in the future, on the hour, and within the tutor's availability.
- `public.get_free_slots()` returns only `(tutor_id, slot_start)` pairs, which drives the "booked out" display and the alternative-tutor recommendations without revealing other students' bookings.
- `supabase/tests/rls_test.sql` has 38 pgTAP tests covering all of the above.

### Demo scenario

- The seed has 15 tutors with fictional names across Biology, UCAT, Math Methods, Specialist Math, Physics and Chemistry. Each has a random weekly schedule from a fixed seed, so it's the same after every reset.
- **Marcus Lindqvist** (Specialist Math) is fully booked for the next 14 days, so a student who picks him is recommended **Chloe Nguyen**.
- Tutor logins follow the pattern `first.last@tutors.example.com`, with password `password123`.

## Justifications & assumptions

The full decision log, with the alternatives considered, is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

- **Dependencies are pinned** (`next`, `@supabase/*`) instead of the template's `latest`, so builds are reproducible.
- **Supabase CLI is a dev dependency**, so every contributor uses the same CLI version.
- **Template fixes:** the ESLint config was moved to the native flat config that `eslint-config-next` 16 ships, with generated files ignored. The theme switcher now uses `useSyncExternalStore` instead of `setState` inside an effect.

## AI usage

This project was built with AI assistance from Anthropic's Claude Code, which the assessment permits. I reviewed every change and can explain it. Commits don't carry per-commit AI co-author trailers; this section discloses the AI use instead.
