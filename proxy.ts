import { NextResponse, type NextRequest } from "next/server";
import { devRoutesAllowed } from "@/app/dev/_gate";

// /dev gate. It runs before any route renders, so a closed gate returns the Hebrew 404 page
// and none of the showcase content (a notFound() in the layout still streamed the page).
export function proxy(request: NextRequest) {
  const allowed = devRoutesAllowed({
    vercelEnv: process.env.VERCEL_ENV,
    localFlag: process.env.ENABLE_DEV_ROUTES,
    host: request.headers.get("host"),
  });
  if (allowed) return NextResponse.next();
  return NextResponse.rewrite(new URL("/dev-gate-closed", request.url), { status: 404 });
}

export const config = {
  matcher: ["/dev", "/dev/:path*"],
};
