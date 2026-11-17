// The single calendar ingestion service (Step 6). See ./types.ts for the flow.
export { DEFAULT_INVITATION_TEMPLATE, effectiveTemplate, type InvitationTemplate, type TemplateField } from "./template";
export { invitationEventSchema, isoTimestampSchema, parseInvitationEvent, MAX_ATTENDEES } from "./event";
export { parseInvitationBody, parseWarranty, normalizeSku, MAX_BODY_LENGTH, type ParseResult } from "./parse";
export { planIngestion, toDatabaseCommand, MAX_SUBJECT_LENGTH, type IngestionPlan } from "./plan";
export { ingestInvitation, decideDelivery, type DeliveryState, type IncomingDelivery } from "./service";
export { parseIngestionOutcome, problemSchema } from "./outcome";
export * from "./types";
