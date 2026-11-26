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
`supabase/tests/rls_test.sql` (run with `npm run db:test`) has 47 tests. They cover access as an anonymous user, a student, a tutor and an admin; spoofing and role escalation; the column grants; the soft-cancel and completion rules; every booking rule (past, on the hour, availability, wrong subject, double booking); the free-slots function, and tutors setting their own availability. Security rules that only live in policies are easy to break by accident, so each rule has a test.

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

---

## API

### D28. Changes use action endpoints, not a generic PATCH
**Status:** Decided · 2026-11-26
- `POST /api/consultations/:id/reschedule` takes `{ scheduledAt, tutorId? }`.
- `PUT` / `DELETE /api/consultations/:id/completion` marks the consultation complete or incomplete. Completion is a sub-resource, so both directions are idempotent.
- `POST /api/consultations/:id/cancel` soft-cancels the consultation.
- Each route accepts one narrow request body (zod `strictObject`, unknown fields rejected), so actions can't be combined in one request, such as uncancelling while rescheduling. Each can also be authorized and audited separately.

**Rejected:**
- *Single PATCH:* one route would have to reject illegal combinations of fields itself.
- *DELETE to cancel:* DELETE implies the row is removed, which contradicts the soft cancel.

### D29. Shared service layer: route handlers for writes, server components for first render
**Status:** Decided · 2026-11-26
- `lib/server/*.ts` (marked `server-only`) holds every query and business rule.
- Route handlers in `app/api/**` are thin: they parse the request, call the service and return JSON.
- Server components call the same service functions directly for the first render, so there's no extra HTTP hop to the app's own server.
- Client components call the API routes for writes and live data (availability), then `router.refresh()`.
- Every path uses the same RLS-scoped Supabase client acting as the user.

**Rejected:**
- *Everything client-fetched through the API:* loses server rendering, and needs an extra data-fetching library.
- *Server components fetching `/api`:* an extra hop, fragile cookie forwarding, and Next.js advises against it.

### D30. Cursor (keyset) pagination
**Status:** Decided · 2026-11-26
- `?cursor=<opaque>&limit=1..100` (default 20), ordered by `(scheduled_at, id)` using the existing composite indexes.
- Each page costs the same however deep it is, and pages stay stable when rows are inserted.
- The cursor is base64url-encoded JSON, validated with zod on decode, so only a timestamp and a uuid ever reach the PostgREST filter. Arbitrary input can't inject filter syntax.
- The service fetches `limit + 1` rows to tell whether another page exists, which avoids a `count(*)`.

**Rejected:** offset pagination, because deep pages slow down and the count gets expensive.

### D31. A separate admin endpoint
**Status:** Decided · 2026-11-26
- `GET /api/consultations` returns *my* consultations: bookings for a student, sessions for a tutor.
- `GET /api/admin/consultations` returns everything, with `studentId`, `tutorId`, `subjectId` and `status` filters. It calls `requireRole(user, "admin")`, so anyone else gets a 403.
- Role checks are explicit in the code, and RLS still enforces the same rules underneath.

**Rejected:** one endpoint scoped only by RLS, because the role behaviour would be implicit.

### D32. Cross-cutting route concerns live in a single wrapper, `authedRoute()`
**Status:** Default · 2026-11-26
For every route, the wrapper:
- **Checks the session:** `getClaims()` verifies the JWT, then the role is read from `profiles`, so a role change applies on the next request (D6). If either step fails, it returns 401.
- **Blocks CSRF on writes:** it rejects `Sec-Fetch-Site: cross-site` and any `Origin` that doesn't match the host, and requires `application/json` for request bodies. The session cookie is already set to `SameSite=Lax`.
- **Validates input:** zod checks the body, query string and route params. A malformed id returns 404, the same as any unknown id.
- **Uses one error format:** `{ error: { code, message, details? } }`. Database errors map to HTTP statuses (`23P01` → 409, booking-rule `P0001` → 422, `42501` → 403, `PGRST116` → 404). Raw SQL errors are never returned.
- **Marks responses private:** `Cache-Control: private, no-store`.
- **Lets the API answer for itself:** the proxy no longer redirects `/api/*` to the login page, so API clients get a JSON 401, not an HTML redirect.

**Known trade-off:** `getClaims()` verifies the JWT without asking the server, so a session revoked mid-token stays valid until the token expires (one hour by default). PostgREST applies the same rule. If immediate revocation matters, switch to `getUser()`, which costs one network round trip per request.

### D33. Visible-but-not-yours writes return 403, invisible ones 404
**Status:** Default · 2026-11-26
- A tutor or admin who can see a consultation but tries to change it gets a 403.
- A user who can't see it at all gets a 404, so the API never reveals whether a consultation they can't see exists.
- The service checks state before writing, to give precise errors: 409 `consultation_cancelled`, 409 `consultation_completed`, and 422 `consultation_not_ended`. The database enforces the same rules anyway.

### D34. Direct FKs from consultations to profiles and subjects
**Status:** Default · 2026-11-26
- The composite FK to `tutor_subjects` already guarantees integrity.
- PostgREST needs single-column FKs to embed `tutor` and `subject` details in responses, so these were added in a new migration.
- Both are `ON DELETE RESTRICT`, so a tutor or subject that has consultations can't be deleted and history is kept.

### D35. End-to-end API smoke test
**Status:** Default · 2026-11-26
`scripts/smoke-api.mjs` (run with `npm run test:api`) makes 43 checks against a running app, logged in as the seeded student, tutor and admin. It covers every route and its failure modes: 401, 403, CSRF, validation, overlaps, booking rules, pagination, admin filters and tutor availability. It complements the pgTAP tests (D17), which test the database on its own.

**Not done (interview notes):** rate limiting on writes, an audit log table, and unit tests for `lib/server` with a mocked client.

### D36. The route wrapper rethrows Next.js control-flow errors
**Status:** Default · 2026-11-26
This template enables `cacheComponents`. During the build, `cookies()` rejects on purpose to mark a route as dynamic. `authedRoute()` calls `unstable_rethrow()` before its own error handling, so that signal (and `notFound()`/`redirect()`) isn't turned into a 500 response. The build output confirms every `/api` route is dynamic (`ƒ`).

### D37. Commit the `AGENTS.md` that Next.js generates
**Status:** Default · 2026-11-26
`next dev` writes `AGENTS.md`, which points AI agents at the docs for this Next.js version in `node_modules/next/dist/docs`. It's committed, as the file itself recommends, so the working tree stays clean. The route-handler code was checked against those docs.

---

## UI

### D38. Each role has its own area (`/student`, `/tutor`, `/admin`)
**Status:** Decided · 2026-11-26
- Each area's layout uses `RoleLayout`. On the server, it redirects signed-out users to `/auth/login` and users with another role to their own area.
- `/dashboard` is the single landing page after login (login, sign-up and password update all go there) and sends each user to their area.
- This mirrors the API's `/api/admin` split (D31).
- The layout check only controls what pages users see. The service layer checks the role again (`requireRole`), and RLS enforces it in the database.
- The gate runs inside `<Suspense>`, because Cache Components requires request-time data such as cookies to be read inside a boundary. Pages are partially prerendered: a static shell, with per-user content streamed in.

**Rejected:**
- *One adaptive `/dashboard`:* role logic would be a branch inside one page.
- *Shared pages + `/admin`:* a mixed model.

### D39. Booking = subject → tutor → slot grid, plus the spec's fields
**Status:** Decided · 2026-11-26
- `AvailabilityPicker` shows every tutor for the subject with a **Booked out** badge, or their next free slot.
- When the chosen tutor is booked out, it recommends tutors for the same subject who have free slots, with their next free time and a one-click switch.
- Free slots are listed by day, in 14-day windows, up to 8 weeks ahead.
- The spec's "Datetime for consultation" field is this slot picker. Students can't pick an invalid time, and the server checks it again anyway.
- First name, last name and reason are ordinary inputs. Names are prefilled from the profile when it has them, and the student can edit them (D9).
- The form uses react-hook-form with `zodResolver(createConsultationSchema)`, the same schema the API validates with.
- Server field errors are shown on the matching inputs. A slot that's no longer free (`slot_taken`, etc.) clears the selection and reloads availability.

**Rejected:**
- *Free datetime input:* students would pick many unavailable times.
- *Both:* more work, for little extra.

### D40. Booking has its own page; rescheduling uses a dialog; cancelling asks first
**Status:** Decided · 2026-11-26
- `/student/book` is its own page, because it's a multi-step form and the URL can be shared.
- Reschedule opens a dialog that reuses `AvailabilityPicker` for the same subject, and can switch tutor (D26).
- Cancel uses an `AlertDialog` that asks for confirmation.
- Complete is a checkbox, which is disabled, with a tooltip, until the consultation has ended (D16). Cancelling a completed consultation is also disabled, with a tooltip (D15).

### D41. Lists: the first page is server-rendered; filters live in the URL; later pages and changes go through the API
**Status:** Default · 2026-11-26
- Pages call the service layer directly (D29). Status tabs and the admin filters (student-name search, subject, tutor, order) are URL search params, so every view can be bookmarked and is server-rendered.
- `parseListParams()` validates search params with the API's own zod schema, so the server render and "Load more" always use the same filters. Invalid values fall back to the defaults.
- "Load more" calls the list API with the keyset cursor (D30).
- Changes call the action endpoints, then update the row in place from the response, or remove it if it no longer matches the current tab.
- Defaults: students and tutors see **Scheduled**, earliest first. Admins see **All**, latest first.

### D42. Times are shown in Melbourne time, labelled with the zone
**Status:** Default · 2026-11-26
`lib/format.ts` uses `Intl.DateTimeFormat` with `timeZone: "Australia/Melbourne"` (D22), whatever the viewer's device is set to. Server and client output match, so hydration is stable, and everyone sees the same wall-clock time.

### D43. Starter template cleaned up; the original is kept for comparison
**Status:** Decided · 2026-11-26
- Removed: tutorials, hero, deploy button, logos, `/protected`, `auth-button`, and the OpenGraph and Twitter images.
- Kept: the auth pages and forms, the theme switcher, `env-var-warning`, and the shadcn/ui components.
- The untouched template (commit `bddeb1f`) is exported to `../contour-lms-lite-template-original` for side-by-side review. `git diff bddeb1f -- <path>` shows the same changes.
- **Fixed in the template:**
  - **Open redirect:** `app/auth/confirm` redirected to any `next` URL, so `?next=https://evil.example` sent a freshly verified user off-site. It now only allows same-site relative paths.
  - **Sign-up with confirmation off:** sign-up now goes straight to `/dashboard` when the server returns a session.
  - **Logout:** it now refreshes the router, so cached signed-in pages aren't shown afterwards.
- **New shadcn/ui components:** table, dialog, alert-dialog, select, textarea, tabs, sonner, skeleton, tooltip and separator. The CLI generates them for Tailwind v4, so their four v4-only classes were swapped for v3 equivalents. The template's existing `button.tsx` was kept as it was. Newer shadcn CLI versions import `cn` from shadcn's separate `cn` npm package. The generated components were pointed back at the project's own `@/lib/utils` helper and the package removed, so there's one implementation of the helper.

### D44. Page-level smoke test
**Status:** Default · 2026-11-26
`scripts/smoke-pages.mjs` (`npm run test:pages`) checks role gating (12 redirect and access cases) and the server-rendered content for each role. Browser-level checks (the client-side picker flows) weren't automated, because headless Chromium needs a system library (`libasound2`) that isn't installed on the dev machine. Playwright end-to-end tests are listed as future work.

### D45. Admins can search consultations by student name
**Status:** Decided · 2026-11-26 (requested by the user)
- **What's searched:** the first and last name entered on each booking (the spec's form fields), not the account profile. That's the name the admin sees in the list, and the account name can differ.
- **Matching:** `GET /api/admin/consultations?q=…`. Each word must appear, ignoring case, in either the first or the last name, so "sam stu" finds Sam Student. It's combined with the other filters and keyset pagination as normal. At most 5 words are used.
- **Safety:** the words go into a PostgREST `or=(…ilike…)` filter. `q` is limited to 100 characters of letters, spaces, apostrophes, hyphens and full stops. That rules out the characters that could break out of a quoted filter value (`"`, `,`, `(`, `)`) and LIKE wildcards (`%`, `_`, `*`). Anything else is a 400.
- **Scalability:** `ILIKE '%word%'` can't use a btree index. A new migration adds `pg_trgm` and trigram GIN indexes on `first_name` and `last_name`.
- **UI:** a search box in the admin filters. It updates `?q=` in the URL after 300 ms (with `router.replace`, so typing doesn't fill the history), and the list is server-rendered like the other filters (D41).
- **Rejected:**
  - *Full-text search (`tsvector`):* built for words in prose. It's poor at matching part of a name ("Sam" in "Samantha") without prefix-query tricks.
  - *Searching the account's profile name:* possible through an `!inner` embed of `profiles` on `student_id`, but it searches a name the admin doesn't see in the list. It also turns the shared list query into a join, and `profiles.full_name` would need its own trigram index.
  - *An RPC function:* more code for the same result. PostgREST filters keep it in the one shared list query.

### D46. Tutors set their own weekly availability; removing booked hours is blocked
**Status:** Decided · 2026-11-26 (user chose the weekly editor and "block the change")
- **UI:** `/tutor/availability` is a 7-day × 08:00–20:00 grid. Click or drag to switch hours on or off, use "All day" or "Clear" per day, then save the whole week. Hours holding upcoming sessions show a lock and can't be switched off.
- **API:** `GET /api/tutor/availability` returns `{ windows, booked }`. `PUT` takes `{ windows: [{ weekday, start, end }] }` and replaces the week. zod checks whole hours within 08:00–20:00, `start < end` and no overlaps; the database checks the same again.
- **One write path:** `public.set_my_availability(jsonb)` (`SECURITY DEFINER`) deletes and re-inserts the caller's windows in one transaction. Tutors get no `INSERT` or `DELETE` grant on `tutor_availability`, so the PostgREST table endpoint can't be used to get round the conflict rule. Only callers whose role is tutor can use it, and only on their own rows (`auth.uid()`).
- **Conflicts (user's choice: block):** after the replace, any upcoming scheduled session not covered by a window raises `availability_conflict` with the sessions as JSON in the error detail. That rolls back the change, and the API returns 409 with `details.conflicts`. The student's booking is never left outside the tutor's hours. The cost is that a tutor can't drop a booked hour until the student reschedules or cancels.
- **Race with bookings:** without coordination, a student could book an hour in the instant a tutor removes it, and each transaction's check would pass. Both sides now take a per-tutor transaction-scoped advisory lock: bookings take it shared, so they don't block each other, and availability changes take it exclusive. Whichever comes second waits and then re-checks against committed data. This was verified with two live sessions: the booking waited for the change, then failed with `tutor_unavailable`. Advisory locks were chosen over `SELECT … FOR SHARE`, which needs `UPDATE` privilege on the table.
- **Error mapping:** a window-overlap exclusion violation (`tutor_availability_no_overlap`) maps to 422 `validation_failed`, not the booking `slot_taken`.
- **Rejected:**
  - *Per-window CRUD:* a grid edit would become many calls, with partial failures.
  - *Auto-cancelling affected sessions:* destroys student data without a notification system.
  - *Keep-and-warn:* simpler, but leaves bookings outside the tutor's stated hours.
  - *Date-specific time off:* left as future work.

### D47. Week calendar view for every role, custom-built
**Status:** Decided · 2026-11-26 (user chose "all roles, week view" and "custom with Tailwind")
- **Where:** `/student`, `/tutor` and `/admin` have a **List | Calendar** toggle (`?view=calendar&week=YYYY-MM-DD`; any day is normalised to its Monday, and invalid values fall back to this week). The status tabs and admin filters apply to both views, as in D41.
- **Data:** `listConsultationsForWeek()` reuses the list query with a `[from, to)` range on `scheduled_at`, capped at 500 sessions. Past that it says "narrow it down with filters". The same `from`/`to` filter is exposed on both list APIs. The week is rendered on the server, and prev, next and "This week" are links.
- **Layout:** Monday–Sunday × business hours. Every session is 60 minutes on the hour, so each sits in exactly one cell, with no overlap layout needed. A cell shows up to 2 sessions, then "+n more" opens a dialog. Chips are coloured by status. Clicking one opens its details, and for students the existing complete, reschedule and cancel actions, which refresh the week afterwards.
- **Time zone:** `lib/calendar.ts` does the Melbourne-time maths with `Intl` only: date keys, Monday of the week, and the instant of local midnight, including weeks with daylight-saving changes. It's checked against both 2026 DST transitions. "Today" is computed on the server and passed down, so server and client renders match.
- **Shared view:** a `ConsultationsView` server component now holds the filters, tabs and the list-or-calendar switch for all three pages.
- **Rejected:**
  - *FullCalendar:* heavy and client-only, its styling clashes with shadcn/ui, and the time zone needs a plugin.
  - *react-big-calendar:* needs a date-library localizer and extra work to show Melbourne time on any device.
  - *A month view:* not needed with one-hour sessions; left as future work.

