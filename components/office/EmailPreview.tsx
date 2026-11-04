import Link from "next/link";
import { pendingDecisionHint } from "@/components/ui/pending-hint";
import { TestBadge } from "@/components/ui/TestBadge";
import type { IsoTimestamp } from "@/features/data-access/common";
import {
  OUTBOX_DELIVERY_LABELS,
  OUTBOX_RECIPIENT_LABELS,
  type OutboxEmail,
  type OutboxRecipient,
  type OutboxRelease,
} from "@/features/outbox/data/types";

// The completion email as the outbox row holds it (developer tool behind /dev, X-06), ported from
// docs/demo.html mailForVisit() (L995-1016) and the mail pane of mailsHtml() (L1056-1063):
// header (אל, נושא), status banner, follow-up instructions, customer / address / product / SKU /
// technician, "סיכום הטכנאי" with the recording note, the signature line and "לכרטיס הקריאה ›".
// Changes (docs/demo-deviations.md and decisions):
// - Recipients (EM-02, D09): the Manager and the customer-service mailbox, both outcomes, no CC.
//   Which Manager (one account or every active Manager) and whether the handling rep also gets it
//   are open (d10): shown as pending, the rep outside "אל".
// - Business identifiers (EM-04): request, task, customer and visit numbers, the result, the
//   follow-up reason, the summary and the parts; no reference to any external system.
// - Signature (EM-01, D43): the approval text preserved at signing, never the current text.
// - Media (EM-03 pending d11): counted, never attached; viewed on the call card.
// - Summary (D12): the written summary or the approved transcript; a closure without one is held
//   (EM-05; whether it waits for the transcript approval is open, d06).
// - The record's facts above the email: the delivery state (every row is test data, so it is never
//   delivered: "לא יישלח · נתוני בדיקה", never "sent"; SIM-09), the release state, the idempotency
//   key (one logical notification per closure) and the mail provider (pending d12).
// - The demo's media thumbnails (EM-03) and its "העתק" line (EM-02) are not shown.
// Server Component: an OutboxEmail DTO (a snapshot at closure), the call-card link and the time format.

/** Recording length in seconds → "1:05". */
const recordingLabel = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

function releaseText(release: OutboxRelease): string {
  switch (release.state) {
    case "ready":
      return "התקיימו: השרת קיבל את סיום הביקור, והסיכום מאושר";
    case "held":
      return `מוחזק: אין עדיין סיכום כתוב או תמלול מאושר · ${pendingDecisionHint(release.pending.decision)}`;
  }
}

function Address({ email }: { email: string }) {
  return (
    <bdi dir="ltr" className="ob-addr">
      {`<${email}>`}
    </bdi>
  );
}

function Recipient({ r }: { r: OutboxRecipient }) {
  const label = OUTBOX_RECIPIENT_LABELS[r.role];
  return (
    <li>
      <b>{label}</b>
      {r.name !== label && ` · ${r.name}`} <Address email={r.email} />
      {r.fixed && r.pending && (
        <span className="sub ob-rcpt-note">איזה מנהל מקבל (מנהל אחד או כל המנהלים): {pendingDecisionHint(r.pending)}</span>
      )}
      {!r.fixed && <span className="sub ob-rcpt-note">לא בנמענים: {r.pending ? pendingDecisionHint(r.pending) : "לא נקבע"}</span>}
    </li>
  );
}

export function EmailPreview({
  email,
  cardHref,
  timeLabel,
  titleId = "ob-preview-title",
}: {
  email: OutboxEmail;
  /** "לכרטיס הקריאה ›": the call card of the email's request. */
  cardHref: string;
  timeLabel: (iso: IsoTimestamp) => string;
  /** Id of the subject heading (the viewer moves focus there when another row is chosen). */
  titleId?: string;
}) {
  const to = email.recipients.filter((r) => r.fixed);
  const notTo = email.recipients.filter((r) => !r.fixed);
  const done = email.banner.outcome === "done";
  const id = email.identifiers;
  return (
    <article className="ob-preview" aria-labelledby={titleId}>
      <header className="ob-mailhead">
        <div className="kv ob-kv">
          <span>אל</span>
          <ul className="ob-rcpts">
            {to.map((r) => (
              <Recipient key={r.role} r={r} />
            ))}
          </ul>
          {notTo.length > 0 && (
            <>
              <span>ממתין להחלטה</span>
              <ul className="ob-rcpts">
                {notTo.map((r) => (
                  <Recipient key={r.role} r={r} />
                ))}
              </ul>
            </>
          )}
          <span>נושא</span>
          <h2 id={titleId} tabIndex={-1} className="ob-title">
            {email.subject}
          </h2>
        </div>
      </header>

      <section className="ob-record" aria-label="פרטי הרשומה בתור הדואר">
        <div className="kv ob-kv">
          <span>מצב</span>
          <span className="ob-tags">
            <span className="pill ob-delivery">{OUTBOX_DELIVERY_LABELS[email.delivery]}</span>
            {email.isTest && <TestBadge label />}
          </span>
          <span>תנאי שחרור</span>
          <span>{releaseText(email.releaseDetail)}</span>
          <span>נוצר</span>
          <span>{timeLabel(email.createdAt)} · עם קבלת סיום הביקור בשרת</span>
          <span>מפתח ייחודיות</span>
          <span>
            <code dir="ltr" className="ob-key">
              {email.idempotencyKey}
            </code>
            <span className="sub ob-block">מייל אחד לכל סיום ביקור, בלי כפילויות</span>
          </span>
          <span>ספק דואר</span>
          <span>{pendingDecisionHint(email.provider.decision)}</span>
        </div>
      </section>

      <div className="ob-body">
        <div>
          <span className={done ? "pill ob-banner-done" : "pill ob-banner-cont"}>{email.banner.text}</span>
        </div>

        {email.followUp && (
          <div className="ob-follow">
            <b>מה צריך לעשות:</b> לקבוע ביקור חדש ב-Outlook עם אותו מספר פנייה ({id.req}). הוא יצורף לקריאה כביקור{" "}
            {email.followUp.nextVisitNumber}.
            {email.followUp.nextNote && (
              <div className="ob-follow-note">
                <b>מה צריך בביקור הבא:</b> {email.followUp.nextNote}
              </div>
            )}
          </div>
        )}

        <div className="kv ob-kv" role="group" aria-label="פרטי הקריאה">
          <span>מספר פנייה</span>
          <span className="num">{id.req}</span>
          <span>מספר משימה</span>
          <span className="num">{id.task}</span>
          <span>מספר לקוח</span>
          <span className="num">{id.customerNumber}</span>
          <span>מספר ביקור</span>
          <span className="num">{id.visitNumber}</span>
          <span>תוצאה</span>
          <span>{done ? "טופל" : "המשך טיפול"}</span>
          {email.followUp && (
            <>
              <span>סיבת המשך טיפול</span>
              <span>{email.followUp.reason}</span>
            </>
          )}
        </div>

        <div className="kv ob-kv">
          <span>לקוח</span>
          <span>
            {email.customer.name} · <span dir="ltr">{email.customer.phone}</span>
          </span>
          <span>כתובת</span>
          <span>{email.customer.address}</span>
          <span>מוצר / מק&quot;ט</span>
          <span>
            {email.product.name} · <bdi dir="ltr">{email.product.sku}</bdi>
          </span>
          <span>טכנאי</span>
          <span>
            {email.technician.name} · ביקור {id.visitNumber}
          </span>
        </div>

        <div className="ob-summary">
          <div className="sub ob-strong">סיכום הטכנאי</div>
          {email.summary ? <div>{email.summary}</div> : <div className="sub">אין עדיין סיכום מאושר, ולכן המייל מוחזק</div>}
          {email.recordingSeconds > 0 && (
            <div className="sub">
              הקלטה <span className="num">{recordingLabel(email.recordingSeconds)}</span> · ההאזנה בכרטיס הקריאה
            </div>
          )}
        </div>

        <div>
          <div className="sub ob-strong">חלפים שהוחלפו</div>
          {email.parts.length ? (
            <ul className="ob-parts">
              {email.parts.map((p, i) => (
                <li key={`${i}-${p}`}>{p}</li>
              ))}
            </ul>
          ) : (
            <div className="sub">לא הוחלפו חלפים</div>
          )}
        </div>

        {email.media.count > 0 && (
          <div className="sub">
            תמונות וסרטונים (<span className="num">{email.media.count}</span>): לא מצורפים למייל ·{" "}
            {pendingDecisionHint(email.media.attachment.decision)} · הצפייה בכרטיס הקריאה
          </div>
        )}

        {email.signature && (
          <div>
            <span aria-hidden="true">✍ </span>
            נחתם ע&quot;י <b>{email.signature.signerName}</b>: &quot;{email.signature.signedText}&quot;
            <div className="sub">הנוסח שהוצג ללקוח בזמן החתימה</div>
          </div>
        )}

        <div>
          <Link className="btn pri" href={cardHref}>
            לכרטיס הקריאה ›
          </Link>
        </div>
      </div>
    </article>
  );
}
