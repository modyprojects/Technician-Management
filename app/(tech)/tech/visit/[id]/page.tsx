import type { Metadata } from "next";
import { TechVisitView } from "./_view";

export const metadata: Metadata = { title: "כרטיס ביקור · ניהול טכנאים" };

// The technician's visit card and flow (D95); see ./_view.tsx.
export default async function TechVisitPage({ params }: PageProps<"/tech/visit/[id]">) {
  const { id } = await params;
  return <TechVisitView id={id} step="card" />;
}
