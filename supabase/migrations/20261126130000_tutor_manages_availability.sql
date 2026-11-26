-- Tutors manage their own weekly availability (D46).
--
-- * public.set_my_availability(windows) replaces the calling tutor's week in
--   one transaction. It is the only write path: tutors get no INSERT/DELETE
--   grant on tutor_availability, so the rules below can't be bypassed through
--   the PostgREST table endpoint.
-- * Removing hours that hold a future scheduled session is refused with
--   'availability_conflict' (the student's booking is never left outside the
--   tutor's hours). The conflicting sessions are returned in the error detail.
-- * A booking and an availability change for the same tutor are serialised
--   with a transaction-scoped advisory lock, so neither can slip past the
--   other's check. Bookings take it shared (they don't block each other);
--   availability changes take it exclusive.

-- Lock key for "this tutor's availability". Advisory locks need no table
-- privileges, unlike SELECT ... FOR SHARE, which needs UPDATE.
create function private.lock_tutor_availability(p_tutor_id uuid, p_exclusive boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_exclusive then
    perform pg_advisory_xact_lock(20261126, hashtext(p_tutor_id::text));
  else
    perform pg_advisory_xact_lock_shared(20261126, hashtext(p_tutor_id::text));
  end if;
end;
$$;

revoke all on function private.lock_tutor_availability(uuid, boolean) from public;
grant execute on function private.lock_tutor_availability(uuid, boolean) to authenticated;

-- Booking rules (D23), unchanged except for taking the shared lock before the
-- availability check. Each statement in this volatile function takes a fresh
-- snapshot, so after waiting for a concurrent availability change the check
-- sees the tutor's new hours.
create or replace function private.validate_consultation_booking()
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

  perform private.lock_tutor_availability(new.tutor_id, false);

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

-- Replace the calling tutor's weekly availability.
--   p_windows: [{"weekday": 1-7, "start": "09:00", "end": "12:00"}, ...]
-- The table's constraints still apply (business hours, on the hour, no
-- overlap). SECURITY DEFINER because tutors have no direct write grant.
create function public.set_my_availability(p_windows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tutor_id  uuid := auth.uid();
  v_tz        text := private.business_timezone();
  v_conflicts jsonb;
begin
  if v_tutor_id is null or private.current_user_role() is distinct from 'tutor' then
    raise exception 'Only tutors can set availability.' using errcode = '42501';
  end if;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' then
    raise exception 'invalid_availability'
      using errcode = 'P0001', detail = 'windows must be a JSON array.';
  end if;

  perform private.lock_tutor_availability(v_tutor_id, true);

  delete from public.tutor_availability where tutor_id = v_tutor_id;

  insert into public.tutor_availability (tutor_id, iso_weekday, start_time, end_time)
  select v_tutor_id, w.weekday, w."start", w."end"
  from jsonb_to_recordset(p_windows) as w(weekday smallint, "start" time, "end" time);

  -- Future scheduled sessions no longer inside any window (same rule as the
  -- booking trigger).
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'scheduledAt', c.scheduled_at)
                            order by c.scheduled_at), '[]'::jsonb)
    into v_conflicts
  from public.consultations c
  where c.tutor_id = v_tutor_id
    and c.cancelled_at is null
    and c.completed_at is null
    and c.scheduled_at > now()
    and not exists (
      select 1
      from public.tutor_availability a
      where a.tutor_id = v_tutor_id
        and a.iso_weekday = extract(isodow from c.scheduled_at at time zone v_tz)
        and (c.scheduled_at at time zone v_tz)::time >= a.start_time
        and (c.ends_at at time zone v_tz)::date = (c.scheduled_at at time zone v_tz)::date
        and (c.ends_at at time zone v_tz)::time <= a.end_time
    );

  if jsonb_array_length(v_conflicts) > 0 then
    -- Rolls back the delete and insert above.
    raise exception 'availability_conflict'
      using errcode = 'P0001', detail = v_conflicts::text;
  end if;
end;
$$;

revoke all on function public.set_my_availability(jsonb) from public, anon;
grant execute on function public.set_my_availability(jsonb) to authenticated;
