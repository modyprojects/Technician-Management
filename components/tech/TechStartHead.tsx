import Link from "next/link";
import { TestPill } from "@/components/ui/TestBadge";

// The technician header of the temporary start screen and the minimal profile (Step 2 PR 2.3;
// TEMPORARY, Step 2 plan Q18; AU-03, AU-04 PROPOSED): an optional "› חזרה" to the start screen, the
// title with the 🧪 badge of a test user (SIM-18) and an optional line under it. No hooks.
// Every top-level element is its own child of .ph-head, so above 900px it aligns with the 760px
// content column (TE-31, as ProfileHeader).

export function TechStartHead({ title, isTest, sub, backHref }: { title: string; isTest: boolean; sub?: string; backHref?: string }) {
  return (
    <>
      {backHref && (
        <div>
          <Link className="ph-back" href={backHref} aria-label="חזרה למסך הפתיחה">
            <span aria-hidden="true">› </span>
            חזרה
          </Link>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: backHref ? 6 : 0 }}>
        <h1 style={{ fontSize: 22 }}>{title}</h1>
        {isTest && <TestPill />}
      </div>
      {sub && (
        <div className="sub" style={{ color: "var(--on-dark2)" }}>
          {sub}
        </div>
      )}
    </>
  );
}
