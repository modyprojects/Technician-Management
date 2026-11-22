import type { Metadata } from "next";
import { TechVisitView } from "../_view";

export const metadata: Metadata = { title: "סיום ביקור · ניהול טכנאים" };

// The visit flow opened on the close screen (TE-18 to TE-22); a visit not in treatment shows its card.
export default async function TechVisitClosePage({ params }: PageProps<"/tech/visit/[id]/close">) {
  const { id } = await params;
  return <TechVisitView id={id} step="close" />;
}
