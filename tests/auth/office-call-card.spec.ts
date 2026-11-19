import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callCardOf } from "@/features/calls/supabase/card-queries";
import { jerusalemTime } from "@/features/dashboards/data/time";
import { addDays } from "@/features/calendar/data/dates";
import { jerusalemToday } from "@/features/visits/data/today";
import type { SeededUser } from "./global-setup";
import { localSql, localSqlValue, seeded, submitSignIn } from "./helpers";
import { attendeeOf, ensurePickupPlace, ingestVisit, signedInClient, type FictionalVisit } from "./tech-fixtures";

// The office call card on real data (D60 (5), D68, D74, D88) against the LOCAL Supabase stack
// (tests/auth/run-local.mjs; never the remote project). The calls and visits are made through the
// single ingestion service under an office user's own session; visit 1 is departed, reached and
// closed "המשך טיפול" by its technician through the real field writers (Migration 7) under his own
// session, so the field times are the database's own (visit_time_current). Every record is
// fictional and test-marked by the database (D47). The technicians' work phones are fictional
// test values set as postgres (no writer in this step).
//   node tests/auth/run-local.mjs [--with-creator] tests/auth/office-call-card.spec.ts
// Screenshots on demand: SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/office-call-card.spec.ts

const OUT = path.resolve("docs/review/office-call-card");
const run = Math.random().toString(16).slice(2, 8);
const reqA = `91${String(Date.now()).slice(-7)}`;
const reqB = `92${String(Date.now()).slice(-7)}`;
const today = jerusalemToday();
const customer = "משפחת לוי";
const PHONE_TECH = "050-0000001";
const PHONE_TECH2 = "050-0000002";
const PLACE = "מחסן ראשי (בדיקה)";

const base: Omit<FictionalVisit, "req"> = {
  rep: "שירה נציגה",
  customerNo: `C${run}`,
  customer,
  phone: "050-0000100",
  city: "רחובות",
  street: "הרצל 14",
  building: "2",
  floor: "3",
  apt: "9",
  arrival: "לצלצל בטלפון לפני העלייה",
  product: "ברז מטבח נשלף",
  sku: "KT-2041",
  desc: "הברז מטפטף מהבסיס גם כשהוא סגור.",
  warranty: "כן · עד 03/2027",
};

function creator(): SeededUser | null {
  const raw = process.env.AUTH_E2E_CREATOR;
  return raw ? (JSON.parse(raw) as SeededUser) : null;
}

async function signedIn(browser: Browser, user: SeededUser, home: RegExp, width = 1440): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "he-IL", viewport: { width, height: width <= 600 ? 844 : 900 } });
  const page = await context.newPage();
  await submitSignIn(page, user.email, user.password);
  await expect(page).toHaveURL(home);
  return { context, page };
}

const device = (at: Date) => ({ p_reported_at: at.toISOString(), p_device_tz: "Asia/Jerusalem", p_device_utc_offset_min: 120, p_device_sent_at: new Date().toISOString() });

/** Departs, arrives and closes "המשך טיפול" as the technician himself (Migration 7 writers). */
async function workVisit(tech: SupabaseClient, visitId: string, departed: Date): Promise<void> {
  const step = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await tech.rpc(fn, { p_visit_id: visitId, p_operation_id: randomUUID(), ...args });
    expect(error, fn).toBeNull();
    return (data as { out_field_version: number }[])[0]!.out_field_version;
  };
  const minutes = (m: number) => new Date(departed.getTime() + m * 60_000);
  let fv = await step("depart_visit", { p_expected_field_version: 1, ...device(departed) });
  fv = await step("arrive_visit", { p_expected_field_version: fv, ...device(minutes(20)) });
  const { data: reasons } = await tech.from("followup_reasons").select("id").eq("is_active", true).order("sort_order").limit(1);
  await step("close_visit", {
    p_expected_field_version: fv,
    p_outcome: "followup",
    p_summary: "הוחלף האטם הפנימי. נדרש אטם חלופי לבסיס.",
    p_signer_name: null,
    p_ack_text_sha256: null,
    p_signature_media_id: null,
    p_followup_reason_id: (reasons as { id: string }[])[0]!.id,
    p_next_visit_notes: "להביא אטם לבסיס הברז",
    ...device(minutes(45)),
  });
}

async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "600 16px Rubik", "700 16px Rubik", "400 16px Assistant", "600 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
}

test.describe.serial("office call card on real data (local stack)", () => {
  let departed = new Date();
  let visit1 = "";

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const users = seeded();
    const office = await signedInClient(users.mgr.email, users.mgr.password);
    const techRow = process.env.AUTH_E2E_TECH_ROW ?? "";
    const tech2Row = process.env.AUTH_E2E_TECH2_ROW ?? "";
    ensurePickupPlace(PLACE, "האורגים 1, חולון");
    // Fictional work phones of the two seeded test technicians.
    localSql(`update public.profiles set work_phone = '${PHONE_TECH}' where id = '${users.tech.id}';
update public.profiles set work_phone = '${PHONE_TECH2}' where id = '${users.tech2.id}';`);
    // Call B (older, resolved later or not: another call of the same customer).
    await ingestVisit(office, await attendeeOf(office, tech2Row), addDays(today, -3), "12:00", "13:00", {
      ...base,
      req: reqB,
      product: "מסנן מים",
      sku: "WF-100",
      desc: "המסנן לא מסנן.",
    });
    // Call A: visit 1 today (technician 1), worked and closed "המשך טיפול"; visit 2 next week (technician 2) with a pickup.
    visit1 = await ingestVisit(office, await attendeeOf(office, techRow), today, "08:30", "10:00", { ...base, req: reqA, task: "1" });
    await ingestVisit(office, await attendeeOf(office, tech2Row), addDays(today, 7), "09:00", "10:30", {
      ...base,
      req: reqA,
      task: "2",
      collect: "אטם לברז KT-2041",
      collectFrom: PLACE,
    });
    const tech = await signedInClient(users.tech.email, users.tech.password);
    departed = new Date(Math.floor((Date.now() - 60 * 60_000) / 60_000) * 60_000);
    await workVisit(tech, visit1, departed);
  });

  test("Manager: the card with both visits, office-only times and durations, warranty, other calls and both call buttons", async ({ browser }) => {
    const { context, page } = await signedIn(browser, seeded().mgr, /\/office$/);
    const response = await page.goto(`/office/calls/${reqA}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: customer })).toBeVisible();
    // D74: one banner at the top and one quiet "בדיקה" by the title; nothing per field.
    await expect(page.locator(".test-banner")).toHaveCount(1);
    await expect(page.locator(".test-banner")).toContainText("נתוני בדיקה");
    await expect(page.locator(".ptitle .test-mark")).toHaveCount(1);
    await expect(page.locator(".ocd .test-mark")).toHaveCount(0);
    await expect(page.getByText(`פנייה ${reqA} · נציגה מטפלת: שירה נציגה · 2 ביקורים`)).toBeVisible();

    const v1 = page.locator("#visit-1");
    await expect(v1).toContainText("המשך טיפול");
    await expect(v1).toContainText("היום");
    await expect(v1).toContainText(`יציאה ${jerusalemTime(departed.toISOString())}`);
    await expect(v1).toContainText(`הגעה ${jerusalemTime(new Date(departed.getTime() + 20 * 60_000).toISOString())}`);
    await expect(v1).toContainText(`סיום ${jerusalemTime(new Date(departed.getTime() + 45 * 60_000).toISOString())}`);
    await expect(v1).toContainText("בטיפול 25 דק׳");
    await expect(v1).toContainText("זמן נסיעה 20 דק׳");
    await expect(v1).toContainText("משך כולל 45 דק׳");
    await expect(v1).toContainText("הוחלף האטם הפנימי");
    await expect(v1).toContainText("להביא אטם לבסיס הברז");
    await expect(v1).toContainText("טכנאי בדיקה");

    const v2 = page.locator("#visit-2");
    await expect(v2).toContainText("שובצה");
    await expect(v2).toContainText("טכנאי שני בדיקה");
    await expect(v2).toContainText("לאסוף: אטם לברז KT-2041");
    await expect(v2).not.toContainText("משך כולל");

    await expect(page.locator(".ocd-info")).toContainText("כן · עד 03/2027");
    await expect(page.locator(".ocd-info")).toContainText("הרצל 14, רחובות");
    await expect(page.locator(".ocd-info")).toContainText("KT-2041");
    const other = page.getByRole("link", { name: new RegExp(reqB) });
    await expect(other).toHaveAttribute("href", `/office/calls/${reqB}`);
    await expect(other).toContainText("מסנן מים");
    // The latest visit's technician (technician 2), and the customer.
    await expect(page.getByRole("link", { name: "התקשר לטכנאי" })).toHaveAttribute("href", "tel:0500000002");
    await expect(page.getByRole("link", { name: "התקשר ללקוח" })).toHaveAttribute("href", "tel:0500000100");
    // No cancellation and no assignment card (owner, 19.11).
    await expect(page.getByRole("button", { name: /ביטול/ })).toHaveCount(0);

    // Unknown and malformed numbers: the same 404.
    for (const req of ["999999999", "NO-SUCH-1", "a%20b", "x".repeat(40)]) {
      expect((await page.goto(`/office/calls/${req}`))?.status(), req).toBe(404);
    }
    await context.close();
  });

  test("Customer Service: the same card; no technician phone (profiles are not readable to the role), so no \"התקשר לטכנאי\"", async ({ browser }) => {
    const { context, page } = await signedIn(browser, seeded().cs, /\/office\/calls$/);
    await page.goto(`/office/calls/${reqA}`);
    await expect(page.getByRole("heading", { level: 1, name: customer })).toBeVisible();
    await expect(page.locator("#visit-1")).toContainText("משך כולל 45 דק׳");
    await expect(page.locator("#visit-1")).toContainText("הוחלף האטם הפנימי");
    await expect(page.getByRole("link", { name: "התקשר ללקוח" })).toBeVisible();
    await expect(page.getByRole("link", { name: "התקשר לטכנאי" })).toHaveCount(0);
    await context.close();
  });

  test("Technician: no call card (server-side denial), and RLS gives his session no call and no field times (D68)", async ({ browser }) => {
    const users = seeded();
    const { context, page } = await signedIn(browser, users.tech, /\/tech$/);
    await page.goto(`/office/calls/${reqA}`);
    await expect(page).toHaveURL(/\/login\?state=no-access$/);
    await context.close();
    // Even with an office role claimed in code, his own session reads nothing: the card is null.
    const tech = await signedInClient(users.tech.email, users.tech.password);
    expect(await callCardOf(tech, { role: "mgr" }, reqA)).toBeNull();
    const times = await tech.from("visit_time_current").select("visit_id").eq("visit_id", visit1);
    expect(times.error).toBeNull();
    expect(times.data).toEqual([]);
    // Anonymous: to /login.
    const anonymous = await browser.newContext({ locale: "he-IL" });
    const anon = await anonymous.newPage();
    await anon.goto(`/office/calls/${reqA}`);
    await expect(anon).toHaveURL(/\/login$/);
    await anonymous.close();
  });

  test("test-data marking: the call, its visits and time reports are test-marked by the database (D47)", () => {
    expect(localSqlValue(`select is_test::text || ' ' || data_source from public.service_calls where request_number = '${reqA}'`)).toBe("true simulator");
    expect(localSqlValue(`select count(*) filter (where not v.is_test) from public.visits v join public.service_calls c on c.id = v.service_call_id where c.request_number = '${reqA}'`)).toBe("0");
    expect(localSqlValue(`select count(*) || ' ' || count(*) filter (where is_test) from public.visit_time_reports where visit_id = '${visit1}'`)).toBe("3 3");
  });

  test.describe("with the Creator (matrix keys)", () => {
    test.skip(!creator(), "needs the local Creator: node tests/auth/run-local.mjs --with-creator");

    test("an office user whose role reads no calls (`cal` and `calls` off): RLS hides the call, the page is 404; `card` off hides the report", async ({ browser }) => {
      const c = creator()!;
      const db = await signedInClient(c.email, c.password);
      const set = async (key: string, allowed: boolean) => {
        const version = Number(localSqlValue(`select version from public.role_permissions where role = 'customer_service' and permission_key = '${key}'`));
        const { error } = await db.rpc("admin_set_role_permission", {
          p_role: "customer_service",
          p_key: key,
          p_allowed: allowed,
          p_expected_version: version,
          p_reason: "office call-card test (local stack)",
        });
        expect(error).toBeNull();
      };
      const users = seeded();
      try {
        await set("card", false);
        const cs = await signedIn(browser, users.cs, /\/office\/calls$/);
        await cs.page.goto(`/office/calls/${reqA}`);
        await expect(cs.page.locator("#visit-1")).toContainText("משך כולל 45 דק׳");
        await expect(cs.page.locator("#visit-1")).not.toContainText("הוחלף האטם הפנימי");
        await set("cal", false);
        await set("calls", false);
        const client = await signedInClient(users.cs.email, users.cs.password);
        expect(await callCardOf(client, { role: "cs" }, reqA)).toBeNull();
        expect((await cs.page.goto(`/office/calls/${reqA}`))?.status()).toBe(404);
        await cs.context.close();
      } finally {
        await set("card", true);
        await set("cal", true);
        await set("calls", true);
      }
    });
  });

  test("screenshots at 390 and 1440 (on demand)", async ({ browser }) => {
    test.skip(!process.env.SCREENSHOTS, "screenshots are taken on demand only");
    for (const width of [390, 1440]) {
      const { context, page } = await signedIn(browser, seeded().mgr, /\/office$/, width);
      await page.goto(`/office/calls/${reqA}`);
      await expect(page.getByRole("heading", { level: 1, name: customer })).toBeVisible();
      await ready(page);
      const png = path.join(OUT, `${width}-call-card.png`);
      await page.screenshot({ path: png, fullPage: true });
      execFileSync("convert", [png, "-quality", "80", png.replace(/\.png$/, ".webp")]);
      execFileSync("rm", [png]);
      await context.close();
    }
  });
});
