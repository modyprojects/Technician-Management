import type { Metadata, Viewport } from "next";
import { Assistant, Rubik } from "next/font/google";
import "./globals.css";

// Fonts are downloaded at build time and served from this app; browsers never call Google.
const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-rubik",
});

const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--font-assistant",
});

export const metadata: Metadata = {
  title: "ניהול טכנאים",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} ${assistant.variable}`}>
      <body>
        <div className="stagewrap">
          <div className="stage">
            <div className="app-root">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}
