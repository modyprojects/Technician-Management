"use client";

// "מה כל הרשאה רואה" (docs/demo.html setUsers() L944-946, PERMS L306-310; demo-deviations SE-02,
// D33, D51): one row per matrix key, the Creator's fixed column (✓ 🔒) and toggles for the Manager
// and Customer Service. The demo's look (card, table, .tog toggles with aria-pressed) with:
// - edits for the Creator only (`editable`); any other viewer sees the values read-only;
// - the TEMPORARY marker (D51): values stay temporary until the owner approves the final matrix in
//   Step 10. When every value is temporary the section says so once; when some are approved, each
//   temporary cell is marked;
// - cells that wait for an open decision are disabled with "ממתין להחלטה": Customer Service
//   `cancel` (d08, SE-04) and `usage` for both roles (d13, OF-15);
// - the demo's "נסה לכבות משהו למנהל, ואז לעבור למעלה לתפקיד 'מנהל'" hint is dropped (no role
//   switcher, X-02; nothing is saved in the demo).
// Each toggle runs useCommands().settings.setPermission. The switch moves at once and moves back,
// with an inline error, when the command fails. DISPLAY ONLY in the demo (G-04): the values decide
// what the demo shows; nothing is saved. In the app the matrix is changed only through a
// Creator-only server function and enforced on the server and in the database (D33).
import { useId, useRef, useState } from "react";
import { ACCOUNT_ROLE_LABELS } from "@/features/accounts/data/types";
import { useCommands } from "@/features/data-access/commands-context";
import { MATRIX_ROLE_VALUES, type MatrixRole, type PermissionKey } from "@/features/reference/data/types";
import type { PermissionCell, PermissionMatrix } from "@/features/settings/data/types";
import { ActionMessage, type ActionMessageValue } from "./AccountAdminParts";
import { pendingHint, SettingsCardHead } from "./SettingsShell";

const FAILED = "ההגדרה לא נשמרה. נסה שוב.";
const CENTER = { textAlign: "center" } as const;

type CellKey = `${MatrixRole}:${PermissionKey}`;

const cellKey = (role: MatrixRole, key: PermissionKey): CellKey => `${role}:${key}`;

/** "ל" + role: "למנהל", "לשירות לקוחות" (the demo's aria-label, L946). */
const forRole = (role: MatrixRole): string => `ל${ACCOUNT_ROLE_LABELS[role]}`;

export function SettingsMatrix({ matrix, editable }: { matrix: PermissionMatrix; editable: boolean }) {
  const { settings } = useCommands();
  const id = useId();
  const [values, setValues] = useState<Readonly<Partial<Record<CellKey, boolean>>>>({});
  const [message, setMessage] = useState<ActionMessageValue>(null);
  const running = useRef(false);

  const cells: PermissionCell[] = matrix.rows.flatMap((row) => MATRIX_ROLE_VALUES.map((role) => row.cells[role]));
  const editableCells = cells.filter((c) => !c.pending);
  const anyTemporary = editableCells.some((c) => c.status === "temporary");
  const allTemporary = editableCells.length > 0 && editableCells.every((c) => c.status === "temporary");
  const tempNoteId = `${id}-temp`;

  const valueOf = (role: MatrixRole, key: PermissionKey, cell: PermissionCell): boolean => values[cellKey(role, key)] ?? cell.value;

  async function toggle(role: MatrixRole, key: PermissionKey, cell: PermissionCell, label: string) {
    if (!editable || cell.pending || running.current) return;
    running.current = true;
    const ck = cellKey(role, key);
    const before = valueOf(role, key, cell);
    setValues((prev) => ({ ...prev, [ck]: !before }));
    setMessage(null);
    let failure: string | null = null;
    try {
      const r = await settings.setPermission(role, key, !before);
      if (!r.ok) failure = r.error;
    } catch {
      failure = FAILED;
    } finally {
      running.current = false;
    }
    if (failure) {
      setValues((prev) => ({ ...prev, [ck]: before }));
      setMessage({ kind: "error", text: `${label} ${forRole(role)}: ${failure}` });
    }
  }

  return (
    <section className="card" style={{ overflow: "hidden" }} aria-labelledby={`${id}-title`}>
      <SettingsCardHead
        id={`${id}-title`}
        title="מה כל הרשאה רואה"
        sub={
          <>
            ליוצר יש את כל היכולות, והן קבועות ולא ניתן להגביל אותן. גם היכולות של הטכנאי קבועות ואינן חלק מהמטריצה. את
            המטריצה משנה רק היוצר.
            {anyTemporary && (
              <span id={tempNoteId} style={{ display: "block", marginTop: 4, color: "var(--warn-fg)" }}>
                {allTemporary
                  ? "כל הערכים זמניים: הבעלים יאשר את הערכים הסופיים בשלב 10."
                  : "ערך שמסומן \"זמני\" יאושר על ידי הבעלים בשלב 10."}
              </span>
            )}
          </>
        }
        action={
          anyTemporary ? (
            <span className="pill" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}>
              <span aria-hidden="true">⏳ </span>
              {allTemporary ? "ערכים זמניים · עד שלב 10" : "חלק מהערכים זמניים"}
            </span>
          ) : undefined
        }
      />
      {/* position: relative keeps screen-reader-only text inside the sideways scroller. */}
      <div className="scrollx" style={{ position: "relative" }}>
        <table aria-label="מטריצת ההרשאות">
          <thead>
            <tr>
              <th scope="col">מסך / פעולה</th>
              <th scope="col" className="col-fit" style={CENTER}>
                יוצר
              </th>
              {MATRIX_ROLE_VALUES.map((role) => (
                <th key={role} scope="col" className="col-fit" style={CENTER}>
                  {ACCOUNT_ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.key}>
                <td style={{ minWidth: 190, whiteSpace: "normal" }}>
                  {row.label}
                  {row.hint && (
                    <span className="sub" style={{ display: "block", fontSize: 12, lineHeight: 1.4 }}>
                      {row.hint}
                    </span>
                  )}
                </td>
                <td className="col-fit" style={{ ...CENTER, color: "var(--s-done)", fontWeight: 700 }}>
                  <span aria-hidden="true">✓ 🔒</span>
                  <span className="sr-only">קבוע</span>
                </td>
                {MATRIX_ROLE_VALUES.map((role) => {
                  const cell = row.cells[role];
                  const on = valueOf(role, row.key, cell);
                  const label = `${row.label} ${forRole(role)}`;
                  const hintId = `${id}-${role}-${row.key}-hint`;
                  const markTemporary = !allTemporary && !cell.pending && cell.status === "temporary";
                  const describedBy = cell.pending ? hintId : markTemporary || allTemporary ? tempNoteId : undefined;
                  return (
                    <td key={role} className="col-fit" style={CENTER}>
                      {editable ? (
                        <button
                          type="button"
                          className={on ? "tog on" : "tog"}
                          aria-pressed={on}
                          aria-label={label}
                          aria-describedby={describedBy}
                          disabled={cell.pending !== null}
                          onClick={() => void toggle(role, row.key, cell, row.label)}
                        />
                      ) : (
                        <span aria-describedby={describedBy}>
                          <span aria-hidden="true" style={{ fontWeight: 700, color: on ? "var(--s-done)" : "var(--muted)" }}>
                            {on ? "✓" : "—"}
                          </span>
                          <span className="sr-only">{on ? "מופעל" : "כבוי"}</span>
                        </span>
                      )}
                      {cell.pending && (
                        <span id={hintId} className="sub" style={{ display: "block", fontSize: 12, marginTop: 3 }}>
                          {pendingHint(cell.pending)}
                        </span>
                      )}
                      {markTemporary && (
                        <span className="sub" style={{ display: "block", fontSize: 12, marginTop: 3, color: "var(--warn-fg)" }}>
                          זמני
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ActionMessage message={message} style={{ padding: message ? "10px 18px 0" : 0 }} />
      <div className="sub" style={{ padding: "10px 18px 14px", lineHeight: 1.5 }}>
        בהדגמה הערכים קובעים רק מה מוצג במסכי ההדגמה, ושינוי כאן לא נשמר. באפליקציה המטריצה משתנה רק דרך פעולת שרת של היוצר, כל שינוי
        נרשם ביומן הביקורת, וההרשאות נאכפות בשרת ובמסד הנתונים.
      </div>
    </section>
  );
}
