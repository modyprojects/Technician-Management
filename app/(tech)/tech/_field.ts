import type { FieldActions } from "@/features/visits/data/field-actions";
import { addVisitPhoto, arriveVisit, closeVisit, departVisit } from "@/lib/actions/tech-visits";

/** The real field actions handed to the technician's client components (components/ never imports lib/actions). */
export const FIELD_ACTIONS: FieldActions = { departVisit, arriveVisit, addVisitPhoto, closeVisit };
