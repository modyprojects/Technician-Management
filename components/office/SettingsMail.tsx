import {
  COMPLETION_OUTCOME_LABELS,
  TECH_NOTIFICATION_LABELS,
  type CompletionMailRule,
  type MailSettings,
} from "@/features/settings/data/types";
import { pendingHint, SettingsAlways, SettingsLine, SettingsPendingToggle } from "./SettingsShell";
import { SettingsShellToggle } from "./SettingsShellToggle";

// Settings › מיילים והתראות (docs/demo.html setMail() L964-969, as amended by demo-deviations
// SE-08 to SE-12). Server Component; the technician switches are client islands.
// - Completion email (SE-08, D09): ALWAYS to the Manager and the customer-service mailbox, for both
//   outcomes. Shown as fixed "תמיד" rows, never toggles. Which Manager (one account or every
//   active Manager) waits for d10.
// - "הנציגה המטפלת (מהזימון)" (SE-09, d10), "לצרף תמונות וסרטונים" (SE-10, d11) and the
//   unparsed-invitation mail to the rep (SE-12, d09): disabled switches with "ממתין להחלטה (dNN)".
//   The screen never resolves an open decision.
// - Technician notifications (SE-11, D10): in-app only, "זימון חדש או שינוי ביומן" and "ביטול
//   ביקור" through useCommands().settings.setTechNotification. No morning pickup reminder (TE-28).
// The demo's "נסה: שליחת זימון מ-Outlook" hint points at the demo bar (X-02) and is not shown.

/** Card accent per outcome (the demo's border-top colours). */
const OUTCOME_COLOR: Readonly<Record<CompletionMailRule["outcome"], string>> = {
  done: "var(--s-done)",
  cont: "var(--s-cont)",
};

function CompletionCard({ rule }: { rule: CompletionMailRule }) {
  const base = `set-mail-${rule.outcome}`;
  return (
    <section className="card sec" style={{ borderTop: `4px solid ${OUTCOME_COLOR[rule.outcome]}` }} aria-labelledby={`${base}-title`}>
      <h2 id={`${base}-title`}>{COMPLETION_OUTCOME_LABELS[rule.outcome]}</h2>
      <SettingsLine
        label="הנציגה המטפלת (מהזימון)"
        sub={pendingHint(rule.handlingRep.decision)}
        subId={`${base}-rep-hint`}
        control={<SettingsPendingToggle label="מייל לנציגה המטפלת" hintId={`${base}-rep-hint`} />}
      />
      <SettingsLine
        label="תיבת שירות לקוחות"
        sub={
          <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
            {rule.fixedRecipients.serviceMailbox}
          </span>
        }
        control={<SettingsAlways />}
      />
      <SettingsLine
        label="מנהל"
        sub={`איזה מנהל מקבל (מנהל אחד או כל המנהלים): ${pendingHint(rule.managerScope.decision)}`}
        control={<SettingsAlways />}
      />
      <SettingsLine
        label="לצרף תמונות וסרטונים"
        sub={
          <>
            {pendingHint(rule.attachMedia.decision)}
            <span style={{ display: "block" }}>אחרת – רק קישור לכרטיס הקריאה</span>
          </>
        }
        subId={`${base}-media-hint`}
        control={<SettingsPendingToggle label="צירוף תמונות וסרטונים למייל" hintId={`${base}-media-hint`} />}
      />
    </section>
  );
}

export function SettingsMail({ mail }: { mail: MailSettings }) {
  return (
    <>
      <div className="cols2">
        {mail.completion.map((rule) => (
          <CompletionCard key={rule.outcome} rule={rule} />
        ))}
      </div>
      <div className="note">
        מייל סיום ביקור נשלח תמיד למנהל ולתיבת שירות הלקוחות, גם בביקור שטופל וגם בביקור שעבר להמשך טיפול. בהדגמה לא נשלחים
        מיילים.
      </div>
      <div className="cols2">
        <section className="card sec" aria-labelledby="set-mail-tech-title">
          <h2 id="set-mail-tech-title">התראות לטכנאי (באפליקציה)</h2>
          {mail.technicianNotifications.map((n) => (
            <SettingsLine
              key={n.key}
              label={TECH_NOTIFICATION_LABELS[n.key]}
              control={
                <SettingsShellToggle
                  action={{ kind: "techNotification", key: n.key }}
                  initial={n.on}
                  label={`התראה לטכנאי: ${TECH_NOTIFICATION_LABELS[n.key]}`}
                />
              }
            />
          ))}
        </section>
        <section className="card sec" aria-labelledby="set-mail-unparsed-title">
          <h2 id="set-mail-unparsed-title">זימון שלא נקלט</h2>
          <SettingsLine
            label="מייל לנציגה ששלחה את הזימון"
            sub={
              <>
                <span style={{ display: "block" }}>עם רשימת השדות החסרים</span>
                {pendingHint(mail.unparsedInvitationMail.decision)}
              </>
            }
            subId="set-mail-unparsed-hint"
            control={<SettingsPendingToggle label="מייל לנציגה על זימון שלא נקלט" hintId="set-mail-unparsed-hint" />}
          />
        </section>
      </div>
    </>
  );
}
