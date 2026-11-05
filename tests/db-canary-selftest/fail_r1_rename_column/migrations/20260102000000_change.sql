-- A rename counts as a dropped column (fail closed): a rename can change what values mean.
alter table public.items rename column note to remark;
