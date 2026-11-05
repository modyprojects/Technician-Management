-- Schema changes that keep every existing value: a wider type, a constraint the rows satisfy, an
-- enum type, a new schema with an empty table, a sequence, a column comment.
alter table public.items alter column name type varchar(200);
alter table public.items add constraint items_qty_non_negative check (qty >= 0);
create type public.item_kind as enum ('part', 'tool');
create schema app;
create table app.staging (id integer primary key);
create sequence public.item_numbers;
comment on column public.items.note is 'Free text.';
