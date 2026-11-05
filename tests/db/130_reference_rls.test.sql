-- PR 1.4: who reads the reference, customer and product tables, and that nobody writes them
-- directly (docs/database-schema.md §8.2, §8.3 l.485 and l.495, §9; docs/security.md §5, §10;
-- docs/testing.md categories 1, 2, 3 and 4; D19, D33, D47, D51).
--
-- TEMPORARY behaviour asserted here (docs/review/step1-pr14 §13), deny by default:
--   OQ-1  no write path for products (no update_product);
--   OQ-2  products, brands and suppliers are read with `cal` or `calls` only (not `products`);
--   OQ-3  no write path for brands and suppliers;
--   OQ-12 Technicians read no customer, product, brand or supplier row until PR 1.5.
-- Matrix values are the TEMPORARY D51 defaults: `cal` and `calls` on for Manager and Customer
-- Service, `products` and `dashProd` on for Manager only, `settings` off for both.
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- Fixtures (local, rolled back): see 020_markers.test.sql. b3 and d2 are deactivated during the
-- file; f1 is an Auth user without a profile. Every data row is fictional test data (D47):
-- products and customers with data_source 'automated_test', the other tables test-marked.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'a9', 'b1', 'b2', 'b3', 'd1', 'd2', 'd4', 'f1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000a9', 'manager', 'מנהל לא פעיל', false),
  ('00000000-0000-4000-8000-0000000000b1', 'customer_service', 'נציגה א', true),
  ('00000000-0000-4000-8000-0000000000b2', 'customer_service', 'נציגה לא פעילה', false),
  ('00000000-0000-4000-8000-0000000000b3', 'customer_service', 'נציגה ג', true),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true),
  ('00000000-0000-4000-8000-0000000000d2', 'technician', 'טכנאי ב', true),
  ('00000000-0000-4000-8000-0000000000d4', 'technician', 'טכנאי לא פעיל', false);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d2', true, 'טכנאי ב', 't-e', 'tech-b@example.test');

insert into public.brands (id, name, is_active, created_by) values
  ('00000000-0000-4000-8000-0000000001b1', 'מותג פעיל', true, '00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-0000000001b2', 'מותג לא פעיל', false, '00000000-0000-4000-8000-0000000000c1');
insert into public.suppliers (id, name, is_active, created_by) values
  ('00000000-0000-4000-8000-0000000001a1', 'ספק פעיל', true, '00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-0000000001a2', 'ספק לא פעיל', false, '00000000-0000-4000-8000-0000000000c1');
insert into public.products (sku_display, sku_normalized, name, brand_id, supplier_id, data_source, source_ref) values
  ('kt-2041', 'KT-2041', 'מוצר בדיקה א', '00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-0000000001a1',
   'automated_test', 'pr14-130-p1'),
  ('KT-9001', 'KT-9001', 'מוצר בדיקה ב', null, null, 'automated_test', 'pr14-130-p2');
insert into public.customers (customer_number, name, phone, phone_alt, data_source, source_ref) values
  ('C-1001', 'לקוח בדיקה א', '050-000-0001', '050-000-0002', 'automated_test', 'pr14-130-c1'),
  ('C-1002', 'לקוח בדיקה ב', '050-000-0003', null, 'automated_test', 'pr14-130-c2');
insert into public.call_types (label_he, sort_order, is_active, is_test) values ('סוג לא פעיל', 3, false, true);
insert into public.followup_reasons (label_he, sort_order, is_active, is_user_added, is_test, created_by) values
  ('סיבת בדיקה', 6, true, true, true, '00000000-0000-4000-8000-0000000000c1'),
  ('סיבה לא פעילה', 7, false, true, true, '00000000-0000-4000-8000-0000000000c1');
insert into public.collection_locations (name, place_type, sort_order, address, is_active, created_by) values
  ('סניף פעיל', 'branch', 1, 'רחוב הבדיקה 1', true, '00000000-0000-4000-8000-0000000000c1'),
  ('מרכז לא פעיל', 'logistics_center', 2, 'רחוב הבדיקה 2', false, '00000000-0000-4000-8000-0000000000c1');

-- Helpers (pg_temp, rolled back). tm_visible: the rows the caller reads in each of the seven
-- tables. tm_state: 'ok' or the SQLSTATE of one statement. tm_selects and tm_writes try a SELECT
-- and every direct write (INSERT, UPDATE, DELETE, TRUNCATE) on each table.
create function pg_temp.tm_visible()
returns text
language sql
as $f$
  select 'brands ' || (select count(*) from public.brands)
    || ', suppliers ' || (select count(*) from public.suppliers)
    || ', products ' || (select count(*) from public.products)
    || ', customers ' || (select count(*) from public.customers)
    || ', call_types ' || (select count(*) from public.call_types)
    || ', followup_reasons ' || (select count(*) from public.followup_reasons)
    || ', collection_locations ' || (select count(*) from public.collection_locations)
$f$;
create function pg_temp.tm_state(p_sql text)
returns text
language plpgsql
as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$f$;
create function pg_temp.tm_selects()
returns table (tbl text, state text)
language sql
as $f$
  select t.t, pg_temp.tm_state('select count(*) from public.' || t.t)
  from unnest(array['brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations'])
       with ordinality as t (t, n)
  order by t.n
$f$;
create function pg_temp.tm_writes()
returns table (tbl text, op text, state text)
language sql
as $f$
  select t.t, o.o, pg_temp.tm_state(case o.o
      when 'insert' then 'insert into public.' || t.t || ' default values'
      when 'update' then 'update public.' || t.t || ' set version = version'
      when 'delete' then 'delete from public.' || t.t
      else 'truncate public.' || t.t end)
  from unnest(array['brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations'])
       with ordinality as t (t, n)
  cross join unnest(array['insert', 'update', 'delete', 'truncate']) with ordinality as o (o, m)
  order by t.n, o.m
$f$;
grant execute on function pg_temp.tm_visible(), pg_temp.tm_state(text), pg_temp.tm_selects(), pg_temp.tm_writes()
  to anon, authenticated, service_role;

-- The expected outcome of tm_writes for a caller without any write grant: 42501 everywhere.
create temporary table tm_no_writes on commit drop as
select t.t as tbl, o.o as op, '42501'::text as state
from unnest(array['brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations'])
     with ordinality as t (t, n)
cross join unnest(array['insert', 'update', 'delete', 'truncate']) with ordinality as o (o, m)
order by t.n, o.m;
grant select on pg_temp.tm_no_writes to anon, authenticated, service_role;

-- =================================================================================================
-- Catalog: RLS, policies and grants on the seven tables and the PR 1.4 functions.
-- =================================================================================================
select results_eq(
  $$ select c.relname::text collate "default", c.relrowsecurity, c.relforcerowsecurity
     from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')
     order by c.relname::text collate "C" $$,
  $$ values ('brands', true, false), ('call_types', true, false), ('collection_locations', true, false),
            ('customers', true, false), ('followup_reasons', true, false), ('products', true, false),
            ('suppliers', true, false) $$,
  'RLS is enabled on the seven tables (not forced: the SECURITY DEFINER bodies run as the owner)');
select results_eq(
  $$ select p.tablename::text collate "default", p.policyname::text collate "default", p.permissive collate "default",
            p.roles::text collate "default", p.cmd collate "default", p.qual collate "default", p.with_check collate "default"
     from pg_policies p
     where p.schemaname = 'public'
       and p.tablename in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')
     order by p.tablename collate "C", p.policyname collate "C" $$,
  $$ values
     ('brands', 'brands_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission))', null::text),
     ('call_types', 'call_types_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '( SELECT private.is_office_user() AS is_office_user)', null),
     ('call_types', 'call_types_select_technician', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(is_active AND ( SELECT private.has_role(''technician''::text) AS has_role))', null),
     ('collection_locations', 'collection_locations_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '( SELECT private.is_office_user() AS is_office_user)', null),
     ('collection_locations', 'collection_locations_select_technician', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(is_active AND ( SELECT private.has_role(''technician''::text) AS has_role))', null),
     ('customers', 'customers_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission))', null),
     ('followup_reasons', 'followup_reasons_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '( SELECT private.is_office_user() AS is_office_user)', null),
     ('followup_reasons', 'followup_reasons_select_technician', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(is_active AND ( SELECT private.has_role(''technician''::text) AS has_role))', null),
     ('products', 'products_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission))', null),
     ('suppliers', 'suppliers_select_office', 'PERMISSIVE', '{authenticated}', 'SELECT',
      '(( SELECT private.has_permission(''cal''::text) AS has_permission) OR ( SELECT private.has_permission(''calls''::text) AS has_permission))', null) $$,
  'exactly ten SELECT policies, all TO authenticated: cal/calls for the four data tables (TEMPORARY OQ-2), office users and active rows for Technicians on the Settings tables; no write policy');
select results_eq(
  $$ select c.relname::text collate "default", a.grantee::regrole::text, a.privilege_type::text
     from pg_class c cross join lateral aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')
       and a.grantee <> c.relowner
     order by c.relname::text collate "C", 2, 3 $$,
  $$ values ('brands', 'authenticated', 'SELECT'), ('call_types', 'authenticated', 'SELECT'),
            ('collection_locations', 'authenticated', 'SELECT'), ('customers', 'authenticated', 'SELECT'),
            ('followup_reasons', 'authenticated', 'SELECT'), ('products', 'authenticated', 'SELECT'),
            ('suppliers', 'authenticated', 'SELECT') $$,
  'table grants are exact: SELECT for authenticated only; nothing for anon, service_role or PUBLIC, and no write privilege for anyone');
select is(
  (select count(*) from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')
     and (c.relacl is null or c.relowner <> 'postgres'::regrole))
  + (select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')
       and a.attacl is not null),
  0::bigint, 'the seven tables are owned by postgres with explicit ACLs and no column-level grants');
select results_eq(
  $$ select p.oid::regprocedure::text collate "default", coalesce(a.grantee::regrole::text, '(none)'),
            coalesce(a.privilege_type::text, '(none)')
     from pg_proc p
     left join lateral aclexplode(p.proacl) a on a.grantee <> p.proowner
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.proname in ('add_call_type', 'set_call_type_active', 'add_followup_reason', 'set_followup_reason_active',
                         'delete_followup_reason', 'add_collection_location', 'set_collection_location_active',
                         'delete_collection_location', 'tg_immutable_except', 'tg_one_way_product_refs',
                         'tg_followup_reason_delete_guard')
     order by p.oid::regprocedure::text collate "C", 2, 3 $$,
  $$ values
     ('add_call_type(text)', 'authenticated', 'EXECUTE'),
     ('add_collection_location(text,text,text,text,text)', 'authenticated', 'EXECUTE'),
     ('add_followup_reason(text)', 'authenticated', 'EXECUTE'),
     ('delete_collection_location(uuid,integer)', 'authenticated', 'EXECUTE'),
     ('delete_followup_reason(uuid,integer)', 'authenticated', 'EXECUTE'),
     ('private.add_call_type(text)', 'authenticated', 'EXECUTE'),
     ('private.add_collection_location(text,text,text,text,text)', 'authenticated', 'EXECUTE'),
     ('private.add_followup_reason(text)', 'authenticated', 'EXECUTE'),
     ('private.delete_collection_location(uuid,integer)', 'authenticated', 'EXECUTE'),
     ('private.delete_followup_reason(uuid,integer)', 'authenticated', 'EXECUTE'),
     ('private.set_call_type_active(uuid,boolean,integer)', 'authenticated', 'EXECUTE'),
     ('private.set_collection_location_active(uuid,boolean,integer)', 'authenticated', 'EXECUTE'),
     ('private.set_followup_reason_active(uuid,boolean,integer)', 'authenticated', 'EXECUTE'),
     ('private.tg_followup_reason_delete_guard()', '(none)', '(none)'),
     ('private.tg_immutable_except()', '(none)', '(none)'),
     ('private.tg_one_way_product_refs()', '(none)', '(none)'),
     ('set_call_type_active(uuid,boolean,integer)', 'authenticated', 'EXECUTE'),
     ('set_collection_location_active(uuid,boolean,integer)', 'authenticated', 'EXECUTE'),
     ('set_followup_reason_active(uuid,boolean,integer)', 'authenticated', 'EXECUTE') $$,
  'function grants are exact: EXECUTE for authenticated on the eight wrappers and eight bodies only; none on the three trigger functions; nothing for anon, service_role or PUBLIC');
select is(
  (select count(*) from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.proname in ('add_call_type', 'set_call_type_active', 'add_followup_reason', 'set_followup_reason_active',
                       'delete_followup_reason', 'add_collection_location', 'set_collection_location_active',
                       'delete_collection_location', 'tg_immutable_except', 'tg_one_way_product_refs',
                       'tg_followup_reason_delete_guard')
     and p.proacl is not null),
  19::bigint, 'each of the 19 PR 1.4 functions has an explicit ACL (a NULL ACL would mean the default EXECUTE for PUBLIC)');

-- =================================================================================================
-- Reads per role (D51 defaults).
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 2, suppliers 2, products 2, customers 2, call_types 3, followup_reasons 7, collection_locations 2',
  'Creator: reads every row, inactive and test rows included');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 2, suppliers 2, products 2, customers 2, call_types 3, followup_reasons 7, collection_locations 2',
  'Manager (cal and calls on): reads every row, inactive and test rows included');
select results_eq(
  $$ select p.sku_normalized, p.name, b.name, s.name from public.products p
     left join public.brands b on b.id = p.brand_id left join public.suppliers s on s.id = p.supplier_id
     order by p.sku_normalized collate "C" $$,
  $$ values ('KT-2041', 'מוצר בדיקה א', 'מותג פעיל', 'ספק פעיל'), ('KT-9001', 'מוצר בדיקה ב', null, null) $$,
  'Manager: reads a product with its brand and supplier');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 2, suppliers 2, products 2, customers 2, call_types 3, followup_reasons 7, collection_locations 2',
  'Customer Service (cal and calls on): reads every row, inactive and test rows included');
select results_eq(
  $$ select c.customer_number, c.name, c.phone, c.phone_alt from public.customers c order by c.customer_number collate "C" $$,
  $$ values ('C-1001', 'לקוח בדיקה א', '050-000-0001', '050-000-0002'), ('C-1002', 'לקוח בדיקה ב', '050-000-0003', null) $$,
  'Customer Service: reads the customers');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 2, followup_reasons 6, collection_locations 1',
  'Technician A: active Settings rows only; no customer, product, brand or supplier row (TEMPORARY OQ-12, until PR 1.5)');
select ok(
  (select bool_and(c.is_active) from public.call_types c) and (select bool_and(r.is_active) from public.followup_reasons r)
  and (select bool_and(l.is_active) from public.collection_locations l),
  'Technician A: every Settings row he reads is active (an inactive one never reaches the close screen)');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 2, followup_reasons 6, collection_locations 1',
  'Technician B: the same as Technician A');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 0, followup_reasons 0, collection_locations 0',
  'a deactivated Technician reads nothing');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 0, followup_reasons 0, collection_locations 0',
  'a deactivated Manager reads nothing');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 0, followup_reasons 0, collection_locations 0',
  'a deactivated Customer Service user reads nothing');
reset role;

-- Forged claims: roles never come from the JWT or Auth metadata.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated","user_role":"creator","app_metadata":{"role":"creator"},"user_metadata":{"role":"creator"}}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 0, followup_reasons 0, collection_locations 0',
  'a signed-in user without a profile reads nothing, whatever his claims say');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated","user_role":"manager","app_metadata":{"role":"creator"},"user_metadata":{"role":"creator"}}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 2, followup_reasons 6, collection_locations 1',
  'a Technician with forged Manager and Creator claims still reads only active Settings rows');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"service_role","app_metadata":{"role":"creator"}}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 2, suppliers 2, products 2, customers 2, call_types 3, followup_reasons 7, collection_locations 2',
  'a service_role claim in the JWT neither widens nor narrows Customer Service''s reads');
reset role;

-- anon and service_role: no table grant (service_role bypasses RLS, not grants).
select set_config('request.jwt.claims', '', true);
set local role anon;
select results_eq($$ select * from pg_temp.tm_selects() $$,
  $$ values ('brands', '42501'), ('suppliers', '42501'), ('products', '42501'), ('customers', '42501'),
            ('call_types', '42501'), ('followup_reasons', '42501'), ('collection_locations', '42501') $$,
  'anon cannot read any of the seven tables (42501)');
reset role;
set local role service_role;
select results_eq($$ select * from pg_temp.tm_selects() $$,
  $$ values ('brands', '42501'), ('suppliers', '42501'), ('products', '42501'), ('customers', '42501'),
            ('call_types', '42501'), ('followup_reasons', '42501'), ('collection_locations', '42501') $$,
  'service_role cannot read any of the seven tables (42501: it bypasses RLS, not grants)');
reset role;

-- =================================================================================================
-- Matrix keys (D33, D51): either `cal` or `calls` reads the four data tables; `products`,
-- `dashProd` and `settings` grant no reads (TEMPORARY OQ-2); the Settings tables do not depend on
-- any key. Every change takes effect at the next query.
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('customer_service', 'cal', false, 1, null), 2, 'the Creator turns cal off for Customer Service');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 2, suppliers 2, products 2, customers 2, call_types 3, followup_reasons 7, collection_locations 2',
  'Customer Service with calls only: still reads every row');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_set_role_permission('customer_service', 'cal', true, 2, null),
             public.admin_set_role_permission('customer_service', 'calls', false, 1, null)) $$,
  $$ values (3, 2) $$, 'the Creator turns cal back on and calls off for Customer Service');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 2, suppliers 2, products 2, customers 2, call_types 3, followup_reasons 7, collection_locations 2',
  'Customer Service with cal only: still reads every row');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is(public.admin_set_role_permission('customer_service', 'cal', false, 3, null), 4, 'the Creator turns cal off as well');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 3, followup_reasons 7, collection_locations 2',
  'Customer Service with cal and calls off: no customer, product, brand or supplier row at the next query; the Settings tables stay readable');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_set_role_permission('customer_service', 'products', true, 1, null),
             public.admin_set_role_permission('customer_service', 'dashProd', true, 1, null),
             public.admin_set_role_permission('customer_service', 'settings', true, 1, null)) $$,
  $$ values (2, 2, 2) $$, 'the Creator turns products, dashProd and settings on for Customer Service');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 3, followup_reasons 7, collection_locations 2',
  'TEMPORARY OQ-2: products, dashProd and settings alone read no product, brand, supplier or customer row');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_set_role_permission('manager', 'cal', false, 1, null),
             public.admin_set_role_permission('manager', 'calls', false, 1, null)) $$,
  $$ values (2, 2) $$, 'the Creator turns cal and calls off for Managers (products and dashProd stay on)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 3, followup_reasons 7, collection_locations 2',
  'Manager with cal and calls off: no customer, product, brand or supplier row, although he holds products and dashProd');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_set_role_permission('manager', 'calls', true, 2, null),
             public.admin_set_role_permission('customer_service', 'cal', true, 4, null)) $$,
  $$ values (3, 5) $$, 'the Creator turns calls back on for Managers and cal back on for Customer Service');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 2, suppliers 2, products 2, customers 2, call_types 3, followup_reasons 7, collection_locations 2',
  'Manager with calls on again: reads every row at the next query');
reset role;

-- =================================================================================================
-- Deactivations take effect at the next query: of a user, and of a Settings row.
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 2, suppliers 2, products 2, customers 2, call_types 3, followup_reasons 7, collection_locations 2',
  'an active Customer Service user reads every row before his deactivation');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ values (public.admin_set_user_active('00000000-0000-4000-8000-0000000000b3', false, 1, null),
             public.admin_set_user_active('00000000-0000-4000-8000-0000000000d2', false, 1, null)) $$,
  $$ values (2, 2) $$, 'the Creator deactivates a Customer Service user and Technician B');
select is(public.set_followup_reason_active((select r.id from public.followup_reasons r where r.label_he = 'נדרש ביקור נוסף'), false, 1), 2,
  'the Creator deactivates a D48 reason');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 0, followup_reasons 0, collection_locations 0',
  'the deactivated Customer Service user reads nothing at his next query');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.tm_visible(),
  'brands 0, suppliers 0, products 0, customers 0, call_types 0, followup_reasons 0, collection_locations 0',
  'the deactivated Technician B reads nothing at his next query');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*) from public.followup_reasons r where r.label_he = 'נדרש ביקור נוסף') * 10
  + (select count(*) from public.followup_reasons),
  5::bigint, 'Technician A no longer reads the deactivated reason (5 active rows remain; DEMO l.960)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select r.is_active from public.followup_reasons r where r.label_he = 'נדרש ביקור נוסף'), false,
  'office users still read the deactivated reason (Settings lists show inactive rows)');
reset role;

-- =================================================================================================
-- No direct writes for any API role (no INSERT, UPDATE, DELETE or TRUNCATE grant): products,
-- customers, brands and suppliers have no write path at all in PR 1.4 (TEMPORARY OQ-1, OQ-3);
-- the Settings tables change only through the RPCs (120_settings_rpcs).
-- =================================================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_writes() $$, $$ select * from pg_temp.tm_no_writes $$,
  'Creator: every direct INSERT, UPDATE, DELETE and TRUNCATE on the seven tables is refused (42501)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_writes() $$, $$ select * from pg_temp.tm_no_writes $$,
  'Manager (with products): every direct write on the seven tables is refused (42501)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_writes() $$, $$ select * from pg_temp.tm_no_writes $$,
  'Customer Service (with products and settings): every direct write on the seven tables is refused (42501)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select results_eq($$ select * from pg_temp.tm_writes() $$, $$ select * from pg_temp.tm_no_writes $$,
  'Technician: every direct write on the seven tables is refused (42501)');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select results_eq($$ select * from pg_temp.tm_writes() $$, $$ select * from pg_temp.tm_no_writes $$,
  'anon: every direct write on the seven tables is refused (42501)');
reset role;
set local role service_role;
select results_eq($$ select * from pg_temp.tm_writes() $$, $$ select * from pg_temp.tm_no_writes $$,
  'service_role: every direct write on the seven tables is refused (42501)');
reset role;
select is(pg_temp.tm_visible(),
  'brands 2, suppliers 2, products 2, customers 2, call_types 3, followup_reasons 7, collection_locations 2',
  'nothing was added or removed by the refused writes');

-- =================================================================================================
-- Structural checks (D19; TEMPORARY OQ-1, OQ-3): no function in public or private writes
-- products, customers, brands or suppliers, or touches the SKU or the customer number. When
-- update_product (OQ-1) or the brand and supplier RPCs (OQ-3) are built, they become the only
-- allowed matches and these checks are updated with them.
-- =================================================================================================
-- tm_writes_ref: whether a body writes one of the four tables. Double quotes and the spaces around
-- dots are removed first, so a quoted or spaced name ("public"."products", public . brands) is
-- found too (independent review SEC-4); the text is also read with its comments removed (a comment
-- between two keywords), and either reading counts, so removing comments can never hide a match.
create function pg_temp.tm_writes_ref(p_src text)
returns boolean
language sql
immutable
as $f$
  select bool_or(regexp_replace(regexp_replace(x.src, '"', '', 'g'), '\s*\.\s*', '.', 'g')
                 ~* '(insert\s+into|update|delete\s+from|merge\s+into|truncate(\s+table)?)\s+(only\s+)?(public\.)?(products|customers|brands|suppliers)\M')
  from (values (p_src),
               (regexp_replace(regexp_replace(p_src, '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g'))) x (src)
$f$;
select results_eq(
  $$ select v.label, pg_temp.tm_writes_ref(v.src) from (values
       (1, 'plain', 'insert into public.products (x) values (1)'),
       (2, 'quoted schema and table', 'insert into "public"."products" (x) values (1)'),
       (3, 'quoted schema', 'update "public".customers set name = 1'),
       (4, 'spaces around the dot', 'insert into public . brands (name) values (1)'),
       (5, 'ONLY and a quoted table', 'delete from only "suppliers" where true'),
       (6, 'merge', 'merge into public.products p using x on true when matched then do nothing'),
       (7, 'truncate table, quoted', 'truncate table "public"."customers"'),
       (8, 'block comment between the keywords', 'insert /* note */ into public.products (x) values (1)'),
       (9, 'line comment between the keywords', 'insert -- note' || chr(10) || 'into public.brands (name) values (1)'),
       (10, 'upper case across lines', 'UPDATE' || chr(10) || '  PUBLIC.' || chr(10) || 'Products SET name = 1'),
       (11, 'a read only (negative control)', 'select p.name from public.products p'),
       (12, 'another table with the same prefix (negative control)', 'insert into public.products_archive (x) values (1)'),
       (13, 'a Settings table (negative control)', 'update public.call_types set is_active = false')
     ) v (n, label, src) order by v.n $$,
  $$ values ('plain', true), ('quoted schema and table', true), ('quoted schema', true), ('spaces around the dot', true),
            ('ONLY and a quoted table', true), ('merge', true), ('truncate table, quoted', true),
            ('block comment between the keywords', true), ('line comment between the keywords', true),
            ('upper case across lines', true), ('a read only (negative control)', false),
            ('another table with the same prefix (negative control)', false), ('a Settings table (negative control)', false) $$,
  'positive and negative controls: the structural write check finds quoted, spaced and commented forms (review SEC-4)');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and pg_temp.tm_writes_ref(p.prosrc) $$,
  'no function inserts into, updates, deletes from, merges into or truncates products, customers, brands or suppliers');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.prosrc ~* '\m(sku_display|sku_normalized|customer_number)\M' $$,
  'no function touches the SKU or the customer number (D19: the SKU never changes; D39: the customer number never changes)');
select results_eq(
  $$ select p.oid::regprocedure::text collate "default" from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.proname ~ '(product|customer|brand|supplier)'
     order by p.oid::regprocedure::text collate "C" $$,
  $$ values ('private.tg_one_way_product_refs()') $$,
  'no product, customer, brand or supplier RPC exists (no update_product, add_brand, add_supplier ...); only the one-way trigger function');
select results_eq(
  $$ select distinct t.tgfoid::regprocedure::text collate "default" from pg_trigger t
     where t.tgrelid in ('public.products'::regclass, 'public.customers'::regclass, 'public.brands'::regclass, 'public.suppliers'::regclass)
       and not t.tgisinternal
     order by t.tgfoid::regprocedure::text collate "default" $$,
  $$ values ('private.tg_bump_version()'), ('private.tg_immutable_except()'), ('private.tg_immutable_markers()'),
            ('private.tg_one_way_people()'), ('private.tg_one_way_product_refs()'), ('private.tg_reject_delete()'),
            ('private.tg_reject_truncate()') $$,
  'the triggers on products, customers, brands and suppliers run only the reviewed guard functions (none of them writes)');

select * from finish();
rollback;
