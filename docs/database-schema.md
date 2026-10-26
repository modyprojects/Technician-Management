# Proposed Database Schema — NOT Approved for Execution

**Status:** architectural proposal, updated 2026-10-26. Columns, ownership, delete behavior, permissions and RLS require approval **before any migration** (Step 1).

## Conventions
UUID primary keys. Business identifiers (`request_number`, `task_number`, `customer_number`, `sku`) stored separately. `created_at` / `updated_at` on business tables; `timestamptz` in UTC, displayed in `Asia/Jerusalem`. Explicit foreign keys, checks and indexes.

**Test-data marker (D24):** `customers`, `service_calls`, `visits`, `products` and `external_calendar_events` carry `data_source` (`simulator` | `microsoft_graph`) or an equivalent `is_test` flag. In test environments KPIs and exports include test data (labeled "נתוני בדיקה" in the UI and files); in production, KPI and export queries ignore test-marked records. Real email delivery always skips test data. The marker also drives the visit source label.

| Table | Responsibility | Key relationships / notes |
|---|---|---|
| `profiles` | Account details and assigned role | `id` → `auth.users.id` |
| `roles`, `permissions`, `role_permissions` | Role/permission matrix | Fixed vs. editable matrix is OPEN (decisions.md open #1). Enforced in RLS either way |
| `technicians` | Technician contact, color, Outlook email, active state | `profile_id` → `profiles.id`; unique Outlook email (used to match invitation attendees) |
| `customers` | Customer registry | **`customer_number` required and unique** (D17) |
| `products` | Built from invitations (D19) | **`sku_normalized` unique** (trimmed, upper-case); `sku_display`; `name` (first seen, never overwritten by ingestion); `brand_id` and `supplier_id` **nullable** |
| `brands`, `suppliers` | Optional reference data for analysis | Filled by authorized users later |
| `service_calls` | A business service request | `customer_id`, `product_id`, unique `request_number`; `warranty` nullable (D17) |
| `visits` | One technician appointment | `service_call_id`, `technician_id`, `task_number`, scheduled and actual timestamps (departed, arrived, ended), status, `version`, `next_visit_notes` (required when status = follow-up) |
| `visit_media` | Photos, video, audio, signatures | `visit_id`, private bucket path, type, before/after, metadata |
| `visit_transcripts` | Audio processing and approved summary text | `visit_id`, processing state, reviewed text, reviewer, version |
| `visit_parts` | Parts replaced | `visit_id`, free text and optional `product_id` |
| `visit_corrections` | Audited corrections | original values or immutable change-set, actor, reason, timestamp |
| `offline_operations` | Server-side idempotency for device sync | unique operation UUID, visit, actor, version, result |
| `followup_reasons` | Follow-up reason catalog | Deactivate instead of delete |
| `collection_locations` | Pickup places | Deactivate when referenced |
| `visit_collections` | Visit pickup items | `visit_id`, location, collected flag + collected_by/at |
| `notifications` | In-app notifications | `recipient_profile_id`, optional `visit_id`; created by events only (D25) |
| `email_outbox` | Logical outgoing email events | unique `(visit_id, event_type)`; recipients resolved server-side; never delivered for test data |
| `email_delivery_attempts` | Attempts, provider status, errors | `outbox_id` |
| `external_calendar_events` | Event identity for simulator and Graph | `source`, calendar ID, event ID, `visit_id`, composite unique (`source`, `calendar_id`, `event_id`) |
| `calendar_ingestion_errors` | Invitations not ingested | missing/invalid fields, sanitized details, resolved flag; feeds the "זימונים שלא נקלטו" screen |
| `audit_logs` | Sensitive administrative actions | actor, action, target, timestamp, minimal metadata |

## Relationships
`customers 1—n service_calls 1—n visits 1—n visit_media`; `technicians 1—n visits`; `products 1—n service_calls`; `visits 1—n visit_parts`; `visits 1—n email_outbox` (distinct event types only); `external_calendar_events n—1 visits`.

## Integrity and performance
- Allowed statuses and outcome-specific required fields enforced in the database where practical, plus Zod on the server.
- Product upsert by `sku_normalized` uses `INSERT … ON CONFLICT DO NOTHING` (or equivalent) so concurrent or repeated invitations cannot create duplicates; existing `name` is never updated by ingestion.
- Unique event IDs and offline operation IDs make replays idempotent.
- Concurrent edits: row locks in transactions or optimistic `version` checks.
- Candidate indexes: `visits(technician_id, scheduled_start)`, `visits(service_call_id)`, `service_calls(request_number)`, `customers(customer_number)`, `products(sku_normalized)`, `email_outbox(status, next_attempt_at)`, `audit_logs(created_at)`.
- Never cascade-delete historical media or completed visits. Deactivate reference data and accounts. Retention rules OPEN.
- RLS on every exposed table and private Storage policies. No views or definer functions that bypass authorization.
- Visit completion and its outbox event are written in one transaction.

## Explicitly prohibited
No ONE-related table, column, status, flag, export or adapter.

## Approval checklist for any migration
ER diagram, columns and types, PK/FK, `ON DELETE` behavior, constraints, indexes, RLS by role, positive and negative permission tests, rollout risks, rollback plan. Ask for approval **before executing**.
