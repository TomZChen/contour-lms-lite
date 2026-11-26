-- RLS / privilege tests. Run with: npm run db:test
-- Runs in a transaction that is rolled back, so it leaves no data behind.
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures: two students and one admin (profiles created by trigger)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bob@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'root@test.local');

select is(
  (select count(*)::int from public.profiles
   where id::text like 'aaaaaaaa-%' and role = 'student'),
  3, 'trigger creates a student profile for every new auth user');

update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-000000000003';

insert into public.consultations (id, student_id, first_name, last_name, reason, scheduled_at) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Alice', 'A', 'r', now() + interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Bob',   'B', 'r', now() + interval '1 day');

-- Helpers live in a schema created inside this (rolled back) transaction.
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
grant execute on all functions in schema test_helpers to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Anonymous users get nothing
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select * from public.consultations $$, '42501', null,
  'anon cannot read consultations');
reset role;

-- ---------------------------------------------------------------------------
-- Student: Alice
-- ---------------------------------------------------------------------------
select test_helpers.act_as('aaaaaaaa-0000-0000-0000-000000000001');

select results_eq($$ select id from public.consultations $$,
  $$ values ('cccccccc-0000-0000-0000-000000000001'::uuid) $$,
  'student sees only their own consultations');

select is((select count(*)::int from public.profiles), 1,
  'student sees only their own profile');

select lives_ok($$
  insert into public.consultations (first_name, last_name, reason, scheduled_at)
  values ('Alice', 'A', 'new booking', now() + interval '3 days') $$,
  'student can book a consultation (student_id defaults to auth.uid())');

select throws_ok($$
  insert into public.consultations (student_id, first_name, last_name, reason, scheduled_at)
  values ('aaaaaaaa-0000-0000-0000-000000000002', 'X', 'Y', 'spoof', now() + interval '1 day') $$,
  '42501', null, 'student cannot book on behalf of another student');

select throws_ok($$
  insert into public.consultations (first_name, last_name, reason, scheduled_at, completed_at)
  values ('A', 'A', 'r', now() + interval '1 day', now()) $$,
  '42501', null, 'student cannot insert lifecycle columns directly');

select throws_ok($$
  update public.consultations set student_id = 'aaaaaaaa-0000-0000-0000-000000000002'
  where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '42501', null, 'student cannot reassign a consultation to someone else');

select throws_ok($$ update public.profiles set role = 'admin' $$,
  '42501', null, 'student cannot escalate their own role');

-- Update/delete of another student's row silently affects 0 rows under RLS.
select is(
  test_helpers.affected($q$ update public.consultations set scheduled_at = now() + interval '9 days' where id = 'cccccccc-0000-0000-0000-000000000002' $q$),
  0, 'student cannot reschedule another student''s consultation');

select is(
  test_helpers.affected($q$ update public.consultations set completed_at = now() where id = 'cccccccc-0000-0000-0000-000000000001' $q$),
  1, 'student can mark own consultation complete');

select is(
  test_helpers.affected($q$ update public.consultations set completed_at = null where id = 'cccccccc-0000-0000-0000-000000000001' $q$),
  1, 'student can mark own consultation incomplete');

select is(
  test_helpers.affected($q$ update public.consultations set scheduled_at = now() + interval '4 days' where id = 'cccccccc-0000-0000-0000-000000000001' $q$),
  1, 'student can reschedule own consultation');

select throws_ok($$ delete from public.consultations $$,
  '42501', null, 'nobody can hard-delete consultations');

select is(
  test_helpers.affected($q$ update public.consultations set cancelled_at = now() where id = 'cccccccc-0000-0000-0000-000000000001' $q$),
  1, 'student can cancel own consultation');

select is(
  test_helpers.affected($q$ update public.consultations set cancelled_at = null, scheduled_at = now() where id = 'cccccccc-0000-0000-0000-000000000001' $q$),
  0, 'cancelled consultations are immutable');

reset role;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
select test_helpers.act_as('aaaaaaaa-0000-0000-0000-000000000003');

select ok(
  (select count(*) from public.consultations
   where student_id::text like 'aaaaaaaa-%') = 3,
  'admin sees consultations of all students');

select is(
  test_helpers.affected($q$ update public.consultations set scheduled_at = now() where id = 'cccccccc-0000-0000-0000-000000000002' $q$),
  0, 'admin view is read-only (cannot modify other students'' consultations)');

reset role;

-- ---------------------------------------------------------------------------
-- Data integrity
-- ---------------------------------------------------------------------------
select throws_ok($$
  update public.consultations set completed_at = now(), cancelled_at = now()
  where id = 'cccccccc-0000-0000-0000-000000000002' $$,
  '23514', null, 'a consultation cannot be both completed and cancelled');

select * from finish();
rollback;
