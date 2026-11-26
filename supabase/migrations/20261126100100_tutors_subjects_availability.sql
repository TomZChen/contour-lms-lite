-- =============================================================================
-- Tutors, subjects, weekly availability and booking rules
-- See docs/DECISIONS.md (D16, D19-D27) for the reasoning behind each choice.
--
-- No production data exists yet, so NOT NULL columns are added to
-- consultations directly. A migration against live data would add them as
-- nullable, backfill, then set NOT NULL.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Business constants (D22): one place to change them.
-- -----------------------------------------------------------------------------
create function private.business_timezone()
returns text language sql immutable parallel safe
as $$ select 'Australia/Melbourne' $$;

create function private.slot_duration()
returns interval language sql immutable parallel safe
as $$ select interval '1 hour' $$;

grant execute on function private.business_timezone() to authenticated;
grant execute on function private.slot_duration()     to authenticated;

-- -----------------------------------------------------------------------------
-- Role helper (replaces private.is_admin; D6 updated). Returns the caller's
-- role so policies can check any role with one cached lookup per query.
-- -----------------------------------------------------------------------------
create function private.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

revoke all on function private.current_user_role() from public;
grant execute on function private.current_user_role() to authenticated;

-- -----------------------------------------------------------------------------
-- profiles: display name (needed to show tutors to students)
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column full_name text
    check (full_name is null or char_length(btrim(full_name)) between 1 and 200);

drop policy "profiles: read own or admin" on public.profiles;

-- Users see their own profile, everyone signed in can see tutors (to book
-- them), admins see everyone.
create policy "profiles: read own, tutors, or admin"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or role = 'tutor'
    or (select private.current_user_role()) = 'admin'
  );

-- -----------------------------------------------------------------------------
-- subjects + tutor_subjects (D21): many-to-many
-- -----------------------------------------------------------------------------
create table public.subjects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null unique check (char_length(btrim(name)) between 1 and 100),
  created_at  timestamptz not null default now()
);

create table public.tutor_subjects (
  tutor_id    uuid not null references public.profiles (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (tutor_id, subject_id)
);

create index tutor_subjects_subject_id_idx on public.tutor_subjects (subject_id);

-- Only profiles with the tutor role can be linked to a subject.
create function private.assert_profile_is_tutor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles where id = new.tutor_id and role = 'tutor'
  ) then
    raise exception 'profile % is not a tutor', new.tutor_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger tutor_subjects_assert_tutor
  before insert or update on public.tutor_subjects
  for each row execute function private.assert_profile_is_tutor();

-- -----------------------------------------------------------------------------
-- tutor_availability (D20): recurring weekly windows in business-local time
-- -----------------------------------------------------------------------------
create type public.timerange as range (subtype = time);

create table public.tutor_availability (
  id           uuid primary key default gen_random_uuid(),
  tutor_id     uuid not null references public.profiles (id) on delete cascade,
  iso_weekday  smallint not null check (iso_weekday between 1 and 7), -- 1 = Monday
  start_time   time not null,
  end_time     time not null,
  created_at   timestamptz not null default now(),

  constraint tutor_availability_valid_window
    check (start_time < end_time),
  -- Business hours: 08:00-20:00 local, 7 days (D22).
  constraint tutor_availability_business_hours
    check (start_time >= time '08:00' and end_time <= time '20:00'),
  -- Windows align to whole hours, matching 60-minute slots.
  constraint tutor_availability_on_the_hour
    check (date_trunc('hour', start_time::interval) = start_time::interval
       and date_trunc('hour', end_time::interval)   = end_time::interval),
  -- A tutor's windows on the same day may not overlap.
  constraint tutor_availability_no_overlap
    exclude using gist (
      tutor_id with =,
      iso_weekday with =,
      public.timerange(start_time, end_time) with &&
    )
);

-- Only profiles with the tutor role can have availability.
create trigger tutor_availability_assert_tutor
  before insert or update on public.tutor_availability
  for each row execute function private.assert_profile_is_tutor();

-- -----------------------------------------------------------------------------
-- consultations: tutor, subject, end time, overlap protection
-- -----------------------------------------------------------------------------
alter table public.consultations
  add column subject_id uuid not null,
  add column tutor_id   uuid not null,
  add column ends_at    timestamptz not null,
  -- The tutor must actually teach the subject.
  add constraint consultations_tutor_teaches_subject
    foreign key (tutor_id, subject_id)
    references public.tutor_subjects (tutor_id, subject_id)
    on delete restrict,
  add constraint consultations_ends_after_start
    check (ends_at > scheduled_at),
  -- No two active bookings for the same tutor may overlap (D20). Enforced by
  -- the database, so two concurrent requests cannot both win the same slot.
  add constraint consultations_no_tutor_overlap
    exclude using gist (
      tutor_id with =,
      tstzrange(scheduled_at, ends_at, '[)') with &&
    ) where (cancelled_at is null),
  -- A student cannot be in two consultations at once either (D24).
  add constraint consultations_no_student_overlap
    exclude using gist (
      student_id with =,
      tstzrange(scheduled_at, ends_at, '[)') with &&
    ) where (cancelled_at is null);

-- Tutor dashboard: own bookings ordered by time.
create index consultations_tutor_id_scheduled_at_idx
  on public.consultations (tutor_id, scheduled_at);
create index consultations_subject_id_idx
  on public.consultations (subject_id);

-- ends_at is always derived; clients can never set it (D22).
create function private.set_consultation_ends_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.ends_at := new.scheduled_at + private.slot_duration();
  return new;
end;
$$;

create trigger consultations_set_ends_at
  before insert or update of scheduled_at on public.consultations
  for each row execute function private.set_consultation_ends_at();

-- Booking rules, checked whenever a slot is booked or changed (D23):
--   * in the future
--   * starts on the hour
--   * inside one of the tutor's weekly availability windows
-- Errors carry a stable machine-readable message the API maps to responses.
-- (Overlaps are rejected by the exclusion constraints: SQLSTATE 23P01.)
create function private.validate_consultation_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  local_start timestamp := new.scheduled_at at time zone private.business_timezone();
  local_end   timestamp := new.ends_at      at time zone private.business_timezone();
begin
  if new.scheduled_at <= now() then
    raise exception 'slot_in_past'
      using errcode = 'P0001', detail = 'Consultations must be booked in the future.';
  end if;

  if date_trunc('hour', new.scheduled_at) <> new.scheduled_at then
    raise exception 'slot_not_on_the_hour'
      using errcode = 'P0001', detail = 'Consultations start on the hour.';
  end if;

  if not exists (
    select 1
    from public.tutor_availability a
    where a.tutor_id = new.tutor_id
      and a.iso_weekday = extract(isodow from local_start)
      and local_start::time >= a.start_time
      and local_end::date = local_start::date
      and local_end::time <= a.end_time
  ) then
    raise exception 'tutor_unavailable'
      using errcode = 'P0001',
            detail = 'The tutor does not work at the selected time.';
  end if;

  return new;
end;
$$;

-- Runs after consultations_set_ends_at (triggers fire in name order).
create trigger consultations_validate_booking
  before insert or update of scheduled_at, tutor_id on public.consultations
  for each row execute function private.validate_consultation_booking();

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on public.subjects           from anon, authenticated;
revoke all on public.tutor_subjects     from anon, authenticated;
revoke all on public.tutor_availability from anon, authenticated;

grant select on public.subjects           to authenticated;
grant select on public.tutor_subjects     to authenticated;
grant select on public.tutor_availability to authenticated;

-- Students now choose a subject and tutor when booking, and may switch tutor
-- (within the same subject, enforced by the composite FK) when rescheduling.
grant insert (subject_id, tutor_id) on public.consultations to authenticated;
grant update (tutor_id)             on public.consultations to authenticated;

alter table public.subjects           enable row level security;
alter table public.tutor_subjects     enable row level security;
alter table public.tutor_availability enable row level security;

-- Reference data: readable by any signed-in user, writable by no API user.
create policy "subjects: read for signed-in users"
  on public.subjects for select to authenticated using (true);
create policy "tutor_subjects: read for signed-in users"
  on public.tutor_subjects for select to authenticated using (true);
create policy "tutor_availability: read for signed-in users"
  on public.tutor_availability for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- consultations policies, rewritten for three roles
-- -----------------------------------------------------------------------------
drop policy "consultations: read own or admin"              on public.consultations;
drop policy "consultations: insert own"                     on public.consultations;
drop policy "consultations: update own while not cancelled" on public.consultations;

-- Students see their bookings, tutors see bookings with them, admins see all.
create policy "consultations: read as student, tutor, or admin"
  on public.consultations for select
  to authenticated
  using (
    student_id = (select auth.uid())
    or tutor_id = (select auth.uid())
    or (select private.current_user_role()) = 'admin'
  );

-- Only students book, only for themselves, only in the open state.
create policy "consultations: students insert own"
  on public.consultations for insert
  to authenticated
  with check (
    (select private.current_user_role()) = 'student'
    and student_id = (select auth.uid())
    and completed_at is null
    and cancelled_at is null
  );

-- Students update their own consultations until cancelled. A consultation can
-- only be completed once it has ended (D16).
create policy "consultations: students update own while not cancelled"
  on public.consultations for update
  to authenticated
  using (
    student_id = (select auth.uid())
    and cancelled_at is null
  )
  with check (
    student_id = (select auth.uid())
    and (completed_at is null or ends_at <= now())
  );

drop function private.is_admin();

-- -----------------------------------------------------------------------------
-- Free slots (D25): the only way a student learns about other students'
-- bookings, so it returns no student data, just (tutor, slot start).
-- SECURITY DEFINER because RLS hides other students' consultations.
-- The window is capped so the query stays bounded.
-- -----------------------------------------------------------------------------
create function public.get_free_slots(
  p_subject_id uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns table (tutor_id uuid, slot_start timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text := private.business_timezone();
begin
  if p_subject_id is null or p_from is null or p_to is null then
    raise exception 'invalid_range' using errcode = 'P0001',
      detail = 'subject, from and to are required.';
  end if;
  if p_to <= p_from or p_to - p_from > interval '31 days' then
    raise exception 'invalid_range' using errcode = 'P0001',
      detail = 'The range must be positive and at most 31 days.';
  end if;

  return query
  with days as (
    select d::date as day
    from generate_series(
      (p_from at time zone tz)::date,
      (p_to   at time zone tz)::date,
      interval '1 day'
    ) d
  ),
  candidates as (
    select a.tutor_id,
           ((dy.day + make_interval(hours => h)) at time zone tz) as slot_start
    from public.tutor_subjects ts
    join public.tutor_availability a on a.tutor_id = ts.tutor_id
    join days dy on extract(isodow from dy.day) = a.iso_weekday
    cross join lateral generate_series(
      extract(hour from a.start_time)::int,
      extract(hour from a.end_time)::int - 1
    ) h
    where ts.subject_id = p_subject_id
  )
  select c.tutor_id, c.slot_start
  from candidates c
  where c.slot_start >= greatest(p_from, now())
    and c.slot_start <  p_to
    and not exists (
      select 1
      from public.consultations x
      where x.tutor_id = c.tutor_id
        and x.cancelled_at is null
        and tstzrange(x.scheduled_at, x.ends_at, '[)')
            && tstzrange(c.slot_start, c.slot_start + private.slot_duration(), '[)')
    )
  order by c.slot_start, c.tutor_id;
end;
$$;

revoke all on function public.get_free_slots(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_free_slots(uuid, timestamptz, timestamptz) to authenticated;
