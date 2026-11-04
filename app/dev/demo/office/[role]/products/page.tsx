import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pager } from "@/components/ui/Pager";
import { parseProductsListState, productListQueryOf } from "@/features/products/data/search-params";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { SimulatedCommandsProvider } from "../../../_components/SimulatedCommands";
import { demoDataAccess } from "../../../_data/adapter";
import { ddmm } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { isOfficeRole, officeHomeLabel, productsOffered, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder, ScreenPlaceholder } from "../_Placeholder";
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

/** PR-04, OF-07: an empty brand or supplier. */
const NOT_ENTERED = "לא הוזן";

// "מוצרים" (spec office screens, PR-06, D19; matrix key `products`): every product with its
// normalized SKU (PR-07), name, brand and supplier ("לא הוזן" when empty), the invitation that
// created it and 🧪 (SIM-17). Name, brand and supplier are edited through
// useCommands().products.update (simulated); no import and no delete; invitations never overwrite
// an existing name. PHASE F SCAFFOLD: the body is a placeholder list; the screen replaces it (the
// simulated state for its edits is already nested). Reads only through the layer: products.list
// (?q=&page=) and reference.permissions (display only, G-04).
export default async function OfficeProductsPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/products">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = productsOffered(permissions);
  const state = parseProductsListState(await searchParams);
  const page = offered ? await demoDataAccess.products.list(productListQueryOf(state, PAGE_SIZE)) : null;
  const href = (p: number) => demoHref.products(role, { q: state.q, page: p });

  return (
    <DemoOfficeFrame role={role} active="products">
      <div className="ptitle">
        <div>
          <h1>מוצרים</h1>
          {page && <div className="sub">מוצרים נוצרים מהזימונים לפי מק״ט · זימון לא משנה שם קיים</div>}
        </div>
      </div>
      {page ? (
        <SimulatedCommandsProvider state={await productsState(page.items)}>
          <ScreenPlaceholder
            id="products-list"
            heading="כל המוצרים"
            note="המסך בבנייה (שלב F)"
            total={page.total}
            rows={page.items.map((p) => ({
              key: p.sku,
              primary: `${p.name} · ${p.sku}`,
              secondary: `${p.brand || NOT_ENTERED} · ${p.supplier || NOT_ENTERED} · ${p.callCount} קריאות${
                p.firstSeen ? ` · נוצר מפנייה ${p.firstSeen.req} ב-${ddmm(p.firstSeen.date)}` : ""
              }`,
              isTest: p.isTest,
            }))}
            footer={
              <Pager
                page={page.page}
                pageCount={page.pageCount}
                prevHref={page.page > 1 ? href(page.page - 1) : null}
                nextHref={page.page < page.pageCount ? href(page.page + 1) : null}
                label="עמודי המוצרים"
              />
            }
          />
        </SimulatedCommandsProvider>
      ) : (
        <NoAccessPlaceholder
          id="products-no-access"
          text="לתפקיד הזה אין עריכת מוצרים. פרטי המוצר מופיעים בכרטיס הקריאה ובכרטיס הלקוח."
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
        />
      )}
    </DemoOfficeFrame>
  );
}
