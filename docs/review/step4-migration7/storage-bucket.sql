-- PROPOSED operation (not a migration; never run without the owner's separate approval, D52 rule 4,
-- D53): the private Storage bucket of Migration 7 (20261110120000_field_visit_writers.sql, M7 OQ-4,
-- OQ-5, OQ-6). A bucket is a row in storage.buckets, outside public and private, so it is not in the
-- migration (the canary-rows check refuses it by design, D54 (2)). Run once per project, as postgres,
-- after Migration 7 is applied. Idempotent: an existing bucket of this id is left as it is, and the
-- check below then fails if its settings differ.
-- Settings: private (no public URL; reads only through short-lived signed links the server issues
-- under the user's session, after the storage.objects SELECT policy of Migration 7), at most 10 MiB
-- per object, JPEG, PNG and WebP only (the same limits as visit_media's CHECKs; open decision 4
-- decides the final caps). Objects are named test/... or live/... by the writer (D47).
-- Locally the tests create the same row (tests/db/360 inside its transaction; the local-stack
-- browser tests in their setup).
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-media', 'visit-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from storage.buckets b
                 where b.id = 'visit-media' and b.public is false and b.file_size_limit = 10485760
                   and b.allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']) then
    raise exception 'the bucket visit-media exists with other settings; nothing was changed';
  end if;
end
$$;
commit;
