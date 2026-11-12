import { notFound } from "next/navigation";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { isOfficeRole } from "../../../_data/roles";

// The dashboard's office frame (sidebar, logo, ≤900px top bar) as a segment layout (spec-final
// §6.10): loading.tsx and error.tsx render inside it, so the frame never disappears or jumps while
// the dashboard loads or fails, and a layout is not re-rendered when only the search params change
// (tabs, periods, the dialog). The page renders the content of main.work only. The role's own
// checks stay in the page (permissions, tabs; display only, G-04).
export default async function AnalyticsLayout({ children, params }: LayoutProps<"/dev/demo/office/[role]/analytics">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  return (
    <DemoOfficeFrame role={role} active="analytics">
      {children}
    </DemoOfficeFrame>
  );
}
