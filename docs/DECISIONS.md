# Decision log

Every design decision in this project, with the reasoning and the alternatives considered. New entries go at the bottom. A summary of these feeds the README's "Justifications & assumptions" section.

Status values: **Decided** (you chose it), **Default** (my recommendation, applied without asking; open to change), **Assumption** (fills a gap in the spec).

---

## Tooling & setup

### D1. Start from the official `with-supabase` example
**Status:** Decided · 2026-11-26
The assessment suggests this starter. It provides Next.js 16 with the App Router, `@supabase/ssr` cookie-based auth, login, sign-up, logout and password-reset flows, and shadcn/ui.

### D2. Pin dependency versions
**Status:** Default · 2026-11-26
The template uses `"latest"` for `next` and `@supabase/*`. They're pinned to 16.4.6, 0.12.7 and 2.119.2 so builds are reproducible. `eslint-config-next` was moved to 16.4.6 to match Next, and `eslint.config.mjs` now uses its native flat config.

### D3. Supabase CLI as a dev dependency
**Status:** Default · 2026-11-26
`npm install` supplies the CLI, so reviewers don't need a global install and everyone uses the same version.
**Rejected:** a global install, because the version can differ between machines.

### D4. Stay on the stable local Supabase stack
**Status:** Default · 2026-11-26
The CLI offers an experimental "new local stack". It was declined so reviewers following the README hit fewer surprises.

### D5. No AI co-author trailers in commits
**Status:** Decided · 2026-11-26
AI use (Claude Code) is disclosed once, in the README's "AI usage" section, not in each commit.

---

## Data model & security

### D6. Roles are stored in `profiles.role` and checked with `private.is_admin()`
**Status:** Decided · 2026-11-26
- `app_role` enum: `'student' | 'admin'`, defaulting to `'student'`.
- A trigger on `auth.users` creates the profile row, so the role never comes from client input. Users can't update their own profile at all.
- `private.is_admin()` is a `SECURITY DEFINER` function. It lives in a schema PostgREST doesn't expose, so it can't be called over the API. Policies call it as `(select private.is_admin())`, so Postgres evaluates it once per query, not once per row.
- Role changes apply immediately, with no stale JWT.

**Rejected:**
- *`user_roles` table + custom access-token hook (JWT claim):* saves a lookup per query and allows many roles per user, but has more parts, and roles stay stale until the token refreshes (up to about an hour).
- *`profiles.role` + JWT hook:* same trade-off as above.

**Scaling note:** if many roles or permissions are needed later, move to a `user_roles` / `role_permissions` table plus a JWT claim hook.

### D7. Access control: RLS + API-route validation
**Status:** Decided · 2026-11-26
- Route handlers use the user's own Supabase client (publishable key plus the session cookie), so Postgres RLS is the authorization layer.
- The routes add input validation (zod), business rules and clear error responses.
- The app never uses the service-role key.
- Column-level `GRANT`s restrict which columns `authenticated` can insert and update.

**Rejected:**
- *API-only checks with the service-role key:* one missed check exposes every user's data.
- *RLS only, with the client calling Supabase directly:* goes against "prefer APIs over Server Actions", and leaves no server layer for business rules.

### D8. Consultation lifecycle: nullable timestamps and soft cancel
**Status:** Decided · 2026-11-26
- Nullable `completed_at` and `cancelled_at` columns. Toggling complete sets or clears `completed_at`; cancelling sets `cancelled_at`.
- Rows are never deleted, so history is kept and the admin can still see cancelled consultations.
- `CHECK (not (completed_at is not null and cancelled_at is not null))`.
- A cancelled consultation can't be changed afterwards (enforced by RLS).

**Rejected:**
- *Status enum:* doesn't record when a change happened.
- *Boolean flag + hard delete:* loses history, and the admin can't see cancellations.

### D9. First and last name are stored on the consultation
**Status:** Assumption · 2026-11-26
The spec lists them as booking-form fields, so each consultation stores the names exactly as entered. They aren't copied onto the profile.

### D10. No double-booking or slot validation
**Status:** Assumption · 2026-11-26
The spec has no consultant or availability entity, so there's nothing for a booking to clash with.

### D11. "Must be in the future" is checked in the API, not a DB `CHECK`
**Status:** Default · 2026-11-26
A `CHECK` using `now()` is also re-checked on every update, so marking a past consultation complete would fail. Creating and rescheduling are validated in the route handler instead.

### D12. Students can update only certain columns
**Status:** Default · 2026-11-26
- `GRANT UPDATE` covers only `scheduled_at`, `completed_at` and `cancelled_at`.
- `GRANT INSERT` covers only `first_name`, `last_name`, `reason` and `scheduled_at`.
- `student_id` comes from its default, `auth.uid()`, and is also checked by RLS.
- This stops a student taking over another student's row, or inserting a row that's already completed.

### D13. Admins are created out of band
**Status:** Default · 2026-11-26
Locally, `supabase/seed.sql` creates the demo admin and student accounts. In production an operator promotes a user with SQL. No API endpoint grants roles.

### D14. Admin view is read-only
**Status:** Default · 2026-11-26
The spec allows it. Admins get a `SELECT` policy on every row, and no write policies.

### D15. A completed consultation can't be cancelled, and vice versa
**Status:** Assumption · 2026-11-26
The DB `CHECK` from D8 rejects a row that is both completed and cancelled. To cancel a completed consultation, the student first marks it incomplete. The API will return a clear error in this case.

### D16. Students can mark a future consultation complete
**Status:** Assumption · 2026-11-26
The spec only says "mark complete/incomplete", so no time-based restriction is applied. It's easy to add in the API later if needed.

### D17. RLS is covered by pgTAP tests
**Status:** Default · 2026-11-26
`supabase/tests/rls_test.sql` (run with `npm run db:test`) has 19 tests. They cover access as an anonymous user, a student and an admin; spoofing and role escalation; the column grants; and the soft-cancel rules. Security rules that only live in policies are easy to break by accident, so each rule has a test.

### D18. TypeScript types are generated from the schema
**Status:** Default · 2026-11-26
`npm run db:types` writes `lib/supabase/database.types.ts`. The Supabase clients will be typed with `Database`, so a schema change that breaks the code shows up at compile time. The file is committed so the project builds without a running database.
