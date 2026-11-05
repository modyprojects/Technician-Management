-- Schema only: an index, a policy, a function, a trigger for later updates, a comment, a grant.
create index items_name_idx on public.items (name);
create policy items_select on public.items for select to authenticated using (is_test = false);
create function public.items_total() returns bigint language sql stable set search_path = '' as $$ select count(*) from public.items $$;
create function public.items_touch() returns trigger language plpgsql set search_path = '' as $$ begin new.note := coalesce(new.note, 'touched'); return new; end $$;
create trigger items_touch before update on public.items for each row execute function public.items_touch();
comment on table public.items is 'Self-test items.';
grant select on public.items to authenticated;
