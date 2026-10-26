# Design System — Faithful to the Approved Prototype

**Authoritative visual reference:** the original `docs/demo.html`, including its CSS, HTML, and interactive behavior, as amended by `docs/demo-deviations.md`. This is not a request to redesign.

## Exact core tokens from prototype
- Text/primary dark: `#18212B`; secondary dark: `#263241`.
- Page background: `#F2F4F6`; cards: `#FFFFFF`; borders: `#DDE3E9`.
- Main accent: `#155E75`; darker accent: `#0E4457`; pale accent surface: `#EAF3F6`.
- Heading font: `Rubik`; body font: `Assistant`; actual end-user UI is **Hebrew and RTL**.
- Status color backgrounds: scheduled `#DCEBFA`; on the way `#FFF2CC`; in progress `#ECE3FA`; resolved `#DDF3E2`; follow-up `#FDE7D3`; cancelled `#E4E7EB`.
- Technician mobile: dark header, white cards, large action buttons and bottom navigation. The fake device border shown on a desktop demo is **not part of the real phone UI**.
- Office desktop: dark right-side navigation, KPI cards, tables, calendars, slide-out drawers and modals.

## Screen review checklist
1. Identify corresponding prototype view/state and capture the reference screenshot.
2. Implement with mock data before backend logic. Compare at **390px phone, 820px tablet and 1440px desktop**.
3. Test long Hebrew text, missing values, loading and error states, accessible touch targets and RTL.
4. Obtain the owner's approval before wiring up real persistence.
5. Keep demo-only role selector, device simulator, reset and fake mail views out of publicly deployed production interfaces. Real roles come from authentication.

**Do not add screens or change the approved aesthetic without permission**, except essential security/error states that are shown for review first.
