import { execFileSync } from "node:child_process";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { localDbContainer, type SeededUser, type SeededUsers } from "./global-setup";

export function seeded(): SeededUsers {
  const raw = process.env.AUTH_E2E_USERS;
  if (!raw) throw new Error("the auth tests' global setup did not run");
  return JSON.parse(raw) as SeededUsers;
}

/** The Supabase session cookies (`sb-<ref>-auth-token`, possibly split into `.0`, `.1` …). */
export async function sessionCookies(context: BrowserContext) {
  return (await context.cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
}

/** Fills and submits the real sign-in form. */
export async function submitSignIn(page: Page, email: string, password: string, path = "/login") {
  await page.goto(path);
  await page.getByLabel("אימייל", { exact: true }).fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(password);
  await page.getByRole("button", { name: "כניסה" }).click();
}

export async function signInAs(page: Page, user: SeededUser, expectPath: RegExp, path = "/login") {
  await submitSignIn(page, user.email, user.password, path);
  await expect(page).toHaveURL(expectPath);
}

/** Runs SQL as postgres in the LOCAL database container (test setup only). */
export function localSql(sql: string) {
  execFileSync("docker", ["exec", "-i", localDbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: sql,
    stdio: ["pipe", "ignore", "inherit"],
  });
}
