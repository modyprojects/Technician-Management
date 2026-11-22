import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jerusalemToday } from "@/features/visits/data/today";
import { APPROVAL_TEXT_V1, sha256Hex } from "@/features/visit-flow/rules";
import { localSqlValue, seeded, signInAs } from "./helpers";
import { attendeeOf, ingestVisit, signedInClient } from "./tech-fixtures";

// The technician visit flow on real data (D95), against the LOCAL stack (tests/auth/run-local.mjs),
// through the real sign-in and the real pages of a production build:
//   node tests/auth/run-local.mjs tests/auth/tech-visit-flow.spec.ts
// Visits come from the invitation simulator's single ingestion service under the Manager's own
// session; every record is fictional and test-marked by the database (D47; media under test/).
// Every assertion searches this run's own uniquely named records (the stack is shared).
// Covers: "יוצא · Waze" records first and the Waze tile appears only after it (D71, D95 (e));
// "הגעתי", the photos (compressed on the device, D95 (h)), the summary and "טופל" with signer and
// signature, or "המשך טיפול" with reason and notes; without a connection "הגעתי" + closure kept on
// the phone across a reload, never sent on their own, sent once by "שלח שוב" (D95 (d) as corrected
// 22.11), with the "לא נשלח" marker on the card and on "היום"; the closed visit read-only with its
// photos; the office call card's photos as short-lived signed links (D92 (2), D95 (f)); and the
// refusals: another technician's visit, office roles calling the writers, "טופל" without signer or
// signature, "המשך טיפול" without reason.

const run = randomBytes(3).toString("hex");
const today = jerusalemToday();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const base = { phone: "050-555-0101", city: "חיפה", product: "מכונת כביסה בדיקה", desc: "לא סוחטת" };
const V = {
  done: { ...base, req: `VF1-${run}`, customerNo: `VC1-${run}`, customer: `זרימה טופל ${run}`, street: "הנמל 1", sku: `vf1-${run}` },
  cont: { ...base, req: `VF2-${run}`, customerNo: `VC2-${run}`, customer: `זרימה המשך ${run}`, street: "הנמל 2", sku: `vf2-${run}` },
  offline: { ...base, req: `VF3-${run}`, customerNo: `VC3-${run}`, customer: `זרימה לא מקוון ${run}`, street: "הנמל 3", sku: `vf3-${run}` },
  refuse: { ...base, req: `VF4-${run}`, customerNo: `VC4-${run}`, customer: `זרימה סירוב ${run}`, street: "הנמל 4", sku: `vf4-${run}` },
  other: { ...base, req: `VF5-${run}`, customerNo: `VC5-${run}`, customer: `זרימה טכנאי אחר ${run}`, street: "הנמל 5", sku: `vf5-${run}` },
};
const ids: Partial<Record<keyof typeof V, string>> = {};
const idOf = (k: keyof typeof V): string => {
  const id = ids[k];
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new Error(`no visit ${k}`);
  return id;
};
const sqlOf = (q: string) => localSqlValue(q);
const statusOf = (k: keyof typeof V) => sqlOf(`select status from public.visits where id = '${idOf(k)}'`);

const device = () => ({ p_reported_at: new Date().toISOString(), p_device_tz: "Asia/Jerusalem", p_device_utc_offset_min: 120, p_device_sent_at: new Date().toISOString() });
const fieldVersion = (k: keyof typeof V) => Number(sqlOf(`select field_version from public.visits where id = '${idOf(k)}'`));

/** A JPEG made in the browser (2400×1800, bigger than the stored long edge). */
async function photo(page: Page, color: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const b64 = await page.evaluate(async (fill) => {
    const c = document.createElement("canvas");
    c.width = 2400;
    c.height = 1800;
    const g = c.getContext("2d");
    if (!g) throw new Error("no canvas");
    g.fillStyle = fill;
    g.fillRect(0, 0, 2400, 1800);
    g.fillStyle = "#fff";
    g.fillRect(200, 200, 800, 400);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b as Blob), "image/jpeg", 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  }, color);
  return { name: `photo-${color.slice(1)}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") };
}

async function sign(page: Page) {
  const pad = page.getByRole("region", { name: "אישור הלקוח" }).locator("canvas");
  const box = await pad.boundingBox();
  if (!box) throw new Error("no signature pad");
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 15, { steps: 6 });
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 15, { steps: 6 });
  await page.mouse.up();
}

/** From the work screen: one photo per phase, the summary, then "סיום ביקור ›". */
async function doWork(page: Page, summary: string) {
  await expect(page).toHaveURL(/\?step=work$/);
  await page.getByLabel("הוסף תמונה · לפני הטיפול").setInputFiles(await photo(page, "#336699"));
  await expect(page.getByRole("img", { name: "תמונה 1 · לפני הטיפול" })).toBeVisible({ timeout: 15_000 });
  const finish = page.getByRole("button", { name: "סיום ביקור ›" });
  await expect(finish).toBeDisabled();
  await expect(page.getByText("חסר: תמונה אחרי הטיפול · סיכום הטיפול")).toBeVisible();
  await page.getByLabel("הוסף תמונה · אחרי הטיפול").setInputFiles(await photo(page, "#669933"));
  await expect(page.getByRole("img", { name: "תמונה 1 · אחרי הטיפול" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill(summary);
  await expect(finish).toBeEnabled();
  await finish.click();
  await expect(page).toHaveURL(/\?step=close$/);
}

let office: SupabaseClient;

test.describe.serial("technician visit flow (D95, local stack)", () => {
  test("setup: visits through the invitation simulator (Manager session)", async () => {
    const { mgr } = seeded();
    office = await signedInClient(mgr.email, mgr.password);
    const me = await attendeeOf(office, process.env.AUTH_E2E_TECH_ROW ?? "");
    const them = await attendeeOf(office, process.env.AUTH_E2E_TECH2_ROW ?? "");
    ids.done = await ingestVisit(office, me, today, "07:00", "07:30", V.done);
    ids.cont = await ingestVisit(office, me, today, "07:30", "08:00", V.cont);
    ids.offline = await ingestVisit(office, me, today, "08:00", "08:30", V.offline);
    ids.refuse = await ingestVisit(office, me, today, "08:30", "09:00", V.refuse);
    ids.other = await ingestVisit(office, them, today, "09:00", "09:30", V.other);
    for (const k of Object.keys(V) as (keyof typeof V)[]) expect(sqlOf(`select is_test from public.visits where id = '${idOf(k)}'`)).toBe("t");
  });

  test("טופל online: depart records first, Waze tile after it; arrive, photos, summary, signature; closed read-only", async ({ page, context }) => {
    test.setTimeout(120_000);
    const { tech } = seeded();
    await context.route(/^https:\/\/waze\.com\//, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>waze</title>" }));
    await signInAs(page, tech, /\/tech$/);
    await page.goto(`/tech/visit/${idOf("done")}`);
    const tiles = page.getByRole("group", { name: "ניווט ויצירת קשר" });
    await expect(tiles.getByRole("link", { name: /^Waze/ })).toHaveCount(0);
    const popup = context.waitForEvent("page");
    await page.getByRole("button", { name: "יוצא · Waze" }).click();
    const waze = await popup;
    await expect(waze).toHaveURL(/^https:\/\/waze\.com\/ul\?q=.+&navigate=yes$/);
    await waze.close();
    expect(statusOf("done")).toBe("en_route");
    await expect(page.locator(".ph-head")).toContainText("בדרך");
    await expect(tiles.getByRole("link", { name: /^Waze · ניווט אל/ })).toBeVisible();

    await page.getByRole("button", { name: "הגעתי · התחלת טיפול" }).click();
    await doWork(page, `הוחלף מסנן ${run}`);
    await expect.poll(() => statusOf("done"), { timeout: 15_000 }).toBe("in_progress");

    const send = page.getByRole("button", { name: "בחר תוצאה" });
    await expect(send).toBeDisabled();
    await page.getByRole("button", { name: /טופל/ }).click();
    await expect(page.getByText(`"${APPROVAL_TEXT_V1}"`)).toBeVisible();
    await page.getByLabel("שם החותם").fill("לקוח בדיקה");
    await expect(page.getByText("חסר: חתימת הלקוח")).toBeVisible();
    await sign(page);
    await page.getByRole("button", { name: "שליחה · הקריאה טופלה" }).click();
    await expect(page.getByText("הביקור נסגר · לצפייה בלבד")).toBeVisible({ timeout: 30_000 });
    expect(statusOf("done")).toBe("done");

    // Stored on the server: 2 photos and the PNG signature under test/, each compressed photo ≤ 2 MiB.
    const rows = sqlOf(`select kind || ':' || coalesce(phase, '-') || ':' || mime_type || ':' || state || ':' || (storage_path like 'test/%') || ':' || (size_bytes <= 2097152)
      from public.visit_media where visit_id = '${idOf("done")}' order by kind, phase`).split("\n");
    expect(rows).toEqual(["photo:after:image/jpeg:stored:true:true", "photo:before:image/jpeg:stored:true:true", "signature:-:image/png:stored:true:true"]);
    expect(sqlOf(`select signer_name || '|' || signed_ack_text from public.visit_signatures where visit_id = '${idOf("done")}'`)).toBe(`לקוח בדיקה|${APPROVAL_TEXT_V1}`);
    expect(sqlOf(`select summary_text from public.visit_reports where visit_id = '${idOf("done")}'`)).toBe(`הוחלף מסנן ${run}`);

    // Read-only with the photos as signed links; the long edge was reduced on the device (≤ 1920).
    await page.reload();
    await expect(page.getByText("הביקור נסגר · לצפייה בלבד")).toBeVisible();
    await expect(page.getByText("חתם/ה: לקוח בדיקה")).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(0);
    const tile = page.getByRole("region", { name: "אחרי הטיפול" }).locator(".thumb").first();
    const bg = await tile.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain("/storage/v1/object/sign/visit-media/test/");
    const width = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return Math.max(img.naturalWidth, img.naturalHeight);
    }, bg.slice(5, -2));
    expect(width).toBe(1920);
    // Recorded times are never shown to the technician (D68).
    expect(await page.content()).not.toMatch(/יציאה|הגעה בשעה|שעת סיום/);
    // The work and close entries of a closed visit show the closed view, never a form.
    await page.goto(`/tech/visit/${idOf("done")}?step=close`);
    await expect(page.getByText("הביקור נסגר · לצפייה בלבד")).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(0);
  });

  test("המשך טיפול: reason and next-visit notes, the summary, no signature", async ({ page }) => {
    test.setTimeout(120_000);
    const { tech } = seeded();
    const client = await signedInClient(tech.email, tech.password);
    expect((await client.rpc("depart_visit", { p_visit_id: idOf("cont"), p_operation_id: randomUUID(), p_expected_field_version: fieldVersion("cont"), ...device() })).error).toBeNull();
    await signInAs(page, tech, /\/tech$/);
    await page.goto(`/tech/visit/${idOf("cont")}`);
    await page.getByRole("button", { name: "הגעתי · התחלת טיפול" }).click();
    await doWork(page, `נדרש חלק ${run}`);
    await page.getByRole("button", { name: /המשך טיפול/ }).click();
    await expect(page.getByText("חסר: סיבה · מה צריך בביקור הבא")).toBeVisible();
    await expect(page.getByRole("button", { name: "שליחה · המשך טיפול" })).toBeDisabled();
    const reason = sqlOf("select label_he from public.followup_reasons where is_active order by sort_order limit 1");
    await page.getByRole("button", { name: reason }).click();
    await page.getByLabel("מה צריך בביקור הבא").fill(`להביא צינור ${run}`);
    await page.getByRole("button", { name: "שליחה · המשך טיפול" }).click();
    await expect(page.getByText("הביקור נסגר · לצפייה בלבד")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`↻ המשך טיפול · ${reason}`)).toBeVisible();
    expect(sqlOf(`select v.status || '|' || v.next_visit_notes || '|' || r.label_he from public.visits v join public.followup_reasons r on r.id = v.followup_reason_id where v.id = '${idOf("cont")}'`)).toBe(
      `followup|להביא צינור ${run}|${reason}`,
    );
    expect(sqlOf(`select count(*) from public.visit_signatures where visit_id = '${idOf("cont")}'`)).toBe("0");
    expect(sqlOf(`select count(*) from public.visit_media where visit_id = '${idOf("cont")}' and kind = 'signature'`)).toBe("0");
  });

  test("no connection: arrive and close are kept on the phone (also across a reload), nothing sends on its own, 'שלח שוב' sends once", async ({ page, context }) => {
    test.setTimeout(150_000);
    const { tech } = seeded();
    const client = await signedInClient(tech.email, tech.password);
    expect((await client.rpc("depart_visit", { p_visit_id: idOf("offline"), p_operation_id: randomUUID(), p_expected_field_version: fieldVersion("offline"), ...device() })).error).toBeNull();
    await signInAs(page, tech, /\/tech$/);
    await page.goto(`/tech/visit/${idOf("offline")}`);
    await expect(page.locator(".ph-head")).toContainText("בדרך");
    const blue = await photo(page, "#224466");
    const green = await photo(page, "#446622");

    // "הגעתי" without a connection does not block: the message, then the work screen.
    await context.setOffline(true);
    await page.getByRole("button", { name: "הגעתי · התחלת טיפול" }).click();
    await expect(page).toHaveURL(/\?step=work$/);
    const panel = page.getByRole("region", { name: "מצב שליחה" });
    await expect(panel).toContainText("אין חיבור, הסטטוס לא נשלח. הנתונים שמורים בטלפון");
    await expect(page.locator(".ph-head")).toContainText("בטיפול");
    await expect(page.locator(".ph-head")).toContainText("לא נשלח");
    await page.getByLabel("הוסף תמונה · לפני הטיפול").setInputFiles(blue);
    await page.getByLabel("הוסף תמונה · אחרי הטיפול").setInputFiles(green);
    await expect(page.getByRole("img", { name: "תמונה 1 · אחרי הטיפול" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("textbox", { name: "סיכום הטיפול" }).fill(`טופל ללא חיבור ${run}`);
    await page.getByRole("button", { name: "סיום ביקור ›" }).click();
    await page.getByRole("button", { name: /טופל/ }).click();
    await page.getByLabel("שם החותם").fill("לקוח לא מקוון");
    await sign(page);
    await page.getByRole("button", { name: "שליחה · הקריאה טופלה" }).click();
    // The closure fails to send: its message and "שלח שוב".
    await expect(page.getByText("הביקור נשמר · ✓ טופל")).toBeVisible();
    await expect(panel).toContainText("אין חיבור, הסגירה לא נשלחה. הנתונים שמורים בטלפון", { timeout: 15_000 });
    await expect(panel.getByRole("button", { name: "שלח שוב" })).toBeEnabled();
    expect(statusOf("offline")).toBe("en_route");

    // Back online: nothing is sent on its own, not on the `online` event and not on reopening.
    await context.setOffline(false);
    await page.waitForTimeout(2_000);
    expect(statusOf("offline")).toBe("en_route");
    await page.reload();
    await expect(page.getByText("הביקור נשמר · ✓ טופל")).toBeVisible();
    await expect(panel).toContainText("5 פריטים שמורים בטלפון");
    await expect(page.locator(".ph-head")).toContainText("לא נשלח");
    await page.goto("/tech");
    const row = page.getByRole("region", { name: 'לו"ז היום' }).getByRole("link").filter({ hasText: V.offline.customer });
    await expect(row).toContainText("לא נשלח");
    await page.waitForTimeout(1_000);
    expect(statusOf("offline")).toBe("en_route");

    // "שלח שוב" (a double tap): everything in order, once.
    await page.goto(`/tech/visit/${idOf("offline")}`);
    await panel.getByRole("button", { name: "שלח שוב" }).dblclick();
    await expect.poll(() => statusOf("offline"), { timeout: 30_000 }).toBe("done");
    await expect(page.getByText("הביקור נסגר · לצפייה בלבד")).toBeVisible({ timeout: 30_000 });
    await page.goto("/tech/done");
    await page.goto("/tech");
    await expect(page.getByText("לא נשלח")).toHaveCount(0);
    const id = idOf("offline");
    expect(sqlOf(`select string_agg(kind, ',' order by kind) from public.visit_time_reports where visit_id = '${id}'`)).toBe("arrived,departed,ended,signed");
    expect(sqlOf(`select count(*) from public.visit_media where visit_id = '${id}'`)).toBe("3");
    expect(sqlOf(`select count(*) from public.visit_signatures where visit_id = '${id}'`)).toBe("1");
    expect(sqlOf(`select count(*) from public.visit_reports where visit_id = '${id}'`)).toBe("1");
    expect(sqlOf(`select string_agg(op_type, ',' order by op_type) from public.offline_operations where visit_id = '${id}'`)).toBe("close,media,media,media,time_report,time_report");
    // The device's times of the taps are the reported times; the server keeps its own receipt time.
    expect(sqlOf(`select count(*) from public.visit_time_reports where visit_id = '${id}' and kind = 'arrived' and reported_at < received_at - interval '1 second'`)).toBe("1");
  });
  test("refusals: another technician's visit, office roles, טופל without signer or signature, המשך טיפול without reason", async ({ page }) => {
    test.setTimeout(120_000);
    const { tech, tech2, mgr, cs } = seeded();
    // Another technician's visit: not found on every entry; the writers refuse (42501).
    await signInAs(page, tech, /\/tech$/);
    for (const suffix of ["", "?step=work", "?step=close"]) {
      const res = await page.goto(`/tech/visit/${idOf("other")}${suffix}`);
      expect(res?.status(), suffix).toBe(404);
      expect(await page.content()).not.toContain(V.other.customer);
    }
    const mine = await signedInClient(tech.email, tech.password);
    const other = await mine.rpc("depart_visit", { p_visit_id: idOf("other"), p_operation_id: randomUUID(), p_expected_field_version: 1, ...device() });
    expect(other.error?.code).toBe("42501");
    expect(statusOf("other")).toBe("scheduled");
    // The other technician cannot sign this technician's photo.
    const path = sqlOf(`select storage_path from public.visit_media where visit_id = '${idOf("done")}' and kind = 'photo' limit 1`);
    const them = await signedInClient(tech2.email, tech2.password);
    const stolen = await them.storage.from("visit-media").createSignedUrl(path, 60);
    expect(stolen.data?.signedUrl ?? null).toBeNull();

    // Office roles cannot call any writer (42501), and cannot open the technician's visit pages.
    for (const user of [mgr, cs]) {
      const c = await signedInClient(user.email, user.password);
      const calls = [
        c.rpc("depart_visit", { p_visit_id: idOf("refuse"), p_operation_id: randomUUID(), p_expected_field_version: 1, ...device() }),
        c.rpc("arrive_visit", { p_visit_id: idOf("refuse"), p_operation_id: randomUUID(), p_expected_field_version: 1, ...device() }),
        c.rpc("add_visit_media", { p_visit_id: idOf("refuse"), p_operation_id: randomUUID(), p_kind: "photo", p_phase: "after", p_mime_type: "image/jpeg", p_size_bytes: 10, p_captured_at: new Date().toISOString(), p_device_tz: "Asia/Jerusalem", p_device_utc_offset_min: 120, p_device_sent_at: new Date().toISOString() }),
        c.rpc("confirm_visit_media", { p_media_id: randomUUID() }),
        c.rpc("close_visit", { p_visit_id: idOf("refuse"), p_operation_id: randomUUID(), p_expected_field_version: 1, p_outcome: "followup", p_summary: "x", p_signer_name: null, p_ack_text_sha256: null, p_signature_media_id: null, p_followup_reason_id: randomUUID(), p_next_visit_notes: "x", ...device() }),
      ];
      for (const r of await Promise.all(calls)) expect(r.error?.code, user.email).toBe("42501");
    }
    expect(statusOf("refuse")).toBe("scheduled");

    // The visit in treatment (through the writers under the technician's own session).
    expect((await mine.rpc("depart_visit", { p_visit_id: idOf("refuse"), p_operation_id: randomUUID(), p_expected_field_version: fieldVersion("refuse"), ...device() })).error).toBeNull();
    expect((await mine.rpc("arrive_visit", { p_visit_id: idOf("refuse"), p_operation_id: randomUUID(), p_expected_field_version: fieldVersion("refuse"), ...device() })).error).toBeNull();
    const closeArgs = { p_visit_id: idOf("refuse"), p_expected_field_version: fieldVersion("refuse"), p_summary: "סיכום", ...device() };
    const ack = await sha256Hex(APPROVAL_TEXT_V1);
    // "טופל" without the signer, without a signature, or with another text: refused (22023).
    for (const bad of [
      { p_signer_name: null, p_signature_media_id: randomUUID(), p_ack_text_sha256: ack },
      { p_signer_name: "לקוח", p_signature_media_id: null, p_ack_text_sha256: ack },
      { p_signer_name: "לקוח", p_signature_media_id: randomUUID(), p_ack_text_sha256: await sha256Hex("טקסט אחר") },
    ]) {
      const r = await mine.rpc("close_visit", { ...closeArgs, p_operation_id: randomUUID(), p_outcome: "done", p_followup_reason_id: null, p_next_visit_notes: null, ...bad });
      expect(r.error?.code).toBe("22023");
    }
    // "המשך טיפול" without a reason or without the notes: refused (22023).
    const reasonId = sqlOf("select id from public.followup_reasons where is_active order by sort_order limit 1");
    for (const bad of [
      { p_followup_reason_id: null, p_next_visit_notes: "להביא חלק" },
      { p_followup_reason_id: reasonId, p_next_visit_notes: null },
    ]) {
      const r = await mine.rpc("close_visit", { ...closeArgs, p_operation_id: randomUUID(), p_outcome: "followup", p_signer_name: null, p_signature_media_id: null, p_ack_text_sha256: null, ...bad });
      expect(r.error?.code).toBe("22023");
    }
    expect(statusOf("refuse")).toBe("in_progress");

    // The screens refuse the same: the send button stays disabled and says what is missing.
    await page.goto(`/tech/visit/${idOf("refuse")}?step=work`);
    await doWork(page, "סיכום");
    await page.getByRole("button", { name: /טופל/ }).click();
    await expect(page.getByRole("button", { name: "שליחה · הקריאה טופלה" })).toBeDisabled();
    await expect(page.getByText("חסר: שם החותם · חתימת הלקוח")).toBeVisible();
    await sign(page);
    await expect(page.getByText("חסר: שם החותם")).toBeVisible();
    await expect(page.getByRole("button", { name: "שליחה · הקריאה טופלה" })).toBeDisabled();
    await page.getByRole("button", { name: /המשך טיפול/ }).click();
    await expect(page.getByRole("button", { name: "שליחה · המשך טיפול" })).toBeDisabled();
    await expect(page.getByText("חסר: סיבה · מה צריך בביקור הבא")).toBeVisible();
    expect(statusOf("refuse")).toBe("in_progress");
  });

  test("office call card: the visit's photos as short-lived signed links (Manager, Customer Service)", async ({ page }) => {
    const { mgr, cs } = seeded();
    for (const user of [mgr, cs]) {
      await signInAs(page, user, /\/office$/);
      await page.goto(`/office/calls/${V.done.req}`);
      const after = page.getByRole("list", { name: "תמונות · אחרי הטיפול" });
      await expect(after.getByRole("listitem")).toHaveCount(1);
      await expect(page.getByRole("list", { name: "תמונות · לפני הטיפול" }).getByRole("listitem")).toHaveCount(1);
      const href = (await after.getByRole("listitem").first().getAttribute("href")) ?? "";
      expect(href.startsWith(`${SUPABASE_URL}/storage/v1/object/sign/visit-media/test/${idOf("done")}/`)).toBe(true);
      const token = new URL(href).searchParams.get("token") ?? "";
      const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as { exp: number; iat: number };
      expect(claims.exp - claims.iat).toBe(300);
      const res = await page.request.get(href);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/jpeg");
      // Never a public URL.
      expect(await page.content()).not.toContain("/storage/v1/object/public/");
      await page.getByRole("button", { name: "יציאה מהחשבון" }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
  });
});
