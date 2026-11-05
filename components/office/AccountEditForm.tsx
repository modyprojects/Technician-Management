"use client";

// "עריכת פרטים" (Step 2 plan §4 #9; D34 d; SE-05; SE-19 PROPOSED): the routine edit of an account
// row, opened by "עריכה" (profileEditOffered: the Creator on every row, his own included; the
// Manager on Customer Service and Technician rows, never his own). Fields:
// - "שם", "טלפון עבודה", "כינוי בזימונים" (the invitation alias: Migration 1
//   `profiles.invitation_rep_name`, unique) → accounts.updateProfile;
// - on a row with a technician record, the fieldset "פרטי טכנאי": "צבע ביומן" and "מכשיר", and for
//   the Creator only "מייל ב-Outlook" and "פעיל · מקבל זימונים חדשים" (technicianEditFields;
//   TEMPORARY Q14: the Manager sees the pending line instead) → accounts.updateTechnician. One
//   "שם" for both records (as createTechnician; TECH).
// - A Technician account without a field profile ("פרופיל טכנאי חסר") has no fieldset: "השלמה" sets
//   the colour and device.
// Saving: the pure builders profilePatch / technicianPatch (AccountAdminRules) send only the changed
// fields with the version read (nothing changed: "אין שינוי לשמור"). The fields are checked first
// with the shared validators (the error goes to its field). Then updateProfile, then
// updateTechnician; the first failure stops, and when only the technician part failed the dialog
// says the account part was saved (the caller's row keeps it). Every result goes through
// accountAfterProfileUpdate / technicianAfterUpdate (versionAfter), so a second save sends the
// version the first one returned. A hidden field is not access control: the commands check the
// caller (routineUpdateCallerError) and the server checks it in the database.
import { useId, useRef, useState, type FormEvent } from "react";
import type { AccountAdminScope, TechnicianEditField } from "@/features/accounts/data/offers";
import type { UserAccount } from "@/features/accounts/data/types";
import {
  ACCOUNT_NAME_MAX,
  accountNameError,
  DEVICE_MAX,
  deviceError,
  EMAIL_MAX,
  emailError,
  INVITATION_ALIAS_MAX,
  invitationAliasError,
  MANAGER_TECHNICIAN_FIELDS_PENDING,
  NO_CHANGE,
  PHONE_MAX,
  phoneError,
  profileUpdateError,
  technicianUpdateError,
  testAccountEmailError,
} from "@/features/accounts/data/validate";
import { useCommands } from "@/features/data-access/commands-context";
import { technicianColorTokenOf, type TechnicianColorToken } from "@/features/reference/data/types";
import { AccountDialog, ColorChoice, DIALOG_FAILED, DialogNotes } from "./AccountDialog";
import type { AccountTechnicianDetails } from "./AccountAdminParts";
import { accountAfterProfileUpdate, profilePatch, technicianAfterUpdate, technicianPatch } from "./AccountAdminRules";

type Field = "name" | "phone" | "alias" | "color" | "device" | "outlook";

const NOTES: Readonly<Record<AccountAdminScope, string>> = {
  all: "השינוי נכנס לתוקף מיד ונרשם ביומן הביקורת. את מייל הכניסה משנים ב\"שינוי כתובת מייל\".",
  "cs-tech": "השינוי נכנס לתוקף מיד ונרשם ביומן הביקורת. מייל וסיסמה משנה היוצר בלבד.",
};

/** The partial-save line: the account part was saved, the technician part was not. */
const PARTIAL = "פרטי החשבון עודכנו; פרטי הטכנאי לא עודכנו.";

export function AccountEditForm({
  account,
  technician,
  scope,
  fields,
  onProfileSaved,
  onTechnicianSaved,
  onDone,
  onClose,
}: {
  account: UserAccount;
  /** The row's technician record as the viewer may see it (Q14); null without one. */
  technician: AccountTechnicianDetails | null;
  scope: AccountAdminScope;
  /** The technician fields the viewer edits (technicianEditFields). */
  fields: readonly TechnicianEditField[];
  /** The profile part succeeded: the row as it is now (the dialog may stay open). */
  onProfileSaved: (account: UserAccount, simulated: boolean) => void;
  /** The technician part succeeded: the technician details as they are now. */
  onTechnicianSaved: (technician: AccountTechnicianDetails, simulated: boolean) => void;
  /** Everything was saved: the new name and whether any part was simulated. */
  onDone: (name: string, simulated: boolean) => void;
  onClose: () => void;
}) {
  const { accounts } = useCommands();
  const id = useId();
  const errorId = `${id}-error`;
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const aliasRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);
  const outlookRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);
  /** The records as last saved here (the version to send next, the values a patch compares to). */
  const [base, setBase] = useState(account);
  const [tech, setTech] = useState(technician);
  const allowed = new Set(fields);
  const showTech = technician !== null && fields.length > 0;
  const creatorTech = showTech && allowed.has("outlookEmail") && allowed.has("active");

  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(account.phone);
  const [alias, setAlias] = useState(account.invitationAlias ?? "");
  const [color, setColor] = useState<TechnicianColorToken | null>(technicianColorTokenOf(technician?.color));
  const [device, setDevice] = useState(technician?.device ?? "");
  const [outlook, setOutlook] = useState(technician?.outlookEmail ?? "");
  const [active, setActive] = useState(technician?.active ?? false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: Field | null } | null>(null);
  /** Simulated parts so far (the row is marked "לא נשמר" when any part was). */
  const simulatedRef = useRef(false);

  const edit = <T,>(set: (v: T) => void, field: Field) => (value: T) => {
    set(value);
    setDirty(true);
    if (error?.field === field || error?.field === null) setError(null);
  };

  function fail(text: string, field: Field | null) {
    setError({ text, field });
    const target: Record<Field, HTMLElement | null | undefined> = {
      name: nameRef.current,
      phone: phoneRef.current,
      alias: aliasRef.current,
      color: colorRef.current?.querySelector<HTMLInputElement>("input"),
      device: deviceRef.current,
      outlook: outlookRef.current,
    };
    if (field) target[field]?.focus();
  }

  /** The first invalid field, in form order (the shared validators). */
  function firstInvalid(): { text: string; field: Field } | null {
    const checks: [Field, string | null][] = [
      ["name", accountNameError(name)],
      ["phone", phone.trim() === "" ? null : phoneError(phone)],
      ["alias", invitationAliasError(alias)],
    ];
    if (showTech && tech) {
      checks.push(["color", color === null ? "צבע לא תקין" : null]);
      checks.push(["device", device.trim() === "" ? null : deviceError(device)]);
      if (creatorTech) {
        // A test-marked technician keeps an example.test Outlook address (D47), as the command checks.
        checks.push(["outlook", emailError(outlook) ?? (tech.isTest !== false ? testAccountEmailError(outlook) : null)]);
      }
    }
    const hit = checks.find(([, text]) => text !== null);
    return hit ? { field: hit[0], text: hit[1] as string } : null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const invalid = firstInvalid();
    if (invalid) return fail(invalid.text, invalid.field);
    const profile = profilePatch(base, { name, phone, invitationAlias: alias });
    const techPatch =
      showTech && tech
        ? technicianPatch(tech, { name, color, device, ...(creatorTech ? { outlookEmail: outlook, active } : {}) }, fields)
        : null;
    if (!profile && !techPatch) return fail(NO_CHANGE, null);
    const shape = (profile ? profileUpdateError(profile) : null) ?? (techPatch ? technicianUpdateError(techPatch) : null);
    if (shape) return fail(shape, null);

    setBusy(true);
    setError(null);
    let failure: string | null = null;
    let profileSaved = false;
    let current = base;
    try {
      if (profile) {
        const r = await accounts.updateProfile(profile);
        if (!r.ok) {
          failure = r.error;
        } else {
          current = accountAfterProfileUpdate(base, profile, r);
          setBase(current);
          simulatedRef.current ||= r.simulated;
          profileSaved = true;
          onProfileSaved(current, r.simulated);
        }
      }
      if (failure === null && techPatch && tech) {
        const r = await accounts.updateTechnician(techPatch);
        if (!r.ok) {
          failure = r.error;
        } else {
          const next = technicianAfterUpdate(tech, techPatch, r);
          setTech(next);
          simulatedRef.current ||= r.simulated;
          onTechnicianSaved(next, r.simulated);
        }
      }
    } catch {
      failure = DIALOG_FAILED;
    } finally {
      setBusy(false);
    }
    if (failure === null) {
      onDone(current.name, simulatedRef.current);
      return;
    }
    fail(profileSaved ? `${failure} ${PARTIAL}` : failure, null);
  }

  const invalid = (field: Field) => (error?.field === field ? { "aria-invalid": true as const, "aria-describedby": errorId } : {});

  return (
    <AccountDialog title={`עריכת פרטים · ${account.name}`} dirty={dirty} busy={busy} onClose={onClose}>
      <form className="vc-form" noValidate onSubmit={(e) => void submit(e)} aria-describedby={error && !error.field ? errorId : undefined}>
        <div className="db">
          <label className="vc-label">
            שם
            <input
              ref={nameRef}
              value={name}
              required
              maxLength={ACCOUNT_NAME_MAX}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => edit(setName, "name")(e.target.value)}
              {...invalid("name")}
            />
          </label>
          <label className="vc-label">
            טלפון עבודה
            <input
              ref={phoneRef}
              type="tel"
              dir="ltr"
              value={phone}
              maxLength={PHONE_MAX}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => edit(setPhone, "phone")(e.target.value)}
              {...invalid("phone")}
            />
          </label>
          <label className="vc-label">
            כינוי בזימונים
            <input
              ref={aliasRef}
              value={alias}
              maxLength={INVITATION_ALIAS_MAX}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => edit(setAlias, "alias")(e.target.value)}
              {...invalid("alias")}
            />
          </label>
          {showTech && (
            <fieldset className="acct-fieldset">
              <legend>פרטי טכנאי</legend>
              <div ref={colorRef}>
                <ColorChoice
                  name={`${id}-color`}
                  value={color}
                  onChange={edit(setColor, "color")}
                  disabled={busy}
                  invalid={error?.field === "color"}
                  describedBy={error?.field === "color" ? errorId : undefined}
                />
              </div>
              <label className="vc-label">
                מכשיר
                <input
                  ref={deviceRef}
                  value={device}
                  maxLength={DEVICE_MAX}
                  autoComplete="off"
                  disabled={busy}
                  onChange={(e) => edit(setDevice, "device")(e.target.value)}
                  {...invalid("device")}
                />
              </label>
              {creatorTech ? (
                <>
                  <label className="vc-label">
                    מייל ב-Outlook
                    <input
                      ref={outlookRef}
                      type="email"
                      dir="ltr"
                      value={outlook}
                      maxLength={EMAIL_MAX}
                      autoComplete="off"
                      disabled={busy}
                      onChange={(e) => edit(setOutlook, "outlook")(e.target.value)}
                      {...invalid("outlook")}
                    />
                  </label>
                  <div className="acct-switch">
                    <span id={`${id}-active`}>פעיל · מקבל זימונים חדשים</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      aria-labelledby={`${id}-active`}
                      className={active ? "tog on" : "tog"}
                      disabled={busy}
                      onClick={() => edit(setActive, "outlook")(!active)}
                    />
                  </div>
                </>
              ) : (
                <p className="sub vc-p">{MANAGER_TECHNICIAN_FIELDS_PENDING}</p>
              )}
            </fieldset>
          )}
          {account.technicianMissing && <p className="sub vc-p">פרופיל טכנאי חסר: את הצבע והמכשיר מגדירים ב&quot;השלמה&quot;.</p>}
          <DialogNotes notes={[{ text: NOTES[scope] }]} />
        </div>
        <div className="df">
          <button type="submit" className="btn pri" disabled={busy}>
            {busy ? "שומר…" : "שמירה"}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          {error && (
            <span id={errorId} role="alert" className="set-err vc-err">
              {error.text}
            </span>
          )}
        </div>
      </form>
    </AccountDialog>
  );
}
