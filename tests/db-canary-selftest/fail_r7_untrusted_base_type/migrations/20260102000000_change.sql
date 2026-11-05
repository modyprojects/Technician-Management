-- Review round 1 follow-up: pg_tle lets postgres create a base type whose output function is
-- ordinary code. This one shows only the text before "|", so a value stored as
-- "fictional|<data>" would read as "fictional" in the snapshot. Such a type fails the check
-- before any column uses it.
create extension if not exists pg_tle;
select pgtle.create_shell_type('public', 'clipped_text');
create function public.clipped_text_in(input text) returns bytea immutable strict language plpgsql
  set search_path = '' as $$ begin return pg_catalog.convert_to(input, 'UTF8'); end $$;
create function public.clipped_text_out(input bytea) returns text immutable strict language plpgsql
  set search_path = '' as $$ begin return pg_catalog.split_part(pg_catalog.convert_from(input, 'UTF8'), '|', 1); end $$;
select pgtle.create_base_type('public', 'clipped_text', 'public.clipped_text_in(text)'::regprocedure,
  'public.clipped_text_out(bytea)'::regprocedure, -1);
