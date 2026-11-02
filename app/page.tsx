// Temporary home page (approved 2026-11-01). Replaced by the role-based start screen in Step 2.
export default function HomePage() {
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
        <h1 style={{ fontSize: 24 }}>ניהול טכנאים</h1>
        <div className="sub" style={{ marginTop: 6 }}>
          האפליקציה בבנייה
        </div>
      </section>
    </main>
  );
}
