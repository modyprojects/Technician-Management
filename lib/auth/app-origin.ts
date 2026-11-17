// The app's own origin for links in emails (D65). Server-only: reads APP_ORIGIN and Vercel's system
// variables at call time and never the request's headers (a forged Host would steal reset tokens).
// The rules are in features/auth/password-reset/origin.ts (unit-tested).
import "server-only";
import { appOriginOf } from "@/features/auth/password-reset/origin";

/** The origin, or null when the configuration is unusable (no link is built then). */
export function appOrigin(): string | null {
  return appOriginOf({
    APP_ORIGIN: process.env.APP_ORIGIN,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
  });
}
