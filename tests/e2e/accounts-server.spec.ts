import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountCommands } from "@/features/accounts/data/ports";
import type { AccountRequestStored } from "@/features/accounts/data/validate";
import {
  accountEmailError,
  ACTION_REASON_MAX,
  actionReasonError,
  cancelCreationError,
  creationCallerError,
  credentialTargetError,
  DELETE_CONFIRMATION_REQUIRED,
  deleteAccountError,
  isOwnAccount,
  OWN_ACCOUNT_REFUSED,
  ownCreationIntentError,
  roleChangeError,
  testAccountEmailError,
} from "@/features/accounts/data/validate";
import {
  authAdminFailureOf,
  authAdminPortOf,
  authUserIdForIntent,
  BAN_DURATION,
  UNAVAILABLE_AUTH_ADMIN,
  type AuthAdminPort,
  type AuthAdminResult,
} from "@/features/accounts/supabase/auth-admin";
import { accountCommandsOf } from "@/features/accounts/supabase/commands";
import {
  accountEntryOf,
  accountTechnicianOf,
  administeredRoles,
  creationIntentOf,
  type IntentRow,
  type ProfileRow,
  type TechnicianRow,
} from "@/features/accounts/supabase/queries";
import {
  INVALID_INPUT,
  parseAccountState,
  parseCancelCreation,
  parseChangeEmail,
  parseCompleteCreation,
  parseDeleteAccount,
  parseNewAccount,
  parseNewTechnician,
  parseRoleChange,
  parseSetPassword,
  parseUpdateProfile,
  parseUpdateTechnician,
} from "@/features/accounts/supabase/schemas";
import { parseSupabaseAdminEnv } from "@/features/auth/env-schema";
import type { SessionUser } from "@/features/auth/data/types";
import { ACCOUNT_MESSAGES, ACTION_MESSAGES, databaseErrorMessage, REQUEST_MESSAGES } from "@/features/data-access/supabase-errors";
import { onlyInProject } from "./helpers";

// Unit tests of the server-side account administration (D60 (7); QA M-06, M-10, C-01, C-02):
// the pure parts of features/accounts/supabase and the D60 rules in features/accounts/data. No
// database, network or browser: the clients are fakes that record or refuse every use. The flows
// themselves run against the local stack in tests/accounts (node tests/accounts/run-local.mjs).
// Every value is fictional; key-like strings are assembled at runtime.

onlyInProject("desktop");

const UUID_A = "0b7e3f1a-1111-4222-8333-944455556666";
const UUID_B = "1c8f4a2b-2222-4333-9444-a55566667777";
const SELF = "2d9a5b3c-3333-4444-a555-b66677778888";
const creator = { id: SELF, role: "creator" } as const;
const manager = { id: SELF, role: "mgr" } as const;
const forbidden = ACTION_MESSAGES.forbidden;

test.describe("Auth Admin configuration (lib/supabase/admin.ts reads it at call time)", () => {
  const url = "https://fictional-project.supabase.example";
  const secret = `sb_secret_${"fictional_unit_test_value"}`;

  test("configured only with a valid URL and a new-format secret key; problems are codes, never values", () => {
    expect(parseSupabaseAdminEnv({ url, secretKey: secret })).toEqual({ configured: true, url, secretKey: secret });
    expect(parseSupabaseAdminEnv({ url: undefined, secretKey: undefined })).toEqual({ configured: false, problems: ["url-missing", "secret-key-missing"] });
    expect(parseSupabaseAdminEnv({ url, secretKey: "  " })).toEqual({ configured: false, problems: ["secret-key-missing"] });
    const jwtLike = ["eyJ" + "a".repeat(12), "eyJ" + "b".repeat(12), "c".repeat(12)].join(".");
    for (const bad of [`sb_publishable_${"x"}`, jwtLike, `${secret} extra`, `sb_secret_${"x".repeat(600)}`]) {
      const parsed = parseSupabaseAdminEnv({ url, secretKey: bad });
      expect(parsed, bad.slice(0, 20)).toEqual({ configured: false, problems: ["secret-key-invalid"] });
      expect(JSON.stringify(parsed)).not.toContain(bad);
    }
    expect(parseSupabaseAdminEnv({ url: "http://evil.example", secretKey: secret })).toEqual({ configured: false, problems: ["url-invalid"] });
    expect(JSON.stringify(parseSupabaseAdminEnv({ url: "http://evil.example", secretKey: secret }))).not.toContain(secret);
  });

  test("lib/supabase/admin.ts is server-only, reads the variables inside the call and never exports the client", () => {
    const source = readFileSync(path.resolve("lib/supabase/admin.ts"), "utf8");
    expect(source).toContain('import "server-only";');
    expect(source).not.toMatch(/NEXT_PUBLIC_SUPABASE_SECRET|NEXT_PUBLIC_[A-Z_]*SECRET/);
    // process.env is read only inside the exported function, never at module load.
    const body = source.slice(source.indexOf("export function authAdmin()"));
    expect(source.indexOf("process.env.SUPABASE_SECRET_KEY")).toBeGreaterThan(source.indexOf("export function authAdmin()"));
    expect(body).toContain("UNAVAILABLE_AUTH_ADMIN");
    expect(source.match(/^export /gm)).toHaveLength(1);
  });

  test("the account actions are server actions in a server-only module, one per command, with no other export", () => {
    const source = readFileSync(path.resolve("lib/actions/accounts.ts"), "utf8");
    expect(source.startsWith('"use server";')).toBe(true);
    expect(source).toContain('import "server-only";');
    const exported = [...source.matchAll(/^export async function (\w+)\(input: unknown\)/gm)].map((m) => m[1]).sort();
    expect(exported).toEqual(
      [
        "activateAccount",
        "cancelCreation",
        "changeEmail",
        "changeRole",
        "completeCreation",
        "completeTechnicianProfile",
        "createAccount",
        "createTechnician",
        "deactivateAccount",
        "deleteAccount",
        "setPassword",
        "updateProfile",
        "updateTechnician",
      ].sort(),
    );
    expect(source.match(/^export /gm)).toHaveLength(exported.length);
    // The retired request path has no server action (D60 (7), C-02).
    expect(source).not.toMatch(/requestAccount|decideAccountRequest|cancelAccountRequest|request_account_change|decide_account_request/);
  });
});

test.describe("the Auth Admin port", () => {
  test("failures: a 4xx is definite (nothing took effect); 408, 5xx, network failures and unknown values are uncertain", () => {
    expect(authAdminFailureOf({ status: 422, code: "email_exists" })).toEqual({ ok: false, kind: "refused", code: "email_exists" });
    expect(authAdminFailureOf({ status: 404, code: "user_not_found" })).toEqual({ ok: false, kind: "refused", code: "user_not_found" });
    expect(authAdminFailureOf({ status: 429, code: "over_request_rate_limit" })).toEqual({ ok: false, kind: "refused", code: "over_request_rate_limit" });
    for (const error of [{ status: 408 }, { status: 500 }, { status: 0, name: "AuthRetryableFetchError" }, new TypeError("fetch failed"), null, "x"]) {
      expect(authAdminFailureOf(error).kind, JSON.stringify(error) ?? String(error)).toBe("uncertain");
    }
    // Only a plain code is kept: never Auth's message or a value-shaped code.
    expect(authAdminFailureOf({ status: 422, code: "Has Spaces <b>", message: "raw detail" })).toEqual({ ok: false, kind: "refused", code: null });
  });

  test("without a secret key every function answers \"unavailable\" and attempts nothing", async () => {
    expect(UNAVAILABLE_AUTH_ADMIN.available).toBe(false);
    expect(Object.isFrozen(UNAVAILABLE_AUTH_ADMIN)).toBe(true);
    const answers = await Promise.all([
      UNAVAILABLE_AUTH_ADMIN.createUserForIntent({ userId: UUID_A, intentId: UUID_B, email: "x@example.test" }),
      UNAVAILABLE_AUTH_ADMIN.getUser(UUID_A),
      UNAVAILABLE_AUTH_ADMIN.setPassword(UUID_A, "x"),
      UNAVAILABLE_AUTH_ADMIN.setEmail(UUID_A, "x@example.test"),
      UNAVAILABLE_AUTH_ADMIN.revokeAccess(UUID_A),
    ]);
    for (const a of answers) expect(a).toEqual({ ok: false, kind: "unavailable" });
  });

  test("calls: a confirmed user with no password and the intent nonce; a ban for a deletion; bad ids never sent; nothing echoed", async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const user = (id: string) => ({ id, email: "New@Example.Test", app_metadata: { account_request_id: UUID_B, provider: "email" }, banned_until: null });
    const admin = new Proxy(
      {},
      {
        get: (_t, method: string) =>
          async (...args: unknown[]) => {
            calls.push({ method, args });
            if (method === "updateUserById" && (args[1] as { password?: string }).password === "boom") throw new TypeError("fetch failed");
            // createUser takes the attributes (with the id); getUserById and updateUserById the id.
            const first = args[0];
            const id = typeof first === "string" ? first : typeof (first as { id?: unknown })?.id === "string" ? (first as { id: string }).id : UUID_A;
            return { data: { user: user(id) }, error: null };
          },
      },
    );
    const port = authAdminPortOf({ auth: { admin } } as unknown as SupabaseClient);
    expect(port.available).toBe(true);

    const created = await port.createUserForIntent({ userId: UUID_A, intentId: UUID_B.toUpperCase(), email: "new@example.test" });
    expect(created).toEqual({ ok: true, value: { id: UUID_A, email: "new@example.test", intentId: UUID_B, banned: false } });
    expect(calls[0]).toEqual({
      method: "createUser",
      args: [{ id: UUID_A, email: "new@example.test", email_confirm: true, app_metadata: { account_request_id: UUID_B, is_test: true } }],
    });
    expect(JSON.stringify(calls[0])).not.toMatch(/password|role/);

    expect(await port.revokeAccess(UUID_A)).toEqual({ ok: true, value: undefined });
    expect(calls.at(-1)).toEqual({ method: "updateUserById", args: [UUID_A, { ban_duration: BAN_DURATION }] });
    expect(BAN_DURATION).toBe("876000h");
    expect(await port.setEmail(UUID_A, "b@example.test")).toEqual({ ok: true, value: undefined });
    expect(calls.at(-1)).toEqual({ method: "updateUserById", args: [UUID_A, { email: "b@example.test", email_confirm: true }] });

    const secret = "S3cret-value!";
    const set = await port.setPassword(UUID_A, secret);
    expect(set).toEqual({ ok: true, value: undefined });
    expect(JSON.stringify(set)).not.toContain(secret);
    expect(await port.setPassword(UUID_A, "boom")).toEqual({ ok: false, kind: "uncertain", code: null });

    const before = calls.length;
    for (const bad of ["not-a-uuid", "", "../admin"]) {
      expect(await port.getUser(bad)).toEqual({ ok: false, kind: "refused", code: "validation_failed" });
      expect(await port.setPassword(bad, secret)).toEqual({ ok: false, kind: "refused", code: "validation_failed" });
      expect(await port.revokeAccess(bad)).toEqual({ ok: false, kind: "refused", code: "validation_failed" });
      expect(await port.createUserForIntent({ userId: bad, intentId: UUID_B, email: "x@example.test" })).toMatchObject({ kind: "refused" });
    }
    expect(calls.length).toBe(before);
  });

  test("the Auth user id of an intent is a stable, valid UUID (version 8), different per intent and case-blind", async () => {
    const a = await authUserIdForIntent(UUID_A);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await authUserIdForIntent(UUID_A.toUpperCase())).toBe(a);
    expect(await authUserIdForIntent(UUID_B)).not.toBe(a);
    expect(a).not.toBe(UUID_A);
  });
});

test.describe("D60 (7) rules (features/accounts/data/validate.ts)", () => {
  test("creation: the Creator any non-Creator role, the Manager Customer Service and Technician, nobody else", () => {
    for (const role of ["mgr", "cs", "tech"]) expect(creationCallerError("creator", role), role).toBeNull();
    expect(creationCallerError("mgr", "cs")).toBeNull();
    expect(creationCallerError("mgr", "tech")).toBeNull();
    for (const role of ["mgr", "creator", undefined, "__proto__"]) expect(creationCallerError("mgr", role), String(role)).toBe(forbidden);
    for (const viewer of ["cs", "tech", undefined, null, "admin"]) expect(creationCallerError(viewer, "tech"), String(viewer)).toBe(forbidden);
  });

  test("role change: the Creator only, never his own account, never to Creator; a reason of at most 300 characters", () => {
    const input = { accountId: UUID_A, expectedVersion: 2, newRole: "mgr" as const };
    expect(roleChangeError(input, creator)).toBeNull();
    expect(roleChangeError({ ...input, reason: "x".repeat(ACTION_REASON_MAX) }, creator)).toBeNull();
    expect(roleChangeError({ ...input, reason: "x".repeat(ACTION_REASON_MAX + 1) }, creator)).toBe(`הסיבה ארוכה מ-${ACTION_REASON_MAX} תווים`);
    for (const viewer of [manager, { id: SELF, role: "cs" as const }, { id: SELF, role: "tech" as const }, null]) {
      expect(roleChangeError(input, viewer), String(viewer?.role)).toBe(forbidden);
    }
    expect(roleChangeError({ ...input, accountId: SELF }, creator)).toBe(forbidden);
    expect(roleChangeError({ ...input, accountId: SELF.toUpperCase() }, creator)).toBe(forbidden);
    expect(roleChangeError({ ...input, newRole: "creator" as never }, creator)).toBe(forbidden);
    expect(roleChangeError({ ...input, newRole: "boss" as never }, creator)).toBe("תפקיד לא תקין");
    expect(roleChangeError({ ...input, role: "creator" } as never, creator)).toBe("קלט לא תקין");
    expect(roleChangeError({ ...input, expectedVersion: 0 }, creator)).toBe("גרסה לא תקינה");
  });

  test("deletion: the Creator only, with the explicit confirmation, never his own account", () => {
    const input = { accountId: UUID_A, expectedVersion: 3, confirm: true as const };
    expect(deleteAccountError(input, creator)).toBeNull();
    expect(deleteAccountError(input, manager)).toBe(forbidden);
    expect(deleteAccountError(input, null)).toBe(forbidden);
    for (const confirm of [undefined, false, "true", 1]) {
      expect(deleteAccountError({ ...input, confirm } as never, creator), String(confirm)).toBe(DELETE_CONFIRMATION_REQUIRED);
    }
    expect(deleteAccountError({ ...input, accountId: SELF }, creator)).toBe(forbidden);
    expect(deleteAccountError({ ...input, accountId: SELF.toUpperCase() }, creator)).toBe(forbidden);
    expect(deleteAccountError({ ...input, hard: true } as never, creator)).toBe("קלט לא תקין");
    expect(actionReasonError(7)).toBe("סיבה לא תקינה");
  });

  test("passwords and emails: the Creator only, never his own account (Q22)", () => {
    expect(credentialTargetError(creator, UUID_A)).toBeNull();
    expect(credentialTargetError(creator, SELF)).toBe(OWN_ACCOUNT_REFUSED);
    // Another spelling of the same UUID names the same row and Auth user: still his own account.
    expect(credentialTargetError(creator, SELF.toUpperCase())).toBe(OWN_ACCOUNT_REFUSED);
    expect(isOwnAccount(SELF.toUpperCase(), creator)).toBe(true);
    expect(isOwnAccount(UUID_A, creator)).toBe(false);
    expect(isOwnAccount(undefined, creator)).toBe(false);
    expect(credentialTargetError(manager, UUID_A)).toBe(forbidden);
    expect(credentialTargetError({ id: SELF, role: "cs" }, UUID_A)).toBe(forbidden);
    expect(credentialTargetError(creator, "bad id!")).toBe("חשבון לא תקין");
  });

  test("incomplete creations: only the requester's own open creation intent is completed", () => {
    const intent: AccountRequestStored = { status: "approved", version: 1, requestedBy: SELF, creation: true, fulfilled: false, intent: true, requestedRole: "cs" };
    expect(ownCreationIntentError(intent, manager)).toBeNull();
    expect(ownCreationIntentError(intent, { id: UUID_A, role: "creator" })).toBe(forbidden);
    // A Manager's legacy "create" request is history (Migration 5 OQ-4), even for the Creator.
    expect(ownCreationIntentError({ ...intent, intent: false }, creator)).toBe(forbidden);
    expect(ownCreationIntentError(undefined, manager)).toBe(forbidden);
    expect(ownCreationIntentError({ ...intent, fulfilled: true }, manager)).toBe(REQUEST_MESSAGES.noLongerApplies);
    expect(ownCreationIntentError({ ...intent, status: "cancelled" }, manager)).toBe(REQUEST_MESSAGES.noLongerApplies);
    expect(cancelCreationError({ intentId: UUID_A, expectedVersion: 1 }, manager)).toBeNull();
    expect(cancelCreationError({ intentId: UUID_A, expectedVersion: 1 }, { id: SELF, role: "tech" })).toBe(forbidden);
    expect(cancelCreationError({ intentId: UUID_A, expectedVersion: 1, extra: 1 } as never, manager)).toBe("קלט לא תקין");
  });
});

test.describe("input re-validation (features/accounts/supabase/schemas.ts)", () => {
  test("new accounts: strict shape, example.test until go-live (D47), normalized values, Hebrew messages", () => {
    expect(parseNewAccount({ name: " נציגה ", email: " New@Example.TEST ", phone: " 050-000-1111 ", role: "cs" })).toEqual({
      ok: true,
      value: { name: "נציגה", email: "new@example.test", phone: "050-000-1111", role: "cs" },
    });
    expect(parseNewAccount({ name: "x", email: "x@real-company.co.il", phone: "050-000-1111", role: "cs" })).toEqual({
      ok: false,
      error: testAccountEmailError("x@real-company.co.il"),
    });
    // The address keeps its direction in a right-to-left line: a left-to-right mark before "@" (review S4).
    expect(testAccountEmailError("x@real-company.co.il")).toBe("נתוני בדיקה: רק כתובות \u200E@example.test");
    expect(parseNewAccount({ name: "x", email: "x@example.test", phone: "050-000-1111", role: "creator" })).toEqual({
      ok: false,
      error: "לא ניתן ליצור חשבון יוצר באפליקציה",
    });
    for (const extra of [{ isTest: false }, { password: "x" }, { id: UUID_A }, { role2: "x" }]) {
      expect(parseNewAccount({ name: "x", email: "x@example.test", phone: "050-000-1111", role: "cs", ...extra }), JSON.stringify(extra)).toEqual({
        ok: false,
        error: INVALID_INPUT,
      });
    }
    for (const bad of [null, undefined, 7, "x", [], { name: 1 }]) expect(parseNewAccount(bad).ok, String(bad)).toBe(false);
    expect(parseNewAccount({ name: "", email: "x@example.test", phone: "050-000-1111", role: "cs" })).toEqual({ ok: false, error: "חסר שם" });
    expect(parseNewTechnician({ name: "x", email: "x@example.test", phone: "050-000-1111", color: "var(--t-y)", device: "x" })).toEqual({
      ok: false,
      error: "צבע לא תקין",
    });
    expect(parseNewTechnician({ name: "x", email: "x@example.test", phone: "050-000-1111", color: "t-y", device: "סמארטפון" }).ok).toBe(true);
  });

  test("account addresses are printable ASCII, so JavaScript and the database lower-case them alike (review N3)", () => {
    expect(accountEmailError("a.b+c@example.test")).toBeNull();
    for (const bad of ["אבג@example.test", "a@exämple.test", "İ@example.test", "a\u00a0b@example.test", "a@example.test\u200e"]) {
      expect(accountEmailError(bad), bad).toBe("כתובת מייל לא תקינה");
      expect(parseNewAccount({ name: "x", email: bad, phone: "050-000-1111", role: "cs" }), bad).toEqual({ ok: false, error: "כתובת מייל לא תקינה" });
      expect(parseChangeEmail({ accountId: UUID_A, email: bad }, { id: SELF, role: "creator" }), bad).toEqual({ ok: false, error: "כתובת מייל לא תקינה" });
    }
    expect(parseUpdateTechnician({ technicianId: UUID_A, expectedVersion: 1, outlookEmail: "ü@example.test" })).toEqual({ ok: false, error: "כתובת מייל לא תקינה" });
  });

  test("ids are UUIDs (fixture keys are refused), versions are positive integers, patches name only known fields", () => {
    expect(parseAccountState({ accountId: UUID_A.toUpperCase(), expectedVersion: 4 })).toEqual({ ok: true, value: { accountId: UUID_A, expectedVersion: 4 } });
    for (const bad of [
      { accountId: "acc-doron", expectedVersion: 1 },
      { accountId: UUID_A, expectedVersion: 0 },
      { accountId: UUID_A, expectedVersion: 1.5 },
      { accountId: UUID_A, expectedVersion: "1" },
      { accountId: UUID_A, expectedVersion: 2 ** 31 },
      { accountId: UUID_A, expectedVersion: 1, active: true },
    ]) {
      expect(parseAccountState(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseUpdateProfile({ accountId: UUID_A, expectedVersion: 1 })).toEqual({ ok: false, error: "אין שינוי לשמור" });
    expect(parseUpdateProfile({ accountId: UUID_A, expectedVersion: 1, phone: null, invitationAlias: " שי " })).toEqual({
      ok: true,
      value: { accountId: UUID_A, expectedVersion: 1, phone: null, invitationAlias: "שי" },
    });
    expect(parseUpdateProfile({ accountId: UUID_A, expectedVersion: 1, email: "x@example.test" })).toEqual({ ok: false, error: INVALID_INPUT });
    expect(parseUpdateProfile({ accountId: UUID_A, expectedVersion: 1, role: "creator" })).toEqual({ ok: false, error: INVALID_INPUT });
    expect(parseUpdateTechnician({ technicianId: UUID_A, expectedVersion: 1, color: "t-e", outlookEmail: " A@Example.Test " })).toEqual({
      ok: true,
      value: { technicianId: UUID_A, expectedVersion: 1, color: "t-e", outlookEmail: "a@example.test" },
    });
    expect(parseUpdateTechnician({ technicianId: UUID_A, expectedVersion: 1, color: "#ff0000" })).toEqual({ ok: false, error: "צבע לא תקין" });
    expect(parseCompleteCreation({ requestId: UUID_A, phone: null, technician: { color: "t-s", device: " טאבלט " } })).toEqual({
      ok: true,
      value: { requestId: UUID_A, phone: null, technician: { color: "t-s", device: "טאבלט" } },
    });
    expect(parseCompleteCreation({ requestId: UUID_A, phone: null, email: "x@example.test" })).toEqual({ ok: false, error: INVALID_INPUT });
    expect(parseCancelCreation({ intentId: UUID_A, expectedVersion: 1 }, { id: SELF, role: "cs" })).toEqual({ ok: false, error: forbidden });
  });

  test("role changes and deletions carry the caller's rules; reasons are trimmed and bounded", () => {
    expect(parseRoleChange({ accountId: UUID_A, expectedVersion: 1, newRole: "tech", reason: "  מעבר  " }, creator)).toEqual({
      ok: true,
      value: { accountId: UUID_A, expectedVersion: 1, newRole: "tech", reason: "מעבר" },
    });
    expect(parseRoleChange({ accountId: UUID_A, expectedVersion: 1, newRole: "tech" }, manager)).toEqual({ ok: false, error: forbidden });
    expect(parseRoleChange({ accountId: UUID_A, expectedVersion: 1, newRole: "creator" }, creator)).toEqual({ ok: false, error: forbidden });
    expect(parseDeleteAccount({ accountId: UUID_A, expectedVersion: 1, confirm: true, reason: " " }, creator)).toEqual({
      ok: true,
      value: { accountId: UUID_A, expectedVersion: 1, confirm: true },
    });
    expect(parseDeleteAccount({ accountId: UUID_A, expectedVersion: 1 }, creator)).toEqual({ ok: false, error: DELETE_CONFIRMATION_REQUIRED });
    expect(parseDeleteAccount({ accountId: UUID_A, expectedVersion: 1, confirm: true }, manager)).toEqual({ ok: false, error: forbidden });
  });

  test("passwords are never trimmed or echoed; at most 72 bytes; emails are normalized", () => {
    const password = "  ספרות וסימנים 123!  ";
    const r = parseSetPassword({ accountId: UUID_A, password }, creator);
    expect(r).toEqual({ ok: true, value: { accountId: UUID_A, password } });
    for (const bad of ["", "א".repeat(37), 7, null]) {
      const refused = parseSetPassword({ accountId: UUID_A, password: bad }, creator);
      expect(refused.ok).toBe(false);
      if (typeof bad === "string" && bad !== "") expect(JSON.stringify(refused)).not.toContain(bad);
    }
    expect(parseSetPassword({ accountId: SELF, password: "x" }, creator)).toEqual({ ok: false, error: OWN_ACCOUNT_REFUSED });
    expect(parseSetPassword({ accountId: UUID_A, password: "x", confirm: "x" }, creator)).toEqual({ ok: false, error: INVALID_INPUT });
    expect(parseChangeEmail({ accountId: UUID_A, email: " Next@Example.Test " }, creator)).toEqual({
      ok: true,
      value: { accountId: UUID_A, email: "next@example.test" },
    });
    expect(parseChangeEmail({ accountId: UUID_A, email: "not-an-email" }, creator)).toEqual({ ok: false, error: "כתובת מייל לא תקינה" });
  });
});

test.describe("list mapping (features/accounts/supabase/queries.ts)", () => {
  const profile: ProfileRow = {
    id: UUID_A,
    role: "technician",
    full_name: "טכנאי",
    work_phone: null,
    invitation_rep_name: null,
    is_active: true,
    is_test: true,
    version: 3,
    deleted_at: null,
  };
  const techRow: TechnicianRow = {
    id: UUID_B,
    profile_id: UUID_A,
    display_name: "טכנאי",
    color: "t-y",
    outlook_email: "cal@example.test",
    device_label: null,
    accepts_invitations: true,
    version: 2,
    is_test: true,
  };

  test("an entry: role mapping, phone \"\", technicianMissing, deactivation time only while inactive; deleted and unknown roles are left out", () => {
    const facts = { technician: techRow, email: "t@example.test", deactivatedAt: "2026-11-01T10:00:00+00:00" };
    expect(accountEntryOf(profile, facts, { role: "creator" })).toMatchObject({
      role: "tech",
      phone: "",
      email: "t@example.test",
      technicianId: UUID_B,
      technicianMissing: false,
      deactivatedAt: null,
      version: 3,
      isTest: true,
    });
    expect(accountEntryOf({ ...profile, is_active: false }, facts, { role: "creator" })?.deactivatedAt).toBe(facts.deactivatedAt);
    expect(accountEntryOf(profile, { ...facts, technician: null }, { role: "creator" })).toMatchObject({ technicianMissing: true, technician: null });
    expect(accountEntryOf({ ...profile, deleted_at: "2026-11-02T10:00:00+00:00", is_active: false }, facts, { role: "creator" })).toBeNull();
    expect(accountEntryOf({ ...profile, role: "superuser" }, facts, { role: "creator" })).toBeNull();
    expect(accountEntryOf({ ...profile, role: "manager" }, { ...facts, technician: null }, { role: "creator" })?.role).toBe("mgr");
  });

  test("the technician's colour only through the allowlist; the Outlook email and \"פעיל\" for the Creator only (Q14)", () => {
    expect(accountTechnicianOf(techRow, { role: "creator" })).toEqual({
      id: UUID_B,
      name: "טכנאי",
      colorToken: "t-y",
      color: "var(--t-y)",
      device: "",
      outlookEmail: "cal@example.test",
      active: true,
      version: 2,
      isTest: true,
    });
    expect(accountTechnicianOf(techRow, { role: "mgr" })).toMatchObject({ outlookEmail: null, active: null });
    for (const color of ["red", "url(javascript:x)", "t-zz", ""]) {
      expect(accountTechnicianOf({ ...techRow, color }, { role: "creator" }), color).toMatchObject({ colorToken: null, color: "" });
    }
  });

  test("scope: the Creator every role, the Manager Customer Service and Technician, nobody else", () => {
    expect(administeredRoles({ role: "creator" })).toEqual(["creator", "mgr", "cs", "tech"]);
    expect(administeredRoles({ role: "mgr" })).toEqual(["cs", "tech"]);
    expect(administeredRoles({ role: "cs" })).toEqual([]);
    expect(administeredRoles({ role: "tech" })).toEqual([]);
  });

  test("an open creation intent of the viewer only; a request, another's intent or a bound one is not", () => {
    const row: IntentRow = {
      id: UUID_B,
      request_type: "direct_create",
      requested_by: SELF,
      status: "approved",
      target_profile_id: null,
      requested_role: "customer_service",
      email: "n@example.test",
      full_name: "חדשה",
      version: 1,
      decided_at: "2026-11-17T08:00:00+00:00",
      is_test: true,
    };
    const viewer = { id: SELF, name: "מנהלת", role: "mgr" as const };
    expect(creationIntentOf(row, viewer)).toEqual({
      id: UUID_B,
      role: "cs",
      name: "חדשה",
      email: "n@example.test",
      requestedBy: { id: SELF, name: "מנהלת" },
      authorizedAt: row.decided_at,
      version: 1,
      isTest: true,
    });
    for (const over of [{ request_type: "create" }, { requested_by: UUID_A }, { target_profile_id: UUID_A }, { status: "cancelled" }, { requested_role: "creator" }]) {
      expect(creationIntentOf({ ...row, ...over }, viewer), JSON.stringify(over)).toBeNull();
    }
  });

  test("the Creator's view: every open intent with its requester's name; still never a request or a bound one (review S3)", () => {
    const row: IntentRow = {
      id: UUID_B,
      request_type: "direct_create",
      requested_by: UUID_A,
      status: "approved",
      target_profile_id: null,
      requested_role: "technician",
      email: "t@example.test",
      full_name: "טכנאי חדש",
      version: 2,
      decided_at: "2026-11-17T08:00:00+00:00",
      is_test: true,
    };
    const creator = { id: SELF, name: "יוצר", role: "creator" as const };
    const names = (id: string) => (id === UUID_A ? "מנהלת" : null);
    expect(creationIntentOf(row, creator, names)?.requestedBy).toEqual({ id: UUID_A, name: "מנהלת" });
    expect(creationIntentOf({ ...row, requested_by: SELF }, creator, names)?.requestedBy).toEqual({ id: SELF, name: "יוצר" });
    // An unknown requester name is "" (the screen says "משתמש אחר"); a non-UUID requester is left out.
    expect(creationIntentOf(row, creator)?.requestedBy).toEqual({ id: UUID_A, name: "" });
    expect(creationIntentOf({ ...row, requested_by: "not-a-uuid" }, creator, names)).toBeNull();
    for (const over of [{ request_type: "create" }, { target_profile_id: UUID_A }, { status: "pending" }, { requested_role: "creator" }, { email: null }]) {
      expect(creationIntentOf({ ...row, ...over }, creator, names), JSON.stringify(over)).toBeNull();
    }
    // The Manager never sees another's intent, whatever names are known.
    expect(creationIntentOf(row, { ...creator, role: "mgr" }, names)).toBeNull();
  });
});

test.describe("the commands refuse before any database or Auth call", () => {
  /** A client and an Auth Admin port that fail the test if anything touches them. */
  function untouchable(): { db: SupabaseClient; touched: string[] } {
    const touched: string[] = [];
    const db = new Proxy(
      {},
      {
        get: (_t, prop) => {
          touched.push(String(prop));
          throw new Error("the database must not be touched");
        },
      },
    ) as SupabaseClient;
    return { db, touched };
  }
  const adminCalls: string[] = [];
  const admin = new Proxy(
    { available: true },
    {
      get: (target, prop) => {
        if (prop === "available") return target.available;
        adminCalls.push(String(prop));
        throw new Error("the Auth Admin API must not be called");
      },
    },
  ) as never;

  async function everyCommand(c: AccountCommands) {
    return [
      await c.createAccount({ name: "x", email: "x@example.test", phone: "050-000-1111", role: "cs" }),
      await c.createTechnician({ name: "x", email: "x@example.test", phone: "050-000-1111", color: "t-y", device: "x" }),
      await c.completeCreation({ requestId: UUID_A, phone: null }),
      await c.cancelCreation({ intentId: UUID_A, expectedVersion: 1 }),
      await c.completeTechnicianProfile({ accountId: UUID_A, color: "t-y", device: "x" }),
      await c.deactivateAccount({ accountId: UUID_A, expectedVersion: 1 }),
      await c.activateAccount({ accountId: UUID_A, expectedVersion: 1 }),
      await c.updateProfile({ accountId: UUID_A, expectedVersion: 1, name: "x" }),
      await c.updateTechnician({ technicianId: UUID_A, expectedVersion: 1, name: "x" }),
      await c.changeRole({ accountId: UUID_A, expectedVersion: 1, newRole: "mgr" }),
      await c.setPassword(UUID_A, "Secret-123"),
      await c.changeEmail(UUID_A, "x@example.test"),
      await c.deleteAccount({ accountId: UUID_A, expectedVersion: 1, confirm: true }),
    ];
  }

  test("without a session, and for Customer Service and Technicians: every command is \"no permission\"", async () => {
    const viewers: (SessionUser | null)[] = [
      null,
      { id: SELF, role: "cs", name: "x", technicianId: null, isTest: true },
      { id: SELF, role: "tech", name: "x", technicianId: UUID_B, isTest: true },
    ];
    for (const viewer of viewers) {
      const { db, touched } = untouchable();
      const results = await everyCommand(accountCommandsOf({ db, admin, viewer }));
      for (const [i, r] of results.entries()) expect(r, `${viewer?.role ?? "none"} #${i}`).toEqual({ ok: false, simulated: false, error: forbidden });
      expect(touched, viewer?.role ?? "none").toEqual([]);
    }
    expect(adminCalls).toEqual([]);
  });

  test("the Manager: Manager accounts, role changes, passwords, emails and deletion are refused before any call", async () => {
    const { db, touched } = untouchable();
    const viewer: SessionUser = { id: SELF, role: "mgr", name: "x", technicianId: null, isTest: true };
    const c = accountCommandsOf({ db, admin, viewer });
    const answers = [
      await c.createAccount({ name: "x", email: "x@example.test", phone: "050-000-1111", role: "mgr" }),
      await c.createAccount({ name: "x", email: "x@example.test", phone: "050-000-1111", role: "creator" as never }),
      await c.changeRole({ accountId: UUID_A, expectedVersion: 1, newRole: "cs" }),
      await c.setPassword(UUID_A, "Secret-123"),
      await c.changeEmail(UUID_A, "x@example.test"),
      await c.deleteAccount({ accountId: UUID_A, expectedVersion: 1, confirm: true }),
      await c.deactivateAccount({ accountId: SELF, expectedVersion: 1 }),
    ];
    for (const [i, r] of answers.entries()) expect(r, `#${i}`).toEqual({ ok: false, simulated: false, error: forbidden });
    expect(touched).toEqual([]);
    expect(adminCalls).toEqual([]);
  });

  test("the Creator: his own credentials and an unconfirmed deletion are refused before any call", async () => {
    const { db, touched } = untouchable();
    const viewer: SessionUser = { id: SELF, role: "creator", name: "x", technicianId: null, isTest: false };
    const c = accountCommandsOf({ db, admin, viewer });
    expect(await c.setPassword(SELF, "Secret-123")).toEqual({ ok: false, simulated: false, error: OWN_ACCOUNT_REFUSED });
    expect(await c.setPassword(SELF.toUpperCase(), "Secret-123")).toEqual({ ok: false, simulated: false, error: OWN_ACCOUNT_REFUSED });
    expect(await c.changeEmail(SELF.toUpperCase(), "x@example.test")).toEqual({ ok: false, simulated: false, error: OWN_ACCOUNT_REFUSED });
    expect(await c.changeEmail(SELF, "x@example.test")).toEqual({ ok: false, simulated: false, error: OWN_ACCOUNT_REFUSED });
    expect(await c.deleteAccount({ accountId: UUID_A, expectedVersion: 1 } as never)).toEqual({ ok: false, simulated: false, error: DELETE_CONFIRMATION_REQUIRED });
    expect(await c.changeRole({ accountId: SELF, expectedVersion: 1, newRole: "mgr" })).toEqual({ ok: false, simulated: false, error: forbidden });
    expect(touched).toEqual([]);
    expect(adminCalls).toEqual([]);
  });

  test("without a secret key, the Creator's credential and deletion commands stop before the database", async () => {
    const { db, touched } = untouchable();
    const viewer: SessionUser = { id: SELF, role: "creator", name: "x", technicianId: null, isTest: false };
    const c = accountCommandsOf({ db, admin: UNAVAILABLE_AUTH_ADMIN, viewer });
    const unavailable = { ok: false, simulated: false, error: ACTION_MESSAGES.unavailable };
    expect(await c.setPassword(UUID_A, "Secret-123")).toEqual(unavailable);
    expect(await c.deleteAccount({ accountId: UUID_A, expectedVersion: 1, confirm: true })).toEqual(unavailable);
    expect(await c.createAccount({ name: "x", email: "x@example.test", phone: "050-000-1111", role: "mgr" })).toEqual(unavailable);
    expect(await c.completeCreation({ requestId: UUID_A, phone: null })).toEqual(unavailable);
    expect(touched).toEqual([]);
  });
});

test.describe("deletion: the Auth ban after the database (review S1)", () => {
  const creator: SessionUser = { id: SELF, role: "creator", name: "יוצר", technicianId: null, isTest: false };
  const DELETED_ROW = {
    id: UUID_A,
    role: "customer_service",
    full_name: "x",
    work_phone: null,
    invitation_rep_name: null,
    is_active: false,
    is_test: true,
    version: 7,
    deleted_at: "2026-11-17T08:00:00+00:00",
  };

  /** A database that answers `admin_delete_user` with `answer` and reads the deleted profile; it records its calls. */
  function fakeDb(answer: { data: unknown; error: { code: string; message: string } | null }): { db: SupabaseClient; calls: string[] } {
    const calls: string[] = [];
    const read = { select: () => read, eq: () => read, limit: () => Promise.resolve({ data: [DELETED_ROW], error: null }) };
    const db = {
      rpc: (name: string) => (calls.push(`rpc:${name}`), Promise.resolve(answer)),
      from: (table: string) => (calls.push(`from:${table}`), read),
    } as unknown as SupabaseClient;
    return { db, calls };
  }

  /** An Auth Admin port whose ban answers each call from `bans` in turn (the last one repeats). */
  function banning(bans: AuthAdminResult[]): { admin: AuthAdminPort; calls: string[] } {
    const calls: string[] = [];
    const never = async (): Promise<never> => {
      throw new Error("only the ban may be called");
    };
    const admin: AuthAdminPort = {
      available: true,
      createUserForIntent: never,
      getUser: never,
      setPassword: never,
      setEmail: never,
      revokeAccess: async (id) => {
        calls.push(`revokeAccess:${id}`);
        return bans[Math.min(calls.length - 1, bans.length - 1)] as AuthAdminResult;
      },
    };
    return { admin, calls };
  }

  const input = { accountId: UUID_A, expectedVersion: 6, confirm: true } as const;
  const uncertain: AuthAdminResult = { ok: false, kind: "uncertain", code: null };

  test("an uncertain ban is tried once more at once; still failing, the result says the deletion is incomplete", async () => {
    const { db, calls } = fakeDb({ data: 7, error: null });
    const ban = banning([uncertain, uncertain]);
    const log: string[] = [];
    const r = await accountCommandsOf({ db, admin: ban.admin, viewer: creator, log: (e, c) => void log.push(`${e} ${String(c)}`) }).deleteAccount(input);
    expect(r).toEqual({ ok: false, simulated: false, error: ACCOUNT_MESSAGES.revokeIncomplete });
    expect(calls).toEqual(["rpc:admin_delete_user"]);
    expect(ban.calls).toEqual([`revokeAccess:${UUID_A}`, `revokeAccess:${UUID_A}`]);
    expect(log).toEqual(["accounts.delete.revoke_retry uncertain", "accounts.delete.revoke_failed null"]);
  });

  test("an uncertain ban that succeeds on the immediate retry completes the deletion", async () => {
    const { db } = fakeDb({ data: 7, error: null });
    const ban = banning([uncertain, { ok: true, value: undefined }]);
    expect(await accountCommandsOf({ db, admin: ban.admin, viewer: creator }).deleteAccount(input)).toEqual({
      ok: true,
      simulated: false,
      message: ACCOUNT_MESSAGES.deletedOk,
      data: { version: 7 },
    });
    expect(ban.calls).toHaveLength(2);
  });

  test("a definite refusal is not retried at once; \"user_not_found\" counts as done (nothing left to ban)", async () => {
    const refused = banning([{ ok: false, kind: "refused", code: "over_request_rate_limit" }]);
    expect(await accountCommandsOf({ db: fakeDb({ data: 7, error: null }).db, admin: refused.admin, viewer: creator }).deleteAccount(input)).toEqual({
      ok: false,
      simulated: false,
      error: ACCOUNT_MESSAGES.revokeIncomplete,
    });
    expect(refused.calls).toHaveLength(1);
    const gone = banning([{ ok: false, kind: "refused", code: "user_not_found" }]);
    expect((await accountCommandsOf({ db: fakeDb({ data: 7, error: null }).db, admin: gone.admin, viewer: creator }).deleteAccount(input)).ok).toBe(true);
  });

  test("\"נסו שוב\": the same deletion again; the database's \"already deleted\" refusal authorizes the ban alone", async () => {
    const { db, calls } = fakeDb({ data: null, error: { code: "55000", message: "the account is deleted" } });
    const ban = banning([{ ok: true, value: undefined }]);
    expect(await accountCommandsOf({ db, admin: ban.admin, viewer: creator }).deleteAccount(input)).toEqual({
      ok: true,
      simulated: false,
      message: ACCOUNT_MESSAGES.deletedOk,
      data: { version: 7 },
    });
    expect(calls).toEqual(["rpc:admin_delete_user", "from:profiles"]);
    expect(ban.calls).toEqual([`revokeAccess:${UUID_A}`]);
    // Any other refusal (here: not authorized) stops before the ban.
    const other = banning([{ ok: true, value: undefined }]);
    const denied = fakeDb({ data: null, error: { code: "42501", message: "not authorized" } });
    expect(await accountCommandsOf({ db: denied.db, admin: other.admin, viewer: creator }).deleteAccount(input)).toEqual({ ok: false, simulated: false, error: forbidden });
    expect(other.calls).toEqual([]);
  });
});

test.describe("Hebrew messages for Migration 5's refusals", () => {
  test("the deletion, the retired request path and the D49 promotion rule each have a message; no raw text leaks", () => {
    for (const message of ["the account is deleted", "profiles: a deleted account never changes (D60 (7))", "technicians: the account is deleted (D60 (7))"]) {
      expect(databaseErrorMessage({ code: "55000", message }), message).toBe(ACCOUNT_MESSAGES.deleted);
    }
    expect(databaseErrorMessage({ code: "55000", message: "account_requests: account requests are retired (D60 (7))" })).toBe(ACCOUNT_MESSAGES.requestsRetired);
    expect(databaseErrorMessage({ code: "55000", message: "profiles: no user is promoted to Creator (D49)" })).toBe("לא ניתן להפוך משתמש ליוצר.");
    expect(databaseErrorMessage({ code: "55000", message: "an open request exists" })).toBe(ACCOUNT_MESSAGES.openCreationExists);
    for (const text of Object.values(ACCOUNT_MESSAGES)) expect(text).toMatch(/[֐-׿]/);
  });
});
