import type { Metadata } from "next";
import Link from "next/link";
import { EmailPreview } from "@/components/office/EmailPreview";
import { OutboxList } from "@/components/office/OutboxList";
import { OutboxPreviewFocus } from "@/components/office/OutboxPreviewFocus";
import { Pager } from "@/components/ui/Pager";
import { parseOutboxViewState } from "@/features/outbox/data/search-params";
import type { OutboxEmail } from "@/features/outbox/data/types";
import { DemoPage } from "../_components/DemoPage";
import { demoDataAccess } from "../_data/adapter";
import { notificationTimeLabel } from "../_data/dates";
import { demoHref } from "../_data/routes";

export const metadata: Metadata = { title: "דואר מדומה · כלי פיתוח · הדגמה" };

/** The viewer's fixed banner: a developer tool; nothing is ever sent (SIM-09, D24). */
const TOOL_BANNER = "כלי פיתוח · דואר מדומה · שום מייל לא נשלח";

/** The email's subject heading (focus target when another row is chosen). */
const PREVIEW_TITLE_ID = "ob-preview-title";

// Mock completion-email outbox (X-06: a developer tool behind /dev, not an app screen; linked only
// from the /dev/demo landing page's tools section, never from the office sidebar). Ported from
// docs/demo.html mailsHtml() (L1056-1063) and mailForVisit() (L995-1016) as amended by EM-01 to
// EM-05, D09, D43 and D12: the list of outbox rows (OutboxList) beside the selected email
// (EmailPreview), as the demo's ".mailbox" (one column at 900px and below), on a page instead of a
// modal. Reads only through the data-access layer: outbox.list({ page }) and outbox.get(id), with
// `?page&id` (parseOutboxViewState); no id, or an unknown one, shows the page's first row.
// Read-only: there is no send, resend or delete. Every row is test data and is never delivered
// (SIM-09, D24); no mail provider is chosen (d12). The call-card link opens the Manager's card in
// the demo (production: an absolute app link in the email).
export default async function DemoOutboxPage({ searchParams }: PageProps<"/dev/demo/outbox">) {
  const state = parseOutboxViewState(await searchParams);
  const page = await demoDataAccess.outbox.list({ page: state.page });
  const first = page.items[0];
  const email: OutboxEmail | null =
    (state.id ? await demoDataAccess.outbox.get(state.id) : null) ?? (first ? await demoDataAccess.outbox.get(first.id) : null);
  const held = page.items.filter((r) => r.release === "held").length;
  return (
    <DemoPage>
      <main className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4 sm:p-6">
        <div>
          <Link className="lnk" href={demoHref.landing()}>
            › חזרה להדגמת הממשק
          </Link>
        </div>
        <div className="ob-tool" role="note" aria-label="כלי פיתוח">
          <span aria-hidden="true">✉</span> {TOOL_BANNER}
        </div>
        <div className="ptitle">
          <div>
            <h1>דואר מדומה</h1>
            <div className="sub">{`${page.total} רשומות בתור הדואר · אף אחת לא נשלחה`}</div>
          </div>
        </div>
        <div className="note">
          מייל סיום ביקור נכתב לתור הדואר רק אחרי שהשרת מקבל את סיום הביקור עם סיכום מאושר: מייל אחד לכל סיום, למנהל ולתיבת שירות
          הלקוחות, גם כשהביקור טופל וגם כשעבר להמשך טיפול. כל הרשומות כאן הן נתוני בדיקה, ולכן אף אחת מהן לא תישלח. המייל הוא תמונת
          מצב מרגע הסיום: תיקון מאוחר של הביקור לא משנה אותו.
          {held > 0 && ` בעמוד הזה ${held === 1 ? "רשומה אחת מוחזקת" : `${held} רשומות מוחזקות`} עד שיהיה סיכום מאושר.`}
        </div>
        <section className="card ob-box" aria-label="תור הדואר">
          <OutboxList
            page={page}
            selectedId={email?.id ?? null}
            hrefOf={(id) => demoHref.outbox({ page: page.page, id })}
            timeLabel={notificationTimeLabel}
            pager={
              <Pager
                page={page.page}
                pageCount={page.pageCount}
                prevHref={page.page > 1 ? demoHref.outbox({ page: page.page - 1 }) : null}
                nextHref={page.page < page.pageCount ? demoHref.outbox({ page: page.page + 1 }) : null}
                label="עמודי תור הדואר"
              />
            }
          />
          <div className="ob-pane">
            {email ? (
              <>
                <EmailPreview
                  email={email}
                  cardHref={demoHref.call("mgr", email.req)}
                  timeLabel={notificationTimeLabel}
                  titleId={PREVIEW_TITLE_ID}
                />
                <OutboxPreviewFocus selectedId={email.id} targetId={PREVIEW_TITLE_ID} />
              </>
            ) : (
              <div className="empty">אין רשומות בתור הדואר</div>
            )}
          </div>
        </section>
      </main>
    </DemoPage>
  );
}
