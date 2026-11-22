# Manager dashboard — skeleton on fake data (D81, D96)

The real Manager / Creator landing "דשבורד" at `/office`, three tabs, on fixed fictional data
(`features/dashboard/skeleton-data.ts`, labelled "נתוני בדיקה"). No database reads; the tabs follow a
hard-coded fake permission set. QA corrections 01 applied (D60 (6)): no "התקדמות הביקורים" bar, no
"עמידה בתכנון", the service metrics renamed with unit and period.

Images (WebP, office sizes D72): `390-general`, `1440-general`, `390-technicians`, `1440-technicians`,
`390-products`, `1440-products`.

## שאלות לבעלים

1. שמות המדדים החדשים ("ממוצע זמן טיפול", "ממוצע זמן נסיעה", "אחוז התקלות שנפתרו בביקור הראשון", "ממוצע זמן סגירת קריאה") הוחלו גם בלשונית "טכנאים" ("מדדי ביצועים"), לא רק ב"מדדי שירות" של "כללי". האם זה נכון?
2. בלשונית "טכנאים" אין כרגע כניסה ל"דוחות הביקורים" של הטכנאי (תצוגה שהוצעה ולא אושרה, OF-19). להוסיף אותה כשהמסך יחובר לנתונים אמיתיים, או שהלחיצה על מדד תפתח את רשימת הביקורים בלבד?
3. כפתור "ייצוא ל-Excel" לא מוצג בשלד (ההחלטה עליו עדיין פתוחה, OF-14). להשאיר אותו מחוץ למסך עד להחלטה?
4. מתחת לגרף "מגמת קריאות שירות" יש קווי רשת עם מספרים ותיבה נפתחת "הנתונים בטבלה" (לנגישות). שניהם הוצעו ולא אושרו (OF-19). להשאיר?
5. טווח "מותאם" בלשונית "טכנאים": האם להגביל אותו לעד היום ולשנה אחת לכל היותר, וניווט אחורה עד שנתיים (יום/שבוע/חודש) וחמש שנים (שנה)? אלה הוצעו ולא אושרו (OF-19).
