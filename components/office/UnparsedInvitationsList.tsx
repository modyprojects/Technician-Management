import type { ReactNode } from "react";
import { pendingDecisionHint } from "@/components/ui/pending-hint";
import { TestBadge } from "@/components/ui/TestBadge";
import { ddmm } from "@/features/calendar/data/dates";
import type {
  UnparsedInvitation,
  UnparsedInvitationsPage,
  UnparsedProblem,
  UnparsedProblemKind,
  UnparsedRepMailState,
} from "@/features/calendar/data/types";
import type { IsoTimestamp } from "@/features/data-access/common";
import type { VisitSource } from "@/features/visits/data/types";
import { DashboardSection } from "./DashboardSection";

// "זימונים שלא נקלטו" (spec office screens and "Invitation intake", OF-16, IN-01 to IN-04;
// docs/demo.html has no such screen, so it is designed in the demo's language: card + .sec head,
// .pill, .sub, .note). One row per invitation the ingestion service could not ingest, newest
// first: subject, when it was received, the organizing rep, the attendee's technician, the
// invitation's own date and times, its source (SIM-14) and every problem with the Settings label
// and its kind: a missing required label, an unknown pickup place (IN-03) or an invalid value
// (with what the field accepts). An unknown SKU is never a problem: the product is created
// (IN-02, D19). The email to the rep is PENDING d09 and is shown as not sent, never as sent
// (IN-04). Fixing the invitation in Outlook sends it again; intake is event-driven (D08), so the
// corrected invitation is ingested and leaves the list. Calendar text is untrusted: it is rendered
// as plain text only (React escapes it), never as HTML or links.
// Server Component: read-only, no actions (this screen fixes nothing itself; the fix is in Outlook).

/** The problem kinds as the screen names them. */
export const UNPARSED_PROBLEM_LABELS = {
  missing: "חסר שדה חובה",
  "unknown-place": "מקום איסוף לא מוכר",
  invalid: "ערך לא תקין",
} as const satisfies Record<UnparsedProblemKind, string>;

/**
 * Where an invitation came from. Not the visit source line (VISIT_SOURCE_LABELS: "נקלט
 * אוטומטית"): these invitations were NOT ingested.
 */
const INVITATION_SOURCE_LABELS = {
  outlook: "📅 זימון Outlook",
  simulator: "🧪 זימון בדיקה",
} as const satisfies Record<VisitSource, string>;

/** The rep-mail state (IN-04). Only "pending" exists until the owner decides d09. */
function repMailText(state: UnparsedRepMailState): string {
  switch (state.status) {
    case "pending":
      return `מייל לנציגה: לא נשלח · ${pendingDecisionHint(state.decision)}`;
  }
}

/** A value read from the invitation (plain text; "ריק" when empty). */
function InvitationValue({ value }: { value: string }) {
  return (
    <span className="ib-val">
      <bdi>{value || "ריק"}</bdi>
    </span>
  );
}

function ProblemItem({ problem }: { problem: UnparsedProblem }) {
  return (
    <li>
      <span className="pill ib-kind">{UNPARSED_PROBLEM_LABELS[problem.kind]}</span>{" "}
      {problem.kind === "missing" ? (
        <b>{problem.label}</b>
      ) : (
        <>
          <b>{problem.label}:</b> <InvitationValue value={problem.value} />
          <span className="sub ib-exp">
            {problem.kind === "unknown-place" ? "לא ברשימת מקומות האיסוף בהגדרות" : `צריך להיות: ${problem.expected}`}
          </span>
        </>
      )}
    </li>
  );
}

function UnparsedRow({ item, receivedLabel }: { item: UnparsedInvitation; receivedLabel: (iso: IsoTimestamp) => string }) {
  const headingId = `unp-${item.id}`;
  const problemsId = `unp-${item.id}-p`;
  const tech = item.attendee.technician;
  return (
    <li className="ib-item ib-two" aria-labelledby={headingId}>
      <div className="ib-main">
        <div className="ib-head">
          <h3 id={headingId} className="ib-title">
            <bdi>{item.subject}</bdi>
          </h3>
          {/* The simulator source line already marks test invitations (SIM-14); other test records get the badge (D47). */}
          {item.isTest && item.source !== "simulator" && <TestBadge />}
        </div>
        <div className="sub ib-meta">
          <span className="num">התקבל {receivedLabel(item.receivedAt)}</span>
          <span>
            נציגה:{" "}
            {item.organizer.name ?? (
              <bdi dir="ltr" className="ib-mail">
                {item.organizer.email}
              </bdi>
            )}
          </span>
          <span>
            טכנאי:{" "}
            {tech ? (
              <>
                <span className="dot" aria-hidden="true" style={{ background: tech.color }} /> {tech.name}
              </>
            ) : (
              <>
                לא זוהה ·{" "}
                <bdi dir="ltr" className="ib-mail">
                  {item.attendee.email}
                </bdi>
              </>
            )}
          </span>
          <span className="num">
            מועד בזימון: {ddmm(item.event.date)} {item.event.start}–{item.event.end}
          </span>
          {item.requestNumber && (
            <span>
              פנייה <span className="num">{item.requestNumber}</span>
            </span>
          )}
          <span>{INVITATION_SOURCE_LABELS[item.source]}</span>
        </div>
        <p className="ib-text sub">{repMailText(item.repMail)}</p>
      </div>
      <div className="ib-problems">
        <p id={problemsId} className="ib-ptitle">
          מה לתקן בזימון
        </p>
        <ul className="ib-plist" aria-labelledby={problemsId}>
          {item.problems.map((p) => (
            <ProblemItem key={`${p.kind}-${p.field}`} problem={p} />
          ))}
        </ul>
      </div>
    </li>
  );
}

export function UnparsedInvitationsList({
  id,
  page,
  receivedLabel,
  note,
  footer,
}: {
  /** Section anchor and heading id prefix. */
  id: string;
  page: UnparsedInvitationsPage;
  /** "היום 09:02" / "20.10 16:05" in Asia/Jerusalem (G-01); the page owns "today". */
  receivedLabel: (iso: IsoTimestamp) => string;
  /** An environment line the page adds to the explanation (for example the demo's simulator source). */
  note?: string;
  /** Paging links, after "מציג X מתוך Y". */
  footer?: ReactNode;
}) {
  return (
    <DashboardSection id={id} flush title="ממתינים לתיקון ב-Outlook" count={page.total} hint="החדשים קודם · כל זימון עם מה שחסר או שגוי בו">
      <div className="note ib-note">
        <p>
          מתקנים את הזימון ב-Outlook, והוא נשלח מחדש. המערכת מקבלת את העדכון ברגע שהוא נשלח (לפי אירוע, בלי בדיקה תקופתית, D08),
          קולטת את הזימון המתוקן, והוא יורד מהרשימה.
        </p>
        <p>מק״ט שלא מופיע ברשימת המוצרים אינו סיבה: מוצר חדש נוצר בקליטה (D19).</p>
        {note && <p>{note}</p>}
      </div>
      {page.items.length ? (
        <>
          <ul className="ib-list" aria-label="זימונים שלא נקלטו">
            {page.items.map((item) => (
              <UnparsedRow key={item.id} item={item} receivedLabel={receivedLabel} />
            ))}
          </ul>
          <div className="sub od-table-foot">
            <span>
              מציג <span className="num">{page.items.length}</span> מתוך <span className="num">{page.total}</span>
            </span>
            {footer}
          </div>
        </>
      ) : (
        <div className="empty">אין זימונים שממתינים לתיקון: כל הזימונים נקלטו</div>
      )}
    </DashboardSection>
  );
}
