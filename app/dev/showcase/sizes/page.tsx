import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "השוואת גדלים · תצוגת פיתוח" };

// Dev-only size view (demo-deviations X-03, v1.2): each shell in a same-origin iframe at
// 390 / 820 / 1440 px, shown at half scale. No device frame or fake status bar.
const SIZES = [
  { label: "טלפון · 390", width: 390, height: 844 },
  { label: "טאבלט · 820", width: 820, height: 1180 },
  { label: "דסקטופ · 1440", width: 1440, height: 900 },
] as const;

const SCALE = 0.5;

const SHELLS = [
  { title: "מסגרת טכנאי", path: "/dev/showcase/tech" },
  { title: "מסגרת משרד", path: "/dev/showcase/office" },
] as const;

export default function SizesPage() {
  return (
    <main className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="ptitle">
        <div>
          <h1>השוואת גדלים</h1>
          <div className="sub">
            כל מסגרת מוצגת ברוחב אמיתי ומוקטנת לחצי. <Link className="lnk" href="/dev/showcase">חזרה לתצוגת הרכיבים</Link>
          </div>
        </div>
      </div>
      {SHELLS.map((shell) => (
        <section key={shell.path} className="card sec">
          <h2>{shell.title}</h2>
          <div className="scrollx" data-size-strip>
            <div className="flex items-start gap-4" style={{ width: "max-content" }}>
              {SIZES.map((size) => (
                <figure key={size.width} style={{ margin: 0 }}>
                  <figcaption className="sub" style={{ fontWeight: 700, marginBottom: 6 }}>
                    {size.label} · <Link className="lnk" href={shell.path}>פתיחה במסך מלא</Link>
                  </figcaption>
                  <div
                    style={{
                      width: size.width * SCALE,
                      height: size.height * SCALE,
                      overflow: "hidden",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                    }}
                  >
                    <iframe
                      src={shell.path}
                      title={`${shell.title} ${size.label}`}
                      width={size.width}
                      height={size.height}
                      style={{
                        border: 0,
                        transform: `scale(${SCALE})`,
                        transformOrigin: "top right",
                      }}
                    />
                  </div>
                </figure>
              ))}
            </div>
          </div>
        </section>
      ))}
    </main>
  );
}
