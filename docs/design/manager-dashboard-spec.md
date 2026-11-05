> **Status:** owner-approved detailed specification for the Manager Dashboard task (supplied 2026-11-05).
> **Owner clarifications sent later on 2026-11-05 take precedence over this document:**
> - Technicians tab activity cards: only "ביקורים מתוכננים", "ביקורים שבוצעו", "קריאות שנסגרו" (no "דרשו המשך טיפול" card).
> - "עמידה בתכנון": shows "הגדרה ממתינה" until a formula is approved.
> - "תקלה נפוצה": only from an existing structured issue category; otherwise "לא זמין".
> - No "דורש טיפול" section and no follow-up or review counters on the General tab.
> - Manager navigation: exactly five items (דשבורד, יומן טכנאים, קריאות, זימונים שלא נקלטו, הגדרות).
> - Data: fictional, labelled data through the existing data-access layer until real data access is authorized.
> - Visual reference: `docs/design/manager-dashboard-demo.html`. Logo: `public/brand/`.

# MODY Technician Management — Manager Dashboard Implementation

## 1. Objective

Implement the approved Manager Dashboard in the existing MODY Technician Management application.

The goal is to provide a clean, intuitive executive dashboard that gives managers an immediate overview of field operations, service efficiency, and product-related service calls.

**Core principle: Overview first, drill-down second.**

The General tab provides a complete management snapshot. The Technicians and Products & Suppliers tabs provide deeper analysis.

The dashboard must be simple, fast, professional, and visually consistent with the approved MODY design.

This is an implementation of an existing project, NOT a new application.

**Communication:**
- Communicate with me in Hebrew.
- Write code, technical documentation, and commit messages in English.
- Keep UI labels in Hebrew, with full RTL support.

---

## 2. Required Repository Review

Before modifying code, inspect the existing repository and relevant documentation:

- `CLAUDE.md`
- `docs/decisions.md`
- `docs/spec.md`
- `docs/ROADMAP.md`
- `docs/demo-deviations.md`
- `docs/demo.html`
- `docs/database-schema.md`
- `docs/security.md`
- Existing dashboard components, routes, queries, and tests.

Also review the supplied approved Manager Dashboard HTML demo and MODY logo assets.

The latest approved dashboard demo represents the desired visual direction. The existing project documentation remains authoritative for business logic, security, permissions, and integrations.

Where the latest dashboard design intentionally updates an earlier visual design, follow the latest approved design without overriding existing business rules.

Before implementation:

1. Identify the current dashboard implementation and its completion status.
2. Identify reusable components and existing data models.
3. Map each requested metric to actual database fields and events.
4. Identify missing data or schema requirements.
5. Explain whether database migrations are necessary.
6. Identify conflicts with existing approved decisions.
7. Present a concise implementation plan in Hebrew.

Do not rebuild existing functional components unnecessarily.

Do not silently change previously approved functionality.

If a critical decision cannot be resolved from the existing documentation, ask me in Hebrew before implementing that specific behavior.

---

## 3. Dashboard Architecture

The Manager Dashboard must contain exactly three primary analytical tabs:

1. **כללי** — General Overview
2. **טכנאים** — Technician Performance
3. **מוצרים וספקים** — Products & Suppliers

The General tab is the default landing tab.

Each tab has a distinct purpose.

### General

Provides a complete high-level snapshot of the business without displaying detailed technician tables.

### Technicians

Provides technician-specific drill-down, with an individual technician selector and flexible date filtering.

### Products & Suppliers

Provides accumulated analysis of service calls by SKU, product, brand, and supplier.

Do not introduce additional primary dashboard tabs without approval.

---

# 4. General Dashboard — כללי

## 4.1 General Layout

This is the most important screen.

The manager should understand the current operational situation within a few seconds of opening the dashboard.

Layout order:

1. Today's field activity
2. Visit completion progress
3. Overall service performance metrics
4. Leading suppliers and products
5. Monthly service-call trends

Keep the layout spacious but compact enough to avoid unnecessary scrolling.

Use cards and concise labels rather than large tables.

### 4.2 Today's Field Activity

Section title:

**פעילות היום**

Display four KPI cards in one horizontal row on desktop:

| Metric | Hebrew label |
|---|---|
| Scheduled visits today | מתוכננים |
| Completed visits today | בוצעו |
| Scheduled visits not yet completed | טרם בוצעו |
| Visits not performed by their scheduled deadline | לא בוצעו במועד |

These values must come from real visit and scheduling records.

Do not confuse the total number of visits with the number of service calls.

Use the `Asia/Jerusalem` timezone when determining today's operational date.

The dashboard must handle future appointments correctly: a visit scheduled for later today must not be incorrectly flagged as overdue.

Use existing visit status definitions and approved scheduling rules.

Avoid double-counting visits or placing the same visit into incompatible operational categories.

### 4.3 Visit Progress Indicator

Immediately below the four cards, display a clean horizontal progress indicator.

Example:

**התקדמות הביקורים — 14 מתוך 24 (58%)**

Use:

- Blue for completed visits.
- Light gray for remaining visits.
- Muted red only for genuinely overdue or missed visits.

The progress indicator must visually represent the same underlying data as the KPI cards.

Completed percentage:

`completed scheduled visits / total scheduled visits × 100`

Handle zero scheduled visits gracefully.

### 4.4 Overall Service Performance

Section title:

**מדדי שירות**

Display four cards in a single horizontal row on desktop:

1. **זמן טיפול ממוצע** — Average treatment time
2. **זמן נסיעה ממוצע** — Average travel time
3. **פתרון בביקור ראשון** — First-visit resolution rate
4. **זמן סגירת קריאה** — Average service-call closure time

These are overall aggregated metrics across the relevant technician population, not individual technician metrics.

Do not show a technician breakdown on the General tab.

Calculation requirements:

**Average treatment time**
- Measured from actual treatment start to treatment completion.
- Use valid recorded timestamps.
- Exclude missing or invalid measurements.
- Display minutes.

**Average travel time**
- Measured from the recorded navigation start until documented arrival, according to the existing specification.
- Exclude visits without valid measurements.
- Display minutes.

**First-visit resolution rate**
- Calculate using unique service calls and their related visits.
- A service call resolved on the first visit qualifies.
- A service call requiring additional visits does not qualify as first-visit resolution.
- Use the approved resolution and visit definitions.

**Average service-call closure time**
- Based on actual call opening and closing timestamps.
- Use completed service calls with valid measurements.
- Display an understandable duration, using hours or days as appropriate.

All metrics must have clearly defined aggregation periods internally.

For the General tab, keep the primary operational snapshot focused on today, while using meaningful aggregate periods for broader service metrics according to approved business definitions.

Do not make users repeatedly configure filters just to view the General dashboard.

If the repository has no finalized aggregation-period definition for a specific service metric, identify that gap in the implementation plan rather than silently inventing one.

Missing measurements must never count as zero.

Do not calculate an average of technician averages when a weighted average based on actual events is required.

---

# 5. Leading Products & Suppliers — General Tab

Below the service metrics, display:

**מוצרים וספקים מובילים**

Two balanced cards, side by side.

RTL placement is important:

**RIGHT: Three leading suppliers**

Title:

**3 ספקים מובילים**

Display the three suppliers associated with the highest number of unique service calls.

Each row displays:
- Supplier name
- Number of service calls
- Horizontal comparison bar

**LEFT: Five leading SKUs**

Title:

**5 מק״טים מובילים**

Each row displays:
- SKU
- Product name where space allows
- Number of unique service calls
- Horizontal comparison bar

Use minimal horizontal bars in the approved blue/gray color palette.

This is a compact management summary, not the full product-analysis screen.

Default period: the latest 30 days, subject to confirming the approved metric definition.

Clearly label the period if the widget is period-based.

Clicking a supplier or SKU should navigate to the relevant filtered drill-down in Products & Suppliers, or open an existing compatible detail view.

Do not create an unrelated duplicate analytics module.

A repeated visit associated with an existing service call must not increase the unique service-call count.

---

# 6. Monthly Service-Call Trends — General Tab

Section title:

**מגמת קריאות שירות**

Display a single grouped bar chart comparing:

- **נפתחו** — Service calls opened
- **נסגרו** — Service calls closed

Use the approved colors:

- Opened: `#4677D5`
- Closed: `#697586`

Show the last six completed months by default.

Allow selection of:
- 3 months
- 6 months
- 12 months

Keep the graph visually simple.

Do not add unnecessary secondary charts.

Important:

A call opened in one month and closed in another is counted in each relevant event period.

Opened calls are grouped by opening date.

Closed calls are grouped by closure date.

Do not incorrectly require opened and closed counts to refer to the same service-call cohort.

Use actual historical dates rather than artificial demo multipliers.

Clicking a chart value should open the associated filtered service calls if the existing architecture supports the interaction safely.

---

# 7. Technicians Tab — טכנאים

## 7.1 Purpose

Provide performance analysis for one technician at a time.

This is a drill-down screen.

Do not compare technicians against one another by default.

Do not add trend charts or graphical performance comparisons.

The first version should focus on concise numerical metrics.

## 7.2 Compact Control Row

The top of the tab contains a single compact toolbar.

Desktop RTL layout:

**RIGHT: Technician buttons**

**CENTER: Date navigation**

**LEFT: Period selection**

All controls should fit into one aligned horizontal row when sufficient width is available.

### Technician Buttons

Every technician must have their own visible button.

Example:

`יורם | ארז | שמואל | דניאל`

These are examples only. Generate buttons dynamically from authorized actual technician records.

Requirements:
- No technician dropdown as the main selector.
- No next/previous technician arrows.
- Each technician is directly selectable.
- Active technician highlighted in blue.
- Inactive technician buttons use white backgrounds and subtle gray borders.
- Buttons should be compact.
- If more technicians exist, allow appropriate wrapping or horizontal scrolling without breaking mobile usability.

### Date Navigation

Position the selected date range and previous/next navigation controls in the CENTER of the toolbar.

Example:

`‹  נובמבר 2026  ›`

Maintain the correct direction and behavior for Hebrew RTL interfaces.

### Period Selection

Position period-selection buttons on the LEFT:

- יום
- שבוע
- חודש
- שנה
- מותאם

Default selection: Current month.

A custom range opens start and end date controls.

Period selection must update the technician metrics.

The selected technician and period must remain synchronized across the screen.

Keep the toolbar compact; do not place the technician selector and period controls in two large separate cards.

For mobile, allow a responsive rearrangement while retaining the direct technician buttons.

## 7.3 Technician Activity Metrics

Display numerical KPI cards for the selected technician and selected period.

Include:

- **ביקורים מתוכננים**
- **ביקורים שבוצעו**
- **קריאות שנסגרו**

The counts must respect the selected technician and period.

Use the repository's approved definitions of visit assignment, completion, and call ownership.

Do not count a visit multiple times because of status updates or repeated synchronization.

## 7.4 Technician Performance Metrics

Display:

- **זמן טיפול ממוצע**
- **זמן נסיעה ממוצע**
- **פתרון בביקור ראשון**
- **זמן סגירת קריאה ממוצע**
- **עמידה בתכנון**

Where a metric definition depends on existing business rules, follow the approved specification.

Do not invent a threshold or formula for schedule adherence.

All values must reflect the selected technician and time period.

No performance charts are required.

Use compact, consistent cards matching the General dashboard.

## 7.5 Drill-Down to Visits

Metrics should provide access to their underlying visit or service-call records where relevant.

Managers should be able to inspect:

- Visit details
- Treatment summaries
- Photos
- Recorded visit results
- Existing authorized attachments
- Visit and call status

Use existing visit-detail and report components.

Do not duplicate the visit management system inside the dashboard.

The dashboard provides analysis and navigation, not a separate operational workflow.

Do not automatically expose restricted media or data to unauthorized users.

---

# 8. Products & Suppliers Tab — מוצרים וספקים

## 8.1 Purpose

Provide accumulated historical analysis of product-related service calls.

**Important: Do not add monthly comparison charts or date-selection controls to this tab.**

By default, this tab analyzes the entire dataset accumulated since the application's first recorded service calls.

Dates must still be preserved in the database for future monthly, quarterly, and yearly reporting.

Do not discard or overwrite historical event dates.

## 8.2 Layout

Follow the approved compact layout:

Top row: two horizontal-bar-chart cards.

Below: a detailed SKU analysis table.

Use the established black, gray, and blue design language.

### RIGHT CARD — Calls by Supplier

Title:

**קריאות לפי ספק**

Rank suppliers according to the number of unique service calls associated with their products.

Display horizontal bars with numeric counts.

The bars must share a clear baseline and consistent scale.

### LEFT CARD — Calls by Brand

Title:

**קריאות לפי מותג**

Rank brands according to unique service-call counts.

Use the same visual style as the supplier chart.

Allow drill-down on individual brands or suppliers.

Handle missing brand or supplier mappings under:

**לא הוזן**

Do not silently remove unknown supplier or brand values from totals.

## 8.3 SKU Analysis Table

Title:

**מק״טים עם הכי הרבה קריאות**

Display the following columns in RTL order:

1. מק״ט
2. מוצר
3. מותג
4. ספק
5. קריאות
6. באחריות
7. % המשך טיפול
8. תקלה נפוצה

Column meaning:

**מק״ט**
- The existing normalized SKU identifier.

**מוצר**
- Product description/name.

**מותג**
- Associated brand, when available.

**ספק**
- Associated supplier, when available.

**קריאות**
- Number of unique service calls linked to that SKU.

**באחריות**
- Percentage of service calls recorded as warranty-covered, based on actual warranty data.
- Do not infer warranty from product age unless an approved rule explicitly authorizes it.

**% המשך טיפול**
- Percentage of service calls requiring follow-up treatment or an additional visit.
- A follow-up visit does not create a new service call.
- Use actual approved follow-up statuses.

**תקלה נפוצה**
- Most frequently recorded issue category for that SKU.
- Use structured call/issue classifications where they exist.
- Do not invent issue categories from unstructured text.

The table should:
- Be compact and easy to scan.
- Support sorting by call count.
- Show the highest-call SKUs first.
- Support clicking a SKU to inspect its associated calls.
- Remain readable on mobile using an appropriate responsive layout.
- Support pagination or efficient loading for large datasets.

Do not use arbitrary hard-coded example rows in production.

## 8.4 Business Logic

**One service call = one service call**, regardless of how many visits or follow-up actions are related to it.

Examples:

- One call with one visit = one call.
- One call with three visits = one call.
- One call requiring follow-up = one call.

A follow-up or repeat visit is not automatically an operational exception.

Avoid falsely inflating supplier or SKU counts.

If a call includes multiple SKUs, inspect the existing product relationship model and apply an explicit, documented attribution rule. Do not assume there is only one SKU per call.

Preserve SKU normalization and existing product-data rules.

Missing brand or supplier mappings should not prevent SKU-level analysis.

---

# 9. Visual Design System

Use the latest approved Manager Dashboard design, not the earlier demo styling where visual decisions have changed.

### Color Palette

- Main blue: `#4677D5`
- Dark text: `#222831`
- Secondary gray: `#6B7280`
- Comparison gray: `#697586`
- Background: `#F3F5F8`
- Card background: `#FFFFFF`
- Light border: `#E2E7EE`
- Subtle danger red: `#C14F4F`

Use blue for selected tabs, active controls, and important data.

Use dark text for KPI values.

Use gray for supporting information and secondary values.

Reserve red for genuine operational exceptions.

Do not use red for normal follow-up visits.

Avoid decorative gradients, excessive shadows, colorful charts, and unnecessary icons.

### Dashboard Cards

- White backgrounds
- Subtle borders
- Moderately rounded corners
- Consistent padding
- Clear typography
- Large values with small labels
- Equal-height cards where appropriate

### Layout

Use a consistent responsive content container.

Prefer clear alignment and compact visual hierarchy.

The dashboard should feel like a professional enterprise management system rather than a marketing page.

### Branding

Place the original MODY logo in the top header, on the left side opposite the Hebrew page title.

Use the supplied transparent-background PNG.

Important:
- No visible white rectangular background around the logo.
- Preserve original logo proportions.
- Do not distort or redraw the MODY branding.
- Avoid excessive surrounding whitespace.
- Ensure the logo blends naturally with the header background.

---

# 10. RTL and Responsive Requirements

The interface must be fully Hebrew and RTL.

Support:
- Desktop
- Tablet
- Mobile

Desktop is the main management experience, but all functionality must remain accessible on smaller screens.

Important details:
- Correct Hebrew reading order.
- Proper direction for period-navigation arrows.
- Correct placement of supplier and brand cards.
- Accurate right/left alignment of technician controls.
- Numeric values remain legible.
- SKU identifiers preserve their correct Latin-character order.
- No unwanted horizontal page overflow.

Use existing application breakpoints and reusable responsive components wherever possible.

---

# 11. Real Data and Supabase

The production dashboard must retrieve actual authorized data from Supabase.

Inspect the current schema before introducing changes.

Prefer existing entities and relationships for:
- Service calls
- Visits
- Technicians
- Visit schedules
- Visit outcomes
- Treatment timestamps
- Navigation timestamps
- Product SKUs
- Brands
- Suppliers
- Warranty status
- Follow-up outcomes
- Structured issue categories

Do not create duplicate source-of-truth tables.

Use aggregated queries or existing data-access patterns efficiently.

Avoid downloading all historical visit and service-call records to the browser merely to calculate dashboard metrics.

Use appropriate indexes or database-side aggregation when necessary.

Preserve historical dates and relationships needed for future reporting.

### Data Accuracy

Do not fabricate KPI results.

Do not replace missing data with zero.

Do not generate random or artificial statistics.

Do not calculate time metrics from assumed durations.

Where data is insufficient, display an appropriate unavailable state such as:

**אין מספיק נתונים**

For empty datasets, show an informative empty state rather than displaying fictitious results.

### Test Data

Test or simulated data is permitted only in approved test environments.

If test data is displayed in dashboards or exports, clearly label it:

**נתוני בדיקה**

Never mix test data into production metrics without an explicitly approved mechanism.

---

# 12. Security and Permissions

Respect all existing approved role and permission rules.

The dashboard must not bypass existing authorization checks.

Enforce access control both in the application and through Supabase RLS or the existing server authorization layer.

Do not assume client-side visibility is sufficient security.

Reuse existing role/permission logic for Manager and Creator access.

Do not modify the existing permission matrix or grant additional permissions as part of this dashboard implementation.

Use only the data that the authenticated user is authorized to view.

Avoid exposing confidential customer information in aggregate queries or browser logs.

No API keys or secrets should be included in committed source code.

---

# 13. Existing Integrations and Workflows

Do not change the existing Outlook/Microsoft 365 integration strategy.

The dashboard should consume service-call and visit data already present in the application's database.

Do not introduce:
- Outlook polling
- New Microsoft authentication
- New scheduling systems
- Additional external APIs
- Unapproved notification workflows

Preserve the existing application architecture.

Do not interfere with offline visit documentation or synchronization.

A newly synchronized visit must be reflected correctly in dashboard metrics after successful server persistence.

Do not count the same event twice due to retries or offline synchronization.

---

# 14. Interaction and Drill-Down

The dashboard should not be purely decorative.

Where metrics are clickable, actions must be functional.

Examples:

- Clicking a supplier displays relevant service calls.
- Clicking a SKU opens relevant call details.
- Clicking a technician changes the technician-specific metrics.
- Changing the period updates the technician data.
- Clicking an appropriate KPI opens supporting records.
- Clicking monthly chart values opens relevant calls when supported.

Prefer reusing existing filtered lists, modals, and detail screens.

Preserve navigation context where practical.

If an interaction cannot be supported by existing data or components, report the limitation instead of displaying a misleading button.

Do not implement fake success messages.

---

# 15. Performance

The dashboard must load efficiently even when the database contains large numbers of service calls.

Requirements:

- Avoid unnecessary client-side aggregation.
- Avoid redundant database requests.
- Use efficient queries.
- Provide loading states.
- Provide error states and retry actions.
- Handle missing data gracefully.
- Avoid layout shifts during data loading.
- Do not retrieve large media files for aggregate calculations.
- Ensure filters update the relevant data without unnecessary full-page reloads.

---

# 16. Testing

Add or update tests for:

**General**
- Correct daily visit totals.
- Correct overdue determination.
- Accurate visit completion percentage.
- Correct treatment and travel averages.
- Missing timestamp handling.
- Correct monthly opened/closed aggregation.

**Technicians**
- Switching between technician buttons.
- Changing period selection.
- Date navigation.
- Custom date ranges.
- Correct filtering by technician and period.
- Correct KPI calculations.
- Responsive toolbar layout.

**Products & Suppliers**
- Unique call counting by SKU.
- Follow-up visits not inflating totals.
- Supplier grouping.
- Brand grouping.
- Unknown supplier/brand handling.
- Warranty percentage.
- Follow-up percentage.
- Most frequent issue.
- Correct drill-down to source calls.

**Security**
- Unauthorized users cannot access restricted dashboard data.
- Server-side permission enforcement.
- Correct separation of test and production data.

**UI**
- Hebrew RTL.
- Mobile, tablet, and desktop.
- Correct logo rendering.
- No white background around the transparent logo.
- Correct chart colors.
- No unintended horizontal overflow.

Run existing project checks, including linting, TypeScript checks, and relevant automated tests.

Use the existing project testing workflow and avoid introducing unnecessary dependencies.

---

# 17. Scope Control

This task is specifically about the Manager Dashboard.

Do not redesign unrelated application screens.

Do not change:
- Authentication
- User management
- Existing service-call creation workflows
- Outlook integration behavior
- Offline synchronization rules
- Existing notification flows
- Previously approved permissions

Unless a change is technically required for the dashboard and explicitly approved.

Do not add advanced analytics that were not requested.

In particular:

**Do not add performance graphs to the Technician tab.**

Advanced comparisons and additional visualizations can be considered after the application is released and the manager provides real feedback.

---

# 18. Implementation and Delivery Process

Work in the following order.

### Phase A — Repository Audit

Inspect the current dashboard code, database relationships, visual assets, and relevant documentation.

Identify what already exists and what must change.

### Phase B — Implementation Plan

Before editing files, present a short plan in Hebrew containing:

1. Existing functionality to reuse.
2. UI changes required.
3. Database/query changes required.
4. Missing data or unresolved metric definitions.
5. Tests to be added or updated.
6. Potential risks to existing functionality.

Do not implement unresolved business rules based on guesses.

### Phase C — Implementation

After the plan is accepted, implement the dashboard using the existing project architecture.

Reuse existing components where appropriate.

Keep code modular and maintainable.

### Phase D — Verification

Run relevant automated checks and inspect the dashboard at mobile, tablet, and desktop widths.

Compare the result against the supplied approved demo.

### Phase E — Review

Provide a concise Hebrew summary of:

- What was implemented.
- What was reused.
- What database or schema changes were made.
- Which metrics are functional.
- Which metrics cannot yet be calculated reliably.
- Test results.
- Any unresolved issues.

Provide screenshots of the three tabs for visual review when the existing environment supports them.

Do not claim a feature is complete until its functionality has been verified.

Do not deploy to production or merge changes without following the project's existing approval and deployment process.

---

## Final Design Principle

The dashboard must follow this hierarchy:

**GENERAL = What is happening across the organization?**

**TECHNICIANS = How is a specific technician performing?**

**PRODUCTS & SUPPLIERS = Which products and suppliers generate the most service calls?**

All three tabs must share one consistent, polished, professional visual language.

Build the simplest reliable implementation that delivers the approved management experience.

Avoid unnecessary functionality, speculative business rules, or visual complexity.

**Start by auditing the repository and presenting the implementation plan in Hebrew. Do not start modifying the code until the plan has been reviewed and approved.**