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

### D6. Roles are stored in `profiles.role` and checked with `private.current_user_role()`
**Status:** Decided · 2026-11-26 (updated 2026-11-26 for the tutor role, D19)
- `app_role` enum: `'student' | 'tutor' | 'admin'`, defaulting to `'student'`.
- A trigger on `auth.users` creates the profile row, so the role never comes from client input. Users can't update their own profile at all.
- `private.current_user_role()` is a `SECURITY DEFINER` function returning the caller's role. It lives in a schema PostgREST doesn't expose, so it can't be called over the API. Policies call it as `(select private.current_user_role()) = 'admin'`, so Postgres evaluates it once per query, not once per row. It replaced the original `private.is_admin()` when a third role arrived, because one helper scales to any number of roles.
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

### D10. ~~No double-booking or slot validation~~ (superseded by D20)
**Status:** Superseded · 2026-11-26
Originally the spec had no consultant entity, so there was nothing to clash with. Tutors (D19) changed that; see D20 and D24.

### D11. "Must be in the future" is enforced by a trigger, not a DB `CHECK`
**Status:** Default · 2026-11-26 (revised 2026-11-26)
A `CHECK` using `now()` is also re-checked on every update, so marking a past consultation complete would fail. The rule now lives in the booking trigger (D23), which only fires `BEFORE INSERT OR UPDATE OF scheduled_at, tutor_id`. That way it applies to booking and rescheduling, but not to completing or cancelling. The API also checks it first, to give a friendly error.

### D12. Students can update only certain columns
**Status:** Default · 2026-11-26
- `GRANT UPDATE` covers only `scheduled_at`, `tutor_id`, `completed_at` and `cancelled_at`.
- `GRANT INSERT` covers only `first_name`, `last_name`, `reason`, `scheduled_at`, `subject_id` and `tutor_id`.
- `ends_at` is set by a trigger and can't be written by clients.
- `student_id` comes from its default, `auth.uid()`, and is also checked by RLS.
- This stops a student taking over another student's row, or inserting a row that's already completed.

### D13. Admins are created out of band
**Status:** Default · 2026-11-26
Locally, `supabase/seed.sql` creates the demo admin and student accounts. In production an operator promotes a user with SQL. No API endpoint grants roles.

### D14. Admin and tutor views are read-only
**Status:** Default · 2026-11-26
The spec allows a read-only admin view. Admins get a `SELECT` policy on every row, and tutors on consultations booked with them. Neither role has write policies, and only students book (the insert policy checks for the `student` role).

### D15. A completed consultation can't be cancelled, and vice versa
**Status:** Decided · 2026-11-26 (you confirmed it)
The DB `CHECK` from D8 rejects a row that is both completed and cancelled. To cancel a completed consultation, the student first marks it incomplete. The API will return a clear error in this case.

### D16. A consultation can only be marked complete after it has ended
**Status:** Decided · 2026-11-26 (reverses the original assumption)
The RLS `UPDATE … WITH CHECK` requires `completed_at is null or ends_at <= now()`. It's a policy condition, not a table `CHECK`, so it only applies to student writes (see D11). As a side effect, a completed consultation can't be rescheduled into the future.

### D17. RLS is covered by pgTAP tests
**Status:** Default · 2026-11-26
`supabase/tests/rls_test.sql` (run with `npm run db:test`) has 38 tests. They cover access as an anonymous user, a student, a tutor and an admin; spoofing and role escalation; the column grants; the soft-cancel and completion rules; every booking rule (past, on the hour, availability, wrong subject, double booking); and the free-slots function. Security rules that only live in policies are easy to break by accident, so each rule has a test.

### D18. TypeScript types are generated from the schema
**Status:** Default · 2026-11-26
`npm run db:types` writes `lib/supabase/database.types.ts`. The Supabase clients will be typed with `Database`, so a schema change that breaks the code shows up at compile time. The file is committed so the project builds without a running database.

---

## Tutors, subjects & availability

The spec says the booking form "doesn't need to store information beyond" the four listed fields. Adding tutors and subjects is a deliberate scope extension, which you requested on 2026-11-26.

### D19. Tutors are auth users with a `tutor` role and a read-only dashboard
**Status:** Decided · 2026-11-26
- `'tutor'` was added to `app_role`, in its own migration, because Postgres can't use a new enum value in the same transaction that adds it.
- Tutors log in like everyone else, and RLS lets them read only the consultations booked with them.
- All signed-in users can read tutor profiles (name), so students can choose one.
- `profiles.full_name` was added for display.

**Rejected:**
- *Tutor role without a UI:* doesn't show the role working.
- *Tutors as plain data:* not a role at all.

### D20. "Booked out" = per-tutor weekly availability plus DB-enforced no-overlap
**Status:** Decided · 2026-11-26
- `tutor_availability` holds recurring weekly windows (`iso_weekday`, `start_time`, `end_time`) in business-local time.
- An exclusion constraint (`btree_gist`, `tutor_id =`, `tstzrange &&`, ignoring cancelled rows) makes double-booking impossible, even under concurrent requests. The database decides who gets the slot, not application code that checks and then inserts.
- Windows on the same day can't overlap (an exclusion constraint on a custom `timerange` type).
- A tutor is **booked out** for a period when `get_free_slots` returns no slots for them in it.
- **Out of scope:** a screen for tutors to edit their hours (they're seeded), and one-off exceptions such as leave or holidays.

**Rejected:**
- *Fixed global hours:* less realistic.
- *Daily capacity limit:* doesn't stop two bookings at the same time, and is hard to enforce safely under concurrency.

### D21. Subjects and tutors are many-to-many (`subjects` + `tutor_subjects`)
**Status:** Decided · 2026-11-26
- Consultations store `subject_id` and `tutor_id`, with a composite FK to `tutor_subjects`, so a tutor can only be booked for a subject they teach.
- A trigger ensures only tutor profiles can be linked to subjects or have availability.
- The seed gives each tutor one subject, but tutors who teach several need no schema change.

**Rejected:**
- *`subject_id` on the tutor:* allows only one subject per tutor.
- *Enum:* adding a subject would need a migration.

### D22. 60-minute slots on the hour, 08:00-20:00 Australia/Melbourne, 7 days
**Status:** Decided (hours and timezone) / Default (duration) · 2026-11-26
- `private.business_timezone()` and `private.slot_duration()` hold these constants in one place.
- Times are stored as `timestamptz` (UTC). Availability is local wall-clock time, so DST is handled by `AT TIME ZONE`.
- `ends_at` is always derived by a trigger, never sent by the client.
- **Assumption:** all students and tutors are in Melbourne, and the UI shows Melbourne time.

### D23. Booking rules live in a DB trigger, and the API checks them too
**Status:** Default · 2026-11-26
- `private.validate_consultation_booking()` checks that the slot is in the future, starts on the hour, and falls within the tutor's availability.
- It raises `P0001` with stable message codes (`slot_in_past`, `slot_not_on_the_hour`, `tutor_unavailable`). An overlap raises `23P01`. The API maps these codes to HTTP 409 or 422 responses.
- Keeping the rules in the database means no client, script or future service can bypass them. The API checks first only to give friendlier errors.
- Historic seed data disables the trigger explicitly for that one insert.

### D24. A student can't be in two consultations at once
**Status:** Default · 2026-11-26
A second exclusion constraint on `student_id`. It seems clearly intended, and costs nothing extra.

### D25. Free slots come from a `SECURITY DEFINER` function that returns no PII
**Status:** Default · 2026-11-26
- Students can't read other students' consultations (RLS), but they need to know which slots are taken.
- `public.get_free_slots(subject_id, from, to)` returns only `(tutor_id, slot_start)` pairs, and only to `authenticated` users.
- The window is capped at 31 days, so each call does a bounded amount of work.
- **Recommendations:** if the chosen tutor has no free slots (booked out) or isn't free at the chosen time, the API suggests other tutors for the same subject who have free slots, using this function's output.

### D26. Rescheduling may switch tutor within the same subject
**Status:** Default · 2026-11-26
`tutor_id` is in the `UPDATE` grant, so a student can move to a recommended tutor when rescheduling. The composite FK keeps the subject the same, because `subject_id` can't be updated.

### D27. Schema changes are new migrations, never edits to applied ones
**Status:** Default · 2026-11-26
Tutors were added in new migration files. No production data exists, so `NOT NULL` columns were added directly. On live data they'd be added as nullable, backfilled, then made `NOT NULL`.
