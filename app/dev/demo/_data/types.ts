// FICTITIOUS DATA ONLY: types of the demo's fictional records. Allowed only under app/dev (G-05).
// Field names follow docs/demo.html so its screen code ports one to one; fields marked ADD
// come from demo-deviations rows the demo lacks.
import type { CallStatus } from "@/components/ui/CallStatusPill";
import type { VisitStatus } from "@/components/ui/StatusPill";
import type { VisitSource } from "@/components/ui/TestBadge";

export type { CallStatus, VisitSource, VisitStatus };

export type TechId = "y" | "e" | "s";

export type Tech = {
  id: TechId;
  name: string;
  /** CSS colour token, e.g. "var(--t-y)". */
  color: string;
  phone: string;
  /** Outlook attendee address (example.test). */
  email: string;
};

export type Place = { name: string; type: string; addr: string; phone: string; hours: string; on: boolean };

export type Product = {
  sku: string;
  name: string;
  brand: string;
  /** Supplier. */
  sup: string;
  /** Seed weight only. */
  w: number;
  issues: readonly string[];
};

export type Reason = { name: string; on: boolean; w: number };

export type OfficeRole = "mgr" | "cs";
export type UserRole = "creator" | OfficeRole;

export type User = { name: string; email: string; role: UserRole; phone: string };

export type MediaItem = { t: "img" | "vid"; when: "before" | "after" };

export type Visit = {
  /** Visit number within the call (1, 2, ...). */
  n: number;
  /** Task number ("מספר משימה") from the invitation. */
  task: number;
  tech: TechId;
  date: string;
  start: string;
  end: string;
  status: VisitStatus;
  /** Field times, recorded in the background and shown only to the office (TE-25 pending). */
  departAt: string | null;
  arriveAt: string | null;
  endAt: string | null;
  /** Follow-up reason (status "cont"). */
  reason: string | null;
  summary: string;
  /** Recording length in seconds; 0 = no recording. */
  rec: number;
  media: MediaItem[];
  /** Signer name (status "done"). */
  signer: string | null;
  /** Item to pick up before the visit, and where from (a PLACES name). */
  collect: string;
  collectFrom: string;
  /** ADD (TE-06, TE-15, D36): approved transcription of the recording; "" when none. */
  transcript: string;
  /** ADD (TE-17): parts replaced. */
  parts: string[];
  /** ADD (TE-21): "מה צריך בביקור הבא" (follow-up only). */
  nextNote: string;
  /** ADD (TE-19, D43): approval text preserved at signing; null when not signed. */
  signedText: string | null;
  /** ADD (SIM-14): where the visit came from: Microsoft 365 ("outlook") or the simulator. */
  source: VisitSource;
};

export type Call = {
  /** Request number ("מספר פנייה"), unique. */
  req: string;
  /** ADD (TE-09, OF-05): customer number ("מספר לקוח"). */
  customerNo: string;
  customer: string;
  phone: string;
  phone2: string;
  city: string;
  street: string;
  building: string;
  floor: string;
  apt: string;
  /** Arrival notes ("הערות הגעה"). */
  arrival: string;
  /** Call type: "תיקון" | "התקנה". */
  type: string;
  sku: string;
  /** Fault description. */
  desc: string;
  /** "כן" / "לא" / "כן · עד 03/2028". */
  warranty: string;
  /** Handling rep name (a USERS name). */
  rep: string;
  /** ADD (TE-10): "הערות לטכנאי". */
  techNote: string;
  /** D47 / SIM-15: every demo record is test data. */
  isTest: true;
  /** Ordered by visit number. */
  visits: Visit[];
};

export type NotificationKind = "new" | "follow" | "change" | "cancel";

export type DemoNotification = {
  id: number;
  kind: NotificationKind;
  title: string;
  sub: string;
  time: string;
  req?: string;
  n?: number;
  read: boolean;
};
