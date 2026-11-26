# Contour LMS Lite

A mini-LMS where students book 60-minute consultations with subject tutors, then mark them complete, reschedule or cancel them. Tutors see the sessions booked with them, and admins see every consultation in the system.

**Features**
- **Accounts:** sign up, log in, log out and reset a password (Supabase Auth, cookie sessions via `@supabase/ssr`).
- **Three roles:** student, tutor and admin. Roles are stored in the database, enforced by Postgres row-level security, and checked again in the API and the page layouts.
- **Student dashboard:** consultations under status tabs. Students can mark a consultation complete or incomplete (only once it has ended), reschedule it (optionally with another tutor for the same subject), or cancel it.
- **Booking form:** first name, last name, reason and datetime. The datetime is picked from the chosen tutor's free slots.
- **Availability:** tutors with no free slots are flagged **Booked out**, and other tutors for the same subject are recommended.
- **Double-booking prevention:** the database stops a tutor or a student being booked twice for the same time, even when requests arrive at the same moment.
- **Admin view:** every consultation, read-only, with filters and cursor pagination.

---

## Contents

1. [Tech stack](#tech-stack)
2. [Setup](#setup)
3. [Implementation summary](#implementation-summary)
4. [Database schema & migrations](#database-schema--migrations)
5. [Justifications & assumptions](#justifications--assumptions)
6. [Testing](#testing)
7. [Known limitations & future work](#known-limitations--future-work)
8. [AI usage](#ai-usage)

The full decision log (44 decisions with reasoning and rejected alternatives) is in [`docs/DECISIONS.md`](docs/DECISIONS.md). Each `Dnn` reference below points there.

---

## Tech stack

| Area | Choice |
| ---- | ------ |
| Framework | Next.js 16 (App Router, Cache Components), React 19, TypeScript |
| Database & auth | Supabase: Postgres 17, Supabase Auth, `@supabase/supabase-js`, `@supabase/ssr` |
| Validation | zod 4, with the same schemas on the server and the client |
| Forms | react-hook-form + `@hookform/resolvers` |
| UI | shadcn/ui (Radix) + Tailwind CSS 3, sonner toasts |
| DB tests | pgTAP (via `supabase test db`) |
| Starter | The official [`with-supabase`](https://github.com/vercel/next.js/tree/canary/examples/with-supabase) example |

---

## Setup

### Prerequisites

- Node.js 20+ (developed on Node 22)
- Docker, running, for the local Supabase stack

The Supabase CLI is a pinned dev dependency, so `npm install` provides it and nothing needs to be installed globally (D3).

### Run locally

```bash
npm install
npm run db:start            # start local Supabase in Docker; applies migrations + seed
cp .env.example .env.local  # then paste the PUBLISHABLE_KEY printed by db:start
                            # (or shown by `npx supabase status`)
npm run dev                 # http://localhost:3000
```

| Service          | URL                    |
| ---------------- | ---------------------- |
| App              | http://localhost:3000  |
| Supabase Studio  | http://127.0.0.1:54323 |
| Mailpit (emails) | http://127.0.0.1:54324 |

**Notes**
- `npm run db:reset` rebuilds the database from the migrations and seed at any time.
- Email confirmation is off for the local stack, so new sign-ups land on their dashboard straight away. Password-reset emails can be read in Mailpit.
- If port 3000 is taken, run `npm run dev -- -p 3001`.

### Demo accounts (local seed only)

Every account's password is `password123`.

| Email | Role | Notes |
| ----- | ---- | ----- |
| `student@example.com` | student | Sam: upcoming, completed and cancelled consultations |
| `riley@example.com` | student | Has filled Marcus Lindqvist's calendar |
| `admin@example.com` | admin | |
| `marcus.lindqvist@tutors.example.com` | tutor | Specialist Math, **booked out** for the next 14 days |
| `first.last@tutors.example.com` | tutor | 15 tutors in total (fictional names), 2–3 per subject |

**Two-minute demo**
1. Log in as `student@example.com`, then go to **Book a consultation** and choose **Specialist Math**.
2. Click **Marcus Lindqvist**. He's marked *Booked out*, and **Chloe Nguyen** is recommended with her next free time. Switch to her, pick a slot, fill in your details, and book.
3. Back on **My consultations**, reschedule it, cancel it, or open the **Completed** tab and toggle *Done*.
4. Log in as Marcus to see his read-only sessions, or as the admin to see and filter everything.

New sign-ups are always students. Admins and tutors are created out of band (D13). In production, run:

```sql
update public.profiles set role = 'admin' where id = '<auth user id>';
-- tutor: set role = 'tutor', then add rows to tutor_subjects and tutor_availability
```

### Deploying to a hosted Supabase project (not exercised in this repo)

```bash
npx supabase link --project-ref <ref>
npx supabase db push              # applies supabase/migrations only; never run seed.sql in production
```

Then:
- Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the hosting environment.
- In Supabase Auth settings, set the Site URL and redirect URLs to your domain.
- Turn email confirmation on. The sign-up flow already handles both cases.

### Scripts

| Script | Purpose |
| ------ | ------- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm run db:start` / `db:stop` | Start or stop local Supabase |
| `npm run db:reset` | Recreate the local DB from migrations + seed |
| `npm run db:types` | Regenerate `lib/supabase/database.types.ts` from the schema |
| `npm run db:test` | pgTAP tests for RLS, privileges and booking rules |
| `npm run test:api` | End-to-end API smoke test (needs a running app; `BASE=` to override the URL) |
| `npm run test:pages` | Page role-gating and server-rendering smoke test (needs a running app) |

---

## Implementation summary

### Architecture

```
Browser ──fetch /api/* (JSON, same-origin)──►  Route Handlers  app/api/**/route.ts
   ▲                                            │  authedRoute(): session → CSRF → zod → errors
   │ HTML (streamed)                            ▼
Server Components (pages) ─────────────►  Service layer  lib/server/*.ts   (all queries + rules)
   app/{student,tutor,admin}/**                 │  Supabase client acting AS THE USER
                                                ▼  (publishable key + session cookie)
                                          Postgres: RLS · column GRANTs · constraints · triggers
```

- **One service layer (D29).** Route handlers and server components both call `lib/server/*`. Pages render their first view without making an HTTP request to the app's own server. Every change, and "Load more", goes through the API from client components, as the brief prefers API routes over Server Actions. The template's own auth forms are the only exception: they call Supabase Auth directly.
- **No service-role key anywhere (D7).** Every query runs as the signed-in user, so the database enforces authorization even if a bug slips into application code.
- **Typed end to end.** `database.types.ts` is generated from the schema. Zod schemas in `lib/validation.ts` are shared by the API and the forms, and `lib/dto.ts` defines the API response shapes.

### How roles are defined (RBAC)

| Layer | Mechanism |
| ----- | --------- |
| Storage | `profiles.role` (`app_role` enum: `student`, `tutor`, `admin`). A trigger on `auth.users` creates every profile as a student, so the role is never taken from user input (D6). |
| Database | RLS on every table, checked through `private.current_user_role()`. This is a `SECURITY DEFINER` function in a schema the API doesn't expose, and it's evaluated once per query. Column-level `GRANT`s limit what can be written, and there's no `DELETE` grant (D12). |
| API | `requireRole()` in the service layer gives a clear 403. The admin list is a separate endpoint, `/api/admin/consultations` (D31). |
| UI | `/student`, `/tutor` and `/admin` each have a layout that checks the role on the server and redirects anyone else. `/dashboard` sends each user to their area (D38). |

**Why RLS rather than application-only checks (D7):** authorization sits next to the data, so a forgotten check in a route can't leak rows. The same rules apply to any future client or service, and the pgTAP suite tests them directly. The API layer adds the parts RLS can't do well: input validation, friendly errors, and checking state before a write.

**Why `profiles.role` rather than JWT claims (D6):** a role change applies on the next request, rather than when the token next refreshes, and there are fewer moving parts. The lookup is cached once per query. If roles grow into fine-grained permissions, the next step is a `user_roles` / `role_permissions` table, with an access-token hook that copies them into the JWT.

### Pages

| Path | Role | What |
| ---- | ---- | ---- |
| `/` | anyone | Landing page: sign in / sign up, or a link to your dashboard |
| `/auth/*` | anyone | Login, sign-up, forgot and update password (from the template) |
| `/dashboard` | signed in | Sends you to your role's area |
| `/student` | student | Status tabs; *Done* checkbox, **Reschedule** dialog and **Cancel** confirmation per row |
| `/student/book` | student | Subject → tutor (booked-out badges + recommendations) → slot grid → your details |
| `/tutor` | tutor | Sessions booked with you (read-only) |
| `/admin` | admin | Every consultation; subject, tutor, status and sort filters (read-only) |

- The first page of each list is rendered on the server. Filters live in the URL, and "Load more" uses the API's cursor (D41).
- Times are always shown in Melbourne time, labelled AEST/AEDT (D42).

### API

Every endpoint needs a session and otherwise returns a JSON 401. Responses are JSON with `Cache-Control: private, no-store`. Errors look like `{ error: { code, message, details? } }`, and clients branch on `code`.

| Method | Path | Who | Purpose |
| ------ | ---- | --- | ------- |
| GET | `/api/me` | any | Current user and role |
| GET | `/api/subjects` | any | Subjects with their tutors |
| GET | `/api/subjects/:id/availability?from&to&tutorId&at` | any | Free slots per tutor (default 14 days, max 31), `bookedOut` flags, `recommendations` |
| GET | `/api/consultations?cursor&limit&status&order` | student, tutor | A student's bookings, or a tutor's sessions |
| POST | `/api/consultations` | student | Book: `{ firstName, lastName, reason, scheduledAt, subjectId, tutorId }`. Returns 201 with a `Location` header |
| GET | `/api/consultations/:id` | the student, the tutor, admin | One consultation |
| POST | `/api/consultations/:id/reschedule` | the student | `{ scheduledAt, tutorId? }` |
| PUT | `/api/consultations/:id/completion` | the student | Mark complete (only once it has ended) |
| DELETE | `/api/consultations/:id/completion` | the student | Mark incomplete |
| POST | `/api/consultations/:id/cancel` | the student | Soft cancel |
| GET | `/api/admin/consultations?…&studentId&tutorId&subjectId` | admin | Every consultation |

**Design (D28–D33)**
- **Action endpoints:** each change has its own endpoint with a narrow, strict body, so actions can't be smuggled into one generic `PATCH`. Completion is a sub-resource, so `PUT` and `DELETE` are both idempotent.
- **Pagination:** keyset on `(scheduled_at, id)`. Each page costs the same however deep it is, and pages stay stable as rows are added. The cursor is opaque and validated, so it can't inject PostgREST filter syntax.
- **Error mapping:**

  | Database error | HTTP response |
  | --- | --- |
  | `23P01` (overlap) | 409 `slot_taken` |
  | Booking-rule trigger errors | 422 (`slot_in_past`, `slot_not_on_the_hour`, `tutor_unavailable`) |
  | RLS or privilege denial | 403 |
  | Missing row, or hidden by RLS | 404 |

  Raw SQL errors never reach the client.
- **403 versus 404:** a user who can see a consultation but can't change it gets a 403. A user who can't see it gets a 404, so the API never reveals whether a consultation exists.

**Code layout**

| Path | Role |
| ---- | ---- |
| `app/api/**/route.ts` | Thin handlers: parse → service → JSON |
| `lib/api/route.ts` | `authedRoute()`: session, CSRF, zod parsing, error responses |
| `lib/api/errors.ts` | Error codes and database-error mapping |
| `lib/server/*.ts` | Service layer (`server-only`): consultations, subjects, auth, list params |
| `lib/validation.ts` | Zod schemas shared by the API and the forms |
| `lib/dto.ts` / `lib/api-client.ts` | Response types / browser fetch wrapper with friendly error messages |
| `components/*` | App shell and role gate, consultation list and actions, availability picker, booking form |

### Booking and availability

- **Tutor schedules:** each tutor has weekly availability windows, all within 08:00–20:00 Melbourne time, any day (D20, D22).
- **Slots:** consultations last 60 minutes and start on the hour. `ends_at` is always calculated by a trigger (D22).
- **Free slots:** `public.get_free_slots(subject, from, to)` expands the windows into slots and removes booked ones. It returns only `(tutor_id, slot_start)` pairs, so students learn which slots are taken without seeing anyone else's bookings (D25).
- **Booked out and recommendations:** a tutor is booked out when they have no free slot in the window. The API then recommends other tutors for the same subject, preferring those free at the requested time, then whoever is free soonest.
- **Concurrency:** two students can't both win the same slot. The exclusion constraint decides atomically, and the loser gets a 409. The UI then shows "slot just taken" and reloads availability.

### Security measures

| Concern | Measure |
| ------- | ------- |
| Authorization | RLS on every table, column-level grants, no `DELETE` grant, no service-role key; role checks in the API and the layouts too |
| Privilege escalation | Profiles are created by a trigger with the default role, and users can't update profiles at all |
| Spoofing | `student_id` defaults to `auth.uid()`, is checked by RLS, and isn't in the insert grant |
| Booking integrity | Exclusion constraints, a composite FK (the tutor must teach the subject), and a booking-rule trigger, all in the database |
| Data exposure | Availability goes through a `SECURITY DEFINER` function that returns no personal data; 404 rather than 403 for consultations the user can't see |
| CSRF | `SameSite=Lax` cookies; writes are rejected if the browser marks them cross-site or the `Origin` doesn't match; request bodies must be JSON |
| Input | zod strict schemas on every body, query string and param; length checks in the DB; keyset cursor validated |
| Redirects | Fixed an open redirect in the template's `auth/confirm` route: only same-site relative `next` paths are allowed (D43) |
| Caching | Per-user API responses are `private, no-store` |
| Functions | Every `SECURITY DEFINER` function sets `search_path = ''` and lives in the `private` schema, which the API doesn't expose. The one exception is `public.get_free_slots`, which only `authenticated` users can execute |

---

## Database schema & migrations

Migrations live in `supabase/migrations/` and are applied in order. Applied migrations are never edited; each change is a new file (D27).

| Migration | Purpose |
| --------- | ------- |
| `20261126093317_init_schema.sql` | `app_role`, `profiles` (+ sign-up trigger), `consultations`, RLS, column grants, `updated_at` trigger |
| `20261126100000_add_tutor_role.sql` | Adds `'tutor'` to `app_role`. It's in its own file because Postgres can't use a new enum value in the same transaction that adds it |
| `20261126100100_tutors_subjects_availability.sql` | `subjects`, `tutor_subjects`, `tutor_availability`; consultation subject, tutor and end time; exclusion constraints; booking trigger; three-role policies; `get_free_slots()` |
| `20261126110000_consultations_direct_fks.sql` | Direct FKs so PostgREST can embed tutor and subject in responses (D34) |

```
auth.users ─1:1─ profiles (role: student | tutor | admin, full_name)
                    │
   tutor ───────────┼──< tutor_subjects >── subjects (slug, name)
     │              │
     └──< tutor_availability (iso_weekday, start_time, end_time, Melbourne local)
                    │
 student / tutor ───┴──< consultations  ── (tutor_id, subject_id) → tutor_subjects
```

**`consultations`**

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | `gen_random_uuid()` |
| `student_id` | uuid → profiles | Default `auth.uid()`; cascades when the student is deleted |
| `subject_id`, `tutor_id` | uuid | Composite FK to `tutor_subjects`, plus direct FKs (`RESTRICT`) |
| `first_name`, `last_name` | text | 1–100 characters (the booking form) |
| `reason` | text | 1–1000 characters (the booking form) |
| `scheduled_at` | timestamptz | On the hour, in the future, within availability (trigger) |
| `ends_at` | timestamptz | `scheduled_at + 60 min`, set by trigger, not client-writable |
| `completed_at` | timestamptz null | `null` = incomplete; can only be set once `ends_at` has passed (RLS) |
| `cancelled_at` | timestamptz null | Soft cancel; the row then can't be changed (RLS) |
| `created_at`, `updated_at` | timestamptz | `updated_at` is maintained by a trigger |

**Constraints**
- `CHECK`: a consultation can't be both completed and cancelled.
- `EXCLUDE USING gist`: no overlapping active bookings per tutor, and none per student.

**Indexes:** `(student_id, scheduled_at)`, `(tutor_id, scheduled_at)`, `(scheduled_at)` and `(subject_id)`, matching the dashboard, tutor, admin and filter queries. The GiST indexes behind the exclusion constraints also serve the overlap checks.

**Other objects**

| Object | Kind | Purpose |
| ------ | ---- | ------- |
| `private.current_user_role()` | `SECURITY DEFINER`, `STABLE` | The caller's role, for policies |
| `private.handle_new_user()` | trigger | Creates a profile for each new auth user |
| `private.validate_consultation_booking()` | trigger | Future, on the hour, within availability. Raises stable error codes the API maps |
| `private.set_consultation_ends_at()`, `private.set_updated_at()` | triggers | Derived columns |
| `private.assert_profile_is_tutor()` | trigger | Only tutors can be linked to subjects or have availability |
| `private.business_timezone()`, `private.slot_duration()` | immutable | Single source for `Australia/Melbourne` and 60 minutes |
| `public.get_free_slots(subject, from, to)` | `SECURITY DEFINER` RPC | Free slots for `authenticated` users only; window capped at 31 days |
| `public.timerange` | range type | Lets an exclusion constraint stop a tutor's availability windows overlapping |

**Seed (`supabase/seed.sql`, local only):** 3 demo users, 6 subjects, and 15 tutors with random weekly availability generated from a fixed seed, so it's identical after every reset. It also books Marcus Lindqvist solid for 14 days and adds a few of Sam's consultations. Historic (past) rows are inserted with the booking trigger explicitly disabled for that one statement.

---

## Justifications & assumptions

### Key decisions

| Decision | Why |
| -------- | --- |
| RLS + API validation, no service-role key (D7) | Authorization next to the data, defence in depth, and testable with pgTAP |
| `profiles.role` + `current_user_role()` (D6) | Role changes apply immediately, with few moving parts; a clear path to JWT claims later |
| Soft cancel with `completed_at` / `cancelled_at` timestamps (D8) | Keeps history and the time of each change; the admin still sees cancellations; derived status |
| Business rules in the database, checked by the API too (D11, D23) | No client, script or future service can bypass them; the API pre-checks only for friendlier errors |
| Exclusion constraints for overlaps (D20, D24) | Safe under concurrency, unlike "check, then insert" in application code |
| Action endpoints (D28) | Narrow bodies, separately authorizable, idempotent completion |
| Keyset pagination (D30) | Constant cost per page, stable under inserts |
| Shared service layer (D29) | One source of truth; pages skip the HTTP hop; writes still go through the API |
| Role-prefixed pages (D38) | Mirrors the API split and makes role boundaries obvious |
| Slot picker for the "datetime" field (D39) | Students can only pick bookable times; the server checks again |
| Pinned dependencies, CLI as a dev dependency (D2, D3) | Reproducible installs for reviewers |

### Assumptions

- **Scope extension.** Tutors, subjects and availability go beyond the brief, which says the form "doesn't need to store information beyond" the four fields. They were added to support "booked out" and recommendations (D19–D27). The four required fields are still collected and stored as specified.
- **Names are stored on the consultation** exactly as entered. They're prefilled from the profile when known and aren't copied back to it (D9).
- **Time:** consultations last 60 minutes and start on the hour. Everyone is in Melbourne, so all times are stored in UTC and shown in Australia/Melbourne time (D22, D42).
- **Tutor hours:** tutors work recurring weekly windows within 08:00–20:00, any day. There are no one-off exceptions such as leave, and tutors don't manage their own hours yet (D20).
- **Completion:** a consultation can only be marked complete after it has ended (D16).
- **Completed versus cancelled:** a completed consultation can't be cancelled without first being marked incomplete, and a cancelled one is final (D15, D8).
- **Rescheduling** may switch to another tutor of the same subject, but never to another subject (D26).
- **Admin and tutor views are read-only**, and only students book (D14).
- **Admins and tutors are provisioned out of band.** No API grants roles (D13).
- **Session checks:** `getClaims()` verifies the JWT locally, so a revoked session stays valid until its token expires, one hour by default. PostgREST applies the same rule. Use `getUser()` if immediate revocation is needed (D32).

### Changes to the starter template

- **Removed:** the demo and tutorial content.
- **Redirects:** auth flows now go to `/dashboard`, and sign-up skips the "check your email" page when a session is returned.
- **Security:** fixed the open redirect in `auth/confirm`, and logout now refreshes the router.
- **Lint compatibility:** moved ESLint to the native flat config that `eslint-config-next` 16 ships, and replaced `setState`-in-effect in the theme switcher.
- **Generated components:** newly generated shadcn components use the project's own `cn` helper and Tailwind v3 classes (D43).

Run `git diff bddeb1f -- <path>` to compare any file with the original template.

---

## Testing

| Suite | Command | Covers |
| ----- | ------- | ------ |
| pgTAP | `npm run db:test` | 38 tests (see below) |
| API smoke | `npm run test:api` | 29 HTTP calls as the seeded student, tutor and admin (see below) |
| Page smoke | `npm run test:pages` | 17 checks of role redirects and server-rendered content per role |
| Static | `npm run lint && npm run typecheck && npm run build` | ESLint, TypeScript, and the production build, including Cache Components checks |

**pgTAP (`npm run db:test`)** covers:
- anonymous, student, tutor and admin access;
- spoofing and role escalation;
- column grants;
- every booking rule;
- overlaps;
- the soft-cancel and completion rules;
- `get_free_slots`.

**API smoke (`npm run test:api`)** covers every route plus:
- 401 without a session, and 403 for the wrong role;
- CSRF rejection;
- validation errors;
- overlapping bookings and booking-rule errors;
- pagination and tampered cursors;
- admin filters.

The API and page smoke tests need a running app (`npm run dev`) on a freshly reset database (`npm run db:reset`). The API test leaves a cancelled booking behind, so reset again for a clean slate.

---

## Known limitations & future work

- **Browser tests:** no end-to-end tests drive a real browser through the client-side picker and dialogs. The next step is Playwright; it couldn't run on the dev machine because a system library was missing (D44).
- **Unit tests:** the service layer and the error mapping have none; they're covered by the smoke and pgTAP suites.
- **Rate limiting** on writes and auth endpoints.
- **Audit log:** a table of who changed what, for example rescheduling history.
- **Scheduling features:** tutors managing their own availability, leave and exceptions, and variable session lengths.
- **Notifications:** confirmation and reminder emails, and calendar (ICS) invites.
- **Admin tools:** user and role management, writes with an audit trail, and filtering by student name (the API already supports `studentId`).
- **Time zones:** a timezone per user or tutor, in place of one business timezone.
- **Session revocation:** switch to `getUser()` if immediate revocation is a requirement.

---

## AI usage

This project was built with AI assistance from Anthropic's Claude Code, which the assessment permits. I reviewed every change and can explain it. Commits don't carry per-commit AI co-author trailers; this section discloses the AI use instead.
