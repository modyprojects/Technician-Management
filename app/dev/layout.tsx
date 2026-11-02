import type { Metadata } from "next";

// Access to /dev is decided in proxy.ts before rendering (see app/dev/_gate.ts).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return children;
}
