import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth/guards";
import { techVisitsQueries } from "@/lib/data/supabase/tech-visits";
import { stepOf } from "@/features/visit-flow/steps";
import { VisitScreen } from "./_view";

export const metadata: Metadata = { title: "כרטיס ביקור · ניהול טכנאים" };

// The technician's visit card and flow (D95); see ./_view.tsx. `?step=work|close` opens the flow on
// the work or close screen (a visit not in treatment shows its card).
export default async function TechVisitPage({ params, searchParams }: PageProps<"/tech/visit/[id]">) {
  const me = await requireArea("tech");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const view = await (await techVisitsQueries(me)).visit(id);
  if (!view) notFound();
  return <VisitScreen me={me} view={view} step={stepOf(typeof sp.step === "string" ? sp.step : null)} />;
}
