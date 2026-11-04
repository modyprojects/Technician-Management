// The rules of the "מוצרים" screen (D19, PR-01 to PR-07), shown under the products table:
// products come only from invitations, with no import and no delete; the SKU is normalized and
// never edited; a later invitation never overwrites an existing name. Product rules, not demo
// notes: they hold in production as well. Hook-free.
export function ProductRules() {
  return (
    <div className="note">
      <b>איך נוצרים מוצרים:</b> מק״ט חדש בזימון יוצר מוצר אוטומטית, עם המק״ט והשם מהזימון. מותג וספק ריקים (״לא הוזן״) עד
      שמזינים אותם כאן. אין ייבוא מוצרים ואין מחיקה.
      <br />
      המק״ט נבדק בלי רווחים ובאותיות גדולות, כך ש-<bdi dir="ltr">kt-2041</bdi> ו-<bdi dir="ltr">KT-2041</bdi> הם אותו מוצר, והוא לא
      נערך. זימון מאוחר יותר עם שם אחר לאותו מק״ט לא משנה את השם הקיים: שם משנים רק כאן.
    </div>
  );
}
