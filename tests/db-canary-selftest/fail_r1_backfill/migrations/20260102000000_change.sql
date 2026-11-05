alter table public.items add column label text;
update public.items set label = name;
