import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { AccountListEntry } from "@/features/accounts/data/types";
import {
  DELETE_CONFIRMATION_REQUIRED,
  MANAGER_TECHNICIAN_FIELDS_PENDING,
  OWN_ACCOUNT_REFUSED,
  testAccountEmailError,
} from "@/features/accounts/data/validate";
import { UNAVAILABLE_AUTH_ADMIN, type AuthAdminPort } from "@/features/accounts/supabase/auth-admin";
import { userLookupFailure } from "@/features/auth/session-state";
import type { CommandResult } from "@/features/data-access/common";
import {
  ACCOUNT_MESSAGES,
  ACTION_MESSAGES,
  AUTH_ADMIN_MESSAGES,
  REQUEST_MESSAGES,
  signInFailureKind,
} from "@/features/data-access/supabase-errors";
import {
  actor,
  adminClient,
  anonClient,
  commandsOf,
  logLines,
  mailCount,
  queriesOf,
  realAdmin,
  seeded,
  signIn,
  spy,
  sql,
  sqlText,
  testEmail,
  viewerOf,
  type Actor,
} from "./helpers";

// Account administration (D60 (7); QA M-06, M-10, C-01, C-02) against the LOCAL Supabase stack.
// The tests play the server: they run the same commands and queries as lib/actions/accounts.ts and
// lib/data/supabase/accounts.ts (features/accounts/supabase), with each actor's own signed-in
// session and the real Auth Admin port over the local secret key. Every refusal is checked twice:
// the app's answer, and the database's own refusal of the same call under the same session (the
// control). Fictional, test-marked accounts only (D47). Sign-ins are counted: the local Auth allows
// 30 per 5 minutes per IP (supabase/config.toml).

test.describe.configure({ mode: "serial" });

const PHONE = "050-000-4321";
const forbidden = ACTION_MESSAGES.forbidden;

/** Every result and every password the tests used: none may ever appear in a result or a log line. */
const results: unknown[] = [];
const passwords: string[] = [];

async function keep<T>(promise: Promise<CommandResult<T>>): Promise<CommandResult<T>> {
  const r = await promise;
  results.push(r);
  return r;
}

const err = (r: CommandResult<unknown>): string | null => (r.ok ? null : r.error);

function data<T>(r: CommandResult<T>): T {
  if (!r.ok) throw new Error(`expected success, got: ${r.error}`);
  if (r.data === undefined) throw new Error("expected data");
  return r.data;
}

/** The SQLSTATE of a direct database call under `who`'s own session (null when it succeeded). */
async function rpcCode(who: Actor, name: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await who.client.rpc(name, args);
  return error?.code ?? null;
}

const newPassword = (): string => {
  const p = `Pw-${randomBytes(12).toString("base64url")}`;
  passwords.push(p);
  return p;
};

let mgr: Actor;
let cs: Actor;
let tech: Actor;
let mailBefore: number | null = null;
/** The password the Creator set on his second Customer Service account (kept in memory only). */
let csBPassword = "";

/** Accounts the Manager created in this run. */
const byManager: { cs?: AccountListEntry; tech?: AccountListEntry } = {};

test.beforeAll(async () => {
  const s = seeded();
  mgr = await actor(s.mgr);
  cs = await actor(s.cs);
  tech = await actor(s.tech);
  mailBefore = await mailCount();
});

test.describe("Manager (D60 (7): Technician and Customer Service directly)", () => {
  test("creates a Customer Service account at once: test-marked, bound to its intent, no password", async () => {
    const email = testEmail("mgr-cs");
    const admin = spy(realAdmin());
    const r = await keep(commandsOf(mgr, admin.port).createAccount({ name: "נציגה חדשה", email, phone: PHONE, role: "cs" }));
    const account = data(r).account as AccountListEntry;
    expect(r.simulated).toBe(false);
    expect(account).toMatchObject({ role: "cs", name: "נציגה חדשה", email, phone: PHONE, active: true, isTest: true, technicianMissing: false, version: 1, technician: null });
    // The Admin API only after the database authorized the creation (phase 1 is a database call).
    expect(admin.calls).toEqual(["getUser", "createUserForIntent"]);
    expect(sql(`select role || '|' || is_test || '|' || is_active || '|' || (created_by = ${sqlText(mgr.user.id)}) from public.profiles where id = ${sqlText(account.id)}`)).toBe(
      "customer_service|true|true|true",
    );
    const intent = sql(`select id || '|' || request_type || '|' || (requested_by = ${sqlText(mgr.user.id)}) || '|' || (target_profile_id = ${sqlText(account.id)}) from public.account_requests where email = ${sqlText(email)}`);
    const [intentId] = intent.split("|");
    expect(intent).toBe(`${intentId}|direct_create|true|true`);
    const { data: authUser } = await adminClient().auth.admin.getUserById(account.id);
    expect(authUser.user?.app_metadata).toMatchObject({ account_request_id: intentId, is_test: true });
    expect(authUser.user?.email_confirmed_at).toBeTruthy();
    // Created without a password: nobody can sign in until the Creator sets one (D34 e).
    const attempt = await signIn(email, "no-password-was-set-1");
    expect(attempt.error?.code).toBe("invalid_credentials");
    byManager.cs = account;
  });

  test("creates a Technician with his field profile; his Outlook email and \"פעיל\" are not sent to the Manager (Q14)", async () => {
    const email = testEmail("mgr-tech");
    const r = await keep(commandsOf(mgr).createTechnician({ name: "טכנאי חדש", email, phone: PHONE, color: "t-s", device: "טאבלט" }));
    const { account, technician } = data(r);
    expect(account).toMatchObject({ role: "tech", email, active: true, isTest: true, technicianMissing: false });
    expect(technician).toMatchObject({ name: "טכנאי חדש", color: "var(--t-s)", email: "", device: "טאבלט", phone: PHONE, isTest: true, version: 1 });
    expect(sql(`select color || '|' || (outlook_email = ${sqlText(email)}) || '|' || accepts_invitations || '|' || is_test from public.technicians where id = ${sqlText(technician.id)}`)).toBe(
      "t-s|true|true|true",
    );
    const entry = await queriesOf(mgr).get(account.id);
    expect(entry?.technician).toMatchObject({ id: technician.id, colorToken: "t-s", outlookEmail: null, active: null });
    byManager.tech = entry ?? undefined;
  });

  test("lists Customer Service and Technician accounts only (RLS), bounded, without deleted ones", async () => {
    const page = await queriesOf(mgr).list({ limit: 500 });
    expect(page.limit).toBe(100);
    expect(page.items.every((a) => a.role === "cs" || a.role === "tech")).toBe(true);
    const ids = page.items.map((a) => a.id);
    expect(ids).toContain(byManager.cs?.id);
    expect(ids).not.toContain(mgr.user.id);
    expect((await queriesOf(mgr).list({ roles: ["mgr", "creator"] })).total).toBe(0);
    expect((await queriesOf(mgr).list({ roles: ["nope" as never] })).total).toBe(0);
    // The port's order: Customer Service before Technician.
    const ranks = page.items.map((a) => (a.role === "cs" ? 0 : 1));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test("is refused Manager and Creator accounts, role changes, passwords, emails and deletion: by the app and by the database; no Admin call", async () => {
    const target = byManager.cs;
    if (!target) throw new Error("needs the Manager's Customer Service account");
    const admin = spy(realAdmin());
    const c = commandsOf(mgr, admin.port);
    const before = sql("select (select count(*) from public.account_requests) || '|' || (select count(*) from auth.users) || '|' || (select count(*) from public.audit_logs)");
    for (const role of ["mgr", "creator"] as const) {
      expect(err(await keep(c.createAccount({ name: "מנהל", email: testEmail("x"), phone: PHONE, role: role as never }))), role).toBe(forbidden);
    }
    expect(err(await keep(c.changeRole({ accountId: target.id, expectedVersion: target.version, newRole: "tech" })))).toBe(forbidden);
    expect(err(await keep(c.setPassword(target.id, newPassword())))).toBe(forbidden);
    expect(err(await keep(c.changeEmail(target.id, testEmail("x"))))).toBe(forbidden);
    expect(err(await keep(c.deleteAccount({ accountId: target.id, expectedVersion: target.version, confirm: true })))).toBe(forbidden);
    expect(admin.calls).toEqual([]);

    // The database's own refusals under the Manager's session (the control, not the app's check).
    const intentArgs = (role: string) => ({ p_role: role, p_email: testEmail("x"), p_full_name: "x" });
    expect(await rpcCode(mgr, "authorize_account_creation", intentArgs("manager"))).toBe("42501");
    expect(await rpcCode(mgr, "authorize_account_creation", intentArgs("creator"))).toBe("42501");
    expect(await rpcCode(mgr, "admin_set_user_role", { p_profile_id: target.id, p_new_role: "technician", p_expected_version: target.version })).toBe("42501");
    for (const kind of ["password", "email"]) {
      expect(await rpcCode(mgr, "assert_can_change_credentials", { p_target_profile_id: target.id, p_kind: kind }), kind).toBe("42501");
    }
    expect(await rpcCode(mgr, "admin_delete_user", { p_profile_id: target.id, p_expected_version: target.version })).toBe("42501");
    // The retired request path (C-02): no role may run it.
    expect(await rpcCode(mgr, "request_account_change", { p_request_type: "create", p_requested_role: "customer_service", p_email: testEmail("x"), p_full_name: "x" })).toBe("42501");

    // A tampered session user (claiming to be the Creator) grants nothing: the database decides.
    const lying = commandsOf(mgr, admin.port, { ...mgr.viewer, role: "creator" });
    expect(err(await keep(lying.createAccount({ name: "מנהל", email: testEmail("x"), phone: PHONE, role: "mgr" })))).toBe(forbidden);
    expect(err(await keep(lying.changeRole({ accountId: target.id, expectedVersion: target.version, newRole: "tech" })))).toBe(forbidden);
    expect(err(await keep(lying.setPassword(target.id, newPassword())))).toBe(forbidden);
    expect(err(await keep(lying.changeEmail(target.id, testEmail("x"))))).toBe(forbidden);
    expect(err(await keep(lying.deleteAccount({ accountId: target.id, expectedVersion: target.version, confirm: true })))).toBe(forbidden);
    expect(admin.calls).toEqual([]);

    expect(sql("select (select count(*) from public.account_requests) || '|' || (select count(*) from auth.users) || '|' || (select count(*) from public.audit_logs)")).toBe(before);
    expect(sql(`select role || '|' || (deleted_at is null) from public.profiles where id = ${sqlText(target.id)}`)).toBe("customer_service|true");
  });

  test("deactivates and reactivates a Customer Service account at once; a stale version is refused (PT409)", async () => {
    const target = byManager.cs;
    if (!target) throw new Error("needs the Manager's Customer Service account");
    const c = commandsOf(mgr);
    const off = data(await keep(c.deactivateAccount({ accountId: target.id, expectedVersion: target.version })));
    expect(off.version).toBe(target.version + 1);
    expect((await queriesOf(mgr).get(target.id))?.deactivatedAt).toBeTruthy();
    expect(err(await keep(c.activateAccount({ accountId: target.id, expectedVersion: target.version })))).toBe(ACTION_MESSAGES.stale);
    const on = data(await keep(c.activateAccount({ accountId: target.id, expectedVersion: off.version })));
    expect(on.version).toBe(off.version + 1);
    expect(err(await keep(c.deactivateAccount({ accountId: mgr.user.id, expectedVersion: 1 })))).toBe(forbidden);
    expect(sql(`select count(*) from public.audit_logs where target_id = ${sqlText(target.id)} and action in ('profile.deactivated', 'profile.activated') and details ->> 'actor_role' = 'manager'`)).toBe("2");
    byManager.cs = (await queriesOf(mgr).get(target.id)) ?? undefined;
  });

  test("routine updates: profile and technician details; the Outlook email and \"פעיל\" are the Creator's (Q14); stale and malformed input refused", async () => {
    const account = byManager.cs;
    const techEntry = byManager.tech;
    if (!account || !techEntry?.technician) throw new Error("needs the Manager's accounts");
    const c = commandsOf(mgr);
    const alias = `כינוי-${randomBytes(3).toString("hex")}`;
    const updated = data(await keep(c.updateProfile({ accountId: account.id, expectedVersion: account.version, name: "נציגה מעודכנת", invitationAlias: alias })));
    expect(updated.version).toBe(account.version + 1);
    expect(sql(`select full_name || '|' || invitation_rep_name || '|' || work_phone from public.profiles where id = ${sqlText(account.id)}`)).toBe(`נציגה מעודכנת|${alias}|${PHONE}`);
    expect(err(await keep(c.updateProfile({ accountId: account.id, expectedVersion: account.version, name: "שוב" })))).toBe(ACTION_MESSAGES.stale);
    expect(err(await keep(c.updateProfile({ accountId: account.id, expectedVersion: updated.version, email: "x@example.test" } as never)))).toBe("קלט לא תקין");

    const t = techEntry.technician;
    const recolored = data(await keep(c.updateTechnician({ technicianId: t.id, expectedVersion: t.version, color: "t-e" })));
    expect(recolored.version).toBe(t.version + 1);
    expect(err(await keep(c.updateTechnician({ technicianId: t.id, expectedVersion: recolored.version, outlookEmail: testEmail("cal") })))).toBe(
      MANAGER_TECHNICIAN_FIELDS_PENDING,
    );
    expect(err(await keep(c.updateTechnician({ technicianId: t.id, expectedVersion: recolored.version, active: false })))).toBe(MANAGER_TECHNICIAN_FIELDS_PENDING);
    expect(err(await keep(c.updateTechnician({ technicianId: t.id, expectedVersion: recolored.version, color: "red" as never })))).toBe("צבע לא תקין");
  });

  test("tampering aimed at a Manager or the Creator: routine updates, the field profile and (de)activation are refused by the app and the database; no Admin call (review S6 b)", async () => {
    const s = seeded();
    const targets = [{ label: "manager", id: s.mgr2.id }, ...(s.creator ? [{ label: "creator", id: s.creator.id }] : [])];
    const ids = targets.map((t) => sqlText(t.id)).join(", ");
    const snapshot = () =>
      sql(
        `select (select count(*) from public.audit_logs where target_id in (${ids}) or actor_profile_id = ${sqlText(mgr.user.id)}) || '|' || ` +
          `(select string_agg(version || ':' || is_active || ':' || full_name, ',' order by id) from public.profiles where id in (${ids})) || '|' || ` +
          `(select count(*) from public.technicians where profile_id in (${ids}))`,
      );
    const before = snapshot();
    const admin = spy(realAdmin());
    // The Manager's own session, as the screen would send it; then a session user claiming to be the Creator.
    for (const viewer of [mgr.viewer, { ...mgr.viewer, role: "creator" as const }]) {
      const c = commandsOf(mgr, admin.port, viewer);
      for (const { label, id } of targets) {
        const v = Number(sql(`select version from public.profiles where id = ${sqlText(id)}`));
        const where = `${viewer.role} → ${label}`;
        const answers = [
          await keep(c.updateProfile({ accountId: id, expectedVersion: v, name: "שם אחר" })),
          await keep(c.updateProfile({ accountId: id.toUpperCase(), expectedVersion: v, phone: "050-000-9999" })),
          await keep(c.updateTechnician({ technicianId: id, expectedVersion: v, name: "שם אחר" })),
          await keep(c.completeTechnicianProfile({ accountId: id, color: "t-y", device: "סמארטפון" })),
          await keep(c.activateAccount({ accountId: id, expectedVersion: v })),
          await keep(c.deactivateAccount({ accountId: id, expectedVersion: v })),
        ];
        for (const [i, r] of answers.entries()) expect(err(r), `${where} #${i}`).toBe(forbidden);
      }
    }
    expect(admin.calls).toEqual([]);

    // The database's own refusals of the same calls under the Manager's session (the control).
    for (const { label, id } of targets) {
      const v = Number(sql(`select version from public.profiles where id = ${sqlText(id)}`));
      expect(
        await rpcCode(mgr, "admin_update_profile", { p_profile_id: id, p_expected_version: v, p_full_name: "x", p_work_phone: null, p_invitation_rep_name: null }),
        label,
      ).toBe("42501");
      expect(
        await rpcCode(mgr, "admin_update_technician", {
          p_technician_id: id,
          p_expected_version: v,
          p_display_name: "x",
          p_color: "t-y",
          p_outlook_email: testEmail("x"),
          p_device_label: null,
          p_accepts_invitations: true,
        }),
        label,
      ).toBe("42501");
      expect(
        await rpcCode(mgr, "admin_create_technician", {
          p_profile_id: id,
          p_display_name: "x",
          p_color: "t-y",
          p_outlook_email: testEmail("x"),
          p_device_label: "x",
          p_accepts_invitations: true,
        }),
        label,
      ).toBe("42501");
      for (const active of [true, false]) {
        expect(await rpcCode(mgr, "admin_set_user_active", { p_profile_id: id, p_active: active, p_expected_version: v }), `${label} ${active}`).toBe("42501");
      }
    }
    expect(snapshot()).toBe(before);
  });

  test("a deactivated Manager whose session is still valid is refused by every action; nothing is written; no Admin call (review S6 c)", async () => {
    const target = byManager.cs;
    if (!target) throw new Error("needs the Manager's Customer Service account");
    const off = await actor(seeded().mgr2);
    const stale = off.viewer;
    // Deactivated while signed in (as postgres in the LOCAL database: the test's setup step).
    sql(`update public.profiles set is_active = false where id = ${sqlText(off.user.id)}`);
    try {
      // Auth still accepts the session, but the server derives no viewer from it (lib/auth/session.ts:
      // the own-profile read needs an active profile).
      expect((await off.client.auth.getUser()).error).toBeNull();
      expect(await viewerOf(off.client)).toBeNull();
      const v = Number(sql(`select version from public.profiles where id = ${sqlText(target.id)}`));
      const admin = spy(realAdmin());
      // No viewer (what the server derives), and the stale viewer from before (defence in depth: the database).
      for (const viewer of [null, stale]) {
        const c = commandsOf(off, admin.port, viewer);
        const label = viewer ? "stale viewer" : "no viewer";
        const answers = [
          await keep(c.createAccount({ name: "x", email: testEmail("off"), phone: PHONE, role: "cs" })),
          await keep(c.createTechnician({ name: "x", email: testEmail("off"), phone: PHONE, color: "t-y", device: "x" })),
          await keep(c.completeCreation({ requestId: randomUUID(), phone: null })),
          await keep(c.cancelCreation({ intentId: randomUUID(), expectedVersion: 1 })),
          await keep(c.completeTechnicianProfile({ accountId: target.id, color: "t-y", device: "x" })),
          await keep(c.deactivateAccount({ accountId: target.id, expectedVersion: v })),
          await keep(c.activateAccount({ accountId: target.id, expectedVersion: v })),
          await keep(c.updateProfile({ accountId: target.id, expectedVersion: v, name: "x" })),
          await keep(c.updateTechnician({ technicianId: seeded().techRow, expectedVersion: 1, name: "x" })),
          await keep(c.changeRole({ accountId: target.id, expectedVersion: v, newRole: "tech" })),
          await keep(c.setPassword(target.id, newPassword())),
          await keep(c.changeEmail(target.id, testEmail("off"))),
          await keep(c.deleteAccount({ accountId: target.id, expectedVersion: v, confirm: true })),
        ];
        for (const [i, r] of answers.entries()) expect(err(r), `${label} #${i}`).toBe(forbidden);
        const q = queriesOf(off, viewer);
        expect((await q.list()).total, label).toBe(0);
        expect((await q.openCreations()).total, label).toBe(0);
      }
      expect(admin.calls).toEqual([]);
      // The database refuses his still-valid session (the control).
      expect(await rpcCode(off, "authorize_account_creation", { p_role: "customer_service", p_email: testEmail("off"), p_full_name: "x" })).toBe("42501");
      expect(await rpcCode(off, "admin_set_user_active", { p_profile_id: target.id, p_active: false, p_expected_version: v })).toBe("42501");
      expect(await rpcCode(off, "assert_can_manage", { p_target_role: "technician" })).toBe("42501");
      expect(sql(`select count(*) from public.account_requests where requested_by = ${sqlText(off.user.id)}`)).toBe("0");
      expect(sql(`select count(*) from public.audit_logs where actor_profile_id = ${sqlText(off.user.id)}`)).toBe("0");
      expect(sql(`select is_active || '|' || version from public.profiles where id = ${sqlText(target.id)}`)).toBe(`true|${v}`);
    } finally {
      sql(`update public.profiles set is_active = true where id = ${sqlText(off.user.id)}`);
    }
  });
});

test.describe("Customer Service and Technician", () => {
  test("are refused every account action, by the app and by the database; no Admin call; they list nothing", async () => {
    const target = byManager.cs;
    if (!target) throw new Error("needs an account");
    for (const who of [cs, tech]) {
      const label = who.viewer.role;
      const admin = spy(realAdmin());
      const c = commandsOf(who, admin.port);
      const id = target.id;
      const v = target.version;
      const answers = [
        await keep(c.createAccount({ name: "x", email: testEmail("x"), phone: PHONE, role: "cs" })),
        await keep(c.createTechnician({ name: "x", email: testEmail("x"), phone: PHONE, color: "t-y", device: "x" })),
        await keep(c.completeCreation({ requestId: randomUUID(), phone: null })),
        await keep(c.cancelCreation({ intentId: randomUUID(), expectedVersion: 1 })),
        await keep(c.completeTechnicianProfile({ accountId: id, color: "t-y", device: "x" })),
        await keep(c.deactivateAccount({ accountId: id, expectedVersion: v })),
        await keep(c.activateAccount({ accountId: id, expectedVersion: v })),
        await keep(c.updateProfile({ accountId: id, expectedVersion: v, name: "x" })),
        await keep(c.updateTechnician({ technicianId: byManager.tech?.technician?.id ?? randomUUID(), expectedVersion: 1, name: "x" })),
        await keep(c.changeRole({ accountId: id, expectedVersion: v, newRole: "mgr" })),
        await keep(c.setPassword(id, newPassword())),
        await keep(c.changeEmail(id, testEmail("x"))),
        await keep(c.deleteAccount({ accountId: id, expectedVersion: v, confirm: true })),
      ];
      for (const [i, r] of answers.entries()) expect(err(r), `${label} #${i}`).toBe(forbidden);
      expect(admin.calls, label).toEqual([]);

      // The database refuses the same calls under their own sessions.
      expect(await rpcCode(who, "authorize_account_creation", { p_role: "technician", p_email: testEmail("x"), p_full_name: "x" }), label).toBe("42501");
      expect(await rpcCode(who, "admin_set_user_active", { p_profile_id: id, p_active: false, p_expected_version: v }), label).toBe("42501");
      expect(await rpcCode(who, "admin_update_profile", { p_profile_id: id, p_expected_version: v, p_full_name: "x", p_work_phone: null, p_invitation_rep_name: null }), label).toBe("42501");
      expect(await rpcCode(who, "admin_set_user_role", { p_profile_id: id, p_new_role: "manager", p_expected_version: v }), label).toBe("42501");
      // The check that precedes the Auth Admin calls of "השלמת יצירה" and "השלמה" (profile completion).
      expect(await rpcCode(who, "assert_can_manage", { p_target_role: "technician" }), label).toBe("42501");
      expect(await rpcCode(who, "assert_can_change_credentials", { p_target_profile_id: id, p_kind: "password" }), label).toBe("42501");
      expect(await rpcCode(who, "admin_delete_user", { p_profile_id: id, p_expected_version: v }), label).toBe("42501");

      // A tampered session user (claiming to be the Manager) still creates nothing.
      const lying = commandsOf(who, admin.port, { ...who.viewer, role: "mgr" });
      expect(err(await keep(lying.createTechnician({ name: "x", email: testEmail("x"), phone: PHONE, color: "t-y", device: "x" }))), label).toBe(forbidden);
      expect(admin.calls, label).toEqual([]);

      const q = queriesOf(who);
      expect((await q.list()).total, label).toBe(0);
      expect(await q.get(id), label).toBeNull();
      expect((await q.openCreations()).total, label).toBe(0);
      expect((await q.creatorNotices()).total, label).toBe(0);
    }
    expect(sql(`select role || '|' || is_active || '|' || (deleted_at is null) from public.profiles where id = ${sqlText(target.id)}`)).toBe("customer_service|true|true");
  });
});

test.describe("Incomplete creations (Step 2 plan §3.8)", () => {
  const real = (): AuthAdminPort => realAdmin();

  test("an uncertain Auth call leaves \"יצירה שלא הושלמה\"; \"השלמת יצירה\" completes it", async () => {
    const email = testEmail("open");
    const flaky: AuthAdminPort = { ...real(), createUserForIntent: async () => ({ ok: false, kind: "uncertain", code: null }) };
    expect(err(await keep(commandsOf(mgr, flaky).createAccount({ name: "יצירה פתוחה", email, phone: PHONE, role: "cs" })))).toBe(
      ACCOUNT_MESSAGES.creationIncomplete,
    );
    const intent = (await queriesOf(mgr).openCreations()).items.find((i) => i.email === email);
    expect(intent).toMatchObject({ role: "cs", name: "יצירה פתוחה", requestedBy: { id: mgr.user.id }, isTest: true });
    expect(sql(`select count(*) from auth.users where email = ${sqlText(email)}`)).toBe("0");
    // Only the requester completes his own intent (Migration 5 OQ-4).
    expect(err(await keep(commandsOf(cs).completeCreation({ requestId: intent?.id ?? "", phone: null })))).toBe(forbidden);
    const done = data(await keep(commandsOf(mgr).completeCreation({ requestId: intent?.id ?? "", phone: PHONE })));
    expect(done.account).toMatchObject({ email, role: "cs", phone: PHONE, active: true });
    expect((await queriesOf(mgr).openCreations()).items.some((i) => i.email === email)).toBe(false);
  });

  test("an uncertain call that did create the Auth user: the retry binds that user, never a second one", async () => {
    const email = testEmail("lossy");
    const base = real();
    const lossy: AuthAdminPort = {
      ...base,
      createUserForIntent: async (input) => {
        await base.createUserForIntent(input);
        return { ok: false, kind: "uncertain", code: null };
      },
    };
    expect(err(await keep(commandsOf(mgr, lossy).createTechnician({ name: "טכנאי חוזר", email, phone: PHONE, color: "t-y", device: "סמארטפון" })))).toBe(
      ACCOUNT_MESSAGES.creationIncomplete,
    );
    expect(sql(`select count(*) from auth.users where email = ${sqlText(email)}`)).toBe("1");
    const intent = (await queriesOf(mgr).openCreations()).items.find((i) => i.email === email);
    if (!intent) throw new Error("the intent should stay open");
    // A Technician's completion needs his field profile values.
    expect(err(await keep(commandsOf(mgr).completeCreation({ requestId: intent.id, phone: null })))).toBe("פרטי הטכנאי לא תקינים");
    const admin = spy(real());
    const done = data(await keep(commandsOf(mgr, admin.port).completeCreation({ requestId: intent.id, phone: null, technician: { color: "t-y", device: "סמארטפון" } })));
    expect(admin.calls).toEqual(["getUser"]);
    expect(done.account).toMatchObject({ email, role: "tech", technicianMissing: false });
    expect(done.technician).toMatchObject({ color: "var(--t-y)", device: "סמארטפון" });
    expect(sql(`select count(*) from auth.users where email = ${sqlText(email)}`)).toBe("1");
  });

  test("\"ביטול\" closes an incomplete creation; it can no longer be completed", async () => {
    const email = testEmail("cancel");
    const flaky: AuthAdminPort = { ...real(), createUserForIntent: async () => ({ ok: false, kind: "uncertain", code: null }) };
    await keep(commandsOf(mgr, flaky).createAccount({ name: "יבוטל", email, phone: PHONE, role: "cs" }));
    const intent = (await queriesOf(mgr).openCreations()).items.find((i) => i.email === email);
    if (!intent) throw new Error("the intent should be open");
    expect(err(await keep(commandsOf(mgr).cancelCreation({ intentId: intent.id, expectedVersion: intent.version + 1 })))).toBe(ACTION_MESSAGES.stale);
    expect(err(await keep(commandsOf(cs).cancelCreation({ intentId: intent.id, expectedVersion: intent.version })))).toBe(forbidden);
    data(await keep(commandsOf(mgr).cancelCreation({ intentId: intent.id, expectedVersion: intent.version })));
    expect(sql(`select status from public.account_requests where id = ${sqlText(intent.id)}`)).toBe("cancelled");
    expect(err(await keep(commandsOf(mgr).completeCreation({ requestId: intent.id, phone: null })))).toBe(REQUEST_MESSAGES.noLongerApplies);
  });

  test("a definite Auth refusal (the address is already in Auth) cancels the intent and says so", async () => {
    const email = testEmail("taken");
    const { error } = await adminClient().auth.admin.createUser({ email, email_confirm: true, app_metadata: { is_test: true, data_source: "automated_test" } });
    expect(error).toBeNull();
    const r = await keep(commandsOf(mgr).createAccount({ name: "כתובת תפוסה", email, phone: PHONE, role: "cs" }));
    expect(err(r)?.startsWith(AUTH_ADMIN_MESSAGES.emailExists)).toBe(true);
    // The Manager is told to ask the Creator (review N2).
    expect(err(r)).toContain(AUTH_ADMIN_MESSAGES.askCreator);
    expect(sql(`select status from public.account_requests where email = ${sqlText(email)}`)).toBe("cancelled");
    expect((await queriesOf(mgr).openCreations()).items.some((i) => i.email === email)).toBe(false);
  });
});

test.describe("Auth Admin API unavailable (no secret key)", () => {
  test("creation refuses with \"unavailable\" and creates nothing: no intent, no Auth user, no audit row", async () => {
    const email = testEmail("nokey");
    const before = sql("select (select count(*) from public.account_requests) || '|' || (select count(*) from public.audit_logs) || '|' || (select count(*) from auth.users)");
    const c = commandsOf(mgr, UNAVAILABLE_AUTH_ADMIN);
    expect(err(await keep(c.createAccount({ name: "ללא מפתח", email, phone: PHONE, role: "cs" })))).toBe(ACTION_MESSAGES.unavailable);
    expect(err(await keep(c.createTechnician({ name: "ללא מפתח", email, phone: PHONE, color: "t-y", device: "x" })))).toBe(ACTION_MESSAGES.unavailable);
    expect(err(await keep(c.completeCreation({ requestId: randomUUID(), phone: null })))).toBe(ACTION_MESSAGES.unavailable);
    expect(sql("select (select count(*) from public.account_requests) || '|' || (select count(*) from public.audit_logs) || '|' || (select count(*) from auth.users)")).toBe(before);
    // Actions that need no Auth Admin call are unaffected.
    const target = byManager.cs ? await queriesOf(mgr).get(byManager.cs.id) : null;
    if (!target) throw new Error("needs an account");
    const off = data(await keep(c.deactivateAccount({ accountId: target.id, expectedVersion: target.version })));
    data(await keep(c.activateAccount({ accountId: target.id, expectedVersion: off.version })));
    byManager.cs = (await queriesOf(mgr).get(target.id)) ?? undefined;
  });
});

test.describe("Creator (D60 (7): every role, role changes, credentials, deletion)", () => {
  test.skip(() => seeded().creator === null, "Step 2 plan Q6 (TEMPORARY, open): no Creator in the local database; run with --with-creator");

  let creator: Actor;
  const made: { mgr?: AccountListEntry; cs?: AccountListEntry; csB?: AccountListEntry; tech?: AccountListEntry } = {};

  test.beforeAll(async () => {
    const c = seeded().creator;
    if (c) creator = await actor(c);
  });

  test("creates Manager, Customer Service and Technician accounts; sees the Technician's Outlook email and \"פעיל\"", async () => {
    const c = commandsOf(creator);
    for (const role of ["mgr", "cs"] as const) {
      const email = testEmail(`creator-${role}`);
      const r = data(await keep(c.createAccount({ name: `חשבון ${role}`, email, phone: PHONE, role })));
      expect(r.account).toMatchObject({ role, email, active: true, isTest: true });
      made[role] = r.account as AccountListEntry;
    }
    const csB = data(await keep(c.createAccount({ name: "נציג ב", email: testEmail("creator-csb"), phone: PHONE, role: "cs" })));
    made.csB = csB.account as AccountListEntry;
    const techEmail = testEmail("creator-tech");
    const t = data(await keep(c.createTechnician({ name: "טכנאי של היוצר", email: techEmail, phone: PHONE, color: "t-e", device: "סמארטפון" })));
    expect(t.technician).toMatchObject({ email: techEmail, active: true, color: "var(--t-e)" });
    made.tech = (await queriesOf(creator).get(t.account.id)) ?? undefined;
    expect(made.tech?.technician).toMatchObject({ outlookEmail: techEmail, active: true, colorToken: "t-e" });
    // A Creator account is never created through the app (D49; Step 2 plan Q9).
    expect(err(await keep(c.createAccount({ name: "יוצר", email: testEmail("x"), phone: PHONE, role: "creator" as never })))).toBe(
      "יצירת חשבון יוצר: ממתין להחלטת בעלים",
    );
    // The unified list: every role, in the port's order, the Creator first.
    const page = await queriesOf(creator).list({ limit: 100 });
    const order = ["creator", "mgr", "cs", "tech"];
    const ranks = page.items.map((a) => order.indexOf(a.role));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(page.items[0]?.role).toBe("creator");
  });

  test("changes a role; never a Technician with a field profile, never to Creator, never his own", async () => {
    const target = made.cs;
    const techEntry = made.tech;
    if (!target || !techEntry) throw new Error("needs the Creator's accounts");
    const c = commandsOf(creator);
    expect(err(await keep(c.changeRole({ accountId: target.id, expectedVersion: target.version + 5, newRole: "mgr" })))).toBe(ACTION_MESSAGES.stale);
    const changed = data(await keep(c.changeRole({ accountId: target.id, expectedVersion: target.version, newRole: "mgr", reason: "קידום" })));
    expect(changed.version).toBe(target.version + 1);
    expect(sql(`select role from public.profiles where id = ${sqlText(target.id)}`)).toBe("manager");
    // A Manager account is no longer in the Manager's scope (RLS): he cannot read it.
    expect(await queriesOf(mgr).get(target.id)).toBeNull();
    expect(err(await keep(c.changeRole({ accountId: techEntry.id, expectedVersion: techEntry.version, newRole: "cs" })))).toBe(
      "לא ניתן לשנות את התפקיד של חשבון טכנאי.",
    );
    expect(err(await keep(c.changeRole({ accountId: target.id, expectedVersion: changed.version, newRole: "creator" as never })))).toBe(forbidden);
    expect(err(await keep(c.changeRole({ accountId: creator.user.id, expectedVersion: 1, newRole: "mgr" })))).toBe(forbidden);
    expect(sql(`select count(*) from public.audit_logs where target_id = ${sqlText(target.id)} and action = 'profile.role_changed'`)).toBe("1");
  });

  test("sets a password: the old one fails, the new one signs in; never his own; a weak one is refused in Hebrew", async () => {
    const target = made.csB;
    if (!target) throw new Error("needs an account");
    const admin = spy(realAdmin());
    const c = commandsOf(creator, admin.port);
    const first = newPassword();
    expect((await keep(c.setPassword(target.id, first))).ok).toBe(true);
    expect((await signIn(target.email, first)).error).toBeNull();
    const second = newPassword();
    expect((await keep(c.setPassword(target.id, second))).ok).toBe(true);
    expect((await signIn(target.email, first)).error?.code).toBe("invalid_credentials");
    const signedIn = await signIn(target.email, second);
    expect(signedIn.error).toBeNull();
    expect(await viewerOf(signedIn.client)).toMatchObject({ id: target.id, role: "cs" });
    expect(admin.calls).toEqual(["setPassword", "setPassword"]);
    expect(err(await keep(c.setPassword(creator.user.id, newPassword())))).toBe(OWN_ACCOUNT_REFUSED);
    // Another spelling of his own id is still his own account (the database check does not refuse it).
    expect(err(await keep(c.setPassword(creator.user.id.toUpperCase(), newPassword())))).toBe(OWN_ACCOUNT_REFUSED);
    expect(err(await keep(c.setPassword(target.id, "a")))).toBe(AUTH_ADMIN_MESSAGES.weakPassword);
    expect(err(await keep(c.setPassword(target.id, "")))).toBe("חסרה סיסמה");
    expect(admin.calls).toEqual(["setPassword", "setPassword", "setPassword"]);
    expect(sql(`select count(*) from public.audit_logs where target_id = ${sqlText(target.id)} and action = 'credentials.change_authorized' and details ->> 'kind' = 'password'`)).toBe("3");
    csBPassword = second;
  });

  test("changes an email: the new address signs in, the old one no longer; example.test kept for a test account; never his own", async () => {
    const target = made.csB;
    const password = csBPassword;
    if (!target || !password) throw new Error("needs the account with a password");
    const c = commandsOf(creator);
    const next = testEmail("renamed");
    expect(err(await keep(c.changeEmail(target.id, "person@real-company.co.il")))).toBe(testAccountEmailError("person@real-company.co.il"));
    expect(err(await keep(c.changeEmail(creator.user.id, testEmail("self"))))).toBe(OWN_ACCOUNT_REFUSED);
    expect(err(await keep(c.changeEmail(creator.user.id.toUpperCase(), testEmail("self"))))).toBe(OWN_ACCOUNT_REFUSED);
    expect((await keep(c.changeEmail(target.id, next.toUpperCase()))).ok).toBe(true);
    expect((await signIn(target.email, password)).error?.code).toBe("invalid_credentials");
    expect((await signIn(next, password)).error).toBeNull();
    // Q5 (c): the list no longer shows the creation's address once an email change was authorized.
    expect((await queriesOf(creator).get(target.id))?.email).toBe("");
    made.csB = { ...target, email: next };
  });

  test("deactivates (sign-in then denied) and reactivates", async () => {
    const target = made.csB;
    const password = csBPassword;
    if (!target || !password) throw new Error("needs the account with a password");
    const c = commandsOf(creator);
    const current = (await queriesOf(creator).get(target.id))?.version ?? 0;
    const off = data(await keep(c.deactivateAccount({ accountId: target.id, expectedVersion: current })));
    const denied = await signIn(target.email, password);
    // Auth accepts the password, but the account has no access: the app's sign-in refuses it.
    expect(denied.error).toBeNull();
    expect(await viewerOf(denied.client)).toBeNull();
    data(await keep(c.activateAccount({ accountId: target.id, expectedVersion: off.version })));
    expect(await viewerOf(denied.client)).toMatchObject({ id: target.id });
  });

  test("deletes after an explicit confirmation: no sign-in, hidden from lists, history kept, no reactivation", async () => {
    const target = made.tech;
    if (!target?.technician) throw new Error("needs the Creator's Technician");
    const c = commandsOf(creator);
    const password = newPassword();
    expect((await keep(c.setPassword(target.id, password))).ok).toBe(true);
    const session = await signIn(target.email, password);
    expect(await viewerOf(session.client)).toMatchObject({ id: target.id, role: "tech" });
    const refreshToken = (await session.client.auth.getSession()).data.session?.refresh_token ?? "";
    expect(refreshToken).not.toBe("");

    const version = (await queriesOf(creator).get(target.id))?.version ?? 0;
    expect(err(await keep(c.deleteAccount({ accountId: target.id, expectedVersion: version } as never)))).toBe(DELETE_CONFIRMATION_REQUIRED);
    expect(err(await keep(c.deleteAccount({ accountId: target.id, expectedVersion: version, confirm: false } as never)))).toBe(DELETE_CONFIRMATION_REQUIRED);
    expect(err(await keep(c.deleteAccount({ accountId: creator.user.id, expectedVersion: 1, confirm: true })))).toBe(forbidden);
    expect(err(await keep(c.deleteAccount({ accountId: target.id, expectedVersion: version + 3, confirm: true })))).toBe(ACTION_MESSAGES.stale);
    const admin = spy(realAdmin());
    const deleted = data(await keep(commandsOf(creator, admin.port).deleteAccount({ accountId: target.id, expectedVersion: version, confirm: true, reason: "עזב" })));
    expect(admin.calls).toEqual(["revokeAccess"]);

    // The access token his open session still holds (valid until it expires) grants nothing: every
    // policy needs an active profile, and the profile is inactive and deleted.
    const own = await session.client.from("profiles").select("id").eq("id", target.id);
    expect(own.error).toBeNull();
    expect(own.data).toEqual([]);
    expect((await session.client.rpc("my_technician_id")).data ?? null).toBeNull();

    // No sign-in: Auth refuses the banned user (the one credential message), and his open session ends.
    const again = await signIn(target.email, password);
    expect(again.error?.code).toBe("user_banned");
    expect(signInFailureKind(again.error)).toBe("credentials");
    const { error: lookup } = await session.client.auth.getUser();
    expect(lookup).not.toBeNull();
    expect(userLookupFailure(lookup)).toBe("anonymous");
    // Nor can that session be renewed: Auth refuses the banned user's refresh token.
    const { error: refresh } = await anonClient().auth.refreshSession({ refresh_token: refreshToken });
    expect(refresh?.code).toBe("user_banned");

    // History kept: the rows stay, marked; the field profile no longer receives invitations.
    expect(
      sql(`select is_active || '|' || (deleted_at is not null) || '|' || (deleted_by = ${sqlText(creator.user.id)}) || '|' || version from public.profiles where id = ${sqlText(target.id)}`),
    ).toBe(`false|true|true|${deleted.version}`);
    expect(sql(`select accepts_invitations || '|' || display_name from public.technicians where id = ${sqlText(target.technician.id)}`)).toBe("false|טכנאי של היוצר");
    expect(sql(`select count(*) from public.audit_logs where target_id = ${sqlText(target.id)} and action = 'profile.deleted'`)).toBe("1");

    // Hidden from lists, for the Creator and the Manager.
    expect(await queriesOf(creator).get(target.id)).toBeNull();
    expect((await queriesOf(creator).list({ limit: 100 })).items.some((a) => a.id === target.id)).toBe(false);
    expect((await queriesOf(mgr).list({ limit: 100 })).items.some((a) => a.id === target.id)).toBe(false);

    // Frozen: no reactivation, edit or credential change.
    expect(err(await keep(c.activateAccount({ accountId: target.id, expectedVersion: deleted.version })))).toBe(ACCOUNT_MESSAGES.deleted);
    expect(err(await keep(commandsOf(mgr).activateAccount({ accountId: target.id, expectedVersion: deleted.version })))).toBe(ACCOUNT_MESSAGES.deleted);
    expect(err(await keep(c.updateProfile({ accountId: target.id, expectedVersion: deleted.version, name: "שם חדש" })))).toBe(ACCOUNT_MESSAGES.deleted);
    expect(err(await keep(c.setPassword(target.id, newPassword())))).toBe(ACCOUNT_MESSAGES.deleted);

    // A repeated deletion repeats only the Auth step (the database refusal proves the caller).
    const retry = spy(realAdmin());
    const repeated = data(await keep(commandsOf(creator, retry.port).deleteAccount({ accountId: target.id, expectedVersion: 1, confirm: true })));
    expect(repeated.version).toBe(deleted.version);
    expect(retry.calls).toEqual(["revokeAccess"]);
  });

  test("an address Auth already holds: the Creator is not told to ask the Creator (review N2)", async () => {
    const email = testEmail("taken-creator");
    const { error } = await adminClient().auth.admin.createUser({ email, email_confirm: true, app_metadata: { is_test: true, data_source: "automated_test" } });
    expect(error).toBeNull();
    const r = await keep(commandsOf(creator).createAccount({ name: "כתובת תפוסה", email, phone: PHONE, role: "mgr" }));
    const intent = sql(`select id from public.account_requests where email = ${sqlText(email)}`);
    expect(err(r)).toBe(`${AUTH_ADMIN_MESSAGES.emailExists} (מספר בקשה ${intent}).`);
    expect(err(r)).not.toContain(AUTH_ADMIN_MESSAGES.askCreator);
    expect(sql(`select status from public.account_requests where id = ${sqlText(intent)}`)).toBe("cancelled");
  });

  test("sees every open creation intent and cancels another's; completing it stays the requester's (review S3)", async () => {
    const flaky: AuthAdminPort = { ...realAdmin(), createUserForIntent: async () => ({ ok: false, kind: "uncertain", code: null }) };
    const byMgr = testEmail("s3-mgr");
    expect(err(await keep(commandsOf(mgr, flaky).createAccount({ name: "יצירה של המנהלת", email: byMgr, phone: PHONE, role: "cs" })))).toBe(
      ACCOUNT_MESSAGES.creationIncomplete,
    );
    const theirs = (await queriesOf(creator).openCreations({ limit: 100 })).items.find((i) => i.email === byMgr);
    if (!theirs) throw new Error("the Creator should see the Manager's open intent");
    expect(theirs).toMatchObject({ role: "cs", name: "יצירה של המנהלת", requestedBy: { id: mgr.user.id, name: mgr.user.name }, isTest: true });
    // The Creator's own intent is never the Manager's to see.
    const byCreator = testEmail("s3-creator");
    expect(err(await keep(commandsOf(creator, flaky).createAccount({ name: "יצירה של היוצר", email: byCreator, phone: PHONE, role: "mgr" })))).toBe(
      ACCOUNT_MESSAGES.creationIncomplete,
    );
    const mine = (await queriesOf(creator).openCreations({ limit: 100 })).items.find((i) => i.email === byCreator);
    if (!mine) throw new Error("the Creator should see his own open intent");
    expect(mine.requestedBy).toEqual({ id: creator.user.id, name: creator.viewer.name });
    expect((await queriesOf(mgr).openCreations({ limit: 100 })).items.some((i) => i.email === byCreator)).toBe(false);

    // Completing another's intent: refused before any Auth Admin call (Migration 5 OQ-4: the requester only).
    const admin = spy(realAdmin());
    expect(err(await keep(commandsOf(creator, admin.port).completeCreation({ requestId: theirs.id, phone: null })))).toBe(forbidden);
    expect(admin.calls).toEqual([]);

    // "ביטול" of another's intent (Migration 1 `cancel_account_request`: a real Creator, an approved request).
    data(await keep(commandsOf(creator).cancelCreation({ intentId: theirs.id, expectedVersion: theirs.version })));
    expect(sql(`select status from public.account_requests where id = ${sqlText(theirs.id)}`)).toBe("cancelled");
    expect((await queriesOf(mgr).openCreations({ limit: 100 })).items.some((i) => i.id === theirs.id)).toBe(false);
    expect(err(await keep(commandsOf(mgr).completeCreation({ requestId: theirs.id, phone: null })))).toBe(REQUEST_MESSAGES.noLongerApplies);
    // The Manager cannot cancel the Creator's (the database refuses: not his request).
    expect(err(await keep(commandsOf(mgr).cancelCreation({ intentId: mine.id, expectedVersion: mine.version })))).toBe(forbidden);
    data(await keep(commandsOf(creator).cancelCreation({ intentId: mine.id, expectedVersion: mine.version })));
  });

  test("a deletion whose ban failed: deleted and hidden at once; the same deletion again completes the ban (review S1)", async () => {
    const email = testEmail("s1");
    const created = data(await keep(commandsOf(creator).createAccount({ name: "תמחק בשניים", email, phone: PHONE, role: "cs" })));
    const target = created.account;
    const banned = () => sql(`select coalesce(banned_until > now(), false) from auth.users where id = ${sqlText(target.id)}`);
    const base = realAdmin();
    const failing = spy({ ...base, revokeAccess: async () => ({ ok: false, kind: "uncertain", code: null }) });
    const input = { accountId: target.id, expectedVersion: target.version, confirm: true } as const;
    expect(err(await keep(commandsOf(creator, failing.port).deleteAccount(input)))).toBe(ACCOUNT_MESSAGES.revokeIncomplete);
    // An uncertain ban is tried once more at once.
    expect(failing.calls).toEqual(["revokeAccess", "revokeAccess"]);
    expect(sql(`select (deleted_at is not null) || '|' || is_active from public.profiles where id = ${sqlText(target.id)}`)).toBe("true|false");
    expect(banned()).toBe("f");
    expect(await queriesOf(creator).get(target.id)).toBeNull();

    // "נסו שוב" sends the same deletion (the version the dialog sent): only the ban runs again.
    const retry = spy(base);
    const repeated = data(await keep(commandsOf(creator, retry.port).deleteAccount(input)));
    expect(retry.calls).toEqual(["revokeAccess"]);
    expect(repeated.version).toBe(Number(sql(`select version from public.profiles where id = ${sqlText(target.id)}`)));
    expect(banned()).toBe("t");
    expect(sql(`select count(*) from public.audit_logs where target_id = ${sqlText(target.id)} and action = 'profile.deleted'`)).toBe("1");
    // Nobody else reaches the repeated path: the Manager is refused by the app and by the database.
    const other = spy(base);
    expect(err(await keep(commandsOf(mgr, other.port).deleteAccount(input)))).toBe(forbidden);
    expect(await rpcCode(mgr, "admin_delete_user", { p_profile_id: target.id, p_expected_version: target.version })).toBe("42501");
    expect(other.calls).toEqual([]);
  });

  test("without the Auth Admin API, password, email and deletion change nothing", async () => {
    const target = made.mgr;
    if (!target) throw new Error("needs an account");
    const before = sql(`select (select count(*) from public.audit_logs) || '|' || (select version || '|' || (deleted_at is null) from public.profiles where id = ${sqlText(target.id)})`);
    const c = commandsOf(creator, UNAVAILABLE_AUTH_ADMIN);
    expect(err(await keep(c.setPassword(target.id, newPassword())))).toBe(ACTION_MESSAGES.unavailable);
    expect(err(await keep(c.changeEmail(target.id, testEmail("nokey"))))).toBe(ACTION_MESSAGES.unavailable);
    expect(err(await keep(c.deleteAccount({ accountId: target.id, expectedVersion: target.version, confirm: true })))).toBe(ACTION_MESSAGES.unavailable);
    expect(sql(`select (select count(*) from public.audit_logs) || '|' || (select version || '|' || (deleted_at is null) from public.profiles where id = ${sqlText(target.id)})`)).toBe(before);
  });

  test("the Creator's notices: a Manager's deactivation and an Outlook-email change by someone else, never his own", async () => {
    const target = byManager.tech;
    if (!target?.technician) throw new Error("needs the Manager's Technician");
    const fresh = await queriesOf(mgr).get(target.id);
    const off = data(await keep(commandsOf(mgr).deactivateAccount({ accountId: target.id, expectedVersion: fresh?.version ?? 0 })));
    data(await keep(commandsOf(mgr).activateAccount({ accountId: target.id, expectedVersion: off.version })));
    // The Manager changes the Outlook email through the database function directly (the app keeps it
    // for the Creator, Q14); the Creator then changes it himself.
    const row = sql(`select version || '|' || display_name || '|' || color from public.technicians where id = ${sqlText(target.technician.id)}`).split("|");
    const byManagerEmail = testEmail("cal-mgr");
    expect(
      await rpcCode(mgr, "admin_update_technician", {
        p_technician_id: target.technician.id,
        p_expected_version: Number(row[0]),
        p_display_name: row[1],
        p_color: row[2],
        p_outlook_email: byManagerEmail,
        p_device_label: null,
        p_accepts_invitations: true,
      }),
    ).toBeNull();
    data(await keep(commandsOf(creator).updateTechnician({ technicianId: target.technician.id, expectedVersion: Number(row[0]) + 1, outlookEmail: testEmail("cal-creator") })));

    const notices = (await queriesOf(creator).creatorNotices({ limit: 100 })).items;
    const deactivation = notices.find((n) => n.kind === "manager-deactivation" && n.target.accountId === target.id);
    expect(deactivation).toMatchObject({ actor: { id: mgr.user.id, name: mgr.user.name }, actorRole: "mgr", target: { role: "tech" }, requestKind: null, isTest: true });
    const changes = notices.filter((n) => n.kind === "outlook-email-change" && n.target.accountId === target.id);
    expect(changes.map((n) => n.actor.id)).toEqual([mgr.user.id]);
    expect(notices.some((n) => n.kind === "pending-request")).toBe(false);
    expect(JSON.stringify(notices)).not.toContain(byManagerEmail);
    const times = notices.map((n) => Date.parse(n.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

test("no password ever appears in a result or a log line, and no email was sent", async () => {
  expect(passwords.length).toBeGreaterThan(0);
  const text = JSON.stringify(results) + logLines.join("\n");
  for (const p of passwords) expect(text.includes(p)).toBe(false);
  for (const line of logLines) expect(line).toMatch(/^accounts\.[a-z_.]+ [A-Za-z0-9_]+$/);
  // The local Mailpit (Step 2 plan §5.4, R17): creation, password and email changes queue no mail.
  expect(mailBefore).not.toBeNull();
  expect(await mailCount()).toBe(mailBefore);
});
