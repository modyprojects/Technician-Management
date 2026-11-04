import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListSearch } from "@/components/office/ListSearch";
import { ProductRules } from "@/components/office/ProductRules";
import { ProductsTable, type ProductsTableRow } from "@/components/office/ProductsTable";
import { Pager } from "@/components/ui/Pager";
import { callsListHref } from "@/features/calls/data/search-params";
import { parseProductsListState, productListQueryOf } from "@/features/products/data/search-params";
import { offers } from "@/features/reference/data/permissions";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { SimulatedCommandsProvider } from "../../../_components/SimulatedCommands";
import { demoDataAccess } from "../../../_data/adapter";
import { ddmm } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { isOfficeRole, officeHomeLabel, productsOffered, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder } from "../_Placeholder";
import { productsState } from "../_simulatedState";

// Every office role is built: a role without `products` gets "אין הרשאה" instead of a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/products">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `מוצרים · ${VIEWPOINTS[role].label} · הדגמה` };
}

/** The demo's 40-row page (OF-04). */
const PAGE_SIZE = 40;

// "מוצרים" (spec office screens "Products", PR-06, D19; matrix key `products`): every product by
// its normalized SKU (PR-07), with name, brand and supplier ("לא הוזן" when empty, PR-04, OF-07),
// the number of calls, the invitation that created it and 🧪 (SIM-17). Search and paging run on
// the server (?q=&page=, products.list). Name, brand and supplier are edited inline through
// useCommands().products.update (simulated, D44 row version); no import and no delete; an
// invitation never overwrites an existing name (the rules under the table). The edit is offered
// with `products` (the Creator always, D33); a role without it gets "אין הרשאה" and no product data
// is read (spec: the screen is defined by its edit capability; product facts stay on the call and
// customer cards). Reads only through the layer: products.list, products.brands / suppliers and
// reference.permissions (display only, G-04). The simulated state its edits are checked against
// (versions, active options) is nested here only (productsState; deny by default elsewhere).
export default async function OfficeProductsPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/products">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = productsOffered(permissions);
  const state = parseProductsListState(await searchParams);

  if (!offered) {
    return (
      <DemoOfficeFrame role={role} active="products">
        <div className="ptitle">
          <div>
            <h1>מוצרים</h1>
          </div>
        </div>
        <NoAccessPlaceholder
          id="products-no-access"
          text="לתפקיד הזה אין עריכת מוצרים. פרטי המוצר מופיעים בכרטיס הקריאה ובכרטיס הלקוח."
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
        />
      </DemoOfficeFrame>
    );
  }

  const [page, brands, suppliers] = await Promise.all([
    demoDataAccess.products.list(productListQueryOf(state, PAGE_SIZE)),
    demoDataAccess.products.brands(),
    demoDataAccess.products.suppliers(),
  ]);
  // Links into the calls list and call cards only where the role's screens offer them (`calls`).
  const withCalls = offers(permissions, "calls");
  const rows: ProductsTableRow[] = page.items.map((product) => ({
    // A role without `calls` does not see the creating call (ProductFirstSeen: null when the call is
    // not visible to the viewer); the count of calls stays (an aggregate, no call details).
    product: withCalls ? product : { ...product, firstSeen: null },
    firstSeenDate: product.firstSeen ? ddmm(product.firstSeen.date) : "",
    firstSeenHref: withCalls && product.firstSeen ? demoHref.call(role, product.firstSeen.req) : null,
    callsHref: withCalls ? callsListHref(demoHref.calls(role), { q: product.sku, status: "all", tech: "all", page: 1 }) : null,
  }));
  const href = (p: number) => demoHref.products(role, { q: state.q, page: p });

  return (
    <DemoOfficeFrame role={role} active="products">
      <div className="ptitle">
        <div>
          <h1>מוצרים</h1>
          <div className="sub">מוצרים נוצרים מהזימונים לפי מק״ט · כאן עורכים שם, מותג וספק</div>
        </div>
      </div>
      <ListSearch
        action={demoHref.products(role)}
        query={state.q}
        clearHref={state.q ? demoHref.products(role) : null}
        formLabel="חיפוש מוצרים"
        inputLabel="חיפוש מוצר"
        placeholder="חיפוש לפי מק״ט, שם, מותג או ספק"
      />
      <SimulatedCommandsProvider state={await productsState(page.items)}>
        <ProductsTable rows={rows} total={page.total} query={state.q} canEdit={offered} brands={brands.items} suppliers={suppliers.items} />
      </SimulatedCommandsProvider>
      <Pager
        page={page.page}
        pageCount={page.pageCount}
        prevHref={page.page > 1 ? href(page.page - 1) : null}
        nextHref={page.page < page.pageCount ? href(page.page + 1) : null}
        label="עמודי המוצרים"
      />
      <ProductRules />
    </DemoOfficeFrame>
  );
}
