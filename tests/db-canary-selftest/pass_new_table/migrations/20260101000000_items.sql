-- A new table with an identity key and a column that is set only later (coverage exception).
create table public.visits (
  id bigint generated always as identity primary key,
  ref uuid not null unique,
  status text not null,
  archived_at timestamptz,
  is_test boolean not null default false
);
alter table public.visits enable row level security;
