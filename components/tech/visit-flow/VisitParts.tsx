// Shared pieces of the visit flow: headings, the required mark and a photo tile. Presentational;
// no recorded times (D68).
import { TestPill } from "@/components/ui/TestBadge";

export const H2 = { fontFamily: "var(--body)", fontWeight: 700, fontSize: 14 } as const;

export const Req = () => (
  <span style={{ color: "var(--danger)" }} aria-hidden="true">
    *
  </span>
);

/** A photo tile: the image from a short-lived signed link (or a local preview), with the quiet test marker. */
export function PhotoTile({ label, url, isTest = false }: { label: string; url: string | null; isTest?: boolean }) {
  return (
    <div className="thumb" style={url ? { backgroundImage: `url("${url}")` } : undefined}>
      <span role="img" aria-label={label} style={{ position: "absolute", inset: 0 }} />
      {isTest && (
        <span aria-hidden="true" style={{ position: "absolute", bottom: 4, insetInlineStart: 4, lineHeight: 1 }}>
          <TestPill />
        </span>
      )}
    </div>
  );
}
