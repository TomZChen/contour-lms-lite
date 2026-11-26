# Contour LMS Lite

A mini-LMS for booking and managing student consultations, with an admin view of every consultation in the system.

> **Status:** work in progress. Only the scaffold exists so far.

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

## Implementation summary

_To be written._

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
