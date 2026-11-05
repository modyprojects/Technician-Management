-- PR 1.3: test-data census (D47; docs/database-schema.md §2; docs/testing.md category 12).
-- The first checks run before any fixture, on the database built from migrations alone.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Fresh database (migrations only): census 0 ------------------------------------------------------
select is((select sum(test_rows) from public.test_data_census()), 0::numeric,
  'a database built from migrations alone has a census of 0 (D47)');
-- Generic (review S2): every table in public and private, including those that later migrations
-- add, is empty except the owner-approved reference data, with exact counts. The list grows with
-- each reference-data migration (D48 call_types and followup_reasons in PR 1.4).
select results_eq(
  $$ select c.relname::text collate "default", x.row_count
     from pg_class c
     join pg_namespace s on s.oid = c.relnamespace
     cross join lateral (
       select (xpath('/row/n/text()',
                     query_to_xml(format('select count(*) as n from %I.%I', s.nspname, c.relname), false, true, '')))[1]::text::bigint
              as row_count) x
     where s.nspname in ('public', 'private') and c.relkind in ('r', 'p') and x.row_count <> 0
     order by c.relname::text collate "C" $$,
  $$ values ('permissions', 13::bigint), ('role_permissions', 26::bigint) $$,
  'migrations create no rows in any table except the approved reference data: 13 keys and 26 TEMPORARY values (D47, D49, D51)');
-- Views too (verification round 2, F1): a view can carry constant fictitious rows without any table
-- row (create view ... as select * from (values (...))). Every view (and materialized view) in
-- public and private returns no rows on the fresh database, except approved reference views: none
-- in PR 1.3 (010_hardening also requires no views today; this check stays when views are approved).
-- A function that returns constant rows cannot be counted generically: the review checks it.
select results_eq(
  $$ select c.relname::text collate "default", x.row_count
     from pg_class c
     join pg_namespace s on s.oid = c.relnamespace
     cross join lateral (
       select (xpath('/row/n/text()',
                     query_to_xml(format('select count(*) as n from %I.%I', s.nspname, c.relname), false, true, '')))[1]::text::bigint
              as row_count) x
     where s.nspname in ('public', 'private') and c.relkind in ('v', 'm') and x.row_count <> 0
     order by c.relname::text collate "C" $$,
  $$ select v.relname, v.row_count from (values ('', 0::bigint)) as v (relname, row_count) where false $$,
  'migrations create no view in public or private that returns rows (approved reference views: none in PR 1.3)');
-- Positive control for the view check: a view with constant rows is counted (rolled back).
create view public.census_view_probe with (security_invoker = true) as
  select * from (values ('10001', 'probe row')) as v (customer_number, name);
select results_eq(
  $$ select c.relname::text collate "default", x.row_count
     from pg_class c
     join pg_namespace s on s.oid = c.relnamespace
     cross join lateral (
       select (xpath('/row/n/text()',
                     query_to_xml(format('select count(*) as n from %I.%I', s.nspname, c.relname), false, true, '')))[1]::text::bigint
              as row_count) x
     where s.nspname in ('public', 'private') and c.relkind in ('v', 'm') and x.row_count <> 0
     order by c.relname::text collate "C" $$,
  $$ values ('census_view_probe'::text, 1::bigint) $$,
  'positive control: a view that returns constant rows is found by the view check');
drop view public.census_view_probe;
select is((select count(*) from auth.users), 0::bigint, 'migrations create no Auth user (no test user, no Creator; D47, D49)');
select is(
  (select case when to_regclass('storage.buckets') is null then 0::bigint
               else (xpath('/row/n/text()', query_to_xml('select count(*) as n from storage.buckets', false, true, '')))[1]::text::bigint
          end),
  0::bigint, 'migrations create no Storage bucket (Step 1 creates nothing in Storage)');

-- Coverage: every table in public and private is in the census, marked or exempt -------------------
select results_eq(
  $$ select table_name from public.test_data_census() where marker <> 'none' order by table_name collate "C" $$,
  $$ select c.relname::text collate "default" from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') order by c.relname::text collate "C" $$,
  'the census covers exactly the tables in public and private');
select results_eq(
  $$ select table_name from public.test_data_census() where marker = 'exempt' order by table_name collate "C" $$,
  $$ values ('permissions'), ('role_permissions') $$,
  'the exemptions are the two configuration tables, as in the smoke test');
select is(
  (select count(*) from public.test_data_census() t
   where t.marker in ('is_test', 'target_is_test')
     and not exists (select 1 from pg_attribute a where a.attrelid = ('public.' || t.table_name)::regclass
                       and a.attname = t.marker and not a.attisdropped)),
  0::bigint, 'every counted table has the marker column the census reads');
select ok(exists (select 1 from public.test_data_census() where table_name = 'storage' and marker = 'none'),
  'the census states that Step 1 has no Storage buckets');

-- Positive control: a test fixture is counted ---------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test', now(), now()
from unnest(array['c1', 'a1', 'b1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true);
select is((select test_rows from public.test_data_census() where table_name = 'profiles'), 2::bigint,
  'positive control: test profiles are counted; the real Creator is not');

-- Who may run it --------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is((select test_rows from public.test_data_census() where table_name = 'profiles'), 2::bigint,
  'the Creator runs the census through the API and sees every row');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.test_data_census() $$, '42501', 'not authorized', 'a Manager cannot run the census');
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select throws_ok($$ select * from public.test_data_census() $$, '42501', 'not authorized',
  'authenticated without a JWT cannot run the census');
reset role;
set local role anon;
select throws_ok($$ select * from public.test_data_census() $$, '42501', null, 'anon cannot execute the census');
reset role;
set local role service_role;
select throws_ok($$ select * from public.test_data_census() $$, '42501', null, 'service_role cannot execute the census');
reset role;

select * from finish();
rollback;
