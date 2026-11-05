-- Self-test schema: a reference table with owner-approved rows (volatile id and created_at).
create table public.call_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label_he text not null,
  sort_order integer not null,
  created_at timestamptz not null default now()
);
alter table public.call_types enable row level security;
insert into public.call_types (code, label_he, sort_order) values
  ('repair', 'תיקון', 1),
  ('install', 'התקנה', 2);
