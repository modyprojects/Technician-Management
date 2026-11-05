-- A nullable column: existing rows get JSON null (allowed by R1).
alter table public.items add column color text;
