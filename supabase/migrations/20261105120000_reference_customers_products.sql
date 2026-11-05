-- Step 1 / PR 1.4 — Migration 2: reference data, customers and products.
--
-- Sources: docs/database-schema.md (§1, §2, §4 "Migration 2", §8.2-8.4, §9, §10), docs/security.md
-- (§5, §7, §8, §9), decisions D17, D19, D33, D35, D39, D47, D48, D51, docs/demo-deviations.md
-- (PR-01 to PR-07, SE-06, SE-07, SE-16) and the PR 1.4 plan (docs/review/step1-pr14/README.md
-- lists the deviations and the TEMPORARY behaviours).
--
-- Content: seven tables (brands, suppliers, products, customers, call_types, followup_reasons,
-- collection_locations), three trigger functions, the audit extension for the Settings actions
-- (TEMPORARY, owner question OQ-9), eight Settings RPC bodies and their eight SECURITY INVOKER
-- wrappers (key `settings`), ten SELECT policies, per-object grants, the census extension and the
-- owner-approved D48 initial values.
--
-- Data: schema plus the owner-approved D48 initial values only (2 call types, 5 continuation
-- reasons; D47, D48). No test or fictitious rows. brands, suppliers, products, customers and
-- collection_locations start empty (PR-01; database-schema.md §2).
--
-- TEMPORARY deny-by-default behaviour until the owner answers (docs/review/step1-pr14 §13):
--   OQ-1  no update_product (no product write path).          OQ-3  no brand or supplier writes.
--   OQ-2  products, brands, suppliers readable with cal/calls only.
--   OQ-4  every row created in the app is test data until go-live (RPCs set is_test = true;
--         CHECK (is_test) on brands, suppliers, collection_locations; CHECK (is_test or
--         created_by is null) on call_types and followup_reasons).
--   OQ-5  no rename.   OQ-6  closed place type list.   OQ-8  text, SKU, phone and size limits.
--   OQ-9  Settings actions audited; the Manager audit policy is unchanged.
--   OQ-10 customers.name and customers.phone NOT NULL.   OQ-12 no Technician reads of the
--         customer/product/brand/supplier row (PR 1.5).
--
-- Applying it to the remote project needs the owner's separate approval (D52 rule 4, D53), after
-- PR 1.3 is applied.
--
-- search_path (PR 1.3 final review SEC-1): every function pins search_path = pg_catalog, pg_temp;
-- every other object is named schema-qualified.
--
-- Error codes raised by the functions:
--   42501 "not authorized" (generic, also for unknown targets and ids of another table)
--   22023 "invalid input" (also every CHECK, NOT NULL or FK failure inside a body: no detail)
--   23505 "the value is already in use" (no detail)
--   55000 wrong state (list full, last active reason, initial reason, in use)
--   PT409 version conflict (PostgREST answers HTTP 409)
--   23514 integrity rule (triggers)

-- ---------------------------------------------------------------------------------------------
-- 0. Apply as postgres (see the PR 1.3 migration, section 0).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'apply this migration as postgres (current role: %)', current_user;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Tables. RLS on every table (no FORCE), every foreign key ON DELETE RESTRICT, no direct writes
--    for any API role (no grants). Text rules (TEMPORARY, OQ-8), written out in each CHECK:
--    TEXT-SAFE  x = btrim(x), a length range, NFC; no C0/C1 control, line or paragraph separator,
--               interlinear annotation (U+FFF9-FFFB) or Default_Ignorable_Code_Point (Unicode
--               DerivedCoreProperties: soft hyphen, zero-width characters, every bidi mark,
--               embedding, override and isolate, variation selectors, fillers, tag characters);
--               and no leading or trailing space other than U+0020 (Zs, U+2800), so a required
--               value never looks blank. Explicit code points written as ARE escapes in ASCII
--               strings (no invisible character in this file), not [[:cntrl:]], which depends on
--               the locale.
--    KEY-SAFE   TEXT-SAFE, plus no space other than U+0020 anywhere and no run of two spaces
--               (unique names and labels: no invisible or lookalike duplicate).
--    ASCII-ID   printable ASCII with single internal spaces (SKU, customer number): rejected,
--               never normalised, so a lookalike cannot create a second product or customer.
-- ---------------------------------------------------------------------------------------------

-- 1.1 brands and suppliers (D19: optional on a product). No write path yet (TEMPORARY, OQ-3).
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint brands_name_key unique
    constraint brands_name_check check (
      name = btrim(name) and char_length(name) between 1 and 60 and name is nfc normalized
      and name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]'
      and name !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'
      and name !~ '[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]' and name !~ ' {2}'),
  is_active boolean not null default true,
  -- Fails safe (D47); TEMPORARY (OQ-4): no real brand before go-live.
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint brands_version_check check (version >= 1),
  constraint brands_test_until_golive_check check (is_test)
);
comment on table public.brands is
  'Product brands (D19, optional). No write path in PR 1.4 (TEMPORARY, owner question OQ-3). Never deleted.';
alter table public.brands enable row level security;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint suppliers_name_key unique
    constraint suppliers_name_check check (
      name = btrim(name) and char_length(name) between 1 and 60 and name is nfc normalized
      and name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]'
      and name !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'
      and name !~ '[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]' and name !~ ' {2}'),
  is_active boolean not null default true,
  -- Fails safe (D47); TEMPORARY (OQ-4): no real supplier before go-live.
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint suppliers_version_check check (version >= 1),
  constraint suppliers_test_until_golive_check check (is_test)
);
comment on table public.suppliers is
  'Product suppliers (D19, optional). No write path in PR 1.4 (TEMPORARY, owner question OQ-3). Never deleted.';
alter table public.suppliers enable row level security;

-- 1.2 products (root table; D19, PR-01 to PR-07). Created only by the Step 6 ingestion writer
--     (INSERT ... ON CONFLICT (sku_normalized) DO NOTHING); no write path in PR 1.4 (OQ-1).
create table public.products (
  id uuid primary key default gen_random_uuid(),
  -- The SKU as first received, trimmed, never changed.
  sku_display text not null
    constraint products_sku_display_check check (
      char_length(sku_display) between 1 and 40 and sku_display ~ '^[!-~]+( [!-~]+)*$'),
  -- D19: one product per SKU (trimmed, upper-cased). COLLATE "C" pins upper() to ASCII, so the
  -- rule cannot change with the server's locale or library.
  sku_normalized text not null
    constraint products_sku_normalized_key unique
    constraint products_sku_normalized_check check (sku_normalized = upper(sku_display collate "C")),
  name text not null
    constraint products_name_check check (
      name = btrim(name) and char_length(name) between 1 and 120 and name is nfc normalized
      and name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]'
      and name !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  brand_id uuid references public.brands (id) on delete restrict,
  supplier_id uuid references public.suppliers (id) on delete restrict,
  -- Fails closed: 'microsoft_graph' is added only by an approved Step 11 migration.
  data_source text not null
    constraint products_data_source_check check (data_source in ('simulator', 'automated_test')),
  -- An opaque identifier (simulator event id or test-run id), never invitation text or PII.
  source_ref text not null
    constraint products_source_ref_check check (source_ref ~ '^[A-Za-z0-9._:-]{1,200}$'),
  -- D47: every source except the explicitly real one counts as test.
  is_test boolean generated always as (data_source <> 'microsoft_graph') stored,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint products_version_check check (version >= 1),
  -- Parent of the PR 1.5 composite foreign key (product_id, is_test).
  constraint products_id_is_test_key unique (id, is_test),
  constraint products_simulator_creator_check check (data_source <> 'simulator' or created_by is not null)
);
create index products_brand_id_idx on public.products (brand_id);
create index products_supplier_id_idx on public.products (supplier_id);
comment on table public.products is
  'Products built from invitations (D19). The SKU never changes; existing names are never overwritten by ingestion. No write path in PR 1.4 (TEMPORARY, owner question OQ-1). Never deleted.';
alter table public.products enable row level security;

-- 1.3 customers (root table; D17, D39). Address and arrival notes are per visit. Created and
--     updated only by the Step 6 ingestion writer (phones) and the PR 1.6 review (name).
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  -- D17: required and unique; exact value (TEMPORARY format, OQ-8).
  customer_number text not null
    constraint customers_customer_number_key unique
    constraint customers_customer_number_check check (
      char_length(customer_number) between 1 and 40 and customer_number ~ '^[!-~]+( [!-~]+)*$'),
  -- NOT NULL: TEMPORARY (OQ-10).
  name text not null
    constraint customers_name_check check (
      name = btrim(name) and char_length(name) between 1 and 120 and name is nfc normalized
      and name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]'
      and name !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  -- NOT NULL: TEMPORARY (OQ-10). At least 3 digits, "+" only first, single separators.
  phone text not null
    constraint customers_phone_check check (phone ~ '^\+?[0-9]([ -]?[0-9]){2,}$' and char_length(phone) <= 20),
  phone_alt text
    constraint customers_phone_alt_check check (phone_alt ~ '^\+?[0-9]([ -]?[0-9]){2,}$' and char_length(phone_alt) <= 20),
  data_source text not null
    constraint customers_data_source_check check (data_source in ('simulator', 'automated_test')),
  source_ref text not null
    constraint customers_source_ref_check check (source_ref ~ '^[A-Za-z0-9._:-]{1,200}$'),
  is_test boolean generated always as (data_source <> 'microsoft_graph') stored,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint customers_version_check check (version >= 1),
  constraint customers_id_is_test_key unique (id, is_test),
  constraint customers_simulator_creator_check check (data_source <> 'simulator' or created_by is not null)
);
comment on table public.customers is
  'Customers (D17, D39). The customer number never changes. No write path in PR 1.4 (Step 6 ingestion, PR 1.6 review). Never deleted.';
alter table public.customers enable row level security;

-- 1.4 call_types (D35, D48; guard reference table). Deactivate only, never deleted.
create table public.call_types (
  id uuid primary key default gen_random_uuid(),
  label_he text not null
    constraint call_types_label_he_key unique
    constraint call_types_label_he_check check (
      label_he = btrim(label_he) and char_length(label_he) between 1 and 60 and label_he is nfc normalized
      and label_he !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]'
      and label_he !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'
      and label_he !~ '[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]' and label_he !~ ' {2}'),
  sort_order integer not null
    constraint call_types_sort_order_key unique
    constraint call_types_sort_order_check check (sort_order >= 1),
  is_active boolean not null default true,
  -- D48 rows take the default false (guard rules 1-2); the Settings RPC sets true (OQ-4).
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint call_types_version_check check (version >= 1),
  -- TEMPORARY (OQ-4): a row created in the app (it always has created_by) is never real.
  constraint call_types_real_from_migration_check check (is_test or created_by is null)
);
comment on table public.call_types is
  'Call types (D35, D48). Written only by private.add_call_type and private.set_call_type_active (key settings). Never deleted.';
alter table public.call_types enable row level security;

-- 1.5 followup_reasons (D35, D48, SE-07; guard reference table).
create table public.followup_reasons (
  id uuid primary key default gen_random_uuid(),
  label_he text not null
    constraint followup_reasons_label_he_key unique
    constraint followup_reasons_label_he_check check (
      label_he = btrim(label_he) and char_length(label_he) between 1 and 60 and label_he is nfc normalized
      and label_he !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]'
      and label_he !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'
      and label_he !~ '[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]' and label_he !~ ' {2}'),
  sort_order integer not null
    constraint followup_reasons_sort_order_key unique
    constraint followup_reasons_sort_order_check check (sort_order >= 1),
  is_active boolean not null default true,
  -- An initial D48 reason is never deleted; a user-added one only while unused (SE-07).
  is_user_added boolean not null default false,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint followup_reasons_version_check check (version >= 1),
  constraint followup_reasons_user_added_check check (is_user_added = (created_by is not null)),
  constraint followup_reasons_real_from_migration_check check (is_test or created_by is null)
);
comment on table public.followup_reasons is
  'Continuation reasons (D35, D48, SE-07). Written only by private.add_followup_reason, private.set_followup_reason_active and private.delete_followup_reason (key settings). At least one stays active.';
alter table public.followup_reasons enable row level security;

-- 1.6 collection_locations: pickup places (SE-06, IN-03). The type column follows the demo
--     (SE-06 KEEP; closed list TEMPORARY, OQ-6). Deleted only while nothing references it.
create table public.collection_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint collection_locations_name_key unique
    constraint collection_locations_name_check check (
      name = btrim(name) and char_length(name) between 1 and 60 and name is nfc normalized
      and name !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]'
      and name !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'
      and name !~ '[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]' and name !~ ' {2}'),
  place_type text not null
    constraint collection_locations_place_type_check check (place_type in ('logistics_center', 'branch')),
  sort_order integer not null
    constraint collection_locations_sort_order_key unique
    constraint collection_locations_sort_order_check check (sort_order >= 1),
  address text not null
    constraint collection_locations_address_check check (
      address = btrim(address) and char_length(address) between 1 and 120 and address is nfc normalized
      and address !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]'
      and address !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  phone text
    constraint collection_locations_phone_check check (
      phone = btrim(phone) and char_length(phone) between 1 and 120 and phone is nfc normalized
      and phone !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]'
      and phone !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  opening_hours text
    constraint collection_locations_opening_hours_check check (
      opening_hours = btrim(opening_hours) and char_length(opening_hours) between 1 and 120
      and opening_hours is nfc normalized
      and opening_hours !~ '[\u0001-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]'
      and opening_hours !~ '^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$'),
  is_active boolean not null default true,
  -- Fails safe (D47); TEMPORARY (OQ-4): no real place before go-live.
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  version integer not null default 1 constraint collection_locations_version_check check (version >= 1),
  constraint collection_locations_test_until_golive_check check (is_test)
);
comment on table public.collection_locations is
  'Pickup places (SE-06). Written only by private.add_collection_location, private.set_collection_location_active and private.delete_collection_location (key settings).';
alter table public.collection_locations enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 2. Trigger functions (SECURITY INVOKER, search_path pg_catalog, pg_temp, no dynamic SQL, no
--    grants). None of them writes data.
-- ---------------------------------------------------------------------------------------------

-- Every column not named in the trigger arguments is immutable, for every role. Without
-- arguments TG_ARGV is NULL and "jsonb - NULL" is NULL, which would freeze nothing: refused.
create function private.tg_immutable_except()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_nargs = 0 then
    raise exception using errcode = '55000', message = tg_table_name || ': misconfigured trigger (no mutable columns named)';
  end if;
  if (to_jsonb(new) - tg_argv) is distinct from (to_jsonb(old) - tg_argv) then
    raise exception using errcode = '55000', message = tg_table_name || ': these fields are immutable';
  end if;
  return new;
end
$$;

-- One-way rule (D47; database-schema.md §2): a real product never references a test brand or
-- supplier. AFTER INSERT OR UPDATE OF brand_id, supplier_id, when the generated is_test is set.
create function private.tg_one_way_product_refs()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.is_test is true then
    return new;
  end if;
  if (new.brand_id is not null and exists (select 1 from public.brands b where b.id = new.brand_id and b.is_test))
     or (new.supplier_id is not null and exists (select 1 from public.suppliers s where s.id = new.supplier_id and s.is_test)) then
    raise exception using errcode = '23514',
      message = 'products: a real product cannot reference a test brand or supplier (D47)';
  end if;
  return new;
end
$$;

-- SE-07: only a user-added reason may be deleted (the RPC also requires that it is unused). It
-- raises instead of returning NULL, so a refused delete never passes silently.
create function private.tg_followup_reason_delete_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if not old.is_user_added then
    raise exception using errcode = '55000',
      message = 'followup_reasons: the initial reasons are never deleted; deactivate it instead';
  end if;
  return old;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Attach the triggers. Name prefixes fix the firing order (BEFORE triggers run by name):
--    t10 immutability, t20 markers, t30 one-way, t90 version, t95 delete, t99 truncate; a30/a31
--    are AFTER row triggers on the two root tables, where is_test is a stored generated column:
--    BEFORE triggers see it as NULL (PostgreSQL computes it after them), so the one-way checks run
--    after the row is formed, and the markers are frozen by t10 (data_source) and generation.
-- ---------------------------------------------------------------------------------------------
create trigger t10_immutable before update on public.brands
  for each row execute function private.tg_immutable_except('is_active', 'version', 'updated_at', 'updated_by');
create trigger t20_immutable_markers before update on public.brands
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.brands
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');
create trigger t90_bump_version before update on public.brands
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.brands
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.brands
  for each statement execute function private.tg_reject_truncate();

create trigger t10_immutable before update on public.suppliers
  for each row execute function private.tg_immutable_except('is_active', 'version', 'updated_at', 'updated_by');
create trigger t20_immutable_markers before update on public.suppliers
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.suppliers
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');
create trigger t90_bump_version before update on public.suppliers
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.suppliers
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.suppliers
  for each statement execute function private.tg_reject_truncate();

-- products: the SKU, the source and the creation fields never change. is_test is listed only
-- because a BEFORE trigger reads it as NULL; it is generated from the frozen data_source.
create trigger t10_immutable before update on public.products
  for each row execute function private.tg_immutable_except(
    'name', 'brand_id', 'supplier_id', 'version', 'updated_at', 'updated_by', 'is_test');
create trigger t90_bump_version before update on public.products
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.products
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.products
  for each statement execute function private.tg_reject_truncate();
create trigger a30_one_way after insert or update on public.products
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');
create trigger a31_one_way_refs after insert or update of brand_id, supplier_id on public.products
  for each row execute function private.tg_one_way_product_refs();

-- customers: the customer number, the source and the creation fields never change (D39).
create trigger t10_immutable before update on public.customers
  for each row execute function private.tg_immutable_except(
    'name', 'phone', 'phone_alt', 'version', 'updated_at', 'updated_by', 'is_test');
create trigger t90_bump_version before update on public.customers
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.customers
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.customers
  for each statement execute function private.tg_reject_truncate();
create trigger a30_one_way after insert or update on public.customers
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');

-- Settings tables: labels, names, order and creation fields are frozen (no rename, OQ-5; no
-- reorder). Only is_active changes.
create trigger t10_immutable before update on public.call_types
  for each row execute function private.tg_immutable_except('is_active', 'version', 'updated_at', 'updated_by');
create trigger t20_immutable_markers before update on public.call_types
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.call_types
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');
create trigger t90_bump_version before update on public.call_types
  for each row execute function private.tg_bump_version();
create trigger t95_reject_delete before delete on public.call_types
  for each row execute function private.tg_reject_delete();
create trigger t99_reject_truncate before truncate on public.call_types
  for each statement execute function private.tg_reject_truncate();

create trigger t10_immutable before update on public.followup_reasons
  for each row execute function private.tg_immutable_except('is_active', 'version', 'updated_at', 'updated_by');
create trigger t20_immutable_markers before update on public.followup_reasons
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.followup_reasons
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');
create trigger t90_bump_version before update on public.followup_reasons
  for each row execute function private.tg_bump_version();
create trigger t95_delete_guard before delete on public.followup_reasons
  for each row execute function private.tg_followup_reason_delete_guard();
create trigger t99_reject_truncate before truncate on public.followup_reasons
  for each statement execute function private.tg_reject_truncate();

-- No delete trigger: SE-06 allows deleting an unreferenced place; the PR 1.5 foreign key from
-- visits (ON DELETE RESTRICT) protects referenced ones.
create trigger t10_immutable before update on public.collection_locations
  for each row execute function private.tg_immutable_except('is_active', 'version', 'updated_at', 'updated_by');
create trigger t20_immutable_markers before update on public.collection_locations
  for each row execute function private.tg_immutable_markers();
create trigger t30_one_way before insert or update on public.collection_locations
  for each row execute function private.tg_one_way_people('created_by', 'updated_by');
create trigger t90_bump_version before update on public.collection_locations
  for each row execute function private.tg_bump_version();
create trigger t99_reject_truncate before truncate on public.collection_locations
  for each statement execute function private.tg_reject_truncate();

-- ---------------------------------------------------------------------------------------------
-- 4. Audit extension (TEMPORARY, OQ-9): the Settings actions. Both CHECKs keep the 17 PR 1.3
--    actions and 4 target tables unchanged; existing rows are only re-validated, never rewritten.
-- ---------------------------------------------------------------------------------------------
alter table public.audit_logs
  drop constraint audit_logs_action_check,
  add constraint audit_logs_action_check check (action in (
    'matrix.value_set', 'matrix.value_approved',
    'account_request.created', 'account_request.approved', 'account_request.rejected', 'account_request.cancelled',
    'account_creation.authorized',
    'profile.created', 'profile.role_changed', 'profile.activated', 'profile.deactivated', 'profile.updated',
    'technician.created', 'technician.updated', 'technician.outlook_email_changed',
    'credentials.change_authorized', 'creator.bootstrapped',
    'call_type.created', 'call_type.activated', 'call_type.deactivated',
    'followup_reason.created', 'followup_reason.activated', 'followup_reason.deactivated', 'followup_reason.deleted',
    'collection_location.created', 'collection_location.activated', 'collection_location.deactivated',
    'collection_location.deleted'));
alter table public.audit_logs
  drop constraint audit_logs_target_table_check,
  add constraint audit_logs_target_table_check check (target_table in (
    'profiles', 'technicians', 'account_requests', 'role_permissions',
    'call_types', 'followup_reasons', 'collection_locations'));

-- BEFORE INSERT on audit_logs, first (replaces the PR 1.3 function; the triggers and the ACL are
-- kept): server time and target_is_test from the target row.
create or replace function private.tg_audit_target()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.occurred_at := now();
  new.target_is_test := case new.target_table
    when 'profiles' then (select p.is_test from public.profiles p where p.id = new.target_id)
    when 'technicians' then (select t.is_test from public.technicians t where t.id = new.target_id)
    when 'account_requests' then (select r.is_test from public.account_requests r where r.id = new.target_id)
    when 'role_permissions' then false
    when 'call_types' then (select x.is_test from public.call_types x where x.id = new.target_id)
    when 'followup_reasons' then (select x.is_test from public.followup_reasons x where x.id = new.target_id)
    when 'collection_locations' then (select x.is_test from public.collection_locations x where x.id = new.target_id)
  end;
  if new.target_is_test is null then
    raise exception using errcode = '23503', message = 'audit_logs: unknown audit target';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Settings RPC bodies (D35, D48, SE-06, SE-07, SE-16; key `settings`). SECURITY DEFINER
--    plpgsql in private, every reference schema-qualified, no dynamic SQL. Order in each body:
--    the caller (require_caller, profile locked FOR SHARE), the key, the input, advisory locks,
--    the target FOR UPDATE (unknown, another table's id, or a test caller with a real target:
--    the generic 42501), the version (PT409), no change (current version, no audit row), the
--    write, the audit row in the same transaction. Errors from the write carry no DETAIL (the
--    statement runs as the owner, so a DETAIL could show values the caller cannot read).
--    TEMPORARY (OQ-4): every row they create is test data (is_test = true), also for the real
--    Creator. Lists hold at most 100 rows (TEMPORARY, OQ-8).
-- ---------------------------------------------------------------------------------------------

-- 5.1 Call types.
create function private.add_call_type(p_label text)
returns table (created_id uuid, created_is_test boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_label text := btrim(p_label);
  v_sort integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('settings') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if coalesce(v_label, '') = '' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tm.call_types.sort_order', 0));
  if (select count(*) from public.call_types c) >= 100 then
    raise exception using errcode = '55000', message = 'the list is full';
  end if;
  select coalesce(max(c.sort_order), 0) + 1 into v_sort from public.call_types c;
  begin
    insert into public.call_types as c (label_he, sort_order, is_active, is_test, created_by, updated_by)
    values (v_label, v_sort, true, true, v_caller.id, v_caller.id)
    returning c.id, c.is_test into created_id, created_is_test;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'the value is already in use';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid input';
  end;
  perform private.write_audit('call_type.created', 'call_types', created_id, '{}'::jsonb);
  return next;
end
$$;

create function private.set_call_type_active(p_call_type_id uuid, p_active boolean, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_target public.call_types;
  v_version integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('settings') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_call_type_id is null or p_active is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select c.* into v_target from public.call_types c where c.id = p_call_type_id for update;
  if not found or (v_caller.is_test and not v_target.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_target.is_active = p_active then
    return v_target.version;
  end if;
  update public.call_types c set is_active = p_active, updated_by = v_caller.id
  where c.id = p_call_type_id
  returning c.version into v_version;
  perform private.write_audit(case when p_active then 'call_type.activated' else 'call_type.deactivated' end,
    'call_types', p_call_type_id, '{}'::jsonb);
  return v_version;
end
$$;

-- 5.2 Continuation reasons. At least one reason stays active (demo: "חייבת להישאר לפחות סיבה
--     אחת פעילה"); the advisory lock serialises concurrent deactivations and deletes, so two
--     callers cannot each remove "the other last" one. The count includes test and real rows.
create function private.add_followup_reason(p_label text)
returns table (created_id uuid, created_is_test boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_label text := btrim(p_label);
  v_sort integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('settings') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if coalesce(v_label, '') = '' then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tm.followup_reasons.sort_order', 0));
  if (select count(*) from public.followup_reasons r) >= 100 then
    raise exception using errcode = '55000', message = 'the list is full';
  end if;
  select coalesce(max(r.sort_order), 0) + 1 into v_sort from public.followup_reasons r;
  begin
    insert into public.followup_reasons as r (label_he, sort_order, is_active, is_user_added, is_test, created_by, updated_by)
    values (v_label, v_sort, true, true, true, v_caller.id, v_caller.id)
    returning r.id, r.is_test into created_id, created_is_test;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'the value is already in use';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid input';
  end;
  perform private.write_audit('followup_reason.created', 'followup_reasons', created_id, '{}'::jsonb);
  return next;
end
$$;

create function private.set_followup_reason_active(p_reason_id uuid, p_active boolean, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_target public.followup_reasons;
  v_version integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('settings') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_reason_id is null or p_active is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  if not p_active then
    perform pg_advisory_xact_lock(hashtextextended('tm.followup_reasons.active', 0));
  end if;
  select r.* into v_target from public.followup_reasons r where r.id = p_reason_id for update;
  if not found or (v_caller.is_test and not v_target.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_target.is_active = p_active then
    return v_target.version;
  end if;
  if not p_active
     and not exists (select 1 from public.followup_reasons r where r.is_active and r.id <> p_reason_id) then
    raise exception using errcode = '55000', message = 'at least one continuation reason must stay active';
  end if;
  update public.followup_reasons r set is_active = p_active, updated_by = v_caller.id
  where r.id = p_reason_id
  returning r.version into v_version;
  perform private.write_audit(case when p_active then 'followup_reason.activated' else 'followup_reason.deactivated' end,
    'followup_reasons', p_reason_id, '{}'::jsonb);
  return v_version;
end
$$;

-- SE-07: only a user-added reason that was never used. The audit row (with the label) is written
-- before the row is removed, because its trigger reads the target row; a delete that removes no
-- row fails, so no audit row is left without a delete. From PR 1.5 on, a reference from a visit
-- (foreign key) answers "in use; deactivate it instead" and rolls everything back.
create function private.delete_followup_reason(p_reason_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_target public.followup_reasons;
  v_deleted uuid;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('settings') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_reason_id is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tm.followup_reasons.active', 0));
  select r.* into v_target from public.followup_reasons r where r.id = p_reason_id for update;
  if not found or (v_caller.is_test and not v_target.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if not v_target.is_user_added then
    raise exception using errcode = '55000', message = 'the initial reasons are never deleted; deactivate it instead';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_target.is_active
     and not exists (select 1 from public.followup_reasons r where r.is_active and r.id <> p_reason_id) then
    raise exception using errcode = '55000', message = 'at least one continuation reason must stay active';
  end if;
  begin
    perform private.write_audit('followup_reason.deleted', 'followup_reasons', p_reason_id,
      jsonb_build_object('label', v_target.label_he));
    delete from public.followup_reasons r where r.id = p_reason_id
    returning r.id into v_deleted;
  exception
    when foreign_key_violation then
      raise exception using errcode = '55000', message = 'in use; deactivate it instead';
  end;
  if v_deleted is null then
    raise exception using errcode = '55000', message = 'the reason was not deleted';
  end if;
end
$$;

-- 5.3 Pickup places (SE-06).
create function private.add_collection_location(
  p_name text, p_place_type text, p_address text, p_phone text, p_opening_hours text)
returns table (created_id uuid, created_is_test boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_name text := btrim(p_name);
  v_address text := btrim(p_address);
  v_phone text := nullif(btrim(p_phone), '');
  v_hours text := nullif(btrim(p_opening_hours), '');
  v_sort integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('settings') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if coalesce(v_name, '') = '' or coalesce(v_address, '') = ''
     or p_place_type is null or p_place_type not in ('logistics_center', 'branch') then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tm.collection_locations.sort_order', 0));
  if (select count(*) from public.collection_locations l) >= 100 then
    raise exception using errcode = '55000', message = 'the list is full';
  end if;
  select coalesce(max(l.sort_order), 0) + 1 into v_sort from public.collection_locations l;
  begin
    insert into public.collection_locations as l (name, place_type, sort_order, address, phone, opening_hours,
                                                  is_active, is_test, created_by, updated_by)
    values (v_name, p_place_type, v_sort, v_address, v_phone, v_hours, true, true, v_caller.id, v_caller.id)
    returning l.id, l.is_test into created_id, created_is_test;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'the value is already in use';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid input';
  end;
  perform private.write_audit('collection_location.created', 'collection_locations', created_id, '{}'::jsonb);
  return next;
end
$$;

create function private.set_collection_location_active(p_location_id uuid, p_active boolean, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_target public.collection_locations;
  v_version integer;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('settings') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_location_id is null or p_active is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select l.* into v_target from public.collection_locations l where l.id = p_location_id for update;
  if not found or (v_caller.is_test and not v_target.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  if v_target.is_active = p_active then
    return v_target.version;
  end if;
  update public.collection_locations l set is_active = p_active, updated_by = v_caller.id
  where l.id = p_location_id
  returning l.version into v_version;
  perform private.write_audit(case when p_active then 'collection_location.activated' else 'collection_location.deactivated' end,
    'collection_locations', p_location_id, '{}'::jsonb);
  return v_version;
end
$$;

-- SE-06: only a place that nothing references (from PR 1.5 on, the foreign key from visits).
create function private.delete_collection_location(p_location_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_caller public.profiles;
  v_target public.collection_locations;
  v_deleted uuid;
begin
  v_caller := private.require_caller(array['creator', 'manager', 'customer_service']);
  if not private.has_permission('settings') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_location_id is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'invalid input';
  end if;
  select l.* into v_target from public.collection_locations l where l.id = p_location_id for update;
  if not found or (v_caller.is_test and not v_target.is_test) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_target.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version conflict';
  end if;
  begin
    perform private.write_audit('collection_location.deleted', 'collection_locations', p_location_id,
      jsonb_build_object('label', v_target.name));
    delete from public.collection_locations l where l.id = p_location_id
    returning l.id into v_deleted;
  exception
    when foreign_key_violation then
      raise exception using errcode = '55000', message = 'in use; deactivate it instead';
  end;
  if v_deleted is null then
    raise exception using errcode = '55000', message = 'the place was not deleted';
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Public API: thin SECURITY INVOKER wrappers, same names and arguments as the bodies. The add
--    commands return {id, is_test} as stored (docs/architecture-data-access.md).
-- ---------------------------------------------------------------------------------------------
create function public.add_call_type(p_label text)
returns table (id uuid, is_test boolean)
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select b.created_id, b.created_is_test from private.add_call_type(p_label) b $$;

create function public.set_call_type_active(p_call_type_id uuid, p_active boolean, p_expected_version integer)
returns integer
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select private.set_call_type_active(p_call_type_id, p_active, p_expected_version) $$;

create function public.add_followup_reason(p_label text)
returns table (id uuid, is_test boolean)
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select b.created_id, b.created_is_test from private.add_followup_reason(p_label) b $$;

create function public.set_followup_reason_active(p_reason_id uuid, p_active boolean, p_expected_version integer)
returns integer
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select private.set_followup_reason_active(p_reason_id, p_active, p_expected_version) $$;

create function public.delete_followup_reason(p_reason_id uuid, p_expected_version integer)
returns void
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select private.delete_followup_reason(p_reason_id, p_expected_version) $$;

create function public.add_collection_location(
  p_name text, p_place_type text, p_address text, p_phone text, p_opening_hours text)
returns table (id uuid, is_test boolean)
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select b.created_id, b.created_is_test from private.add_collection_location(p_name, p_place_type, p_address, p_phone, p_opening_hours) b $$;

create function public.set_collection_location_active(p_location_id uuid, p_active boolean, p_expected_version integer)
returns integer
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select private.set_collection_location_active(p_location_id, p_active, p_expected_version) $$;

create function public.delete_collection_location(p_location_id uuid, p_expected_version integer)
returns void
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$ select private.delete_collection_location(p_location_id, p_expected_version) $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Test-data census (replaces the PR 1.3 function; same signature, ACL and caller rule). The
--    root tables are counted per source in fixed rows, so an empty table still has its rows;
--    'other sources' catches any value added later.
-- ---------------------------------------------------------------------------------------------
create or replace function public.test_data_census()
returns table (table_name text, marker text, bucket text, test_rows bigint)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if not (private.is_creator()
          or (nullif(current_setting('request.jwt.claims', true), '') is null
              and nullif(current_setting('request.jwt.claim.sub', true), '') is null
              and current_user not in ('authenticated', 'anon', 'service_role'))) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  return query
    select 'profiles'::text, 'is_test'::text, 'all sources'::text, count(*) filter (where p.is_test)
    from public.profiles p
    union all
    select 'technicians', 'is_test', 'all sources', count(*) filter (where t.is_test)
    from public.technicians t
    union all
    select 'account_requests', 'is_test', 'all sources', count(*) filter (where r.is_test)
    from public.account_requests r
    union all
    select 'audit_logs', 'target_is_test', 'all sources', count(*) filter (where a.target_is_test)
    from public.audit_logs a
    union all
    select 'brands', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.brands x
    union all
    select 'suppliers', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.suppliers x
    union all
    select 'products', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.products x
    union all
    select 'products', 'is_test', 'automated_test', count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.products x
    union all
    select 'products', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.products x
    union all
    select 'customers', 'is_test', 'simulator', count(*) filter (where x.is_test and x.data_source = 'simulator')
    from public.customers x
    union all
    select 'customers', 'is_test', 'automated_test', count(*) filter (where x.is_test and x.data_source = 'automated_test')
    from public.customers x
    union all
    select 'customers', 'is_test', 'other sources',
           count(*) filter (where x.is_test and x.data_source not in ('simulator', 'automated_test'))
    from public.customers x
    union all
    select 'call_types', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.call_types x
    union all
    select 'followup_reasons', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.followup_reasons x
    union all
    select 'collection_locations', 'is_test', 'all sources', count(*) filter (where x.is_test)
    from public.collection_locations x
    union all
    select 'permissions', 'exempt', 'configuration catalogue (D33); no test variants', 0::bigint
    union all
    select 'role_permissions', 'exempt', 'configuration values (D33, D51); no test variants', 0::bigint
    union all
    select 'storage', 'none', 'no buckets in Step 1', 0::bigint;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. RLS policies: SELECT only, TO authenticated only, every one requires an active profile
--    (through the helpers), every column qualified with its table. No write or anon policies.
--    customers, products, brands, suppliers: office users with `cal` or `calls`
--    (database-schema.md §8.3; products, brands and suppliers TEMPORARY, OQ-2). Technicians read
--    none of them until PR 1.5 (OQ-12). Settings tables: every office user reads every row;
--    Technicians read active rows only.
-- ---------------------------------------------------------------------------------------------
create policy customers_select_office on public.customers for select to authenticated
  using ((select private.has_permission('cal')) or (select private.has_permission('calls')));
create policy products_select_office on public.products for select to authenticated
  using ((select private.has_permission('cal')) or (select private.has_permission('calls')));
create policy brands_select_office on public.brands for select to authenticated
  using ((select private.has_permission('cal')) or (select private.has_permission('calls')));
create policy suppliers_select_office on public.suppliers for select to authenticated
  using ((select private.has_permission('cal')) or (select private.has_permission('calls')));

create policy call_types_select_office on public.call_types for select to authenticated
  using ((select private.is_office_user()));
create policy call_types_select_technician on public.call_types for select to authenticated
  using (call_types.is_active and (select private.has_role('technician')));
create policy followup_reasons_select_office on public.followup_reasons for select to authenticated
  using ((select private.is_office_user()));
create policy followup_reasons_select_technician on public.followup_reasons for select to authenticated
  using (followup_reasons.is_active and (select private.has_role('technician')));
create policy collection_locations_select_office on public.collection_locations for select to authenticated
  using ((select private.is_office_user()));
create policy collection_locations_select_technician on public.collection_locations for select to authenticated
  using (collection_locations.is_active and (select private.has_role('technician')));

-- ---------------------------------------------------------------------------------------------
-- 9. Grants, per object (never PR 1.3's blanket revokes, which would strip its grants). Tables:
--    SELECT for authenticated, nothing else for anyone. Functions: EXECUTE for authenticated on
--    the eight wrappers and the eight bodies they call (each body checks its caller); none on the
--    trigger functions. Nothing for anon, service_role or PUBLIC. test_data_census() and
--    tg_audit_target() keep their PR 1.3 ACLs (CREATE OR REPLACE keeps them).
-- ---------------------------------------------------------------------------------------------
revoke all on table public.brands from public, anon, authenticated, service_role;
revoke all on table public.suppliers from public, anon, authenticated, service_role;
revoke all on table public.products from public, anon, authenticated, service_role;
revoke all on table public.customers from public, anon, authenticated, service_role;
revoke all on table public.call_types from public, anon, authenticated, service_role;
revoke all on table public.followup_reasons from public, anon, authenticated, service_role;
revoke all on table public.collection_locations from public, anon, authenticated, service_role;

grant select on public.brands, public.suppliers, public.products, public.customers, public.call_types,
  public.followup_reasons, public.collection_locations to authenticated;

revoke all on function private.tg_immutable_except() from public, anon, authenticated, service_role;
revoke all on function private.tg_one_way_product_refs() from public, anon, authenticated, service_role;
revoke all on function private.tg_followup_reason_delete_guard() from public, anon, authenticated, service_role;
revoke all on function private.add_call_type(text) from public, anon, authenticated, service_role;
revoke all on function private.set_call_type_active(uuid, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function private.add_followup_reason(text) from public, anon, authenticated, service_role;
revoke all on function private.set_followup_reason_active(uuid, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function private.delete_followup_reason(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function private.add_collection_location(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.set_collection_location_active(uuid, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function private.delete_collection_location(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.add_call_type(text) from public, anon, authenticated, service_role;
revoke all on function public.set_call_type_active(uuid, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function public.add_followup_reason(text) from public, anon, authenticated, service_role;
revoke all on function public.set_followup_reason_active(uuid, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function public.delete_followup_reason(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.add_collection_location(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.set_collection_location_active(uuid, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function public.delete_collection_location(uuid, integer) from public, anon, authenticated, service_role;

grant execute on function
  private.add_call_type(text),
  private.set_call_type_active(uuid, boolean, integer),
  private.add_followup_reason(text),
  private.set_followup_reason_active(uuid, boolean, integer),
  private.delete_followup_reason(uuid, integer),
  private.add_collection_location(text, text, text, text, text),
  private.set_collection_location_active(uuid, boolean, integer),
  private.delete_collection_location(uuid, integer),
  public.add_call_type(text),
  public.set_call_type_active(uuid, boolean, integer),
  public.add_followup_reason(text),
  public.set_followup_reason_active(uuid, boolean, integer),
  public.delete_followup_reason(uuid, integer),
  public.add_collection_location(text, text, text, text, text),
  public.set_collection_location_active(uuid, boolean, integer),
  public.delete_collection_location(uuid, integer)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. Owner-approved initial values (D48), last in the file. Defaults supply is_active = true,
--     is_test = false, is_user_added = false, created_by = null and version = 1. Validation with
--     customer service before go-live is owner task O3.
-- ---------------------------------------------------------------------------------------------
insert into public.call_types (label_he, sort_order) values
  ('תיקון', 1),
  ('התקנה', 2);

insert into public.followup_reasons (label_he, sort_order) values
  ('ממתין לחלקי חילוף', 1),
  ('נדרש ביקור נוסף', 2),
  ('נדרשת בדיקת מתקין', 3),
  ('הזמנת מוצר חדש', 4),
  ('לקוח לא נמצא', 5);
