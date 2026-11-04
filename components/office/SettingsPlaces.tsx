"use client";

// Settings › מקומות איסוף (docs/demo.html setPlaces() L952-955, demo-deviations SE-06): name, type,
// address (for Waze), phone, opening hours and "פעיל".
// - "+ הוספת מקום" (the demo's toast button) opens a form: useCommands().settings.addPlace.
// - "פעיל": settings.setPlaceActive.
// - "מחיקה" only for a place nothing references (`inUse` false): settings.deletePlace. A referenced
//   place can only be deactivated (SE-06; the database restricts the delete).
// - The add form focuses its first field when it opens; a failed check focuses the invalid field
//   (aria-invalid) and the error inside the form describes it. A delete failure shows under the card
//   head, described by the "מחיקה" buttons.
// - At narrow widths type, address, phone and hours move under the name (styles/ui.css
//   .set-col-wide), so "פעיל" and "מחיקה" stay in view.
// Editing is governed by the matrix key `settings` (D35), checked on the server (G-04). Changes show
// on this screen only; a row from a simulated command is marked as not saved.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { Bounded } from "@/features/data-access/common";
import { PLACE_TYPES, type NewPlaceInput, type PlaceSetting } from "@/features/settings/data/types";
import { newPlaceError, PLACE_FIELD_MAX, SETTING_NAME_MAX, settingNameError } from "@/features/settings/data/validate";
import { SettingsMore, SettingsNotSaved } from "./SettingsShell";
import { SettingsShellToggle } from "./SettingsShellToggle";

const ADD_FAILED = "המקום לא נוסף. נסה שוב.";
const DELETE_FAILED = "המקום לא נמחק. נסה שוב.";

const EMPTY_DRAFT: NewPlaceInput = { name: "", type: PLACE_TYPES[1], address: "", phone: "", hours: "" };

type Field = "name" | "address";

export function SettingsPlaces({ places }: { places: Bounded<PlaceSetting> }) {
  const { settings } = useCommands();
  const [rows, setRows] = useState<PlaceSetting[]>(places.items);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NewPlaceInput>(EMPTY_DRAFT);
  /** The add form's error, and the field it is about (null: the whole form). */
  const [formError, setFormError] = useState<{ text: string; field: Field | null } | null>(null);
  /** A delete failure (shown under the card head). */
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Rows added by a simulated command (shown as not saved). */
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const formId = `${id}-form`;
  const formErrorId = `${id}-form-error`;
  const deleteErrorId = `${id}-delete-error`;

  // Focus the first field when the form opens.
  useEffect(() => {
    if (open) nameInput.current?.focus();
  }, [open]);

  const set = <K extends keyof NewPlaceInput>(key: K, value: NewPlaceInput[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (formError?.field === key) setFormError(null);
  };

  function close() {
    setOpen(false);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    addButton.current?.focus();
  }

  function fail(text: string, field: Field | null) {
    setFormError({ text, field });
    if (field === "name") nameInput.current?.focus();
    if (field === "address") addressInput.current?.focus();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input: NewPlaceInput = {
      name: draft.name.trim(),
      type: draft.type,
      address: draft.address.trim(),
      phone: draft.phone.trim(),
      hours: draft.hours.trim(),
    };
    // Checked first with the command's own validator: a typo gets an inline error, not a toast.
    const invalid = newPlaceError(input);
    if (invalid) {
      fail(invalid, settingNameError(input.name, "שם המקום") ? "name" : !input.address ? "address" : null);
      return;
    }
    setBusy(true);
    setFormError(null);
    let failure: string | null = null;
    let created: PlaceSetting | null = null;
    let simulated = false;
    try {
      const result = await settings.addPlace(input);
      if (result.ok && result.data) {
        // The id and test marker come from the command (as stored, D47).
        created = { ...input, id: result.data.id, isTest: result.data.isTest, active: true, inUse: false };
        simulated = result.simulated;
      } else failure = result.ok ? ADD_FAILED : result.error;
    } catch {
      failure = ADD_FAILED;
    } finally {
      setBusy(false);
    }
    if (failure || !created) {
      fail(failure ?? ADD_FAILED, null);
      return;
    }
    const row = created;
    setRows((r) => [...r, row]);
    if (simulated) setUnsaved((u) => [...u, row.id]);
    close();
  }

  async function remove(place: PlaceSetting) {
    if (busy) return;
    setBusy(true);
    setDeleteError(null);
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
      setDeleteError(failure);
      return;
    }
    setRows((r) => r.filter((x) => x.id !== place.id));
    heading.current?.focus();
  }

  const fieldProps = (field: Field) =>
    formError?.field === field ? { "aria-invalid": true as const, "aria-describedby": formErrorId } : {};

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
            aria-controls={open ? formId : undefined}
            onClick={() => (open ? close() : setOpen(true))}
          >
            + הוספת מקום
          </button>
        </div>
        {open && (
          <form
            id={formId}
            className="set-form"
            noValidate
            onSubmit={(e) => void add(e)}
            aria-label="הוספת מקום איסוף"
            aria-describedby={formError && !formError.field ? formErrorId : undefined}
          >
            <label>
              שם
              <input
                ref={nameInput}
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                required
                maxLength={SETTING_NAME_MAX}
                autoComplete="off"
                {...fieldProps("name")}
              />
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
              <input
                ref={addressInput}
                value={draft.address}
                onChange={(e) => set("address", e.target.value)}
                required
                maxLength={PLACE_FIELD_MAX}
                autoComplete="off"
                {...fieldProps("address")}
              />
            </label>
            <label>
              טלפון
              <input type="tel" dir="ltr" value={draft.phone} onChange={(e) => set("phone", e.target.value)} maxLength={PLACE_FIELD_MAX} autoComplete="off" />
            </label>
            <label>
              שעות פתיחה
              <input value={draft.hours} onChange={(e) => set("hours", e.target.value)} maxLength={PLACE_FIELD_MAX} autoComplete="off" />
            </label>
            <div className="set-form-actions">
              <button type="submit" className="btn pri" disabled={busy}>
                {busy ? "מוסיף…" : "הוספה"}
              </button>
              <button type="button" className="btn" onClick={close} disabled={busy}>
                ביטול
              </button>
              {formError && (
                <span id={formErrorId} role="alert" className="set-err">
                  {formError.text}
                </span>
              )}
            </div>
          </form>
        )}
        {deleteError && (
          <div id={deleteErrorId} role="alert" className="set-err set-err-row">
            {deleteError}
          </div>
        )}
        <div className="scrollx">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th className="col-fit set-col-wide">סוג</th>
                <th className="set-col-wide">כתובת (ל-Waze)</th>
                <th className="col-fit set-col-wide">טלפון</th>
                <th className="col-fit set-col-wide">שעות פתיחה</th>
                <th className="col-fit">פעיל</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="set-name">
                      <b>{p.name}</b>
                      {unsaved.includes(p.id) && <SettingsNotSaved />}
                    </span>
                    {/* Narrow widths: the details under the name (their columns are hidden). */}
                    <span className="sub set-inline-narrow" style={{ fontSize: 12, whiteSpace: "normal" }}>
                      <span style={{ display: "block" }}>
                        {p.type} · {p.address}
                      </span>
                      {(p.phone || p.hours) && (
                        <span style={{ display: "block" }}>
                          {p.phone && <bdi dir="ltr">{p.phone}</bdi>}
                          {p.phone && p.hours ? " · " : ""}
                          {p.hours}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="col-fit set-col-wide">{p.type}</td>
                  <td className="set-col-wide">{p.address}</td>
                  <td className="col-fit set-col-wide" dir="ltr" style={{ textAlign: "right" }}>
                    {p.phone}
                  </td>
                  <td className="col-fit set-col-wide">{p.hours}</td>
                  <td className="col-fit">
                    <div className="set-cell-actions">
                      <SettingsShellToggle action={{ kind: "placeActive", id: p.id }} initial={p.active} label={`${p.name} פעיל`} />
                      {!p.inUse && (
                        <button
                          type="button"
                          className="chip set-del"
                          disabled={busy}
                          aria-label={`מחיקת ${p.name}`}
                          aria-describedby={deleteError ? deleteErrorId : undefined}
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
