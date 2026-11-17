// The database's answer (private.ingest_calendar_event returns jsonb), validated before anyone uses
// it: a store never passes an unchecked database value to a caller. Pure.
import { z } from "zod";
import { CONFLICT_RULES, INGESTION_OUTCOMES, INVALID_RULES, type IngestionOutcome, type IngestionProblem } from "./types";

const PROBLEM_FIELDS = [
  "req", "task", "rep", "customerNo", "customer", "phone", "phone2", "city", "street", "building", "floor", "apt",
  "arrival", "type", "product", "sku", "desc", "warranty", "collect", "collectFrom", "techNote",
  "subject", "attendee", "organizer", "schedule", "body",
] as const;

const value = z.string().max(200).nullable();
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const field = z.enum(PROBLEM_FIELDS);

export const problemSchema: z.ZodType<IngestionProblem> = z.union([
  z.object({ kind: z.literal("missing"), field }),
  z.object({ kind: z.literal("invalid"), field, rule: z.enum(INVALID_RULES), value }),
  z.object({ kind: z.literal("unknown_place"), field: z.literal("collectFrom"), value }),
  z.object({ kind: z.enum(["unknown_technician", "inactive_technician", "ambiguous_technician"]), field: z.literal("attendee"), value }),
  z.object({ kind: z.literal("conflict"), field, rule: z.enum(CONFLICT_RULES), value }),
]);

const outcomeSchema = z.object({
  outcome: z.enum(INGESTION_OUTCOMES),
  replay: z.boolean(),
  change_id: uuid,
  request_number: z.string().nullable(),
  visit_number: z.number().int().nullable(),
  service_call_id: uuid.nullable(),
  visit_id: uuid.nullable(),
  review_items: z.number().int().min(0),
  applied_fields: z.array(z.string().max(64)).max(64),
  problems: z.array(problemSchema).max(30),
});

/** The validated outcome, or null when the database answered something else. */
export function parseIngestionOutcome(data: unknown): IngestionOutcome | null {
  const parsed = outcomeSchema.safeParse(data);
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    outcome: d.outcome,
    replay: d.replay,
    changeId: d.change_id,
    requestNumber: d.request_number,
    visitNumber: d.visit_number,
    serviceCallId: d.service_call_id,
    visitId: d.visit_id,
    reviewItems: d.review_items,
    appliedFields: d.applied_fields,
    problems: d.problems,
  };
}
