-- PR 1.3: test-data census (D47; docs/database-schema.md §2; docs/testing.md category 12).
-- The first checks run before any fixture, on the database built from migrations alone.
-- PR 1.4: the census covers the seven new tables (customers and products per source, in fixed
-- bucket rows), and the D48 initial values are the only new rows on a fresh database.
-- PR 1.5: the census covers the seven service-call and visit tables (service_calls per source, the
-- six child and history tables in one 'all sources' row each: 9 new rows), and the view
-- visit_time_current returns no rows on a fresh database.
-- PR 1.6: the census covers review_items, visit_corrections and offline_operations (one 'all
-- sources' row each: 3 new rows), 0 on a fresh database, and counts a test row in each.
-- PR 1.8: no new table (the deletion columns are on profiles, which the census already counts);
-- the reference data grows by the 3 D60 (8) keys and their 6 TEMPORARY values (16 keys, 32 values).
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Fresh database (migrations only): census 0 ------------------------------------------------------
select is((select sum(test_rows) from public.test_data_census()), 0::numeric,
  'a database built from migrations alone has a census of 0 (D47)');
-- Generic (review S2): every table in public and private, including those that later migrations
-- add, is empty except the owner-approved reference data, with exact counts. The list grows with
-- each reference-data migration (PR 1.4: the D48 call_types and followup_reasons).
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
  $$ values ('call_types', 2::bigint), ('followup_reasons', 5::bigint), ('permissions', 16::bigint), ('role_permissions', 32::bigint) $$,
  'migrations create no rows in any table except the approved reference data: 2 call types and 5 reasons (D48), 16 keys and 32 TEMPORARY values (D33, D60 (8); D47, D49, D51)');
select ok(
  (select count(*) from public.call_types where not is_test and created_by is null and is_active and version = 1) = 2
  and (select count(*) from public.followup_reasons where not is_test and created_by is null and is_active and not is_user_added
       and version = 1) = 5
  and (select test_rows from public.test_data_census() where table_name = 'call_types') = 0
  and (select test_rows from public.test_data_census() where table_name = 'followup_reasons') = 0,
  'PR 1.4: the D48 rows are real (is_test false, no creator) and the census does not count them');
select results_eq(
  $$ select table_name, bucket, test_rows from public.test_data_census()
     where table_name in ('service_calls', 'visits', 'visit_reports', 'visit_signatures', 'visit_time_reports',
                          'visit_events', 'entity_changes')
     order by table_name collate "C", bucket collate "C" $$,
  $$ values ('entity_changes', 'all sources', 0::bigint),
            ('service_calls', 'automated_test', 0::bigint), ('service_calls', 'other sources', 0::bigint),
            ('service_calls', 'simulator', 0::bigint),
            ('visit_events', 'all sources', 0::bigint), ('visit_reports', 'all sources', 0::bigint),
            ('visit_signatures', 'all sources', 0::bigint), ('visit_time_reports', 'all sources', 0::bigint),
            ('visits', 'all sources', 0::bigint) $$,
  'PR 1.5: the nine new census rows exist (service_calls per source in fixed rows, one row for each child and history table) and are 0 on a fresh database');
select results_eq(
  $$ select table_name, bucket, test_rows from public.test_data_census()
     where table_name in ('review_items', 'visit_corrections', 'offline_operations')
     order by table_name collate "C", bucket collate "C" $$,
  $$ values ('offline_operations'::text, 'all sources'::text, 0::bigint), ('review_items', 'all sources', 0::bigint),
            ('visit_corrections', 'all sources', 0::bigint) $$,
  'PR 1.6: the three new census rows exist (one row each) and are 0 on a fresh database');
-- Views too (verification round 2, F1): a view can carry constant fictitious rows without any table
-- row (create view ... as select * from (values (...))). Every view (and materialized view) in
-- public and private returns no rows on the fresh database, except approved reference views: none
-- in PR 1.3 (010_hardening allows only the PR 1.5 view visit_time_current, a SECURITY INVOKER view
-- over visit_time_reports, which this check also reads; it stays when reference views are approved).
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
select ok(
  to_regclass('public.visit_time_current') is not null
  and (select count(*) from public.visit_time_current) = 0
  and (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind in ('v', 'm')) = 1,
  'PR 1.5: the only view, visit_time_current, exists, is read by the view check above and returns no rows on a fresh database');
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
  $$ select x.table_name from (select distinct c.table_name from public.test_data_census() c where c.marker <> 'none') x
     order by x.table_name collate "C" $$,
  $$ select c.relname::text collate "default" from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') order by c.relname::text collate "C" $$,
  'the census covers exactly the tables in public and private');
-- The coverage check reads distinct table names (customers and products have one row per source),
-- so a table listed twice is caught here instead (independent review TEST-3).
select is(
  (select count(*) from public.test_data_census()),
  (select count(*) from (select distinct c.table_name, c.bucket from public.test_data_census() c) d),
  'the census lists each table and bucket once (no duplicate row)');
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
select results_eq(
  $$ select table_name, bucket from public.test_data_census() where table_name in ('customers', 'products')
     order by table_name collate "C", bucket collate "C" $$,
  $$ values ('customers', 'automated_test'), ('customers', 'other sources'), ('customers', 'simulator'),
            ('products', 'automated_test'), ('products', 'other sources'), ('products', 'simulator') $$,
  'PR 1.4: customers and products are counted per source in fixed rows, also when empty (database-schema.md §2)');
select results_eq(
  $$ select table_name, bucket from public.test_data_census()
     where table_name in ('service_calls', 'visits', 'visit_reports', 'visit_signatures', 'visit_time_reports',
                          'visit_events', 'entity_changes')
     order by table_name collate "C", bucket collate "C" $$,
  $$ values ('entity_changes', 'all sources'), ('service_calls', 'automated_test'), ('service_calls', 'other sources'),
            ('service_calls', 'simulator'), ('visit_events', 'all sources'), ('visit_reports', 'all sources'),
            ('visit_signatures', 'all sources'), ('visit_time_reports', 'all sources'), ('visits', 'all sources') $$,
  'PR 1.5: service_calls is counted per source in fixed rows; visits and every visit_* and history table in one row each');
select results_eq(
  $$ select table_name, marker, bucket from public.test_data_census()
     where table_name in ('review_items', 'visit_corrections', 'offline_operations')
     order by table_name collate "C" $$,
  $$ values ('offline_operations'::text, 'is_test'::text, 'all sources'::text), ('review_items', 'is_test', 'all sources'),
            ('visit_corrections', 'is_test', 'all sources') $$,
  'PR 1.6: review_items, visit_corrections and offline_operations are counted by is_test in one row each');

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

-- PR 1.4 positive control: one test row in each new table (inserted as postgres; every CHECK and
-- trigger applies), per source for customers and products. Fictional values only.
insert into public.brands (name, created_by) values ('מותג בדיקה', '00000000-0000-4000-8000-0000000000a1');
insert into public.suppliers (name, created_by) values ('ספק בדיקה', '00000000-0000-4000-8000-0000000000a1');
insert into public.products (sku_display, sku_normalized, name, data_source, source_ref, created_by) values
  ('tb-1001', 'TB-1001', 'מוצר בדיקה א', 'simulator', 'sim-evt-1', '00000000-0000-4000-8000-0000000000a1'),
  ('tb-1002', 'TB-1002', 'מוצר בדיקה ב', 'automated_test', 'run-070', null);
insert into public.customers (customer_number, name, phone, data_source, source_ref, created_by) values
  ('T-0001', 'לקוח בדיקה א', '050-000-0001', 'simulator', 'sim-evt-1', '00000000-0000-4000-8000-0000000000a1'),
  ('T-0002', 'לקוח בדיקה ב', '050-000-0002', 'automated_test', 'run-070', null);
insert into public.call_types (label_he, sort_order, is_test, created_by) values ('סוג בדיקה', 3, true, '00000000-0000-4000-8000-0000000000a1');
insert into public.followup_reasons (label_he, sort_order, is_user_added, is_test, created_by)
  values ('סיבת בדיקה', 6, true, true, '00000000-0000-4000-8000-0000000000a1');
insert into public.collection_locations (name, place_type, sort_order, address, created_by)
  values ('מחסן בדיקה', 'logistics_center', 1, 'רחוב הבדיקה 1', '00000000-0000-4000-8000-0000000000a1');
select results_eq(
  $$ select table_name, bucket, test_rows from public.test_data_census()
     where table_name in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')
     order by table_name collate "C", bucket collate "C" $$,
  $$ values ('brands', 'all sources', 1::bigint), ('call_types', 'all sources', 1::bigint),
            ('collection_locations', 'all sources', 1::bigint),
            ('customers', 'automated_test', 1::bigint), ('customers', 'other sources', 0::bigint), ('customers', 'simulator', 1::bigint),
            ('followup_reasons', 'all sources', 1::bigint),
            ('products', 'automated_test', 1::bigint), ('products', 'other sources', 0::bigint), ('products', 'simulator', 1::bigint),
            ('suppliers', 'all sources', 1::bigint) $$,
  'PR 1.4 positive control: a test row in each new table is counted, customers and products by source; the D48 rows are not');
-- The 'other sources' bucket catches a source added later (the CHECK is relaxed inside this
-- rolled-back transaction to simulate one).
alter table public.products drop constraint products_data_source_check;
alter table public.customers drop constraint customers_data_source_check;
insert into public.products (sku_display, sku_normalized, name, data_source, source_ref) values ('tb-1003', 'TB-1003', 'מוצר בדיקה ג', 'later_source', 'run-070');
insert into public.customers (customer_number, name, phone, data_source, source_ref) values ('T-0003', 'לקוח בדיקה ג', '050-000-0003', 'later_source', 'run-070');
select is(
  (select sum(test_rows) from public.test_data_census() where table_name in ('products', 'customers') and bucket = 'other sources'),
  2::numeric, 'PR 1.4 positive control: a later source is counted in the other sources bucket');

-- PR 1.5 positive control: a test row in each new table (inserted as postgres; every CHECK and
-- trigger applies, the deferred checks never run because the transaction is rolled back), service
-- calls per source, a later call source with the CHECK relaxed inside this transaction.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'user-d1@example.test', now(), now());
insert into public.profiles (id, role, full_name, is_active)
  values ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email)
  values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y',
          'tech-a@example.test');
alter table public.service_calls drop constraint service_calls_data_source_check;
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
                                  handling_rep_name, status, next_visit_number, data_source, source_ref, created_by)
select v.id::uuid, v.request_number, c.id, p.id, t.id, 'תקלת בדיקה', 'נציגת בדיקה', 'open', 2, v.data_source, 'pr15-070-1',
       v.created_by::uuid
from (values ('00000000-0000-4000-8000-0000000007a1', 'R-0701', 'T-0001', 'TB-1001', 'simulator', '00000000-0000-4000-8000-0000000000a1'),
             ('00000000-0000-4000-8000-0000000007a2', 'R-0702', 'T-0002', 'TB-1002', 'automated_test', null),
             ('00000000-0000-4000-8000-0000000007a3', 'R-0703', 'T-0003', 'TB-1003', 'later_source', null))
     as v (id, request_number, customer_number, sku, data_source, created_by)
join public.customers c on c.customer_number = v.customer_number
join public.products p on p.sku_normalized = v.sku
join public.call_types t on t.sort_order = 1;
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
                           status, city, street, source_ref)
  values ('00000000-0000-4000-8000-0000000007b1', '00000000-0000-4000-8000-0000000007a1', '00000000-0000-4000-8000-0000000000e1',
          1, 'T-0701', now(), now() + interval '1 hour', 'done', 'עיר בדיקה', 'רחוב בדיקה', 'pr15-070-1');
insert into public.visit_reports (visit_id, summary_text, summary_source)
  values ('00000000-0000-4000-8000-0000000007b1', 'סיכום בדיקה', 'written');
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
  values ('00000000-0000-4000-8000-0000000007b1', 'חותם בדיקה', 'נוסח בדיקה',
          encode(sha256(convert_to('נוסח בדיקה', 'UTF8')), 'hex'), gen_random_uuid());
insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, kind, reported_at, device_tz,
                                       device_utc_offset_min, device_sent_at, source, operation_id)
  values ('00000000-0000-4000-8000-0000000007b1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1',
          'arrived', now(), 'Asia/Jerusalem', 120, now(), 'device', gen_random_uuid());
insert into public.visit_events (visit_id, version_after, event_type, to_status)
  values ('00000000-0000-4000-8000-0000000007b1', 1, 'created', 'done');
insert into public.entity_changes (entity_table, entity_id, field, old_value, new_value, source)
  values ('service_calls', '00000000-0000-4000-8000-0000000007a1', 'status', '"open"', '"resolved"', 'system');
select results_eq(
  $$ select table_name, bucket, test_rows from public.test_data_census()
     where table_name in ('service_calls', 'visits', 'visit_reports', 'visit_signatures', 'visit_time_reports',
                          'visit_events', 'entity_changes')
     order by table_name collate "C", bucket collate "C" $$,
  $$ values ('entity_changes', 'all sources', 1::bigint),
            ('service_calls', 'automated_test', 1::bigint), ('service_calls', 'other sources', 1::bigint),
            ('service_calls', 'simulator', 1::bigint),
            ('visit_events', 'all sources', 1::bigint), ('visit_reports', 'all sources', 1::bigint),
            ('visit_signatures', 'all sources', 1::bigint), ('visit_time_reports', 'all sources', 1::bigint),
            ('visits', 'all sources', 1::bigint) $$,
  'PR 1.5 positive control: a test row in each new table is counted, service calls by source (a later source in other sources)');

-- PR 1.6 positive control: a test row in each new table (as postgres; every CHECK and trigger
-- applies): an invitation review item on the call R-0701, a summary correction of its done visit,
-- an applied offline operation of the Technician on that visit.
insert into public.review_items (review_type, dedupe_key, service_call_id, source, source_ref, submitted_version,
                                 current_version)
  values ('sku_change', 'pr16-070-1', '00000000-0000-4000-8000-0000000007a1', 'invitation', 'pr16-070-evt-1',
          '{"sku": "TB-2"}', '{"sku": "TB-1001"}');
insert into public.visit_corrections (visit_id, field, old_value, new_value, reason, version_before, version_after, corrected_by)
  values ('00000000-0000-4000-8000-0000000007b1', 'summary', '"סיכום בדיקה"', '"סיכום בדיקה מתוקן"', 'תיקון בדיקה',
          1, 2, '00000000-0000-4000-8000-0000000000a1');
insert into public.offline_operations (operation_id, actor_profile_id, visit_id, op_type, payload_sha256, expected_field_version,
                                       device_sent_at, device_tz, device_utc_offset_min, result, resulting_field_version)
  values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000007b1', 'close',
          repeat('b', 64), 1, now(), 'Asia/Jerusalem', 120, 'applied', 1);
select results_eq(
  $$ select table_name, bucket, test_rows from public.test_data_census()
     where table_name in ('review_items', 'visit_corrections', 'offline_operations')
     order by table_name collate "C", bucket collate "C" $$,
  $$ values ('offline_operations'::text, 'all sources'::text, 1::bigint), ('review_items', 'all sources', 1::bigint),
            ('visit_corrections', 'all sources', 1::bigint) $$,
  'PR 1.6 positive control: a test row in each of the three new tables is counted');

-- Who may run it --------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is((select test_rows from public.test_data_census() where table_name = 'profiles'), 3::bigint,
  'the Creator runs the census through the API and sees every row (PR 1.5: the Technician profile of its positive control included)');
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
