// On-device photo compression (D95 (h), (i)): every photo is compressed before it is queued or
// uploaded; only the compressed blob is kept (never the original). Target about 1–2 MB, the long
// edge at most 1920 px, JPEG output (WebP is kept when the browser encodes it). EXIF orientation is
// applied by createImageBitmap (imageOrientation "from-image"). No dependency: canvas only.
// The sizing and quality ladder are pure (unit-tested); `compressPhoto` is the browser part.
import { MEDIA_MAX_BYTES, type MediaMime } from "./rules";

/** Long edge of the stored photo, in pixels (D95 (h): ~1600–2000). */
export const LONG_EDGE_MAX = 1920;
/** The size the ladder aims under (D95 (h): ~1–2 MB). */
export const TARGET_BYTES = 2 * 1024 * 1024;
/** Encoder qualities tried in order until the blob fits TARGET_BYTES. */
export const QUALITY_LADDER = [0.85, 0.75, 0.65, 0.55] as const;
const LAST_QUALITY = 0.55;
/** After the ladder, the long edge is shrunk by this factor and the ladder's last quality retried. */
export const SHRINK_STEP = 0.8;
/** Never below this long edge (a photo must stay readable). */
export const LONG_EDGE_MIN = 1024;

export type Size = { width: number; height: number };

/** The output size: the long edge capped at `maxEdge`, the aspect ratio kept, never enlarged. */
export function fitWithin(src: Size, maxEdge: number = LONG_EDGE_MAX): Size {
  const w = Math.max(1, Math.round(src.width));
  const h = Math.max(1, Math.round(src.height));
  const long = Math.max(w, h);
  if (long <= maxEdge) return { width: w, height: h };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** The attempts (long edge, quality) the compressor makes, in order. */
export function compressionAttempts(src: Size): { edge: number; quality: number }[] {
  const first = Math.min(LONG_EDGE_MAX, Math.max(src.width, src.height));
  const out: { edge: number; quality: number }[] = QUALITY_LADDER.map((quality) => ({ edge: first, quality }));
  let edge = first;
  while (edge * SHRINK_STEP >= LONG_EDGE_MIN) {
    edge = Math.round(edge * SHRINK_STEP);
    out.push({ edge, quality: LAST_QUALITY });
  }
  return out;
}

/** True when an encoded blob is acceptable: under the target, or the last attempt under the ceiling. */
export function acceptable(bytes: number, isLastAttempt: boolean): boolean {
  if (bytes < 1) return false;
  return bytes <= TARGET_BYTES || (isLastAttempt && bytes <= MEDIA_MAX_BYTES);
}

/** The output type: WebP stays WebP when the browser can encode it; anything else becomes JPEG. */
export const outputMime = (inputMime: string, webpEncodes: boolean): MediaMime =>
  inputMime === "image/webp" && webpEncodes ? "image/webp" : "image/jpeg";

export class CompressionError extends Error {
  constructor(readonly reason: "not-image" | "decode" | "encode" | "too-large") {
    super(reason);
  }
}

export type CompressedPhoto = { blob: Blob; mime: MediaMime; width: number; height: number };

function encode(canvas: HTMLCanvasElement | OffscreenCanvas, mime: MediaMime, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: mime, quality }).catch(() => null);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality));
}

function canvasOf(size: Size): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(size.width, size.height);
  const c = document.createElement("canvas");
  c.width = size.width;
  c.height = size.height;
  return c;
}

/**
 * Compresses a picked photo on the device (browser only). Throws CompressionError when the file
 * is not an image, cannot be decoded or encoded, or stays over the bucket's 10 MiB ceiling; the
 * caller then shows an inline error and queues nothing (D95 (h)).
 */
export async function compressPhoto(file: Blob): Promise<CompressedPhoto> {
  if (!file.type.startsWith("image/")) throw new CompressionError("not-image");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new CompressionError("decode");
  }
  try {
    const src = { width: bitmap.width, height: bitmap.height };
    const attempts = compressionAttempts(src);
    let mime = outputMime(file.type, true);
    for (let i = 0; i < attempts.length; i++) {
      const { edge, quality } = attempts[i] ?? { edge: LONG_EDGE_MIN, quality: LAST_QUALITY };
      const size = fitWithin(src, edge);
      const canvas = canvasOf(size);
      const g = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!g) throw new CompressionError("encode");
      if (mime === "image/jpeg") {
        // JPEG has no transparency: a transparent PNG's background becomes white, not black.
        g.fillStyle = "#fff";
        g.fillRect(0, 0, size.width, size.height);
      }
      g.drawImage(bitmap, 0, 0, size.width, size.height);
      let blob = await encode(canvas, mime, quality);
      // A browser that cannot encode WebP returns PNG (or nothing): fall back to JPEG.
      if (mime === "image/webp" && (!blob || blob.type !== "image/webp")) {
        mime = "image/jpeg";
        i = -1;
        continue;
      }
      if (!blob) throw new CompressionError("encode");
      if (blob.type !== mime) blob = new Blob([blob], { type: mime });
      if (acceptable(blob.size, i === attempts.length - 1)) return { blob, mime, ...size };
    }
    throw new CompressionError("too-large");
  } finally {
    bitmap.close();
  }
}

export const COMPRESSION_MESSAGE: Readonly<Record<CompressionError["reason"], string>> = {
  "not-image": "אפשר לצרף רק תמונה (JPEG, PNG או WebP)",
  decode: "לא הצלחנו לקרוא את התמונה. צלם שוב או בחר תמונה אחרת",
  encode: "לא הצלחנו לכווץ את התמונה במכשיר. צלם שוב או בחר תמונה אחרת",
  "too-large": "התמונה גדולה מ-10MB גם אחרי הכיווץ. צלם שוב או בחר תמונה אחרת",
};
