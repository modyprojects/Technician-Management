"use client";

// The settings switch (docs/demo.html tog(), L937): one `.tog` button bound to one settings
// command through useCommands() (simulated in the UI demo: the provider's toast says nothing was
// saved). The switch moves at once and moves back, with an inline error, when the command fails;
// while a change is running, further presses are ignored. The new value shows on this screen only.
// Accessibility: aria-pressed (as the demo's tog), a Hebrew aria-label, optional aria-describedby.
// Shared by the operational Settings tabs (technicians, places, reasons, call types, mail,
// template). What a role may change is decided on the server (G-04); the page offers the tab.
import { useId, useRef, useState } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { CommandResult } from "@/features/data-access/common";
import type { Commands } from "@/features/data-access/types";
import type { TechnicianId } from "@/features/reference/data/types";
import type { SettingId, TechNotificationKey, TemplateFieldKey } from "@/features/settings/data/types";

const FAILED = "השינוי לא נשמר. נסה שוב.";

/** Which setting the switch changes. */
export type SettingsToggleAction =
  | { kind: "technicianActive"; techId: TechnicianId; expectedVersion: number }
  | { kind: "placeActive"; id: SettingId }
  | { kind: "reasonActive"; id: SettingId }
  | { kind: "callTypeActive"; id: SettingId }
  | { kind: "techNotification"; key: TechNotificationKey }
  | { kind: "templateRequired"; key: TemplateFieldKey };

function runToggle(settings: Commands["settings"], action: SettingsToggleAction, value: boolean): Promise<CommandResult> {
  switch (action.kind) {
    case "technicianActive":
      return settings.setTechnicianActive({ techId: action.techId, expectedVersion: action.expectedVersion, active: value });
    case "placeActive":
      return settings.setPlaceActive(action.id, value);
    case "reasonActive":
      return settings.setReasonActive(action.id, value);
    case "callTypeActive":
      return settings.setCallTypeActive(action.id, value);
    case "techNotification":
      return settings.setTechNotification(action.key, value);
    case "templateRequired":
      return settings.setTemplateLabelRequired(action.key, value);
  }
}

export function SettingsShellToggle({
  action,
  initial,
  label,
  describedBy,
  onChange,
}: {
  action: SettingsToggleAction;
  initial: boolean;
  /** Hebrew accessible name, e.g. "יורם פעיל". */
  label: string;
  describedBy?: string;
  /** Called with the new value after the command succeeded (client parents only). */
  onChange?: (value: boolean) => void;
}) {
  const { settings } = useCommands();
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const errorId = useId();

  async function toggle() {
    if (running.current) return;
    running.current = true;
    const before = on;
    const next = !before;
    setOn(next);
    setError(null);
    let failure: string | null = null;
    try {
      const result = await runToggle(settings, action, next);
      if (!result.ok) failure = result.error;
    } catch {
      failure = FAILED;
    } finally {
      running.current = false;
    }
    if (failure) {
      setOn(before);
      setError(failure);
    } else {
      onChange?.(next);
    }
  }

  const described = [describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <span className="set-tog">
      <button
        type="button"
        className={on ? "tog on" : "tog"}
        aria-pressed={on}
        aria-label={label}
        aria-describedby={described}
        onClick={() => void toggle()}
      />
      {error && (
        <span id={errorId} role="alert" className="set-err">
          {error}
        </span>
      )}
    </span>
  );
}
