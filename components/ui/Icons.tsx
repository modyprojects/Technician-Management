// Inline SVG icons copied verbatim from docs/demo.html (IC object, bellBtn).
import type { ReactNode } from "react";

type IconProps = { size?: number };

function Svg({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      {children}
    </svg>
  );
}

export function PinIcon({ size = 20 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  );
}

export function PhoneIcon({ size = 20 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </Svg>
  );
}

export function WhatsAppIcon({ size = 20 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 20l1.5-4A8 8 0 1 1 8 18.5z" />
    </Svg>
  );
}

export function UserIcon({ size = 20 }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Svg>
  );
}

export function HomeIcon({ size = 22 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M3 11l9-7 9 7v9H3z" />
    </Svg>
  );
}

export function CalendarIcon({ size = 22 }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  );
}

export function BellIcon({ size = 19 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </Svg>
  );
}
