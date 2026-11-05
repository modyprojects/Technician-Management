do $$ begin if exists (select 1 from public.items) then create table public.flagged (id integer); end if; end $$;
