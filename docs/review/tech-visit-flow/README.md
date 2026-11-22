# Technician visit flow on real data (#58) — review images

Signed in to the LOCAL stack, production build, every record fictional and test-marked (D47, "נתוני בדיקה").
Technician screens at 390 / 820 (D70); the office call card's photo section at 390 / 1440 (D72).
Made with `SCREENSHOTS=1 node tests/auth/run-local.mjs tests/auth/tech-visit-flow-screenshots.spec.ts` (PNG, converted to WebP).

| Image | Screen |
| --- | --- |
| `*-01-card-scheduled` | Card, "שובצה": "יוצא · Waze" only, no Waze tile yet |
| `*-02-card-depart-failed` | "יוצא" without a connection (D71): inline message, "פתח Waze בכל זאת" |
| `*-03-card-en-route` | Card, "בדרך": Waze tile shown, "הגעתי · התחלת טיפול" |
| `*-04-work-empty` / `*-05-work-ready` | Work screen: photos before / after (max 8 each), summary |
| `*-06-close-choose` / `*-07-close-cont` / `*-08-close-done` | Close: choose, "המשך טיפול" (reason + notes), "טופל" (text, signer, signature) |
| `*-09-close-not-sent` | Closure without a connection: "אין חיבור, הסגירה לא נשלחה. הנתונים שמורים בטלפון", "לא נשלח", "שלח שוב" |
| `*-13-home-not-sent` | "היום" with the "לא נשלח" marker on the visit's row |
| `*-10-closed-done(-bottom)` / `*-11-closed-cont` | Closed visit, read-only, photos from short-lived signed links |
| `390/1440-12-office-call-photos` | Office call card: the visit's photos (signed links, 5 minutes) |

## Changes from the approved skeleton (D81)

1. **Real route.** The skeleton's `/tech/visit/skeleton/**` and its fixtures are gone; the flow lives on the
   visit card the home and calendar already link to, `/tech/visit/<id>`, with `?step=work` and `?step=close`
   instead of `/work` and `/close` sub-routes. Reason: the steps switch on the device (also without a
   connection) and a server refresh must never remount the flow and lose the screen.
2. **Card details are the real card's (#42).** The skeleton's short details card is replaced by the approved
   real card parts (history, customer and product card, fault, notes, pickup, source). Reason: one card, real data.
3. **Waze tile only after "יוצא"** (D95 (e)); before it the footer's "יוצא · Waze" leads. The departure is recorded
   first and Waze opens only after the server confirms (D71); a refusal other than "no connection" says to refresh.
4. **Photos compressed on the device** (D95 (h), (i)): long edge ≤ 1920 px, ~2 MB target, JPEG (WebP kept),
   EXIF orientation applied; only the compressed file is kept; a photo that cannot be compressed shows an inline
   error and is not kept. "צילום" shows "מכווץ…" meanwhile; each phase says "עד 8".
5. **Online only, data kept on the phone** (D95 (d) as corrected by the owner 22.11; D06). "הגעתי" and the
   closure are stored on the phone first (IndexedDB, with the device time of the tap) and sent at once. Without a
   connection: "אין חיבור, הסטטוס לא נשלח. הנתונים שמורים בטלפון" (the technician continues to work and close) and
   "אין חיבור, הסגירה לא נשלחה. הנתונים שמורים בטלפון" with **"שלח שוב"**, which sends everything in order
   (arrival, photos, signature, closure) with the same operation ids. Nothing is sent on its own (no `online`
   event, no app-open send, no timers). The data is deleted from the phone only after the server confirms.
   New: a **"לא נשלח"** marker in the card header and on the visit's row in "היום" until everything is sent; the
   close confirmation says "הביקור נשמר" (never "נשלח" before the server confirmed, TE-23).
6. **Closed view** shows the real photos (signed links), the follow-up reason from Settings and the approval text
   preserved at signing (D43); from the day after closing only address, status and summary (D79 (2)).
7. **Office call card photos** (D92 (2), D95 (f)): the placeholders become real thumbnails grouped before / after,
   each opening the full photo; signed under the office user's own session after an RLS-checked read.
8. **Not in this build** (D95 (g)): video and the recorded summary — no control, no placeholder.

## What to check (owner)

1. A scheduled visit shows no Waze tile; after "יוצא" Waze opens and the tile appears.
2. Without a connection, "הגעתי" and the closure show the messages above; the visit shows "לא נשלח" on the card and on "היום".
3. After reconnecting, nothing is sent until "שלח שוב"; then the visit closes once and "לא נשלח" disappears.
4. Photos look right side up and sharp; at most 8 per phase; "אחרי הטיפול" required.
5. The office call card shows the visit's photos (before / after).
