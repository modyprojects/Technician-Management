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
-- Reference rows whose updated_at comes from now(): volatile, masked for this migration's rows.
create table public.settings (
  key text primary key,
  updated_at timestamptz not null default now(),
  is_test boolean not null default false
);
alter table public.settings enable row level security;
insert into public.settings (key) values ('calendar'), ('exports');
