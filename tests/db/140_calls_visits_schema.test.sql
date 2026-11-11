-- PR 1.5: schema of the service-call, visit and history tables (Migration 3; docs/database-schema.md
-- §1, §2, §4 "Migration 3", §6, §7, §9, §10; decisions D17, D36, D38, D39, D41, D42, D43, D45, D47;
-- docs/testing.md categories 6, 7 and 12). Columns, keys, composite test-marker foreign keys, every
-- foreign key ON DELETE RESTRICT, indexes (the partial unique device-report index and the card-list
-- indexes), triggers with their names, timing, events and column lists, the four deferred
-- constraint triggers, the function properties, the SECURITY INVOKER view, the text rules
-- (TEXT-SAFE and TEXT-SAFE-ML; TEMPORARY, PR 1.5 owner question OQ-6) and the value sets and format
-- rules of every CHECK. Runs as postgres, so the rules are proven for the owner role.
--
-- TEMPORARY behaviour asserted here (docs/review/step1-pr15 §13), deny by default:
--   OQ-5  task number, representative name, city, street, call type and fault are NOT NULL;
--   OQ-6  formats and limits (request number, task number, visit numbers 1-999, text lengths);
--   OQ-7  warranty yes / no / NULL, the month stored as its first day, raw text only with a value;
--   OQ-11 one device report per visit and kind; the flag set;
--   OQ-15 no signature version or signature media column.
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

-- Test-only helpers (pg_temp, rolled back with the transaction) -----------------------------------
-- tm_try runs one or more statements in a subtransaction that is always undone and returns 'ok' or
-- the error: the SQLSTATE plus the constraint name, the column (23502) or the message.
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

-- tm_shape_cases: the length, trim, control and NFC rules of free text (copied from
-- 100_reference_schema.test.sql; called with p_key = false: none of the new text columns is a key).
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
returns table (col text, typ text, not_null boolean, dflt text, generated text, identity text)
language sql
as $f$
  select a.attname::text, format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid),
         a.attgenerated::text, a.attidentity::text
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
  order by a.attnum
$f$;

-- Every code point that TEXT-SAFE rejects (copied from 100_reference_schema.test.sql). The
-- multi-line columns (TEXT-SAFE-ML) are checked against the same list without U+000A.
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

-- Table-driven cases: label, statement, expected result of pg_temp.tm_try.
create temporary table tm_case (
  n integer generated always as identity, grp text not null, label text not null, stmt text not null, expected text not null
) on commit drop;

-- ---------------------------------------------------------------------------------------------
-- 1. Columns, types, NOT NULL, defaults, generation and identity
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select * from pg_temp.tm_columns('public.service_calls') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', '', ''), ('request_number', 'text', true, null::text, '', ''),
            ('customer_id', 'uuid', true, null, '', ''), ('product_id', 'uuid', true, null, '', ''),
            ('call_type_id', 'uuid', true, null, '', ''), ('fault_description', 'text', true, null, '', ''),
            ('warranty_status', 'text', false, null, '', ''), ('warranty_until', 'date', false, null, '', ''),
            ('warranty_raw', 'text', false, null, '', ''), ('handling_rep_name', 'text', true, null, '', ''),
            ('handling_rep_profile_id', 'uuid', false, null, '', ''), ('status', 'text', true, null, '', ''),
            ('next_visit_number', 'integer', true, null, '', ''),
            ('opened_at', 'timestamp with time zone', true, 'now()', '', ''),
            ('resolved_at', 'timestamp with time zone', false, null, '', ''),
            ('data_source', 'text', true, null, '', ''), ('source_ref', 'text', true, null, '', ''),
            ('is_test', 'boolean', false, '(data_source <> ''microsoft_graph''::text)', 's', ''),
            ('created_at', 'timestamp with time zone', true, 'now()', '', ''), ('created_by', 'uuid', false, null, '', ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', '', ''), ('updated_by', 'uuid', false, null, '', ''),
            ('version', 'integer', true, '1', '', '') $$,
  'service_calls: columns; customer and product required (D17, D19); status and next_visit_number NOT NULL with no default (DEV-13); is_test generated from data_source (D47)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.visits') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', '', ''), ('service_call_id', 'uuid', true, null::text, '', ''),
            ('technician_id', 'uuid', true, null, '', ''), ('visit_number', 'integer', true, null, '', ''),
            ('task_number', 'text', true, null, '', ''),
            ('scheduled_start', 'timestamp with time zone', true, null, '', ''),
            ('scheduled_end', 'timestamp with time zone', true, null, '', ''), ('status', 'text', true, null, '', ''),
            ('city', 'text', true, null, '', ''), ('street', 'text', true, null, '', ''),
            ('building', 'text', false, null, '', ''), ('floor', 'text', false, null, '', ''),
            ('apartment', 'text', false, null, '', ''), ('arrival_notes', 'text', false, null, '', ''),
            ('tech_notes', 'text', false, null, '', ''), ('pickup_item', 'text', false, null, '', ''),
            ('pickup_location_id', 'uuid', false, null, '', ''), ('followup_reason_id', 'uuid', false, null, '', ''),
            ('next_visit_notes', 'text', false, null, '', ''),
            ('assigned_at', 'timestamp with time zone', true, 'now()', '', ''),
            ('closed_at', 'timestamp with time zone', false, null, '', ''),
            ('cancelled_at', 'timestamp with time zone', false, null, '', ''), ('cancelled_by', 'uuid', false, null, '', ''),
            ('source_ref', 'text', true, null, '', ''), ('is_test', 'boolean', true, null, '', ''),
            ('field_version', 'integer', true, '1', '', ''),
            ('created_at', 'timestamp with time zone', true, 'now()', '', ''), ('created_by', 'uuid', false, null, '', ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', '', ''), ('updated_by', 'uuid', false, null, '', ''),
            ('version', 'integer', true, '1', '', '') $$,
  'visits: columns; address per visit (D39); server times assigned_at, closed_at, cancelled_at (D45); is_test NOT NULL without a default (copied from the call); field_version column only (PR 1.6)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.visit_reports') $$,
  $$ values ('visit_id', 'uuid', true, null::text, '', ''), ('summary_text', 'text', true, null, '', ''),
            ('summary_source', 'text', true, null, '', ''), ('is_test', 'boolean', true, null, '', ''),
            ('created_at', 'timestamp with time zone', true, 'now()', '', ''), ('created_by', 'uuid', false, null, '', ''),
            ('updated_at', 'timestamp with time zone', true, 'now()', '', ''), ('updated_by', 'uuid', false, null, '', ''),
            ('version', 'integer', true, '1', '', '') $$,
  'visit_reports: one summary per visit, its source, the marker and the bookkeeping columns (DEV-1)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.visit_signatures') $$,
  $$ values ('visit_id', 'uuid', true, null::text, '', ''), ('signer_name', 'text', true, null, '', ''),
            ('signed_ack_text', 'text', true, null, '', ''), ('ack_text_sha256', 'text', true, null, '', ''),
            ('operation_id', 'uuid', true, null, '', ''), ('is_test', 'boolean', true, null, '', ''),
            ('created_at', 'timestamp with time zone', true, 'now()', '', ''), ('created_by', 'uuid', false, null, '', '') $$,
  'visit_signatures: signer, the exact approval text and its hash (D43), the device operation; no version or media column (TEMPORARY OQ-15, DEV-2)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.visit_time_reports') $$,
  $$ values ('id', 'bigint', true, null::text, '', 'a'), ('visit_id', 'uuid', true, null, '', ''),
            ('reported_by_profile_id', 'uuid', true, null, '', ''), ('technician_id', 'uuid', true, null, '', ''),
            ('kind', 'text', true, null, '', ''), ('reported_at', 'timestamp with time zone', false, null, '', ''),
            ('device_tz', 'text', false, null, '', ''), ('device_utc_offset_min', 'integer', false, null, '', ''),
            ('device_sent_at', 'timestamp with time zone', false, null, '', ''),
            ('received_at', 'timestamp with time zone', true, 'now()', '', ''), ('clock_skew_ms', 'bigint', false, null, '', ''),
            ('source', 'text', true, null, '', ''), ('operation_id', 'uuid', false, null, '', ''),
            ('row_flags', 'text[]', true, '''{}''::text[]', '', ''), ('is_test', 'boolean', true, null, '', '') $$,
  'visit_time_reports: identity id, reporter and credited technician, device times with zone, offset, send time, receipt and skew (D45); no correction columns (DEV-2)');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.visit_events') $$,
  $$ values ('id', 'bigint', true, null::text, '', 'a'), ('visit_id', 'uuid', true, null, '', ''),
            ('version_after', 'integer', true, null, '', ''), ('event_type', 'text', true, null, '', ''),
            ('from_status', 'text', false, null, '', ''), ('to_status', 'text', true, null, '', ''),
            ('recorded_at', 'timestamp with time zone', true, 'now()', '', ''), ('actor_profile_id', 'uuid', false, null, '', ''),
            ('operation_id', 'uuid', false, null, '', ''), ('is_test', 'boolean', true, null, '', '') $$,
  'visit_events: identity id, the status change, the server time, the actor and the device operation');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.entity_changes') $$,
  $$ values ('id', 'bigint', true, null::text, '', 'a'), ('entity_table', 'text', true, null, '', ''),
            ('entity_id', 'uuid', true, null, '', ''), ('field', 'text', true, null, '', ''),
            ('old_value', 'jsonb', false, null, '', ''), ('new_value', 'jsonb', false, null, '', ''),
            ('source', 'text', true, null, '', ''), ('source_ref', 'text', false, null, '', ''),
            ('actor_profile_id', 'uuid', false, null, '', ''),
            ('changed_at', 'timestamp with time zone', true, 'now()', '', ''), ('is_test', 'boolean', true, null, '', '') $$,
  'entity_changes: polymorphic target (no foreign key, database-schema.md §3), old and new values as jsonb, source, actor, server time, marker');
select results_eq(
  $$ select * from pg_temp.tm_columns('public.visit_time_current') $$,
  $$ values ('report_id', 'bigint', false, null::text, '', ''), ('visit_id', 'uuid', false, null, '', ''),
            ('kind', 'text', false, null, '', ''), ('reported_at', 'timestamp with time zone', false, null, '', ''),
            ('received_at', 'timestamp with time zone', false, null, '', ''), ('source', 'text', false, null, '', ''),
            ('technician_id', 'uuid', false, null, '', ''), ('reported_by_profile_id', 'uuid', false, null, '', ''),
            ('row_flags', 'text[]', false, null, '', ''), ('is_test', 'boolean', false, null, '', ''),
            ('sequence_flags', 'text[]', false, null, '', '') $$,
  'visit_time_current: the planned columns, with the computed sequence flags (D45; TEMPORARY OQ-11)');

-- ---------------------------------------------------------------------------------------------
-- 2. Keys, foreign keys (every one ON DELETE RESTRICT), CHECKs and constraint triggers
-- ---------------------------------------------------------------------------------------------
create function pg_temp.tm_constraints(p_table regclass)
returns table (conname text, contype text, cols text, ref text, on_delete text)
language sql
as $f$
  select k.conname::text, k.contype::text,
         coalesce((select string_agg(a.attname::text, ',' order by a.attnum)
                   from pg_attribute a where a.attrelid = k.conrelid and a.attnum = any (k.conkey)), ''),
         coalesce((select r.relname::text from pg_class r where r.oid = k.confrelid), ''), k.confdeltype::text
  from pg_constraint k where k.conrelid = p_table
  order by k.conname::text collate "C"
$f$;
select results_eq(
  $$ select * from pg_temp.tm_constraints('public.service_calls') $$,
  $$ values ('c20_call_rules', 't', '', '', ' '),
            ('service_calls_call_type_id_fkey', 'f', 'call_type_id', 'call_types', 'r'),
            ('service_calls_created_by_fkey', 'f', 'created_by', 'profiles', 'r'),
            ('service_calls_customer_id_fkey', 'f', 'customer_id,is_test', 'customers', 'r'),
            ('service_calls_data_source_check', 'c', 'data_source', '', ' '),
            ('service_calls_fault_description_check', 'c', 'fault_description', '', ' '),
            ('service_calls_handling_rep_name_check', 'c', 'handling_rep_name', '', ' '),
            ('service_calls_handling_rep_profile_id_fkey', 'f', 'handling_rep_profile_id', 'profiles', 'r'),
            ('service_calls_id_is_test_key', 'u', 'id,is_test', '', ' '),
            ('service_calls_next_visit_number_check', 'c', 'next_visit_number', '', ' '),
            ('service_calls_pkey', 'p', 'id', '', ' '),
            ('service_calls_product_id_fkey', 'f', 'product_id,is_test', 'products', 'r'),
            ('service_calls_request_number_check', 'c', 'request_number', '', ' '),
            ('service_calls_request_number_key', 'u', 'request_number', '', ' '),
            ('service_calls_resolved_at_check', 'c', 'status,resolved_at', '', ' '),
            ('service_calls_simulator_creator_check', 'c', 'data_source,created_by', '', ' '),
            ('service_calls_source_ref_check', 'c', 'source_ref', '', ' '),
            ('service_calls_status_check', 'c', 'status', '', ' '),
            ('service_calls_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'),
            ('service_calls_version_check', 'c', 'version', '', ' '),
            ('service_calls_warranty_raw_check', 'c', 'warranty_raw', '', ' '),
            ('service_calls_warranty_raw_status_check', 'c', 'warranty_status,warranty_raw', '', ' '),
            ('service_calls_warranty_status_check', 'c', 'warranty_status', '', ' '),
            ('service_calls_warranty_until_check', 'c', 'warranty_status,warranty_until', '', ' ') $$,
  'service_calls: exactly the planned keys and CHECKs; customer and product by (id, is_test) (D47); request number unique across test and real rows; every foreign key RESTRICT');
select results_eq(
  $$ select * from pg_temp.tm_constraints('public.visits') $$,
  $$ values ('c10_visit_rules', 't', '', '', ' '),
            ('visits_apartment_check', 'c', 'apartment', '', ' '), ('visits_arrival_notes_check', 'c', 'arrival_notes', '', ' '),
            ('visits_building_check', 'c', 'building', '', ' '), ('visits_cancelled_at_check', 'c', 'status,cancelled_at', '', ' '),
            ('visits_cancelled_by_check', 'c', 'cancelled_at,cancelled_by', '', ' '),
            ('visits_cancelled_by_fkey', 'f', 'cancelled_by', 'profiles', 'r'), ('visits_city_check', 'c', 'city', '', ' '),
            ('visits_closed_at_check', 'c', 'status,closed_at', '', ' '),
            ('visits_created_by_fkey', 'f', 'created_by', 'profiles', 'r'),
            ('visits_field_version_check', 'c', 'field_version', '', ' '), ('visits_floor_check', 'c', 'floor', '', ' '),
            ('visits_followup_check', 'c', 'status,followup_reason_id,next_visit_notes', '', ' '),
            ('visits_followup_reason_id_fkey', 'f', 'followup_reason_id', 'followup_reasons', 'r'),
            ('visits_id_is_test_key', 'u', 'id,is_test', '', ' '),
            ('visits_next_visit_notes_check', 'c', 'next_visit_notes', '', ' '),
            ('visits_open_not_cancelled_check', 'c', 'status,cancelled_at', '', ' '),
            ('visits_pickup_item_check', 'c', 'pickup_item', '', ' '),
            ('visits_pickup_location_id_fkey', 'f', 'pickup_location_id', 'collection_locations', 'r'),
            ('visits_pkey', 'p', 'id', '', ' '), ('visits_schedule_check', 'c', 'scheduled_start,scheduled_end', '', ' '),
            ('visits_service_call_id_fkey', 'f', 'service_call_id,is_test', 'service_calls', 'r'),
            ('visits_service_call_id_visit_number_key', 'u', 'service_call_id,visit_number', '', ' '),
            ('visits_source_ref_check', 'c', 'source_ref', '', ' '), ('visits_status_check', 'c', 'status', '', ' '),
            ('visits_street_check', 'c', 'street', '', ' '), ('visits_task_number_check', 'c', 'task_number', '', ' '),
            ('visits_tech_notes_check', 'c', 'tech_notes', '', ' '),
            ('visits_technician_id_fkey', 'f', 'technician_id', 'technicians', 'r'),
            ('visits_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'), ('visits_version_check', 'c', 'version', '', ' '),
            ('visits_visit_number_check', 'c', 'visit_number', '', ' ') $$,
  'visits: exactly the planned keys and CHECKs; the call by (service_call_id, is_test); one number per call; no unique task number (D41); no UNIQUE (id, service_call_id) yet (DEV-2); every foreign key RESTRICT');
select results_eq(
  $$ select 'visit_reports'::text, c.* from pg_temp.tm_constraints('public.visit_reports') c
     union all select 'visit_signatures', c.* from pg_temp.tm_constraints('public.visit_signatures') c $$,
  $$ values ('visit_reports'::text, 'c40_report_rules'::text, 't'::text, ''::text, ''::text, ' '::text),
            ('visit_reports', 'visit_reports_created_by_fkey', 'f', 'created_by', 'profiles', 'r'),
            ('visit_reports', 'visit_reports_pkey', 'p', 'visit_id', '', ' '),
            ('visit_reports', 'visit_reports_summary_source_check', 'c', 'summary_source', '', ' '),
            ('visit_reports', 'visit_reports_summary_text_check', 'c', 'summary_text', '', ' '),
            ('visit_reports', 'visit_reports_updated_by_fkey', 'f', 'updated_by', 'profiles', 'r'),
            ('visit_reports', 'visit_reports_version_check', 'c', 'version', '', ' '),
            ('visit_reports', 'visit_reports_visit_id_fkey', 'f', 'visit_id,is_test', 'visits', 'r'),
            ('visit_signatures', 'c30_signature_rules', 't', '', '', ' '),
            ('visit_signatures', 'visit_signatures_ack_text_sha256_check', 'c', 'signed_ack_text,ack_text_sha256', '', ' '),
            ('visit_signatures', 'visit_signatures_created_by_fkey', 'f', 'created_by', 'profiles', 'r'),
            ('visit_signatures', 'visit_signatures_pkey', 'p', 'visit_id', '', ' '),
            ('visit_signatures', 'visit_signatures_signed_ack_text_check', 'c', 'signed_ack_text', '', ' '),
            ('visit_signatures', 'visit_signatures_signer_name_check', 'c', 'signer_name', '', ' '),
            ('visit_signatures', 'visit_signatures_visit_id_fkey', 'f', 'visit_id,is_test', 'visits', 'r') $$,
  'visit_reports and visit_signatures: one row per visit, keyed to the visit by (visit_id, is_test); every foreign key RESTRICT');
select results_eq(
  $$ select 'visit_time_reports'::text, c.* from pg_temp.tm_constraints('public.visit_time_reports') c
     union all select 'visit_events', c.* from pg_temp.tm_constraints('public.visit_events') c
     union all select 'entity_changes', c.* from pg_temp.tm_constraints('public.entity_changes') c $$,
  $$ values ('visit_time_reports'::text, 'visit_time_reports_device_check'::text, 'c'::text,
             'reported_at,device_tz,device_utc_offset_min,device_sent_at,clock_skew_ms,source,operation_id'::text, ''::text, ' '::text),
            ('visit_time_reports', 'visit_time_reports_device_tz_check', 'c', 'device_tz', '', ' '),
            ('visit_time_reports', 'visit_time_reports_device_utc_offset_min_check', 'c', 'device_utc_offset_min', '', ' '),
            ('visit_time_reports', 'visit_time_reports_kind_check', 'c', 'kind', '', ' '),
            ('visit_time_reports', 'visit_time_reports_pkey', 'p', 'id', '', ' '),
            ('visit_time_reports', 'visit_time_reports_reported_by_profile_id_fkey', 'f', 'reported_by_profile_id', 'profiles', 'r'),
            ('visit_time_reports', 'visit_time_reports_row_flags_check', 'c', 'row_flags', '', ' '),
            ('visit_time_reports', 'visit_time_reports_source_check', 'c', 'source', '', ' '),
            ('visit_time_reports', 'visit_time_reports_technician_id_fkey', 'f', 'technician_id', 'technicians', 'r'),
            ('visit_time_reports', 'visit_time_reports_visit_id_fkey', 'f', 'visit_id,is_test', 'visits', 'r'),
            ('visit_events', 'visit_events_actor_profile_id_fkey', 'f', 'actor_profile_id', 'profiles', 'r'),
            ('visit_events', 'visit_events_event_type_check', 'c', 'event_type', '', ' '),
            ('visit_events', 'visit_events_event_type_from_status_check', 'c', 'event_type,from_status', '', ' '),
            ('visit_events', 'visit_events_from_status_check', 'c', 'from_status', '', ' '),
            ('visit_events', 'visit_events_pkey', 'p', 'id', '', ' '),
            ('visit_events', 'visit_events_status_change_check', 'c', 'from_status,to_status', '', ' '),
            ('visit_events', 'visit_events_to_status_check', 'c', 'to_status', '', ' '),
            ('visit_events', 'visit_events_version_after_check', 'c', 'version_after', '', ' '),
            ('visit_events', 'visit_events_visit_id_fkey', 'f', 'visit_id,is_test', 'visits', 'r'),
            ('entity_changes', 'entity_changes_actor_profile_id_fkey', 'f', 'actor_profile_id', 'profiles', 'r'),
            ('entity_changes', 'entity_changes_entity_table_check', 'c', 'entity_table', '', ' '),
            ('entity_changes', 'entity_changes_field_check', 'c', 'field', '', ' '),
            ('entity_changes', 'entity_changes_new_value_check', 'c', 'new_value', '', ' '),
            ('entity_changes', 'entity_changes_old_value_check', 'c', 'old_value', '', ' '),
            ('entity_changes', 'entity_changes_pkey', 'p', 'id', '', ' '),
            ('entity_changes', 'entity_changes_source_check', 'c', 'source', '', ' '),
            ('entity_changes', 'entity_changes_source_ref_check', 'c', 'source_ref', '', ' '),
            ('entity_changes', 'entity_changes_value_check', 'c', 'old_value,new_value', '', ' ') $$,
  'visit_time_reports, visit_events and entity_changes: the planned keys and CHECKs; children keyed by (visit_id, is_test); entity_changes has no foreign key to its target; every foreign key RESTRICT');

-- The composite foreign keys (D47; database-schema.md §2): a child row carries its own NOT NULL
-- marker (MATCH SIMPLE would skip a NULL) and equals its parent's.
select results_eq(
  $$ select k.conname::text collate "default", pg_get_constraintdef(k.oid)
     from pg_constraint k
     where k.contype = 'f' and array_length(k.conkey, 1) = 2
       and k.conrelid in ('public.service_calls'::regclass, 'public.visits'::regclass, 'public.visit_reports'::regclass,
                          'public.visit_signatures'::regclass, 'public.visit_time_reports'::regclass,
                          'public.visit_events'::regclass, 'public.entity_changes'::regclass)
     order by k.conname::text collate "C" $$,
  $$ values ('service_calls_customer_id_fkey'::text, 'FOREIGN KEY (customer_id, is_test) REFERENCES customers(id, is_test) ON DELETE RESTRICT'::text),
            ('service_calls_product_id_fkey', 'FOREIGN KEY (product_id, is_test) REFERENCES products(id, is_test) ON DELETE RESTRICT'),
            ('visit_events_visit_id_fkey', 'FOREIGN KEY (visit_id, is_test) REFERENCES visits(id, is_test) ON DELETE RESTRICT'),
            ('visit_reports_visit_id_fkey', 'FOREIGN KEY (visit_id, is_test) REFERENCES visits(id, is_test) ON DELETE RESTRICT'),
            ('visit_signatures_visit_id_fkey', 'FOREIGN KEY (visit_id, is_test) REFERENCES visits(id, is_test) ON DELETE RESTRICT'),
            ('visit_time_reports_visit_id_fkey', 'FOREIGN KEY (visit_id, is_test) REFERENCES visits(id, is_test) ON DELETE RESTRICT'),
            ('visits_service_call_id_fkey', 'FOREIGN KEY (service_call_id, is_test) REFERENCES service_calls(id, is_test) ON DELETE RESTRICT') $$,
  'D47: the seven composite foreign keys reference (id, is_test) of the parent, MATCH SIMPLE on NOT NULL markers, ON DELETE RESTRICT');

-- Value sets and rules (codes are permanent once rows exist, DEV-3: later migrations only add).
select results_eq(
  $$ select k.conname::text collate "default", pg_get_constraintdef(k.oid)
     from pg_constraint k
     where k.contype = 'c' and k.conname in (
       'service_calls_status_check', 'service_calls_data_source_check', 'service_calls_warranty_status_check',
       'service_calls_warranty_until_check', 'service_calls_warranty_raw_status_check', 'service_calls_resolved_at_check',
       'service_calls_next_visit_number_check', 'service_calls_request_number_check', 'service_calls_source_ref_check',
       'service_calls_simulator_creator_check', 'visits_status_check', 'visits_visit_number_check', 'visits_task_number_check',
       'visits_schedule_check', 'visits_followup_check', 'visits_closed_at_check', 'visits_cancelled_at_check',
       'visits_cancelled_by_check', 'visits_open_not_cancelled_check', 'visit_reports_summary_source_check',
       'visit_signatures_ack_text_sha256_check', 'visit_time_reports_kind_check', 'visit_time_reports_source_check',
       'visit_time_reports_row_flags_check', 'visit_time_reports_device_check', 'visit_time_reports_device_tz_check',
       'visit_time_reports_device_utc_offset_min_check', 'visit_events_event_type_check', 'visit_events_from_status_check',
       'visit_events_to_status_check', 'visit_events_event_type_from_status_check', 'visit_events_status_change_check',
       'entity_changes_entity_table_check', 'entity_changes_source_check', 'entity_changes_field_check',
       'entity_changes_old_value_check', 'entity_changes_new_value_check', 'entity_changes_value_check')
     order by k.conname::text collate "C" $$,
  $$ values
     ('entity_changes_entity_table_check'::text, 'CHECK ((entity_table = ANY (ARRAY[''customers''::text, ''products''::text, ''service_calls''::text, ''visits''::text])))'::text),
     ('entity_changes_field_check', 'CHECK ((field ~ ''^[a-z][a-z0-9_]{0,62}$''::text))'),
     ('entity_changes_new_value_check', 'CHECK (((new_value IS NULL) OR ((jsonb_typeof(new_value) <> ''null''::text) AND (pg_column_size(new_value) <= 16384))))'),
     ('entity_changes_old_value_check', 'CHECK (((old_value IS NULL) OR ((jsonb_typeof(old_value) <> ''null''::text) AND (pg_column_size(old_value) <= 16384))))'),
     ('entity_changes_source_check', 'CHECK ((source = ANY (ARRAY[''invitation''::text, ''edit''::text, ''correction''::text, ''system''::text, ''merge''::text, ''rejected_submission''::text])))'),
     ('entity_changes_value_check', 'CHECK ((old_value IS DISTINCT FROM new_value))'),
     ('service_calls_data_source_check', 'CHECK ((data_source = ANY (ARRAY[''simulator''::text, ''automated_test''::text])))'),
     ('service_calls_next_visit_number_check', 'CHECK (((next_visit_number >= 2) AND (next_visit_number <= 1000)))'),
     ('service_calls_request_number_check', 'CHECK ((request_number ~ ''^[A-Za-z0-9-]{1,32}$''::text))'),
     ('service_calls_resolved_at_check', 'CHECK (((status = ''resolved''::text) = (resolved_at IS NOT NULL)))'),
     ('service_calls_simulator_creator_check', 'CHECK (((data_source <> ''simulator''::text) OR (created_by IS NOT NULL)))'),
     ('service_calls_source_ref_check', 'CHECK ((source_ref ~ ''^[A-Za-z0-9._:-]{1,200}$''::text))'),
     ('service_calls_status_check', 'CHECK ((status = ANY (ARRAY[''open''::text, ''resolved''::text, ''awaiting_followup''::text, ''awaiting_scheduling''::text])))'),
     ('service_calls_warranty_raw_status_check', 'CHECK (((warranty_status IS NULL) = (warranty_raw IS NULL)))'),
     ('service_calls_warranty_status_check', 'CHECK ((warranty_status = ANY (ARRAY[''yes''::text, ''no''::text])))'),
     ('service_calls_warranty_until_check', 'CHECK (((warranty_until IS NULL) OR ((warranty_status IS NOT NULL) AND (warranty_status = ''yes''::text) AND (EXTRACT(day FROM warranty_until) = (1)::numeric))))'),
     ('visit_events_event_type_check', 'CHECK ((event_type = ANY (ARRAY[''created''::text, ''status_changed''::text])))'),
     ('visit_events_event_type_from_status_check', 'CHECK (((event_type = ''created''::text) = (from_status IS NULL)))'),
     ('visit_events_from_status_check', 'CHECK ((from_status = ANY (ARRAY[''scheduled''::text, ''en_route''::text, ''in_progress''::text, ''done''::text, ''followup''::text, ''cancelled''::text])))'),
     ('visit_events_status_change_check', 'CHECK ((from_status IS DISTINCT FROM to_status))'),
     ('visit_events_to_status_check', 'CHECK ((to_status = ANY (ARRAY[''scheduled''::text, ''en_route''::text, ''in_progress''::text, ''done''::text, ''followup''::text, ''cancelled''::text])))'),
     ('visit_reports_summary_source_check', 'CHECK ((summary_source = ANY (ARRAY[''written''::text, ''approved_transcription''::text])))'),
     ('visit_signatures_ack_text_sha256_check', 'CHECK (((ack_text_sha256 ~ ''^[0-9a-f]{64}$''::text) AND (ack_text_sha256 = encode(sha256(convert_to(signed_ack_text, ''UTF8''::name)), ''hex''::text))))'),
     ('visit_time_reports_device_check', 'CHECK (((source <> ''device''::text) OR ((reported_at IS NOT NULL) AND (device_tz IS NOT NULL) AND (device_utc_offset_min IS NOT NULL) AND (device_sent_at IS NOT NULL) AND (operation_id IS NOT NULL) AND (clock_skew_ms IS NOT NULL) AND isfinite(reported_at) AND isfinite(device_sent_at))))'),
     ('visit_time_reports_device_tz_check', 'CHECK (((char_length(device_tz) <= 64) AND (device_tz ~ ''^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$''::text)))'),
     ('visit_time_reports_device_utc_offset_min_check', 'CHECK (((device_utc_offset_min >= ''-840''::integer) AND (device_utc_offset_min <= 840)))'),
     ('visit_time_reports_kind_check', 'CHECK ((kind = ANY (ARRAY[''departed''::text, ''arrived''::text, ''ended''::text, ''signed''::text])))'),
     ('visit_time_reports_row_flags_check', 'CHECK ((row_flags <@ ARRAY[''future_time''::text, ''large_skew''::text, ''before_assignment''::text]))'),
     ('visit_time_reports_source_check', 'CHECK ((source = ''device''::text))'),
     ('visits_cancelled_at_check', 'CHECK (((status <> ''cancelled''::text) OR (cancelled_at IS NOT NULL)))'),
     ('visits_cancelled_by_check', 'CHECK (((cancelled_by IS NULL) OR (cancelled_at IS NOT NULL)))'),
     ('visits_closed_at_check', 'CHECK (((status = ANY (ARRAY[''done''::text, ''followup''::text])) = (closed_at IS NOT NULL)))'),
     ('visits_followup_check', 'CHECK (((status <> ''followup''::text) OR ((followup_reason_id IS NOT NULL) AND (next_visit_notes IS NOT NULL))))'),
     ('visits_open_not_cancelled_check', 'CHECK (((status <> ALL (ARRAY[''scheduled''::text, ''en_route''::text, ''in_progress''::text])) OR (cancelled_at IS NULL)))'),
     ('visits_schedule_check', 'CHECK ((scheduled_end >= scheduled_start))'),
     ('visits_status_check', 'CHECK ((status = ANY (ARRAY[''scheduled''::text, ''en_route''::text, ''in_progress''::text, ''done''::text, ''followup''::text, ''cancelled''::text])))'),
     ('visits_task_number_check', 'CHECK ((((char_length(task_number) >= 1) AND (char_length(task_number) <= 40)) AND (task_number ~ ''^[!-~]+( [!-~]+)*$''::text)))'),
     ('visits_visit_number_check', 'CHECK (((visit_number >= 1) AND (visit_number <= 999)))') $$,
  'value sets and rules: no cancelled call status (D38, open decision 5), no microsoft_graph source (fails closed), the six visit codes, the D45 device fields and flags, the D43 hash, the entity_changes targets and sources');

-- The four deferred constraint triggers (database-schema.md §9; DEV-4, DEV-14).
select results_eq(
  $$ select k.conname::text collate "default", c.relname::text collate "default", k.condeferrable, k.condeferred,
            t.tgfoid::regprocedure::text collate "default"
     from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_trigger t on t.tgconstraint = k.oid
     where k.contype = 't' and c.relnamespace = 'public'::regnamespace
     order by k.conname::text collate "C" $$,
  $$ values ('c10_visit_rules'::text, 'visits'::text, true, true, 'private.ct_visit_rules()'::text),
            ('c20_call_rules', 'service_calls', true, true, 'private.ct_service_call_rules()'),
            ('c30_signature_rules', 'visit_signatures', true, true, 'private.ct_signature_rules()'),
            ('c40_report_rules', 'visit_reports', true, true, 'private.ct_report_rules()') $$,
  'exactly four constraint triggers in public, each DEFERRABLE INITIALLY DEFERRED (checked at COMMIT) on the table its rules involve');

-- ---------------------------------------------------------------------------------------------
-- 3. Indexes (database-schema.md §10; THINKING-AHEAD P1; the card lists and the D45 view)
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select i.relname::text collate "default", pg_get_indexdef(x.indexrelid)
     from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class c on c.oid = x.indrelid
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('service_calls', 'visits', 'visit_reports', 'visit_signatures', 'visit_time_reports', 'visit_events', 'entity_changes')
       and not exists (select 1 from pg_constraint k where k.conindid = x.indexrelid)
     order by i.relname::text collate "C" $$,
  $$ values
     ('entity_changes_entity_table_entity_id_id_idx'::text, 'CREATE INDEX entity_changes_entity_table_entity_id_id_idx ON public.entity_changes USING btree (entity_table, entity_id, id)'::text),
     ('service_calls_call_type_id_idx', 'CREATE INDEX service_calls_call_type_id_idx ON public.service_calls USING btree (call_type_id)'),
     ('service_calls_customer_id_opened_at_idx', 'CREATE INDEX service_calls_customer_id_opened_at_idx ON public.service_calls USING btree (customer_id, opened_at)'),
     ('service_calls_handling_rep_profile_id_idx', 'CREATE INDEX service_calls_handling_rep_profile_id_idx ON public.service_calls USING btree (handling_rep_profile_id) WHERE (handling_rep_profile_id IS NOT NULL)'),
     ('service_calls_opened_at_idx', 'CREATE INDEX service_calls_opened_at_idx ON public.service_calls USING btree (opened_at)'),
     ('service_calls_product_id_opened_at_idx', 'CREATE INDEX service_calls_product_id_opened_at_idx ON public.service_calls USING btree (product_id, opened_at)'),
     ('service_calls_resolved_at_idx', 'CREATE INDEX service_calls_resolved_at_idx ON public.service_calls USING btree (resolved_at) WHERE (resolved_at IS NOT NULL)'),
     ('service_calls_status_idx', 'CREATE INDEX service_calls_status_idx ON public.service_calls USING btree (status)'),
     ('visit_events_visit_id_id_idx', 'CREATE INDEX visit_events_visit_id_id_idx ON public.visit_events USING btree (visit_id, id)'),
     ('visit_time_reports_device_once_key', 'CREATE UNIQUE INDEX visit_time_reports_device_once_key ON public.visit_time_reports USING btree (visit_id, kind) WHERE (source = ''device''::text)'),
     ('visit_time_reports_technician_id_idx', 'CREATE INDEX visit_time_reports_technician_id_idx ON public.visit_time_reports USING btree (technician_id)'),
     ('visit_time_reports_visit_id_kind_id_idx', 'CREATE INDEX visit_time_reports_visit_id_kind_id_idx ON public.visit_time_reports USING btree (visit_id, kind, id)'),
     ('visits_followup_reason_id_idx', 'CREATE INDEX visits_followup_reason_id_idx ON public.visits USING btree (followup_reason_id) WHERE (followup_reason_id IS NOT NULL)'),
     ('visits_pickup_location_id_idx', 'CREATE INDEX visits_pickup_location_id_idx ON public.visits USING btree (pickup_location_id) WHERE (pickup_location_id IS NOT NULL)'),
     ('visits_scheduled_start_idx', 'CREATE INDEX visits_scheduled_start_idx ON public.visits USING btree (scheduled_start)'),
     ('visits_task_number_idx', 'CREATE INDEX visits_task_number_idx ON public.visits USING btree (task_number)'),
     ('visits_technician_id_scheduled_start_idx', 'CREATE INDEX visits_technician_id_scheduled_start_idx ON public.visits USING btree (technician_id, scheduled_start)') $$,
  'besides the key indexes: the partial unique device-report index (one device report per visit and kind, OQ-11), the card-list and day-range indexes, and an index on every foreign key the Settings delete checks use');

-- ---------------------------------------------------------------------------------------------
-- 4. Triggers: names fix the firing order (t10 ... t99), timing, events and column lists
-- ---------------------------------------------------------------------------------------------
create function pg_temp.tm_triggers(p_table regclass)
returns setof text
language sql
as $f$
  select pg_get_triggerdef(t.oid) from pg_trigger t
  where t.tgrelid = p_table and not t.tgisinternal
  order by t.tgname::text collate "C"
$f$;
select results_eq(
  $$ select * from pg_temp.tm_triggers('public.service_calls') $$,
  $$ values
     ('CREATE TRIGGER a30_one_way AFTER INSERT OR UPDATE ON public.service_calls FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'', ''updated_by'', ''handling_rep_profile_id'')'::text),
     ('CREATE TRIGGER a31_one_way_refs AFTER INSERT OR UPDATE OF call_type_id ON public.service_calls FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_call_refs()'),
     ('CREATE CONSTRAINT TRIGGER c20_call_rules AFTER INSERT OR UPDATE ON public.service_calls DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.ct_service_call_rules()'),
     ('CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.service_calls FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''call_type_id'', ''fault_description'', ''warranty_status'', ''warranty_until'', ''warranty_raw'', ''handling_rep_name'', ''handling_rep_profile_id'', ''status'', ''next_visit_number'', ''resolved_at'', ''version'', ''updated_at'', ''updated_by'', ''is_test'')'),
     ('CREATE TRIGGER t35_call_guard BEFORE INSERT OR UPDATE ON public.service_calls FOR EACH ROW EXECUTE FUNCTION private.tg_service_call_guard()'),
     ('CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.service_calls FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
     ('CREATE TRIGGER t95_reject_delete BEFORE DELETE ON public.service_calls FOR EACH ROW EXECUTE FUNCTION private.tg_reject_delete()'),
     ('CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.service_calls FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'service_calls: request number, customer, product, opened_at, source and creation fields frozen (D39, DEV-12); the one-way checks run AFTER (the generated is_test is NULL in BEFORE triggers); c20 deferred on every INSERT and UPDATE');
select results_eq(
  $$ select * from pg_temp.tm_triggers('public.visits') $$,
  $$ values
     ('CREATE CONSTRAINT TRIGGER c10_visit_rules AFTER INSERT OR UPDATE OF status, closed_at ON public.visits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.ct_visit_rules()'::text),
     ('CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''technician_id'', ''task_number'', ''scheduled_start'', ''scheduled_end'', ''status'', ''city'', ''street'', ''building'', ''floor'', ''apartment'', ''arrival_notes'', ''tech_notes'', ''pickup_item'', ''pickup_location_id'', ''followup_reason_id'', ''next_visit_notes'', ''assigned_at'', ''closed_at'', ''cancelled_at'', ''cancelled_by'', ''field_version'', ''version'', ''updated_at'', ''updated_by'')'),
     ('CREATE TRIGGER t12_visit_state BEFORE INSERT OR UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION private.tg_visit_state_guard()'),
     ('CREATE TRIGGER t15_marker_from_call BEFORE INSERT ON public.visits FOR EACH ROW EXECUTE FUNCTION private.tg_visit_marker()'),
     ('CREATE TRIGGER t20_immutable_markers BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_markers()'),
     ('CREATE TRIGGER t30_one_way BEFORE INSERT OR UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'', ''updated_by'', ''cancelled_by'')'),
     ('CREATE TRIGGER t31_one_way_refs BEFORE INSERT OR UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_visit_refs()'),
     ('CREATE TRIGGER t35_visit_number BEFORE INSERT ON public.visits FOR EACH ROW EXECUTE FUNCTION private.tg_visit_number_guard()'),
     ('CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
     ('CREATE TRIGGER t95_reject_delete BEFORE DELETE ON public.visits FOR EACH ROW EXECUTE FUNCTION private.tg_reject_delete()'),
     ('CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.visits FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'visits: the call, number, source, marker and creation fields frozen; t12 server times and state; t15 marker before the one-way checks t30/t31 and the number guard t35; c10 deferred on INSERT and on UPDATE OF status, closed_at (every column compute_call_status reads)');
select results_eq(
  $$ select * from pg_temp.tm_triggers('public.visit_reports') $$,
  $$ values
     ('CREATE CONSTRAINT TRIGGER c40_report_rules AFTER INSERT ON public.visit_reports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.ct_report_rules()'::text),
     ('CREATE TRIGGER t10_immutable BEFORE UPDATE ON public.visit_reports FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_except(''summary_text'', ''summary_source'', ''version'', ''updated_at'', ''updated_by'')'),
     ('CREATE TRIGGER t15_marker_from_visit BEFORE INSERT ON public.visit_reports FOR EACH ROW EXECUTE FUNCTION private.tg_visit_child_marker()'),
     ('CREATE TRIGGER t20_immutable_markers BEFORE UPDATE ON public.visit_reports FOR EACH ROW EXECUTE FUNCTION private.tg_immutable_markers()'),
     ('CREATE TRIGGER t30_one_way BEFORE INSERT OR UPDATE ON public.visit_reports FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'', ''updated_by'')'),
     ('CREATE TRIGGER t90_bump_version BEFORE UPDATE ON public.visit_reports FOR EACH ROW EXECUTE FUNCTION private.tg_bump_version()'),
     ('CREATE TRIGGER t95_reject_delete BEFORE DELETE ON public.visit_reports FOR EACH ROW EXECUTE FUNCTION private.tg_reject_delete()'),
     ('CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.visit_reports FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'visit_reports: only the summary changes (PR 1.6 corrections); marker from the visit; c40 deferred on INSERT');
select results_eq(
  $$ select * from pg_temp.tm_triggers('public.visit_signatures') $$,
  $$ values
     ('CREATE CONSTRAINT TRIGGER c30_signature_rules AFTER INSERT ON public.visit_signatures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.ct_signature_rules()'::text),
     ('CREATE TRIGGER t10_reject_update_delete BEFORE DELETE OR UPDATE ON public.visit_signatures FOR EACH ROW EXECUTE FUNCTION private.tg_reject_update_delete()'),
     ('CREATE TRIGGER t15_marker_from_visit BEFORE INSERT ON public.visit_signatures FOR EACH ROW EXECUTE FUNCTION private.tg_visit_child_marker()'),
     ('CREATE TRIGGER t30_one_way BEFORE INSERT ON public.visit_signatures FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''created_by'')'),
     ('CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.visit_signatures FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'visit_signatures: immutable after insert for every role (database-schema.md §1); c30 deferred on INSERT');
select results_eq(
  $$ select * from pg_temp.tm_triggers('public.visit_time_reports') $$,
  $$ values
     ('CREATE TRIGGER t10_reject_update_delete BEFORE DELETE OR UPDATE ON public.visit_time_reports FOR EACH ROW EXECUTE FUNCTION private.tg_reject_update_delete()'::text),
     ('CREATE TRIGGER t15_marker_from_visit BEFORE INSERT ON public.visit_time_reports FOR EACH ROW EXECUTE FUNCTION private.tg_visit_child_marker()'),
     ('CREATE TRIGGER t30_one_way BEFORE INSERT ON public.visit_time_reports FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''reported_by_profile_id'')'),
     ('CREATE TRIGGER t35_time_report BEFORE INSERT ON public.visit_time_reports FOR EACH ROW EXECUTE FUNCTION private.tg_time_report_derive()'),
     ('CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.visit_time_reports FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'visit_time_reports: append-only; t35 derives the receipt, skew and flags after the marker (D45)');
select results_eq(
  $$ select * from pg_temp.tm_triggers('public.visit_events') $$,
  $$ values
     ('CREATE TRIGGER t10_reject_update_delete BEFORE DELETE OR UPDATE ON public.visit_events FOR EACH ROW EXECUTE FUNCTION private.tg_reject_update_delete()'::text),
     ('CREATE TRIGGER t15_marker_from_visit BEFORE INSERT ON public.visit_events FOR EACH ROW EXECUTE FUNCTION private.tg_visit_child_marker()'),
     ('CREATE TRIGGER t16_event_time BEFORE INSERT ON public.visit_events FOR EACH ROW EXECUTE FUNCTION private.tg_history_server_time()'),
     ('CREATE TRIGGER t30_one_way BEFORE INSERT ON public.visit_events FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''actor_profile_id'')'),
     ('CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.visit_events FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'visit_events: append-only; the server records the time (t16)');
select results_eq(
  $$ select * from pg_temp.tm_triggers('public.entity_changes') $$,
  $$ values
     ('CREATE TRIGGER t10_reject_update_delete BEFORE DELETE OR UPDATE ON public.entity_changes FOR EACH ROW EXECUTE FUNCTION private.tg_reject_update_delete()'::text),
     ('CREATE TRIGGER t20_entity_target BEFORE INSERT ON public.entity_changes FOR EACH ROW EXECUTE FUNCTION private.tg_entity_change_target()'),
     ('CREATE TRIGGER t30_one_way BEFORE INSERT ON public.entity_changes FOR EACH ROW EXECUTE FUNCTION private.tg_one_way_people(''actor_profile_id'')'),
     ('CREATE TRIGGER t99_reject_truncate BEFORE TRUNCATE ON public.entity_changes FOR EACH STATEMENT EXECUTE FUNCTION private.tg_reject_truncate()') $$,
  'entity_changes: append-only; t20 derives the marker from the target before the one-way check t30 reads it');

-- Every trigger on the seven tables is enabled (origin mode) after the migration.
select is(
  (select count(*) from pg_trigger t
   where t.tgrelid in ('public.service_calls'::regclass, 'public.visits'::regclass, 'public.visit_reports'::regclass,
                       'public.visit_signatures'::regclass, 'public.visit_time_reports'::regclass,
                       'public.visit_events'::regclass, 'public.entity_changes'::regclass)
     and not t.tgisinternal and t.tgenabled <> 'O'),
  0::bigint, 'every trigger on the seven tables is enabled');

-- ---------------------------------------------------------------------------------------------
-- 5. Functions of this area (PR 1.3 SEC-1: search_path pinned; owner postgres; no grants here,
--    see 010): trigger functions SECURITY INVOKER, constraint-trigger functions SECURITY DEFINER
--    (TEMPORARY OQ-2, DEV-5), the call-status and history functions SECURITY INVOKER.
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select p.oid::regprocedure::text collate "default", l.lanname::text collate "default", p.prosecdef, p.provolatile::text,
            array_to_string(p.proconfig, ';') collate "default", pg_get_userbyid(p.proowner)::text collate "default"
     from pg_proc p join pg_language l on l.oid = p.prolang
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('tg_visit_marker', 'tg_visit_child_marker', 'tg_history_server_time', 'tg_entity_change_target',
                         'tg_one_way_call_refs', 'tg_one_way_visit_refs', 'tg_visit_number_guard', 'tg_service_call_guard',
                         'tg_visit_state_guard', 'tg_time_report_derive', 'ct_visit_rules', 'ct_service_call_rules',
                         'ct_signature_rules', 'ct_report_rules', 'compute_call_status', 'recalc_call_status',
                         'write_entity_change')
     order by p.oid::regprocedure::text collate "C" $$,
  $$ values
     ('private.compute_call_status(uuid)'::text, 'sql'::text, false, 's'::text, 'search_path=pg_catalog, pg_temp'::text, 'postgres'::text),
     ('private.ct_report_rules()', 'plpgsql', true, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.ct_service_call_rules()', 'plpgsql', true, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.ct_signature_rules()', 'plpgsql', true, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.ct_visit_rules()', 'plpgsql', true, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.recalc_call_status(uuid)', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.tg_entity_change_target()', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.tg_history_server_time()', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.tg_one_way_call_refs()', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.tg_one_way_visit_refs()', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.tg_service_call_guard()', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.tg_time_report_derive()', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.tg_visit_child_marker()', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.tg_visit_marker()', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.tg_visit_number_guard()', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.tg_visit_state_guard()', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres'),
     ('private.write_entity_change(text,uuid,text,jsonb,jsonb,text,text)', 'plpgsql', false, 'v', 'search_path=pg_catalog, pg_temp', 'postgres') $$,
  'the 17 trigger, constraint-trigger, call-status and history functions: pinned search_path, owner postgres; only the four constraint-trigger functions are SECURITY DEFINER (they see every row whoever commits)');

-- ---------------------------------------------------------------------------------------------
-- 6. The view, RLS and comments
-- ---------------------------------------------------------------------------------------------
select results_eq(
  $$ select c.relkind::text, c.reloptions::text collate "default", pg_get_userbyid(c.relowner)::text collate "default", obj_description(c.oid, 'pg_class') is not null
     from pg_class c where c.oid = 'public.visit_time_current'::regclass $$,
  $$ values ('v'::text, '{security_invoker=true}'::text, 'postgres'::text, true) $$,
  'visit_time_current is a SECURITY INVOKER view owned by postgres with a comment: the caller''s RLS on visit_time_reports applies (database-schema.md §9)');
select results_eq(
  $$ select c.relname::text collate "default", c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner)::text collate "default",
            obj_description(c.oid, 'pg_class') is not null
     from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('service_calls', 'visits', 'visit_reports', 'visit_signatures', 'visit_time_reports', 'visit_events', 'entity_changes')
     order by c.relname::text collate "C" $$,
  $$ values ('entity_changes'::text, true, false, 'postgres'::text, true), ('service_calls', true, false, 'postgres', true),
            ('visit_events', true, false, 'postgres', true), ('visit_reports', true, false, 'postgres', true),
            ('visit_signatures', true, false, 'postgres', true), ('visit_time_reports', true, false, 'postgres', true),
            ('visits', true, false, 'postgres', true) $$,
  'the seven tables: RLS enabled (not forced: the SECURITY DEFINER bodies run as the owner), owned by postgres, with a comment naming their writers');

-- The text rules name their code points as escapes in ASCII strings (PR 1.4 INT-1): no CHECK on the
-- seven tables holds a literal invisible or bidi character.
select is_empty(
  $$ select k.conname from pg_constraint k
     where k.contype = 'c' and pg_get_constraintdef(k.oid) ~ '[^[:ascii:]]'
       and k.conrelid in ('public.service_calls'::regclass, 'public.visits'::regclass, 'public.visit_reports'::regclass,
                          'public.visit_signatures'::regclass, 'public.visit_time_reports'::regclass,
                          'public.visit_events'::regclass, 'public.entity_changes'::regclass) $$,
  'every CHECK on the seven tables is written in ASCII (escapes)');

-- ---------------------------------------------------------------------------------------------
-- 7. Fixtures (local, rolled back; fictional values, example.test; D47). Every row is test data.
--    Call 1 has visit 1 (scheduled) and its 'created' event, and next_visit_number 3, so every
--    probe below can insert visit 2. The fixture itself passes the deferred checks.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || k)::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'user-' || k || '@example.test',
       '{"role": "creator"}'::jsonb, '{"role": "creator"}'::jsonb, now(), now()
from unnest(array['c1', 'a1', 'd1']) as k;
select private.bootstrap_first_creator('00000000-0000-4000-8000-0000000000c1', 'יוצר');
insert into public.profiles (id, role, full_name, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'manager', 'מנהל א', true),
  ('00000000-0000-4000-8000-0000000000d1', 'technician', 'טכנאי א', true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', true, 'טכנאי א', 't-y', 'tech-a@example.test');
insert into public.customers (id, customer_number, name, phone, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000000601', 'C-1401', 'לקוח בדיקה', '050-000-0001', 'automated_test', 'pr15-140-1');
insert into public.products (id, sku_display, sku_normalized, name, data_source, source_ref) values
  ('00000000-0000-4000-8000-000000000501', 'kt-1401', 'KT-1401', 'מוצר בדיקה', 'automated_test', 'pr15-140-1');
insert into public.service_calls (id, request_number, customer_id, product_id, call_type_id, fault_description,
  handling_rep_name, status, next_visit_number, data_source, source_ref)
values ('00000000-0000-4000-8000-00000000c001', 'REQ-1401', '00000000-0000-4000-8000-000000000601',
        '00000000-0000-4000-8000-000000000501', (select t.id from public.call_types t where t.sort_order = 1),
        'לא מקרר', 'נציג א', 'open', 2, 'automated_test', 'pr15-140-1');
insert into public.visits (id, service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
  status, city, street, source_ref, is_test)
values ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000e1',
        1, 'T-1401', now() + interval '1 hour', now() + interval '2 hours', 'scheduled', 'חיפה', 'הנמל 1', 'pr15-140-1', true);
insert into public.visit_events (visit_id, version_after, event_type, to_status, is_test)
values ('00000000-0000-4000-8000-00000000b001', 1, 'created', 'scheduled', true);
update public.service_calls set next_visit_number = 3 where id = '00000000-0000-4000-8000-00000000c001';
select lives_ok('set constraints all immediate',
  'fixture: a call with its first visit and its created event passes the deferred checks (c10, c20)');
set constraints all deferred;

-- tm_text inserts one otherwise valid row with p_value in the named text column (visits: visit 2
-- of call 1; reports and signatures: on visit 1; their deferred checks never run, the probe is
-- undone first).
create function pg_temp.tm_text(p_target text, p_value text)
returns text
language sql
as $f$
  select pg_temp.tm_try(case
    when p_target like 'service_calls.%' then format(
      $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description,
           warranty_status, warranty_raw, handling_rep_name, status, next_visit_number, data_source, source_ref)
         values ('PROBE-1', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501',
                 (select t.id from public.call_types t where t.sort_order = 1), %L, 'yes', %L, %L, 'open', 2,
                 'automated_test', 'pr15-140-probe')$s$,
      case when p_target = 'service_calls.fault_description' then p_value else 'תקלה' end,
      case when p_target = 'service_calls.warranty_raw' then p_value else 'כן' end,
      case when p_target = 'service_calls.handling_rep_name' then p_value else 'נציג' end)
    when p_target like 'visits.%' then format(
      $s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start, scheduled_end,
           status, city, street, building, floor, apartment, arrival_notes, tech_notes, pickup_item, next_visit_notes,
           source_ref, is_test)
         values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000e1', 2, 'T-2', now(), now(),
                 'scheduled', %L, %L, %L, %L, %L, %L, %L, %L, %L, 'pr15-140-probe', true)$s$,
      case when p_target = 'visits.city' then p_value else 'חיפה' end,
      case when p_target = 'visits.street' then p_value else 'הנמל 1' end,
      case when p_target = 'visits.building' then p_value end,
      case when p_target = 'visits.floor' then p_value end,
      case when p_target = 'visits.apartment' then p_value end,
      case when p_target = 'visits.arrival_notes' then p_value end,
      case when p_target = 'visits.tech_notes' then p_value end,
      case when p_target = 'visits.pickup_item' then p_value end,
      case when p_target = 'visits.next_visit_notes' then p_value end)
    when p_target = 'visit_reports.summary_text' then format(
      $s$insert into public.visit_reports (visit_id, summary_text, summary_source)
         values ('00000000-0000-4000-8000-00000000b001', %L, 'written')$s$, p_value)
    when p_target like 'visit_signatures.%' then format(
      $s$insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id)
         values ('00000000-0000-4000-8000-00000000b001', %1$L, %2$L, encode(sha256(convert_to(%2$L, 'UTF8')), 'hex'),
                 gen_random_uuid())$s$,
      case when p_target = 'visit_signatures.signer_name' then p_value else 'ישראל ישראלי' end,
      case when p_target = 'visit_signatures.signed_ack_text' then p_value else 'אני מאשר שהעבודה בוצעה' end)
  end)
$f$;

-- ---------------------------------------------------------------------------------------------
-- 8. Text rules (TEMPORARY, OQ-6): TEXT-SAFE on single-line text, TEXT-SAFE-ML (TEXT-SAFE with a
--    line feed allowed inside, never first or last) on notes, fault, summary and approval text
-- ---------------------------------------------------------------------------------------------
create temporary table tm_text_column (target text primary key, max_len integer not null, multi_line boolean not null)
  on commit drop;
insert into tm_text_column values
  ('service_calls.fault_description', 1000, true), ('service_calls.warranty_raw', 60, false),
  ('service_calls.handling_rep_name', 60, false), ('visits.city', 60, false), ('visits.street', 120, false),
  ('visits.building', 20, false), ('visits.floor', 20, false), ('visits.apartment', 20, false),
  ('visits.arrival_notes', 1000, true), ('visits.tech_notes', 1000, true), ('visits.pickup_item', 120, false),
  ('visits.next_visit_notes', 1000, true), ('visit_reports.summary_text', 4000, true),
  ('visit_signatures.signer_name', 100, false), ('visit_signatures.signed_ack_text', 2000, true);

select results_eq(
  $$ select f.label, pg_temp.tm_text('service_calls.fault_description', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  $$ select f.label, '23514 service_calls_fault_description_check'::text from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  'service_calls.fault_description (TEXT-SAFE-ML): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected (a line feed is checked below)');
select results_eq(
  $$ select c.label, pg_temp.tm_text('service_calls.fault_description', c.val) from pg_temp.tm_shape_cases(1000, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 service_calls_fault_description_check' end from pg_temp.tm_shape_cases(1000, false) c $$,
  'service_calls.fault_description (TEXT-SAFE-ML, 1-1000): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('service_calls.warranty_raw', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 service_calls_warranty_raw_check'::text from tm_forbidden f order by f.cp $$,
  'service_calls.warranty_raw (TEXT-SAFE): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select c.label, pg_temp.tm_text('service_calls.warranty_raw', c.val) from pg_temp.tm_shape_cases(60, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 service_calls_warranty_raw_check' end from pg_temp.tm_shape_cases(60, false) c $$,
  'service_calls.warranty_raw (TEXT-SAFE, 1-60): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('service_calls.handling_rep_name', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 service_calls_handling_rep_name_check'::text from tm_forbidden f order by f.cp $$,
  'service_calls.handling_rep_name (TEXT-SAFE): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select c.label, pg_temp.tm_text('service_calls.handling_rep_name', c.val) from pg_temp.tm_shape_cases(60, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 service_calls_handling_rep_name_check' end from pg_temp.tm_shape_cases(60, false) c $$,
  'service_calls.handling_rep_name (TEXT-SAFE, 1-60): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visits.city', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 visits_city_check'::text from tm_forbidden f order by f.cp $$,
  'visits.city (TEXT-SAFE): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visits.city', c.val) from pg_temp.tm_shape_cases(60, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visits_city_check' end from pg_temp.tm_shape_cases(60, false) c $$,
  'visits.city (TEXT-SAFE, 1-60): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visits.street', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 visits_street_check'::text from tm_forbidden f order by f.cp $$,
  'visits.street (TEXT-SAFE): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visits.street', c.val) from pg_temp.tm_shape_cases(120, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visits_street_check' end from pg_temp.tm_shape_cases(120, false) c $$,
  'visits.street (TEXT-SAFE, 1-120): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visits.building', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 visits_building_check'::text from tm_forbidden f order by f.cp $$,
  'visits.building (TEXT-SAFE): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visits.building', c.val) from pg_temp.tm_shape_cases(20, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visits_building_check' end from pg_temp.tm_shape_cases(20, false) c $$,
  'visits.building (TEXT-SAFE, 1-20): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visits.floor', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 visits_floor_check'::text from tm_forbidden f order by f.cp $$,
  'visits.floor (TEXT-SAFE): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visits.floor', c.val) from pg_temp.tm_shape_cases(20, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visits_floor_check' end from pg_temp.tm_shape_cases(20, false) c $$,
  'visits.floor (TEXT-SAFE, 1-20): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visits.apartment', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 visits_apartment_check'::text from tm_forbidden f order by f.cp $$,
  'visits.apartment (TEXT-SAFE): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visits.apartment', c.val) from pg_temp.tm_shape_cases(20, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visits_apartment_check' end from pg_temp.tm_shape_cases(20, false) c $$,
  'visits.apartment (TEXT-SAFE, 1-20): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visits.arrival_notes', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  $$ select f.label, '23514 visits_arrival_notes_check'::text from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  'visits.arrival_notes (TEXT-SAFE-ML): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected (a line feed is checked below)');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visits.arrival_notes', c.val) from pg_temp.tm_shape_cases(1000, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visits_arrival_notes_check' end from pg_temp.tm_shape_cases(1000, false) c $$,
  'visits.arrival_notes (TEXT-SAFE-ML, 1-1000): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visits.tech_notes', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  $$ select f.label, '23514 visits_tech_notes_check'::text from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  'visits.tech_notes (TEXT-SAFE-ML): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected (a line feed is checked below)');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visits.tech_notes', c.val) from pg_temp.tm_shape_cases(1000, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visits_tech_notes_check' end from pg_temp.tm_shape_cases(1000, false) c $$,
  'visits.tech_notes (TEXT-SAFE-ML, 1-1000): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visits.pickup_item', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 visits_pickup_item_check'::text from tm_forbidden f order by f.cp $$,
  'visits.pickup_item (TEXT-SAFE): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visits.pickup_item', c.val) from pg_temp.tm_shape_cases(120, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visits_pickup_item_check' end from pg_temp.tm_shape_cases(120, false) c $$,
  'visits.pickup_item (TEXT-SAFE, 1-120): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visits.next_visit_notes', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  $$ select f.label, '23514 visits_next_visit_notes_check'::text from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  'visits.next_visit_notes (TEXT-SAFE-ML): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected (a line feed is checked below)');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visits.next_visit_notes', c.val) from pg_temp.tm_shape_cases(1000, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visits_next_visit_notes_check' end from pg_temp.tm_shape_cases(1000, false) c $$,
  'visits.next_visit_notes (TEXT-SAFE-ML, 1-1000): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visit_reports.summary_text', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  $$ select f.label, '23514 visit_reports_summary_text_check'::text from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  'visit_reports.summary_text (TEXT-SAFE-ML): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected (a line feed is checked below)');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visit_reports.summary_text', c.val) from pg_temp.tm_shape_cases(4000, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visit_reports_summary_text_check' end from pg_temp.tm_shape_cases(4000, false) c $$,
  'visit_reports.summary_text (TEXT-SAFE-ML, 1-4000): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visit_signatures.signer_name', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f order by f.cp $$,
  $$ select f.label, '23514 visit_signatures_signer_name_check'::text from tm_forbidden f order by f.cp $$,
  'visit_signatures.signer_name (TEXT-SAFE): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visit_signatures.signer_name', c.val) from pg_temp.tm_shape_cases(100, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visit_signatures_signer_name_check' end from pg_temp.tm_shape_cases(100, false) c $$,
  'visit_signatures.signer_name (TEXT-SAFE, 1-100): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');
select results_eq(
  $$ select f.label, pg_temp.tm_text('visit_signatures.signed_ack_text', 'אב' || chr(f.cp) || 'גד') from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  $$ select f.label, '23514 visit_signatures_signed_ack_text_check'::text from tm_forbidden f where f.cp <> 10 order by f.cp $$,
  'visit_signatures.signed_ack_text (TEXT-SAFE-ML): every control, separator, format, bidi and other default-ignorable character, private-use character and noncharacter is rejected (a line feed is checked below)');
select results_eq(
  $$ select c.label, pg_temp.tm_text('visit_signatures.signed_ack_text', c.val) from pg_temp.tm_shape_cases(2000, false) c $$,
  $$ select c.label, case when c.accepted then 'ok' else '23514 visit_signatures_signed_ack_text_check' end from pg_temp.tm_shape_cases(2000, false) c $$,
  'visit_signatures.signed_ack_text (TEXT-SAFE-ML, 1-2000): trim, length and NFC; no leading or trailing space but U+0020; compatibility variants allowed');

-- TEXT-SAFE-ML: a line feed inside is allowed; at either end, alone, or with a carriage return it
-- is refused (clients send LF line breaks); single-line text refuses it everywhere.
select results_eq(
  $$ select t.target || ': ' || c.label, pg_temp.tm_text(t.target, c.val)
     from tm_text_column t
     cross join (values (1, 'line feed inside', 'שורה א' || chr(10) || 'שורה ב'),
                        (2, 'empty line inside', 'שורה א' || chr(10) || chr(10) || 'שורה ב'),
                        (3, 'leading line feed', chr(10) || 'שורה א'),
                        (4, 'trailing line feed', 'שורה א' || chr(10)),
                        (5, 'only a line feed', chr(10)),
                        (6, 'carriage return inside', 'שורה א' || chr(13) || 'שורה ב'),
                        (7, 'CR LF inside', 'שורה א' || chr(13) || chr(10) || 'שורה ב'),
                        (8, 'line feed then a no-break space at the end', 'שורה א' || chr(10) || chr(x'00A0'::int))) c (n, label, val)
     order by t.target collate "C", c.n $$,
  $$ select t.target || ': ' || c.label,
            case when c.ok and t.multi_line then 'ok' else '23514 ' || replace(t.target, '.', '_') || '_check' end
     from tm_text_column t
     cross join (values (1, 'line feed inside', true), (2, 'empty line inside', true), (3, 'leading line feed', false),
                        (4, 'trailing line feed', false), (5, 'only a line feed', false),
                        (6, 'carriage return inside', false), (7, 'CR LF inside', false),
                        (8, 'line feed then a no-break space at the end', false)) c (n, label, ok)
     order by t.target collate "C", c.n $$,
  'TEXT-SAFE-ML (fault, notes, summary, approval text) allows a line feed inside only; TEXT-SAFE refuses it; a carriage return is refused everywhere');

-- ---------------------------------------------------------------------------------------------
-- 9. Formats and value sets, by behaviour
-- ---------------------------------------------------------------------------------------------
-- The call-row probe: p_set overrides the listed columns of an otherwise valid call.
create function pg_temp.tm_call_sql(p_cols text, p_vals text)
returns text
language sql
as $f$
  select format($s$insert into public.service_calls (customer_id, product_id, call_type_id, fault_description,
                     handling_rep_name, data_source, %s)
                   values ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501',
                           (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'automated_test', %s)$s$,
                p_cols, p_vals)
$f$;

insert into tm_case (grp, label, stmt, expected)
select 'request_number', c.label,
       pg_temp.tm_call_sql('request_number, status, next_visit_number, source_ref', format('%L, ''open'', 2, ''pr15-140-probe''', c.val)),
       c.expected
from (values
  (1, 'letters, digits and a hyphen', 'REQ-2041', 'ok'),
  (2, 'digits only', '20410001', 'ok'),
  (3, 'exactly 32 characters', repeat('A', 32), 'ok'),
  (4, '33 characters', repeat('A', 33), '23514 service_calls_request_number_check'),
  (5, 'empty', '', '23514 service_calls_request_number_check'),
  (6, 'internal space', 'REQ 2041', '23514 service_calls_request_number_check'),
  (7, 'trailing space', 'REQ-2041 ', '23514 service_calls_request_number_check'),
  (8, 'underscore', 'REQ_2041', '23514 service_calls_request_number_check'),
  (9, 'slash', 'REQ/2041', '23514 service_calls_request_number_check'),
  (10, 'Hebrew letters', 'קר-2041', '23514 service_calls_request_number_check'),
  (11, 'fullwidth digit', 'REQ-' || chr(x'FF12'::int), '23514 service_calls_request_number_check'),
  (12, 'right-to-left mark', 'REQ-2041' || chr(x'200F'::int), '23514 service_calls_request_number_check'),
  (13, 'the request number of another call (test and real rows share the key)', 'REQ-1401',
   '23505 service_calls_request_number_key'),
  (14, 'missing', null, '23502 request_number')
) c (n, label, val, expected)
order by c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'request_number' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'request_number' order by c.n $$,
  'request_number: required, ASCII letters, digits and hyphens, 1-32 (TEMPORARY OQ-6, the UI record key), unique across test and real rows');

insert into tm_case (grp, label, stmt, expected)
select 'call_status', c.label,
       pg_temp.tm_call_sql('request_number, source_ref, ' || c.cols, c.vals), c.expected
from (values
  (1, 'open', 'status, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''open'', 2', 'ok'),
  (2, 'awaiting_followup', 'status, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''awaiting_followup'', 2', 'ok'),
  (3, 'awaiting_scheduling', 'status, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''awaiting_scheduling'', 2', 'ok'),
  (4, 'resolved with resolved_at', 'status, resolved_at, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''resolved'', now(), 2', 'ok'),
  (5, 'cancelled (no cancelled call status, D38)', 'status, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''cancelled'', 2',
   '23514 service_calls_status_check'),
  (6, 'closed', 'status, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''closed'', 2', '23514 service_calls_status_check'),
  (7, 'upper-case OPEN', 'status, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''OPEN'', 2', '23514 service_calls_status_check'),
  (8, 'resolved without resolved_at', 'status, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''resolved'', 2',
   '23514 service_calls_resolved_at_check'),
  (9, 'open with resolved_at', 'status, resolved_at, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''open'', now(), 2',
   '23514 service_calls_resolved_at_check'),
  (10, 'status missing (no default)', 'next_visit_number', '''PROBE-1'', ''pr15-140-probe'', 2', '23502 status'),
  (11, 'next_visit_number missing (no default)', 'status', '''PROBE-1'', ''pr15-140-probe'', ''open''', '23502 next_visit_number'),
  (12, 'next_visit_number 1', 'status, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''open'', 1',
   '23514 service_calls_next_visit_number_check'),
  (13, 'next_visit_number 1000', 'status, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''open'', 1000', 'ok'),
  (14, 'next_visit_number 1001', 'status, next_visit_number', '''PROBE-1'', ''pr15-140-probe'', ''open'', 1001',
   '23514 service_calls_next_visit_number_check'),
  (15, 'version 0', 'status, next_visit_number, version', '''PROBE-1'', ''pr15-140-probe'', ''open'', 2, 0',
   '23514 service_calls_version_check')
) c (n, label, cols, vals, expected)
order by c.n;
insert into tm_case (grp, label, stmt, expected) values
  ('call_status', 'source microsoft_graph (fails closed until an approved Step 11 migration)',
   $s$insert into public.service_calls (request_number, customer_id, product_id, call_type_id, fault_description,
        handling_rep_name, status, next_visit_number, data_source, source_ref)
      values ('PROBE-1', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501',
              (select t.id from public.call_types t where t.sort_order = 1), 'תקלה', 'נציג', 'open', 2, 'microsoft_graph',
              'pr15-140-probe')$s$,
   '23514 service_calls_data_source_check');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'call_status' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'call_status' order by c.n $$,
  'call status: the four D38 codes only (never cancelled); resolved exactly when resolved_at is set; status and next_visit_number have no default; next_visit_number 2-1000');

insert into tm_case (grp, label, stmt, expected)
select 'warranty', c.label,
       pg_temp.tm_call_sql('request_number, status, next_visit_number, source_ref, warranty_status, warranty_until, warranty_raw',
                           format('''PROBE-1'', ''open'', 2, ''pr15-140-probe'', %L, %L::date, %L', c.st, c.until, c.raw)),
       c.expected
from (values
  (1, 'yes until a month (first day) with the raw text', 'yes', '2028-03-01', 'כן · עד 03/2028', 'ok'),
  (2, 'yes without a month', 'yes', null, 'כן', 'ok'),
  (3, 'no with the raw text', 'no', null, 'לא', 'ok'),
  (4, 'not given ("לא צוין")', null, null, null, 'ok'),
  (5, 'yes until the middle of a month', 'yes', '2028-03-15', 'כן', '23514 service_calls_warranty_until_check'),
  (6, 'no with a month', 'no', '2028-03-01', 'לא', '23514 service_calls_warranty_until_check'),
  (7, 'a month without a status', null, '2028-03-01', null, '23514 service_calls_warranty_until_check'),
  (8, 'yes without the raw text', 'yes', null, null, '23514 service_calls_warranty_raw_status_check'),
  (9, 'raw text without a status (an unparseable value is not ingested)', null, null, 'אולי', '23514 service_calls_warranty_raw_status_check'),
  (10, 'another status', 'maybe', null, 'אולי', '23514 service_calls_warranty_status_check'),
  (11, 'upper-case YES', 'YES', null, 'כן', '23514 service_calls_warranty_status_check')
) c (n, label, st, until, raw, expected)
order by c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'warranty' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'warranty' order by c.n $$,
  'TEMPORARY OQ-7: warranty yes / no / not given; a month only with yes, stored as its first day; the raw text only together with a parsed value');

insert into tm_case (grp, label, stmt, expected)
select 'source_ref', c.label,
       case c.t
         when 'service_calls' then pg_temp.tm_call_sql('request_number, status, next_visit_number, source_ref',
                                                       format('''PROBE-1'', ''open'', 2, %L', c.val))
         else format($s$insert into public.visits (service_call_id, technician_id, visit_number, task_number, scheduled_start,
                          scheduled_end, status, city, street, source_ref, is_test)
                        values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000e1', 2, 'T-2',
                                now(), now(), 'scheduled', 'חיפה', 'הנמל 1', %L, true)$s$, c.val)
       end,
       case when c.ok then 'ok' when c.val is null then '23502 source_ref' else '23514 ' || c.t || '_source_ref_check' end
from (values ('service_calls'), ('visits')) t (t)
cross join lateral (values
  (1, t.t, t.t || ': simulator event id', 'sim:evt-2041.1_a', true),
  (2, t.t, t.t || ': exactly 200 characters', repeat('a', 200), true),
  (3, t.t, t.t || ': 201 characters', repeat('a', 201), false),
  (4, t.t, t.t || ': empty', '', false),
  (5, t.t, t.t || ': a space', 'sim evt', false),
  (6, t.t, t.t || ': a raw Graph id character =', 'AAMkAG=', false),
  (7, t.t, t.t || ': a raw Graph id character /', 'AAMk/AG', false),
  (8, t.t, t.t || ': a raw Graph id character +', 'AAMk+AG', false),
  (9, t.t, t.t || ': Hebrew text', 'זימון', false),
  (10, t.t, t.t || ': missing', null, false)
) c (n, t, label, val, ok)
order by t.t, c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'source_ref' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'source_ref' order by c.n $$,
  'source_ref on calls and visits: required, an opaque internal reference of 1-200 ASCII characters (Migration 2''s rule); never invitation text or a raw Graph event id');

-- The visit-row probe: p_cols / p_vals override columns of an otherwise valid visit 2 of call 1.
create function pg_temp.tm_visit_sql(p_cols text, p_vals text)
returns text
language sql
as $f$
  select format($s$insert into public.visits (service_call_id, technician_id, source_ref, is_test, city, street, %s)
                   values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000e1',
                           'pr15-140-probe', true, 'חיפה', 'הנמל 1', %s)$s$, p_cols, p_vals)
$f$;

insert into tm_case (grp, label, stmt, expected)
select 'task_number', c.label,
       pg_temp.tm_visit_sql('visit_number, status, scheduled_start, scheduled_end, task_number',
                            format('2, ''scheduled'', now(), now(), %L', c.val)),
       c.expected
from (values
  (1, 'letters, digits and a hyphen', 'T-2041', 'ok'),
  (2, 'single internal space', 'T 2041', 'ok'),
  (3, 'printable ASCII punctuation', 'a.b/c_d#1', 'ok'),
  (4, 'exactly 40 characters', repeat('7', 40), 'ok'),
  (5, 'the task number of visit 1 (no uniqueness, D41)', 'T-1401', 'ok'),
  (6, 'empty', '', '23514 visits_task_number_check'),
  (7, 'leading space', ' T-2041', '23514 visits_task_number_check'),
  (8, 'trailing space', 'T-2041 ', '23514 visits_task_number_check'),
  (9, 'doubled space', 'T  2041', '23514 visits_task_number_check'),
  (10, 'no-break space', 'T' || chr(x'00A0'::int) || '2041', '23514 visits_task_number_check'),
  (11, 'Hebrew letters', 'מש-2041', '23514 visits_task_number_check'),
  (12, 'tab', 'T' || chr(9) || '2041', '23514 visits_task_number_check'),
  (13, 'left-to-right mark', chr(x'200E'::int) || 'T-2041', '23514 visits_task_number_check'),
  (14, '41 characters', repeat('7', 41), '23514 visits_task_number_check'),
  (15, 'missing (TEMPORARY OQ-5)', null, '23502 task_number')
) c (n, label, val, expected)
order by c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'task_number' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'task_number' order by c.n $$,
  'task_number: required (TEMPORARY OQ-5), printable ASCII with single internal spaces, 1-40 (OQ-6), and not unique (D41)');

insert into tm_case (grp, label, stmt, expected)
select 'visit_columns', c.label, pg_temp.tm_visit_sql(c.cols, c.vals), c.expected
from (values
  (1, 'each of the six visit codes: scheduled', 'visit_number, task_number, scheduled_start, scheduled_end, status',
   '2, ''T-2'', now(), now(), ''scheduled''', 'ok'),
  (2, 'en_route', 'visit_number, task_number, scheduled_start, scheduled_end, status', '2, ''T-2'', now(), now(), ''en_route''', 'ok'),
  (3, 'in_progress', 'visit_number, task_number, scheduled_start, scheduled_end, status', '2, ''T-2'', now(), now(), ''in_progress''', 'ok'),
  (4, 'done', 'visit_number, task_number, scheduled_start, scheduled_end, status', '2, ''T-2'', now(), now(), ''done''', 'ok'),
  (5, 'followup (with a reason and next-visit notes)',
   'visit_number, task_number, scheduled_start, scheduled_end, status, followup_reason_id, next_visit_notes',
   '2, ''T-2'', now(), now(), ''followup'', (select r.id from public.followup_reasons r where r.sort_order = 1), ''להביא חלק''', 'ok'),
  (6, 'cancelled', 'visit_number, task_number, scheduled_start, scheduled_end, status', '2, ''T-2'', now(), now(), ''cancelled''', 'ok'),
  (7, 'a demo code (new) is not a database code (DEV-3)', 'visit_number, task_number, scheduled_start, scheduled_end, status',
   '2, ''T-2'', now(), now(), ''new''', '23514 visits_status_check'),
  (8, 'cont', 'visit_number, task_number, scheduled_start, scheduled_end, status', '2, ''T-2'', now(), now(), ''cont''',
   '23514 visits_status_check'),
  (9, 'status missing', 'visit_number, task_number, scheduled_start, scheduled_end', '2, ''T-2'', now(), now()', '23502 status'),
  (10, 'end before start', 'visit_number, task_number, scheduled_start, scheduled_end, status',
   '2, ''T-2'', now(), now() - interval ''1 minute'', ''scheduled''', '23514 visits_schedule_check'),
  (11, 'end equal to start', 'visit_number, task_number, scheduled_start, scheduled_end, status',
   '2, ''T-2'', now(), now(), ''scheduled''', 'ok'),
  (12, 'scheduled start missing', 'visit_number, task_number, scheduled_end, status', '2, ''T-2'', now(), ''scheduled''',
   '23502 scheduled_start'),
  (13, 'version 0', 'visit_number, task_number, scheduled_start, scheduled_end, status, version',
   '2, ''T-2'', now(), now(), ''scheduled'', 0', '23514 visits_version_check'),
  (14, 'field_version 0', 'visit_number, task_number, scheduled_start, scheduled_end, status, field_version',
   '2, ''T-2'', now(), now(), ''scheduled'', 0', '23514 visits_field_version_check')
) c (n, label, cols, vals, expected)
order by c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'visit_columns' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'visit_columns' order by c.n $$,
  'visits: the six status codes only (the adapter maps the demo codes, DEV-3); the schedule ends at or after its start; versions start at 1');

-- visit_number 1-999 is defence in depth behind the allocation guard t35 (which rejects 0 and any
-- number at or above next_visit_number first). t35 is disabled inside each probe only.
insert into tm_case (grp, label, stmt, expected)
select 'visit_number', c.label,
       'alter table public.visits disable trigger t35_visit_number; '
       || pg_temp.tm_visit_sql('task_number, scheduled_start, scheduled_end, status, visit_number',
                               format('''T-2'', now(), now(), ''scheduled'', %s', c.val)),
       c.expected
from (values
  (1, 'visit number 999', '999', 'ok'),
  (2, 'visit number 0', '0', '23514 visits_visit_number_check'),
  (3, 'visit number 1000', '1000', '23514 visits_visit_number_check'),
  (4, 'visit number 1 again (one number per call)', '1', '23505 visits_service_call_id_visit_number_key'),
  (5, 'visit number missing', 'null', '23502 visit_number')
) c (n, label, val, expected)
order by c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'visit_number' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'visit_number' order by c.n $$,
  'with the allocation guard disabled (rolled back), the CHECK still keeps visit numbers in 1-999 and the unique key keeps one number per call');

insert into tm_case (grp, label, stmt, expected)
select 'visit_events', c.label,
       format($s$insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status)
                 values ('00000000-0000-4000-8000-00000000b001', %s, %L, %L, %L)$s$, c.ver, c.typ, c.frm, c.too),
       c.expected
from (values
  (1, 'a status change', '2', 'status_changed', 'scheduled', 'en_route', 'ok'),
  (2, 'a second created event', '1', 'created', null, 'scheduled', 'ok'),
  (3, 'another event type', '2', 'updated', 'scheduled', 'en_route', '23514 visit_events_event_type_check'),
  (4, 'created with a from status', '1', 'created', 'scheduled', 'en_route', '23514 visit_events_event_type_from_status_check'),
  (5, 'status change without a from status', '2', 'status_changed', null, 'en_route', '23514 visit_events_event_type_from_status_check'),
  (6, 'a change to the same status', '2', 'status_changed', 'scheduled', 'scheduled', '23514 visit_events_status_change_check'),
  (7, 'from a demo code', '2', 'status_changed', 'new', 'en_route', '23514 visit_events_from_status_check'),
  (8, 'to a demo code', '2', 'status_changed', 'scheduled', 'go', '23514 visit_events_to_status_check'),
  (9, 'version_after 0', '0', 'status_changed', 'scheduled', 'en_route', '23514 visit_events_version_after_check'),
  (10, 'to_status missing', '2', 'status_changed', 'scheduled', null, '23502 to_status')
) c (n, label, ver, typ, frm, too, expected)
order by c.n;
insert into tm_case (grp, label, stmt, expected) values
  ('visit_reports', 'written summary', $s$insert into public.visit_reports (visit_id, summary_text, summary_source)
     values ('00000000-0000-4000-8000-00000000b001', 'הוחלף מדחס', 'written')$s$, 'ok'),
  ('visit_reports', 'approved transcription', $s$insert into public.visit_reports (visit_id, summary_text, summary_source)
     values ('00000000-0000-4000-8000-00000000b001', 'הוחלף מדחס', 'approved_transcription')$s$, 'ok'),
  ('visit_reports', 'an unapproved transcription is never a summary (D12)', $s$insert into public.visit_reports (visit_id, summary_text, summary_source)
     values ('00000000-0000-4000-8000-00000000b001', 'הוחלף מדחס', 'transcription')$s$, '23514 visit_reports_summary_source_check'),
  ('visit_reports', 'a recording', $s$insert into public.visit_reports (visit_id, summary_text, summary_source)
     values ('00000000-0000-4000-8000-00000000b001', 'הוחלף מדחס', 'audio')$s$, '23514 visit_reports_summary_source_check'),
  ('visit_reports', 'source missing', $s$insert into public.visit_reports (visit_id, summary_text)
     values ('00000000-0000-4000-8000-00000000b001', 'הוחלף מדחס')$s$, '23502 summary_source'),
  ('visit_reports', 'version 0', $s$insert into public.visit_reports (visit_id, summary_text, summary_source, version)
     values ('00000000-0000-4000-8000-00000000b001', 'הוחלף מדחס', 'written', 0)$s$, '23514 visit_reports_version_check');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'visit_events' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'visit_events' order by c.n $$,
  'visit_events: created or status_changed; a created event has no from status, a change has one and changes the status; codes are the six visit codes');
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'visit_reports' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'visit_reports' order by c.n $$,
  'visit_reports: the summary source is written or an approved transcription only (D12)');

-- Time reports (D45): the device row shape. Infinite device times are covered in 200.
create function pg_temp.tm_time_sql(p_cols text, p_vals text)
returns text
language sql
as $f$
  select format($s$insert into public.visit_time_reports (visit_id, reported_by_profile_id, technician_id, %s)
                   values ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000000d1',
                           '00000000-0000-4000-8000-0000000000e1', %s)$s$, p_cols, p_vals)
$f$;
insert into tm_case (grp, label, stmt, expected)
select 'time_reports', c.label, pg_temp.tm_time_sql(c.cols, c.vals), c.expected
from (values
  (1, 'a complete device report', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''arrived'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), ''device''', 'ok'),
  (2, 'each kind: departed', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''departed'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), ''device''', 'ok'),
  (3, 'ended', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''ended'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), ''device''', 'ok'),
  (4, 'signed', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''signed'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), ''device''', 'ok'),
  (5, 'another kind', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''paused'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), ''device''', '23514 visit_time_reports_kind_check'),
  (6, 'source missing (no default)', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id',
   '''arrived'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid()', '23502 source'),
  (7, 'a correction source (PR 1.6, DEV-2)', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''arrived'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), ''correction''', '23514 visit_time_reports_source_check'),
  (8, 'device time missing', 'kind, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''arrived'', ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), ''device''', '23514 visit_time_reports_device_check'),
  (9, 'device zone missing', 'kind, reported_at, device_utc_offset_min, device_sent_at, operation_id, source',
   '''arrived'', now(), 120, now(), gen_random_uuid(), ''device''', '23514 visit_time_reports_device_check'),
  (10, 'device offset missing', 'kind, reported_at, device_tz, device_sent_at, operation_id, source',
   '''arrived'', now(), ''Asia/Jerusalem'', now(), gen_random_uuid(), ''device''', '23514 visit_time_reports_device_check'),
  (11, 'send time missing (no skew either)', 'kind, reported_at, device_tz, device_utc_offset_min, operation_id, source',
   '''arrived'', now(), ''Asia/Jerusalem'', 120, gen_random_uuid(), ''device''', '23514 visit_time_reports_device_check'),
  (12, 'operation id missing', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, source',
   '''arrived'', now(), ''Asia/Jerusalem'', 120, now(), ''device''', '23514 visit_time_reports_device_check'),
  (13, 'offset -840 minutes', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''arrived'', now(), ''Etc/GMT+14'', -840, now(), gen_random_uuid(), ''device''', 'ok'),
  (14, 'offset 840 minutes', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''arrived'', now(), ''Pacific/Kiritimati'', 840, now(), gen_random_uuid(), ''device''', 'ok'),
  (15, 'offset 841 minutes', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''arrived'', now(), ''Asia/Jerusalem'', 841, now(), gen_random_uuid(), ''device''', '23514 visit_time_reports_device_utc_offset_min_check'),
  (16, 'offset -841 minutes', 'kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
   '''arrived'', now(), ''Asia/Jerusalem'', -841, now(), gen_random_uuid(), ''device''', '23514 visit_time_reports_device_utc_offset_min_check')
) c (n, label, cols, vals, expected)
order by c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'time_reports' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'time_reports' order by c.n $$,
  'visit_time_reports: four kinds; source device only and required; a device row carries its time, zone, offset (-840..840), send time and operation id (D45)');

-- device_tz: an IANA zone name shape (V7): the zones Israel devices send are accepted.
insert into tm_case (grp, label, stmt, expected)
select 'device_tz', c.label,
       pg_temp.tm_time_sql('kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source',
                           format('''arrived'', now(), %L, 120, now(), gen_random_uuid(), ''device''', c.val)),
       case when c.ok then 'ok' else '23514 visit_time_reports_device_tz_check' end
from (values
  (1, 'Asia/Jerusalem', 'Asia/Jerusalem', true),
  (2, 'Asia/Tel_Aviv (alias)', 'Asia/Tel_Aviv', true),
  (3, 'Israel (alias)', 'Israel', true),
  (4, 'UTC', 'UTC', true),
  (5, 'Etc/GMT-3', 'Etc/GMT-3', true),
  (6, 'three parts: America/Argentina/Buenos_Aires', 'America/Argentina/Buenos_Aires', true),
  (7, 'an offset instead of a zone', '+03:00', false),
  (8, 'empty', '', false),
  (9, 'trailing slash', 'Asia/Jerusalem/', false),
  (10, 'four parts', 'A/B/C/D', false),
  (11, 'a space', 'Asia/Tel Aviv', false),
  (12, 'a line feed', 'Asia/Jerusalem' || chr(10), false),
  (13, 'Hebrew text', 'אסיה/ירושלים', false),
  (14, '65 characters', 'A/' || repeat('b', 63), false)
) c (n, label, val, ok)
order by c.n;
select results_eq(
  $$ select c.label, pg_temp.tm_try(c.stmt) from tm_case c where c.grp = 'device_tz' order by c.n $$,
  $$ select c.label, c.expected from tm_case c where c.grp = 'device_tz' order by c.n $$,
  'device_tz: the IANA names Israel devices send are accepted (V7); offsets, empty, malformed or non-ASCII names and names over 64 characters are refused');

-- row_flags are computed by t35 (client values ignored, see 200); with t35 disabled (rolled back)
-- the CHECK still keeps them in the flag set.
select results_eq(
  $$ select pg_temp.tm_try('alter table public.visit_time_reports disable trigger t35_time_report; '
                           || pg_temp.tm_time_sql('kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source, clock_skew_ms, row_flags',
                                                  '''arrived'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), ''device'', 0, ''{large_skew,future_time,before_assignment}''')),
            pg_temp.tm_try('alter table public.visit_time_reports disable trigger t35_time_report; '
                           || pg_temp.tm_time_sql('kind, reported_at, device_tz, device_utc_offset_min, device_sent_at, operation_id, source, clock_skew_ms, row_flags',
                                                  '''arrived'', now(), ''Asia/Jerusalem'', 120, now(), gen_random_uuid(), ''device'', 0, ''{suspicious}''')) $$,
  $$ values ('ok'::text, '23514 visit_time_reports_row_flags_check'::text) $$,
  'row_flags hold only future_time, large_skew and before_assignment (TEMPORARY OQ-11), even with the deriving trigger disabled');

select * from finish();
rollback;
