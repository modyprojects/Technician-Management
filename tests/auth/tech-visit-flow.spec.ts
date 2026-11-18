import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { jerusalemToday } from "@/features/visits/data/today";
import { localSql, localSqlValue, seeded, signInAs } from "./helpers";
import { attendeeOf, ingestVisit, signedInClient } from "./tech-fixtures";

// Step 4 (Version 1), the visit flow against the LOCAL stack with Migration 7 (tests/auth/run-local.mjs),
// through the real sign-in and the real pages of a production build: "יוצא · Waze", "הגעתי",
// photos, the written summary, the closure as "טופל" (signature on the canvas) and as "המשך טיפול",
// the confirmation screen with "חזרה להיום", and the home derived from the server afterwards (QA
// T-02, T-03, T-09). Visits come from the invitation simulator's ingestion service (Manager's
// session); every record is fictional and test-marked (D47). The private bucket 'visit-media' is
// created locally here (on a project it is a separately approved operation). Negative cases at the
// database boundary (the Technician's own session through the publishable key): another
// technician, office roles, the order of the statuses, and a closed visit.

const run = randomBytes(3).toString("hex");
const today = jerusalemToday();
// A 1x1 PNG: the browser re-encodes it as the JPEG it uploads (D13).
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const doneVisit = { req: `F1-${run}`, customerNo: `FC1-${run}`, customer: "משפחת אברהם בדיקה", phone: "050-111-2233", city: "רחובות", street: "הרצל 20", product: "מדיח בדיקה", sku: `fdw-${run}`, desc: "לא מנקז" };
const followVisit = { req: `F2-${run}`, customerNo: `FC2-${run}`, customer: "משפחת יצחק בדיקה", phone: "052-444-5566", city: "רמלה", street: "הנביאים 4", product: "תנור בדיקה", sku: `fov-${run}`, desc: "לא מתחמם" };
const otherVisit = { req: `F3-${run}`, customerNo: `FC3-${run}`, customer: "משפחת זר זרימה", phone: "053-777-8899", city: "לוד", street: "הנשיא 2", product: "מקרר בדיקה", sku: `ffr-${run}`, desc: "רעש" };
const ids: { done?: string; follow?: string; other?: string } = {};

const device = () => ({ p_reported_at: new Date().toISOString(), p_device_tz: "Asia/Jerusalem", p_device_utc_offset_min: 120, p_device_sent_at: new Date().toISOString() });
const rpcDepart = (id: string, op: string, fv: number) => ({ p_visit_id: id, p_operation_id: op, p_expected_field_version: fv, ...device() });

async function blockWaze(page: Page) {
  await page.context().route(/^https:\/\/waze\.com\//, (route) => route.abort());
}

async function signAndPhoto(page: Page, id: string, summary: string) {
  await page.goto(`/tech/visit/${id}/work`);
  await expect(page.getByRole("button", { name: "סיום ביקור ›" })).toBeDisabled();
  await expect(page.locator(".ph-foot")).toContainText("חסרים: תמונה אחרי הטיפול וסיכום");
  await page.getByLabel("צילום אחרי הטיפול").setInputFiles({ name: "after.png", mimeType: "image/png", buffer: PNG_1X1 });
  await expect(page.getByRole("img", { name: /תמונה 1 אחרי הטיפול/ })).toBeVisible();
  await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill(summary);
  await expect(page.locator(".ph-foot")).toContainText("אפשר לסיים את הביקור");
  await page.getByRole("link", { name: "סיום ביקור ›" }).click();
  await expect(page).toHaveURL(new RegExp(`/tech/visit/${id}/close$`));
}

test.describe.serial("the visit flow (Step 4, Migration 7, local stack)", () => {
  test("setup: the bucket and today's visits through the invitation simulator", async () => {
    localSql(`insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('visit-media', 'visit-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']) on conflict (id) do nothing;`);
    const { mgr } = seeded();
    const office = await signedInClient(mgr.email, mgr.password);
    const me = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
    const them = await attendeeOf(office, process.env.AUTH_E2E_TECH2_ROW ?? "");
    ids.done = await ingestVisit(office, me, today, "08:00", "09:00", doneVisit);
    ids.follow = await ingestVisit(office, me, today, "13:00", "14:00", followVisit);
    ids.other = await ingestVisit(office, them, today, "10:00", "11:00", otherVisit);
  });

  test("the database refuses what the screens never offer: order, another technician, office roles", async () => {
    const { tech, tech2, mgr, cs } = seeded();
    const mine = await signedInClient(tech.email, tech.password);
    const arriveFirst = await mine.rpc("arrive_visit", rpcDepart(ids.done!, crypto.randomUUID(), 1));
    expect(arriveFirst.error?.code).toBe("55000");
    const theirs = await signedInClient(tech2.email, tech2.password);
    expect((await theirs.rpc("depart_visit", rpcDepart(ids.done!, crypto.randomUUID(), 1))).error?.code).toBe("42501");
    for (const office of [mgr, cs]) {
      const client = await signedInClient(office.email, office.password);
      expect((await client.rpc("depart_visit", rpcDepart(ids.other!, crypto.randomUUID(), 1))).error?.code).toBe("42501");
    }
    // Nothing changed.
    expect(localSqlValue(`select string_agg(status, ',' order by visit_number) from public.visits where id in ('${ids.done}', '${ids.other}')`)).toBe("scheduled,scheduled");
  });

  test("'יוצא · Waze' on the home records the departure and opens Waze", async ({ page }) => {
    const { tech } = seeded();
    await blockWaze(page);
    await signInAs(page, tech, /\/tech$/);
    const next = page.getByRole("region", { name: "הביקור הבא" });
    await expect(next).toContainText(doneVisit.customer);
    const link = next.getByRole("link", { name: /^יוצא · Waze/ });
    await expect(link).toHaveAttribute("href", /^https:\/\/waze\.com\/ul\?q=/);
    const popup = page.waitForEvent("popup");
    await link.click();
    await (await popup).close();
    await expect(next).toContainText("בדרך");
    expect(localSqlValue(`select status || ' ' || (select count(*) from public.visit_time_reports r where r.visit_id = v.id and r.kind = 'departed') from public.visits v where v.id = '${ids.done}'`)).toBe("en_route 1");
  });

  test("'הגעתי' opens the work screen; the closure needs its fields; 'טופל' with the signature, sent once", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    await page.goto(`/tech/visit/${ids.done}`);
    await page.getByRole("button", { name: "הגעתי · התחלת טיפול" }).click();
    await expect(page).toHaveURL(new RegExp(`/tech/visit/${ids.done}/work$`));
    await signAndPhoto(page, ids.done!, "הוחלפה משאבת ניקוז ונבדקה");
    // T-09: what is missing is listed; the button stays locked.
    const send = page.locator(".ph-foot .bigbtn");
    await expect(send).toHaveText("בחר תוצאה");
    await page.getByRole("button", { name: /✓ טופל/ }).click();
    await expect(send).toBeDisabled();
    await expect(page.locator(".ph-foot")).toContainText("חסרים: שם החותם וחתימת הלקוח");
    await expect(page.getByText("קריאת השירות טופלה לשביעות רצון הלקוח")).toBeVisible();
    await page.getByLabel("שם החותם").fill("אברהם אבינו");
    await expect(page.locator(".ph-foot")).toContainText("חסר: חתימת הלקוח");
    const pad = page.locator("canvas");
    const box = await pad.boundingBox();
    if (!box) throw new Error("no signature pad");
    await page.mouse.move(box.x + 20, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 60, { steps: 8 });
    await page.mouse.move(box.x + 200, box.y + 25, { steps: 8 });
    await page.mouse.up();
    await expect(send).toHaveText("שליחה · הקריאה טופלה");
    await expect(send).toBeEnabled();
    // A double click sends once (the button locks; the server would replay or refuse a second).
    await send.dblclick();
    await expect(page.getByRole("heading", { name: "סיום הביקור · ✓ טופל" })).toBeVisible();
    await expect(page.getByText("הביקור נסגר ונשמר בשרת.")).toBeVisible();
    await expect(page.getByRole("link", { name: "חזרה להיום ›" })).toBeVisible();
    // No automatic navigation (QA T-09).
    await expect(page).toHaveURL(new RegExp(`/tech/visit/${ids.done}/close$`));
    expect(
      localSqlValue(`select v.status || ' ' || c.status || ' sig:' || (select count(*) from public.visit_signatures s where s.visit_id = v.id and s.signer_name = 'אברהם אבינו' and s.signature_media_id is not null)
        || ' rep:' || (select count(*) from public.visit_reports r where r.visit_id = v.id) || ' done-events:' || (select count(*) from public.visit_events e where e.visit_id = v.id and e.to_status = 'done')
        || ' media:' || (select string_agg(m.kind || '/' || m.state, ',' order by m.kind) from public.visit_media m where m.visit_id = v.id)
        from public.visits v join public.service_calls c on c.id = v.service_call_id where v.id = '${ids.done}'`),
    ).toBe("done resolved sig:1 rep:1 done-events:1 media:photo/stored,signature/stored");
    await page.getByRole("link", { name: "חזרה להיום ›" }).click();
    await expect(page).toHaveURL(/\/tech$/);
    // T-02: the closed visit moved to "הושלמו היום"; the counters follow the server.
    await expect(page.locator(".stat").nth(0)).toContainText("1");
    await expect(page.locator(".stat").nth(1)).toContainText("1");
    await expect(page.getByRole("region", { name: "הביקור הבא" })).toContainText(followVisit.customer);
    await expect(page.getByRole("region", { name: 'לו"ז היום' })).toContainText(`הושלמו היום: ${doneVisit.customer}`);
  });

  test("a closed visit is read-only to the technician (screen and database)", async ({ page }) => {
    const { tech } = seeded();
    await signInAs(page, tech, /\/tech$/);
    await page.goto(`/tech/visit/${ids.done}`);
    await expect(page.getByText("🔒 הביקור נסגר בשרת")).toBeVisible();
    await expect(page.getByRole("region", { name: "אישור הלקוח" })).toContainText("קריאת השירות טופלה לשביעות רצון הלקוח");
    await expect(page.getByRole("region", { name: "אישור הלקוח" })).toContainText("נחתם ע\"י אברהם אבינו");
    await expect(page.getByRole("button")).toHaveCount(0);
    // The work and close addresses go back to the read-only card.
    await page.goto(`/tech/visit/${ids.done}/work`);
    await expect(page).toHaveURL(new RegExp(`/tech/visit/${ids.done}$`));
    const mine = await signedInClient(tech.email, tech.password);
    const fv = Number(localSqlValue(`select field_version from public.visits where id = '${ids.done}'`));
    expect((await mine.rpc("depart_visit", rpcDepart(ids.done!, crypto.randomUUID(), fv))).error?.code).toBe("55000");
    expect((await mine.rpc("arrive_visit", rpcDepart(ids.done!, crypto.randomUUID(), fv))).error?.code).toBe("55000");
  });

  test("'המשך טיפול': reason and next-visit notes; the call stays open for follow-up; the day is complete", async ({ page }) => {
    const { tech } = seeded();
    await blockWaze(page);
    await signInAs(page, tech, /\/tech$/);
    await page.goto(`/tech/visit/${ids.follow}`);
    const popup = page.waitForEvent("popup");
    await page.locator(".ph-foot").getByRole("link", { name: /^יוצא · Waze/ }).click();
    await (await popup).close();
    await expect(page.getByRole("button", { name: "הגעתי · התחלת טיפול" })).toBeVisible();
    await page.getByRole("button", { name: "הגעתי · התחלת טיפול" }).click();
    await expect(page).toHaveURL(new RegExp(`/tech/visit/${ids.follow}/work$`));
    await signAndPhoto(page, ids.follow!, "נמצא גוף חימום פגום");
    await page.getByRole("button", { name: /↻ המשך טיפול/ }).click();
    const send = page.locator(".ph-foot .bigbtn");
    await expect(page.locator(".ph-foot")).toContainText("חסרים: סיבה ומה צריך בביקור הבא");
    await page.getByRole("button", { name: "ממתין לחלקי חילוף" }).click();
    await page.getByLabel("מה צריך בביקור הבא").fill("להביא גוף חימום חדש");
    await expect(send).toHaveText("שליחה · המשך טיפול");
    await send.click();
    await expect(page.getByRole("heading", { name: "סיום הביקור · ↻ המשך טיפול" })).toBeVisible();
    expect(
      localSqlValue(`select v.status || ' ' || c.status || ' ' || v.next_visit_notes || ' sig:' || (select count(*) from public.visit_signatures s where s.visit_id = v.id)
        from public.visits v join public.service_calls c on c.id = v.service_call_id where v.id = '${ids.follow}'`),
    ).toBe("followup awaiting_followup להביא גוף חימום חדש sig:0");
    await page.getByRole("link", { name: "חזרה להיום ›" }).click();
    await expect(page.locator(".stat").nth(0)).toContainText("0");
    await expect(page.locator(".stat").nth(1)).toContainText("2");
    await expect(page.getByRole("region", { name: "הביקור הבא" })).toContainText("כל הביקורים של היום הושלמו");
    await page.getByRole("link", { name: /הושלמו/ }).click();
    await expect(page.getByRole("region", { name: "ביקורים שהושלמו היום" }).getByRole("link")).toHaveCount(2);
  });

  test("another technician cannot open the flow of a visit that is not his", async ({ page }) => {
    const { tech2 } = seeded();
    await signInAs(page, tech2, /\/tech$/);
    for (const path of [`/tech/visit/${ids.follow}/work`, `/tech/visit/${ids.follow}/close`, `/tech/visit/${ids.done}`]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      expect(await page.content()).not.toContain(followVisit.customer);
    }
  });
});
