import Link from "next/link";
import { TestPill } from "@/components/ui/TestBadge";
import type { TechnicianProfile } from "@/features/profile/data/types";

// Header of the technician's profile (docs/demo.html techProfile() head L684 and the "› חזרה"
// line phone() adds on the profile, L449; TE-29): back link, avatar in the technician's colour
// with his initial, name, "טכנאי שירות · phone". Addition: the 🧪 badge on a test user (SIM-18,
// D47).
// Every top-level element is its own child of .ph-head, so above 900px it aligns with the 760px
// content column (TE-31). Presentational: the caller passes the DTO and the back link.

export function ProfileHeader({ profile, backHref }: { profile: TechnicianProfile; backHref: string }) {
  const t = profile.technician;
  return (
    <>
      <div>
        <Link className="ph-back" href={backHref} aria-label="חזרה למסך היום">
          <span aria-hidden="true">› </span>
          חזרה
        </Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: 6 }}>
        <span
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: t.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--display)",
            fontSize: 24,
            flex: "none",
          }}
        >
          {t.name.trim().charAt(0)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 22 }}>{t.name}</h1>
            {profile.isTest && <TestPill />}
          </div>
          <div className="sub" style={{ color: "var(--on-dark2)" }}>
            טכנאי שירות · <span dir="ltr">{t.phone}</span>
          </div>
        </div>
      </div>
    </>
  );
}
