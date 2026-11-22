// The visit's photos on the office call card (OF-06, D92 (2), D95 (f)): before and after, as
// thumbnails that open the full photo in a new tab. Every image is a SHORT-LIVED signed link the
// server created after an RLS-checked read under the office user's own session
// (lib/data/visit-flow.ts callPhotos); never a public URL. Same look as the timeline's media row;
// the real card shows no per-photo test mark (D74: the screen banner covers it).
import type { VisitPhoto } from "@/lib/data/visit-flow";

const PHASES = [
  ["before", "לפני הטיפול"],
  ["after", "אחרי הטיפול"],
] as const;

export function CallVisitPhotos({ photos }: { photos: readonly VisitPhoto[] }) {
  if (!photos.length) return null;
  return (
    <>
      <div className="sub" style={{ fontWeight: 700, marginTop: 12 }}>
        תמונות (<span className="num">{photos.length}</span>)
      </div>
      {PHASES.map(([phase, title]) => {
        const items = photos.filter((p) => p.phase === phase);
        if (!items.length) return null;
        return (
          <div key={phase} style={{ marginTop: 6 }}>
            <div className="sub">{title}</div>
            <div role="list" aria-label={`תמונות · ${title}`} style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              {items.map((p, i) => (
                <a
                  key={p.id}
                  role="listitem"
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="thumb"
                  aria-label={`תמונה ${i + 1} · ${title} · פתיחה בגודל מלא`}
                  style={{ width: 64, display: "block", backgroundImage: `url("${p.url}")` }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
