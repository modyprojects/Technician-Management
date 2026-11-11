"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

// The dashboard's error state (spec-final §6.10): rendered inside the segment layout's main.work,
// so the sidebar and logo stay. "נסה שוב" re-fetches and re-renders the dashboard (retry(); the
// docs prefer it to reset since Next 16.3); "חזרה לדשבורד" drops the search params (a bad URL
// state never traps the user). It never shows anything from the error itself, neither its text nor
// its server identifier (no internal details, docs/security.md).
export default function AnalyticsError({ retry }: { error: unknown; retry: () => void }) {
  const params = useParams<{ role: string }>();
  const role = typeof params?.role === "string" ? params.role : "";
  return (
    <section className="ma-card" role="alert" aria-labelledby="ma-error-h">
      <div className="ma-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <h2 id="ma-error-h" style={{ fontSize: 17, color: "var(--dash-ink)" }}>
          לא ניתן לטעון את הדשבורד כרגע.
        </h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button type="button" className="btn pri" onClick={() => retry()}>
            נסה שוב
          </button>
          {role && (
            <Link className="btn" href={`/dev/demo/office/${encodeURIComponent(role)}/analytics`} prefetch={false}>
              חזרה לדשבורד
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
