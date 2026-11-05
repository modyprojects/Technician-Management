# Canary fixtures (`scripts/db-canary.mjs`)

These files feed the runtime canary-rows check (`docs/testing.md`, "Canary rows check"). The check applies the migrations to an empty local database twice without canary rows (reference runs A1 and A2) and once with them (canary run B), and fails when a migration changes, removes, copies or derives data from existing rows.

They live in `tests/db-canary/`, not in `tests/db/`: `supabase test db tests/db` runs every `.sql` file under `tests/db/` (subfolders included) as a pgTAP test.

## Files

| File | Purpose |
|---|---|
| `000_base.sql` | Base canary rows **outside** `public` and `private` (Auth users and an identity, a Storage bucket and object). Inserted before the first migration of the canary run. |
| `<version>.sql` | Canary rows for migration `<version>_<name>.sql`. Inserted right after that migration. One file per migration version, needed whenever rule R6 (coverage) would otherwise fail after that migration: a new table that the migration's own reference rows do not fill, a new column that no row sets, or a column set only in a state no row is in yet. A migration that only adds reference rows that fill every column, or changes no table, needs none. |
| `coverage-exceptions.json` | Tables or columns that cannot be covered, each with a reason. Starts empty (`[]`). One global file, not one per migration (see step 8). |
| `README.md` | This file. Any other file in this folder fails the check. |

## How to write a fixture

1. **One file per migration version**, named after the migration's numeric prefix (`20261104120000.sql` for `20261104120000_access_and_permissions.sql`). A fixture whose version matches no migration fails the check.
2. **Write it against the schema as of that migration**, and **never edit it after that migration is merged**. Later migrations run on top of these rows; changing old rows would change what earlier steps proved. Add rows in the later migration's fixture instead.
3. **Fictional and test-marked (D47):** invented names, `example.test` addresses (any other e-mail domain fails the check), `is_test = true` in every table that has the column (a row with `is_test = false` fails the check). Auth users carry the marker in `raw_app_meta_data`. Never copy real data.
4. **Explicit values:** explicit ids and timestamps. Never consume a sequence: give identity columns explicit values with `OVERRIDING SYSTEM VALUE` (rule R5 fails a fixture that changes any sequence, including `setval`). Pick ids that later reference rows cannot take (UUIDs starting `c0000000-`, identity values from `1000000` up; the self-test cases follow the same ranges), or a later migration's own inserts collide with them and fail only in the canary run (R7). Prefer explicit timestamps to `now()`, so the rows read the same in every run (a trigger that sets a timestamp is fine).
5. **Fill every column:** after each migration and its fixture, every table in `public` and `private` needs at least one row, and every column a non-null value in at least one row (rule R6). Reference rows inserted by the migration count.
6. **Include the variants that set the rarely set columns:** a deactivated or closed record, a decided request (decision fields, rejection reason), a row with optional fields filled. A column that is set only in a later state needs a row in that state.
7. **Only add rows:** a fixture must not change or remove existing rows or change the schema in any way, not even a function or a comment (rule R7 compares the schema dump before and after it), and must not set a role password, create a replication slot or add an event trigger. It runs as `postgres` in one transaction, inserting directly (the RPCs need a signed-in user); backslash commands are not interpreted.
8. **Cannot be covered?** Add an entry to `coverage-exceptions.json` with a reason, for example a column of a reference table whose rows all come from the migration:

```json
[
  { "table": "public.role_permissions", "column": "approved_by", "reason": "All rows are reference rows; set only when the owner approves values (Step 10, D51)." }
]
```

An entry without `column` exempts the whole table. The file is global: an entry applies after every migration step in which its table (and column) exists, so an entry for a table that a later migration drops stays valid. An entry that matches no step at all is stale and fails the check (R6).

## Running it locally

```bash
supabase stop                                       # if `supabase start` runs other services
supabase db start                                   # the local Docker database only
node scripts/db-canary.mjs                          # the check (about 1 minute)
node scripts/db-canary.mjs --selftest tests/db-canary-selftest   # the self-test (about 7 minutes)
supabase db reset                                   # afterwards: your migrations back
```

The check needs the database alone: Auth, Storage and Realtime write to the database on their own, so the check stops with a message when another container of the project runs. It resets the **local** database before each run and leaves it as the canary run left it. It never touches a remote project.
