import type { Metadata } from "next";
import { TechVisitView } from "../_view";

export const metadata: Metadata = { title: "טיפול · ניהול טכנאים" };

// The visit flow opened on the work screen (TE-14, TE-15); a visit not in treatment shows its card.
export default async function TechVisitWorkPage({ params }: PageProps<"/tech/visit/[id]/work">) {
  const { id } = await params;
  return <TechVisitView id={id} step="work" />;
}
