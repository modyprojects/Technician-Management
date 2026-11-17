-- Canary rows for migration 20261105120000_reference_customers_products.sql (PR 1.4), for
-- scripts/db-canary.mjs (docs/testing.md "Canary rows check", tests/db-canary/README.md).
--
-- Written against the schema as of that migration; never edited after it is merged (add rows in a
-- later fixture instead). Fictional, test-marked (is_test = true, D47; on products and customers
-- the generated is_test is true because data_source is a test source), no e-mail addresses,
-- explicit ids and timestamps; no sequence is consumed (audit ids use OVERRIDING SYSTEM VALUE and
-- continue the PR 1.3 fixture's chain). Inserted directly as postgres in one transaction: the
-- Settings RPCs need a signed-in caller, and products and customers have no write path yet. Every
-- trigger, CHECK and the one-way rule (D47) still apply to these inserts.
--
-- The rows reference only the PR 1.3 canary Manager (c0000000-0000-4000-8000-000000001001, a test
-- profile) and each other. The owner-approved D48 rows (2 call types with sort orders 1 and 2, 5
-- continuation reasons with 1 to 5) are left untouched; the canary rows take sort orders from 1000001 up
-- and labels a later reference row will not use, so a later migration's own inserts cannot collide
-- with them. Text values follow the migration's text rules (NFC and NFKC, plain Hebrew letters,
-- single U+0020 spaces, ASCII SKUs and customer numbers). No coverage exception is needed: every
-- column of the seven new tables is non-null in at least one row below.

-- Brands and suppliers (CHECK is_test until go-live, OQ-4): an active row with every column set and
-- a deactivated row (version bumped once).
insert into public.brands (id, name, is_active, is_test, created_at, created_by, updated_at, updated_by, version)
values
  ('c0000000-0000-4000-8000-000000004001', 'מותג קנרית', true, true, '2026-01-15 08:00:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-01-15 08:00:00+00', 'c0000000-0000-4000-8000-000000001001', 1),
  ('c0000000-0000-4000-8000-000000004002', 'מותג קנרית ישן', false, true, '2026-01-15 08:10:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-01-16 08:10:00+00', 'c0000000-0000-4000-8000-000000001001', 2);

insert into public.suppliers (id, name, is_active, is_test, created_at, created_by, updated_at, updated_by, version)
values
  ('c0000000-0000-4000-8000-000000004101', 'ספק קנרית', true, true, '2026-01-15 08:20:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-01-15 08:20:00+00', 'c0000000-0000-4000-8000-000000001001', 1),
  ('c0000000-0000-4000-8000-000000004102', 'ספק קנרית ישן', false, true, '2026-01-15 08:30:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-01-16 08:30:00+00', 'c0000000-0000-4000-8000-000000001001', 2);

-- Products (is_test is generated from data_source and not inserted): a simulator product with a
-- brand, a supplier and a later name change (lower-case SKU letter, so sku_normalized differs from
-- sku_display), and an automated-test product without brand, supplier or creator.
insert into public.products (id, sku_display, sku_normalized, name, brand_id, supplier_id, data_source, source_ref,
                             created_at, created_by, updated_at, updated_by, version)
values
  ('c0000000-0000-4000-8000-000000005001', 'CNRY-1001-a', 'CNRY-1001-A', 'מוצר קנרית',
   'c0000000-0000-4000-8000-000000004001', 'c0000000-0000-4000-8000-000000004101', 'simulator',
   'canary:sim-event:0001', '2026-01-17 08:00:00+00', 'c0000000-0000-4000-8000-000000001001',
   '2026-01-18 08:00:00+00', 'c0000000-0000-4000-8000-000000001001', 2),
  ('c0000000-0000-4000-8000-000000005002', 'CNRY 1002', 'CNRY 1002', 'מוצר קנרית ללא מותג', null, null,
   'automated_test', 'canary.test-run.0002', '2026-01-17 09:00:00+00', null, '2026-01-17 09:00:00+00', null, 1);

-- Customers (is_test generated): a simulator customer with an alternate phone and a later phone
-- update, and an automated-test customer without an alternate phone or creator.
insert into public.customers (id, customer_number, name, phone, phone_alt, data_source, source_ref,
                              created_at, created_by, updated_at, updated_by, version)
values
  ('c0000000-0000-4000-8000-000000006001', 'CANARY-0001', 'לקוח קנרית', '050-000-0101', '+972 3 000 0102',
   'simulator', 'canary:sim-event:0001', '2026-01-17 08:00:00+00', 'c0000000-0000-4000-8000-000000001001',
   '2026-01-18 08:30:00+00', 'c0000000-0000-4000-8000-000000001001', 2),
  ('c0000000-0000-4000-8000-000000006002', 'CANARY 0002', 'לקוחה קנרית', '03-000-0103', null,
   'automated_test', 'canary.test-run.0002', '2026-01-17 09:00:00+00', null, '2026-01-17 09:00:00+00', null, 1);

-- Call types added in the app (CHECK is_test or created_by is null, OQ-4): an active one and a
-- deactivated one.
insert into public.call_types (id, label_he, sort_order, is_active, is_test, created_at, created_by, updated_at,
                               updated_by, version)
values
  ('c0000000-0000-4000-8000-000000007001', 'סוג קנרית', 1000001, true, true, '2026-01-19 08:00:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-01-19 08:00:00+00', 'c0000000-0000-4000-8000-000000001001', 1),
  ('c0000000-0000-4000-8000-000000007002', 'סוג קנרית לא פעיל', 1000002, false, true, '2026-01-19 08:10:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-01-20 08:10:00+00', 'c0000000-0000-4000-8000-000000001001', 2);

-- User-added continuation reasons (is_user_added = created_by is not null; is_test, OQ-4): an
-- active one and a deactivated one.
insert into public.followup_reasons (id, label_he, sort_order, is_active, is_user_added, is_test, created_at,
                                     created_by, updated_at, updated_by, version)
values
  ('c0000000-0000-4000-8000-000000008001', 'סיבת קנרית', 1000001, true, true, true, '2026-01-19 09:00:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-01-19 09:00:00+00', 'c0000000-0000-4000-8000-000000001001', 1),
  ('c0000000-0000-4000-8000-000000008002', 'סיבת קנרית לא פעילה', 1000002, false, true, true,
   '2026-01-19 09:10:00+00', 'c0000000-0000-4000-8000-000000001001', '2026-01-20 09:10:00+00',
   'c0000000-0000-4000-8000-000000001001', 2);

-- Pickup places (CHECK is_test until go-live, OQ-4): an active logistics center with phone and
-- opening hours, and a deactivated branch without them.
insert into public.collection_locations (id, name, place_type, sort_order, address, phone, opening_hours, is_active,
                                         is_test, created_at, created_by, updated_at, updated_by, version)
values
  ('c0000000-0000-4000-8000-000000009001', 'מרכז קנרית', 'logistics_center', 1000001, 'רחוב הקנרית 1, עיר בדיונית',
   '03-000-0104', 'ימים א-ה 08:00-16:00', true, true, '2026-01-19 10:00:00+00',
   'c0000000-0000-4000-8000-000000001001', '2026-01-19 10:00:00+00', 'c0000000-0000-4000-8000-000000001001', 1),
  ('c0000000-0000-4000-8000-000000009002', 'סניף קנרית', 'branch', 1000002, 'שדרות הקנרית 2, עיר בדיונית',
   null, null, false, true, '2026-01-19 10:10:00+00', 'c0000000-0000-4000-8000-000000001001',
   '2026-01-20 10:10:00+00', 'c0000000-0000-4000-8000-000000001001', 2);

-- Audit rows for the new Settings actions and target tables, continuing the PR 1.3 fixture's chain
-- (1000001 to 1000003). The BEFORE INSERT triggers set occurred_at, target_is_test (true, from the
-- target rows above), prev_hash and row_hash exactly as for private.write_audit.
insert into public.audit_logs (id, actor_profile_id, action, target_table, target_id, details)
overriding system value
values (1000004, 'c0000000-0000-4000-8000-000000001001', 'call_type.created', 'call_types',
        'c0000000-0000-4000-8000-000000007001', '{}');
insert into public.audit_logs (id, actor_profile_id, action, target_table, target_id, details)
overriding system value
values (1000005, 'c0000000-0000-4000-8000-000000001001', 'followup_reason.deactivated', 'followup_reasons',
        'c0000000-0000-4000-8000-000000008002', '{}');
insert into public.audit_logs (id, actor_profile_id, action, target_table, target_id, details)
overriding system value
values (1000006, 'c0000000-0000-4000-8000-000000001001', 'collection_location.deactivated', 'collection_locations',
        'c0000000-0000-4000-8000-000000009002', '{}');
