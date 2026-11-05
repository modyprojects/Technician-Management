-- PR 1.4: test-data markers and the one-way rule on the reference, customer and product tables
-- (D47; docs/database-schema.md §2; docs/testing.md category 12). Markers are immutable for every
-- role; data_source fails closed; is_test on products and customers is generated (and read by
-- AFTER triggers, plan V1); a real row never references a test row; before go-live every row
-- created in the app is test data (TEMPORARY, owner question OQ-4). Runs as postgres except where
-- a caller is impersonated.
--
-- Real customers, products, brands, suppliers and places are impossible before go-live. The one-way
-- tests in section 6 therefore relax the relevant CHECK inside this rolled-back transaction,
-- simulating go-live or Step 11 (plan §9; PR 1.3 owner question Q3), and prove that the triggers
-- still reject a real row that references a test one. Section 6 is last, so every earlier test runs
-- against the full set of constraints.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- Test-only helper (pg_temp, rolled back): see 100_reference_schema.test.sql.
create function pg_temp.tm_try(p_sql text)
returns text
language plpgsql
as $f$
declare
  v_state text;
  v_constraint text;
  v_column text;
  v_message text;
begin
  begin
    begin
      execute p_sql;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name,
        v_column = column_name, v_message = message_text;
      return v_state || ' ' || case when v_state = '23502' then v_column
                                    else coalesce(nullif(v_constraint, ''), v_message) end;
    end;
    raise exception using errcode = 'TM001', message = 'undo the probe';
  exception when sqlstate 'TM001' then
    return 'ok';
  end;
end
$f$;

create temporary table tm_case (
  n integer generated always as identity, grp text not null, label text not null, stmt text not null, expected text not null
) on commit drop;
create temporary table tm_ids (k text primary key, id uuid, is_test boolean) on commit drop;
grant all on tm_ids to authenticated;

-- Fixtures (local, rolled back): see 020_markers.test.sql. c1 is the only real profile (the
-- bootstrapped Creator, D49); a1 is a test Manager. Fictional values only (D47).
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true);

insert into public.brands (id, name, created_by) values
  ('00000000-0000-4000-8000-000000000201', 'מותג בדיקה', '00000000-0000-4000-8000-0000000000a1');
insert into public.suppliers (id, name, created_by) values
  ('00000000-0000-4000-8000-000000000202', 'ספק בדיקה', '00000000-0000-4000-8000-0000000000a1');
insert into public.collection_locations (id, name, place_type, sort_order, address, created_by) values
  ('00000000-0000-4000-8000-000000000207', 'מחסן בדיקה', 'branch', 1, 'רחוב הבדיקה 1', '00000000-0000-4000-8000-0000000000a1');

-- ---------------------------------------------------------------------------------------------
-- 1. Generated is_test on the root tables (V1): a test row created by a test profile is accepted.
--    The one-way checks run AFTER the row is formed; a BEFORE trigger would read is_test as NULL
--    and treat the row as real.
-- ---------------------------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.products (id, sku_display, sku_normalized, name, brand_id, supplier_id, data_source, source_ref, created_by, updated_by)
     values ('00000000-0000-4000-8000-000000000203', 'tb-1001', 'TB-1001', 'מוצר בדיקה', '00000000-0000-4000-8000-000000000201',
             '00000000-0000-4000-8000-000000000202', 'simulator', 'sim-evt-1', '00000000-0000-4000-8000-0000000000a1',
             '00000000-0000-4000-8000-0000000000a1') $$,
  'generated-column control: a simulator product created by a test profile, with a test brand and supplier, is accepted');
select lives_ok(
  $$ insert into public.customers (id, customer_number, name, phone, data_source, source_ref, created_by, updated_by)
     values ('00000000-0000-4000-8000-000000000204', 'T-0001', 'לקוח בדיקה', '050-000-0001', 'simulator', 'sim-evt-1',
             '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1') $$,
  'generated-column control: a simulator customer created by a test profile is accepted');
select lives_ok(
  $$ update public.products set name = 'מוצר בדיקה מתוקן', updated_by = '00000000-0000-4000-8000-0000000000a1'
     where id = '00000000-0000-4000-8000-000000000203';
     update public.customers set phone = '050-000-0002', updated_by = '00000000-0000-4000-8000-0000000000a1'
     where id = '00000000-0000-4000-8000-000000000204' $$,
  'generated-column control: a test profile updates the test product and customer (AFTER UPDATE path)');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000000205', 'tb-1002', 'TB-1002', 'מוצר בדיקה ב', 'automated_test', 'run-110');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000000206', 'T-0002', 'לקוח בדיקה ב', '050-000-0003', 'automated_test', 'run-110');
select results_eq(
  $$ select 'products'::text, p.data_source, p.is_test from public.products p
       where p.id in ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000205')
     union all
     select 'customers', c.data_source, c.is_test from public.customers c
       where c.id in ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000206')
     order by 1, 2 $$,
  $$ values ('customers'::text, 'automated_test'::text, true), ('customers', 'simulator', true),
            ('products', 'automated_test', true), ('products', 'simulator', true) $$,
  'is_test is generated as true for the simulator and automated-test sources (D47)');
select is(
  (select count(*) from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid in ('public.products'::regclass, 'public.customers'::regclass) and a.attname = 'is_test'
     and a.attgenerated = 's' and pg_get_expr(d.adbin, d.adrelid) = '(data_source <> ''microsoft_graph''::text)'),
  2::bigint,
  'products.is_test and customers.is_test are stored generated columns: every source except the real one counts as test');

-- ---------------------------------------------------------------------------------------------
-- 2. data_source fails closed; is_test cannot be written; a simulator row names its creator
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, expected)
select 'data_source_' || t.t, v.label,
       case t.t
         when 'products' then format($s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref, created_by)
                                       values ('PROBE-1', 'PROBE-1', 'מוצר בדיקה', %L, 'run-110', '00000000-0000-4000-8000-0000000000a1')$s$, v.val)
         else format($s$insert into public.customers (customer_number, name, phone, data_source, source_ref, created_by)
                        values ('PROBE-1', 'לקוח בדיקה', '050-000-0000', %L, 'run-110', '00000000-0000-4000-8000-0000000000a1')$s$, v.val)
       end,
       case when v.ok then 'ok' when v.val is null then '23502 data_source' else '23514 ' || t.t || '_data_source_check' end
from (values ('products'), ('customers')) t (t)
cross join (values
  (1, 'simulator', 'simulator', true),
  (2, 'automated_test', 'automated_test', true),
  (3, 'microsoft_graph (real; only an approved Step 11 migration adds it)', 'microsoft_graph', false),
  (4, 'seed (no seed source, D47)', 'seed', false),
  (5, 'manual', 'manual', false),
  (6, 'upper-case simulator', 'SIMULATOR', false),
  (7, 'padded simulator', 'simulator ', false),
  (8, 'empty', '', false),
  (9, 'missing', null, false)
) v (n, label, val, ok)
order by t.t desc, v.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'data_source_products' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'data_source_products' order by c.n $$,
  'products.data_source is required and only simulator or automated_test before go-live: no real or seed source (fails closed)');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'data_source_customers' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'data_source_customers' order by c.n $$,
  'customers.data_source is required and only simulator or automated_test before go-live (fails closed)');

insert into tm_case (grp, label, stmt, expected) values
  ('generated', 'products: insert is_test',
   $s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref, is_test)
      values ('PROBE-1', 'PROBE-1', 'מוצר בדיקה', 'automated_test', 'run-110', false)$s$,
   '428C9 cannot insert a non-DEFAULT value into column "is_test"'),
  ('generated', 'products: update is_test',
   $s$update public.products set is_test = false where id = '00000000-0000-4000-8000-000000000205'$s$,
   '428C9 column "is_test" can only be updated to DEFAULT'),
  ('generated', 'customers: insert is_test',
   $s$insert into public.customers (customer_number, name, phone, data_source, source_ref, is_test)
      values ('PROBE-1', 'לקוח בדיקה', '050-000-0000', 'automated_test', 'run-110', false)$s$,
   '428C9 cannot insert a non-DEFAULT value into column "is_test"'),
  ('generated', 'customers: update is_test',
   $s$update public.customers set is_test = false where id = '00000000-0000-4000-8000-000000000206'$s$,
   '428C9 column "is_test" can only be updated to DEFAULT');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'generated' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'generated' order by c.n $$,
  'is_test on products and customers cannot be written, even as postgres: only data_source sets it');

insert into tm_case (grp, label, stmt, expected) values
  ('simulator_creator', 'products: simulator without a creator',
   $s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
      values ('PROBE-1', 'PROBE-1', 'מוצר בדיקה', 'simulator', 'sim-evt-9')$s$, '23514 products_simulator_creator_check'),
  ('simulator_creator', 'customers: simulator without a creator',
   $s$insert into public.customers (customer_number, name, phone, data_source, source_ref)
      values ('PROBE-1', 'לקוח בדיקה', '050-000-0000', 'simulator', 'sim-evt-9')$s$, '23514 customers_simulator_creator_check'),
  ('simulator_creator', 'products: automated test without a creator (a test run)',
   $s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
      values ('PROBE-1', 'PROBE-1', 'מוצר בדיקה', 'automated_test', 'run-110')$s$, 'ok');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'simulator_creator' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'simulator_creator' order by c.n $$,
  'a simulator row always names the user who created it (traceable to its origin, D47)');

-- ---------------------------------------------------------------------------------------------
-- 3. Markers never change, for every role (postgres included)
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  $$ update public.brands set is_test = false where id = '00000000-0000-4000-8000-000000000201' $$,
  '55000', 'brands: these fields are immutable', 'brands.is_test cannot change, even as postgres');
select throws_ok(
  $$ update public.suppliers set is_test = false where id = '00000000-0000-4000-8000-000000000202' $$,
  '55000', 'suppliers: these fields are immutable', 'suppliers.is_test cannot change, even as postgres');
select throws_ok(
  $$ update public.products set data_source = 'automated_test' where id = '00000000-0000-4000-8000-000000000203' $$,
  '55000', 'products: these fields are immutable', 'products.data_source (and so is_test) cannot change, even as postgres');
select throws_ok(
  $$ update public.customers set data_source = 'automated_test' where id = '00000000-0000-4000-8000-000000000204' $$,
  '55000', 'customers: these fields are immutable', 'customers.data_source (and so is_test) cannot change, even as postgres');
select throws_ok(
  $$ update public.call_types set is_test = true where sort_order = 1 $$,
  '55000', 'call_types: these fields are immutable', 'call_types.is_test cannot change: a D48 row never becomes test data');
select throws_ok(
  $$ update public.followup_reasons set is_test = true where sort_order = 1 $$,
  '55000', 'followup_reasons: these fields are immutable', 'followup_reasons.is_test cannot change: a D48 row never becomes test data');
select throws_ok(
  $$ update public.collection_locations set is_test = false where id = '00000000-0000-4000-8000-000000000207' $$,
  '55000', 'collection_locations: these fields are immutable', 'collection_locations.is_test cannot change, even as postgres');

-- Defence in depth: with t10 disabled (owner-level, rolled back), t20 still freezes the marker.
alter table public.brands disable trigger t10_immutable;
alter table public.suppliers disable trigger t10_immutable;
alter table public.call_types disable trigger t10_immutable;
alter table public.followup_reasons disable trigger t10_immutable;
alter table public.collection_locations disable trigger t10_immutable;
select results_eq(
  $$ select pg_temp.tm_try($s$update public.brands set is_test = false where id = '00000000-0000-4000-8000-000000000201'$s$)
     union all select pg_temp.tm_try($s$update public.suppliers set is_test = false where id = '00000000-0000-4000-8000-000000000202'$s$)
     union all select pg_temp.tm_try($s$update public.call_types set is_test = true where sort_order = 1$s$)
     union all select pg_temp.tm_try($s$update public.followup_reasons set is_test = true where sort_order = 1$s$)
     union all select pg_temp.tm_try($s$update public.collection_locations set is_test = false
                                        where id = '00000000-0000-4000-8000-000000000207'$s$) $$,
  $$ values ('55000 brands: test-data markers are immutable (D47)'::text),
            ('55000 suppliers: test-data markers are immutable (D47)'),
            ('55000 call_types: test-data markers are immutable (D47)'),
            ('55000 followup_reasons: test-data markers are immutable (D47)'),
            ('55000 collection_locations: test-data markers are immutable (D47)') $$,
  'with the t10 guard disabled, t20 (tg_immutable_markers) still freezes is_test on the five marker tables');
alter table public.brands enable trigger t10_immutable;
alter table public.suppliers enable trigger t10_immutable;
alter table public.call_types enable trigger t10_immutable;
alter table public.followup_reasons enable trigger t10_immutable;
alter table public.collection_locations enable trigger t10_immutable;

-- ---------------------------------------------------------------------------------------------
-- 4. Before go-live every row created in the app is test data (TEMPORARY, OQ-4)
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, expected) values
  ('golive', 'a real brand',
   $s$insert into public.brands (name, is_test, created_by) values ('מותג אמיתי', false, '00000000-0000-4000-8000-0000000000c1')$s$,
   '23514 brands_test_until_golive_check'),
  ('golive', 'a real supplier',
   $s$insert into public.suppliers (name, is_test) values ('ספק אמיתי', false)$s$, '23514 suppliers_test_until_golive_check'),
  ('golive', 'a real pickup place',
   $s$insert into public.collection_locations (name, place_type, sort_order, address, is_test)
      values ('מחסן אמיתי', 'branch', 50, 'רחוב אמיתי 1', false)$s$, '23514 collection_locations_test_until_golive_check'),
  ('golive', 'a real call type created in the app (by the real Creator)',
   $s$insert into public.call_types (label_he, sort_order, is_test, created_by) values ('סוג אמיתי', 50, false, '00000000-0000-4000-8000-0000000000c1')$s$,
   '23514 call_types_real_from_migration_check'),
  ('golive', 'a real reason created in the app (by the real Creator)',
   $s$insert into public.followup_reasons (label_he, sort_order, is_user_added, is_test, created_by)
      values ('סיבה אמיתית', 50, true, false, '00000000-0000-4000-8000-0000000000c1')$s$,
   '23514 followup_reasons_real_from_migration_check'),
  ('golive', 'a brand that names no marker is test data (default)',
   $s$insert into public.brands (name) values ('מותג ללא סימון')$s$, 'ok'),
  ('golive', 'a real call type without a creator (the shape of an approved migration row)',
   $s$insert into public.call_types (label_he, sort_order) values ('סוג ממיגרציה', 50)$s$, 'ok');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'golive' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'golive' order by c.n $$,
  'TEMPORARY (OQ-4): no real brand, supplier or place, and no real call type or reason created in the app, before go-live');

-- The Settings RPCs create test data, also for the real Creator (plan §5.3). a1 receives `settings`
-- from the Creator first.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
insert into tm_ids select 'creator_call_type', r.id, r.is_test from public.add_call_type('סוג מהיוצר') r;
insert into tm_ids select 'creator_reason', r.id, r.is_test from public.add_followup_reason('סיבה מהיוצר') r;
insert into tm_ids select 'creator_place', r.id, r.is_test
  from public.add_collection_location('מחסן מהיוצר', 'branch', 'רחוב היוצר 1', null, null) r;
select public.admin_set_role_permission('manager', 'settings', true, 1, null);
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
insert into tm_ids select 'manager_call_type', r.id, r.is_test from public.add_call_type('סוג מהמנהל') r;
insert into tm_ids select 'manager_reason', r.id, r.is_test from public.add_followup_reason('סיבה מהמנהל') r;
insert into tm_ids select 'manager_place', r.id, r.is_test
  from public.add_collection_location('מחסן מהמנהל', 'logistics_center', 'רחוב המנהל 1', '03-000-0000', 'א-ה 08:00-16:00') r;
reset role;
select set_config('request.jwt.claims', '', true);

select results_eq(
  $$ select i.k, i.is_test from tm_ids i where i.k like 'creator_%' order by i.k collate "C" $$,
  $$ values ('creator_call_type'::text, true), ('creator_place', true), ('creator_reason', true) $$,
  'TEMPORARY (OQ-4): every add RPC returns is_test = true, also for the real Creator');
select results_eq(
  $$ select i.k, i.is_test from tm_ids i where i.k like 'manager_%' order by i.k collate "C" $$,
  $$ values ('manager_call_type'::text, true), ('manager_place', true), ('manager_reason', true) $$,
  'every add RPC returns is_test = true for a test Manager with `settings`');
select results_eq(
  $$ select i.k, x.is_test, x.created_by, x.updated_by, x.is_user_added
     from tm_ids i
     join (select c.id, c.is_test, c.created_by, c.updated_by, null::boolean as is_user_added from public.call_types c
           union all select r.id, r.is_test, r.created_by, r.updated_by, r.is_user_added from public.followup_reasons r
           union all select l.id, l.is_test, l.created_by, l.updated_by, null from public.collection_locations l) x on x.id = i.id
     order by i.k collate "C" $$,
  $$ values ('creator_call_type'::text, true, '00000000-0000-4000-8000-0000000000c1'::uuid, '00000000-0000-4000-8000-0000000000c1'::uuid, null::boolean),
            ('creator_place', true, '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1', null),
            ('creator_reason', true, '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1', true),
            ('manager_call_type', true, '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', null),
            ('manager_place', true, '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', null),
            ('manager_reason', true, '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', true) $$,
  'rows created through the RPCs are stored as test data, traceable to their creator; a new reason is user-added');

-- ---------------------------------------------------------------------------------------------
-- 5. Parent keys for PR 1.5 (database-schema.md §2): UNIQUE (id, is_test) on the root tables. A
--    scratch child table (rolled back) shows the composite key keeps a real row off a test parent.
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select k.conname::text collate "default", pg_get_constraintdef(k.oid)
     from pg_constraint k where k.conname in ('products_id_is_test_key', 'customers_id_is_test_key')
     order by 1 $$,
  $$ values ('customers_id_is_test_key'::text, 'UNIQUE (id, is_test)'::text), ('products_id_is_test_key', 'UNIQUE (id, is_test)') $$,
  'products and customers carry UNIQUE (id, is_test), the parent of the PR 1.5 composite foreign keys');
create table public.tm_scratch_children (
  id integer primary key, product_id uuid not null, customer_id uuid not null, is_test boolean not null,
  foreign key (product_id, is_test) references public.products (id, is_test),
  foreign key (customer_id, is_test) references public.customers (id, is_test));
select results_eq(
  $$ select pg_temp.tm_try($s$insert into public.tm_scratch_children values (1, '00000000-0000-4000-8000-000000000203',
                                '00000000-0000-4000-8000-000000000204', true)$s$)
     union all
     select left(pg_temp.tm_try($s$insert into public.tm_scratch_children values (2, '00000000-0000-4000-8000-000000000203',
                                     '00000000-0000-4000-8000-000000000204', false)$s$), 5) $$,
  $$ values ('ok'::text), ('23503') $$,
  'through (id, is_test) a test child may reference a test product and customer; a real child may not');
drop table public.tm_scratch_children;

-- ---------------------------------------------------------------------------------------------
-- 6. The one-way rule (D47): a real row never references a test row. The pre-go-live CHECKs are
--    relaxed inside this rolled-back transaction to build real rows (see the header).
-- ---------------------------------------------------------------------------------------------
alter table public.brands drop constraint brands_test_until_golive_check;
alter table public.suppliers drop constraint suppliers_test_until_golive_check;
alter table public.collection_locations drop constraint collection_locations_test_until_golive_check;
alter table public.call_types drop constraint call_types_real_from_migration_check;
alter table public.followup_reasons drop constraint followup_reasons_real_from_migration_check;
alter table public.products drop constraint products_data_source_check;
alter table public.customers drop constraint customers_data_source_check;

-- Real rows that reference only the real Creator are accepted.
insert into public.brands (id, name, is_test, created_by) values
  ('00000000-0000-4000-8000-000000000211', 'מותג אמיתי', false, '00000000-0000-4000-8000-0000000000c1');
insert into public.suppliers (id, name, is_test, created_by) values
  ('00000000-0000-4000-8000-000000000212', 'ספק אמיתי', false, '00000000-0000-4000-8000-0000000000c1');
insert into public.collection_locations (id, name, place_type, sort_order, address, is_test, created_by) values
  ('00000000-0000-4000-8000-000000000217', 'מחסן אמיתי', 'branch', 60, 'רחוב אמיתי 1', false, '00000000-0000-4000-8000-0000000000c1');
insert into public.products (id, sku_display, sku_normalized, name, brand_id, supplier_id, data_source, source_ref, created_by) values
  ('00000000-0000-4000-8000-000000000213', 'rp-1', 'RP-1', 'מוצר אמיתי', '00000000-0000-4000-8000-000000000211',
   '00000000-0000-4000-8000-000000000212', 'microsoft_graph', 'graph-evt-1', '00000000-0000-4000-8000-0000000000c1');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref, created_by) values
  ('00000000-0000-4000-8000-000000000214', 'R-0001', 'לקוח אמיתי', '050-000-0004', 'microsoft_graph', 'graph-evt-1',
   '00000000-0000-4000-8000-0000000000c1');
select results_eq(
  $$ select 'products'::text, p.is_test from public.products p where p.id = '00000000-0000-4000-8000-000000000213'
     union all select 'customers', c.is_test from public.customers c where c.id = '00000000-0000-4000-8000-000000000214'
     union all select 'brands', b.is_test from public.brands b where b.id = '00000000-0000-4000-8000-000000000211'
     union all select 'suppliers', s.is_test from public.suppliers s where s.id = '00000000-0000-4000-8000-000000000212'
     union all select 'collection_locations', l.is_test from public.collection_locations l
               where l.id = '00000000-0000-4000-8000-000000000217' $$,
  $$ values ('products'::text, false), ('customers', false), ('brands', false), ('suppliers', false), ('collection_locations', false) $$,
  'simulated go-live: real rows that reference only the real Creator are accepted; microsoft_graph generates is_test = false');
select results_eq(
  $$ insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
     values ('lp-1', 'LP-1', 'מוצר ממקור עתידי', 'later_source', 'run-110') returning is_test $$,
  $$ values (true) $$,
  'a source added later without updating the expression counts as test data (fails safe)');

insert into tm_case (grp, label, stmt, expected)
select 'one_way_' || v.t, v.label, v.stmt, v.expected
from (values
  (1, 'brands', 'insert a real brand created by a test profile',
   $s$insert into public.brands (name, is_test, created_by) values ('מותג אמיתי ב', false, '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 brands: a real record cannot reference a test profile (D47)'),
  (2, 'brands', 'insert a real brand updated by a test profile',
   $s$insert into public.brands (name, is_test, updated_by) values ('מותג אמיתי ב', false, '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 brands: a real record cannot reference a test profile (D47)'),
  (3, 'brands', 'a test profile updates a real brand',
   $s$update public.brands set is_active = false, updated_by = '00000000-0000-4000-8000-0000000000a1'
      where id = '00000000-0000-4000-8000-000000000211'$s$,
   '23514 brands: a real record cannot reference a test profile (D47)'),
  (4, 'brands', 'the real Creator updates a real brand',
   $s$update public.brands set is_active = false, updated_by = '00000000-0000-4000-8000-0000000000c1'
      where id = '00000000-0000-4000-8000-000000000211'$s$, 'ok'),
  (5, 'brands', 'a test brand references the real Creator',
   $s$insert into public.brands (name, created_by, updated_by)
      values ('מותג בדיקה ב', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1')$s$, 'ok'),
  (1, 'suppliers', 'insert a real supplier created by a test profile',
   $s$insert into public.suppliers (name, is_test, created_by) values ('ספק אמיתי ב', false, '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 suppliers: a real record cannot reference a test profile (D47)'),
  (2, 'suppliers', 'a test profile updates a real supplier',
   $s$update public.suppliers set is_active = false, updated_by = '00000000-0000-4000-8000-0000000000a1'
      where id = '00000000-0000-4000-8000-000000000212'$s$,
   '23514 suppliers: a real record cannot reference a test profile (D47)'),
  (3, 'suppliers', 'a test supplier references the real Creator',
   $s$insert into public.suppliers (name, created_by) values ('ספק בדיקה ב', '00000000-0000-4000-8000-0000000000c1')$s$, 'ok'),
  (1, 'collection_locations', 'insert a real place created by a test profile',
   $s$insert into public.collection_locations (name, place_type, sort_order, address, is_test, created_by)
      values ('מחסן אמיתי ב', 'branch', 61, 'רחוב אמיתי 2', false, '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 collection_locations: a real record cannot reference a test profile (D47)'),
  (2, 'collection_locations', 'a test profile updates a real place',
   $s$update public.collection_locations set is_active = false, updated_by = '00000000-0000-4000-8000-0000000000a1'
      where id = '00000000-0000-4000-8000-000000000217'$s$,
   '23514 collection_locations: a real record cannot reference a test profile (D47)'),
  (3, 'collection_locations', 'the real Creator updates a real place',
   $s$update public.collection_locations set is_active = false, updated_by = '00000000-0000-4000-8000-0000000000c1'
      where id = '00000000-0000-4000-8000-000000000217'$s$, 'ok'),
  (1, 'call_types', 'insert a real call type created by a test profile',
   $s$insert into public.call_types (label_he, sort_order, is_test, created_by)
      values ('סוג אמיתי', 60, false, '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 call_types: a real record cannot reference a test profile (D47)'),
  (2, 'call_types', 'a test profile updates a D48 call type',
   $s$update public.call_types set is_active = false, updated_by = '00000000-0000-4000-8000-0000000000a1' where sort_order = 1$s$,
   '23514 call_types: a real record cannot reference a test profile (D47)'),
  (3, 'call_types', 'the real Creator updates a D48 call type',
   $s$update public.call_types set is_active = false, updated_by = '00000000-0000-4000-8000-0000000000c1' where sort_order = 1$s$, 'ok'),
  (1, 'followup_reasons', 'insert a real user-added reason created by a test profile',
   $s$insert into public.followup_reasons (label_he, sort_order, is_user_added, is_test, created_by)
      values ('סיבה אמיתית', 60, true, false, '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 followup_reasons: a real record cannot reference a test profile (D47)'),
  (2, 'followup_reasons', 'a test profile updates a D48 reason',
   $s$update public.followup_reasons set is_active = false, updated_by = '00000000-0000-4000-8000-0000000000a1' where sort_order = 1$s$,
   '23514 followup_reasons: a real record cannot reference a test profile (D47)'),
  (3, 'followup_reasons', 'the real Creator updates a D48 reason',
   $s$update public.followup_reasons set is_active = false, updated_by = '00000000-0000-4000-8000-0000000000c1' where sort_order = 1$s$,
   'ok'),
  (1, 'products', 'insert a real product created by a test profile',
   $s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref, created_by)
      values ('rp-2', 'RP-2', 'מוצר אמיתי ב', 'microsoft_graph', 'graph-evt-2', '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 products: a real record cannot reference a test profile (D47)'),
  (2, 'products', 'insert a real product updated by a test profile',
   $s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref, updated_by)
      values ('rp-2', 'RP-2', 'מוצר אמיתי ב', 'microsoft_graph', 'graph-evt-2', '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 products: a real record cannot reference a test profile (D47)'),
  (3, 'products', 'a test profile updates a real product',
   $s$update public.products set name = 'מוצר אמיתי מתוקן', updated_by = '00000000-0000-4000-8000-0000000000a1'
      where id = '00000000-0000-4000-8000-000000000213'$s$,
   '23514 products: a real record cannot reference a test profile (D47)'),
  (4, 'products', 'the real Creator updates a real product',
   $s$update public.products set name = 'מוצר אמיתי מתוקן', updated_by = '00000000-0000-4000-8000-0000000000c1'
      where id = '00000000-0000-4000-8000-000000000213'$s$, 'ok'),
  (1, 'customers', 'insert a real customer created by a test profile',
   $s$insert into public.customers (customer_number, name, phone, data_source, source_ref, created_by)
      values ('R-0002', 'לקוח אמיתי ב', '050-000-0005', 'microsoft_graph', 'graph-evt-2', '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 customers: a real record cannot reference a test profile (D47)'),
  (2, 'customers', 'a test profile updates a real customer',
   $s$update public.customers set phone = '050-000-0006', updated_by = '00000000-0000-4000-8000-0000000000a1'
      where id = '00000000-0000-4000-8000-000000000214'$s$,
   '23514 customers: a real record cannot reference a test profile (D47)'),
  (3, 'customers', 'the real Creator updates a real customer',
   $s$update public.customers set phone = '050-000-0006', updated_by = '00000000-0000-4000-8000-0000000000c1'
      where id = '00000000-0000-4000-8000-000000000214'$s$, 'ok'),
  (4, 'customers', 'a test customer references the real Creator',
   $s$insert into public.customers (customer_number, name, phone, data_source, source_ref, created_by)
      values ('T-0009', 'לקוח בדיקה ט', '050-000-0009', 'simulator', 'sim-evt-9', '00000000-0000-4000-8000-0000000000c1')$s$, 'ok')
) v (n, t, label, stmt, expected)
order by v.t collate "C", v.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'one_way_brands' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'one_way_brands' order by c.n $$,
  'brands: a real brand never references a test profile (BEFORE INSERT and UPDATE); a test brand may reference a real one');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'one_way_suppliers' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'one_way_suppliers' order by c.n $$,
  'suppliers: a real supplier never references a test profile; a test supplier may reference a real one');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'one_way_collection_locations' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'one_way_collection_locations' order by c.n $$,
  'collection_locations: a real place never references a test profile');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'one_way_call_types' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'one_way_call_types' order by c.n $$,
  'call_types: a real (D48) call type is never created or changed by a test profile; the real Creator may change it');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'one_way_followup_reasons' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'one_way_followup_reasons' order by c.n $$,
  'followup_reasons: a real (D48) reason is never created or changed by a test profile; the real Creator may change it');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'one_way_products' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'one_way_products' order by c.n $$,
  'products: a real product never references a test profile (AFTER INSERT and UPDATE, when is_test is computed)');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'one_way_customers' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'one_way_customers' order by c.n $$,
  'customers: a real customer never references a test profile; a test customer may reference a real one');

-- A real product never references a test brand or supplier (a31, tg_one_way_product_refs).
insert into tm_case (grp, label, stmt, expected) values
  ('refs', 'insert a real product with a test brand',
   $s$insert into public.products (sku_display, sku_normalized, name, brand_id, data_source, source_ref)
      values ('rp-3', 'RP-3', 'מוצר אמיתי ג', '00000000-0000-4000-8000-000000000201', 'microsoft_graph', 'graph-evt-3')$s$,
   '23514 products: a real product cannot reference a test brand or supplier (D47)'),
  ('refs', 'insert a real product with a test supplier',
   $s$insert into public.products (sku_display, sku_normalized, name, supplier_id, data_source, source_ref)
      values ('rp-3', 'RP-3', 'מוצר אמיתי ג', '00000000-0000-4000-8000-000000000202', 'microsoft_graph', 'graph-evt-3')$s$,
   '23514 products: a real product cannot reference a test brand or supplier (D47)'),
  ('refs', 'insert a real product with a real brand and supplier',
   $s$insert into public.products (sku_display, sku_normalized, name, brand_id, supplier_id, data_source, source_ref)
      values ('rp-3', 'RP-3', 'מוצר אמיתי ג', '00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000212',
              'microsoft_graph', 'graph-evt-3')$s$, 'ok'),
  ('refs', 'a real product gets a test brand',
   $s$update public.products set brand_id = '00000000-0000-4000-8000-000000000201' where id = '00000000-0000-4000-8000-000000000213'$s$,
   '23514 products: a real product cannot reference a test brand or supplier (D47)'),
  ('refs', 'a real product gets a test supplier',
   $s$update public.products set supplier_id = '00000000-0000-4000-8000-000000000202' where id = '00000000-0000-4000-8000-000000000213'$s$,
   '23514 products: a real product cannot reference a test brand or supplier (D47)'),
  ('refs', 'a real product clears its brand ("not entered")',
   $s$update public.products set brand_id = null where id = '00000000-0000-4000-8000-000000000213'$s$, 'ok'),
  ('refs', 'a test product with a real brand and supplier',
   $s$insert into public.products (sku_display, sku_normalized, name, brand_id, supplier_id, data_source, source_ref)
      values ('tb-1003', 'TB-1003', 'מוצר בדיקה ג', '00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000212',
              'automated_test', 'run-110')$s$, 'ok'),
  ('refs', 'a test product moves from a test brand to a real brand',
   $s$update public.products set brand_id = '00000000-0000-4000-8000-000000000211' where id = '00000000-0000-4000-8000-000000000203'$s$,
   'ok');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'refs' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'refs' order by c.n $$,
  'a real product never references a test brand or supplier, on INSERT and UPDATE (database-schema.md §2); a test product may reference real ones');

-- ---------------------------------------------------------------------------------------------
-- 7. Census (D47; docs/testing.md category 12): it counts exactly the test-marked rows
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select x.table_name, x.counted from (
       select c.table_name, sum(c.test_rows) as counted from public.test_data_census() c
       where c.table_name in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')
       group by c.table_name) x
     order by x.table_name collate "C" $$,
  $$ values ('brands'::text, (select count(*) from public.brands where is_test)::numeric),
            ('call_types', (select count(*) from public.call_types where is_test)::numeric),
            ('collection_locations', (select count(*) from public.collection_locations where is_test)::numeric),
            ('customers', (select count(*) from public.customers where is_test)::numeric),
            ('followup_reasons', (select count(*) from public.followup_reasons where is_test)::numeric),
            ('products', (select count(*) from public.products where is_test)::numeric),
            ('suppliers', (select count(*) from public.suppliers where is_test)::numeric) $$,
  'the census counts exactly the test-marked rows of each new table; the D48 rows and the simulated real rows are not counted');

select * from finish();
rollback;
