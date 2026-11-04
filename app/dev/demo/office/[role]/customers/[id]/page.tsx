import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerCard } from "@/components/office/CustomerCard";
import { CALL_STATUS_ORDER } from "@/components/ui/CallStatusPill";
import { callsListHref } from "@/features/calls/data/search-params";
import type { CallStatus } from "@/features/calls/data/types";
import type { OfficeRole } from "@/features/reference/data/types";
import { DemoOfficeFrame } from "../../../../_components/DemoFrames";
import { demoDataAccess } from "../../../../_data/adapter";
import { TODAY } from "../../../../_data/dates";
import { officeCustomerParams } from "../../../../_data/params";
import { customersOffered, isOfficeRole, officeHomeLabel, productsOffered } from "../../../../_data/roles";
import { demoHref } from "../../../../_data/routes";
import { NoAccessPlaceholder } from "../../_Placeholder";
import { RETURN_WINDOW_NOTE } from "../../_pendingNotes";

// Every customer for every office role is built: a role without `calls` gets "אין הרשאה".
export const dynamicParams = false;

export function generateStaticParams() {
  return officeCustomerParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/customers/[id]">): Promise<Metadata> {
  const { role, id } = await params;
  if (!isOfficeRole(role)) return {};
  // A role without `calls` reads no customer data, not even for the page title.
  const permissions = await demoDataAccess.reference.permissions(role);
  if (!customersOffered(permissions)) return { title: "כרטיס לקוח · הדגמה" };
  const x = await demoDataAccess.customers.get(id);
  return { title: x ? `${x.name} · לקוח ${x.number} · הדגמה` : "כרטיס לקוח · הדגמה" };
}

/** The calls list searched by the customer number (OF-05), every status or one. */
const customerCallsHref = (role: OfficeRole, number: string, status: "all" | CallStatus): string =>
  callsListHref(demoHref.calls(role), { q: number, status, tech: "all", page: 1 });

// Customer card (spec office screens "Customers and customer card", OF-16; matrix key `calls`):
// details from the latest invitation and the latest visit's address (D39), counters per
// service-call status (D38) linked to the calls list, every call of the customer (bounded, newest
// first) and the products that came back within the DTO's returnWindowDays (temporary). 🧪 on test
// customers, calls and products (SIM-15 to SIM-17). An unknown id is a 404. Reads only through
// the layer: customers.get and reference.permissions (display only, G-04).
export default async function OfficeCustomerPage({ params }: PageProps<"/dev/demo/office/[role]/customers/[id]">) {
  const { role, id } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  if (!customersOffered(permissions)) {
    return (
      <DemoOfficeFrame role={role} active="customers">
        <div className="ptitle">
          <div>
            <h1>כרטיס לקוח</h1>
          </div>
        </div>
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

  // Call cards of the listed calls and of the returns (the earlier call may be outside the bounded list).
  const reqs = new Set([
    ...x.calls.items.map((c) => c.req),
    ...x.products.items.flatMap((p) => p.returns.items.flatMap((r) => [r.req, r.previousReq])),
  ]);
  const callHrefs = Object.fromEntries([...reqs].map((req) => [req, demoHref.call(role, req)]));
  const statusHrefs = Object.fromEntries(
    (["all", ...CALL_STATUS_ORDER] as const).map((s) => [s, customerCallsHref(role, x.number, s)]),
  ) as Record<"all" | CallStatus, string>;
  // "מוצרים" only for roles it is offered to (matrix key `products`; display only).
  const productHrefs = productsOffered(permissions)
    ? Object.fromEntries(x.products.items.map((p) => [p.product.sku, demoHref.products(role, { q: p.product.sku })]))
    : {};

  return (
    <DemoOfficeFrame role={role} active="customers">
      <CustomerCard
        customer={x}
        today={TODAY}
        backHref={demoHref.customers(role)}
        callHrefs={callHrefs}
        statusHrefs={statusHrefs}
        productHrefs={productHrefs}
        returnWindowNote={RETURN_WINDOW_NOTE}
      />
    </DemoOfficeFrame>
  );
}
