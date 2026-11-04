// Input checks for reference ids, shared by every implementation (fixtures now, the server later;
// the server always re-validates).
import { isRecordKey, isUuid } from "@/features/data-access/common";
import type { TechnicianId } from "./types";

/**
 * Technician id: a profile id (uuid, 36 characters) in the database, or a short key in the
 * fictional fixtures ("y"). Request numbers keep isRecordKey (at most 32 characters).
 */
export const isTechnicianId = (value: unknown): value is TechnicianId => isUuid(value) || isRecordKey(value);
