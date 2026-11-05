-- Self-test schema: a table with a json column (stored as text, unlike jsonb).
create table public.docs (
  id uuid primary key,
  body json not null,
  tags text[] not null,
  is_test boolean not null default false
);
alter table public.docs enable row level security;
