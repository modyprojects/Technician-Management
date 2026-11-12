-- PR 1.4: schema of the reference, customer and product tables (Migration 2; docs/database-schema.md
-- §1, §2, §4, §10; decisions D17, D19, D39, D48; docs/demo-deviations.md PR-01 to PR-07, SE-06,
-- SE-07, SE-16; docs/testing.md categories 6, 7 and 12). Columns, keys, the D48 initial values,
-- the text rules (TEXT-SAFE, KEY-SAFE, ASCII-ID; TEMPORARY, owner question OQ-8), the SKU and
-- customer-number rules, the D19 "ON CONFLICT DO NOTHING" statement shape that never overwrites a
-- name, uniqueness, versions, immutability, and the delete and truncate guards. Runs as postgres,
-- so the triggers are proven for the owner role where the design says "every role".
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

-- Test-only helpers (pg_temp, rolled back with the transaction) -----------------------------------
-- tm_try runs one statement in a subtransaction that is always undone and returns 'ok' or the
-- error: the SQLSTATE plus the constraint name, the column (23502) or the message.
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

-- tm_text inserts one otherwise valid row with p_value in the named text column.
create function pg_temp.tm_text(p_target text, p_value text)
returns text
language sql
as $f$
  select pg_temp.tm_try(format(case p_target
    when 'brands.name' then $s$insert into public.brands (name) values (%L)$s$
    when 'suppliers.name' then $s$insert into public.suppliers (name) values (%L)$s$
    when 'products.name' then $s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
                                values ('PROBE-1', 'PROBE-1', %L, 'automated_test', 'run-100')$s$
    when 'customers.name' then $s$insert into public.customers (customer_number, name, phone, data_source, source_ref)
                                 values ('PROBE-1', %L, '050-000-0000', 'automated_test', 'run-100')$s$
    when 'call_types.label_he' then $s$insert into public.call_types (label_he, sort_order, is_test) values (%L, 99, true)$s$
    when 'followup_reasons.label_he' then $s$insert into public.followup_reasons (label_he, sort_order, is_test) values (%L, 99, true)$s$
    when 'collection_locations.name' then $s$insert into public.collection_locations (name, place_type, sort_order, address)
                                            values (%L, 'branch', 99, 'רחוב הבדיקה 9')$s$
    when 'collection_locations.address' then $s$insert into public.collection_locations (name, place_type, sort_order, address)
                                               values ('מחסן בדיקה 9', 'branch', 99, %L)$s$
    when 'collection_locations.phone' then $s$insert into public.collection_locations (name, place_type, sort_order, address, phone)
                                             values ('מחסן בדיקה 9', 'branch', 99, 'רחוב הבדיקה 9', %L)$s$
    when 'collection_locations.opening_hours' then $s$insert into public.collection_locations (name, place_type, sort_order, address, opening_hours)
                                                     values ('מחסן בדיקה 9', 'branch', 99, 'רחוב הבדיקה 9', %L)$s$
  end, p_value))
$f$;

-- tm_shape_cases: the length, trim, control and NFC rules of every free-text column (TEXT-SAFE),
-- plus the space rules of unique names and labels (KEY-SAFE) when p_key.
create function pg_temp.tm_shape_cases(p_max integer, p_key boolean)
returns table (n integer, label text, val text, accepted boolean)
language sql
as $f$
  select c.n, c.label, c.val, c.accepted
  from (values
    (1, 'plain Hebrew', 'מחסן צפון', true, 'all'),
    (2, 'Hebrew with niqqud in canonical order', 'ב' || chr(x'05B8'::int) || chr(x'05BC'::int) || 'ית', true, 'all'),
    (3, 'Latin, digits and punctuation', 'Acme-2 (ת"א)', true, 'all'),
    (4, 'precomposed e-acute (NFC)', 'caf' || chr(x'00E9'::int), true, 'all'),
    (5, 'exactly the maximum length', repeat('א', p_max), true, 'all'),
    (6, 'empty', '', false, 'all'),
    (7, 'a single space', ' ', false, 'all'),
    (8, 'leading space', ' מחסן', false, 'all'),
    (9, 'trailing space', 'מחסן ', false, 'all'),
    (10, 'leading tab', chr(9) || 'מחסן', false, 'all'),
    (11, 'trailing line feed', 'מחסן' || chr(10), false, 'all'),
    (12, 'one over the maximum length', repeat('א', p_max + 1), false, 'all'),
    (13, 'not NFC: e and a combining acute', 'cafe' || chr(x'0301'::int), false, 'all'),
    (14, 'not NFC: Hebrew presentation form U+FB2A', chr(x'FB2A'::int) || 'לום', false, 'all'),
    (15, 'not NFC: dagesh before qamats', 'ב' || chr(x'05BC'::int) || chr(x'05B8'::int) || 'ית', false, 'all'),
    (16, 'doubled space (allowed: not a key)', 'מחסן  צפון', true, 'text'),
    (17, 'doubled space', 'מחסן  צפון', false, 'key'),
    -- Integration fix INT-3: no leading or trailing space other than U+0020 on every free-text
    -- column, not only on keys (a required value is never only spaces; independent review SEC-2:
    -- a lone combining mark or an unassigned code point is not caught, OQ-8).
    (18, 'leading no-break space', chr(x'00A0'::int) || 'מחסן', false, 'all'),
    (19, 'trailing no-break space', 'מחסן' || chr(x'00A0'::int), false, 'all'),
    (20, 'leading ideographic space U+3000', chr(x'3000'::int) || 'מחסן', false, 'all'),
    (21, 'trailing thin space U+2009', 'מחסן' || chr(x'2009'::int), false, 'all'),
    (22, 'leading Ogham space U+1680', chr(x'1680'::int) || 'מחסן', false, 'all'),
    (23, 'leading en quad U+2000', chr(x'2000'::int) || 'מחסן', false, 'all'),
    (24, 'trailing hair space U+200A', 'מחסן' || chr(x'200A'::int), false, 'all'),
    (25, 'trailing narrow no-break space U+202F', 'מחסן' || chr(x'202F'::int), false, 'all'),
    (26, 'trailing medium mathematical space U+205F', 'מחסן' || chr(x'205F'::int), false, 'all'),
    (27, 'space then no-break space', 'מחסן ' || chr(x'00A0'::int) || 'צפון', false, 'key'),
    (28, 'two thin spaces', 'מחסן' || chr(x'2009'::int) || chr(x'2009'::int) || 'צפון', false, 'key'),
    (29, 'two ideographic spaces', 'מחסן' || chr(x'3000'::int) || chr(x'3000'::int) || 'צפון', false, 'key'),
    (30, 'only a no-break space', chr(x'00A0'::int), false, 'all'),
    (31, 'only ideographic spaces', chr(x'3000'::int) || chr(x'3000'::int), false, 'all'),
    (32, 'leading braille pattern blank U+2800', chr(x'2800'::int) || 'מחסן', false, 'all'),
    (33, 'trailing braille pattern blank U+2800', 'מחסן' || chr(x'2800'::int), false, 'all'),
    -- Integration fix INT-2: in a unique name or label the only space is U+0020, so 'מחסן צפון'
    -- and the same text with a no-break space are not two different keys.
    (34, 'one internal no-break space (allowed: not a key)', 'מחסן' || chr(x'00A0'::int) || 'צפון', true, 'text'),
    (35, 'one internal no-break space', 'מחסן' || chr(x'00A0'::int) || 'צפון', false, 'key'),
    (36, 'one internal thin space U+2009', 'מחסן' || chr(x'2009'::int) || 'צפון', false, 'key'),
    (37, 'one internal braille pattern blank U+2800', 'מחסן' || chr(x'2800'::int) || 'צפון', false, 'key'),
    (38, 'one internal ideographic space U+3000', 'מחסן' || chr(x'3000'::int) || 'צפון', false, 'key'),
    -- Independent review SEC-1: a unique name or label is also NFKC, so a compatibility variant
    -- (wide Hebrew, fullwidth or mathematical letters, ligatures, superscripts) is not a second key
    -- that looks like an existing one ('תיקון' with the wide tav U+FB28). Free text keeps them.
    (39, 'wide Hebrew tav U+FB28 (allowed: not a key)', chr(x'FB28'::int) || 'יקון', true, 'text'),
    (40, 'wide Hebrew tav U+FB28', chr(x'FB28'::int) || 'יקון', false, 'key'),
    (41, 'wide Hebrew he U+FB23', chr(x'FB23'::int) || 'תקנה', false, 'key'),
    (42, 'fullwidth Latin capital B U+FF22', chr(x'FF22'::int) || 'ranch', false, 'key'),
    (43, 'mathematical bold capital B U+1D401', chr(x'1D401'::int) || 'ranch', false, 'key'),
    (44, 'ligature fi U+FB01', 'O' || chr(x'FB01'::int) || 'ce', false, 'key'),
    (45, 'superscript two U+00B2', 'מחסן ' || chr(x'00B2'::int), false, 'key'),
    (46, 'Hebrew geresh and gershayim (NFKC-stable)', 'ת' || chr(x'05F4'::int) || 'א ' || chr(x'05F3'::int), true, 'all'),
    -- Independent review SEC-2: a value of only a format, private-use or noncharacter code point.
    (47, 'only an Egyptian hieroglyph format control U+13430', chr(x'13430'::int), false, 'all'),
    (48, 'only an Arabic number sign U+0600', chr(x'0600'::int), false, 'all'),
    (49, 'only a private-use character U+E000', chr(x'E000'::int), false, 'all'),
    (50, 'only a noncharacter U+FDD0', chr(x'FDD0'::int), false, 'all')
  ) c (n, label, val, accepted, scope)
  where c.scope = 'all' or (c.scope = 'key' and p_key) or (c.scope = 'text' and not p_key)
  order by c.n
$f$;

create function pg_temp.tm_columns(p_table regclass)
returns table (col text, typ text, not_null boolean, dflt text, generated text)
language sql
as $f$
  select a.attname::text, format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid),
         a.attgenerated::text
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
  order by a.attnum
$f$;

-- Table-driven cases: label, statement, expected result of pg_temp.tm_try.
create temporary table tm_case (
  n integer generated always as identity, grp text not null, label text not null, stmt text not null, expected text not null
) on commit drop;

-- Every code point that TEXT-SAFE rejects (C0 and C1 controls, soft hyphen, zero-width characters,
-- line and paragraph separators, every bidi mark, embedding, override and isolate, BOM and the
-- interlinear annotation characters), with both ends of each range. Integration fix INT-2 (review
-- README §11): every other Default_Ignorable_Code_Point too (combining grapheme joiner, Hangul and
-- Khmer fillers, Mongolian variation selectors, variation selectors, U+FFF0-FFF8, shorthand and
-- musical format controls, tag characters and the reserved block up to U+E0FFF), so no invisible
-- character can make a second label that looks like an existing one. Independent review SEC-2:
-- every other format character (Cf: the prepended concatenation marks U+0600-0605, U+06DD,
-- U+070F, U+0890-0891, U+08E2, U+110BD, U+110CD and the hieroglyph format controls
-- U+13430-1343F), private-use characters (U+E000-F8FF, U+F0000-10FFFF), the noncharacters of the
-- BMP (U+FDD0-FDEF, U+FFFE, U+FFFF), U+FFFC, U+FFFD and the invisible U+1D159.
create temporary table tm_forbidden (cp integer primary key, label text not null) on commit drop;
insert into tm_forbidden values
  (x'0001'::int, 'U+0001 C0 control'), (x'0009'::int, 'U+0009 tab'), (x'000A'::int, 'U+000A line feed'),
  (x'000D'::int, 'U+000D carriage return'), (x'001B'::int, 'U+001B escape'), (x'001F'::int, 'U+001F C0 control'),
  (x'007F'::int, 'U+007F delete'), (x'0080'::int, 'U+0080 C1 control'), (x'0085'::int, 'U+0085 next line'),
  (x'009F'::int, 'U+009F C1 control'), (x'00AD'::int, 'U+00AD soft hyphen'), (x'061C'::int, 'U+061C Arabic letter mark'),
  (x'180E'::int, 'U+180E Mongolian vowel separator'), (x'200B'::int, 'U+200B zero-width space'),
  (x'200C'::int, 'U+200C zero-width non-joiner'), (x'200D'::int, 'U+200D zero-width joiner'),
  (x'200E'::int, 'U+200E left-to-right mark'), (x'200F'::int, 'U+200F right-to-left mark'),
  (x'2028'::int, 'U+2028 line separator'), (x'2029'::int, 'U+2029 paragraph separator'),
  (x'202A'::int, 'U+202A left-to-right embedding'), (x'202B'::int, 'U+202B right-to-left embedding'),
  (x'202C'::int, 'U+202C pop directional formatting'), (x'202D'::int, 'U+202D left-to-right override'),
  (x'202E'::int, 'U+202E right-to-left override'), (x'2060'::int, 'U+2060 word joiner'),
  (x'2061'::int, 'U+2061 function application'), (x'2064'::int, 'U+2064 invisible plus'),
  (x'2066'::int, 'U+2066 left-to-right isolate'), (x'2067'::int, 'U+2067 right-to-left isolate'),
  (x'2068'::int, 'U+2068 first strong isolate'), (x'2069'::int, 'U+2069 pop directional isolate'),
  (x'206F'::int, 'U+206F nominal digit shapes'), (x'FEFF'::int, 'U+FEFF zero-width no-break space (BOM)'),
  (x'FFF9'::int, 'U+FFF9 interlinear annotation anchor'), (x'FFFA'::int, 'U+FFFA interlinear annotation separator'),
  (x'FFFB'::int, 'U+FFFB interlinear annotation terminator'),
  (x'034F'::int, 'U+034F combining grapheme joiner'), (x'115F'::int, 'U+115F Hangul choseong filler'),
  (x'1160'::int, 'U+1160 Hangul jungseong filler'), (x'17B4'::int, 'U+17B4 Khmer vowel inherent aq'),
  (x'17B5'::int, 'U+17B5 Khmer vowel inherent aa'), (x'180B'::int, 'U+180B Mongolian free variation selector one'),
  (x'180F'::int, 'U+180F Mongolian free variation selector four'), (x'3164'::int, 'U+3164 Hangul filler'),
  (x'FE00'::int, 'U+FE00 variation selector-1'), (x'FE0F'::int, 'U+FE0F variation selector-16'),
  (x'FFA0'::int, 'U+FFA0 halfwidth Hangul filler'), (x'FFF0'::int, 'U+FFF0 reserved default-ignorable'),
  (x'FFF8'::int, 'U+FFF8 reserved default-ignorable'), (x'1BCA0'::int, 'U+1BCA0 shorthand format letter overlap'),
  (x'1BCA3'::int, 'U+1BCA3 shorthand format up step'), (x'1D173'::int, 'U+1D173 musical symbol begin beam'),
  (x'1D17A'::int, 'U+1D17A musical symbol end phrase'), (x'E0000'::int, 'U+E0000 reserved tag'),
  (x'E0001'::int, 'U+E0001 language tag'), (x'E0020'::int, 'U+E0020 tag space'),
  (x'E0041'::int, 'U+E0041 tag Latin capital letter A'), (x'E007F'::int, 'U+E007F cancel tag'),
  (x'E0100'::int, 'U+E0100 variation selector-17'), (x'E01EF'::int, 'U+E01EF variation selector-256'),
  (x'E0FFF'::int, 'U+E0FFF reserved default-ignorable'),
  (x'0600'::int, 'U+0600 Arabic number sign'), (x'0605'::int, 'U+0605 Arabic number mark above'),
  (x'06DD'::int, 'U+06DD Arabic end of ayah'), (x'070F'::int, 'U+070F Syriac abbreviation mark'),
  (x'0890'::int, 'U+0890 Arabic pound mark above'), (x'0891'::int, 'U+0891 Arabic piastre mark above'),
  (x'08E2'::int, 'U+08E2 Arabic disputed end of ayah'), (x'110BD'::int, 'U+110BD Kaithi number sign'),
  (x'110CD'::int, 'U+110CD Kaithi number sign above'), (x'13430'::int, 'U+13430 Egyptian hieroglyph vertical joiner'),
  (x'1343F'::int, 'U+1343F Egyptian hieroglyph end walled enclosure'), (x'E000'::int, 'U+E000 private use'),
  (x'F8FF'::int, 'U+F8FF private use'), (x'FDD0'::int, 'U+FDD0 noncharacter'), (x'FDEF'::int, 'U+FDEF noncharacter'),
  (x'FFFC'::int, 'U+FFFC object replacement character'), (x'FFFD'::int, 'U+FFFD replacement character'),
  (x'FFFE'::int, 'U+FFFE noncharacter'), (x'FFFF'::int, 'U+FFFF noncharacter'),
  (x'1D159'::int, 'U+1D159 musical symbol null notehead'), (x'F0000'::int, 'U+F0000 supplementary private use A'),
  (x'FFFFD'::int, 'U+FFFFD supplementary private use A'), (x'100000'::int, 'U+100000 supplementary private use B'),
  (x'10FFFF'::int, 'U+10FFFF noncharacter (private-use plane)');

-- ---------------------------------------------------------------------------------------------
-- 1. The D48 initial values (fresh database, before any fixture)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select c.label_he, c.sort_order, c.is_active, c.is_test, c.created_by, c.updated_by, c.version
     from public.call_types c order by c.sort_order $$,
  $$ values ('תיקון'::text, 1, true, false, null::uuid, null::uuid, 1), ('התקנה', 2, true, false, null, null, 1) $$,
  'D48: exactly the two initial call types, in the demo order, real, active, no creator, version 1');
select results_eq(
  $$ select r.label_he, r.sort_order, r.is_active, r.is_user_added, r.is_test, r.created_by, r.updated_by, r.version
     from public.followup_reasons r order by r.sort_order $$,
  $$ values ('ממתין לחלקי חילוף'::text, 1, true, false, false, null::uuid, null::uuid, 1),
            ('נדרש ביקור נוסף', 2, true, false, false, null, null, 1),
            ('נדרשת בדיקת מתקין', 3, true, false, false, null, null, 1),
            ('הזמנת מוצר חדש', 4, true, false, false, null, null, 1),
            ('לקוח לא נמצא', 5, true, false, false, null, null, 1) $$,
  'D48: exactly the five initial continuation reasons, in the demo order, real, active, not user-added, version 1');

-- ---------------------------------------------------------------------------------------------
-- 2. Columns, types, NOT NULL, defaults and generation
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select * from pg_temp.tm_columns('public.brands') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''), ('name', 'text', true, null::text, ''),
            ('is_active', 'boolean', true, 'true', ''), ('is_test', 'boolean', true, 'true', ''),
            ('created_at', 'timestamp with time zone', true, 'now()', ''), ('created_by', 'uuid', false, null, ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', ''), ('updated_by', 'uuid', false, null, ''),
            ('version', 'integer', true, '1', '') $$,
  'brands: columns, types, NOT NULL and defaults (is_test defaults to true: fails safe, D47)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.suppliers') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''), ('name', 'text', true, null::text, ''),
            ('is_active', 'boolean', true, 'true', ''), ('is_test', 'boolean', true, 'true', ''),
            ('created_at', 'timestamp with time zone', true, 'now()', ''), ('created_by', 'uuid', false, null, ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', ''), ('updated_by', 'uuid', false, null, ''),
            ('version', 'integer', true, '1', '') $$,
  'suppliers: the same shape as brands');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.products') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''), ('sku_display', 'text', true, null::text, ''),
            ('sku_normalized', 'text', true, null, ''), ('name', 'text', true, null, ''),
            ('brand_id', 'uuid', false, null, ''), ('supplier_id', 'uuid', false, null, ''),
            ('data_source', 'text', true, null, ''), ('source_ref', 'text', true, null, ''),
            ('is_test', 'boolean', false, '(data_source <> ''microsoft_graph''::text)', 's'),
            ('created_at', 'timestamp with time zone', true, 'now()', ''), ('created_by', 'uuid', false, null, ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', ''), ('updated_by', 'uuid', false, null, ''),
            ('version', 'integer', true, '1', '') $$,
  'products: columns; brand and supplier optional (D19); is_test generated from data_source (database-schema.md §2)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.customers') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''), ('customer_number', 'text', true, null::text, ''),
            ('name', 'text', true, null, ''), ('phone', 'text', true, null, ''), ('phone_alt', 'text', false, null, ''),
            ('data_source', 'text', true, null, ''), ('source_ref', 'text', true, null, ''),
            ('is_test', 'boolean', false, '(data_source <> ''microsoft_graph''::text)', 's'),
            ('created_at', 'timestamp with time zone', true, 'now()', ''), ('created_by', 'uuid', false, null, ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', ''), ('updated_by', 'uuid', false, null, ''),
            ('version', 'integer', true, '1', '') $$,
  'customers: columns; no address or arrival notes (per visit, D39); name and phone NOT NULL (TEMPORARY, OQ-10)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.call_types') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''), ('label_he', 'text', true, null::text, ''),
            ('sort_order', 'integer', true, null, ''), ('is_active', 'boolean', true, 'true', ''),
            ('is_test', 'boolean', true, 'false', ''),
            ('created_at', 'timestamp with time zone', true, 'now()', ''), ('created_by', 'uuid', false, null, ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', ''), ('updated_by', 'uuid', false, null, ''),
            ('version', 'integer', true, '1', '') $$,
  'call_types: columns (is_test defaults to false: the D48 INSERT may not name the marker, guard rules 1-2)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.followup_reasons') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''), ('label_he', 'text', true, null::text, ''),
            ('sort_order', 'integer', true, null, ''), ('is_active', 'boolean', true, 'true', ''),
            ('is_user_added', 'boolean', true, 'false', ''), ('is_test', 'boolean', true, 'false', ''),
            ('created_at', 'timestamp with time zone', true, 'now()', ''), ('created_by', 'uuid', false, null, ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', ''), ('updated_by', 'uuid', false, null, ''),
            ('version', 'integer', true, '1', '') $$,
  'followup_reasons: columns, including is_user_added (SE-07)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.collection_locations') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''), ('name', 'text', true, null::text, ''),
            ('place_type', 'text', true, null, ''), ('sort_order', 'integer', true, null, ''),
            ('address', 'text', true, null, ''), ('phone', 'text', false, null, ''), ('opening_hours', 'text', false, null, ''),
            ('is_active', 'boolean', true, 'true', ''), ('is_test', 'boolean', true, 'true', ''),
            ('created_at', 'timestamp with time zone', true, 'now()', ''), ('created_by', 'uuid', false, null, ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', ''), ('updated_by', 'uuid', false, null, ''),
            ('version', 'integer', true, '1', '') $$,
  'collection_locations: columns, including the place type (SE-06, demo)');

-- ---------------------------------------------------------------------------------------------
-- 3. Constraints, indexes, triggers, RLS and comments (catalog)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select c.relname::text collate "default", k.conname::text collate "default", k.contype::text,
            (select string_agg(a.attname::text, ',' order by a.attnum)
             from pg_attribute a where a.attrelid = k.conrelid and a.attnum = any (k.conkey)) collate "default",
            coalesce((select r.relname::text from pg_class r where r.oid = k.confrelid), '') collate "default",
            k.confdeltype::text
     from pg_constraint k join pg_class c on c.oid = k.conrelid
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')
     order by c.relname::text collate "C", k.conname::text collate "C" $$,
  $$ values
     ('brands', 'brands_created_by_fkey', 'f', 'created_by', 'profiles', 'r'), ('brands', 'brands_name_check', 'c', 'name', '', ' '),
     ('brands', 'brands_name_key', 'u', 'name', '', ' '), ('brands', 'brands_pkey', 'p', 'id', '', ' '),
     ('brands', 'brands_test_until_golive_check', 'c', 'is_test', '', ' '),
     ('brands', 'brands_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'), ('brands', 'brands_version_check', 'c', 'version', '', ' '),
     ('call_types', 'call_types_created_by_fkey', 'f', 'created_by', 'profiles', 'r'),
     ('call_types', 'call_types_label_he_check', 'c', 'label_he', '', ' '), ('call_types', 'call_types_label_he_key', 'u', 'label_he', '', ' '),
     ('call_types', 'call_types_pkey', 'p', 'id', '', ' '),
     ('call_types', 'call_types_real_from_migration_check', 'c', 'is_test,created_by', '', ' '),
     ('call_types', 'call_types_sort_order_check', 'c', 'sort_order', '', ' '),
     ('call_types', 'call_types_sort_order_key', 'u', 'sort_order', '', ' '),
     ('call_types', 'call_types_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'),
     ('call_types', 'call_types_version_check', 'c', 'version', '', ' '),
     ('collection_locations', 'collection_locations_address_check', 'c', 'address', '', ' '),
     ('collection_locations', 'collection_locations_created_by_fkey', 'f', 'created_by', 'profiles', 'r'),
     ('collection_locations', 'collection_locations_name_check', 'c', 'name', '', ' '),
     ('collection_locations', 'collection_locations_name_key', 'u', 'name', '', ' '),
     ('collection_locations', 'collection_locations_opening_hours_check', 'c', 'opening_hours', '', ' '),
     ('collection_locations', 'collection_locations_phone_check', 'c', 'phone', '', ' '),
     ('collection_locations', 'collection_locations_pkey', 'p', 'id', '', ' '),
     ('collection_locations', 'collection_locations_place_type_check', 'c', 'place_type', '', ' '),
     ('collection_locations', 'collection_locations_sort_order_check', 'c', 'sort_order', '', ' '),
     ('collection_locations', 'collection_locations_sort_order_key', 'u', 'sort_order', '', ' '),
     ('collection_locations', 'collection_locations_test_until_golive_check', 'c', 'is_test', '', ' '),
     ('collection_locations', 'collection_locations_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'),
     ('collection_locations', 'collection_locations_version_check', 'c', 'version', '', ' '),
     ('customers', 'customers_created_by_fkey', 'f', 'created_by', 'profiles', 'r'),
     ('customers', 'customers_customer_number_check', 'c', 'customer_number', '', ' '),
     ('customers', 'customers_customer_number_key', 'u', 'customer_number', '', ' '),
     ('customers', 'customers_data_source_check', 'c', 'data_source', '', ' '),
     ('customers', 'customers_id_is_test_key', 'u', 'id,is_test', '', ' '),
     ('customers', 'customers_name_check', 'c', 'name', '', ' '),
     ('customers', 'customers_phone_alt_check', 'c', 'phone_alt', '', ' '),
     ('customers', 'customers_phone_check', 'c', 'phone', '', ' '),
     ('customers', 'customers_pkey', 'p', 'id', '', ' '),
     ('customers', 'customers_simulator_creator_check', 'c', 'data_source,created_by', '', ' '),
     ('customers', 'customers_source_ref_check', 'c', 'source_ref', '', ' '),
     ('customers', 'customers_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'),
     ('customers', 'customers_version_check', 'c', 'version', '', ' '),
     ('followup_reasons', 'followup_reasons_created_by_fkey', 'f', 'created_by', 'profiles', 'r'),
     ('followup_reasons', 'followup_reasons_label_he_check', 'c', 'label_he', '', ' '),
     ('followup_reasons', 'followup_reasons_label_he_key', 'u', 'label_he', '', ' '),
     ('followup_reasons', 'followup_reasons_pkey', 'p', 'id', '', ' '),
     ('followup_reasons', 'followup_reasons_real_from_migration_check', 'c', 'is_test,created_by', '', ' '),
     ('followup_reasons', 'followup_reasons_sort_order_check', 'c', 'sort_order', '', ' '),
     ('followup_reasons', 'followup_reasons_sort_order_key', 'u', 'sort_order', '', ' '),
     ('followup_reasons', 'followup_reasons_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'),
     ('followup_reasons', 'followup_reasons_user_added_check', 'c', 'is_user_added,created_by', '', ' '),
     ('followup_reasons', 'followup_reasons_version_check', 'c', 'version', '', ' '),
     ('products', 'products_brand_id_fkey', 'f', 'brand_id', 'brands', 'r'),
     ('products', 'products_created_by_fkey', 'f', 'created_by', 'profiles', 'r'),
     ('products', 'products_data_source_check', 'c', 'data_source', '', ' '),
     ('products', 'products_id_is_test_key', 'u', 'id,is_test', '', ' '),
     ('products', 'products_name_check', 'c', 'name', '', ' '),
     ('products', 'products_pkey', 'p', 'id', '', ' '),
     ('products', 'products_simulator_creator_check', 'c', 'data_source,created_by', '', ' '),
     ('products', 'products_sku_display_check', 'c', 'sku_display', '', ' '),
     ('products', 'products_sku_normalized_check', 'c', 'sku_display,sku_normalized', '', ' '),
     ('products', 'products_sku_normalized_key', 'u', 'sku_normalized', '', ' '),
     ('products', 'products_source_ref_check', 'c', 'source_ref', '', ' '),
     ('products', 'products_supplier_id_fkey', 'f', 'supplier_id', 'suppliers', 'r'),
     ('products', 'products_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'),
     ('products', 'products_version_check', 'c', 'version', '', ' '),
     ('suppliers', 'suppliers_created_by_fkey', 'f', 'created_by', 'profiles', 'r'),
     ('suppliers', 'suppliers_name_check', 'c', 'name', '', ' '), ('suppliers', 'suppliers_name_key', 'u', 'name', '', ' '),
     ('suppliers', 'suppliers_pkey', 'p', 'id', '', ' '), ('suppliers', 'suppliers_test_until_golive_check', 'c', 'is_test', '', ' '),
     ('suppliers', 'suppliers_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'),
     ('suppliers', 'suppliers_version_check', 'c', 'version', '', ' ') $$,
  'the seven tables have exactly the planned keys, unique keys, CHECKs and foreign keys, every one ON DELETE RESTRICT');

select results_eq(
  $$ select c.relname::text collate "default", i.relname::text collate "default", x.indisunique
     from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class c on c.oid = x.indrelid
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')
       and not exists (select 1 from pg_constraint k where k.conindid = x.indexrelid)
     order by 1, 2 $$,
  $$ values ('products', 'products_brand_id_idx', false), ('products', 'products_supplier_id_idx', false) $$,
  'besides the key indexes, only the two plain foreign-key indexes on products exist (no search or expression indexes yet)');

select is(
  (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'products_sku_normalized_check'),
  'CHECK ((sku_normalized = upper((sku_display COLLATE "C"))))',
  'D19: sku_normalized is upper(sku_display) under COLLATE "C", one database-side definition independent of the locale');

-- Integration fix INT-1 (review README §11): the text rules name their code points as ARE escapes
-- in ASCII strings, so the schema holds no invisible or bidi character that a reviewer cannot see
-- (no "Trojan Source" text; GitHub shows no hidden-character warning). Every CHECK on the seven
-- tables is ASCII, and no function body in public or private holds a bidi, zero-width or other
-- default-ignorable character.
select is_empty(
  $$ select 'check ' || k.conname from pg_constraint k
     where k.contype = 'c' and pg_get_constraintdef(k.oid) ~ '[^[:ascii:]]'
       and k.conrelid in ('public.brands'::regclass, 'public.suppliers'::regclass, 'public.products'::regclass,
                          'public.customers'::regclass, 'public.call_types'::regclass, 'public.followup_reasons'::regclass,
                          'public.collection_locations'::regclass)
     union all
     select 'function ' || n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prosrc ~ ('[' || chr(x'00AD'::int) || chr(x'034F'::int) || chr(x'061C'::int) || chr(x'115F'::int) || chr(x'1160'::int)
                       || chr(x'17B4'::int) || chr(x'17B5'::int) || chr(x'180B'::int) || '-' || chr(x'180F'::int)
                       || chr(x'200B'::int) || '-' || chr(x'200F'::int) || chr(x'2028'::int) || '-' || chr(x'202E'::int)
                       || chr(x'2060'::int) || '-' || chr(x'206F'::int) || chr(x'3164'::int) || chr(x'FE00'::int) || '-'
                       || chr(x'FE0F'::int) || chr(x'FEFF'::int) || chr(x'FFA0'::int) || chr(x'FFF0'::int) || '-' || chr(x'FFFB'::int)
                       || chr(x'E0000'::int) || '-' || chr(x'E0FFF'::int) || ']') $$,
  'the text CHECKs are written in ASCII (escapes), and no function body holds an invisible or bidi character');

select results_eq(
  $$ select c.relname::text collate "default", pg_get_triggerdef(t.oid)
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
       and c.relname in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')
     order by c.relname::text collate "C", t.tgname::text collate "C" $$,
  $$ values
     ('brands', 'CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''is_active'', ''version'', ''updated_at'', ''updated_by'')'),
     ('brands', 'CREATE TRIGGER t20_immutable_markers BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_markers()'),
     ('brands', 'CREATE TRIGGER t30_one_way BEFORE INSERT OR UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'', ''updated_by'')'),
     ('brands', 'CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
     ('brands', 'CREATE TRIGGER t95_reject_delete BEFORE DELETE ON public.brands FOR EACH ROW EXECUTE FUNCTION private.tg_reject_delete()'),
     ('brands', 'CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.brands FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()'),
     ('call_types', 'CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.call_types FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''is_active'', ''version'', ''updated_at'', ''updated_by'')'),
     ('call_types', 'CREATE TRIGGER t20_immutable_markers BEFORE UPDATE ON public.call_types FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_markers()'),
     ('call_types', 'CREATE TRIGGER t30_one_way BEFORE INSERT OR UPDATE ON public.call_types FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'', ''updated_by'')'),
     ('call_types', 'CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.call_types FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
     ('call_types', 'CREATE TRIGGER t95_reject_delete BEFORE DELETE ON public.call_types FOR EACH ROW EXECUTE FUNCTION private.tg_reject_delete()'),
     ('call_types', 'CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.call_types FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()'),
     ('collection_locations', 'CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.collection_locations FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''is_active'', ''version'', ''updated_at'', ''updated_by'')'),
     ('collection_locations', 'CREATE TRIGGER t20_immutable_markers BEFORE UPDATE ON public.collection_locations FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_markers()'),
     ('collection_locations', 'CREATE TRIGGER t30_one_way BEFORE INSERT OR UPDATE ON public.collection_locations FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'', ''updated_by'')'),
     ('collection_locations', 'CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.collection_locations FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
     ('collection_locations', 'CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.collection_locations FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()'),
     ('customers', 'CREATE TRIGGER a30_one_way AFTER INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'', ''updated_by'')'),
     ('customers', 'CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''name'', ''phone'', ''phone_alt'', ''version'', ''updated_at'', ''updated_by'', ''is_test'')'),
     ('customers', 'CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
     ('customers', 'CREATE TRIGGER t95_reject_delete BEFORE DELETE ON public.customers FOR EACH ROW EXECUTE FUNCTION private.tg_reject_delete()'),
     ('customers', 'CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.customers FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()'),
     ('followup_reasons', 'CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.followup_reasons FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''is_active'', ''version'', ''updated_at'', ''updated_by'')'),
     ('followup_reasons', 'CREATE TRIGGER t20_immutable_markers BEFORE UPDATE ON public.followup_reasons FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_markers()'),
     ('followup_reasons', 'CREATE TRIGGER t30_one_way BEFORE INSERT OR UPDATE ON public.followup_reasons FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'', ''updated_by'')'),
     ('followup_reasons', 'CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.followup_reasons FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
     ('followup_reasons', 'CREATE TRIGGER t95_delete_guard BEFORE DELETE ON public.followup_reasons FOR EACH ROW EXECUTE FUNCTION private.tg_followup_reason_delete_guard()'),
     ('followup_reasons', 'CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.followup_reasons FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()'),
     ('products', 'CREATE TRIGGER a30_one_way AFTER INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'', ''updated_by'')'),
     ('products', 'CREATE TRIGGER a31_one_way_refs AFTER INSERT OR UPDATE OF brand_id, supplier_id ON public.products FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_product_refs()'),
     ('products', 'CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''name'', ''brand_id'', ''supplier_id'', ''version'', ''updated_at'', ''updated_by'', ''is_test'')'),
     ('products', 'CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
     ('products', 'CREATE TRIGGER t95_reject_delete BEFORE DELETE ON public.products FOR EACH ROW EXECUTE FUNCTION private.tg_reject_delete()'),
     ('products', 'CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.products FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()'),
     ('suppliers', 'CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''is_active'', ''version'', ''updated_at'', ''updated_by'')'),
     ('suppliers', 'CREATE TRIGGER t20_immutable_markers BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_markers()'),
     ('suppliers', 'CREATE TRIGGER t30_one_way BEFORE INSERT OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'', ''updated_by'')'),
     ('suppliers', 'CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
     ('suppliers', 'CREATE TRIGGER t95_reject_delete BEFORE DELETE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION private.tg_reject_delete()'),
     ('suppliers', 'CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.suppliers FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'the seven tables carry exactly the planned triggers (plan §2.7): immutability, markers, one-way, version, delete and truncate guards');

select ok(
  (select bool_and(c.relrowsecurity and not c.relforcerowsecurity and obj_description(c.oid, 'pg_class') is not null)
   from pg_class c where c.relnamespace = 'public'::regnamespace
     and c.relname in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations'))
  and (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace
         and c.relname in ('brands', 'suppliers', 'products', 'customers', 'call_types', 'followup_reasons', 'collection_locations')) = 7,
  'the seven tables have RLS enabled (not forced, as in PR 1.3) and a comment naming their writers');

-- ---------------------------------------------------------------------------------------------
-- 4. Fixtures (local, rolled back; fictional values, example.test; D47). Every row is test data.
--    updated_at is set in the past so that the version trigger's updated_at is visible.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true);

insert into public.brands (id, name, created_by, updated_at) values
  ('00000000-0000-4000-8000-000000000101', 'מותג בדיקה א', '00000000-0000-4000-8000-0000000000a1', '2000-01-01T00:00:00Z');
insert into public.suppliers (id, name, created_by, updated_at) values
  ('00000000-0000-4000-8000-000000000102', 'ספק בדיקה א', '00000000-0000-4000-8000-0000000000a1', '2000-01-01T00:00:00Z');
insert into public.products (id, sku_display, sku_normalized, name, brand_id, supplier_id, data_source, source_ref, created_by, updated_at)
values ('00000000-0000-4000-8000-000000000103', 'kt-2041', 'KT-2041', 'מוצר בדיקה א', '00000000-0000-4000-8000-000000000101',
        '00000000-0000-4000-8000-000000000102', 'automated_test', 'run-100', '00000000-0000-4000-8000-0000000000a1',
        '2000-01-01T00:00:00Z');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref, created_by, updated_at) values
  ('00000000-0000-4000-8000-000000000104', 'C-100', 'לקוח בדיקה א', '050-000-0001', 'automated_test', 'run-100',
   '00000000-0000-4000-8000-0000000000a1', '2000-01-01T00:00:00Z');
insert into public.call_types (id, label_he, sort_order, is_test, created_by, updated_at) values
  ('00000000-0000-4000-8000-000000000105', 'סוג בדיקה', 3, true, '00000000-0000-4000-8000-0000000000a1', '2000-01-01T00:00:00Z');
insert into public.followup_reasons (id, label_he, sort_order, is_user_added, is_test, created_by, updated_at) values
  ('00000000-0000-4000-8000-000000000106', 'סיבת בדיקה', 6, true, true, '00000000-0000-4000-8000-0000000000a1',
   '2000-01-01T00:00:00Z');
insert into public.collection_locations (id, name, place_type, sort_order, address, phone, opening_hours, created_by, updated_at)
values ('00000000-0000-4000-8000-000000000107', 'מחסן בדיקה', 'logistics_center', 1, 'רחוב הבדיקה 1', '03-000-0000',
        'א-ה 08:00-16:00', '00000000-0000-4000-8000-0000000000a1', '2000-01-01T00:00:00Z');

-- ---------------------------------------------------------------------------------------------
-- 5. Text rules (TEMPORARY, OQ-8): TEXT-SAFE on every free-text column, KEY-SAFE on unique names
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select f.label, pg_temp.tm_text('brands.name', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 brands_name_check'::text from tm_forbidden f order by f.cp $$,
  'brands.name: every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select f.label, pg_temp.tm_text('suppliers.name', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 suppliers_name_check'::text from tm_forbidden f order by f.cp $$,
  'suppliers.name: every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select f.label, pg_temp.tm_text('products.name', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 products_name_check'::text from tm_forbidden f order by f.cp $$,
  'products.name: every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select f.label, pg_temp.tm_text('customers.name', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 customers_name_check'::text from tm_forbidden f order by f.cp $$,
  'customers.name: every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected (an RLM from Outlook text too)');
select results_eq(
  $$ select f.label, pg_temp.tm_text('call_types.label_he', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 call_types_label_he_check'::text from tm_forbidden f order by f.cp $$,
  'call_types.label_he: every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select f.label, pg_temp.tm_text('followup_reasons.label_he', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 followup_reasons_label_he_check'::text from tm_forbidden f order by f.cp $$,
  'followup_reasons.label_he: every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select f.label, pg_temp.tm_text('collection_locations.name', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 collection_locations_name_check'::text from tm_forbidden f order by f.cp $$,
  'collection_locations.name: every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select f.label, pg_temp.tm_text('collection_locations.address', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 collection_locations_address_check'::text from tm_forbidden f order by f.cp $$,
  'collection_locations.address: every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select f.label, pg_temp.tm_text('collection_locations.phone', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 collection_locations_phone_check'::text from tm_forbidden f order by f.cp $$,
  'collection_locations.phone: every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select f.label, pg_temp.tm_text('collection_locations.opening_hours', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 collection_locations_opening_hours_check'::text from tm_forbidden f order by f.cp $$,
  'collection_locations.opening_hours: every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');

select results_eq(
  $$ select c.label, pg_temp.tm_text('brands.name', c.val) from pg_temp.tm_shape_cases(60, true) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 brands_name_check' end from pg_temp.tm_shape_cases(60, true) c $$,
  'brands.name (KEY-SAFE, 1-60): trim, length, NFC and NFKC (no compatibility variant); no space but U+0020, never doubled; no space-like edge');
select results_eq(
  $$ select c.label, pg_temp.tm_text('suppliers.name', c.val) from pg_temp.tm_shape_cases(60, true) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 suppliers_name_check' end from pg_temp.tm_shape_cases(60, true) c $$,
  'suppliers.name (KEY-SAFE, 1-60): trim, length, NFC and NFKC (no compatibility variant); no space but U+0020, never doubled; no space-like edge');
select results_eq(
  $$ select c.label, pg_temp.tm_text('call_types.label_he', c.val) from pg_temp.tm_shape_cases(60, true) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 call_types_label_he_check' end from pg_temp.tm_shape_cases(60, true) c $$,
  'call_types.label_he (KEY-SAFE, 1-60): trim, length, NFC and NFKC (no compatibility variant); no space but U+0020, never doubled; no space-like edge');
select results_eq(
  $$ select c.label, pg_temp.tm_text('followup_reasons.label_he', c.val) from pg_temp.tm_shape_cases(60, true) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 followup_reasons_label_he_check' end from pg_temp.tm_shape_cases(60, true) c $$,
  'followup_reasons.label_he (KEY-SAFE, 1-60): trim, length, NFC and NFKC (no compatibility variant); no space but U+0020, never doubled; no space-like edge');
select results_eq(
  $$ select c.label, pg_temp.tm_text('collection_locations.name', c.val) from pg_temp.tm_shape_cases(60, true) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 collection_locations_name_check' end from pg_temp.tm_shape_cases(60, true) c $$,
  'collection_locations.name (KEY-SAFE, 1-60): trim, length, NFC and NFKC (no compatibility variant); no space but U+0020, never doubled; no space-like edge');
select results_eq(
  $$ select c.label, pg_temp.tm_text('products.name', c.val) from pg_temp.tm_shape_cases(120, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 products_name_check' end from pg_temp.tm_shape_cases(120, false) c $$,
  'products.name (TEXT-SAFE, 1-120): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select c.label, pg_temp.tm_text('customers.name', c.val) from pg_temp.tm_shape_cases(120, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 customers_name_check' end from pg_temp.tm_shape_cases(120, false) c $$,
  'customers.name (TEXT-SAFE, 1-120): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select c.label, pg_temp.tm_text('collection_locations.address', c.val) from pg_temp.tm_shape_cases(120, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 collection_locations_address_check' end
     from pg_temp.tm_shape_cases(120, false) c $$,
  'collection_locations.address (TEXT-SAFE, 1-120): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select c.label, pg_temp.tm_text('collection_locations.phone', c.val) from pg_temp.tm_shape_cases(120, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 collection_locations_phone_check' end
     from pg_temp.tm_shape_cases(120, false) c $$,
  'collection_locations.phone (TEXT-SAFE display text, 1-120; empty or space-only is rejected, absent is NULL)');
select results_eq(
  $$ select c.label, pg_temp.tm_text('collection_locations.opening_hours', c.val) from pg_temp.tm_shape_cases(120, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 collection_locations_opening_hours_check' end
     from pg_temp.tm_shape_cases(120, false) c $$,
  'collection_locations.opening_hours (TEXT-SAFE, 1-120): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');

-- ---------------------------------------------------------------------------------------------
-- 6. SKU (D19, PR-05, PR-07): ASCII-ID, rejected and never normalised; one product per SKU
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, expected)
select 'sku_display', c.label,
       format($s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
                 values (%L, upper(%L collate "C"), 'מוצר בדיקה', 'automated_test', 'run-100')$s$, c.val, c.val),
       c.expected
from (values
  (1, 'lower-case SKU (stored as received)', 'kt-2042', 'ok'),
  (2, 'single internal space', 'KT 2042', 'ok'),
  (3, 'printable ASCII punctuation', 'a.b/c_d#1', 'ok'),
  (4, 'exactly 40 characters', repeat('K', 40), 'ok'),
  (5, 'empty', '', '23514 products_sku_display_check'),
  (6, 'leading space (padded display)', ' KT-2042', '23514 products_sku_display_check'),
  (7, 'trailing space (padded display)', 'KT-2042 ', '23514 products_sku_display_check'),
  (8, 'doubled space', 'KT  2042', '23514 products_sku_display_check'),
  (9, 'no-break space', 'KT' || chr(x'00A0'::int) || '2042', '23514 products_sku_display_check'),
  (10, 'tab', 'KT' || chr(9) || '2042', '23514 products_sku_display_check'),
  (11, 'Cyrillic capital Ka lookalike', chr(x'041A'::int) || 'T-2042', '23514 products_sku_display_check'),
  (12, 'fullwidth capital K lookalike', chr(x'FF2B'::int) || 'T-2042', '23514 products_sku_display_check'),
  (13, 'Arabic-Indic digits', 'KT-' || chr(x'0662'::int) || chr(x'0660'::int) || chr(x'0664'::int) || chr(x'0662'::int),
   '23514 products_sku_display_check'),
  (14, 'Hebrew letters', 'מק-2042', '23514 products_sku_display_check'),
  (15, 'right-to-left mark', 'KT-2042' || chr(x'200F'::int), '23514 products_sku_display_check'),
  (16, 'zero-width space', 'KT-' || chr(x'200B'::int) || '2042', '23514 products_sku_display_check'),
  (17, 'sharp s (upper() would differ by locale)', 'stra' || chr(x'00DF'::int) || 'e-1', '23514 products_sku_display_check'),
  (18, '41 characters', repeat('K', 41), '23514 products_sku_display_check')
) c (n, label, val, expected)
order by c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'sku_display' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'sku_display' order by c.n $$,
  'sku_display is printable ASCII with single internal spaces, 1-40 characters: lookalikes, other digits, bidi marks and padding are rejected');

insert into tm_case (grp, label, stmt, expected)
select 'sku_normalized', c.label,
       format($s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
                 values (%L, %L, 'מוצר בדיקה', 'automated_test', 'run-100')$s$, c.display, c.normalized),
       c.expected
from (values
  (1, 'upper-cased display', 'kt-2042', 'KT-2042', 'ok'),
  (2, 'mixed-case display', 'Kt-2042', 'KT-2042', 'ok'),
  (3, 'lower-case normalized SKU', 'kt-2042', 'kt-2042', '23514 products_sku_normalized_check'),
  (4, 'normalized SKU with a trailing space', 'kt-2042', 'KT-2042 ', '23514 products_sku_normalized_check'),
  (5, 'normalized SKU without the hyphen', 'kt-2042', 'KT2042', '23514 products_sku_normalized_check'),
  (6, 'normalized SKU of another display', 'kt-2042', 'KT-2043', '23514 products_sku_normalized_check'),
  (7, 'missing normalized SKU', 'kt-2042', null, '23502 sku_normalized')
) c (n, label, display, normalized, expected)
order by c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'sku_normalized' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'sku_normalized' order by c.n $$,
  'D19: sku_normalized must equal the trimmed SKU upper-cased; any other value is rejected');

select throws_ok(
  $$ insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
     values ('KT-2041', 'KT-2041', 'מוצר בדיקה אחר', 'automated_test', 'run-100') $$,
  '23505', 'duplicate key value violates unique constraint "products_sku_normalized_key"',
  'D19: ''kt-2041'' and ''KT-2041'' are one product (unique sku_normalized), even as postgres');

-- The D19 ingestion statement shape (Step 6 writer): INSERT ... ON CONFLICT (sku_normalized) DO
-- NOTHING never overwrites an existing product name and returns no row.
select is_empty(
  $$ insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
     values ('KT-2041', 'KT-2041', 'שם אחר מזימון', 'automated_test', 'run-100b')
     on conflict (sku_normalized) do nothing returning id $$,
  'D19: an invitation with a known SKU in another case and another name inserts nothing and returns no row');
select results_eq(
  $$ select p.id, p.sku_display, p.name, p.source_ref, p.version from public.products p where p.sku_normalized = 'KT-2041' $$,
  $$ values ('00000000-0000-4000-8000-000000000103'::uuid, 'kt-2041'::text, 'מוצר בדיקה א'::text, 'run-100'::text, 1) $$,
  'D19: the existing product keeps its name, its SKU as first received, its source and its version; still one row');
select results_eq(
  $$ insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
     values ('kt-2050', 'KT-2050', 'מוצר בדיקה ב', 'automated_test', 'run-100')
     on conflict (sku_normalized) do nothing returning sku_display, sku_normalized, name $$,
  $$ values ('kt-2050'::text, 'KT-2050'::text, 'מוצר בדיקה ב'::text) $$,
  'D19: the same statement creates a product on its first SKU');

-- ---------------------------------------------------------------------------------------------
-- 7. Customers (D17, D39): customer number required, unique, exact; phones (TEMPORARY, OQ-8, OQ-10)
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, expected)
select 'customer_number', c.label,
       format($s$insert into public.customers (customer_number, name, phone, data_source, source_ref)
                 values (%L, 'לקוח בדיקה', '050-000-0000', 'automated_test', 'run-100')$s$, c.val),
       c.expected
from (values
  (1, 'letters, digits and a hyphen', 'C-101', 'ok'),
  (2, 'single internal space', 'C 101', 'ok'),
  (3, 'exactly 40 characters', repeat('7', 40), 'ok'),
  (4, 'empty', '', '23514 customers_customer_number_check'),
  (5, 'leading space', ' C-101', '23514 customers_customer_number_check'),
  (6, 'trailing space', 'C-101 ', '23514 customers_customer_number_check'),
  (7, 'doubled space', 'C  101', '23514 customers_customer_number_check'),
  (8, 'no-break space', 'C' || chr(x'00A0'::int) || '101', '23514 customers_customer_number_check'),
  (9, 'Hebrew letters', 'לק-101', '23514 customers_customer_number_check'),
  (10, 'Cyrillic capital Es lookalike', chr(x'0421'::int) || '-101', '23514 customers_customer_number_check'),
  (11, 'fullwidth digits', 'C-' || chr(x'FF11'::int) || chr(x'FF10'::int) || chr(x'FF11'::int), '23514 customers_customer_number_check'),
  (12, 'Arabic-Indic digits', chr(x'0661'::int) || chr(x'0660'::int) || chr(x'0661'::int), '23514 customers_customer_number_check'),
  (13, 'left-to-right mark', chr(x'200E'::int) || 'C-101', '23514 customers_customer_number_check'),
  (14, 'tab', 'C-' || chr(9) || '101', '23514 customers_customer_number_check'),
  (15, '41 characters', repeat('7', 41), '23514 customers_customer_number_check'),
  (16, 'missing', null, '23502 customer_number')
) c (n, label, val, expected)
order by c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'customer_number' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'customer_number' order by c.n $$,
  'D17: the customer number is required, printable ASCII with single internal spaces, 1-40; lookalikes and padding are rejected');
select throws_ok(
  $$ insert into public.customers (customer_number, name, phone, data_source, source_ref)
     values ('C-100', 'לקוח בדיקה אחר', '050-000-0002', 'automated_test', 'run-100') $$,
  '23505', 'duplicate key value violates unique constraint "customers_customer_number_key"',
  'D17: the customer number is unique, even as postgres');
select lives_ok(
  $$ insert into public.customers (customer_number, name, phone, data_source, source_ref)
     values ('c-100', 'לקוח בדיקה ב', '050-000-0003', 'automated_test', 'run-100') $$,
  'TEMPORARY (OQ-8): customer numbers are exact values, not case-folded: ''c-100'' is another customer than ''C-100''');
select results_eq(
  $$ select pg_temp.tm_try($s$insert into public.customers (customer_number, phone, data_source, source_ref)
                              values ('C-102', '050-000-0000', 'automated_test', 'run-100')$s$)
     union all
     select pg_temp.tm_try($s$insert into public.customers (customer_number, name, data_source, source_ref)
                              values ('C-102', 'לקוח בדיקה', 'automated_test', 'run-100')$s$) $$,
  $$ values ('23502 name'::text), ('23502 phone') $$,
  'TEMPORARY (OQ-10): a customer without a name or a phone is rejected');

insert into tm_case (grp, label, stmt, expected)
select 'phone_' || col.c, v.label,
       format($s$insert into public.customers (customer_number, name, phone, phone_alt, data_source, source_ref)
                 values ('PROBE-1', 'לקוח בדיקה', %L, %L, 'automated_test', 'run-100')$s$,
              case when col.c = 'phone' then v.val else '050-000-0000' end, case when col.c = 'phone' then null else v.val end),
       case when v.ok then 'ok' else '23514 customers_' || col.c || '_check' end
from (values ('phone'), ('phone_alt')) col (c)
cross join (values
  (1, 'local mobile with hyphens', '050-000-0001', true),
  (2, 'digits only', '0500000001', true),
  (3, 'international with spaces', '+972 50 000 0001', true),
  (4, 'international with hyphens', '+972-50-000-0001', true),
  (5, 'three digits (the minimum)', '123', true),
  (6, 'exactly 20 characters', '050-000-0001-234-567', true),
  (7, 'only separators', '- -', false),
  (8, 'plus and hyphens', '+-+', false),
  (9, 'plus in the middle', '05+0', false),
  (10, 'two digits', '12', false),
  (11, 'doubled separator', '050--000-0001', false),
  (12, 'trailing separator', '050-000-', false),
  (13, 'leading separator', '-050-000', false),
  (14, 'leading space', ' 050-000-0001', false),
  (15, 'doubled plus', '++972 50 000 0001', false),
  (16, 'plus and a space', '+ 972 50 000 0001', false),
  (17, 'dots', '050.000.0001', false),
  (18, 'parentheses', '(050) 000-0001', false),
  (19, 'letters', '050-ABC-0001', false),
  (20, 'Arabic-Indic digits', chr(x'0660'::int) || chr(x'0665'::int) || chr(x'0660'::int), false),
  (21, 'fullwidth digits', chr(x'FF10'::int) || chr(x'FF15'::int) || chr(x'FF10'::int), false),
  (22, 'no-break space', '050' || chr(x'00A0'::int) || '000', false),
  (23, 'empty', '', false),
  (24, '21 characters', '050-000-0001-234-5678', false)
) v (n, label, val, ok)
order by col.c, v.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'phone_phone' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'phone_phone' order by c.n $$,
  'customers.phone: at least 3 digits, "+" only first, single space or hyphen separators, ends with a digit, at most 20');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'phone_phone_alt' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'phone_phone_alt' order by c.n $$,
  'customers.phone_alt: the same pattern (and NULL when absent)');

insert into tm_case (grp, label, stmt, expected)
select 'source_ref', t.t || ': ' || v.label,
       case t.t
         when 'products' then format($s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref)
                                       values ('PROBE-1', 'PROBE-1', 'מוצר בדיקה', 'automated_test', %L)$s$, v.val)
         else format($s$insert into public.customers (customer_number, name, phone, data_source, source_ref)
                        values ('PROBE-1', 'לקוח בדיקה', '050-000-0000', 'automated_test', %L)$s$, v.val)
       end,
       case when v.ok then 'ok' when v.val is null then '23502 source_ref' else '23514 ' || t.t || '_source_ref_check' end
from (values ('products'), ('customers')) t (t)
cross join (values
  (1, 'simulator event id', 'sim-evt-1', true),
  (2, 'letters, digits, dot, underscore, colon, hyphen', 'run.100:a_B-9', true),
  (3, '200 characters', repeat('r', 200), true),
  (4, 'empty', '', false),
  (5, 'a space', 'run 100', false),
  (6, 'a slash', 'run/100', false),
  (7, 'an at sign (no e-mail addresses)', 'someone@example.test', false),
  (8, 'Hebrew text (no invitation text)', 'זימון', false),
  (9, 'a line feed', 'run-100' || chr(10), false),
  (10, '201 characters', repeat('r', 201), false),
  (11, 'missing', null, false)
) v (n, label, val, ok)
order by t.t desc, v.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'source_ref' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'source_ref' order by c.n $$,
  'source_ref on products and customers is a required opaque identifier (TEMPORARY, OQ-8), never invitation text or PII');

-- ---------------------------------------------------------------------------------------------
-- 8. Place type, sort order, uniqueness, is_user_added, version >= 1
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, expected)
select 'place_type', v.label,
       format($s$insert into public.collection_locations (name, place_type, sort_order, address)
                 values ('מחסן בדיקה 9', %L, 99, 'רחוב הבדיקה 9')$s$, v.val),
       v.expected
from (values
  (1, 'logistics center', 'logistics_center', 'ok'),
  (2, 'branch', 'branch', 'ok'),
  (3, 'another code', 'warehouse', '23514 collection_locations_place_type_check'),
  (4, 'another case', 'Branch', '23514 collection_locations_place_type_check'),
  (5, 'a Hebrew label instead of the code', 'סניף', '23514 collection_locations_place_type_check'),
  (6, 'padded code', ' branch', '23514 collection_locations_place_type_check'),
  (7, 'missing', null, '23502 place_type')
) v (n, label, val, expected)
order by v.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'place_type' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'place_type' order by c.n $$,
  'collection_locations.place_type is one of two English codes (SE-06; closed list TEMPORARY, OQ-6)');

insert into tm_case (grp, label, stmt, expected) values
  ('unique', 'brands: an existing name',
   $s$insert into public.brands (name) values ('מותג בדיקה א')$s$, '23505 brands_name_key'),
  ('unique', 'suppliers: an existing name',
   $s$insert into public.suppliers (name) values ('ספק בדיקה א')$s$, '23505 suppliers_name_key'),
  ('unique', 'call_types: a test row with a D48 label (unique across test and real rows)',
   $s$insert into public.call_types (label_he, sort_order, is_test) values ('תיקון', 50, true)$s$, '23505 call_types_label_he_key'),
  ('unique', 'followup_reasons: a test row with a D48 label',
   $s$insert into public.followup_reasons (label_he, sort_order, is_test) values ('לקוח לא נמצא', 50, true)$s$,
   '23505 followup_reasons_label_he_key'),
  ('unique', 'collection_locations: an existing name',
   $s$insert into public.collection_locations (name, place_type, sort_order, address) values ('מחסן בדיקה', 'branch', 50, 'רחוב הבדיקה 2')$s$,
   '23505 collection_locations_name_key'),
  ('unique', 'call_types: an existing sort order',
   $s$insert into public.call_types (label_he, sort_order, is_test) values ('סוג בדיקה ב', 1, true)$s$, '23505 call_types_sort_order_key'),
  ('unique', 'followup_reasons: an existing sort order',
   $s$insert into public.followup_reasons (label_he, sort_order, is_test) values ('סיבת בדיקה ב', 5, true)$s$,
   '23505 followup_reasons_sort_order_key'),
  ('unique', 'collection_locations: an existing sort order',
   $s$insert into public.collection_locations (name, place_type, sort_order, address) values ('מחסן בדיקה ב', 'branch', 1, 'רחוב הבדיקה 2')$s$,
   '23505 collection_locations_sort_order_key'),
  ('unique', 'call_types: sort order 0',
   $s$insert into public.call_types (label_he, sort_order, is_test) values ('סוג בדיקה ב', 0, true)$s$, '23514 call_types_sort_order_check'),
  ('unique', 'followup_reasons: a negative sort order',
   $s$insert into public.followup_reasons (label_he, sort_order, is_test) values ('סיבת בדיקה ב', -1, true)$s$,
   '23514 followup_reasons_sort_order_check'),
  ('unique', 'collection_locations: sort order 0',
   $s$insert into public.collection_locations (name, place_type, sort_order, address) values ('מחסן בדיקה ב', 'branch', 0, 'רחוב הבדיקה 2')$s$,
   '23514 collection_locations_sort_order_check'),
  ('unique', 'call_types: missing sort order',
   $s$insert into public.call_types (label_he, is_test) values ('סוג בדיקה ב', true)$s$, '23502 sort_order');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'unique' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'unique' order by c.n $$,
  'names, labels and sort orders are unique across test and real rows; sort orders are required and at least 1');
select lives_ok(
  $$ insert into public.brands (name) values ('Acme'), ('ACME') $$,
  'TEMPORARY (OQ-8): brand names are unique on the exact value (no case folding)');

insert into tm_case (grp, label, stmt, expected) values
  ('user_added', 'user-added without a creator',
   $s$insert into public.followup_reasons (label_he, sort_order, is_user_added, is_test) values ('סיבת בדיקה ב', 50, true, true)$s$,
   '23514 followup_reasons_user_added_check'),
  ('user_added', 'not user-added but with a creator',
   $s$insert into public.followup_reasons (label_he, sort_order, is_user_added, is_test, created_by)
      values ('סיבת בדיקה ב', 50, false, true, '00000000-0000-4000-8000-0000000000a1')$s$,
   '23514 followup_reasons_user_added_check'),
  ('user_added', 'user-added with a creator',
   $s$insert into public.followup_reasons (label_he, sort_order, is_user_added, is_test, created_by)
      values ('סיבת בדיקה ב', 50, true, true, '00000000-0000-4000-8000-0000000000a1')$s$, 'ok');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'user_added' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'user_added' order by c.n $$,
  'is_user_added is true exactly for rows created in the app (with a creator): an initial reason never looks deletable');

insert into tm_case (grp, label, stmt, expected) values
  ('version', 'brands', $s$insert into public.brands (name, version) values ('מותג בדיקה ב', 0)$s$, '23514 brands_version_check'),
  ('version', 'suppliers', $s$insert into public.suppliers (name, version) values ('ספק בדיקה ב', 0)$s$, '23514 suppliers_version_check'),
  ('version', 'products', $s$insert into public.products (sku_display, sku_normalized, name, data_source, source_ref, version)
                             values ('PROBE-1', 'PROBE-1', 'מוצר בדיקה', 'automated_test', 'run-100', 0)$s$, '23514 products_version_check'),
  ('version', 'customers', $s$insert into public.customers (customer_number, name, phone, data_source, source_ref, version)
                              values ('PROBE-1', 'לקוח בדיקה', '050-000-0000', 'automated_test', 'run-100', 0)$s$,
   '23514 customers_version_check'),
  ('version', 'call_types', $s$insert into public.call_types (label_he, sort_order, is_test, version) values ('סוג בדיקה ב', 50, true, 0)$s$,
   '23514 call_types_version_check'),
  ('version', 'followup_reasons', $s$insert into public.followup_reasons (label_he, sort_order, is_test, version)
                                     values ('סיבת בדיקה ב', 50, true, 0)$s$, '23514 followup_reasons_version_check'),
  ('version', 'collection_locations', $s$insert into public.collection_locations (name, place_type, sort_order, address, version)
                                         values ('מחסן בדיקה ב', 'branch', 50, 'רחוב הבדיקה 2', 0)$s$,
   '23514 collection_locations_version_check');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'version' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'version' order by c.n $$,
  'every version is at least 1 (database-schema.md §1)');

-- ---------------------------------------------------------------------------------------------
-- 9. Version and updated_at (t90 on all seven tables)
-- ---------------------------------------------------------------------------------------------
update public.brands set is_active = false where id = '00000000-0000-4000-8000-000000000101';
update public.suppliers set is_active = false where id = '00000000-0000-4000-8000-000000000102';
update public.products set name = 'מוצר בדיקה א מתוקן' where id = '00000000-0000-4000-8000-000000000103';
update public.customers set phone = '050-000-0009' where id = '00000000-0000-4000-8000-000000000104';
update public.call_types set is_active = false where id = '00000000-0000-4000-8000-000000000105';
update public.followup_reasons set is_active = false where id = '00000000-0000-4000-8000-000000000106';
update public.collection_locations set is_active = false where id = '00000000-0000-4000-8000-000000000107';
select results_eq(
  $$ select 'brands'::text, version, updated_at = now() from public.brands where id = '00000000-0000-4000-8000-000000000101'
     union all select 'suppliers', version, updated_at = now() from public.suppliers where id = '00000000-0000-4000-8000-000000000102'
     union all select 'products', version, updated_at = now() from public.products where id = '00000000-0000-4000-8000-000000000103'
     union all select 'customers', version, updated_at = now() from public.customers where id = '00000000-0000-4000-8000-000000000104'
     union all select 'call_types', version, updated_at = now() from public.call_types where id = '00000000-0000-4000-8000-000000000105'
     union all select 'followup_reasons', version, updated_at = now() from public.followup_reasons
               where id = '00000000-0000-4000-8000-000000000106'
     union all select 'collection_locations', version, updated_at = now() from public.collection_locations
               where id = '00000000-0000-4000-8000-000000000107' $$,
  $$ values ('brands'::text, 2, true), ('suppliers', 2, true), ('products', 2, true), ('customers', 2, true),
            ('call_types', 2, true), ('followup_reasons', 2, true), ('collection_locations', 2, true) $$,
  'every update raises version by 1 and sets updated_at, on all seven tables');

update public.brands set version = 100, updated_at = '2000-01-01T00:00:00Z' where id = '00000000-0000-4000-8000-000000000101';
update public.suppliers set version = 100 where id = '00000000-0000-4000-8000-000000000102';
update public.products set version = 100 where id = '00000000-0000-4000-8000-000000000103';
update public.customers set version = 100 where id = '00000000-0000-4000-8000-000000000104';
update public.call_types set version = 100 where id = '00000000-0000-4000-8000-000000000105';
update public.followup_reasons set version = 100 where id = '00000000-0000-4000-8000-000000000106';
update public.collection_locations set version = 100 where id = '00000000-0000-4000-8000-000000000107';
select results_eq(
  $$ select 'brands'::text, version, updated_at = now() from public.brands where id = '00000000-0000-4000-8000-000000000101'
     union all select 'suppliers', version, true from public.suppliers where id = '00000000-0000-4000-8000-000000000102'
     union all select 'products', version, true from public.products where id = '00000000-0000-4000-8000-000000000103'
     union all select 'customers', version, true from public.customers where id = '00000000-0000-4000-8000-000000000104'
     union all select 'call_types', version, true from public.call_types where id = '00000000-0000-4000-8000-000000000105'
     union all select 'followup_reasons', version, true from public.followup_reasons where id = '00000000-0000-4000-8000-000000000106'
     union all select 'collection_locations', version, true from public.collection_locations
               where id = '00000000-0000-4000-8000-000000000107' $$,
  $$ values ('brands'::text, 3, true), ('suppliers', 3, true), ('products', 3, true), ('customers', 3, true),
            ('call_types', 3, true), ('followup_reasons', 3, true), ('collection_locations', 3, true) $$,
  'a version or updated_at written directly is replaced (old version + 1, server time), even as postgres');

-- ---------------------------------------------------------------------------------------------
-- 10. Immutability (t10, tg_immutable_except), even as postgres
-- ---------------------------------------------------------------------------------------------
create function pg_temp.tm_upd(p_table text, p_id uuid, p_set text)
returns text
language sql
as $f$ select pg_temp.tm_try(format('update public.%I set %s where id = %L', p_table, p_set, p_id)) $f$;

select results_eq(
  $$ select x.label, pg_temp.tm_upd('products', '00000000-0000-4000-8000-000000000103', x.set_clause) from (values
       (1, 'sku_display', $s$sku_display = 'KT-2041'$s$),
       (2, 'sku_normalized', $s$sku_normalized = 'KT-2099', sku_display = 'kt-2099'$s$),
       (3, 'data_source', $s$data_source = 'simulator'$s$),
       (4, 'source_ref', $s$source_ref = 'run-other'$s$),
       (5, 'created_at', $s$created_at = now() - interval '1 day'$s$),
       (6, 'created_by', $s$created_by = '00000000-0000-4000-8000-0000000000c1'$s$),
       (7, 'id', $s$id = gen_random_uuid()$s$),
       (8, 'name (mutable)', $s$name = 'מוצר בדיקה א שונה'$s$),
       (9, 'brand_id and supplier_id (mutable)', $s$brand_id = null, supplier_id = null$s$),
       (10, 'updated_by (mutable)', $s$updated_by = '00000000-0000-4000-8000-0000000000c1'$s$)
     ) x (n, label, set_clause) order by x.n $$,
  $$ values ('sku_display'::text, '55000 products: these fields are immutable'::text),
            ('sku_normalized', '55000 products: these fields are immutable'),
            ('data_source', '55000 products: these fields are immutable'),
            ('source_ref', '55000 products: these fields are immutable'),
            ('created_at', '55000 products: these fields are immutable'),
            ('created_by', '55000 products: these fields are immutable'),
            ('id', '55000 products: these fields are immutable'),
            ('name (mutable)', 'ok'), ('brand_id and supplier_id (mutable)', 'ok'), ('updated_by (mutable)', 'ok') $$,
  'products: the SKU (display and normalized), source and creation fields never change (PR-05, PR-07); name, brand and supplier may');
select results_eq(
  $$ select x.label, pg_temp.tm_upd('customers', '00000000-0000-4000-8000-000000000104', x.set_clause) from (values
       (1, 'customer_number', $s$customer_number = 'C-999'$s$),
       (2, 'data_source', $s$data_source = 'simulator'$s$),
       (3, 'source_ref', $s$source_ref = 'run-other'$s$),
       (4, 'created_at', $s$created_at = now() - interval '1 day'$s$),
       (5, 'created_by', $s$created_by = '00000000-0000-4000-8000-0000000000c1'$s$),
       (6, 'id', $s$id = gen_random_uuid()$s$),
       (7, 'name (mutable: PR 1.6 review)', $s$name = 'לקוח בדיקה א שונה'$s$),
       (8, 'phone and phone_alt (mutable: D39)', $s$phone = '050-000-0010', phone_alt = '050-000-0011'$s$)
     ) x (n, label, set_clause) order by x.n $$,
  $$ values ('customer_number'::text, '55000 customers: these fields are immutable'::text),
            ('data_source', '55000 customers: these fields are immutable'),
            ('source_ref', '55000 customers: these fields are immutable'),
            ('created_at', '55000 customers: these fields are immutable'),
            ('created_by', '55000 customers: these fields are immutable'),
            ('id', '55000 customers: these fields are immutable'),
            ('name (mutable: PR 1.6 review)', 'ok'), ('phone and phone_alt (mutable: D39)', 'ok') $$,
  'customers: the customer number is never renumbered (D39); source and creation fields never change; name and phones may');
select results_eq(
  $$ select x.t || '.' || x.label, pg_temp.tm_upd(x.t, x.id::uuid, x.set_clause) from (values
       (1, 'brands', '00000000-0000-4000-8000-000000000101', 'name', $s$name = 'מותג בדיקה שונה'$s$),
       (2, 'brands', '00000000-0000-4000-8000-000000000101', 'created_by', $s$created_by = '00000000-0000-4000-8000-0000000000c1'$s$),
       (3, 'brands', '00000000-0000-4000-8000-000000000101', 'created_at', $s$created_at = now() - interval '1 day'$s$),
       (4, 'brands', '00000000-0000-4000-8000-000000000101', 'id', $s$id = gen_random_uuid()$s$),
       (5, 'brands', '00000000-0000-4000-8000-000000000101', 'is_active (mutable)', $s$is_active = true$s$),
       (6, 'suppliers', '00000000-0000-4000-8000-000000000102', 'name', $s$name = 'ספק בדיקה שונה'$s$),
       (7, 'suppliers', '00000000-0000-4000-8000-000000000102', 'created_by', $s$created_by = '00000000-0000-4000-8000-0000000000c1'$s$),
       (8, 'suppliers', '00000000-0000-4000-8000-000000000102', 'is_active (mutable)', $s$is_active = true$s$)
     ) x (n, t, id, label, set_clause) order by x.n $$,
  $$ values ('brands.name'::text, '55000 brands: these fields are immutable'::text),
            ('brands.created_by', '55000 brands: these fields are immutable'),
            ('brands.created_at', '55000 brands: these fields are immutable'),
            ('brands.id', '55000 brands: these fields are immutable'),
            ('brands.is_active (mutable)', 'ok'),
            ('suppliers.name', '55000 suppliers: these fields are immutable'),
            ('suppliers.created_by', '55000 suppliers: these fields are immutable'),
            ('suppliers.is_active (mutable)', 'ok') $$,
  'brands and suppliers: no rename (TEMPORARY, OQ-3) and no change of creation fields; only is_active changes');
select results_eq(
  $$ select x.label, pg_temp.tm_upd('call_types', (select c.id from public.call_types c where c.sort_order = 1), x.set_clause) from (values
       (1, 'label_he', $s$label_he = 'תיקון שונה'$s$),
       (2, 'sort_order', $s$sort_order = 9$s$),
       (3, 'created_by', $s$created_by = '00000000-0000-4000-8000-0000000000c1'$s$),
       (4, 'created_at', $s$created_at = now() - interval '1 day'$s$),
       (5, 'id', $s$id = gen_random_uuid()$s$),
       (6, 'is_active (mutable)', $s$is_active = false$s$)
     ) x (n, label, set_clause) order by x.n $$,
  $$ values ('label_he'::text, '55000 call_types: these fields are immutable'::text),
            ('sort_order', '55000 call_types: these fields are immutable'),
            ('created_by', '55000 call_types: these fields are immutable'),
            ('created_at', '55000 call_types: these fields are immutable'),
            ('id', '55000 call_types: these fields are immutable'),
            ('is_active (mutable)', 'ok') $$,
  'call_types (a D48 row): no rename (TEMPORARY, OQ-5), no reorder, no change of creation fields; only is_active changes');
select results_eq(
  $$ select x.label, pg_temp.tm_upd('followup_reasons', (select r.id from public.followup_reasons r where r.sort_order = 1), x.set_clause)
     from (values
       (1, 'label_he', $s$label_he = 'ממתין לחלקים'$s$),
       (2, 'sort_order', $s$sort_order = 9$s$),
       (3, 'is_user_added', $s$is_user_added = true$s$),
       (4, 'created_by', $s$created_by = '00000000-0000-4000-8000-0000000000c1'$s$),
       (5, 'is_active (mutable)', $s$is_active = false$s$)
     ) x (n, label, set_clause) order by x.n $$,
  $$ values ('label_he'::text, '55000 followup_reasons: these fields are immutable'::text),
            ('sort_order', '55000 followup_reasons: these fields are immutable'),
            ('is_user_added', '55000 followup_reasons: these fields are immutable'),
            ('created_by', '55000 followup_reasons: these fields are immutable'),
            ('is_active (mutable)', 'ok') $$,
  'followup_reasons (a D48 row): no rename, no reorder, an initial reason never becomes user-added (deletable); only is_active changes');
select results_eq(
  $$ select x.label, pg_temp.tm_upd('collection_locations', '00000000-0000-4000-8000-000000000107', x.set_clause) from (values
       (1, 'name', $s$name = 'מחסן בדיקה שונה'$s$),
       (2, 'place_type', $s$place_type = 'branch'$s$),
       (3, 'address', $s$address = 'רחוב אחר 2'$s$),
       (4, 'phone', $s$phone = null$s$),
       (5, 'opening_hours', $s$opening_hours = 'א-ו 08:00-13:00'$s$),
       (6, 'sort_order', $s$sort_order = 9$s$),
       (7, 'created_by', $s$created_by = '00000000-0000-4000-8000-0000000000c1'$s$),
       (8, 'is_active (mutable)', $s$is_active = true$s$)
     ) x (n, label, set_clause) order by x.n $$,
  $$ values ('name'::text, '55000 collection_locations: these fields are immutable'::text),
            ('place_type', '55000 collection_locations: these fields are immutable'),
            ('address', '55000 collection_locations: these fields are immutable'),
            ('phone', '55000 collection_locations: these fields are immutable'),
            ('opening_hours', '55000 collection_locations: these fields are immutable'),
            ('sort_order', '55000 collection_locations: these fields are immutable'),
            ('created_by', '55000 collection_locations: these fields are immutable'),
            ('is_active (mutable)', 'ok') $$,
  'collection_locations: name, type, address, phone, hours and order are frozen (no edit command, OQ-5); only is_active changes');

-- tg_immutable_except without arguments would freeze nothing (TG_ARGV is NULL): it refuses to run.
create temporary table tm_scratch (id integer primary key, a text, b text) on commit drop;
create trigger t10_no_args before update on tm_scratch for each row execute function private.tg_immutable_except();
insert into tm_scratch values (1, 'x', 'y');
select throws_ok(
  $$ update tm_scratch set a = 'z' $$,
  '55000', 'tm_scratch: misconfigured trigger (no mutable columns named)',
  'tg_immutable_except attached without arguments raises instead of freezing nothing (plan S1, V5)');
drop trigger t10_no_args on tm_scratch;
create trigger t10_with_args before update on tm_scratch for each row execute function private.tg_immutable_except('a');
select results_eq(
  $$ select pg_temp.tm_try('update tm_scratch set a = ''z''') union all select pg_temp.tm_try('update tm_scratch set b = ''z''')
     union all select pg_temp.tm_try('update tm_scratch set a = ''z'', b = null') $$,
  $$ values ('ok'::text), ('55000 tm_scratch: these fields are immutable'), ('55000 tm_scratch: these fields are immutable') $$,
  'tg_immutable_except with arguments: the named column changes; any other change, also to NULL, is refused');

-- ---------------------------------------------------------------------------------------------
-- 11. Delete and truncate guards, even as postgres
-- ---------------------------------------------------------------------------------------------
insert into tm_case (grp, label, stmt, expected) values
  ('delete', 'products', $s$delete from public.products where id = '00000000-0000-4000-8000-000000000103'$s$,
   '55000 products: rows are never deleted'),
  ('delete', 'customers', $s$delete from public.customers where id = '00000000-0000-4000-8000-000000000104'$s$,
   '55000 customers: rows are never deleted'),
  ('delete', 'brands (referenced by a product)', $s$delete from public.brands where id = '00000000-0000-4000-8000-000000000101'$s$,
   '55000 brands: rows are never deleted'),
  ('delete', 'brands (unreferenced)', $s$delete from public.brands where name = 'Acme'$s$, '55000 brands: rows are never deleted'),
  ('delete', 'suppliers', $s$delete from public.suppliers where id = '00000000-0000-4000-8000-000000000102'$s$,
   '55000 suppliers: rows are never deleted'),
  ('delete', 'call_types (a D48 row)', $s$delete from public.call_types where sort_order = 1$s$,
   '55000 call_types: rows are never deleted'),
  ('delete', 'call_types (a test row created in the app)', $s$delete from public.call_types where id = '00000000-0000-4000-8000-000000000105'$s$,
   '55000 call_types: rows are never deleted'),
  ('delete', 'followup_reasons (a D48 row)', $s$delete from public.followup_reasons where sort_order = 1$s$,
   '55000 followup_reasons: the initial reasons are never deleted; deactivate it instead'),
  ('delete', 'followup_reasons (every row at once)', $s$delete from public.followup_reasons$s$,
   '55000 followup_reasons: the initial reasons are never deleted; deactivate it instead');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'delete' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'delete' order by c.n $$,
  'no row of products, customers, brands, suppliers or call types, and no initial reason, is ever deleted, even as postgres');
select lives_ok(
  $$ delete from public.followup_reasons where id = '00000000-0000-4000-8000-000000000106' $$,
  'SE-07: a user-added reason can be deleted (the RPC adds the "unused" and "last active" checks)');
select lives_ok(
  $$ delete from public.collection_locations where id = '00000000-0000-4000-8000-000000000107' $$,
  'SE-06: a pickup place can be deleted (from PR 1.5 the visits foreign key protects referenced places)');

insert into tm_case (grp, label, stmt, expected) values
  ('truncate', 'products', 'truncate public.products', '55000 products cannot be truncated'),
  ('truncate', 'customers', 'truncate public.customers', '55000 customers cannot be truncated'),
  ('truncate', 'brands (with products)', 'truncate public.brands, public.products', '55000 brands cannot be truncated'),
  ('truncate', 'suppliers (with products)', 'truncate public.suppliers, public.products', '55000 suppliers cannot be truncated'),
  ('truncate', 'call_types', 'truncate public.call_types', '55000 call_types cannot be truncated'),
  ('truncate', 'followup_reasons', 'truncate public.followup_reasons', '55000 followup_reasons cannot be truncated'),
  ('truncate', 'collection_locations', 'truncate public.collection_locations', '55000 collection_locations cannot be truncated');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'truncate' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'truncate' order by c.n $$,
  'TRUNCATE is rejected on all seven tables, even as postgres');

select * from finish();
rollback;
