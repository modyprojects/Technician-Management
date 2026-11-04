// Input checks for the outbox viewer (read-only). Pure.
import { isUuid } from "@/features/data-access/common";

const KEY = /^[A-Za-z0-9-]{1,64}$/;

/** Outbox ids: fixture keys now, database UUIDs later. */
export const isOutboxId = (value: unknown): value is string => isUuid(value) || (typeof value === "string" && KEY.test(value));
