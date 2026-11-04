import type { Metadata } from "next";
import Link from "next/link";
import { parseOutboxViewState } from "@/features/outbox/data/search-params";
import { DemoPage } from "../_components/DemoPage";
import { demoDataAccess } from "../_data/adapter";
import { demoHref } from "../_data/routes";

export const metadata: Metadata = { title: "דואר מדומה · כלי פיתוח · הדגמה" };

/** The viewer's fixed banner: a developer tool; nothing is ever sent (SIM-09, D24). */
const TOOL_BANNER = "כלי פיתוח · דואר מדומה · שום מייל לא נשלח";

// Mock completion-email outbox (X-06: a developer tool behind /dev, not an app screen; linked only
// from the /dev/demo landing page's tools section, never from the office sidebar). PLACEHOLDER
// (phase G ports): the body (the list and the selected email, ported from docs/demo.html mailsHtml
// and mailForVisit as amended by EM-01 to EM-05, D09, D43) is built on outbox.list({ page }) and
// outbox.get(id) (?page=&id=, parseOutboxViewState). Read-only: no send, resend or delete.
export default async function DemoOutboxPage({ searchParams }: PageProps<"/dev/demo/outbox">) {
  const state = parseOutboxViewState(await searchParams);
  const page = await demoDataAccess.outbox.list({ page: state.page });
  return (
    <DemoPage>
      <main className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4 sm:p-6">
        <div>
          <Link className="lnk" href={demoHref.landing()}>
            › חזרה להדגמת הממשק
          </Link>
        </div>
        <div className="ptitle">
          <div>
            <h1>דואר מדומה</h1>
            <div className="sub">{`${page.total} רשומות בתור הדואר · אף אחת לא נשלחה`}</div>
          </div>
        </div>
        <div className="note" role="note" aria-label="כלי פיתוח">
          {TOOL_BANNER}
        </div>
        <section className="card" aria-labelledby="outbox-placeholder">
          <div className="sec">
            <h2 id="outbox-placeholder">המסך בבנייה</h2>
          </div>
        </section>
      </main>
    </DemoPage>
  );
}
