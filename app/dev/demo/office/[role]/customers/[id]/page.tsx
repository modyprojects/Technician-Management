import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CALL_STATUSES } from "@/components/ui/CallStatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import { callsListHref } from "@/features/calls/data/search-params";
import { DemoOfficeFrame } from "../../../../_components/DemoFrames";
import { demoDataAccess } from "../../../../_data/adapter";
import { dayLabel, ddmm } from "../../../../_data/dates";
import { officeCustomerParams } from "../../../../_data/params";
import { customersOffered, isOfficeRole, officeHomeLabel } from "../../../../_data/roles";
import { demoHref } from "../../../../_data/routes";
import { NoAccessPlaceholder, ScreenPlaceholder } from "../../_Placeholder";

// Every customer for every office role is built: a role without `calls` gets "אין הרשאה".
export const dynamicParams = false;

export function generateStaticParams() {
  return officeCustomerParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/customers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const x = await demoDataAccess.customers.get(id);
  return { title: x ? `${x.name} · לקוח ${x.number} · הדגמה` : "כרטיס לקוח · הדגמה" };
}

// Customer card (spec office screens, OF-16; matrix key `calls`): the customer's details, every
// call with its service-call status (D38) and visits, and the products that came back
// (PRODUCT_RETURN_WINDOW_DAYS, temporary). 🧪 on test customers and products (SIM-16, SIM-17).
// PHASE F SCAFFOLD: placeholder lists; the screen replaces them. Reads only through the layer:
// customers.get and reference.permissions (display only, G-04).
export default async function OfficeCustomerPage({ params }: PageProps<"/dev/demo/office/[role]/customers/[id]">) {
  const { role, id } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  if (!customersOffered(permissions)) {
    return (
      <DemoOfficeFrame role={role} active="customers">
        <NoAccessPlaceholder
          id="customer-no-access"
          text="לתפקיד הזה אין צפייה בקריאות ובלקוחות."
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
        />
      </DemoOfficeFrame>
    );
  }
  const x = await demoDataAccess.customers.get(id);
  if (!x) notFound();

  return (
    <DemoOfficeFrame role={role} active="customers">
      <div>
        <Link className="btn" href={demoHref.customers(role)} style={{ padding: "6px 12px" }}>
          <span aria-hidden="true">› </span>
          חזרה ללקוחות
        </Link>
      </div>
      <div className="ptitle">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 26 }}>{x.name}</h1>
            {x.isTest && <TestBadge />}
          </div>
          <div className="sub">
            מספר לקוח <span className="num">{x.number}</span> ·{" "}
            <span dir="ltr" className="num">
              {x.phone}
            </span>{" "}
            · {x.latestAddress.street}, {x.latestAddress.city}
          </div>
        </div>
      </div>
      <div className="grid">
        <ScreenPlaceholder
          id="customer-calls"
          heading="קריאות הלקוח"
          note="המסך בבנייה (שלב F)"
          total={x.calls.total}
          rows={x.calls.items.map((c) => ({
            key: c.req,
            href: demoHref.call(role, c.req),
            primary: `פנייה ${c.req} · ${c.product.name}`,
            secondary: `${CALL_STATUSES[c.status].label} · ${c.visitCount} ביקורים · ביקור אחרון ${dayLabel(c.latestVisit.date)}`,
            isTest: c.isTest,
          }))}
          footer={
            x.calls.total > x.calls.items.length ? (
              <Link className="lnk" href={callsListHref(demoHref.calls(role), { q: x.number, status: "all", tech: "all", page: 1 })}>
                לכל הקריאות של הלקוח ›
              </Link>
            ) : undefined
          }
        />
        <ScreenPlaceholder
          id="customer-products"
          heading="מוצרים"
          note="חזר: קריאה חדשה על אותו מק״ט תוך זמן קצר"
          total={x.products.total}
          rows={x.products.items.map((p) => ({
            key: p.product.sku,
            primary: `${p.product.name} · ${p.product.sku}${p.cameBack ? " · חזר" : ""}`,
            secondary: `${p.callCount} קריאות · ${ddmm(p.firstDate)}–${ddmm(p.lastDate)}${p.returns.items
              .map((r) => ` · ${r.req} אחרי ${r.days} ימים`)
              .join("")}`,
            isTest: p.product.isTest,
          }))}
        />
      </div>
    </DemoOfficeFrame>
  );
}
