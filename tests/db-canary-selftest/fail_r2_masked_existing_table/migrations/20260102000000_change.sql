-- Review round 1, F5 (a06): a new reference row whose updated_at encodes data, next to one whose
-- updated_at comes from now(). The column is volatile in this step, but only in the now() row:
-- masks are refined per group of rows, so the data-carrying row is compared exactly. (Earlier rows
-- of the table also have a volatile updated_at; masks are per migration step.)
insert into public.settings (key, updated_at)
select 'notes', timestamptz '2000-01-01 00:00:00.25+00' + pg_catalog.count(*) * interval '1.5 second' from public.items;
insert into public.settings (key) values ('notes-history');
