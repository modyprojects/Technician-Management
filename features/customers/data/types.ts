// Customer DTOs. Pure types (no data). See features/data-access/common.ts.
import type { TestMarker } from "@/features/data-access/common";

export type Address = {
  city: string;
  /** Street and house number, e.g. "הרצל 14". */
  street: string;
  building: string;
  floor: string;
  apt: string;
};

/** The customer as an invitation describes it (TE-09: customer number required, OF-05). */
export type Customer = TestMarker & {
  name: string;
  /** "מספר לקוח". */
  number: string;
  phone: string;
  /** Second phone; "" when none. */
  phone2: string;
  address: Address;
  /** "הערות הגעה"; "" when none. */
  arrivalNotes: string;
};
