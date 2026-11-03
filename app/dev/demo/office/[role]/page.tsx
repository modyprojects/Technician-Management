import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoOfficeFrame } from "../../_components/DemoFrames";
import { Placeholder } from "../../_components/Placeholder";
import { demoHref, isOfficeRole, officeRoleParams, VIEWPOINTS } from "../../_data";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `${role === "mgr" ? "לוח בקרה" : "בית"} · ${VIEWPOINTS[role].label} · הדגמה` };
}

// Office home for a role. Placeholder until the office-home screen replaces it.
export default async function OfficeHomePage({ params }: PageProps<"/dev/demo/office/[role]">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  return (
    <DemoOfficeFrame role={role} active="home">
      <div className="ptitle">
        <div>
          <h1>{role === "mgr" ? "לוח בקרה" : "בית"}</h1>
          <div className="sub">יום רביעי 21.10.2026</div>
        </div>
      </div>
      <Placeholder screen="מסך הבית" />
      <div>
        <Link className="btn pri" href={demoHref.calls(role)}>
          לקריאות ›
        </Link>
      </div>
    </DemoOfficeFrame>
  );
}
