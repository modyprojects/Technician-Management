-- A cluster-wide change (a role): the harness must fall back to a full reset between runs.
create role canary_selftest_role nologin;
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
