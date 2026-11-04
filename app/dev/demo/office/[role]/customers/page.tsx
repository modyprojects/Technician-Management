import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pager } from "@/components/ui/Pager";
import { customerListQueryOf, parseCustomersListState } from "@/features/customers/data/search-params";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { dayLabel } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { customersOffered, isOfficeRole, officeHomeLabel, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder, ScreenPlaceholder } from "../_Placeholder";

// Every office role is built: a role without `calls` gets "אין הרשאה" instead of a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/customers">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `לקוחות · ${VIEWPOINTS[role].label} · הדגמה` };
}

/** The demo's 40-row page (OF-04). */
const PAGE_SIZE = 40;

// "לקוחות" (spec office screens, OF-16; matrix key `calls`): customers searched by name, customer
// number (OF-05), phone or city, latest activity first, paged on the server. PHASE F SCAFFOLD: the
// body is a placeholder list; the screen replaces it. Reads only through the data-access layer:
// customers.list (the URL ?q=&page= is the query) and reference.permissions (display only, G-04).
export default async function OfficeCustomersPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/customers">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = customersOffered(permissions);
  const state = parseCustomersListState(await searchParams);
  const page = offered ? await demoDataAccess.customers.list(customerListQueryOf(state, PAGE_SIZE)) : null;
  const href = (p: number) => demoHref.customers(role, { q: state.q, page: p });

  return (
    <DemoOfficeFrame role={role} active="customers">
      <div className="ptitle">
        <div>
          <h1>לקוחות</h1>
          {page && <div className="sub">כל הלקוחות שנקלטו מזימונים · חיפוש לפי שם, מספר לקוח, טלפון או עיר</div>}
        </div>
      </div>
      {page ? (
        <ScreenPlaceholder
          id="customers-list"
          heading="רשימת הלקוחות"
          note="המסך בבנייה (שלב F)"
          total={page.total}
          rows={page.items.map((x) => ({
            key: x.id,
            href: demoHref.customer(role, x.id),
            primary: `${x.name} · ${x.number}`,
            secondary: `${x.city} · ${x.callCount} קריאות · פעילות אחרונה ${dayLabel(x.lastActivity)}${
              x.returnedProductCount ? ` · מוצרים שחזרו: ${x.returnedProductCount}` : ""
            }`,
            isTest: x.isTest,
          }))}
          footer={
            <Pager
              page={page.page}
              pageCount={page.pageCount}
              prevHref={page.page > 1 ? href(page.page - 1) : null}
              nextHref={page.page < page.pageCount ? href(page.page + 1) : null}
              label="עמודי הלקוחות"
            />
          }
        />
      ) : (
        <NoAccessPlaceholder
          id="customers-no-access"
          text="לתפקיד הזה אין צפייה בקריאות ובלקוחות."
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
        />
      )}
    </DemoOfficeFrame>
  );
}
