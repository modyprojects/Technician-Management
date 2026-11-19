import type { VisitStatus } from "@/features/visits/data/types";

// Technician calendar skeleton (D81): the shape of the fake days. Every record is test data (D74).
export type FakeVisit = {
  id: string;
  start: string;
  end: string;
  customer: string;
  city: string;
  product: string;
  status: VisitStatus;
  isFollowUp?: boolean;
};

export type FakeDay = { date: string; visits: FakeVisit[] };

export type TechCalView = "day" | "week";
