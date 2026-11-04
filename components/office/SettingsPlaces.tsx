"use client";

// Settings › מקומות איסוף (docs/demo.html setPlaces() L952-955, demo-deviations SE-06): name, type,
// address (for Waze), phone, opening hours and "פעיל".
// - "+ הוספת מקום" (the demo's toast button) opens a form: useCommands().settings.addPlace.
// - "פעיל": settings.setPlaceActive.
// - "מחיקה" only for a place nothing references (`inUse` false): settings.deletePlace. A referenced
//   place can only be deactivated (SE-06; the database restricts the delete).
// Editing is governed by the matrix key `settings` (D35), checked on the server (G-04). Changes show
// on this screen only; in the UI demo every command is simulated (toast).
import { useId, useRef, useState, type FormEvent } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { Bounded } from "@/features/data-access/common";
import type { NewPlaceInput, PlaceSetting } from "@/features/settings/data/types";
import { PLACE_FIELD_MAX, SETTING_NAME_MAX } from "@/features/settings/data/validate";
import { SettingsMore } from "./SettingsShell";
import { SettingsShellToggle } from "./SettingsShellToggle";

const ADD_FAILED = "המקום לא נוסף. נסה שוב.";
const DELETE_FAILED = "המקום לא נמחק. נסה שוב.";

/** Place types (the demo's PLACES values). */
const PLACE_TYPES = ["מרכז לוגיסטי", "סניף"] as const;

const EMPTY_DRAFT: NewPlaceInput = { name: "", type: PLACE_TYPES[1], address: "", phone: "", hours: "" };

export function SettingsPlaces({ places }: { places: Bounded<PlaceSetting> }) {
  const { settings } = useCommands();
  const [rows, setRows] = useState<PlaceSetting[]>(places.items);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NewPlaceInput>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const formId = `${id}-form`;
  const errorId = `${id}-error`;

  const set = <K extends keyof NewPlaceInput>(key: K, value: NewPlaceInput[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function close() {
    setOpen(false);
    setDraft(EMPTY_DRAFT);
    setError(null);
    addButton.current?.focus();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const input: NewPlaceInput = {
      name: draft.name.trim(),
      type: draft.type,
      address: draft.address.trim(),
      phone: draft.phone.trim(),
      hours: draft.hours.trim(),
    };
    let failure: string | null = null;
    let newId: string | null = null;
    try {
      const result = await settings.addPlace(input);
      if (result.ok) newId = result.data?.id ?? `new-place-${rows.length + 1}`;
      else failure = result.error;
    } catch {
      failure = ADD_FAILED;
    } finally {
      setBusy(false);
    }
    if (failure || !newId) {
      setError(failure ?? ADD_FAILED);
      return;
    }
    const created: PlaceSetting = { id: newId, ...input, active: true, inUse: false, isTest: true };
    setRows((r) => [...r, created]);
    close();
  }

  async function remove(place: PlaceSetting) {
    if (busy) return;
    setBusy(true);
    setError(null);
    let failure: string | null = null;
    try {
      const result = await settings.deletePlace(place.id);
      if (!result.ok) failure = result.error;
    } catch {
      failure = DELETE_FAILED;
    } finally {
      setBusy(false);
    }
    if (failure) {
      setError(failure);
      return;
    }
    setRows((r) => r.filter((x) => x.id !== place.id));
    heading.current?.focus();
  }

  return (
    <>
      <section className="card" style={{ overflow: "hidden" }} aria-labelledby={`${id}-title`}>
        <div className="sec set-head">
          <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
            מקומות איסוף
          </h2>
          <button
            ref={addButton}
            type="button"
            className="btn pri"
            aria-expanded={open}
            aria-controls={formId}
            onClick={() => (open ? close() : setOpen(true))}
          >
            + הוספת מקום
          </button>
        </div>
        {open && (
          <form id={formId} className="set-form" onSubmit={(e) => void add(e)} aria-label="הוספת מקום איסוף">
            <label>
              שם
              <input value={draft.name} onChange={(e) => set("name", e.target.value)} required maxLength={SETTING_NAME_MAX} autoComplete="off" />
            </label>
            <label>
              סוג
              <select value={draft.type} onChange={(e) => set("type", e.target.value)}>
                {PLACE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              כתובת (ל-Waze)
              <input value={draft.address} onChange={(e) => set("address", e.target.value)} required maxLength={PLACE_FIELD_MAX} autoComplete="off" />
            </label>
            <label>
              טלפון
              <input type="tel" dir="ltr" value={draft.phone} onChange={(e) => set("phone", e.target.value)} maxLength={20} autoComplete="off" />
            </label>
            <label>
              שעות פתיחה
              <input value={draft.hours} onChange={(e) => set("hours", e.target.value)} maxLength={PLACE_FIELD_MAX} autoComplete="off" />
            </label>
            <div className="set-form-actions">
              <button type="submit" className="btn pri" disabled={busy}>
                {busy ? "מוסיף…" : "הוספה"}
              </button>
              <button type="button" className="btn" onClick={close}>
                ביטול
              </button>
            </div>
          </form>
        )}
        {error && (
          <div id={errorId} role="alert" className="set-err set-err-row">
            {error}
          </div>
        )}
        <div className="scrollx">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th className="col-fit">סוג</th>
                <th>כתובת (ל-Waze)</th>
                <th className="col-fit">טלפון</th>
                <th className="col-fit">שעות פתיחה</th>
                <th className="col-fit">פעיל</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b>
                  </td>
                  <td className="col-fit">{p.type}</td>
                  <td>{p.address}</td>
                  <td className="col-fit" dir="ltr" style={{ textAlign: "right" }}>
                    {p.phone}
                  </td>
                  <td className="col-fit">{p.hours}</td>
                  <td className="col-fit">
                    <div className="set-cell-actions">
                      <SettingsShellToggle action={{ kind: "placeActive", id: p.id }} initial={p.active} label={`${p.name} פעיל`} />
                      {!p.inUse && (
                        <button
                          type="button"
                          className="chip set-del"
                          disabled={busy}
                          aria-label={`מחיקת ${p.name}`}
                          aria-describedby={error ? errorId : undefined}
                          onClick={() => void remove(p)}
                        >
                          מחיקה
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SettingsMore shown={places.items.length} total={places.total} />
      </section>
      <div className="note">
        השמות כאן הם האפשרויות בשדה &quot;לאסוף מ:&quot; בזימון. הכתובת משמשת לכפתור ה-Waze במסך הבית של הטכנאי. הכתובות לדוגמה
        בלבד.
        <br />
        אפשר למחוק רק מקום שלא בשימוש. מקום שכבר בשימוש אפשר רק לכבות.
      </div>
    </>
  );
}
