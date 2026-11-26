-- Direct foreign keys from consultations to the tutor's profile and to the
-- subject. Integrity is already guaranteed by the composite FK to
-- tutor_subjects; these let PostgREST embed tutor/subject details in API
-- responses (it needs a single-column FK to resolve the relationship), and
-- they keep history: a tutor/subject with consultations cannot be deleted.
alter table public.consultations
  add constraint consultations_tutor_id_fkey
    foreign key (tutor_id) references public.profiles (id) on delete restrict,
  add constraint consultations_subject_id_fkey
    foreign key (subject_id) references public.subjects (id) on delete restrict;
