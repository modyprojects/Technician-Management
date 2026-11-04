"use client";

// "מוצרים" table (spec office screens "Products", PR-06, D19; matrix key `products`). The demo has
// no such screen, so it follows the calls table (docs/demo.html callsTable(), L824-832) and the
// Settings tables: a card with a sideways scroller, short columns centred and sized to content
// (G-07), 🧪 on test products (SIM-17), brand and supplier "לא הוזן" when empty (PR-04, OF-07).
// - "נוצר מזימון": the invitation that created the product (PR-04): request, date and source
//   (SIM-14), linked to the call card when the caller passes the address.
// - Edit (PR-06): only when `canEdit` (the page decides from the role's capabilities; display
//   only, the server checks `products` itself, G-04). "עריכה" opens a form under the row: name,
//   brand and supplier (existing, active options; "לא הוזן" clears). The SKU is never edited
//   (PR-05, PR-07). The edit runs useCommands().products.update with the row version it started
//   from (D44) and sends only the fields that changed. A simulated result changes the row on this
//   screen only, marked "לא נשמר · פעולה מדומה"; a stored one refreshes the rows from the server.
// - The form focuses the name when it opens; a failed check focuses the invalid field
//   (aria-invalid) and the error inside the form describes it; Escape or "ביטול" closes it and
//   focus returns to the row's "עריכה".
// - At 520px stage width and below brand, supplier, the calls and the creating invitation move
//   under the name (styles/ui.css .set-col-wide / .set-inline-narrow), so "עריכה" stays in view.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { TestBadge, VISIT_SOURCE_LABELS, type VisitSource } from "@/components/ui/TestBadge";
import { useCommands } from "@/features/data-access/commands-context";
import type { ProductListItem, ProductOption, ProductUpdateInput } from "@/features/products/data/types";
import { PRODUCT_NAME_MAX, productNameError, productUpdateError } from "@/features/products/data/validate";
import { ActionMessage, type ActionMessageValue } from "./AccountAdminParts";
import { SettingsNotSaved } from "./SettingsShell";

const NOT_ENTERED = "לא הוזן";
const SHORT = "col-center col-fit";
const SAVE_FAILED = "המוצר לא עודכן. נסה שוב.";

export type ProductsTableRow = {
  product: ProductListItem;
  /** Date of the creating invitation as the list shows it ("20.08"); "" when unknown. */
  firstSeenDate: string;
  /** Call card of the creating invitation; null when the viewer has no calls list. */
  firstSeenHref: string | null;
  /** The calls list searched by this SKU; null when the viewer has no calls list. */
  callsHref: string | null;
};

/** What an edit changed on this screen (the server values stay in `product`). */
type LocalEdit = {
  name: string;
  brandId: string | null;
  supplierId: string | null;
  /** The row version the edit started from: a refreshed row with a newer version replaces it. */
  baseVersion: number;
  simulated: boolean;
};

type Draft = { name: string; brandId: string | null; supplierId: string | null };

type Field = "name" | "brand" | "supplier";

/** The visit source as a compact icon; the full label is its accessible name and tooltip. */
function SourceIcon({ source }: { source: VisitSource }) {
  const [icon, ...words] = VISIT_SOURCE_LABELS[source].split(" ");
  const label = words.join(" ");
  return (
    <span role="img" aria-label={label} title={label}>
      {icon}
    </span>
  );
}

function Value({ text }: { text: string }) {
  return text ? <>{text}</> : <span style={{ color: "var(--muted)" }}>{NOT_ENTERED}</span>;
}

export function ProductsTable({
  rows,
  total,
  query,
  canEdit,
  brands,
  suppliers,
}: {
  /** The current page of matching products, by SKU. */
  rows: readonly ProductsTableRow[];
  /** Matching products before paging. */
  total: number;
  /** The search text, for the empty state. */
  query: string;
  /** Whether the role's screens offer the edit (display only, G-04). */
  canEdit: boolean;
  /** Brands and suppliers (active and inactive); only active ones can be chosen. */
  brands: readonly ProductOption[];
  suppliers: readonly ProductOption[];
}) {
  const { products: commands } = useCommands();
  const router = useRouter();
  const id = useId();
  const [edits, setEdits] = useState<Readonly<Record<string, LocalEdit>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", brandId: null, supplierId: null });
  const [formError, setFormError] = useState<{ text: string; field: Field | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessageValue>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  /** The row whose "עריכה" takes focus after the form closes (after the re-render that enables it again). */
  const [focusRow, setFocusRow] = useState<{ sku: string } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const brandSelect = useRef<HTMLSelectElement>(null);
  const supplierSelect = useRef<HTMLSelectElement>(null);
  const formId = `${id}-form`;
  const formErrorId = `${id}-form-error`;
  const ruleId = `${id}-rule`;

  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  /** The row as shown: the server values, or this screen's edit while it applies to that version. */
  function shown(p: ProductListItem): { name: string; brandId: string | null; supplierId: string | null; brand: string; supplier: string; edit: LocalEdit | null } {
    const e = edits[p.sku];
    if (!e || e.baseVersion !== p.version) {
      return { name: p.name, brandId: p.brandId, supplierId: p.supplierId, brand: p.brand, supplier: p.supplier, edit: null };
    }
    return {
      name: e.name,
      brandId: e.brandId,
      supplierId: e.supplierId,
      brand: e.brandId ? (brandName.get(e.brandId) ?? "") : "",
      supplier: e.supplierId ? (supplierName.get(e.supplierId) ?? "") : "",
      edit: e,
    };
  }

  // Focus the name when the form opens.
  useEffect(() => {
    if (editing) nameInput.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (focusRow) editButtons.current.get(focusRow.sku)?.focus();
  }, [focusRow]);

  function open(p: ProductListItem) {
    if (busy) return;
    const s = shown(p);
    setDraft({ name: s.name, brandId: s.brandId, supplierId: s.supplierId });
    setFormError(null);
    setMessage(null);
    setEditing(p.sku);
  }

  function close(sku: string) {
    setEditing(null);
    setFormError(null);
    setFocusRow({ sku });
  }

  function fail(text: string, field: Field | null) {
    setFormError({ text, field });
    if (field === "name") nameInput.current?.focus();
    if (field === "brand") brandSelect.current?.focus();
    if (field === "supplier") supplierSelect.current?.focus();
  }

  async function save(event: FormEvent<HTMLFormElement>, p: ProductListItem) {
    event.preventDefault();
    if (busy) return;
    const s = shown(p);
    const name = draft.name.trim();
    // Only the fields that changed (a field left out stays as stored); null clears brand or supplier.
    const input: ProductUpdateInput = {
      sku: p.sku,
      expectedVersion: p.version,
      ...(name !== s.name ? { name } : {}),
      ...(draft.brandId !== s.brandId ? { brandId: draft.brandId } : {}),
      ...(draft.supplierId !== s.supplierId ? { supplierId: draft.supplierId } : {}),
    };
    // Checked first with the command's own validator: a typo gets an inline error, not a toast.
    const invalid = productUpdateError(input);
    if (invalid) {
      fail(invalid, productNameError(name) ? "name" : null);
      return;
    }
    setBusy(true);
    setFormError(null);
    let failure: string | null = null;
    let simulated = false;
    try {
      const result = await commands.update(input);
      if (result.ok) simulated = result.simulated;
      else failure = result.error;
    } catch {
      failure = SAVE_FAILED;
    } finally {
      setBusy(false);
    }
    if (failure) {
      // The error is about the whole edit (version, option, server): it describes the form, and
      // focus goes back into the form (the disabled "שמירה" lost it).
      fail(failure, null);
      nameInput.current?.focus();
      return;
    }
    setEdits((prev) => ({
      ...prev,
      [p.sku]: { name, brandId: draft.brandId, supplierId: draft.supplierId, baseVersion: p.version, simulated },
    }));
    setMessage({
      kind: "ok",
      text: simulated ? `בהדגמה: פרטי המוצר ${p.sku} היו מתעדכנים. לא נשמר.` : `פרטי המוצר ${p.sku} עודכנו.`,
    });
    close(p.sku);
    // A stored edit has a new version on the server: read the rows again (the local edit no longer applies then).
    if (!simulated) router.refresh();
  }

  function onFormKey(e: KeyboardEvent<HTMLFormElement>, sku: string) {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      close(sku);
    }
  }

  const fieldProps = (field: Field) =>
    formError?.field === field ? { "aria-invalid": true as const, "aria-describedby": formErrorId } : {};

  /** Options of a select: the active ones, plus the current one when it is inactive (kept, not offered). */
  const optionsOf = (list: readonly ProductOption[], current: string | null) => list.filter((o) => o.active || o.id === current);

  const columns = canEdit ? 7 : 6;

  return (
    <section className="card" style={{ overflow: "hidden" }} aria-label="רשימת המוצרים">
      {canEdit && <ActionMessage message={message} style={{ padding: message ? "10px 18px 0" : 0 }} />}
      {rows.length > 0 && (
        // position: relative keeps the 🧪 badge's screen-reader text inside the sideways scroller.
        <div className="scrollx" style={{ position: "relative" }}>
          <table aria-label="מוצרים">
            <thead>
              <tr>
                <th scope="col" className={SHORT}>
                  מק&quot;ט
                </th>
                <th scope="col">שם מוצר</th>
                <th scope="col" className="col-fit set-col-wide">
                  מותג
                </th>
                <th scope="col" className="col-fit set-col-wide">
                  ספק
                </th>
                <th scope="col" className={`${SHORT} set-col-wide`}>
                  קריאות
                </th>
                <th scope="col" className={`${SHORT} set-col-wide`}>
                  נוצר מזימון
                </th>
                {canEdit && (
                  <th scope="col" className="col-fit">
                    <span className="sr-only">עריכה</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ product: p, firstSeenDate, firstSeenHref, callsHref }) => {
                const s = shown(p);
                const isOpen = editing === p.sku;
                const fs = p.firstSeen;
                const firstSeen = fs ? (
                  <>
                    <SourceIcon source={fs.source} />{" "}
                    {firstSeenHref ? (
                      <Link className="lnk num" href={firstSeenHref} prefetch={false} aria-label={`פנייה ${fs.req} · ביקור ${fs.n}`}>
                        {fs.req}
                      </Link>
                    ) : (
                      <span className="num">{fs.req}</span>
                    )}
                    {firstSeenDate && <span className="num">{` · ${firstSeenDate}`}</span>}
                  </>
                ) : (
                  "—"
                );
                // The number of calls, linked to the calls list searched by this SKU.
                const calls = (n: number) =>
                  callsHref && n > 0 ? (
                    <Link className="lnk num" href={callsHref} prefetch={false} aria-label={`${n} קריאות על ${p.sku}`}>
                      {n}
                    </Link>
                  ) : (
                    <span className="num">{n}</span>
                  );
                return (
                  <Fragment key={p.sku}>
                    <tr style={isOpen ? { background: "var(--tint)" } : undefined}>
                      <td className={SHORT}>
                        <bdi dir="ltr" className="num" style={{ fontWeight: 700 }}>
                          {p.sku}
                        </bdi>
                        {p.isTest && (
                          <>
                            {" "}
                            <TestBadge />
                          </>
                        )}
                      </td>
                      <td style={{ whiteSpace: "normal", minWidth: 120 }}>
                        <span className="set-name">
                          <b>{s.name}</b>
                          {s.edit && (s.edit.simulated ? <SettingsNotSaved /> : <span className="sub">נשמר</span>)}
                        </span>
                        {/* Narrow widths: brand, supplier and the creating invitation under the name (their columns are hidden). */}
                        <span className="sub set-inline-narrow" style={{ fontSize: 12, marginTop: 3 }}>
                          <span style={{ display: "block" }}>
                            מותג: <Value text={s.brand} /> · ספק: <Value text={s.supplier} />
                          </span>
                          <span style={{ display: "block" }}>
                            קריאות: {calls(p.callCount)} · נוצר מזימון: {firstSeen}
                          </span>
                        </span>
                      </td>
                      <td className="col-fit set-col-wide">
                        <Value text={s.brand} />
                      </td>
                      <td className="col-fit set-col-wide">
                        <Value text={s.supplier} />
                      </td>
                      <td className={`${SHORT} num set-col-wide`}>{calls(p.callCount)}</td>
                      <td className={`${SHORT} set-col-wide`}>{firstSeen}</td>
                      {canEdit && (
                        <td className="col-fit">
                          <button
                            ref={(el) => {
                              if (el) editButtons.current.set(p.sku, el);
                              else editButtons.current.delete(p.sku);
                            }}
                            type="button"
                            className="chip"
                            style={{ padding: "4px 12px" }}
                            aria-expanded={isOpen}
                            aria-controls={isOpen ? formId : undefined}
                            aria-label={`עריכה · ${s.name} (${p.sku})`}
                            disabled={busy}
                            onClick={() => (isOpen ? close(p.sku) : open(p))}
                          >
                            עריכה
                          </button>
                        </td>
                      )}
                    </tr>
                    {canEdit && isOpen && (
                      <tr>
                        <td colSpan={columns} style={{ padding: 0, whiteSpace: "normal" }}>
                          <form
                            id={formId}
                            className="set-form"
                            noValidate
                            onSubmit={(e) => void save(e, p)}
                            onKeyDown={(e) => onFormKey(e, p.sku)}
                            aria-label={`עריכת המוצר ${p.sku}`}
                            aria-describedby={formError && !formError.field ? `${ruleId} ${formErrorId}` : ruleId}
                            style={{ borderTop: 0, borderBottom: 0 }}
                          >
                            <label>
                              שם מוצר
                              <input
                                ref={nameInput}
                                value={draft.name}
                                onChange={(e) => {
                                  setDraft((d) => ({ ...d, name: e.target.value }));
                                  if (formError) setFormError(null);
                                }}
                                required
                                maxLength={PRODUCT_NAME_MAX}
                                autoComplete="off"
                                {...fieldProps("name")}
                              />
                            </label>
                            <label>
                              מותג
                              <select
                                ref={brandSelect}
                                value={draft.brandId ?? ""}
                                onChange={(e) => {
                                  setDraft((d) => ({ ...d, brandId: e.target.value || null }));
                                  if (formError) setFormError(null);
                                }}
                                {...fieldProps("brand")}
                              >
                                <option value="">{NOT_ENTERED}</option>
                                {optionsOf(brands, s.brandId).map((o) => (
                                  <option key={o.id} value={o.id} disabled={!o.active}>
                                    {o.active ? o.name : `${o.name} (לא פעיל)`}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              ספק
                              <select
                                ref={supplierSelect}
                                value={draft.supplierId ?? ""}
                                onChange={(e) => {
                                  setDraft((d) => ({ ...d, supplierId: e.target.value || null }));
                                  if (formError) setFormError(null);
                                }}
                                {...fieldProps("supplier")}
                              >
                                <option value="">{NOT_ENTERED}</option>
                                {optionsOf(suppliers, s.supplierId).map((o) => (
                                  <option key={o.id} value={o.id} disabled={!o.active}>
                                    {o.active ? o.name : `${o.name} (לא פעיל)`}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <p id={ruleId} className="sub" style={{ gridColumn: "1 / -1", margin: 0, lineHeight: 1.5 }}>
                              המק״ט <bdi dir="ltr">{p.sku}</bdi> לא נערך. מותג וספק נבחרים מהרשימה; ״לא הוזן״ מרוקן את השדה. זימונים
                              הבאים לא ישנו את השם.
                            </p>
                            <div className="set-form-actions">
                              <button type="submit" className="btn pri" disabled={busy}>
                                {busy ? "שומר…" : "שמירה"}
                              </button>
                              <button type="button" className="btn" onClick={() => close(p.sku)} disabled={busy}>
                                ביטול
                              </button>
                              {formError && (
                                <span id={formErrorId} role="alert" className="set-err">
                                  {formError.text}
                                </span>
                              )}
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div aria-live="polite">
        {total ? (
          <div className="sub" style={{ padding: "10px 14px" }}>
            מציג <span className="num">{rows.length}</span> מתוך <span className="num">{total}</span>
          </div>
        ) : (
          <div className="empty">{query ? `לא נמצאו מוצרים עבור "${query}"` : "אין מוצרים"}</div>
        )}
      </div>
    </section>
  );
}

