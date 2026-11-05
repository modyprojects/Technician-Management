-- Review round 1, F1: a cast to json for a type the migration owns. to_jsonb would apply it and show
-- only the lower bound ("fictional", unchanged), while the stored value now carries the item name.
-- The snapshot reads values through the type's output function, so the change is visible.
create type public.label_range as range (subtype = text, collation = "C");
create function public.label_range_json(public.label_range) returns json
  language sql immutable set search_path = ''
  as $$ select pg_catalog.to_json(pg_catalog.lower($1)) $$;
create cast (public.label_range as json) with function public.label_range_json(public.label_range);
alter table public.items alter column note type public.label_range
  using case when note is null then null else public.label_range(note, note || ' | ' || name, '[]') end;
