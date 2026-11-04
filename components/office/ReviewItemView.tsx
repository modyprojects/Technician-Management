import Link from "next/link";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import {
  REVIEW_DECISION_LABELS,
  REVIEW_KIND_LABELS,
  type ReviewField,
  type ReviewItemDetail,
  type ReviewSource,
} from "@/features/review/data/types";
import { DashboardSection } from "./DashboardSection";
import {
  BOTH_VERSIONS_RULE,
  CLOSED_VISIT_RULE,
  INVITATION_REVIEW_RULE,
  REVIEW_KIND_EXPLANATIONS,
  reviewChoiceText,
  ReviewClosedVisitPill,
  ReviewStatusPill,
  reviewSourceText,
  ReviewValueText,
  reviewVersionLabels,
  type ReviewTimeLabel,
  type ReviewVersionLabels,
} from "./ReviewParts";
import { ReviewResolveForm } from "./ReviewResolveForm";

// One "פריטים לבדיקה" item (D44; D39 for invitations). docs/demo.html has no such screen, so it is
// built in its language: "› חזרה" button, title with pills, card + .sec heads, .kv rows, .note.
// - "על הפריט": what the kind means (D39 or D44 wording, no decision codes), the source (the
//   invitation's subject as plain text, or the technician's device with its operation id, the
//   device-reported send time (D45: a reported value) and the server receipt time), the one-time
//   completion email of an accepted closure (its idempotency key) and the changes of the same
//   invitation that were already applied with a notification (D39).
// - "שתי הגרסאות לפי שדה": each field with its base, the system's value and the submitted value
//   side by side (stacked base on a phone), marked conflict / changed on one side / no difference.
// - "החלטה": the decision form (ReviewResolveForm, useCommands().review.resolve) when the viewer
//   may decide; a 🔒 line when not (D14 cases: Manager and Creator only; display only, G-04); the
//   decision, who, when and the note once resolved (read-only; both versions stay visible).
// Server Component; the form is the only client part.

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** How a field differs (D44 per-field base values). */
function fieldState(f: ReviewField, source: ReviewSource): { text: string; className: string } {
  if (f.conflict) return { text: "התנגשות · שני הצדדים שינו", className: "rv-conflict" };
  if (same(f.current, f.incoming)) return { text: "ללא הבדל", className: "rv-same" };
  if (same(f.current, f.base)) return { text: source.kind === "invitation" ? "השתנה בזימון" : "השתנה במכשיר", className: "rv-changed" };
  return { text: "השתנה במערכת", className: "rv-changed" };
}

function FieldVersions({ f, labels, source }: { f: ReviewField; labels: ReviewVersionLabels; source: ReviewSource }) {
  const state = fieldState(f, source);
  const headingId = `rv-field-${f.key}`;
  const incomingDiffers = !same(f.current, f.incoming);
  return (
    <li className={f.conflict ? "rv-field rv-field-conflict" : "rv-field"} aria-labelledby={headingId}>
      <div className="rv-fhead">
        <h3 id={headingId}>{f.label}</h3>
        <span className={`pill ${state.className}`}>{state.text}</span>
      </div>
      <dl className="rv-vers">
        <div className="rv-ver rv-base">
          <dt>{labels.base}</dt>
          <dd>
            <ReviewValueText value={f.base} />
          </dd>
        </div>
        <div className="rv-ver rv-cur">
          <dt>{labels.current}</dt>
          <dd>
            <ReviewValueText value={f.current} />
          </dd>
        </div>
        <div className={incomingDiffers ? "rv-ver rv-inc rv-diff" : "rv-ver rv-inc"}>
          <dt>{labels.incoming}</dt>
          <dd>
            <ReviewValueText value={f.incoming} />
          </dd>
        </div>
      </dl>
    </li>
  );
}

function SourceRows({ source, timeLabel, receivedAt }: { source: ReviewSource; timeLabel: ReviewTimeLabel; receivedAt: string }) {
  return (
    <div className="kv">
      <span>מקור</span>
      <span>{reviewSourceText(source)}</span>
      {source.kind === "invitation" ? (
        <>
          <span>נושא הזימון</span>
          {/* Calendar text is untrusted: plain text only (React escapes it), never HTML or links. */}
          <span className="rv-subject">
            <bdi>{source.subject}</bdi>
          </span>
        </>
      ) : (
        <>
          <span>טכנאי</span>
          <span>
            <span className="dot" style={{ background: source.technician.color }} aria-hidden="true" /> {source.technician.name}
          </span>
          <span>מזהה פעולה</span>
          <span>
            <bdi dir="ltr" className="rv-code">
              {source.operationId}
            </bdi>
          </span>
          <span>נשלח מהמכשיר</span>
          <span>
            <span className="num">{timeLabel(source.deviceSentAt)}</span> <span className="sub">· לפי שעון המכשיר</span>
          </span>
        </>
      )}
      <span>התקבל במערכת</span>
      <span className="num">{timeLabel(receivedAt)}</span>
    </div>
  );
}

export function ReviewItemView({
  item,
  backHref,
  callHref,
  visitHref,
  canResolve,
  timeLabel,
}: {
  item: ReviewItemDetail;
  /** "פריטים לבדיקה". */
  backHref: string;
  /** The call card. */
  callHref: string;
  /** The visit on the call card; null for a call-level item. */
  visitHref: string | null;
  /** Whether the viewer's screens offer deciding this item (display only, G-04). */
  canResolve: boolean;
  timeLabel: ReviewTimeLabel;
}) {
  const kind = REVIEW_KIND_LABELS[item.kind];
  const labels = reviewVersionLabels(item.source);
  const r = item.resolution;
  const fieldLabel = new Map(item.fields.map((f) => [f.key, f.label]));
  return (
    <>
      <div>
        <Link className="btn" href={backHref} prefetch={false} style={{ padding: "6px 12px" }}>
          <span aria-hidden="true">› </span>
          חזרה לפריטים לבדיקה
        </Link>
      </div>
      <div className="ptitle">
        <div style={{ minWidth: 0 }}>
          <div className="rv-title">
            <h1>
              <bdi>{kind}</bdi>
            </h1>
            <ReviewStatusPill status={item.status} />
            {item.authority === "closed-visit" && <ReviewClosedVisitPill />}
            {item.isTest && <TestBadge />}
          </div>
          <div className="sub rv-title-sub">
            <span>
              <Link className="lnk" href={callHref} prefetch={false} aria-label={`כרטיס הקריאה · פנייה ${item.call.req}`}>
                פנייה <span className="num">{item.call.req}</span>
              </Link>{" "}
              · <bdi>{item.call.customerName}</bdi>
            </span>
            {item.visit && visitHref ? (
              <span className="rv-visit">
                <Link className="lnk" href={visitHref} prefetch={false} aria-label={`ביקור ${item.visit.n} בכרטיס הקריאה ${item.call.req}`}>
                  ביקור <span className="num">{item.visit.n}</span>
                </Link>{" "}
                <StatusPill status={item.visit.status} />
              </span>
            ) : (
              <span>ברמת הקריאה</span>
            )}
            <span className="num">התקבל {timeLabel(item.receivedAt)}</span>
          </div>
        </div>
      </div>

      <div className="rv-cols">
        <div className="grid">
          <DashboardSection id="review-about" title="על הפריט">
            <div className="rv-notes">
              <p className="note rv-p">{REVIEW_KIND_EXPLANATIONS[item.kind]}</p>
              {item.source.kind === "invitation" && <p className="sub rv-p">{INVITATION_REVIEW_RULE}</p>}
              {item.authority === "closed-visit" && (
                <p className="sub rv-p">
                  <span aria-hidden="true">🔒 </span>
                  {CLOSED_VISIT_RULE}
                </p>
              )}
            </div>
            <SourceRows source={item.source} timeLabel={timeLabel} receivedAt={item.receivedAt} />
            {item.completionEmailKey && (
              <div className="kv rv-kv-gap">
                <span>מייל סיום</span>
                <span>
                  {r ? "נקבע לפי ההחלטה" : "נכנס לתור פעם אחת בלבד, רק אם הסגירה מתקבלת"}
                  <span className="sub" style={{ display: "block" }}>
                    מפתח ייחודי:{" "}
                    <bdi dir="ltr" className="rv-code">
                      {item.completionEmailKey}
                    </bdi>
                  </span>
                </span>
              </div>
            )}
          </DashboardSection>

          {item.appliedWithNotification.length > 0 && (
            <DashboardSection id="review-applied" title="הוחל מיד עם התראה" hint="שינויים לא קריטיים מאותו זימון; לא דורשים החלטה">
              <div className="kv">
                {item.appliedWithNotification.map((a, i) => (
                  <AppliedRow key={i} label={a.label} value={a.value} />
                ))}
              </div>
            </DashboardSection>
          )}
        </div>

        <div className="grid">
          <DashboardSection
            id="review-fields"
            title="שתי הגרסאות לפי שדה"
            count={item.fields.length}
            hint="הערכים כפי שנשמרו כשהפריט נוצר"
          >
            <ul className="rv-fields">
              {item.fields.map((f) => (
                <FieldVersions key={f.key} f={f} labels={labels} source={item.source} />
              ))}
            </ul>
            <p className="sub rv-p rv-both">{BOTH_VERSIONS_RULE}</p>
          </DashboardSection>

          <DashboardSection id="review-decision" title={r ? "ההחלטה" : "טיפול בפריט"}>
            {r ? (
              <>
                <div className="kv">
                  <span>החלטה</span>
                  <span>
                    <b>{REVIEW_DECISION_LABELS[r.decision]}</b>
                  </span>
                  {r.fieldChoices &&
                    Object.entries(r.fieldChoices).map(([key, choice]) => (
                      <AppliedRow key={key} label={fieldLabel.get(key) ?? key} value={reviewChoiceText(choice, labels)} />
                    ))}
                  <span>על ידי</span>
                  <span>{r.by.name}</span>
                  <span>מתי</span>
                  <span className="num">{timeLabel(r.at)}</span>
                  <span>הערה</span>
                  <span>{r.note ? <bdi>{r.note}</bdi> : "ללא הערה"}</span>
                </div>
                <p className="sub rv-p rv-both">הפריט סגור לעריכה. שתי הגרסאות נשמרות עם הפריט.</p>
              </>
            ) : canResolve ? (
              <ReviewResolveForm item={item} labels={labels} />
            ) : (
              <p className="rv-locked">
                <span aria-hidden="true">🔒 </span>
                {item.authority === "closed-visit"
                  ? "רק מנהל או יוצר מחליטים בפריט שמשנה ביקור שנסגר במערכת או שבוטל."
                  : "לתפקיד הזה אין הרשאה להחליט בפריטים לבדיקה."}
              </p>
            )}
          </DashboardSection>
        </div>
      </div>
    </>
  );
}

function AppliedRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span>{label}</span>
      <span>
        <bdi>{value}</bdi>
      </span>
    </>
  );
}
