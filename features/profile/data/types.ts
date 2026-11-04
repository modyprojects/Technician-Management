// Technician profile DTO (docs/demo.html techProfile() L681-693; TE-29, TE-30). Display only:
// name, phone, this week's figures and the office phone (what the demo shows; no email). The notification toggles are
// notifications.preferences(userId) (saved with notifications.setPreferences). Pure types (no data).
import type { IsoDate, TestMarker } from "@/features/data-access/common";
import type { TechnicianRef } from "@/features/reference/data/types";

export type TechnicianProfile = TestMarker & {
  technician: TechnicianRef;
  /** The work week (Sunday to Thursday) containing the date asked for; cancelled visits excluded. */
  week: {
    weekStart: IsoDate;
    /** "ביקורים השבוע". */
    visits: number;
    /** "טופלו": closed as "טופל". */
    done: number;
  };
  /** "חיוג למשרד"; null when the office phone is not set. */
  officePhone: string | null;
};
