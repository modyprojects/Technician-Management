import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { userManagementRowOf, USER_MANAGEMENT_TITLES } from "@/components/office/UserManagementRules";
import { ACCOUNT_ACTION_NAMES, accountCommandsOfActions, type AccountActions } from "@/features/accounts/data/actions";
import {
  creatableRoles,
  credentialActionsOffered,
  deleteOffered,
  intentCancelOffered,
  intentCompletionOffered,
  profileEditOffered,
  roleChangeChoices,
  roleChangeOffered,
  stateChangeOffered,
  type AccountAdminScope,
} from "@/features/accounts/data/offers";
import { accountTimeLabel } from "@/features/accounts/data/time-label";
import { ACCOUNT_ROLE_VALUES, type AccountListEntry, type AccountRole } from "@/features/accounts/data/types";
import { creationCallerError, deleteAccountError, roleChangeError } from "@/features/accounts/data/validate";
import { OFFICE_SETTINGS_PATH, OFFICE_SETTINGS_USERS_PATH, realOfficeNav } from "@/features/auth/landing";
import { SIGN_IN_MESSAGES } from "@/features/data-access/supabase-errors";
import { onlyInProject, openPage } from "./helpers";

// The real unified user management (D60 (7); Step 2): the display rules, the action adapter, the
// real navigation, the time label and the page wiring, as unit and source checks; and the new routes
// WITHOUT the Supabase variables (the default e2e server has none): they fail closed. The signed-in
// flows run against the local Supabase stack in tests/auth/user-management.spec.ts.

const SELF = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const viewerOf = (scope: AccountAdminScope) => ({ id: SELF, role: (scope === "all" ? "creator" : "mgr") as AccountRole });
const row = (role: AccountRole, extra: Partial<{ id: string; technicianId: string | null }> = {}) => ({
  id: extra.id ?? OTHER,
  role,
  technicianId: extra.technicianId ?? null,
});

test.describe("D60 (7) display rules (offers.ts): each mirrors the server's rule, deny by default", () => {
  onlyInProject("desktop");

  test("\"הוסף משתמש\": the Creator Technician, Customer Service and Manager; the Manager Technician and Customer Service; never Creator", () => {
    expect(creatableRoles("all", SELF)).toEqual(["tech", "cs", "mgr"]);
    expect(creatableRoles("cs-tech", SELF)).toEqual(["tech", "cs"]);
    expect(creatableRoles(null, SELF)).toEqual([]);
    expect(creatableRoles("all", null)).toEqual([]);
    for (const scope of ["all", "cs-tech"] as const) {
      const viewer = viewerOf(scope);
      for (const role of ACCOUNT_ROLE_VALUES) {
        const offered = creatableRoles(scope, SELF).includes(role as never);
        // Offered ⇒ the server's caller rule lets it through; a Creator account is never offered.
        if (offered) expect(creationCallerError(viewer.role, role), `${scope} ${role}`).toBeNull();
        if (role === "creator") expect(offered).toBe(false);
        if (scope === "cs-tech" && (role === "mgr" || role === "creator")) expect(creationCallerError(viewer.role, role)).not.toBeNull();
      }
    }
  });

  test("role change and deletion: the Creator only, never his own row or a Creator row; never a Technician with a field profile", () => {
    for (const role of ACCOUNT_ROLE_VALUES) {
      expect(roleChangeOffered("cs-tech", row(role), SELF), role).toBe(false);
      expect(deleteOffered("cs-tech", row(role), SELF), role).toBe(false);
      expect(credentialActionsOffered("cs-tech", row(role), SELF), role).toBe(false);
      // The Manager is refused by the server too.
      expect(roleChangeError({ accountId: OTHER, expectedVersion: 1, newRole: "cs" }, viewerOf("cs-tech"))).not.toBeNull();
      expect(deleteAccountError({ accountId: OTHER, expectedVersion: 1, confirm: true }, viewerOf("cs-tech"))).not.toBeNull();
    }
    expect(roleChangeOffered("all", row("mgr"), SELF)).toBe(true);
    expect(roleChangeOffered("all", row("cs"), SELF)).toBe(true);
    expect(roleChangeOffered("all", row("tech"), SELF)).toBe(true);
    expect(roleChangeOffered("all", row("tech", { technicianId: OTHER }), SELF)).toBe(false);
    expect(roleChangeOffered("all", row("creator"), SELF)).toBe(false);
    expect(roleChangeOffered("all", row("mgr", { id: SELF }), SELF)).toBe(false);
    expect(roleChangeOffered("all", row("mgr"), null)).toBe(false);
    expect(roleChangeOffered(null, row("mgr"), SELF)).toBe(false);
    expect(deleteOffered("all", row("mgr"), SELF)).toBe(true);
    expect(deleteOffered("all", row("tech", { technicianId: OTHER }), SELF)).toBe(true);
    expect(deleteOffered("all", row("creator"), SELF)).toBe(false);
    expect(deleteOffered("all", row("cs", { id: SELF }), SELF)).toBe(false);
    // What is offered passes the server's rule; his own account is refused there as well.
    expect(roleChangeError({ accountId: OTHER, expectedVersion: 1, newRole: "cs" }, viewerOf("all"))).toBeNull();
    expect(deleteAccountError({ accountId: OTHER, expectedVersion: 1, confirm: true }, viewerOf("all"))).toBeNull();
    expect(roleChangeError({ accountId: SELF.toUpperCase(), expectedVersion: 1, newRole: "cs" }, viewerOf("all"))).not.toBeNull();
    expect(deleteAccountError({ accountId: SELF, expectedVersion: 1, confirm: true }, viewerOf("all"))).not.toBeNull();
    // Review N6, pinned: a Creator row's role change is a display subset only. The rule (like
    // `admin_set_user_role`) cannot see the target's role and lets another Creator's id through;
    // the database's last-active-Creator rule guards it. The comments of both say so.
    expect(roleChangeError({ accountId: OTHER, expectedVersion: 1, newRole: "mgr" }, viewerOf("all"))).toBeNull();
    const offers = readFileSync(path.resolve("features/accounts/data/offers.ts"), "utf8");
    const rules = readFileSync(path.resolve("features/accounts/data/validate.ts"), "utf8");
    expect(offers).toContain("The screen offers a SUBSET of what the");
    expect(offers).not.toContain("D49: Creator accounts are not managed through the app");
    expect(rules).toContain("the screen does not\n * offer that row (roleChangeOffered, a display subset, review N6)");
  });

  test("\"יצירה שלא הושלמה\": completion by the requester only; \"ביטול\" also by the Creator on anyone's (review S3)", () => {
    const mine = { requestedBy: { id: SELF, name: "x" } };
    const another = { requestedBy: { id: OTHER, name: "y" } };
    expect(intentCompletionOffered("all", mine, SELF)).toBe(true);
    expect(intentCompletionOffered("all", another, SELF)).toBe(false);
    expect(intentCompletionOffered("cs-tech", another, SELF)).toBe(false);
    expect(intentCancelOffered("all", mine, SELF)).toBe(true);
    expect(intentCancelOffered("all", another, SELF)).toBe(true);
    expect(intentCancelOffered("cs-tech", mine, SELF)).toBe(true);
    expect(intentCancelOffered("cs-tech", another, SELF)).toBe(false);
    expect(intentCancelOffered(null, mine, SELF)).toBe(false);
    expect(intentCancelOffered("all", another, null)).toBe(false);
    // D67 (b): the Creator's notices include every account created by anyone but himself (a Manager).
    const queries = readFileSync(path.resolve("features/accounts/supabase/queries.ts"), "utf8");
    expect(queries).toContain("`and(action.eq.profile.created,actor_profile_id.neq.${viewer.id})`");
    expect(queries).toContain('r.action === "profile.created"\n                ? "manager-creation"');
    // The page passes the Creator every open intent and the Manager only his own.
    const page = readFileSync(path.resolve("app/(office)/office/settings/users/page.tsx"), "utf8");
    expect(page).toContain('const own = scope === "all" ? intents : ownIntents(intents, me.id);');
  });

  test("the new role is never Creator and never the current one", () => {
    expect(roleChangeChoices("mgr")).toEqual(["tech", "cs"]);
    expect(roleChangeChoices("cs")).toEqual(["tech", "mgr"]);
    expect(roleChangeChoices("tech")).toEqual(["cs", "mgr"]);
    for (const role of ACCOUNT_ROLE_VALUES) expect(roleChangeChoices(role)).not.toContain("creator");
  });

  test("(de)activation: the Creator any row but his own; the Manager Customer Service and Technician rows only", () => {
    for (const role of ACCOUNT_ROLE_VALUES) {
      expect(stateChangeOffered("all", row(role), SELF), role).toBe(true);
      expect(stateChangeOffered("all", row(role, { id: SELF }), SELF), role).toBe(false);
      expect(stateChangeOffered("cs-tech", row(role), SELF), role).toBe(role === "cs" || role === "tech");
      expect(stateChangeOffered(null, row(role), SELF), role).toBe(false);
      expect(stateChangeOffered("all", row(role), null), role).toBe(false);
    }
    // The routine edit (PR 2.3 rule, unchanged): the Creator also on his own row.
    expect(profileEditOffered("all", row("creator", { id: SELF }), SELF)).toBe(true);
    expect(profileEditOffered("cs-tech", row("mgr"), SELF)).toBe(false);
  });
});

test.describe("the real actions as the account port", () => {
  onlyInProject("desktop");

  test("every action is passed through; the credential calls become one input object; nothing is kept", async () => {
    const calls: [string, unknown][] = [];
    const actions = Object.fromEntries(
      ACCOUNT_ACTION_NAMES.map((name) => [name, async (input: unknown) => (calls.push([name, input]), { ok: true as const, simulated: false })]),
    ) as unknown as AccountActions;
    const port = accountCommandsOfActions(actions);
    const secret = ["fictional", "pass", "1234"].join("-");
    await port.setPassword(OTHER, secret);
    await port.changeEmail(OTHER, "new@example.test");
    await port.deleteAccount({ accountId: OTHER, expectedVersion: 3, confirm: true });
    await port.changeRole({ accountId: OTHER, expectedVersion: 2, newRole: "cs" });
    expect(calls).toEqual([
      ["setPassword", { accountId: OTHER, password: secret }],
      ["changeEmail", { accountId: OTHER, email: "new@example.test" }],
      ["deleteAccount", { accountId: OTHER, expectedVersion: 3, confirm: true }],
      ["changeRole", { accountId: OTHER, expectedVersion: 2, newRole: "cs" }],
    ]);
    expect(Object.keys(port).sort()).toEqual([...ACCOUNT_ACTION_NAMES].sort());
  });

  test("the 13 names are exactly the server actions of lib/actions/accounts.ts, and the page passes all of them", () => {
    const actions = readFileSync(path.resolve("lib/actions/accounts.ts"), "utf8");
    const exported = [...actions.matchAll(/^export async function (\w+)\(input: unknown\)/gm)].map((m) => m[1]).sort();
    expect([...ACCOUNT_ACTION_NAMES].sort()).toEqual(exported);
    const page = readFileSync(path.resolve("app/(office)/office/settings/users/page.tsx"), "utf8");
    const block = page.slice(page.indexOf("const ACTIONS: AccountActions = {"), page.indexOf("};", page.indexOf("const ACTIONS")));
    for (const name of ACCOUNT_ACTION_NAMES) expect(block, name).toMatch(new RegExp(`\\b${name},`));
  });
});

test.describe("the real office navigation and the settings routes", () => {
  onlyInProject("desktop");

  test("Manager and Creator: the landing item, \"זימונים שלא נקלטו\" and \"הגדרות\"; Customer Service \"קריאות\" and \"זימונים שלא נקלטו\" (S-01, S-05); anything else nothing", () => {
    for (const role of ["mgr", "creator"] as const) {
      expect(realOfficeNav(role)).toEqual([
        { key: "analytics", label: "דשבורד", href: "/office" },
        { key: "unparsed", label: "זימונים שלא נקלטו", href: "/office/unparsed" },
        { key: "settings", label: "הגדרות", href: OFFICE_SETTINGS_USERS_PATH },
      ]);
    }
    expect(realOfficeNav("cs")).toEqual([
      { key: "calls", label: "קריאות", href: "/office" },
      { key: "unparsed", label: "זימונים שלא נקלטו", href: "/office/unparsed" },
    ]);
    for (const value of ["tech", "constructor", "__proto__", "", null, undefined]) expect(realOfficeNav(value), String(value)).toEqual([]);
    expect(OFFICE_SETTINGS_PATH).toBe("/office/settings");
    expect(OFFICE_SETTINGS_USERS_PATH).toBe("/office/settings/users");
    expect(USER_MANAGEMENT_TITLES).toEqual({ all: "משתמשים והרשאות", "cs-tech": "משתמשים" });
  });

  test("each settings page guards itself on the server; the screen never imports lib/actions or app/; no requests (C-02)", () => {
    for (const file of ["app/(office)/office/settings/page.tsx", "app/(office)/office/settings/users/page.tsx"]) {
      const source = readFileSync(path.resolve(file), "utf8");
      expect(source, file).toContain('await requireArea("office")');
      expect(source, file).not.toMatch(/app\/dev|_fixtures|demoDataAccess/);
    }
    const page = readFileSync(path.resolve("app/(office)/office/settings/users/page.tsx"), "utf8");
    // The role decides on the server before any account data is read.
    expect(page.indexOf("accountAdminScope(me.role)")).toBeLessThan(page.indexOf("await accountsQueries()"));
    for (const file of [
      "components/office/UserManagementScreen.tsx",
      "components/office/UserManagementRules.ts",
      "components/office/AccountAddDialog.tsx",
      "components/office/AccountRoleDialog.tsx",
      "components/office/AccountConfirmDialog.tsx",
      "components/office/SettingsNoAccess.tsx",
    ]) {
      // The code without its comments (which do name what the screen leaves out).
      const source = readFileSync(path.resolve(file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/from "@\/lib\/|from "@\/app\//);
      expect(source, file).not.toMatch(/בקשות לאישור|requestAccount|decideAccountRequest|cancelAccountRequest|useCommands\(/);
    }
  });

  test("the password field of the real dialogs: uncontrolled, autocomplete new-password, emptied after the call", () => {
    const source = readFileSync(path.resolve("components/office/AccountCredentialForms.tsx"), "utf8");
    expect(source).toContain('autoComplete="new-password"');
    expect(source).toContain('passwordRef.current.value = ""');
    expect(source).toContain("useAccountCommands()");
  });
});

test.describe("rows and time labels", () => {
  onlyInProject("desktop");

  const entry = (technician: AccountListEntry["technician"]): AccountListEntry => ({
    id: OTHER,
    name: "טכנאי",
    role: "tech",
    email: "",
    phone: "",
    invitationAlias: null,
    active: true,
    deactivatedAt: null,
    technicianId: technician?.id ?? null,
    technicianMissing: technician === null,
    version: 4,
    isTest: true,
    technician,
  });
  const tech = { id: SELF, name: "טכנאי", colorToken: "t-s" as const, color: "var(--t-s)", device: "", version: 2, isTest: true };

  test("a Manager's row never carries the Outlook email or \"פעיל\" (Q14); the Creator's does", () => {
    const mgrRow = userManagementRowOf(entry({ ...tech, outlookEmail: null, active: null }));
    expect(mgrRow.technician).toEqual({ id: SELF, name: "טכנאי", color: "var(--t-s)", device: "", version: 2, isTest: true });
    expect(JSON.stringify(mgrRow)).not.toContain("outlookEmail");
    const creatorRow = userManagementRowOf(entry({ ...tech, outlookEmail: "t@example.test", active: false }));
    expect(creatorRow.technician).toMatchObject({ outlookEmail: "t@example.test", active: false });
    const plain = userManagementRowOf(entry(null));
    expect(plain.technician).toBeNull();
    expect("technician" in plain.account).toBe(false);
  });

  test("\"היום\", \"אתמול\" or the date, in Asia/Jerusalem, from the database's timestamps; nothing for anything else", () => {
    const now = new Date("2026-11-17T10:00:00Z");
    expect(accountTimeLabel("2026-11-17T08:05:00.123456+00:00", now)).toBe("היום 10:05");
    expect(accountTimeLabel("2026-11-16T21:59:00Z", now)).toBe("אתמול 23:59");
    expect(accountTimeLabel("2026-11-16T22:30:00Z", now)).toBe("היום 00:30");
    expect(accountTimeLabel("2026-09-14 09:20:00+00", now)).toBe("14.09 12:20");
    for (const value of ["", "yesterday", "2026-11-17T08:05:00", null, undefined, "2026-13-45T00:00:00Z"]) {
      expect(accountTimeLabel(value, now), String(value)).toBe("");
    }
  });
});

test.describe("the settings routes without the Supabase variables (fail closed)", () => {
  test("anonymous visitors go to /login and see nothing of the screen", async ({ page }) => {
    for (const p of [OFFICE_SETTINGS_PATH, OFFICE_SETTINGS_USERS_PATH]) {
      await openPage(page, p);
      await expect(page, p).toHaveURL(/\/login$/);
      await expect(page.locator(".login-alert"), p).toHaveText(SIGN_IN_MESSAGES.service);
      await expect(page.getByRole("table")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "+ הוסף משתמש" })).toHaveCount(0);
      const html = await page.content();
      expect(html, p).not.toContain("משתמשים והרשאות");
      expect(html, p).not.toContain("הדגמה");
    }
  });
});
