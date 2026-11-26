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

## Implementation summary

_To be written._

## Database schema & migrations

_To be written._ Migrations live in `supabase/migrations/`.

## Justifications & assumptions

- **Dependencies are pinned** (`next`, `@supabase/*`) instead of the template's `latest`, so builds are reproducible.
- **Supabase CLI is a dev dependency**, so every contributor uses the same CLI version.
- **Template fixes:** the ESLint config was moved to the native flat config that `eslint-config-next` 16 ships, with generated files ignored. The theme switcher now uses `useSyncExternalStore` instead of `setState` inside an effect.

## AI usage

This project was built with AI assistance from Anthropic's Claude Code, which the assessment permits. I reviewed every change and can explain it. Commits don't carry per-commit AI co-author trailers; this section discloses the AI use instead.
