"use client";

// Work screen media card, one per phase (docs/demo.html techWork() mediaBlock(), L555-559; TE-14):
// "לפני הטיפול" (optional) and "אחרי הטיפול" (required: at least one photo or video).
// Adding and removing go through useCommands().visits (addMedia, removeMedia). In the UI demo the
// commands are simulated: no camera, no file picker and no upload; the tile shows a locally drawn
// placeholder. The demo's "+ דוגמה" tile is not part of the app (X-08). Test media carry the 🧪
// badge (SIM-19).
// Real app (Step 4, Version 1): `capture` makes "תמונה" open the camera or the file picker (a
// real photo, compressed and stored by the commands); `videos` off hides "סרטון" (videos are Version
// 2); `removable` off hides the remove control (a stored photo is never deleted). A photo with a
// `previewUrl` (a short-lived signed link, or the local file just taken) shows as an image.
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { TestPill } from "@/components/ui/TestBadge";
import { useVisitCommands } from "@/features/visits/commands-context";
import type { MediaItem, MediaKind, MediaPhase, VisitRef } from "@/features/visits/data/types";
import { MEDIA_PER_PHASE_MAX, type UpdateDraft } from "./WorkDraft";

/** The demo's IC.cam. */
function CameraIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

/** The demo's IC.vid. */
function VideoIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
    </svg>
  );
}

/** Tile colours (token pairs), so neighbouring placeholders look different. */
const TINTS: readonly [string, string][] = [
  ["var(--thumb-light)", "var(--soft)"],
  ["var(--s-new-bg)", "var(--s-new)"],
  ["var(--s-done-bg)", "var(--s-done)"],
  ["var(--s-work-bg)", "var(--s-work)"],
  ["var(--accent-l)", "var(--accent)"],
];

const PHASE_LABEL: Record<MediaPhase, string> = { before: "לפני הטיפול", after: "אחרי הטיפול" };
const KIND_LABEL: Record<MediaKind, string> = { img: "תמונה", vid: "סרטון" };

/** A locally drawn stand-in for the photo or video (production shows a signed URL, OF-06). */
function Thumb({
  item,
  index,
  phase,
  busy,
  onRemove,
}: {
  item: MediaItem;
  index: number;
  phase: MediaPhase;
  busy: boolean;
  /** Omitted: no remove control. */
  onRemove?: () => void;
}) {
  const [from, to] = TINTS[index % TINTS.length] as [string, string];
  const name = `${KIND_LABEL[item.kind]} ${index + 1} ${PHASE_LABEL[phase]}`;
  const style: CSSProperties = { background: `linear-gradient(135deg, ${from}, ${to})` };
  return (
    <div className={item.kind === "vid" ? "thumb vid" : "thumb"} style={style}>
      <span role="img" aria-label={item.isTest ? `${name} · נתוני בדיקה` : name} style={{ position: "absolute", inset: 0 }}>
        {item.previewUrl ? (
          // A signed link or a local object URL: a plain <img> (next/image would proxy it).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.previewUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : item.kind === "img" && (
          <svg aria-hidden="true" viewBox="0 0 40 40" width="100%" height="100%" style={{ display: "block" }}>
            <circle cx="28" cy="12" r="4" fill="var(--on-dark)" opacity=".85" />
            <path d="M4 34 L15 19 L22 27 L27 22 L36 34 Z" fill="var(--on-dark)" opacity=".7" />
          </svg>
        )}
      </span>
      {item.isTest && (
        <span aria-hidden="true" style={{ position: "absolute", bottom: 4, insetInlineStart: 4, lineHeight: 1 }}>
          <TestPill />
        </span>
      )}
      {onRemove && (
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label={`הסרת ${name}`}
        style={{
          position: "absolute",
          top: 4,
          insetInlineEnd: 4,
          zIndex: 1,
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: 0,
          padding: 0,
          background: "color-mix(in srgb, var(--ink) 72%, transparent)",
          color: "var(--on-dark)",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        <span aria-hidden="true">✕</span>
      </button>
      )}
    </div>
  );
}

export function MediaTiles({
  visit,
  phase,
  media,
  onChange,
  capture = false,
  videos = true,
  removable = true,
}: {
  visit: VisitRef;
  phase: MediaPhase;
  /** The draft's media of every phase; this card shows its own phase. */
  media: readonly MediaItem[];
  onChange: UpdateDraft;
  /** "תמונה" takes a real photo (camera or file) and hands the file to addMedia. */
  capture?: boolean;
  /** Offer "סרטון". */
  videos?: boolean;
  /** Offer removing a tile. */
  removable?: boolean;
}) {
  const visits = useVisitCommands();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  // After a removal the removed tile's button is gone: focus moves to "add photo" instead of <body>.
  const addRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [removed, setRemoved] = useState(0);
  useEffect(() => {
    if (removed) addRef.current?.focus();
  }, [removed]);
  const items = media.filter((m) => m.when === phase);
  const required = phase === "after";
  const full = items.length >= MEDIA_PER_PHASE_MAX;

  async function add(kind: MediaKind, file?: File) {
    setBusy(true);
    setError(null);
    const r = await visits.addMedia(visit, file ? { kind, when: phase, file } : { kind, when: phase });
    setBusy(false);
    const added = r.ok ? r.data?.media : undefined;
    if (!r.ok) setError(r.error);
    else if (added) onChange((d) => ({ ...d, media: [...d.media, added] }));
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const r = await visits.removeMedia(visit, id);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      onChange((d) => ({ ...d, media: d.media.filter((m) => m.id !== id) }));
      setRemoved((n) => n + 1);
    }
  }

  return (
    <section className="card" style={{ padding: "12px 14px" }} aria-labelledby={titleId} aria-busy={busy}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "2px 10px", marginBottom: 8 }}>
        <h2 id={titleId} style={{ fontFamily: "var(--body)", fontSize: 14, fontWeight: 700 }}>
          {PHASE_LABEL[phase]}
          {required && (
            <>
              {" "}
              <span style={{ color: "var(--danger)" }} aria-hidden="true">
                *
              </span>
            </>
          )}
        </h2>
        <span className="sub">
          {videos
            ? required
              ? "חובה: לפחות תמונה או סרטון"
              : "תמונות או סרטונים · לא חובה"
            : required
              ? "חובה: לפחות תמונה אחת"
              : "תמונות · לא חובה"}
        </span>
      </div>
      <div className="media">
        {items.map((m, i) => (
          <Thumb key={m.id} item={m} index={i} phase={phase} busy={busy} onRemove={removable ? () => void remove(m.id) : undefined} />
        ))}
        {!full && (
          <>
            <button
              ref={addRef}
              type="button"
              className="addm"
              onClick={() => (capture ? fileRef.current?.click() : void add("img"))}
              disabled={busy}
              aria-label={`הוספת תמונה ${PHASE_LABEL[phase]}`}
            >
              <CameraIcon />
              תמונה
            </button>
            {videos && (
              <button type="button" className="addm" onClick={() => void add("vid")} disabled={busy} aria-label={`הוספת סרטון ${PHASE_LABEL[phase]}`}>
                <VideoIcon />
                סרטון
              </button>
            )}
            {capture && (
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                hidden
                aria-label={`צילום ${PHASE_LABEL[phase]}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void add("img", file);
                }}
              />
            )}
          </>
        )}
      </div>
      {full && (
        <div className="sub" style={{ marginTop: 8 }}>
          אפשר לצרף עד {MEDIA_PER_PHASE_MAX} קבצים {PHASE_LABEL[phase]}
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 8, color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
          {error}
        </div>
      )}
    </section>
  );
}
