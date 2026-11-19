"use client";

// Work screen skeleton (D81; TE-14, TE-15): photos before (optional) and after (at least one), the
// written treatment summary, and "סיום ביקור ›" once both required items are there. Fake data only:
// a picked photo is previewed on this device and never uploaded; nothing is saved (the real flow
// uses add_visit_media / confirm_visit_media, Migration 7). Images only: JPEG, PNG or WebP up to
// 10 MiB, the visit-media bucket's limits. The size check compares bytes with bytes (10 × 1024 ×
// 1024), so a small photo is never reported as too large.
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TechShell } from "@/components/tech/TechShell";
import { TestDataBanner } from "@/components/ui/TestBadge";
import type { SkeletonPhoto } from "./fixtures";
import { H2, PhotoTile, Req } from "./VisitParts";

const ACCEPT = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_BYTES = 10 * 1024 * 1024;
const PER_PHASE_MAX = 8;

type Picked = { id: string; url: string; name: string };
type Phase = "before" | "after";

const PHASE_TITLE: Record<Phase, string> = { before: "לפני הטיפול", after: "אחרי הטיפול" };

/** Why a picked file is refused, or null when it is accepted. */
function refusal(file: File): string | null {
  if (!(ACCEPT as readonly string[]).includes(file.type)) return "אפשר לצרף רק תמונה (JPEG, PNG או WebP)";
  if (file.size > MAX_BYTES) return "התמונה גדולה מ-10MB. צלם שוב או בחר תמונה אחרת";
  return null;
}

function PhotoCard({ phase, seeded, picked, onPick, onRemove }: { phase: Phase; seeded: readonly SkeletonPhoto[]; picked: readonly Picked[]; onPick: (files: FileList) => string | null; onRemove: (id: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const title = PHASE_TITLE[phase];
  const count = seeded.length + picked.length;
  return (
    <section className="card" aria-label={title} style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h2 style={H2}>
          {title} {phase === "after" && <Req />}
        </h2>
        <span className="sub">{phase === "after" ? "חובה · לפחות תמונה אחת" : "רשות"}</span>
      </div>
      <div className="media">
        {seeded.map((p) => (
          <PhotoTile key={p.id} label={p.label} />
        ))}
        {picked.map((p, i) => (
          <div key={p.id} className="thumb" style={{ backgroundImage: `url("${p.url}")` }}>
            <span role="img" aria-label={`תמונה ${seeded.length + i + 1} · ${title}`} style={{ position: "absolute", inset: 0 }} />
            <button
              type="button"
              className="xbtn"
              aria-label={`הסר תמונה ${seeded.length + i + 1} · ${title}`}
              onClick={() => onRemove(p.id)}
              style={{ position: "absolute", top: 4, insetInlineEnd: 4 }}
            >
              ✕
            </button>
          </div>
        ))}
        {count < PER_PHASE_MAX && (
          <label className="addm">
            <span aria-hidden="true" style={{ fontSize: 20 }}>
              ＋
            </span>
            צילום
            <input
              type="file"
              accept={ACCEPT.join(",")}
              capture="environment"
              multiple
              aria-label={`הוסף תמונה · ${title}`}
              aria-describedby={error ? errId : undefined}
              onChange={(e) => {
                if (e.target.files?.length) setError(onPick(e.target.files));
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {error && (
        <div id={errId} role="alert" className="sub" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}
    </section>
  );
}

export function WorkFlow({ head, seeded, closeHref }: { head: ReactNode; seeded: { before: readonly SkeletonPhoto[]; after: readonly SkeletonPhoto[] }; closeHref: string }) {
  const [photos, setPhotos] = useState<Record<Phase, Picked[]>>({ before: [], after: [] });
  const [summary, setSummary] = useState("");
  const summaryId = useId();
  const hintId = useId();
  const urls = useRef<string[]>([]);

  // Release the local previews when the screen closes.
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const pick = (phase: Phase, files: FileList): string | null => {
    let error: string | null = null;
    const room = PER_PHASE_MAX - seeded[phase].length - photos[phase].length;
    const added: Picked[] = [];
    for (const file of Array.from(files)) {
      const why = refusal(file);
      if (why) {
        error = why;
        continue;
      }
      if (added.length >= room) {
        error = `אפשר עד ${PER_PHASE_MAX} תמונות ${PHASE_TITLE[phase]}`;
        break;
      }
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      added.push({ id: `${phase}-${urls.current.length}`, url, name: file.name });
    }
    if (added.length) setPhotos((p) => ({ ...p, [phase]: [...p[phase], ...added] }));
    return error;
  };
  const remove = (phase: Phase) => (id: string) => setPhotos((p) => ({ ...p, [phase]: p[phase].filter((x) => x.id !== id) }));

  const afterCount = seeded.after.length + photos.after.length;
  const missing = [afterCount === 0 && "תמונה אחרי הטיפול", !summary.trim() && "סיכום הטיפול"].filter(Boolean) as string[];
  const ready = missing.length === 0;

  const foot = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {ready ? (
        <Link href={closeHref} className="bigbtn" style={{ background: "var(--accent)" }}>
          סיום ביקור ›
        </Link>
      ) : (
        <button type="button" className="bigbtn" disabled aria-describedby={hintId}>
          סיום ביקור ›
        </button>
      )}
      {!ready && (
        <div id={hintId} className="sub" style={{ textAlign: "center" }}>
          חסר: {missing.join(" · ")}
        </div>
      )}
    </div>
  );

  return (
    <TechShell head={head} foot={foot}>
      <TestDataBanner />
      <PhotoCard phase="before" seeded={seeded.before} picked={photos.before} onPick={(f) => pick("before", f)} onRemove={remove("before")} />
      <PhotoCard phase="after" seeded={seeded.after} picked={photos.after} onPick={(f) => pick("after", f)} onRemove={remove("after")} />
      <section className="card" aria-label="סיכום הטיפול" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <label htmlFor={summaryId} style={H2}>
          סיכום הטיפול <Req />
        </label>
        <textarea
          id={summaryId}
          rows={4}
          maxLength={2000}
          aria-required="true"
          placeholder="מה נמצא ומה בוצע"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          style={{ width: "100%", display: "block" }}
        />
      </section>
    </TechShell>
  );
}
