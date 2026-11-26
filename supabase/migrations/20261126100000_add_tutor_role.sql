-- Add the tutor role (D19). Kept in its own migration because Postgres does not
-- allow a newly added enum value to be used in the same transaction.
alter type public.app_role add value if not exists 'tutor';
