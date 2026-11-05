-- A non-null default fills existing rows: a data change by R1's definition.
alter table public.items add column flag boolean not null default false;
