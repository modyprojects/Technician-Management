import type { ReactNode } from "react";
import { INVITATION_SOURCE_LABELS, TestPill } from "@/components/ui/TestBadge";
import { ddmm } from "@/features/calendar/data/dates";
import type {
  UnparsedInvitation,
  UnparsedInvitationsPage,
  UnparsedProblem,
  UnparsedRepMailState,
} from "@/features/calendar/data/types";
import type { IsoTimestamp } from "@/features/data-access/common";
import { DashboardSection } from "./DashboardSection";
import { problemKindLabel } from "./unparsed-labels";
import { TimeRange } from "@/components/ui/TimeRange";

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

/** The rep-mail state (IN-04). Only "pending" exists until the owner decides d09. */
function repMailText(state: UnparsedRepMailState): string {
  switch (state.status) {
    case "pending":
      return "מייל לנציגה: לא נשלח";
  }
}

/**
 * A value read from the invitation (plain text; "ריק" when empty). A value without Hebrew letters
 * (a number, an address, a SKU) reads left to right, so "48 213" is never shown as "213 48".
 */
function InvitationValue({ value }: { value: string }) {
  const dir = !value || /[\u0590-\u05ff]/.test(value) ? "rtl" : "ltr";
  return (
    <span className="ib-val">
      <bdi dir={dir}>{value || "ריק"}</bdi>
    </span>
  );
}

/** What is wrong and how to fix it: app text, never invitation text. */
function problemExplanation(problem: UnparsedProblem): string | undefined {
  switch (problem.kind) {
    case "missing":
      return problem.explanation;
    case "unknown-place":
      return problem.explanation ?? "לא ברשימת מקומות האיסוף בהגדרות";
    case "invalid":
      return `צריך להיות: ${problem.expected}`;
    case "technician":
    case "conflict":
      return problem.explanation;
  }
}

function ProblemItem({ problem }: { problem: UnparsedProblem }) {
  const explanation = problemExplanation(problem);
  return (
    <li>
      <span className="pill ib-kind">{problemKindLabel(problem)}</span>{" "}
      {problem.kind === "missing" ? (
        <b>{problem.label}</b>
      ) : (
        <>
          <b>{problem.label}:</b> <InvitationValue value={problem.value} />
        </>
      )}
      {explanation && <span className="sub ib-exp">{explanation}</span>}
    </li>
  );
}

function OrganizerText({ organizer }: { organizer: UnparsedInvitation["organizer"] }) {
  if (organizer.name) return <>{organizer.name}</>;
  if (!organizer.email) return null;
  return (
    <bdi dir="ltr" className="ib-mail">
      {organizer.email}
    </bdi>
  );
}

function TechnicianText({ attendees }: { attendees: UnparsedInvitation["attendees"] }) {
  const tech = attendees.technician;
  if (tech) {
    return (
      <>
        <span className="dot" aria-hidden="true" style={{ background: tech.color }} /> {tech.name}
      </>
    );
  }
  if (attendees.emails.length === 0) return <>לא זוהה · אין משתתפים</>;
  return (
    <>
      לא זוהה ·{" "}
      <bdi dir="ltr" className="ib-mail">
        {attendees.emails.join(", ")}
      </bdi>
    </>
  );
}

function UnparsedRow({ item, receivedLabel }: { item: UnparsedInvitation; receivedLabel: (iso: IsoTimestamp) => string }) {
  const headingId = `unp-${item.id}`;
  const problemsId = `unp-${item.id}-p`;
  return (
    <li className="ib-item ib-two" aria-labelledby={headingId}>
      <div className="ib-main">
        <div className="ib-head">
          <h3 id={headingId} className="ib-title">
            <bdi>{item.subject || "(ללא נושא)"}</bdi>
          </h3>
          {/* The simulator source line already marks test invitations (SIM-14); other test records get the pill (D47; "🧪 בדיקה", QA T-06). */}
          {item.isTest && item.source !== "simulator" && <TestPill />}
        </div>
        <div className="sub ib-meta">
          <span className="num">התקבל {receivedLabel(item.receivedAt)}</span>
          {(item.organizer.name || item.organizer.email) && (
            <span>
              נציגה: <OrganizerText organizer={item.organizer} />
            </span>
          )}
          <span>
            טכנאי: <TechnicianText attendees={item.attendees} />
          </span>
          <span className="num">
            {item.event ? (
              <>
                מועד בזימון: {ddmm(item.event.date)} <TimeRange start={item.event.start} end={item.event.end} />
              </>
            ) : (
              <>מועד בזימון: לא נקרא</>
            )}
          </span>
          {item.requestNumber && (
            <span>
              מס׳ פנייה <span className="num">{item.requestNumber}</span>
            </span>
          )}
          {item.customerName && (
            <span>
              לקוח: <bdi>{item.customerName}</bdi>
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
          {item.problems.map((p, i) => (
            <ProblemItem key={`${i}-${p.kind}-${p.field}`} problem={p} />
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
      {/* D08: event-driven intake, never polling. Decision codes stay in comments, not in user text. */}
      <div className="note ib-note">
        <p>מתקנים את הזימון ב-Outlook והוא נשלח מחדש: המערכת קולטת אותו ברגע שהוא מגיע, והוא יורד מהרשימה.</p>
      </div>
      {/* IN-02, D19: an unknown SKU creates the product; it is never a reason. Short help text, not the info box. */}
      <p className="sub" style={{ margin: "0 18px 12px" }}>
        מק״ט שלא מופיע ברשימת המוצרים אינו סיבה: מוצר חדש נוצר בקליטה.
        {note && <> {note}</>}
      </p>
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
