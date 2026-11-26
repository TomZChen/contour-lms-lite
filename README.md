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
auth.users ─1:1─ profiles ─1:n─ consultations

profiles                       consultations
  id          uuid PK/FK         id            uuid PK
  role        app_role           student_id    uuid FK → profiles (default auth.uid())
  created_at  timestamptz        first_name    text (1–100)
                                 last_name     text (1–100)
                                 reason        text (1–1000)
                                 scheduled_at  timestamptz
                                 completed_at  timestamptz null  (null = incomplete)
                                 cancelled_at  timestamptz null  (soft cancel)
                                 created_at / updated_at
```

**How access is enforced:**
- RLS is enabled on every table.
- Students can read, insert and update their own rows. Admins can read every row and change none.
- `private.is_admin()` (`SECURITY DEFINER`, not exposed by the API) performs the role check.
- Column-level grants restrict what `authenticated` can write. There's no `DELETE` grant.
- Cancelled rows can't be changed.
- `supabase/tests/rls_test.sql` tests all of these rules.

## Justifications & assumptions

The full decision log, with the alternatives considered, is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

- **Dependencies are pinned** (`next`, `@supabase/*`) instead of the template's `latest`, so builds are reproducible.
- **Supabase CLI is a dev dependency**, so every contributor uses the same CLI version.
- **Template fixes:** the ESLint config was moved to the native flat config that `eslint-config-next` 16 ships, with generated files ignored. The theme switcher now uses `useSyncExternalStore` instead of `setState` inside an effect.

## AI usage

This project was built with AI assistance from Anthropic's Claude Code, which the assessment permits. I reviewed every change and can explain it. Commits don't carry per-commit AI co-author trailers; this section discloses the AI use instead.
