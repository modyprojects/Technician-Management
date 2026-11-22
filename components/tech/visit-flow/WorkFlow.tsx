"use client";

// Work screen (TE-14, TE-15; D95 (a), (h), (i)): photos before (optional) and after (at least one),
// at most 8 per phase, and the written treatment summary; "סיום טיפול" once both required items
// are there. Every picked photo is compressed ON THE DEVICE first (features/visit-flow/image.ts)
// and only the compressed blob is kept, in the device's draft (IndexedDB), so a reload or a lost
// connection loses nothing; the original is never stored. A photo that cannot be compressed shows
// an inline error and is not kept. The photos are sent with the closure, in order, by the work
// queue (add_visit_media → upload → confirm_visit_media), so a photo removed here is never sent.
// No video and no recorded summary in this version (open decisions 3, 4, 11).
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TechShell } from "@/components/tech/TechShell";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { idbVisitFlowStore } from "@/features/visit-flow/idb";
import { COMPRESSION_MESSAGE, CompressionError, compressPhoto } from "@/features/visit-flow/image";
import type { DraftPhoto, WorkDraft } from "@/features/visit-flow/queue";
import { MEDIA_MIME_TYPES, mediaRefusal, PHASE_TITLE, PHOTOS_PER_PHASE_MAX, photoRoom, SUMMARY_MAX, workMissing, type PhotoPhase } from "@/features/visit-flow/rules";
import { H2, Req } from "./VisitParts";

/**
 * Local previews of the compressed blobs: created when photos arrive (never during render),
 * released when a photo is removed or the screen closes.
 */
function usePreviews(): [ReadonlyMap<string, string>, (photos: readonly DraftPhoto[]) => void] {
  const made = useRef(new Map<string, string>());
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const all = made.current;
    return () => {
      all.forEach((u) => URL.revokeObjectURL(u));
      all.clear();
    };
  }, []);
  const update = useCallback((photos: readonly DraftPhoto[]) => {
    const keep = new Set(photos.map((p) => p.id));
    for (const [id, url] of made.current) {
      if (!keep.has(id)) {
        URL.revokeObjectURL(url);
        made.current.delete(id);
      }
    }
    for (const p of photos) if (!made.current.has(p.id)) made.current.set(p.id, URL.createObjectURL(p.blob));
    setUrls(new Map(made.current));
  }, []);
  return [urls, update];
}

function PhotoCard({
  phase,
  photos,
  urls,
  onPick,
  onRemove,
  busy,
}: {
  phase: PhotoPhase;
  photos: readonly DraftPhoto[];
  urls: ReadonlyMap<string, string>;
  onPick: (files: FileList) => Promise<string | null>;
  onRemove: (id: string) => void;
  busy: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const title = PHASE_TITLE[phase];
  return (
    <section className="card" aria-label={title} style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h2 style={H2}>
          {title} {phase === "after" && <Req />}
        </h2>
        <span className="sub">
          {phase === "after" ? "חובה · לפחות תמונה אחת" : "רשות"} · עד {PHOTOS_PER_PHASE_MAX}
        </span>
      </div>
      <div className="media">
        {photos.map((p, i) => (
          <div key={p.id} className="thumb" style={urls.get(p.id) ? { backgroundImage: `url("${urls.get(p.id)}")` } : undefined}>
            <span role="img" aria-label={`תמונה ${i + 1} · ${title}`} style={{ position: "absolute", inset: 0 }} />
            <button type="button" className="xbtn" aria-label={`הסר תמונה ${i + 1} · ${title}`} onClick={() => onRemove(p.id)} style={{ position: "absolute", top: 4, insetInlineEnd: 4 }}>
              ✕
            </button>
          </div>
        ))}
        {photos.length < PHOTOS_PER_PHASE_MAX && (
          <label className="addm" aria-busy={busy}>
            <span aria-hidden="true" style={{ fontSize: 20 }}>
              ＋
            </span>
            {busy ? "מכווץ…" : "צילום"}
            <input
              type="file"
              accept={MEDIA_MIME_TYPES.join(",")}
              capture="environment"
              multiple
              disabled={busy}
              aria-label={`הוסף תמונה · ${title}`}
              aria-describedby={error ? errId : undefined}
              onChange={async (e) => {
                const files = e.target.files;
                if (files?.length) setError(await onPick(files));
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

export function WorkFlow({
  head,
  visitId,
  userId,
  isTest,
  syncPanel,
  contact,
  onFinish,
}: {
  head: ReactNode;
  visitId: string;
  userId: string;
  isTest: boolean;
  syncPanel: ReactNode;
  /** The customer's address, phone and WhatsApp (owner 22.11 (e)). */
  contact: ReactNode;
  onFinish: () => void;
}) {
  const [draft, setDraft] = useState<WorkDraft>({ visitId, userId, summary: "", photos: [] });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<PhotoPhase | null>(null);
  const [saveError, setSaveError] = useState(false);
  const summaryId = useId();
  const hintId = useId();
  // The newest draft for the handlers (photos are compressed asynchronously).
  const latest = useRef(draft);
  const [urls, updatePreviews] = usePreviews();

  useEffect(() => {
    let live = true;
    idbVisitFlowStore
      .getDraft(visitId)
      .then((d) => {
        // Never over what the technician already added on this screen.
        if (live && d && d.userId === userId && !latest.current.photos.length && !latest.current.summary) {
          latest.current = d;
          setDraft(d);
          updatePreviews(d.photos);
        }
      })
      .catch(() => live && setSaveError(true))
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [visitId, userId, updatePreviews]);

  const save = async (next: WorkDraft) => {
    latest.current = next;
    setDraft(next);
    updatePreviews(next.photos);
    try {
      await idbVisitFlowStore.putDraft(next);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  };

  const pick = async (phase: PhotoPhase, files: FileList): Promise<string | null> => {
    setBusy(phase);
    let error: string | null = null;
    const added: DraftPhoto[] = [];
    let room = photoRoom(latest.current.photos.filter((p) => p.phase === phase).length);
    try {
      for (const file of Array.from(files)) {
        if (room <= 0) {
          error = `אפשר עד ${PHOTOS_PER_PHASE_MAX} תמונות ${PHASE_TITLE[phase]}`;
          break;
        }
        try {
          const c = await compressPhoto(file);
          const why = mediaRefusal(c.mime, c.blob.size);
          if (why) {
            error = why;
            continue;
          }
          added.push({ id: crypto.randomUUID(), phase, blob: c.blob, mime: c.mime, size: c.blob.size, capturedAt: new Date().toISOString() });
          room--;
        } catch (e) {
          error = e instanceof CompressionError ? COMPRESSION_MESSAGE[e.reason] : COMPRESSION_MESSAGE.encode;
        }
      }
      if (added.length) await save({ ...latest.current, photos: [...latest.current.photos, ...added] });
    } finally {
      setBusy(null);
    }
    return error;
  };
  const remove = (id: string) => void save({ ...latest.current, photos: latest.current.photos.filter((p) => p.id !== id) });

  const before = draft.photos.filter((p) => p.phase === "before");
  const after = draft.photos.filter((p) => p.phase === "after");
  const missing = workMissing(after.length, draft.summary);
  const ready = loaded && missing.length === 0 && !busy;

  const foot = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        className="bigbtn"
        disabled={!ready}
        aria-describedby={ready ? undefined : hintId}
        style={ready ? { background: "var(--accent)" } : undefined}
        onClick={async () => {
          await save(latest.current);
          onFinish();
        }}
      >
        סיום טיפול
      </button>
      {!ready && missing.length > 0 && (
        <div id={hintId} className="sub" style={{ textAlign: "center" }}>
          חסר: {missing.join(" · ")}
        </div>
      )}
    </div>
  );

  return (
    <TechShell head={head} foot={foot}>
      {isTest && <TestDataBanner />}
      {syncPanel}
      {contact}
      {saveError && (
        <div role="alert" className="card" style={{ padding: "10px 12px", background: "var(--danger-bg)", color: "var(--danger-fg)", fontSize: 14 }}>
          לא ניתן לשמור בטלפון (אחסון הדפדפן חסום).
        </div>
      )}
      <PhotoCard phase="before" photos={before} urls={urls} onPick={(f) => pick("before", f)} onRemove={remove} busy={busy === "before"} />
      <PhotoCard phase="after" photos={after} urls={urls} onPick={(f) => pick("after", f)} onRemove={remove} busy={busy === "after"} />
      <section className="card" aria-label="סיכום הטיפול" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <label htmlFor={summaryId} style={H2}>
          סיכום הטיפול <Req />
        </label>
        <textarea
          id={summaryId}
          rows={4}
          maxLength={SUMMARY_MAX}
          aria-required="true"
          placeholder="מה נמצא ומה בוצע"
          value={draft.summary}
          onChange={(e) => {
            const next = { ...latest.current, summary: e.target.value };
            latest.current = next;
            setDraft(next);
          }}
          onBlur={() => void save(latest.current)}
          style={{ width: "100%", display: "block" }}
        />
        <div className="sub">נשמר בטלפון עד השליחה.</div>
      </section>
    </TechShell>
  );
}
