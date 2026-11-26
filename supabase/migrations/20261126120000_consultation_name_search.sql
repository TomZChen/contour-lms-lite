-- Admin search by student name (D45).
--
-- The admin list filters with `first_name ILIKE '%word%' OR last_name ILIKE
-- '%word%'` for each word typed. A leading wildcard can't use a btree index,
-- so add trigram GIN indexes, which serve ILIKE substring matches.

create extension if not exists pg_trgm with schema extensions;

create index consultations_first_name_trgm_idx
  on public.consultations using gin (first_name extensions.gin_trgm_ops);
create index consultations_last_name_trgm_idx
  on public.consultations using gin (last_name extensions.gin_trgm_ops);
