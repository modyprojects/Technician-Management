import Image from "next/image";

/**
 * The MODY logo, white version, for the app's existing dark headers only (D57 (6); G-08): the
 * office sidebar and its narrow top bar, and the technician header. Never on a light background
 * and never in a new light strip; the dark version (`mody-logo.png`) is not used in the app.
 * The file's proportions (976×234) and transparency are kept: the caller's class sets the width,
 * the height follows (`height: auto`), and no filter, blend mode or background is applied.
 * `unoptimized`: served as the static file, no image optimizer (no new route, no cost).
 * `preload`: it is in the first view of every screen (`priority` is deprecated in Next 16).
 */
export function BrandLogo({ className }: { className: string }) {
  return <Image src="/brand/mody-logo-white.png" width={976} height={234} alt="MODY" unoptimized preload className={className} />;
}
