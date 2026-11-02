import type { Metadata } from "next";
import { OfficeShell } from "@/components/office/OfficeShell";
import { Chip } from "@/components/ui/Chip";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  CALL_ROWS,
  CALL_STATUS_COUNTS,
  FIXTURE_SENTINEL,
  OFFICE_NAV,
  OFFICE_USER,
  TECHS,
} from "../_fixtures";

export const metadata: Metadata = { title: "מסגרת משרד · תצוגת פיתוח" };

// Office shell with the demo's calls list as sample content (fictitious data, inert controls).
export default function OfficeShellShowcase() {
  return (
    <div data-fixtures={FIXTURE_SENTINEL} style={{ display: "contents" }}>
      <OfficeShell nav={OFFICE_NAV} activeKey="calls" user={OFFICE_USER}>
        <div className="ptitle">
          <div>
            <h1>קריאות</h1>
            <div className="sub">כל הקריאות שנקלטו מ-Outlook. לחיצה על שורה פותחת את כרטיס הקריאה.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            placeholder="חיפוש לפי שם, טלפון, מספר פנייה או מק״ט"
            aria-label="חיפוש קריאות"
            style={{ flex: 1, minWidth: 220, padding: "10px 14px" }}
          />
          <select aria-label="סינון לפי טכנאי" defaultValue="all">
            <option value="all">כל הטכנאים</option>
            {Object.entries(TECHS).map(([id, t]) => (
              <option key={id} value={id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CALL_STATUS_COUNTS.map((s) => (
            <Chip key={s.key} on={s.key === "all"} count={s.count}>
              {s.label}
            </Chip>
          ))}
        </div>
        <section className="card" style={{ overflow: "hidden" }}>
          <div className="scrollx">
            <table>
              <thead>
                <tr>
                  <th>פנייה</th>
                  <th>לקוח</th>
                  <th>עיר</th>
                  <th>מוצר</th>
                  <th>מק&quot;ט</th>
                  <th>טכנאי</th>
                  <th>ביקורים</th>
                  <th>ביקור אחרון / הבא</th>
                  <th>סטטוס</th>
                  <th>נציגה</th>
                </tr>
              </thead>
              <tbody>
                {CALL_ROWS.map((c) => {
                  const t = TECHS[c.tech];
                  return (
                    <tr key={c.req} className="click">
                      <td>
                        <b style={{ color: "var(--accent)" }}>{c.req}</b>
                      </td>
                      <td>
                        <b>{c.customer}</b>
                      </td>
                      <td>{c.city}</td>
                      <td>{c.product}</td>
                      <td dir="ltr" style={{ textAlign: "right" }}>
                        {c.sku}
                      </td>
                      <td>
                        <span className="dot" style={{ background: t.color }} /> {t.name}
                      </td>
                      <td style={{ textAlign: "center" }} className="num">
                        {c.visits}
                      </td>
                      <td className="num">{c.when}</td>
                      <td>
                        <StatusPill status={c.status} extra={c.reason ? ` · ${c.reason}` : ""} />
                      </td>
                      <td>{c.rep}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="sub" style={{ padding: "10px 14px" }}>
              מציג {CALL_ROWS.length} מתוך {CALL_STATUS_COUNTS[0]?.count}
            </div>
          </div>
        </section>
      </OfficeShell>
    </div>
  );
}
