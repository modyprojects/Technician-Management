import type { ReactNode } from "react";
import { DemoToastProvider } from "./_components/DemoToast";

// UI demo with fictitious data (D53, G-05). Served only where the /dev gate allows (proxy.ts).
// The toast provider sits here so a simulated-action toast survives navigation between screens.
export default function DemoLayout({ children }: { children: ReactNode }) {
  return <DemoToastProvider>{children}</DemoToastProvider>;
}
