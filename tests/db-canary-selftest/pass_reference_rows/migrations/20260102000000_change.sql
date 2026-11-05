-- One more owner-approved reference row; an identity-keyed reference table too.
insert into public.call_types (code, label_he, sort_order) values ('maintenance', 'תחזוקה', 3);
create table public.followup_reasons (id integer generated always as identity primary key, label_he text not null);
alter table public.followup_reasons enable row level security;
insert into public.followup_reasons (label_he) values ('חסר חלק'), ('לקוח לא בבית');
