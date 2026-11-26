-- =============================================================================
-- Initial schema: roles, profiles, consultations
-- See docs/DECISIONS.md (D6-D14) for the reasoning behind each choice.
-- =============================================================================

-- Functions that must not be callable through the PostgREST API live in
-- `private`, which is not in the API's exposed schemas.
create schema if not exists private;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Roles (D6)
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('student', 'admin');

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user, holds the role
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.app_role not null default 'student',
  created_at  timestamptz not null default now()
);

comment on table public.profiles is
  'App-level user data. Rows are created by a trigger on auth.users; the role is never client-writable.';

alter table public.profiles enable row level security;

-- Create a profile for every new auth user. SECURITY DEFINER because the
-- inserting role (supabase_auth_admin) has no rights on public.profiles.
-- Role is always the column default: never read from user metadata.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Is the current user an admin? SECURITY DEFINER so it can read profiles
-- without recursing through profiles' own RLS policies. STABLE so Postgres
-- can cache it; callers wrap it in (select ...) so it runs once per query.
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;
revoke all on function private.handle_new_user() from public;

-- -----------------------------------------------------------------------------
-- consultations (D8-D12)
-- -----------------------------------------------------------------------------
create table public.consultations (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null default auth.uid()
                  references public.profiles (id) on delete cascade,
  first_name    text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name     text not null check (char_length(btrim(last_name))  between 1 and 100),
  reason        text not null check (char_length(btrim(reason))     between 1 and 1000),
  scheduled_at  timestamptz not null,
  completed_at  timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint consultations_not_completed_and_cancelled
    check (completed_at is null or cancelled_at is null)
);

comment on column public.consultations.completed_at is
  'Set when the student marks the consultation complete; null = incomplete.';
comment on column public.consultations.cancelled_at is
  'Soft cancel. Cancelled rows are kept for history and become immutable.';

-- Student dashboard: own consultations ordered by time (also covers the FK).
create index consultations_student_id_scheduled_at_idx
  on public.consultations (student_id, scheduled_at);
-- Admin view: all consultations ordered by time.
create index consultations_scheduled_at_idx
  on public.consultations (scheduled_at);

-- Keep updated_at current.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger consultations_set_updated_at
  before update on public.consultations
  for each row execute function private.set_updated_at();

alter table public.consultations enable row level security;

-- -----------------------------------------------------------------------------
-- Privileges (D12): Supabase grants ALL on public tables to anon and
-- authenticated by default. Revoke that and grant only what is needed, so the
-- column list is enforced by Postgres, not just by the API layer.
-- -----------------------------------------------------------------------------
revoke all on public.profiles      from anon, authenticated;
revoke all on public.consultations from anon, authenticated;

grant select on public.profiles to authenticated;

grant select on public.consultations to authenticated;
grant insert (first_name, last_name, reason, scheduled_at)
  on public.consultations to authenticated;
grant update (scheduled_at, completed_at, cancelled_at)
  on public.consultations to authenticated;
-- No DELETE grant: cancellation is a soft cancel (D8).

-- -----------------------------------------------------------------------------
-- RLS policies (D7)
-- -----------------------------------------------------------------------------

-- profiles: users see their own profile; admins see everyone's.
create policy "profiles: read own or admin"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

-- consultations: students see their own; admins see all (read-only, D14).
create policy "consultations: read own or admin"
  on public.consultations for select
  to authenticated
  using (student_id = (select auth.uid()) or (select private.is_admin()));

-- Students may only create consultations for themselves, in the open state.
create policy "consultations: insert own"
  on public.consultations for insert
  to authenticated
  with check (
    student_id = (select auth.uid())
    and completed_at is null
    and cancelled_at is null
  );

-- Students may update their own consultations until they are cancelled.
create policy "consultations: update own while not cancelled"
  on public.consultations for update
  to authenticated
  using (student_id = (select auth.uid()) and cancelled_at is null)
  with check (student_id = (select auth.uid()));
