"use client";

// Customer signature pad (docs/demo.html techClose() L589-591 and initSig(), L707-717; TE-19):
// "חתימת הלקוח *" with "נקה", a <canvas> drawn with pointer events (finger, pen or mouse; touch
// does not scroll the page while signing, .sig touch-action: none), and "חותמים עם האצבע או
// העכבר". After each stroke the drawing is reported as a PNG data URL; "נקה" reports null. The
// drawing survives a resize or rotation: the pad redraws the last reported image.
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/** The demo draws at 2x (initSig: cv.width = r.width * 2). */
const SCALE = 2;
const LINE_WIDTH = 2.4;
const FALLBACK_INK = "#18212B";

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  g.lineWidth = LINE_WIDTH;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = getComputedStyle(canvas).getPropertyValue("--ink").trim() || FALLBACK_INK;
  return g;
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.restore();
}

export function SignaturePad({
  value,
  onChange,
  label,
  disabled = false,
}: {
  /** The current signature (PNG data URL); null when empty. */
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  /** The visible heading ("חתימת הלקוח *"). */
  label: ReactNode;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<[number, number]>([0, 0]);
  const saved = useRef(value);

  useEffect(() => {
    saved.current = value;
    const canvas = canvasRef.current;
    if (canvas && value === null) clearCanvas(canvas);
  }, [value]);

  // Size the bitmap to the element (2x) and redraw the saved signature, now and on every resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const w = Math.round(r.width * SCALE);
      const h = Math.round(r.height * SCALE);
      if (!w || !h || (canvas.width === w && canvas.height === h)) return;
      canvas.width = w;
      canvas.height = h;
      const g = context(canvas);
      const src = saved.current;
      if (!g || !src) return;
      const img = new Image();
      img.onload = () => g.drawImage(img, 0, 0, r.width, r.height);
      img.src = src;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const point = (e: ReactPointerEvent<HTMLCanvasElement> | PointerEvent, canvas: HTMLCanvasElement): [number, number] => {
    const b = canvas.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  };

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (disabled || !canvas || (e.pointerType === "mouse" && e.button !== 0)) return;
    const g = context(canvas);
    if (!g) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing.current = true;
    const [x, y] = point(e, canvas);
    last.current = [x, y];
    // A dot, so a tap leaves a mark (the demo starts the path only).
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 0.01, y);
    g.stroke();
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!drawing.current || !canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    g.beginPath();
    g.moveTo(...last.current);
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const [x, y] = point(ev, canvas);
      g.lineTo(x, y);
      last.current = [x, y];
    }
    g.stroke();
  }

  function onPointerEnd() {
    const canvas = canvasRef.current;
    if (!drawing.current || !canvas) return;
    drawing.current = false;
    const url = canvas.toDataURL("image/png");
    saved.current = url;
    onChange(url);
  }

  function clear() {
    const canvas = canvasRef.current;
    if (canvas) clearCanvas(canvas);
    saved.current = null;
    onChange(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          style={{ border: 0, background: "none", color: "var(--accent)", fontWeight: 700, fontSize: 13, padding: "4px 0" }}
        >
          נקה
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="sig"
        role="img"
        aria-label={value ? "שטח חתימה · יש חתימה" : "שטח חתימה · ריק"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
      />
      <div className="sub">חותמים עם האצבע או העכבר</div>
    </div>
  );
}
