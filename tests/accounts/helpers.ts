// Helpers for the account-administration service tests (LOCAL stack only; see global-setup.ts).
// The tests play the server's part: they build the same commands and queries the server actions
// build (features/accounts/supabase), with a real client signed in as the acting user (his own
// session, RLS) and the real Auth Admin port over the local secret key, optionally wrapped in a spy
// that records which Admin functions were called. Nothing here prints a key or a password.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccountCommands, AccountsQueries } from "@/features/accounts/data/ports";
import { authAdminPortOf, type AuthAdminPort } from "@/features/accounts/supabase/auth-admin";
import { accountCommandsOf } from "@/features/accounts/supabase/commands";
import { accountsQueriesOf } from "@/features/accounts/supabase/queries";
import type { SessionUser } from "@/features/auth/data/types";
import { sessionUserOf } from "@/features/auth/data/session";
import { uiRoleOf } from "@/features/auth/roles";
import type { SeededUser, SeededUsers } from "./global-setup";

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

export function seeded(): SeededUsers {
  const raw = process.env.ACCOUNTS_E2E_USERS;
  if (!raw) throw new Error("the account tests' global setup did not run");
  return JSON.parse(raw) as SeededUsers;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (run tests/accounts/run-local.mjs)`);
  return value;
}

/** A client with the publishable key and no session (sign-in attempts). */
export const anonClient = (): SupabaseClient =>
  createClient(env("ACCOUNTS_TEST_SUPABASE_URL"), env("ACCOUNTS_TEST_PUBLISHABLE_KEY"), { auth: NO_SESSION });

/** The secret-key client, for setup and assertions only (never handed to a flow as `db`). */
export const adminClient = (): SupabaseClient =>
  createClient(env("ACCOUNTS_TEST_SUPABASE_URL"), env("ACCOUNTS_TEST_SECRET_KEY"), { auth: NO_SESSION });

/** The real Auth Admin port over the local secret key (what lib/supabase/admin.ts builds). */
export const realAdmin = (): AuthAdminPort => authAdminPortOf(adminClient());

/** A unique fictional address in the reserved test domain (D47). */
export const testEmail = (tag: string): string => `accounts-e2e-${tag}-${randomBytes(4).toString("hex")}@example.test`;

/** Signs in with the publishable key; the client keeps the session in memory. */
export async function signIn(email: string, password: string): Promise<{ client: SupabaseClient; error: { code?: string; status?: number } | null }> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  return { client, error: error ? { code: error.code, status: error.status } : null };
}

/**
 * The session user as lib/auth/session.ts derives it (getUser, then the user's own profile under
 * his session, then my_technician_id): null for no access (no profile, inactive, deleted).
 */
export async function viewerOf(client: SupabaseClient): Promise<SessionUser | null> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const { data: row } = await client
    .from("profiles")
    .select("id, role, full_name, is_active, is_test")
    .eq("id", data.user.id)
    .maybeSingle<{ id: string; role: string; full_name: string; is_active: boolean; is_test: boolean }>();
  const role = uiRoleOf(row?.role);
  if (!row || !role) return null;
  const tech = role === "tech" ? await client.rpc("my_technician_id") : null;
  return sessionUserOf({
    id: row.id,
    role,
    name: row.full_name,
    active: row.is_active,
    technicianId: typeof tech?.data === "string" ? tech.data : null,
    isTest: row.is_test,
  });
}

/** A signed-in actor: his client (his own session) and his session user. */
export type Actor = { user: SeededUser; client: SupabaseClient; viewer: SessionUser };

export async function actor(user: SeededUser): Promise<Actor> {
  const { client, error } = await signIn(user.email, user.password);
  if (error) throw new Error(`sign-in failed for a seeded user: ${error.code ?? error.status}`);
  const viewer = await viewerOf(client);
  if (!viewer) throw new Error("a seeded user has no access");
  return { user, client, viewer };
}

/** Records which Auth Admin functions a flow called (and nothing else). */
export type AdminSpy = { port: AuthAdminPort; calls: string[] };

export function spy(base: AuthAdminPort): AdminSpy {
  const calls: string[] = [];
  const port: AuthAdminPort = {
    available: base.available,
    createUserForIntent: (input) => (calls.push("createUserForIntent"), base.createUserForIntent(input)),
    getUser: (id) => (calls.push("getUser"), base.getUser(id)),
    setPassword: (id, password) => (calls.push("setPassword"), base.setPassword(id, password)),
    setEmail: (id, email) => (calls.push("setEmail"), base.setEmail(id, email)),
    revokeAccess: (id) => (calls.push("revokeAccess"), base.revokeAccess(id)),
  };
  return { port, calls };
}

/** Every log line the flows wrote in this test file (event and code only). */
export const logLines: string[] = [];

/**
 * The commands the server action builds for `who` (his own session), with `admin` (default: a spy
 * over the real port). `viewer` may be overridden to prove that a tampered session user grants
 * nothing: the database decides under the session.
 */
export function commandsOf(who: Actor, admin: AuthAdminPort = realAdmin(), viewer: SessionUser | null = who.viewer): AccountCommands {
  return accountCommandsOf({ db: who.client, admin, viewer, log: (event, code) => void logLines.push(`${event} ${String(code)}`) });
}

export const queriesOf = (who: Actor, viewer: SessionUser | null = who.viewer): AccountsQueries => accountsQueriesOf(who.client, viewer);

/** Runs SQL as postgres in the LOCAL database container (assertions only); `-At` output. */
export function sql(query: string): string {
  return execFileSync("docker", ["exec", "-i", "supabase_db_technician-management", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-At"], {
    input: query,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  }).trim();
}

export const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** How many messages the local Mailpit holds (null when it cannot be read). */
export async function mailCount(): Promise<number | null> {
  const base = process.env.ACCOUNTS_TEST_MAILPIT_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/v1/messages?limit=1`);
    const body = (await res.json()) as { total?: unknown; messages_count?: unknown };
    const n = typeof body.total === "number" ? body.total : body.messages_count;
    return typeof n === "number" ? n : null;
  } catch {
    return null;
  }
}
