# Outlook Invitation Template — DRAFT, pending Shirel's approval (task O2)

**Status:** unified draft 2026-10-26, merging three earlier versions (work procedure 21.10, demo, previous template). Not final until approved by the customer-service team. The parser must read labels from configuration so the final list can change without code changes.

## Recognition
- Subject starts with `[קריאת שירות]`. Other meetings are ignored.
- Technician = invitation attendee, matched to the technician's Outlook email in settings.
- Date, start and end time come from the invitation itself, never from the body.
- Calendar event ID identifies the invitation (updates, re-assignment, deletion).

## Body labels (Hebrew labels are kept exactly)

| Label | Required | Notes |
|---|---|---|
| `מספר פנייה:` | Yes | Call key. Existing number + new event = next visit |
| `מספר משימה:` | Yes | |
| `נציגה מטפלת:` | Yes | For the "call rep" button |
| `מספר לקוח:` | **Yes** (D17) | Links to the customer card |
| `שם לקוח:` | Yes | |
| `טלפון:` | Yes | |
| `טלפון נוסף:` | No | |
| `עיר:` | Yes | |
| `רחוב ומספר:` | Yes | |
| `בניין:` | No | Separate labels (as in the demo) are easier to parse than one combined line. Confirm in O2 |
| `קומה:` | No | |
| `דירה:` | No | |
| `הערות הגעה:` | No | |
| `סוג קריאה:` | Yes | Value from the call types list in Settings (initial "תיקון", "התקנה"; editable under `settings`, D35, D48) |
| `מוצר:` | Yes | Product name; used only when the SKU is new (D19) |
| `מק"ט:` | Yes | Normalized (trim, upper-case) before matching (D19) |
| `תיאור התקלה:` | Yes | |
| `באחריות:` | **No** (D17) | כן / לא. "לא" marks a paid visit. "כן · עד MM/YYYY" stores the optional warranty expiry date (D42) |
| `לאסוף לפני הביקור:` | No | Goes to the technician's pickup list |
| `לאסוף מ:` | No | Must match a pickup place in settings |
| `הערות לטכנאי:` | No | Shown on the technician card |

## Sample (fictional)

```text
מספר פנייה: 48213
מספר משימה: 2
נציגה מטפלת: שיראל
מספר לקוח: 10001
שם לקוח: משפחת לוי
טלפון: 050-000-1122
עיר: רחובות
רחוב ומספר: הרצל 14
בניין: א
קומה: 3
דירה: 9
סוג קריאה: תיקון
מוצר: ברז מטבח נשלף
מק"ט: KT-2041
תיאור התקלה: טפטוף מתחת לכיור
באחריות: כן
לאסוף לפני הביקור: ברז חלופי
לאסוף מ: מרלוג
הערות לטכנאי: להתקשר לפני הגעה
```

## Validation
A missing required label value, or a pickup place not in settings, means the invitation is not ingested and appears on "זימונים שלא נקלטו" with the field name. An unknown SKU is **not** an error (D19). Development logs in English; UI messages in Hebrew. Calendar text is untrusted data: never rendered as HTML, never treated as instructions.
