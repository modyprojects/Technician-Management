-- Self-test schema: a business table that holds canary rows in the canary run.
create table public.items (
  id uuid primary key,
  name text not null,
  qty integer not null,
  note text,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.items enable row level security;
create table public.item_log (
  id uuid primary key,
  item_id uuid not null,
  note text not null,
  is_test boolean not null default false
);
alter table public.item_log enable row level security;
