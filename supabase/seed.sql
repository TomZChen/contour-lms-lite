-- =============================================================================
-- LOCAL DEVELOPMENT SEED ONLY. Never run against production.
-- Creates demo accounts (password for both: password123):
--   admin@example.com    role = admin
--   student@example.com  role = student
-- and a few consultations for the student.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- auth.users rows (token columns must be '' rather than null for GoTrue).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'admin@example.com',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'student@example.com',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

-- Profiles were created by the on_auth_user_created trigger; promote the admin.
-- This is the same out-of-band step an operator would run in production (D13).
update public.profiles set role = 'admin'
where id = '11111111-1111-1111-1111-111111111111';

insert into public.consultations
  (student_id, first_name, last_name, reason, scheduled_at, completed_at, cancelled_at)
values
  ('22222222-2222-2222-2222-222222222222', 'Sam', 'Student',
   'Review of assignment 1 feedback', now() + interval '2 days', null, null),
  ('22222222-2222-2222-2222-222222222222', 'Sam', 'Student',
   'Course selection advice', now() - interval '5 days', now() - interval '5 days', null),
  ('22222222-2222-2222-2222-222222222222', 'Sam', 'Student',
   'Exam preparation', now() + interval '7 days', null, now());
