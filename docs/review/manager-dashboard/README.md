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
- **Chart:** the 3 / 6 / 12-month selector (the reference's static "6 חודשים" badge); labelled gridlines (C27); a collapsible data table under the chart (C22); the sparse fictional history (April–June "אין נתונים").
- **Controls:** selected pills in the darker `#315EB5` with white text (C23); the Technicians toolbar in the spec §7.2 order — technicians right, date navigation centre, periods left (C24; the reference puts the periods in the centre); the custom range's "הצג" button (C30).
- **Danger colour:** `#C14F4F` (spec §9) instead of the reference's `#b5474f` (C26).
- **Demo clock:** the dashboard counts 48213/1 (09:00–11:00) under "לא בוצעו במועד" at 12:45, while the technician home still shows it as "הביקור הבא" (`DEMO_NOW` is used by the dashboard only).
