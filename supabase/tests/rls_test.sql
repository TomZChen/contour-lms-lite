-- RLS, privilege and booking-rule tests. Run with: npm run db:test
-- Runs inside a transaction that is rolled back, so it leaves no data behind.
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- ---------------------------------------------------------------------------
-- Helpers (in a schema created inside this transaction, callable by API roles)
-- ---------------------------------------------------------------------------
create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated;

-- Act as a given user (what PostgREST does with a JWT).
create function test_helpers.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Run a statement as the current role and return how many rows it affected.
create function test_helpers.affected(stmt text) returns int language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- A slot start: local business date (today + p_days) at p_hour:00.
create function test_helpers.slot(p_days int, p_hour int) returns timestamptz
language sql stable as $$
  select (((now() at time zone 'Australia/Melbourne')::date + p_days)
          + make_interval(hours => p_hour)) at time zone 'Australia/Melbourne';
$$;

grant execute on all functions in schema test_helpers to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures
--   students s1 (…01), s2 (…02); admin (…03); tutors t1 (…11), t2 (…12)
--   subject A is taught by t1 and t2; subject B by nobody.
--   Both tutors work 08:00-20:00 every day.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 's1@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 's2@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'adm@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000011', 't1@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000012', 't2@test.local');

select is(
  (select count(*)::int from public.profiles
   where id::text like 'aaaaaaaa-%' and role = 'student'),
  5, 'trigger creates a student profile for every new auth user');

update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-000000000003';
update public.profiles set role = 'tutor'
  where id in ('aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000012');

insert into public.subjects (id, slug, name) values
  ('bbbbbbbb-0000-0000-0000-00000000000a', 'test-a', 'Test A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'test-b', 'Test B');

insert into public.tutor_subjects (tutor_id, subject_id) values
  ('aaaaaaaa-0000-0000-0000-000000000011', 'bbbbbbbb-0000-0000-0000-00000000000a'),
  ('aaaaaaaa-0000-0000-0000-000000000012', 'bbbbbbbb-0000-0000-0000-00000000000a');

insert into public.tutor_availability (tutor_id, iso_weekday, start_time, end_time)
select t, d, '08:00', '20:00'
from unnest(array['aaaaaaaa-0000-0000-0000-000000000011',
                  'aaaaaaaa-0000-0000-0000-000000000012']::uuid[]) t
cross join generate_series(1, 7) d;

-- c1: s1 with t1, tomorrow 10:00.  c2: s2 with t1, tomorrow 11:00.
insert into public.consultations (id, student_id, subject_id, tutor_id, first_name, last_name, reason, scheduled_at) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000011',
   'S', 'One', 'r', test_helpers.slot(1, 10)),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000011',
   'S', 'Two', 'r', test_helpers.slot(1, 11));

-- c3: s1 with t2, two days ago (historic, so the booking trigger is bypassed).
alter table public.consultations disable trigger consultations_validate_booking;
insert into public.consultations (id, student_id, subject_id, tutor_id, first_name, last_name, reason, scheduled_at) values
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000012',
   'S', 'One', 'past', test_helpers.slot(-2, 10));
alter table public.consultations enable trigger consultations_validate_booking;

select is(
  (select ends_at - scheduled_at from public.consultations
   where id = 'cccccccc-0000-0000-0000-000000000001'),
  interval '1 hour', 'ends_at is derived as scheduled_at + 60 minutes');

select throws_ok($$
  insert into public.tutor_subjects (tutor_id, subject_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000000b') $$,
  '23514', null, 'only tutor profiles can be linked to subjects');

-- ---------------------------------------------------------------------------
-- Anonymous users get nothing
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select * from public.consultations $$, '42501', null,
  'anon cannot read consultations');
select throws_ok($$ select * from public.subjects $$, '42501', null,
  'anon cannot read subjects');
select throws_ok($$
  select * from public.get_free_slots('bbbbbbbb-0000-0000-0000-00000000000a', now(), now() + interval '1 day') $$,
  '42501', null, 'anon cannot call get_free_slots');
reset role;

-- ---------------------------------------------------------------------------
-- Student s1: reading
-- ---------------------------------------------------------------------------
select test_helpers.act_as('aaaaaaaa-0000-0000-0000-000000000001');

select results_eq(
  $$ select id from public.consultations where student_id::text like 'aaaaaaaa-%' order by id $$,
  $$ values ('cccccccc-0000-0000-0000-000000000001'::uuid), ('cccccccc-0000-0000-0000-000000000003'::uuid) $$,
  'student sees only their own consultations');

select results_eq(
  $$ select id from public.profiles where id::text like 'aaaaaaaa-%' order by id $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000001'::uuid),
            ('aaaaaaaa-0000-0000-0000-000000000011'::uuid),
            ('aaaaaaaa-0000-0000-0000-000000000012'::uuid) $$,
  'student sees their own profile and tutor profiles only');

select is(
  (select count(*)::int from public.get_free_slots(
     'bbbbbbbb-0000-0000-0000-00000000000a', test_helpers.slot(1, 10), test_helpers.slot(1, 12))
   where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000011'),
  0, 'get_free_slots hides slots booked by any student (t1 is booked out 10-12)');

select is(
  (select count(*)::int from public.get_free_slots(
     'bbbbbbbb-0000-0000-0000-00000000000a', test_helpers.slot(1, 10), test_helpers.slot(1, 12))
   where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000012'),
  2, 'get_free_slots returns the free alternative tutor (t2) for the same subject');

select throws_ok($$
  select * from public.get_free_slots('bbbbbbbb-0000-0000-0000-00000000000a', now(), now() + interval '60 days') $$,
  'P0001', 'invalid_range', 'get_free_slots caps the query window');

-- ---------------------------------------------------------------------------
-- Student s1: booking rules
-- ---------------------------------------------------------------------------
select lives_ok(format($$
  insert into public.consultations (subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000012',
          'S', 'One', 'new booking', %L) $$, test_helpers.slot(3, 9)),
  'student can book a free slot (student_id defaults to auth.uid())');

select throws_ok(format($$
  insert into public.consultations (subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000011',
          'S', 'One', 'clash', %L) $$, test_helpers.slot(1, 11)),
  '23P01', null, 'a tutor cannot be double-booked');

select throws_ok(format($$
  insert into public.consultations (subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000012',
          'S', 'One', 'self clash', %L) $$, test_helpers.slot(1, 10)),
  '23P01', null, 'a student cannot be in two consultations at once');

select throws_ok(format($$
  insert into public.consultations (subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000012',
          'S', 'One', 'past', %L) $$, test_helpers.slot(-1, 10)),
  'P0001', 'slot_in_past', 'cannot book in the past');

select throws_ok(format($$
  insert into public.consultations (subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000012',
          'S', 'One', 'odd time', %L) $$, test_helpers.slot(4, 9) + interval '30 minutes'),
  'P0001', 'slot_not_on_the_hour', 'bookings must start on the hour');

select throws_ok(format($$
  insert into public.consultations (subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000012',
          'S', 'One', 'late', %L) $$, test_helpers.slot(4, 21)),
  'P0001', 'tutor_unavailable', 'cannot book outside the tutor''s availability');

select throws_ok(format($$
  insert into public.consultations (subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000012',
          'S', 'One', 'wrong subject', %L) $$, test_helpers.slot(4, 9)),
  '23503', null, 'cannot book a tutor for a subject they do not teach');

select throws_ok(format($$
  insert into public.consultations (student_id, subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
  values ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-00000000000a',
          'aaaaaaaa-0000-0000-0000-000000000012', 'X', 'Y', 'spoof', %L) $$, test_helpers.slot(5, 9)),
  '42501', null, 'student cannot book on behalf of another student');

select throws_ok(format($$
  insert into public.consultations (subject_id, tutor_id, first_name, last_name, reason, scheduled_at, completed_at)
  values ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000012',
          'S', 'One', 'r', %L, now()) $$, test_helpers.slot(5, 9)),
  '42501', null, 'student cannot insert lifecycle columns directly');

-- ---------------------------------------------------------------------------
-- Student s1: managing consultations
-- ---------------------------------------------------------------------------
select throws_ok($$
  update public.consultations set student_id = 'aaaaaaaa-0000-0000-0000-000000000002'
  where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '42501', null, 'student cannot reassign a consultation to someone else');

select throws_ok($$ update public.profiles set role = 'admin' $$,
  '42501', null, 'student cannot escalate their own role');

select is(test_helpers.affected(format($$
  update public.consultations set scheduled_at = %L
  where id = 'cccccccc-0000-0000-0000-000000000002' $$, test_helpers.slot(6, 9))),
  0, 'student cannot reschedule another student''s consultation');

select is(test_helpers.affected(format($$
  update public.consultations set scheduled_at = %L, tutor_id = 'aaaaaaaa-0000-0000-0000-000000000012'
  where id = 'cccccccc-0000-0000-0000-000000000001' $$, test_helpers.slot(2, 15))),
  1, 'student can reschedule own consultation (and switch tutor within the subject)');

select throws_ok($$
  update public.consultations set completed_at = now()
  where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '42501', null, 'student cannot mark a consultation complete before it has ended');

select is(test_helpers.affected($$
  update public.consultations set completed_at = now()
  where id = 'cccccccc-0000-0000-0000-000000000003' $$),
  1, 'student can mark a past consultation complete');

select is(test_helpers.affected($$
  update public.consultations set completed_at = null
  where id = 'cccccccc-0000-0000-0000-000000000003' $$),
  1, 'student can mark a consultation incomplete again');

select throws_ok($$ delete from public.consultations $$,
  '42501', null, 'nobody can hard-delete consultations');

select is(test_helpers.affected($$
  update public.consultations set cancelled_at = now()
  where id = 'cccccccc-0000-0000-0000-000000000001' $$),
  1, 'student can cancel own consultation');

select is(test_helpers.affected(format($$
  update public.consultations set cancelled_at = null, scheduled_at = %L
  where id = 'cccccccc-0000-0000-0000-000000000001' $$, test_helpers.slot(7, 9))),
  0, 'cancelled consultations are immutable');

select lives_ok(format($$
  insert into public.consultations (subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000012',
          'S', 'One', 'rebook', %L) $$, test_helpers.slot(2, 15)),
  'a cancelled slot can be booked again');

reset role;

-- ---------------------------------------------------------------------------
-- Tutor t1
-- ---------------------------------------------------------------------------
select test_helpers.act_as('aaaaaaaa-0000-0000-0000-000000000011');

select results_eq(
  $$ select id from public.consultations where student_id::text like 'aaaaaaaa-%' order by id $$,
  $$ values ('cccccccc-0000-0000-0000-000000000002'::uuid) $$,
  'tutor sees only consultations booked with them');

select throws_ok(format($$
  insert into public.consultations (subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000011',
          'T', 'One', 'self', %L) $$, test_helpers.slot(5, 9)),
  '42501', null, 'tutors cannot book consultations');

select is(test_helpers.affected($$
  update public.consultations set cancelled_at = now()
  where id = 'cccccccc-0000-0000-0000-000000000002' $$),
  0, 'tutor view is read-only');

reset role;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
select test_helpers.act_as('aaaaaaaa-0000-0000-0000-000000000003');

select is(
  (select count(*)::int from public.consultations where student_id::text like 'aaaaaaaa-%'),
  5, 'admin sees consultations of all students');

select is(test_helpers.affected($$
  update public.consultations set cancelled_at = now()
  where id = 'cccccccc-0000-0000-0000-000000000002' $$),
  0, 'admin view is read-only (cannot cancel another student''s consultation)');

reset role;

-- ---------------------------------------------------------------------------
-- Data integrity
-- ---------------------------------------------------------------------------
select throws_ok($$
  update public.consultations set completed_at = now(), cancelled_at = now()
  where id = 'cccccccc-0000-0000-0000-000000000002' $$,
  '23514', null, 'a consultation cannot be both completed and cancelled');

select throws_ok($$
  insert into public.tutor_availability (tutor_id, iso_weekday, start_time, end_time)
  values ('aaaaaaaa-0000-0000-0000-000000000011', 1, '07:00', '09:00') $$,
  '23514', null, 'availability must be within business hours 08:00-20:00');

select * from finish();
rollback;
