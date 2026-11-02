import release from "@/config/release.json";

type GateInput = {
  /** Vercel system variable: "production" | "preview" | "development", unset outside Vercel. */
  vercelEnv: string | undefined;
  /** ENABLE_DEV_ROUTES; honoured only outside Vercel and only for localhost requests.
   *  The Host check is not an origin check: local servers also bind to 127.0.0.1 only. */
  localFlag: string | undefined;
  /** Request Host header. */
  host: string | null;
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return hostname !== undefined && LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * Whether /dev routes may be served (default deny).
 * - Vercel Preview: yes (behind Vercel Authentication).
 * - Vercel Production: only during the testing period (D31, config/release.json).
 * - Outside Vercel: only with ENABLE_DEV_ROUTES=1 and a localhost request.
 */
export function devRoutesAllowed(
  { vercelEnv, localFlag, host }: GateInput,
  testingPeriod: boolean = release.testingPeriod,
): boolean {
  if (vercelEnv === "preview") return true;
  if (vercelEnv === "production") return testingPeriod === true;
  if (vercelEnv === undefined) return localFlag === "1" && isLocalHost(host);
  return false;
}
