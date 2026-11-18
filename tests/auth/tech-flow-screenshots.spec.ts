import path from "node:path";
import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { jerusalemToday } from "@/features/visits/data/today";
import { localSql, seeded, signInAs } from "./helpers";
import { shoot } from "./shots";
import { attendeeOf, ensurePickupPlace, ingestVisit, signedInClient, type FictionalVisit } from "./tech-fixtures";

// On demand only (SCREENSHOTS=1): the review images of the real visit flow (Step 4, Version 1;
// D62 (6): every state at 390, 820 and 1440 px), from a local production build signed in to the
// LOCAL stack with Migration 7 (tests/auth/run-local.mjs). Fictional, test-marked data only (D47).
//   SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/tech-flow-screenshots.spec.ts
const OUT = path.resolve("docs/review/tech-visit-flow");
const today = jerusalemToday();
const PLACE = "מרכז לוגיסטי ראשון לציון";
// A small coloured PNG (the "photo"); the browser re-encodes it as JPEG.
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAKAAAAB4CAIAAAD6wG44AAADKUlEQVR42u2cW08TQRiGZ4g/y2vPRm+AnsuKicGonDTaGEIC8Sw9Ck2TIqVCKcUQwJ7wz+FF4wYJqKF7mG/yPJmLXpTu5nvn6bfMbkdffdVSYC9XNDWwPGB9QhUwGDAYMBgwGDAYMBgwGIMBgwGDAYMBgwGDAYMxGDAYMBgwGDAYMBgwGDAYgwGDAYMBgwGDAYPPUng4+vc3TFf3MFgY+X+FetEMmLEubNsMzk2ODT8zZtdbGGwW2eFyvWiWzMlP2gaDVx6M+zdv5r/uYnBofPYt2jOz57nYmAUb/MmJBDmTXmw0JVZpRCslcQSZrjufJBZKpMEfJqKhHPejE3lZ28Fgf0dY6bpzC4N95F06Fvo5vJ+IZjYbGOz9MCFdd55hsMe8ScWNOp+36djr+jYGezNMS9edcxhsOeZXT4DBy8mEseVbTiYMr96I1icmjyWD0x2wlEyYXECe6PDii5q1aDoxPficsRhPiQh4MZ7iKhqJMfjPsRBLCwp4IZbGYCQO5SKLZKy+lsZgyw02tAdnIo64gDMRhx6MxPRg2jA9GIMxGIMxGIMBgwGDMRiDMRiDMfiSGPpMVmm/Ii7d0n6FZ7LQlx5MA6YHY7ANBpcPylP3p6SkWz4oa60wGH0x+BSVw7VH9x6bn27lcE1rYwPGPnv15Sra5uvn3wsdZv84rnq0ani61aNVfh88FOs/vkzefWLsuWmzmxw92NruK6kHb7RLzp2nBp6VNj5hMbvs1NolowpXa5fYZcdjNjvF9O1nhpyJFtLbhO10V+8UQy9ZvVNkpzsf+dYtJG9Nh3h0Leq6VORus1vdQijF2uoW2G02ILZ7+fjNmYCPqAX+Tyl1v2itVKOXD6xMjV5eaJVkr0Xv9HNKqeiNWb8PocWuBwk22B3Nfs6n6jT7OenFseRu0u5xdvBi/Pqch5+m5S/k2rYW3TrOKqXGLhvz4M9tqomd94P3fq64r0evzf//m7V1917sv5v0/VR+52J3BXiiw3K4H2x9wBiMwYDBgMGAwYDBgMGAwRgMGAwYDBgMGAwYDBiMwYDBgMGAwYDBgMGAwYDBGAwYDBgMYfELlTit+DIYTy8AAAAASUVORK5CYII=",
  "base64",
);

test.skip(!process.env.SCREENSHOTS, "screenshots are taken on demand only");

const visitOf = (customer: string, extra: Partial<FictionalVisit> = {}): FictionalVisit => ({
  req: String(randomInt(40000, 99999)),
  customerNo: String(randomInt(100000, 999999)),
  customer,
  phone: "050-123-4567",
  city: "רחובות",
  street: "הרצל 14",
  product: "מדיח כלים Bosch",
  sku: "dw-6040",
  desc: "המדיח לא מנקז מים בסוף התוכנית",
  warranty: "לא",
  ...extra,
});

async function draw(page: Page) {
  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error("no pad");
  await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await page.mouse.down();
  for (const [x, y] of [[0.2, 0.3], [0.35, 0.7], [0.5, 0.25], [0.65, 0.65], [0.8, 0.35]] as const) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 6 });
  }
  await page.mouse.up();
}

test("the visit flow: review screenshots", async ({ page }) => {
  test.setTimeout(300_000);
  await page.context().route(/^https:\/\/waze\.com\//, (route) => route.abort());
  localSql(`insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('visit-media', 'visit-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']) on conflict (id) do nothing;`);
  const { tech, mgr } = seeded();
  const office = await signedInClient(mgr.email, mgr.password);
  ensurePickupPlace(PLACE, "המדע 6, ראשון לציון");
  const attendee = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
  const levi = await ingestVisit(office, attendee, today, "08:30", "10:00", visitOf("משפחת לוי", { collect: "משאבת ניקוז", collectFrom: PLACE, techNote: "להתקשר חצי שעה לפני ההגעה" }));
  const cohen = await ingestVisit(office, attendee, today, "11:00", "12:30", visitOf("משפחת כהן", { city: "נס ציונה", street: "ויצמן 3", product: "תנור בילט-אין Electra", sku: "ov-2210", warranty: "כן · עד 03/2028", desc: "התנור לא מתחמם" }));

  await signInAs(page, tech, /\/tech$/);
  await shoot(page, OUT, "home-before");
  await page.goto(`/tech/visit/${levi}`);
  await shoot(page, OUT, "card-scheduled", { bottom: true });

  const popup = page.waitForEvent("popup");
  await page.locator(".ph-foot").getByRole("link", { name: /^יוצא · Waze/ }).click();
  await (await popup).close();
  await expect(page.getByRole("button", { name: "הגעתי · התחלת טיפול" })).toBeVisible();
  await shoot(page, OUT, "card-en-route");
  await page.goto("/tech");
  await shoot(page, OUT, "home-en-route");

  await page.goto(`/tech/visit/${levi}`);
  await page.getByRole("button", { name: "הגעתי · התחלת טיפול" }).click();
  await expect(page).toHaveURL(/\/work$/);
  await shoot(page, OUT, "work-empty");
  await page.getByLabel("צילום לפני הטיפול").setInputFiles({ name: "before.png", mimeType: "image/png", buffer: PHOTO });
  await page.getByLabel("צילום אחרי הטיפול").setInputFiles({ name: "after.png", mimeType: "image/png", buffer: PHOTO });
  await expect(page.getByRole("img", { name: /תמונה 1 אחרי הטיפול/ })).toBeVisible();
  await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill("הוחלפה משאבת הניקוז. נבדקה תוכנית מלאה והמדיח מנקז כראוי.");
  await shoot(page, OUT, "work-ready", { bottom: true });

  await page.getByRole("link", { name: "סיום ביקור ›" }).click();
  await expect(page).toHaveURL(/\/close$/);
  await shoot(page, OUT, "close-choose");
  await page.getByRole("button", { name: /✓ טופל/ }).click();
  await shoot(page, OUT, "close-done-missing", { bottom: true });
  await page.getByLabel("שם החותם").fill("דוד לוי");
  await draw(page);
  await shoot(page, OUT, "close-done-signed", { bottom: true });
  await page.locator(".ph-foot .bigbtn").click();
  await expect(page.getByRole("heading", { name: "סיום הביקור · ✓ טופל" })).toBeVisible();
  await shoot(page, OUT, "close-done-confirmation");

  await page.getByRole("link", { name: "חזרה להיום ›" }).click();
  await expect(page.locator(".stat").nth(1)).toContainText("1");
  await shoot(page, OUT, "home-after-done");
  await page.goto(`/tech/visit/${levi}`);
  await shoot(page, OUT, "card-closed-readonly", { bottom: true });

  // "המשך טיפול" on the second visit.
  await page.goto(`/tech/visit/${cohen}`);
  const popup2 = page.waitForEvent("popup");
  await page.locator(".ph-foot").getByRole("link", { name: /^יוצא · Waze/ }).click();
  await (await popup2).close();
  await page.getByRole("button", { name: "הגעתי · התחלת טיפול" }).click();
  await expect(page).toHaveURL(/\/work$/);
  await page.getByLabel("צילום אחרי הטיפול").setInputFiles({ name: "after.png", mimeType: "image/png", buffer: PHOTO });
  await expect(page.getByRole("img", { name: /תמונה 1 אחרי הטיפול/ })).toBeVisible();
  await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill("גוף החימום העליון פגום. נדרש חלק חלופי.");
  await page.getByRole("link", { name: "סיום ביקור ›" }).click();
  await page.getByRole("button", { name: /↻ המשך טיפול/ }).click();
  await shoot(page, OUT, "close-followup-missing", { bottom: true });
  await page.getByRole("button", { name: "ממתין לחלקי חילוף" }).click();
  await page.getByLabel("מה צריך בביקור הבא").fill("להביא גוף חימום עליון חדש ולתאם עם הלקוח");
  await shoot(page, OUT, "close-followup-ready", { bottom: true });
  await page.locator(".ph-foot .bigbtn").click();
  await expect(page.getByRole("heading", { name: "סיום הביקור · ↻ המשך טיפול" })).toBeVisible();
  await shoot(page, OUT, "close-followup-confirmation");
  await page.getByRole("link", { name: "חזרה להיום ›" }).click();
  await expect(page.getByRole("region", { name: "הביקור הבא" })).toContainText("כל הביקורים של היום הושלמו");
  await shoot(page, OUT, "home-day-complete");
  await page.goto("/tech/done");
  await shoot(page, OUT, "done-list");
});
