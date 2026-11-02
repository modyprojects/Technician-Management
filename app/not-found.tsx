import Link from "next/link";

// Hebrew 404 page (approved 2026-11-01).
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <section className="card sec" style={{ textAlign: "center", maxWidth: 420, width: "100%" }}>
        <h1 style={{ fontSize: 24 }}>העמוד לא נמצא</h1>
        <div className="sub" style={{ marginTop: 6 }}>
          ייתכן שהכתובת שגויה או שהעמוד הוסר.
        </div>
        <div style={{ marginTop: 16 }}>
          <Link href="/" className="btn pri" style={{ display: "inline-block", textDecoration: "none" }}>
            לעמוד הבית
          </Link>
        </div>
      </section>
    </main>
  );
}
