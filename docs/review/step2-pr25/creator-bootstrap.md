# D49 Creator bootstrap: procedure (Step 2 / PR 2.5)

The one-time remote write that gives the owner's own Auth user the first Creator profile. It runs **only** after the owner's separate explicit approval of this operation (D49, D52 rule 6, D59). The owner chose sign-in without MFA during restricted development testing (D63); that choice does not approve this write.

No email address, name or user id is recorded in this repository. The values are filled in at run time from the read-only pre-check and the owner's approval message.

## Preconditions (read-only pre-check, `set transaction read only;`)
- Exactly one Auth user with the owner's own email address: confirmed, email provider, not anonymous, not SSO, not deleted, not banned, no profile, no MFA factor.
- No Creator and no profile in `public.profiles`; `public.audit_logs` row count recorded; `private.audit_chain_verify()` returns NULL.
- `md5(prosrc)` of `private.bootstrap_first_creator` is `28230a46b9d2c3ad37a9246d032eb4e5` (the body in `supabase/migrations/20261104120000_access_and_permissions.sql`, checked 2026-11-17); EXECUTE only for `postgres` and `supabase_admin`.
- The two public Supabase values exist for Preview only, none for Production (Vercel, names checked; values never read).

Any other result stops the procedure; the owner is told, nothing is retried.

## The write (one `execute_sql` call, one DO block, one transaction)
The full name travels as UTF-8 hex and is checked by its md5 inside the block (Hebrew text is not exposed to transport re-encoding). The block refuses before writing if the name check, the function hash or the audit chain fails, calls the reviewed function once, and refuses (rolling everything back) unless exactly one active, non-test Creator with that id and name exists, exactly one audit row was added (`creator.bootstrapped`, `profiles`, that id) and the chain is intact.

```sql
-- D49 one-time Creator bootstrap (Step 2 / PR 2.5). Runs as postgres, outside any JWT context.
-- One DO block = one transaction: any failed check raises and nothing is written.
do $boot$
declare
  v_user uuid := '__USER_ID__';
  v_name text := convert_from(decode('__NAME_HEX__', 'hex'), 'UTF8');
  v_audit_before bigint;
begin
  if md5(v_name) <> '__NAME_MD5__' then
    raise exception using errcode = '22023', message = 'name transport check failed';
  end if;
  if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = 'bootstrap_first_creator')
     is distinct from '28230a46b9d2c3ad37a9246d032eb4e5' then
    raise exception using errcode = '55000', message = 'bootstrap function differs from the reviewed source';
  end if;
  if private.audit_chain_verify() is not null then
    raise exception using errcode = '55000', message = 'audit chain broken before the bootstrap';
  end if;
  select count(*) into v_audit_before from public.audit_logs;
  perform private.bootstrap_first_creator(v_user, v_name);
  if (select count(*) from public.profiles where role = 'creator') <> 1
     or not exists (select 1 from public.profiles p
                     where p.id = v_user and p.role = 'creator' and p.is_active and not p.is_test
                       and p.deleted_at is null and p.full_name = btrim(v_name)) then
    raise exception using errcode = '55000', message = 'post-check failed: Creator profile';
  end if;
  if (select count(*) from public.audit_logs) <> v_audit_before + 1
     or not exists (select 1 from public.audit_logs a
                     where a.action = 'creator.bootstrapped' and a.target_table = 'profiles' and a.target_id = v_user) then
    raise exception using errcode = '55000', message = 'post-check failed: audit row';
  end if;
  if private.audit_chain_verify() is not null then
    raise exception using errcode = '55000', message = 'post-check failed: audit chain';
  end if;
end
$boot$;
```

`__USER_ID__` comes from the pre-check; `__NAME_HEX__` and `__NAME_MD5__` are computed from the approved full name (trimmed, 1–60 characters, as the `profiles` full-name CHECK requires).

## Post-verification (read-only)
- One profile in total: the Creator, active, `is_test = false`, the approved name.
- One audit row `creator.bootstrapped` for that id; `private.audit_chain_verify()` NULL.
- No other table changed (row counts of the D47 census unchanged).
- Security advisors: no new finding.

## Rehearsal (2026-11-17, local stack only)
On a freshly reset local database (Migrations 1–5) with one fictional Auth user: the rendered block wrote one Creator profile and one `creator.bootstrapped` audit row, chain intact. Running it again failed inside the function ("a Creator already exists") and a block with a wrong name hash failed at the first check; both left the counts unchanged (one profile, one audit row). The real project was not contacted.

## Run on the remote project (2026-11-17, owner-approved)
- **Approval:** the owner's explicit message of 2026-11-17 for one run on `ooxozvvrljjkyfduuiks`, for his own Auth user, with the name he gave; stop without retry on any failed check.
- **Pre-check (read-only):** one Auth user (his, created 2026-11-17 in the dashboard after he deleted the 2026-11-11 user; signed in once from the Preview, then refused by the app for having no profile); confirmed, email provider, one email identity, not anonymous, not SSO, not deleted, not banned, no MFA factor, no profile; 0 profiles, 0 Creators, 0 audit rows; chain NULL; function body md5 `28230a46…eb4e5`; EXECUTE only `postgres`, `supabase_admin`. Non-zero tables before: `call_types` 2, `followup_reasons` 5, `permissions` 16, `role_permissions` 32.
- **Run:** the rendered block (template above, placeholders only filled in) once through `execute_sql`; it completed without error.
- **Post-verification (read-only):** one profile in total: role `creator`, active, `is_test = false`, not deleted, version 1, name md5 equal to the approved name's; one audit row (id 1) `creator.bootstrapped` on `profiles` for that id, `target_is_test = false`, no actor (run outside any session, as designed); `private.audit_chain_verify()` NULL; non-zero tables after: the four reference tables unchanged, plus `profiles` 1 and `audit_logs` 1. Security advisors: only the existing WARN `auth_leaked_password_protection`.
