# Design System — Faithful to the Approved Prototype

**Authoritative visual reference:** the original `docs/demo.html`, including its CSS, HTML, and interactive behavior, as amended by `docs/demo-deviations.md`. This is not a request to redesign.

## Exact core tokens from prototype
- Text/primary dark: `#18212B`; secondary dark: `#263241`.
- Page background: `#F2F4F6`; cards: `#FFFFFF`; borders: `#DDE3E9`.
- Main accent: `#155E75`; darker accent: `#0E4457`; pale accent surface: `#EAF3F6`.
- Heading font: `Rubik`; body font: `Assistant`; actual end-user UI is **Hebrew and RTL**.
- Status color backgrounds: scheduled `#DCEBFA`; on the way `#FFF2CC`; in progress `#ECE3FA`; resolved `#DDF3E2`; follow-up `#FDE7D3`; cancelled `#E4E7EB`.
- Technician (phone and tablet first; also works on desktop, D27): dark header, white cards, large action buttons and bottom navigation; wider layout from 600 px as in the demo, kept above 900 px (content centred up to 760 px, owner answer 2026-11-01). The fake device border shown on a desktop demo is **not part of the real phone UI**.
- Office (desktop first; also works on tablet and phone, D27): dark right-side navigation that becomes a top bar at 900 px and below as in the demo, KPI cards, tables, calendars, slide-out drawers and modals.

## Screen review checklist
1. Identify corresponding prototype view/state and capture the reference screenshot.
2. Implement with mock data before backend logic. Compare every screen for every role at **390px phone, 820px tablet and 1440px desktop** (D27), in a desktop browser and from screenshots during development (D28).
3. Test long Hebrew text, missing values, loading and error states, accessible touch targets and RTL.
4. Obtain the owner's approval before wiring up real persistence.
5. Keep demo-only role selector, device simulator, reset and fake mail views out of publicly deployed production interfaces. Real roles come from authentication.

**Do not add screens or change the approved aesthetic without permission**, except essential security/error states that are shown for review first.

## Tables (owner, 2026-11-02; demo-deviations G-07)
Applies to every table.
- **Short columns** (status, dates, times, counts, technician, SKU, request number): centred and sized to their content (`col-center col-fit`).
- **Long-text columns** (customer, product, city, rep): right-aligned. Customer and product take the remaining width; city and rep are sized to their content (`col-fit`).
- **Tablet (521–900 px):** 8 px side padding (the demo's compact rule); headers of content-sized columns may wrap, and city and rep may wrap like customer and product, so a full calls table fits without sideways scrolling with headroom (about 50 px at 820 px) for font-rendering differences between browsers.
- **Phone (520 px and below):** as in the demo: single-line cells and sideways scrolling inside `.scrollx`.
- Checked by `tests/e2e/review-round1.spec.ts` at 390 / 820 / 1440 px.

## Implementation (Step 0)
- Tokens: `app/globals.css` declares the demo's 46 `:root` custom properties with the same names and values (font stacks point at the self-hosted Rubik and Assistant), plus named versions of colours the demo hard-codes (`--control-line`, `--danger-line`, `--seg-bg`, `--stat-line`, `--note-line`). `@theme inline` exposes them to Tailwind utilities (`bg-card`, `text-ink`, `font-display`...). Tailwind's preflight reset is not loaded, so base styles match the demo.
- Components and shells: `styles/ui.css` copies the demo classes in use; React components in `components/ui`, `components/tech`, `components/office` wrap them.
- Breakpoints: the demo's container queries on the `stage` container (`@container stage`): 600 px and wider (technician tablet layout), 900 px and below (office top bar), 520 px and below (compact tables).
- `tests/e2e/tokens.spec.ts` compares every app token with `docs/demo.html` in the browser.

## Manager dashboard (D57, 2026-11-05)
- **Sources:** `docs/design/manager-dashboard-spec.md` (owner-approved) and the visual reference `docs/design/manager-dashboard-demo.html`. D57 (3) is the owner's permission for this aesthetic change: a clean MODY look that reuses the app's tokens and fonts while matching the approved appearance. Precedence: the reference for appearance, except where the detailed spec states a label or layout (labels, the Technicians toolbar order, the palette, the card placement).
- **Classes:** every dashboard class is `ma-*` (`styles/ui.css`, block "manager-analytics"); the reference's `.pill`, `.tabs`, `.kpis`, `.kpi`, `.card`, `.track`, `.bar`, `.dot`, `.note`, `.empty` and `.logo` already mean something else here. The reference's 850 px and 430 px breakpoints apply to the dashboard's own width (container `dash` on `.ma-dash`), so they hold beside the desktop sidebar.
- **Tokens** (`app/globals.css`, named next to the app tokens, used only by `ma-*`): `--dash-blue #4677D5` (data marks, opened bars, progress "בוצעו"; graphics only, 4.32:1 on white), `--dash-ink #222831` (values), `--dash-muted #6B7280` (secondary text on cards, 4.83:1; on the page background use `--muted`, 5.00:1), `--dash-compare #697586` (closed bars, supplier bars, 4.68:1), `--dash-bg #F3F5F8` (not repainted: the shell's `--bg` is visually identical), `--dash-card #FFFFFF`, `--dash-line #E2E7EE`, `--dash-danger #C14F4F` (spec §9; genuine exceptions only, "לא בוצעו במועד" > 0; 4.67:1), `--dash-blue-strong #315EB5`, `--dash-blue-soft #E8EFFC`, `--dash-track #E9EDF2`, `--dash-remaining #B9C1CD` ("טרם בוצעו"), `--dash-pill-line #DCE2EA` (unselected pill border).
- **Filled controls carrying text** (the selected technician, period and chart-range pills) use `--dash-blue-strong` with white text (6.18:1), not the reference's `#4677D5` (4.32:1, below 4.5:1 for 12–13 px text). PROPOSED (C23), owner feedback pending.
- **Chart colours:** opened `--dash-blue` and closed `--dash-compare` differ in hue but hardly in lightness (1.08:1; the palette validator flags the pair below the normal-vision separation floor and the gray below the chroma floor). The distinction is carried by the fixed order (opened always on the start side of each month), the legend, each bar's title and the data table under the chart (`<details>`, the keyboard and screen-reader path).
- **States:** a missing measurement is "—" with "אין מספיק נתונים" (visually hidden text plus a caption); "הגדרה ממתינה" and "לא זמין" are 15 px muted text, never the 30 px value font, and their tiles are never links.
- **Logo** (G-08, D57 (6)): the white file `public/brand/mody-logo-white.png` in the existing dark headers only: the office sidebar (132 px wide, the product name under it), the ≤ 900 px office top bar (92 px, the name visually hidden) and the technician header's own row (88 px, at the left). Proportions and transparency kept (width set, height auto; no filter, blend mode or background). No new light strip; the dark file is not used in the app. One component: `components/ui/BrandLogo.tsx`.
