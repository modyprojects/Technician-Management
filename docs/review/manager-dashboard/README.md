# Manager dashboard, office navigation and the MODY logo (D57) — review screenshots

Fictional, test-marked data only (D47). Taken with the "manager-dashboard" block of
`tests/e2e/screenshots.spec.ts` (Playwright, Chromium, device scale factor 1) from a local production build
of the commit that contains them, at 390 × 844, 820 × 1180 and 1440 × 900 px:

```
npm run build
SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts --project=desktop -g "manager-dashboard"
```

The reference shots (`ref-*`) come from the approved visual reference `docs/design/manager-dashboard-demo.html`
(tabs switched with its own buttons). The demo's "now" is 21.10.2026 12:45 (`DEMO_NOW`); the reference shows
5.11.2026.

## App vs reference

| Screen | 390 | 820 | 1440 | Reference |
|---|---|---|---|---|
| General ("כללי") | `390-dash-general.png` | `820-dash-general.png` | `1440-dash-general.png` | `*-ref-general.png` |
| General, details dialog ("לא בוצעו במועד") | `390-dash-general-dialog.png` | `820-dash-general-dialog.png` | `1440-dash-general-dialog.png` | `*-ref-modal.png` |
| General, 12 months with the data table open | `390-dash-general-12m.png` | `820-dash-general-12m.png` | `1440-dash-general-12m.png` | — |
| Loading state (inside the unchanged frame) | `390-dash-loading.png` | `820-dash-loading.png` | `1440-dash-loading.png` | — |
| Technicians, יורם, October | `390-dash-tech-month.png` | `820-dash-tech-month.png` | `1440-dash-tech-month.png` | `*-ref-tech.png` |
| Technicians, previous month (September) | `390-dash-tech-prev.png` | `820-dash-tech-prev.png` | `1440-dash-tech-prev.png` | — |
| Technicians, week 18–24.10 | `390-dash-tech-week.png` | `820-dash-tech-week.png` | `1440-dash-tech-week.png` | — |
| Technicians, custom range (שמואל, 1–21.10) | `390-dash-tech-custom.png` | `820-dash-tech-custom.png` | `1440-dash-tech-custom.png` | — |
| Technicians, invalid custom range | `390-dash-tech-custom-error.png` | `820-dash-tech-custom-error.png` | `1440-dash-tech-custom-error.png` | — |
| Technicians, "דוחות הביקורים" | `390-dash-tech-reports.png` | `820-dash-tech-reports.png` | `1440-dash-tech-reports.png` | — |
| Products & Suppliers | `390-dash-products.png` | `820-dash-products.png` | `1440-dash-products.png` | `*-ref-products.png` |
| Products, a supplier's calls (dialog) | `390-dash-products-dialog.png` | `820-dash-products-dialog.png` | `1440-dash-products-dialog.png` | — |

## Navigation and logo

| Screen | Files (390 / 820 / 1440) |
|---|---|
| Manager sidebar on "קריאות" with the "מסכים נוספים" row | `*-nav-mgr-calls.png` |
| Creator sidebar on "קריאות" | `*-nav-creator-calls.png` |
| Customer Service home (unchanged) | `*-nav-cs-home.png` |
| Manager Settings › "משתמשים" (no tab bar; `settings` stays off) | `*-mgr-settings-accounts.png` |
| Manager Settings › "מקומות איסוף" (still "אין הרשאה") | `*-mgr-settings-places-no-access.png` |
| Office logo, cropped (sidebar at 1440; the dark top bar at 390 and 820) | `*-logo-office-sidebar.png` |
| A full office page with the logo | `*-office-calls-logo.png` |
| Technician home and visit card with the logo row | `*-tech-home-logo.png`, `*-tech-visit-logo.png` |
| Technician header, cropped | `*-logo-tech-header.png` |

## Opening date and work start (D57 (9), owner message 6)

| Screen | Files (390 / 820 / 1440) |
|---|---|
| Customer card (משפחת לוי): each product's first and latest call with "נפתחה" (`opened_at`) and "תחילת טיפול" (first arrival; 48213 "טרם התחיל"); the return "פנייה 48213 (19.10) נפתחה 26 ימים אחרי…" counted from `opened_at` | `*-customer-card-dates.png` |
| "מוצרים": the creating call's "נפתחה" and "תחילת טיפול" under "נוצר מזימון" | `*-products-dates.png` |

## Expected differences from the reference

- **Tokens and fonts:** the `--dash-*` palette next to the app tokens and the app's Rubik / Assistant fonts (not Arial).
- **Labels from the detailed spec (C21):** "מתוכננים", "בוצעו", "זמן סגירת קריאה", "מוצרים וספקים מובילים", "3 ספקים מובילים", "5 מק״טים מובילים", "באחריות" (the reference: "ביקורים מתוכננים", "ביקורים שבוצעו", "זמן ממוצע לסגירת קריאה", "…בולטים", "… עם הכי הרבה קריאות", "% אחריות").
- **Tables:** G-07 alignment (short columns centred), not every cell right-aligned.
- **Test data:** "נתוני בדיקה" note and 🧪 badges (SIM-13, SIM-17) instead of the reference's "נתוני הדמיה בלבד" and demo footer.
- **States:** "הגדרה ממתינה" ("עמידה בתכנון") and "לא זמין" ("תקלה נפוצה") instead of sample numbers; those tiles are not clickable (C28).
- **Activity order on Technicians:** planned, done, closed calls (owner); no "דרשו המשך טיפול"; grids of 3 and 5 tiles (C29).
- **Dates and people:** 21.10.2026 (the demo's fixed day) instead of 5.11.2026; three technicians (יורם, אדי, שמואל), not four.
- **Logo:** in the dark sidebar / top bar and the technician header (owner message 3), not in a light page header.
- **Excel:** the existing gated "ייצוא ל-Excel" placeholder stays (OF-14 PENDING).
- **Chart:** the 3 / 6 / 12-month selector (the reference's static "6 חודשים" badge); gridlines labelled at whole-number steps (C27; 10 / 20 / 30 in the demo); a collapsible data table under the chart (C22); the sparse fictional history (April–June "אין נתונים").
- **Controls:** selected pills in the darker `#315EB5` with white text (C23); the Technicians toolbar in the spec §7.2 order — technicians right, date navigation centre, periods left (C24; the reference puts the periods in the centre); the custom range's "הצג" button (C30).
- **Danger colour:** `#C14F4F` (spec §9) instead of the reference's `#b5474f` (C26).
- **Demo clock:** the dashboard counts 48213/1 (09:00–11:00) under "לא בוצעו במועד" at 12:45, while the technician home still shows it as "הביקור הבא" (`DEMO_NOW` is used by the dashboard only).

## Review dispositions (independent reviews of 2026-11-05: security and scope, metrics, UI and accessibility)

Fix pass on top of `61d98bc`. Every "must" and "should" finding is fixed with a test that fails without the fix; the nits are fixed too, except where stated. Screenshots changed by the fixes were regenerated with the block above (41 updated, 6 new; the reference shots are byte-identical). Checks after the fix pass: lint, typecheck, `test:ci` 52/52, `check:migrations`, build, `scan:bundle` and `test:e2e` (2,398 passed, 2,672 skipped, 0 failed) all pass.

| Finding | Severity | Disposition |
|---|---|---|
| SEC-1 / UI-01: owner message 6 ("נפתחה" = `opened_at`, "תחילת טיפול" = first arrival) not implemented | must | **Fixed.** `openedOn` (first visit's date) is retired; `customers.ts` has `openedDate` (Asia/Jerusalem date of `openedAt`), `byOpening` and `workStartAt` (first recorded arrival by visit number; null → "טרם התחיל"). The return rule, its text, the products ordering and the customer-card product order use `opened_at`. New DTO `CallStartDates` (`features/calls/data/types.ts`) in `CustomerProduct.firstCall` / `latestCall` (replacing the first-visit `firstDate` / `lastDate`), `ProductReturn.openedDate` and `ProductFirstSeen` (replacing its visit `date`). The customer card and the "מוצרים" screen show both labelled fields. D57 item (9) added, sources "messages 1–6"; `docs/spec.md`, `docs/demo-deviations.md` (OF-16), `docs/architecture-data-access.md` updated; the WORKLOG gap line removed. E2E: both fields on the card and the products screen, no "נפתחה" with a first-visit date (48213 shows 19.10, not "היום"), the return window from `opened_at` (48213: 26 days, was 28; 48205: 21, was 25), and the dashboard dialog agrees. New screenshots `*-customer-card-dates.png`, `*-products-dates.png`. "First visit with a recorded arrival" rather than literally visit 1: a cancelled visit 1 has no arrival, and work started at the later visit (no demo call differs) |
| SEC-2: OF-01 attributed the Creator navigation to the orchestrator | should | **Fixed.** OF-01 now cites the owner's own words (D57 (1): "Apply a corresponding navigation structure to the Creator, while preserving Creator-only functions") |
| SEC-3: the calls list and call card ignore `calls` (existing gap) | nit | **Recorded, not changed here** (as the spec requires): new P1 row in `docs/THINKING-AHEAD.md` for a small separate PR (deny by default on `calls/page.tsx` and `calls/[req]/page.tsx`, the no-access branch below the "מסכים נוספים" row, negative raw-HTML tests) |
| SEC-4: the reports-view DTO still computed follow-up counters | nit | **Fixed.** `TechnicianDetail` carries only `filter`, `visits` and `includesTestData`; `stats`, `visitCounts`, `topReason`, `firstVisitCalls`, the `TechnicianStats` type and the demo's `techStats` are removed |
| MC-1: dataset S never tested Jerusalem boundaries (all instants +02:00) | should | **Fixed.** S13 and S14's boundary instants are written as UTC (`…Z`); expected values unchanged. Date slicing in `visitDate`, the closure-date filter or the trend now fails 5, 6 and 2 tests |
| MC-2: closure exclusion of `resolved_at < opened_at` and a missing `opened_at` untested | should | **Fixed.** Focused unit test (X1 valid, X2 invalid, X3 missing): value 10 h, basis 1, excluded {missing 1, invalid 1} |
| MC-3: T8 / D38 "only currently resolved calls are closed" untested | should | **Fixed.** Focused unit test: a call closed "המשך טיפול" after a "טופל" and a reopened call, both with a stale `resolved_at`, are absent from the trend, the completed calls, the closure time and the technician's closed calls; the control call counts |
| MC-4: 30-day leaders by opening date untested | should | **Fixed.** A call opened 10.2 and closed 20.2 does not count in the 14.2–15.3 window (P-1 stays 5) and is not in the `top.skus` dialog |
| MC-5: the custom-range e2e test could not tell the range reached the metrics | should | **Fixed.** After the range, the test switches to יורם (period kept) and expects 74 / 70 / 52 (October: 76) |
| MC-6: closure time rounded twice | nit | **Fixed.** `durationHours` is the unrounded mean (the tile and the dialog rows show it per T7); `value` stays two decimals. Unit test: 47.496 h reads "47 שעות", not "2.0 ימים" |
| MC-7: the "opened by now" limit applied unevenly | nit | **Fixed.** The 30-day highlights and their dialog count only calls opened by `now`, as the Products tab and coverage do. Unit test with a call stamped after `now` |
| UI-02: the chart's `role="img"` wrapped links (axe nested-interactive) | should | **Fixed.** The plot is a named `role="group"`; every bar is aria-hidden (links keep `tabindex=-1`). E2E: no `[role=img]` contains a link; the chart group's links are all hidden and unfocusable |
| UI-03: the skeleton had no title bar or section heads; the tiles jumped 121 px | should | **Fixed.** The skeleton reuses the page's blocks (title with the date, the note's box, the tab bar, `.ma-dash` gap, section heads, the tile grid's rules via `.ma-skel-kpis`, the card heights). Measured: identical block positions at 820 and 1440, and at 390 after the status margin fix. E2E: the first tile's top is the same in the skeleton and on the loaded page (±2 px) at 390 and 820 |
| UI-04: fractional gridline labels (12.5 / 37.5) | should | **Fixed.** `gridStep` (replaces `niceMax`): the smallest whole 1 / 2 / 2.5 / 5 × 10ⁿ ≥ max ÷ 4; scale = 4 steps. Demo: 10 / 20 / 30. E2E asserts the labels; `docs/design-system.md` updated |
| UI-05: SKU product names hidden on tablet | should | **Fixed.** The name column shows from 600 px of dashboard width. E2E: visible at 820 and 1440, hidden at 390 |
| UI-06: duplicate landmark names | nit | **Fixed.** The tile sections are unnamed (the KPI group keeps the name); the SKU scroller is "טבלת המק״טים". E2E: no two named sections / regions share a name on any tab |
| UI-07: ranked-bar link names did not contain the visible text | nit | **Fixed.** No `aria-label`; the name comes from the content with hidden ": " and " · פירוט". E2E: the name is "מ.ס. יבוא: 106 קריאות · פירוט" |
| UI-08: the logo took its own row in the 390 top bar | nit | **Fixed.** The nav takes the rest of the logo's row (`flex: 1 1 0`), and the logo is centred on the first nav row (86 px bar at 390). E2E: the logo's centre is within 8 px of the first link's centre. This also changes the ≤ 900 px top bar of the other office pages (Customer Service included) the same way |
| UI-09: mixed arrow glyphs | nit | **Fixed.** No glyph on dashboard tiles (as the reference); other KpiGrid screens unchanged |
| UI-10: "%" alone on a header line at 820 | nit | **Fixed.** Dashboard table headers stay on one line. E2E: equal header heights |
| UI-11: percent at full size | nit | **Fixed.** "%" in the small muted unit style on dashboard tiles only. E2E: 12 px |
| UI-12: focus lost after closing a dialog opened from a chart bar | nit | **Fixed.** Focus returns to the first visible opener that accepts focus (checked with `checkVisibility`, so a link inside a closed `<details>` is skipped), else to the family's fallback, the chart table's summary. E2E: focus on the summary after Escape |
| UI-13: the SKU scrolled away on phones | nit | **Fixed.** The first column of dashboard tables is sticky (`right: 0`; the SKU cell is `dir="ltr"`). E2E: after scrolling the table fully sideways at 390, the SKU cell is still at the scroller's right edge |
| UI-14: `aria-busy` on the skeleton's own live region | nit | **Fixed.** The loading text is a `role="status"` in the title, outside the busy placeholders. E2E asserts it |

