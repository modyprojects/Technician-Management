import {
  EXISTING_REQUEST_LABELS,
  SYNC_MODE_LABELS,
  type TemplateSettings,
} from "@/features/settings/data/types";
import { SettingsAlways, SettingsMore } from "./SettingsShell";
import { SettingsShellToggle } from "./SettingsShellToggle";

// Settings › תבנית זימון (docs/demo.html setTemplate() L970-973, as amended by demo-deviations
// SE-13 to SE-15). Server Component; the "חובה" switches are client islands.
// - "נושא הזימון מתחיל ב-" (SE-13): the subject prefix, to confirm with customer service (O2).
// - SE-14 (D08): the demo's "בדיקת תיבת Outlook · כל 5 דקות" becomes "מתעדכן אוטומטית כשזימון
//   נוצר או משתנה" (event-driven change notifications, never polling).
// - An existing request number joins the call as another visit.
// - Labels (SE-15): "מספר לקוח" added and required, "באחריות" optional; the D17 labels ("מספר
//   פנייה", "מספר לקוח") are locked required (disabled switch, "🔒 תמיד חובה"). Other labels:
//   useCommands().settings.setTemplateLabelRequired. The final list comes from owner task O2.
// - The demo's "והנציגה מקבלת מייל" is not claimed: that mail waits for d09 (SE-12).
// Editing is governed by the matrix key `settings` (D35), checked on the server (G-04).

export function SettingsTemplate({ template }: { template: TemplateSettings }) {
  return (
    <>
      <section className="card sec" aria-labelledby="set-tpl-detect">
        <h2 id="set-tpl-detect">זיהוי זימון</h2>
        <div className="kv set-kv">
          <span>נושא הזימון מתחיל ב-</span>
          <b>
            <bdi>{template.subjectPrefix}</bdi>
          </b>
          <span>עדכון מ-Outlook</span>
          <b>{SYNC_MODE_LABELS[template.syncMode]}</b>
          <span>מספר פנייה שכבר קיים</span>
          <b>{EXISTING_REQUEST_LABELS[template.existingRequest]}</b>
        </div>
      </section>
      <section className="card" style={{ overflow: "hidden" }} aria-labelledby="set-tpl-labels">
        <div className="sec set-head">
          <div>
            <h2 id="set-tpl-labels">תוויות בזימון</h2>
            <div className="sub">
              שדה חובה שחסר בזימון גורם לכך שהזימון לא ייקלט. &quot;מספר פנייה&quot; ו&quot;מספר לקוח&quot; תמיד חובה. הרשימה הסופית
              תיקבע עם שירות הלקוחות.
            </div>
          </div>
        </div>
        <div className="scrollx">
          <table>
            <thead>
              <tr>
                <th>תווית (כמו שכתובה בזימון)</th>
                <th className="col-fit">חובה</th>
              </tr>
            </thead>
            <tbody>
              {template.labels.items.map((l) => (
                <tr key={l.key}>
                  <td>
                    <b>{l.label}:</b>
                  </td>
                  <td className="col-fit">
                    {l.locked ? (
                      <span className="set-tog">
                        <button
                          type="button"
                          className="tog on"
                          disabled
                          aria-pressed={true}
                          aria-label={`${l.label} חובה`}
                          aria-describedby={`set-tpl-locked-${l.key}`}
                        />
                        <SettingsAlways id={`set-tpl-locked-${l.key}`} text="תמיד חובה" />
                      </span>
                    ) : (
                      <SettingsShellToggle
                        action={{ kind: "templateRequired", key: l.key }}
                        initial={l.required}
                        label={`${l.label} חובה`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SettingsMore shown={template.labels.items.length} total={template.labels.total} />
      </section>
    </>
  );
}
