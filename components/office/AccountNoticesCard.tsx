import { TestBadge } from "@/components/ui/TestBadge";
import { ACCOUNT_REQUEST_KIND_LABELS, ACCOUNT_ROLE_LABELS, type CreatorNotice } from "@/features/accounts/data/types";
import type { Bounded } from "@/features/data-access/common";
import type { CreatorNoticeEntry } from "./AccountAdminParts";
import { SettingsCardHead, SettingsMore } from "./SettingsShell";

// The Creator's "התראות חשבונות" (Step 2 plan §4 #8, §3.10; D34 b and f; SE-18 PROPOSED): pending
// requests that wait for him, a Manager's deactivations, and Outlook-email changes of technicians
// made by anyone but him. No read/unread state (that would need a table). Placement: first on
// Settings › "משתמשים והרשאות" (TEMPORARY, Step 2 plan Q13: the demo's placement, shown to the
// owner). No hooks: a Server Component card; the page's loader reads the notices for the Creator
// only (production: the adapter denies any other caller).

const TITLE_ID = "acct-notices-title";

function lineOne(n: CreatorNotice): string {
  switch (n.kind) {
    case "pending-request":
      return `בקשה ממתינה · ${n.requestKind ? ACCOUNT_REQUEST_KIND_LABELS[n.requestKind] : "בקשה"} · ${n.target.name}`;
    case "manager-deactivation":
      return `השבתה על ידי המנהל · ${n.target.name}`;
    case "outlook-email-change":
      return `שינוי מייל ב-Outlook · ${n.target.name}`;
  }
}

/** The third line, when there is one; `pending`: a TEMPORARY behaviour that waits for the owner. */
function lineThree(n: CreatorNotice): { text: string; pending: boolean } | null {
  if (n.kind === "pending-request") return { text: "להחלטה ב\"בקשות לאישור\"", pending: false };
  // TEMPORARY (Step 2 plan Q14): the database lets a Manager change the Outlook email; the app keeps
  // it for the Creator until the owner decides, so such a change is labelled.
  if (n.kind === "outlook-email-change" && n.actorRole === "mgr") {
    return { text: "באפליקציה רק היוצר משנה מייל ב-Outlook · ממתין להחלטת בעלים", pending: true };
  }
  return null;
}

/** A "ממתין להחלטת בעלים" line, in the warning colours of every such label (review UI-5). */
const PENDING_LINE = { color: "var(--warn-fg)", fontWeight: 700 } as const;

export function AccountNoticesCard({ notices }: { notices: Bounded<CreatorNoticeEntry> }) {
  const n = notices.total;
  return (
    <section className="card" style={{ overflow: "hidden" }} aria-labelledby={TITLE_ID}>
      <SettingsCardHead
        id={TITLE_ID}
        title="התראות חשבונות"
        sub={'בקשות שממתינות לאישורך, חשבונות שהמנהל השבית ושינויים במייל ב-Outlook של טכנאים. אין סימון "נקרא".'}
        action={n > 0 ? <span className="pill acct-warn">{n === 1 ? "התראה אחת" : `${n} התראות`}</span> : undefined}
      />
      {notices.items.length === 0 ? (
        <div className="empty">אין התראות</div>
      ) : (
        <ul className="acct-notices" aria-label="התראות חשבונות">
          {notices.items.map(({ notice, atLabel }) => {
            const third = lineThree(notice);
            return (
              <li key={notice.id}>
                <b>{lineOne(notice)}</b>
                {notice.isTest && (
                  <>
                    {" "}
                    <TestBadge />
                  </>
                )}
                <div className="sub">
                  {ACCOUNT_ROLE_LABELS[notice.target.role]} · על ידי {notice.actor.name} · {atLabel}
                </div>
                {third && (
                  <div className="sub" style={third.pending ? PENDING_LINE : undefined}>
                    {third.text}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <SettingsMore shown={notices.items.length} total={notices.total} />
    </section>
  );
}
