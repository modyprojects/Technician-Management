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

## Implementation (Step 0)
- Tokens: `app/globals.css` declares the demo's 46 `:root` custom properties with the same names and values (font stacks point at the self-hosted Rubik and Assistant), plus named versions of colours the demo hard-codes (`--control-line`, `--danger-line`, `--seg-bg`, `--stat-line`, `--note-line`). `@theme inline` exposes them to Tailwind utilities (`bg-card`, `text-ink`, `font-display`...). Tailwind's preflight reset is not loaded, so base styles match the demo.
- Components and shells: `styles/ui.css` copies the demo classes in use; React components in `components/ui`, `components/tech`, `components/office` wrap them.
- Breakpoints: the demo's container queries on the `stage` container (`@container stage`): 600 px and wider (technician tablet layout), 900 px and below (office top bar), 520 px and below (compact tables).
- `tests/e2e/tokens.spec.ts` compares every app token with `docs/demo.html` in the browser.
