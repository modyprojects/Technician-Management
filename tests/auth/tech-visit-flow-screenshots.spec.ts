import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { jerusalemToday } from "@/features/visits/data/today";
import { localSqlValue, seeded, signInAs } from "./helpers";
import { attendeeOf, ingestVisit, signedInClient } from "./tech-fixtures";

// On demand only (SCREENSHOTS=1): the review images of the visit flow on real data (D95), signed
// in to the LOCAL stack, every record fictional and test-marked (D47). Technician screens at 390 and
// 820 (D70); the office call card's photo section at 390 and 1440 (D72). PNG here; the review set
// is converted to WebP afterwards.
//   SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/tech-visit-flow-screenshots.spec.ts
const OUT = path.resolve(process.env.SHOTS_DIR || "docs/review/tech-visit-flow");
const TECH = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
] as const;
const OFFICE = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

test.skip(!process.env.SCREENSHOTS, "screenshots are taken on demand only");

const run = randomBytes(2).toString("hex");
const today = jerusalemToday();
const device = () => ({ p_reported_at: new Date().toISOString(), p_device_tz: "Asia/Jerusalem", p_device_utc_offset_min: 120, p_device_sent_at: new Date().toISOString() });
const base = { phone: "050-123-4567", product: "מדיח כלים בדיקה", sku: "dw-6040", desc: "המדיח לא מנקז מים בסוף התוכנית", techNote: "להתקשר חצי שעה לפני ההגעה" };

async function ready(page: Page) {
  await page.evaluate(async () => {
    const faces = ["500 16px Rubik", "700 16px Rubik", "400 16px Assistant", "700 16px Assistant"];
    await Promise.all(faces.map((face) => document.fonts.load(face, "אבג")));
    await document.fonts.ready;
  });
}

async function shoot(page: Page, name: string, sizes: readonly { width: number; height: number }[], opts: { bottom?: boolean; locator?: string } = {}) {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await ready(page);
    await page.waitForTimeout(150);
    if (opts.locator) {
      const el = page.locator(opts.locator).first();
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path: path.join(OUT, `${size.width}-${name}.png`) });
      continue;
    }
    await page.evaluate((bottom) => {
      const main = document.querySelector(".ph-main");
      if (main) main.scrollTop = bottom ? main.scrollHeight : 0;
    }, Boolean(opts.bottom));
    await page.screenshot({ path: path.join(OUT, `${size.width}-${name}.png`) });
  }
}

async function photo(page: Page, fill: string) {
  const b64 = await page.evaluate(async (color) => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1200;
    const g = c.getContext("2d");
    if (!g) throw new Error("no canvas");
    const grad = g.createLinearGradient(0, 0, 1600, 1200);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "#e8eef3");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1600, 1200);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b as Blob), "image/jpeg", 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  }, fill);
  return { name: "p.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") };
}

async function sign(page: Page) {
  const box = await page.getByRole("region", { name: "אישור הלקוח" }).locator("canvas").boundingBox();
  if (!box) throw new Error("no pad");
  await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + 20, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height - 20, { steps: 8 });
  await page.mouse.move(box.x + box.width - 30, box.y + 30, { steps: 8 });
  await page.mouse.up();
}

test("visit flow on real data: review screenshots", async ({ page, context }) => {
  test.setTimeout(300_000);
  const { tech, mgr } = seeded();
  const office = await signedInClient(mgr.email, mgr.password);
  const me = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
  const req = (n: number) => `S${n}-${run}`;
  const visit = (n: number, customer: string, street: string, city: string) => ({ ...base, req: req(n), customerNo: `${n}${run}`, customer, street, city });
  const a = await ingestVisit(office, me, today, "08:30", "10:00", visit(1, "משפחת לוי", "הרצל 14", "רחובות"));
  const b = await ingestVisit(office, me, today, "11:00", "12:00", visit(2, "משפחת כהן", "ויצמן 3", "נס ציונה"));
  const c = await ingestVisit(office, me, today, "13:00", "14:00", visit(3, "משפחת מזרחי", "רוטשילד 40", "ראשון לציון"));
  const client = await signedInClient(tech.email, tech.password);
  const fv = (id: string) => Number(localSqlValue(`select field_version from public.visits where id = '${id}'`));
  for (const id of [b, c]) expect((await client.rpc("depart_visit", { p_visit_id: id, p_operation_id: randomUUID(), p_expected_field_version: fv(id), ...device() })).error).toBeNull();

  await context.route(/^https:\/\/waze\.com\//, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "waze" }));
  await page.setViewportSize(TECH[0]);
  await signInAs(page, tech, /\/tech$/);

  // Card: scheduled (no Waze tile), the departure failure (offline), en route (Waze tile).
  await page.goto(`/tech/visit/${a}`);
  await expect(page.getByRole("button", { name: "יוצא · Waze" })).toBeVisible();
  await shoot(page, "01-card-scheduled", TECH);
  await context.setOffline(true);
  await page.getByRole("button", { name: "יוצא · Waze" }).click();
  await expect(page.getByText("פתח Waze בכל זאת ›")).toBeVisible();
  await shoot(page, "02-card-depart-failed", TECH, { bottom: true });
  await context.setOffline(false);
  await page.goto(`/tech/visit/${b}`);
  await expect(page.getByRole("button", { name: "הגעתי · התחלת טיפול" })).toBeVisible();
  await shoot(page, "03-card-en-route", TECH);

  // Work: empty, then with photos and the summary.
  await page.getByRole("button", { name: "הגעתי · התחלת טיפול" }).click();
  await expect(page).toHaveURL(/\?step=work$/);
  await expect(page.getByRole("region", { name: "מצב שליחה" })).toContainText("נשלח לשרת", { timeout: 15_000 });
  await shoot(page, "04-work-empty", TECH);
  await page.getByLabel("הוסף תמונה · לפני הטיפול").setInputFiles(await photo(page, "#5b7f99"));
  await page.getByLabel("הוסף תמונה · אחרי הטיפול").setInputFiles(await photo(page, "#6f9a5b"));
  await page.getByLabel("הוסף תמונה · אחרי הטיפול").setInputFiles(await photo(page, "#9a7f5b"));
  await expect(page.getByRole("img", { name: "תמונה 2 · אחרי הטיפול" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill("נוקה מסנן הניקוז והוחלפה משאבה. נבדקה תוכנית מלאה, המים מתנקזים.");
  await shoot(page, "05-work-ready", TECH);

  // Close: choose, "טופל" with signer and signature, "המשך טיפול" with reason and notes.
  await page.getByRole("button", { name: "סיום ביקור ›" }).click();
  await shoot(page, "06-close-choose", TECH);
  await page.getByRole("button", { name: /המשך טיפול/ }).click();
  await page.getByRole("button", { name: localSqlValue("select label_he from public.followup_reasons where is_active order by sort_order limit 1") }).click();
  await page.getByLabel("מה צריך בביקור הבא").fill("להביא משאבת ניקוז חלופית");
  await shoot(page, "07-close-cont", TECH, { bottom: true });
  await page.getByRole("button", { name: /טופל/ }).click();
  await page.getByLabel("שם החותם").fill("רונית לוי");
  await sign(page);
  await shoot(page, "08-close-done", TECH, { bottom: true });

  // Sent without a connection: kept on the phone, the message and "שלח שוב" (D95 as corrected 22.11).
  await context.setOffline(true);
  await page.getByRole("button", { name: "שליחה · הקריאה טופלה" }).click();
  await expect(page.getByText("הביקור נשמר · ✓ טופל")).toBeVisible();
  await expect(page.getByRole("region", { name: "מצב שליחה" })).toContainText("אין חיבור, הסגירה לא נשלחה", { timeout: 15_000 });
  await shoot(page, "09-close-not-sent", TECH);
  await context.setOffline(false);
  await page.goto("/tech");
  await expect(page.getByText("לא נשלח").first()).toBeVisible();
  await shoot(page, "13-home-not-sent", TECH);
  await page.goto(`/tech/visit/${b}`);
  await page.getByRole("button", { name: "שלח שוב" }).click();
  await expect(page.getByText("הביקור נסגר · לצפייה בלבד")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText("הביקור נסגר · לצפייה בלבד")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shoot(page, "10-closed-done", TECH);
  await shoot(page, "10-closed-done-bottom", TECH, { bottom: true });

  // A follow-up closure, closed view.
  await page.goto(`/tech/visit/${c}`);
  await page.getByRole("button", { name: "הגעתי · התחלת טיפול" }).click();
  await page.getByLabel("הוסף תמונה · אחרי הטיפול").setInputFiles(await photo(page, "#7a6f9a"));
  await expect(page.getByRole("img", { name: "תמונה 1 · אחרי הטיפול" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill("המשאבה תקינה, נמצאה דליפה בצינור הניקוז.");
  await page.getByRole("button", { name: "סיום ביקור ›" }).click();
  await page.getByRole("button", { name: /המשך טיפול/ }).click();
  await page.getByRole("button", { name: localSqlValue("select label_he from public.followup_reasons where is_active order by sort_order limit 1") }).click();
  await page.getByLabel("מה צריך בביקור הבא").fill("להביא צינור ניקוז 2 מטר");
  await page.getByRole("button", { name: "שליחה · המשך טיפול" }).click();
  await expect(page.getByText("הביקור נסגר · לצפייה בלבד")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await shoot(page, "11-closed-cont", TECH);

  // Office call card: the photo section (Manager).
  await context.clearCookies();
  await page.setViewportSize(OFFICE[1]);
  await signInAs(page, mgr, /\/office$/);
  await page.goto(`/office/calls/${req(2)}`);
  await expect(page.getByRole("list", { name: "תמונות · אחרי הטיפול" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  for (const size of OFFICE) {
    await page.setViewportSize(size);
    await ready(page);
    const section = page.getByRole("list", { name: "תמונות · לפני הטיפול" }).locator("xpath=ancestor::article[1]");
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: path.join(OUT, `${size.width}-12-office-call-photos.png`) });
  }
});
