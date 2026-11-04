import type { ReactNode } from "react";
import type { OpenDecisionId } from "@/features/settings/data/types";
import { SettingsTabs, type SettingsTabLink } from "./SettingsTabs";

// Settings page shell and shared display parts (docs/demo.html offSettings() L938-942 and the
// settings bodies L942-973). No hooks: usable from Server and Client Components. Styles are the
// demo's inline styles as classes (styles/ui.css "settings-ops").
// - SettingsShell: "הגדרות · <tab>" with the sub-line, the tab column and the body.
// - SettingsCardHead: a card's title row (the demo's `.sec` with h2 and the "+ הוספה" button).
// - SettingsLine: the demo's mail-settings row (setMail() line()).
// - SettingsPendingToggle: a disabled switch for a setting that waits for an open owner decision,
//   with the visible "ממתין להחלטה (dNN)" hint; it never resolves the decision.
// - SettingsAlways: the fixed "תמיד" marker (D09 recipients, D17 labels): not a toggle.
// - SettingsNotSaved: "לא נשמר" next to a row added by a simulated command (TE-23).
// - SettingsMore: "מוצגים X מתוך Y" under a bounded list.

export function SettingsShell({
  title,
  sub,
  tabs,
  children,
}: {
  /** The open tab's title. */
  title: string;
  sub?: string;
  tabs: readonly SettingsTabLink[];
  children: ReactNode;
}) {
  return (
    <>
      <div className="ptitle">
        <div>
          <h1>הגדרות · {title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
      </div>
      <div className="set-layout">
        <SettingsTabs tabs={tabs} />
        <div className="set-body">{children}</div>
      </div>
    </>
  );
}

export function SettingsCardHead({
  id,
  title,
  sub,
  action,
}: {
  /** The h2 id (the card's aria-labelledby). */
  id: string;
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="sec set-head">
      <div>
        <h2 id={id}>{title}</h2>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

export function SettingsLine({
  label,
  sub,
  subId,
  control,
}: {
  label: ReactNode;
  /** Second line(s) under the label. */
  sub?: ReactNode;
  /** Id of the second line, for the control's aria-describedby. */
  subId?: string;
  control: ReactNode;
}) {
  return (
    <div className="set-line">
      <span>
        {label}
        {sub && (
          <span id={subId} className="sub set-line-sub">
            {sub}
          </span>
        )}
      </span>
      {control}
    </div>
  );
}

/** The visible hint of a pending setting: "ממתין להחלטה (d10)". */
export const pendingHint = (decision: OpenDecisionId): string => `ממתין להחלטה (${decision})`;

/** A disabled switch for a pending setting. `hintId` names the visible pendingHint() line. */
export function SettingsPendingToggle({ label, hintId }: { label: string; hintId: string }) {
  return <button type="button" className="tog" disabled aria-pressed={false} aria-label={label} aria-describedby={hintId} />;
}

/** The fixed "תמיד" marker: a recipient or a rule that is not a setting (D09, D17). */
export function SettingsAlways({ text = "תמיד", id }: { text?: string; id?: string }) {
  return (
    <span id={id} className="pill set-always">
      <span aria-hidden="true">🔒 </span>
      {text}
    </span>
  );
}

/** Marks a row added on this screen by a simulated command: it was not saved (TE-23). */
export function SettingsNotSaved() {
  return <span className="sub">לא נשמר · פעולה מדומה</span>;
}

/** "מוצגים X מתוך Y" when a bounded list was cut (docs/security.md: query bounds). */
export function SettingsMore({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <div className="sub set-more">
      מוצגים {shown} מתוך {total}
    </div>
  );
}
