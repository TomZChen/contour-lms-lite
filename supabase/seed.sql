-- =============================================================================
-- LOCAL DEVELOPMENT SEED ONLY. Never run against production.
-- All accounts use the password: password123
--
--   admin@example.com              admin
--   student@example.com            student (Sam Student)
--   riley@example.com              student (Riley Example, other bookings)
--   <first>.<last>@tutors.example.com   15 tutors (names are fictional)
--
-- Demo scenario: Marcus Lindqvist (Specialist Math) is fully booked for the
-- next 14 days, so students are steered to Chloe Nguyen instead.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Helper (session-only) to create a confirmed email/password user.
create function pg_temp.create_user(p_id uuid, p_email text)
returns void language sql as $$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), p_id, p_id::text,
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
    'email', now(), now(), now()
  );
$$;

-- -----------------------------------------------------------------------------
-- Admin and students (profiles are created by the on_auth_user_created trigger)
-- -----------------------------------------------------------------------------
select pg_temp.create_user('11111111-1111-1111-1111-111111111111', 'admin@example.com');
select pg_temp.create_user('22222222-2222-2222-2222-222222222222', 'student@example.com');
select pg_temp.create_user('33333333-3333-3333-3333-333333333333', 'riley@example.com');

-- Promotion to admin is an out-of-band operator step (D13).
update public.profiles set role = 'admin', full_name = 'Ada Admin'
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set full_name = 'Sam Student'
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set full_name = 'Riley Example'
  where id = '33333333-3333-3333-3333-333333333333';

-- -----------------------------------------------------------------------------
-- Subjects
-- -----------------------------------------------------------------------------
insert into public.subjects (slug, name) values
  ('biology',         'Biology'),
  ('ucat',            'UCAT'),
  ('math-methods',    'Math Methods'),
  ('specialist-math', 'Specialist Math'),
  ('physics',         'Physics'),
  ('chemistry',       'Chemistry');

-- -----------------------------------------------------------------------------
-- Tutors: 2-3 per subject, fictional names
-- -----------------------------------------------------------------------------
create temp table seed_tutors (full_name text, subject_slug text, id uuid default gen_random_uuid());
insert into seed_tutors (full_name, subject_slug) values
  ('Priya Raman',       'biology'),
  ('Oliver Brennan',    'biology'),
  ('Mei Tanaka',        'biology'),
  ('Daniel Okafor',     'ucat'),
  ('Sophie Laurent',    'ucat'),
  ('Lucas Ferreira',    'math-methods'),
  ('Hannah Whitfield',  'math-methods'),
  ('Arjun Mehta',       'math-methods'),
  ('Chloe Nguyen',      'specialist-math'),
  ('Marcus Lindqvist',  'specialist-math'),
  ('Isabella Rossi',    'physics'),
  ('Ethan Kowalski',    'physics'),
  ('Amara Sesay',       'physics'),
  ('Noah Petersen',     'chemistry'),
  ('Zara Haddad',       'chemistry');

select pg_temp.create_user(
  t.id,
  lower(replace(t.full_name, ' ', '.')) || '@tutors.example.com'
) from seed_tutors t;

update public.profiles p
  set role = 'tutor', full_name = t.full_name
  from seed_tutors t where p.id = t.id;

insert into public.tutor_subjects (tutor_id, subject_id)
select t.id, s.id
from seed_tutors t join public.subjects s on s.slug = t.subject_slug;

-- -----------------------------------------------------------------------------
-- Weekly availability: random but reproducible (fixed seed). Each tutor works
-- each day with ~60% probability, in one 3-6 hour window between 08:00-20:00.
-- -----------------------------------------------------------------------------
select setseed(0.42);

insert into public.tutor_availability (tutor_id, iso_weekday, start_time, end_time)
select tutor_id, iso_weekday,
       make_time(start_hour, 0, 0),
       make_time(least(start_hour + len, 20), 0, 0)
from (
  select t.id as tutor_id, d as iso_weekday,
         random() as r_work,
         8 + floor(random() * 9)::int as start_hour, -- 08..16
         3 + floor(random() * 4)::int as len         -- 3..6 hours
  from (select id, full_name from seed_tutors order by full_name) t
  cross join generate_series(1, 7) d
  order by t.full_name, d
) x
where r_work < 0.6;

-- Make sure every tutor has at least one window.
insert into public.tutor_availability (tutor_id, iso_weekday, start_time, end_time)
select t.id, 6, time '10:00', time '14:00'
from seed_tutors t
where not exists (select 1 from public.tutor_availability a where a.tutor_id = t.id);

-- -----------------------------------------------------------------------------
-- Bookings. These go through the normal booking validation trigger.
-- -----------------------------------------------------------------------------

-- Riley fills every free slot Marcus has in the next 14 days -> "booked out".
-- (Riley's own overlap constraint is fine: Marcus's slots never overlap.)
insert into public.consultations
  (student_id, subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
select '33333333-3333-3333-3333-333333333333', s.id, f.tutor_id,
       'Riley', 'Example', 'Specialist Math revision', f.slot_start
from public.subjects s
cross join lateral public.get_free_slots(s.id, now(), now() + interval '14 days') f
join seed_tutors t on t.id = f.tutor_id
where s.slug = 'specialist-math' and t.full_name = 'Marcus Lindqvist';

-- Sam: two upcoming bookings (one later cancelled), with different tutors.
insert into public.consultations
  (student_id, subject_id, tutor_id, first_name, last_name, reason, scheduled_at)
select '22222222-2222-2222-2222-222222222222', f.subject_id, f.tutor_id,
       'Sam', 'Student', f.reason, f.slot_start
from (
  select s.id as subject_id, x.tutor_id, x.slot_start, r.reason,
         row_number() over (partition by s.id order by x.slot_start) as rn
  from (values ('biology', 'Review of assignment 1 feedback'),
               ('chemistry', 'Exam preparation')) r(slug, reason)
  join public.subjects s on s.slug = r.slug
  cross join lateral public.get_free_slots(s.id, now() + interval '2 days', now() + interval '16 days') x
) f
where f.rn = 1;

update public.consultations set cancelled_at = now()
where student_id = '22222222-2222-2222-2222-222222222222'
  and reason = 'Exam preparation';

-- Historic (past) consultation. The booking trigger rejects past times by
-- design, so it is disabled for this one insert of historic data.
alter table public.consultations disable trigger consultations_validate_booking;

insert into public.consultations
  (student_id, subject_id, tutor_id, first_name, last_name, reason, scheduled_at, completed_at)
select '22222222-2222-2222-2222-222222222222', s.id, t.id,
       'Sam', 'Student', 'Course selection advice',
       date_trunc('hour', now()) - interval '5 days',
       now() - interval '5 days'
from public.subjects s
join seed_tutors t on t.subject_slug = s.slug
where s.slug = 'math-methods' and t.full_name = 'Lucas Ferreira';

alter table public.consultations enable trigger consultations_validate_booking;
