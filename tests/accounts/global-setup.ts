// Seeding for the account-administration tests (D60 (7)). LOCAL STACK ONLY: it refuses any Supabase
// URL that is not a loopback address, so it can never write to the remote project. Fictional,
// test-marked accounts only (D47): `@example.test` addresses, Auth users with app_metadata
// { is_test: true, data_source: "automated_test" } and profiles with is_test = true (a Manager, a
// Customer Service account and a Technician with his field profile), inserted as `postgres` inside
// the local database container as tests/auth does (every trigger, CHECK and the one-way rule still
// apply). Passwords are random per run, kept in this process's environment for the test workers,
// never written to a file or printed.
// TEMPORARY, Step 2 plan Q6 (open owner question): only with ACCOUNTS_TEST_LOCAL_CREATOR=1, a
// fictional Creator for the Creator's cases. The database refuses a test-marked Creator
// (`profiles_no_test_creator`), so it is real-marked in `profiles` (its Auth user carries the test
// marker) and made the only way a Creator can be made, `private.bootstrap_first_creator` as
// `postgres`, locally. Reused by later runs (password reset per run); a Creator these tests did not
// create is never touched (the setup stops and asks for `supabase db reset`).
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SeededUser = { id: string; email: string; password: string; name: string };
export type SeededUsers = Record<"mgr" | "cs" | "tech", SeededUser> & { creator: SeededUser | null; techRow: string };

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/;
/**
 * The local database container (tests/auth/global-setup.ts localDbContainer: the project's own, or
 * another LOCAL stack's through AUTH_TEST_DB_CONTAINER, so the local Creator lives in the stack under
 * test). Only a Supabase CLI database container name is accepted.
 */
const DB_CONTAINER = (() => {
  const name = process.env.AUTH_TEST_DB_CONTAINER || "supabase_db_technician-management";
  if (!/^supabase_db_[a-z0-9_-]{1,64}$/.test(name)) throw new Error("AUTH_TEST_DB_CONTAINER is not a local Supabase database container name");
  return name;
})();
const CREATOR_EMAIL = /^accounts-e2e-creator-[0-9a-f]{8}@example\.test$/;

const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`;

function psql(sql: string): string {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-At"], {
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  }).trim();
}

export default async function globalSetup(): Promise<void> {
  const url = process.env.ACCOUNTS_TEST_SUPABASE_URL ?? "";
  const secretKey = process.env.ACCOUNTS_TEST_SECRET_KEY ?? "";
  if (!LOOPBACK.test(url)) throw new Error("account tests run only against the local Supabase stack (loopback URL)");
  if (!secretKey || !process.env.ACCOUNTS_TEST_PUBLISHABLE_KEY) throw new Error("run tests/accounts/run-local.mjs");

  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const run = randomBytes(4).toString("hex");
  const names = { mgr: "מנהלת ניהול-משתמשים", cs: "נציגת ניהול-משתמשים", tech: "טכנאי ניהול-משתמשים" } as const;
  const users = {} as Record<keyof typeof names, SeededUser>;
  for (const key of Object.keys(names) as (keyof typeof names)[]) {
    const email = `accounts-e2e-${key}-${run}@example.test`;
    const password = randomBytes(18).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { is_test: true, data_source: "automated_test" },
    });
    if (error || !data.user) throw new Error(`could not create the test Auth user ${key}: ${error?.code ?? "no user"}`);
    users[key] = { id: data.user.id, email, password, name: names[key] };
  }
  const techRow = randomUUID();
  psql(`
begin;
insert into public.profiles (id, role, full_name, is_active, is_test) values
  (${sqlText(users.mgr.id)}, 'manager', ${sqlText(users.mgr.name)}, true, true),
  (${sqlText(users.cs.id)}, 'customer_service', ${sqlText(users.cs.name)}, true, true),
  (${sqlText(users.tech.id)}, 'technician', ${sqlText(users.tech.name)}, true, true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email, accepts_invitations) values
  (${sqlText(techRow)}, ${sqlText(users.tech.id)}, true, ${sqlText(users.tech.name)}, 't-y', ${sqlText(`accounts-e2e-cal-${run}@example.test`)}, true);
commit;
`);

  const creator = process.env.ACCOUNTS_TEST_LOCAL_CREATOR === "1" ? await ensureLocalCreator(admin, run) : null;

  process.env.ACCOUNTS_E2E_USERS = JSON.stringify({ ...users, creator, techRow } satisfies SeededUsers);
}

/**
 * TEMPORARY, Step 2 plan Q6 (open owner question): the fictional local Creator of the Creator's
 * cases, shared by this suite and the browser tests of tests/auth (`--with-creator` in both). The
 * database refuses a test-marked Creator (`profiles_no_test_creator`), so it is real-marked in
 * `profiles` (its Auth user carries the test marker) and made the only way a Creator can be made,
 * `private.bootstrap_first_creator` as `postgres`, locally. Reused by later runs (its password is
 * reset per run); a Creator these tests did not create is never touched (the setup stops and asks
 * for `supabase db reset`). LOCAL STACK ONLY: `admin` is the caller's local secret-key client.
 */
export async function ensureLocalCreator(admin: SupabaseClient, run: string): Promise<SeededUser> {
  const name = "יוצר ניהול-משתמשים";
  const password = randomBytes(18).toString("base64url");
  const existing = psql("select p.id || '|' || coalesce(u.email, '') from public.profiles p join auth.users u on u.id = p.id where p.role = 'creator';");
  if (existing) {
    const [id = "", email = ""] = existing.split("\n")[0]?.split("|") ?? [];
    if (existing.includes("\n") || !CREATOR_EMAIL.test(email)) {
      throw new Error("a Creator that these tests did not create exists in the local database: run `supabase db reset` first");
    }
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) throw new Error(`could not reset the local test Creator's password: ${error.code ?? "error"}`);
    return { id, email, password, name };
  }
  const email = `accounts-e2e-creator-${run}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { is_test: true, data_source: "automated_test" },
  });
  if (error || !data.user) throw new Error(`could not create the local test Creator's Auth user: ${error?.code ?? "no user"}`);
  psql(`select private.bootstrap_first_creator(${sqlText(data.user.id)}, ${sqlText(name)});`);
  return { id: data.user.id, email, password, name };
}
