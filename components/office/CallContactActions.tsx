import type { ReactNode } from "react";

// Header actions of the office call card, V1 (owner 2026-11-19, c): call the technician and call
// the customer, both `tel:` links with the .btn look. No call cancellation. A number that is
// missing shows no button. Presentational: the caller picks the technician (the last visit's).

const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, "")}`;

function DialLink({ phone, children }: { phone: string; children: ReactNode }) {
  return (
    <a className="btn" href={telHref(phone)}>
      <span aria-hidden="true">📞 </span>
      {children}
    </a>
  );
}

export function CallContactActions({
  tech,
  customer,
}: {
  tech: { name: string; phone: string } | null;
  customer: { name: string; phone: string };
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {tech?.phone && <DialLink phone={tech.phone}>התקשר לטכנאי</DialLink>}
      {customer.phone && <DialLink phone={customer.phone}>התקשר ללקוח</DialLink>}
    </div>
  );
}
