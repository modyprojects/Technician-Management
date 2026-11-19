// The real navigation and contact links of the technician screens (TE-02, TE-03, TE-07), in the
// demo's look (docs/demo.html techCall() L525-529 action tiles and the pickup "Waze ›"):
// - "Waze": a Waze deep link to the visit's address; "Waze ›" to a pickup place;
// - "לקוח": `tel:` to the customer; "וואטסאפ": a WhatsApp chat with the customer;
// - "נציגה": `tel:` to the handling representative's work phone from her profile (TE-07, D40), shown
//   disabled when there is none.
// Plain links (features/visits/data/links.ts): nothing is recorded and no external service is called
// by the app. A value that is not a phone number or an address gets a disabled tile, never a broken
// link. No hooks: usable from Server Components.
import type { CSSProperties, ReactNode } from "react";
import { PhoneIcon, PinIcon, UserIcon, WhatsAppIcon } from "@/components/ui/Icons";
import { telHref, wazeHref, whatsappHref } from "@/features/visits/data/links";

const LINK_LOOK: CSSProperties = {
  fontSize: 12,
  color: "var(--accent)",
  fontWeight: 700,
  whiteSpace: "nowrap",
  // At least 24px tall (WCAG 2.5.8).
  padding: "5px 0",
  textDecoration: "none",
};

/** "Waze ›" to a pickup place (demo "wazePlace"); nothing when the place has no address. */
export function PlaceWazeLink({ place, address }: { place: string; address: string | null }) {
  const href = address ? wazeHref(address) : null;
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={LINK_LOOK} aria-label={`Waze · ניווט אל ${place}`}>
      Waze <span aria-hidden="true">›</span>
    </a>
  );
}

function Tile({ href, icon, label, ariaLabel, primary = false, external = false }: { href: string | null; icon: ReactNode; label: string; ariaLabel: string; primary?: boolean; external?: boolean }) {
  const look: CSSProperties = primary ? { background: "var(--accent)", color: "var(--on-dark)", borderColor: "var(--accent)" } : {};
  if (!href) {
    return (
      <span className="act" role="link" aria-disabled="true" aria-label={ariaLabel} style={{ ...look, opacity: 0.45 }}>
        {icon}
        {label}
      </span>
    );
  }
  return (
    <a
      className="act"
      href={href}
      aria-label={ariaLabel}
      style={look}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : null)}
    >
      {icon}
      {label}
    </a>
  );
}

/** The four action tiles of an open visit (TE-07): Waze, customer, WhatsApp, representative. */
export function VisitContactTiles({
  address,
  customerPhone,
  rep,
  waze,
}: {
  address: string;
  customerPhone: string;
  rep: { name: string; phone: string | null };
  /** Replaces the Waze tile (the visit flow's "יוצא · Waze", which also records the departure). */
  waze?: ReactNode;
}) {
  const repPhone = rep.phone ? telHref(rep.phone) : null;
  return (
    <div role="group" aria-label="ניווט ויצירת קשר" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
      {waze ?? <Tile href={wazeHref(address)} icon={<PinIcon />} label="Waze" ariaLabel={`Waze · ניווט אל ${address}`} primary external />}
      <Tile href={telHref(customerPhone)} icon={<PhoneIcon />} label="לקוח" ariaLabel={`לקוח · חיוג ${customerPhone}`} />
      <Tile href={whatsappHref(customerPhone)} icon={<WhatsAppIcon />} label="וואטסאפ" ariaLabel={`וואטסאפ ללקוח · ${customerPhone}`} external />
      <Tile
        href={repPhone}
        icon={<UserIcon />}
        label="נציגה"
        ariaLabel={repPhone && rep.phone ? `נציגה · חיוג ל${rep.name} ${rep.phone}` : `נציגה · ${rep.name || "לא ידועה"} · אין מספר טלפון`}
      />
    </div>
  );
}
