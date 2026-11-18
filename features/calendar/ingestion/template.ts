// The Outlook invitation template the ingestion service parses (docs/outlook-template.md, a DRAFT
// pending customer service's approval, owner task O2). The parser reads its labels from this
// configuration, so the final list can change without code changes (outlook-template.md, SE-15).
// Until the operational setting exists (`app_settings`, Step 4/10; D35), the default below is the
// only configuration; a later Settings value replaces it through the same type. The D17-required
// labels (request number, customer number) stay required whatever a configuration says (D35).
import {
  LOCKED_TEMPLATE_FIELDS,
  TEMPLATE_FIELD_KEYS,
  type TemplateFieldKey,
} from "@/features/settings/data/types";

export type TemplateField = {
  key: TemplateFieldKey;
  /** The label as written in the invitation body, without the colon (Hebrew labels kept exactly). */
  label: string;
  required: boolean;
};

export type InvitationTemplate = {
  /** Subject prefix that marks a service-call invitation; every other meeting is ignored (SE-13). */
  subjectPrefix: string;
  /** One entry per field key, in template order. */
  fields: readonly TemplateField[];
};

/** docs/outlook-template.md "Body labels" (draft 2026-10-26). */
export const DEFAULT_INVITATION_TEMPLATE: InvitationTemplate = {
  subjectPrefix: "[קריאת שירות]",
  fields: [
    { key: "req", label: "מספר פנייה", required: true },
    { key: "task", label: "מספר משימה", required: true },
    { key: "rep", label: "נציגה מטפלת", required: true },
    { key: "customerNo", label: "מספר לקוח", required: true },
    { key: "customer", label: "שם לקוח", required: true },
    { key: "phone", label: "טלפון", required: true },
    { key: "phone2", label: "טלפון נוסף", required: false },
    { key: "city", label: "עיר", required: true },
    { key: "street", label: "רחוב ומספר", required: true },
    { key: "building", label: "בניין", required: false },
    { key: "floor", label: "קומה", required: false },
    { key: "apt", label: "דירה", required: false },
    { key: "arrival", label: "הערות הגעה", required: false },
    { key: "type", label: "סוג קריאה", required: true },
    { key: "product", label: "מוצר", required: true },
    { key: "sku", label: 'מק"ט', required: true },
    { key: "desc", label: "תיאור התקלה", required: true },
    { key: "warranty", label: "באחריות", required: false },
    { key: "collect", label: "לאסוף לפני הביקור", required: false },
    { key: "collectFrom", label: "לאסוף מ", required: false },
    { key: "techNote", label: "הערות לטכנאי", required: false },
  ],
};

/**
 * Fields the database needs on every ingested visit (NOT NULL columns, Migrations 2 and 3, TEMPORARY
 * OQ-5 and OQ-10): a configuration can never make them optional, or a parsed invitation would fail
 * at a NOT NULL instead of being listed with its missing field.
 */
const ALWAYS_REQUIRED: readonly TemplateFieldKey[] = [
  ...LOCKED_TEMPLATE_FIELDS,
  "task",
  "rep",
  "customer",
  "phone",
  "city",
  "street",
  "type",
  "product",
  "sku",
  "desc",
];

/** Lookalike marks Outlook may type in a label (Hebrew geresh and gershayim), matched as ASCII. */
export function normalizeLabelText(value: string): string {
  return value.replace(/\u05f4/g, '"').replace(/\u05f3/g, "'").replace(/\u00a0/g, " ");
}

/**
 * The template the parser uses: every field key exactly once, in TEMPLATE_FIELD_KEYS order, labels
 * trimmed, non-empty, without a colon or a line break and unique after normalization, and the
 * database's NOT NULL fields required. A malformed configuration throws (a programming or
 * configuration error, never an invitation problem).
 */
export function effectiveTemplate(template: InvitationTemplate = DEFAULT_INVITATION_TEMPLATE): InvitationTemplate {
  const prefix = template.subjectPrefix.trim();
  if (prefix === "" || /[\r\n]/.test(prefix)) throw new Error("invitation template: invalid subject prefix");
  const byKey = new Map(template.fields.map((field) => [field.key, field]));
  if (byKey.size !== template.fields.length || byKey.size !== TEMPLATE_FIELD_KEYS.length) {
    throw new Error("invitation template: every field key exactly once");
  }
  const seen = new Set<string>();
  const fields = TEMPLATE_FIELD_KEYS.map((key) => {
    const field = byKey.get(key);
    if (!field) throw new Error(`invitation template: missing field ${key}`);
    const label = field.label.trim();
    const normalized = normalizeLabelText(label);
    if (label === "" || /[:\r\n]/.test(label) || seen.has(normalized)) {
      throw new Error(`invitation template: invalid or duplicate label for ${key}`);
    }
    seen.add(normalized);
    return { key, label, required: field.required || ALWAYS_REQUIRED.includes(key) };
  });
  return { subjectPrefix: prefix, fields };
}
