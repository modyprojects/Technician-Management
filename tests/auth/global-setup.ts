// Seeding for the auth tests (Step 2 plan §5.5; Step 2 PR 2.5). LOCAL STACK ONLY: it refuses any
// Supabase URL that is not a loopback address, so it can never write to the remote project.
// Fictional, test-marked accounts only (D47): `@example.test` addresses, Auth users with
// app_metadata { is_test: true, data_source: "automated_test" } and profiles with is_test = true.
// No Creator and no real-marked row (Step 2 plan Q6 TEMPORARY). Passwords are random per run, kept
// in this process's environment for the test workers, never written to a file or printed.
// Profiles are inserted as `postgres` inside the local database container (the RPCs need a signed-in
// caller), as the canary fixtures do; every trigger, CHECK and the one-way rule still apply.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export type SeededUser = { id: string; email: string; password: string; name: string };
export type SeededUsers = Record<"mgr" | "cs" | "tech" | "techInactive" | "noProfile", SeededUser>;

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/;

/**
 * The local database container of the stack under test: the project's own by default, or another
 * LOCAL stack's (AUTH_TEST_DB_CONTAINER, for example an isolated copy with its own project_id, so a
 * run never writes into a stack another session uses). Only a Supabase CLI database container name
 * is accepted; it is passed to `docker exec` as one argv element, never through a shell.
 */
export function localDbContainer(): string {
  const name = process.env.AUTH_TEST_DB_CONTAINER || "supabase_db_technician-management";
  if (!/^supabase_db_[a-z0-9_-]{1,64}$/.test(name)) throw new Error("AUTH_TEST_DB_CONTAINER is not a local Supabase database container name");
  return name;
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export default async function globalSetup(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = process.env.AUTH_TEST_SUPABASE_SECRET_KEY ?? "";
  if (!LOOPBACK.test(url)) throw new Error("auth tests run only against the local Supabase stack (loopback URL)");
  if (!secretKey) throw new Error("AUTH_TEST_SUPABASE_SECRET_KEY is not set (run tests/auth/run-local.mjs)");

  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const run = randomBytes(4).toString("hex");
  const names: Record<keyof SeededUsers, string> = {
    mgr: "מנהלת בדיקה",
    cs: "נציג שירות בדיקה",
    tech: "טכנאי בדיקה",
    techInactive: "טכנאי מושבת בדיקה",
    noProfile: "ללא פרופיל",
  };
  const users = {} as SeededUsers;
  for (const key of Object.keys(names) as (keyof SeededUsers)[]) {
    const email = `auth-e2e-${key.toLowerCase()}-${run}@example.test`;
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
  const sql = `
begin;
insert into public.profiles (id, role, full_name, is_active, is_test) values
  (${sqlText(users.mgr.id)}, 'manager', ${sqlText(users.mgr.name)}, true, true),
  (${sqlText(users.cs.id)}, 'customer_service', ${sqlText(users.cs.name)}, true, true),
  (${sqlText(users.tech.id)}, 'technician', ${sqlText(users.tech.name)}, true, true),
  (${sqlText(users.techInactive.id)}, 'technician', ${sqlText(users.techInactive.name)}, false, true);
insert into public.technicians (id, profile_id, is_test, display_name, color, outlook_email, accepts_invitations) values
  (${sqlText(techRow)}, ${sqlText(users.tech.id)}, true, ${sqlText(users.tech.name)}, 'teal', ${sqlText(`auth-e2e-cal-${run}@example.test`)}, true);
commit;
`;
  execFileSync("docker", ["exec", "-i", localDbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: sql,
    stdio: ["pipe", "ignore", "inherit"],
  });

  process.env.AUTH_E2E_USERS = JSON.stringify(users);
  process.env.AUTH_E2E_TECH_ROW = techRow;
  // Least privilege: no test worker needs the secret key.
  delete process.env.AUTH_TEST_SUPABASE_SECRET_KEY;
}
