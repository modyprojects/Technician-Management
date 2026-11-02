import { expect, test } from "@playwright/test";
import { devRoutesAllowed } from "@/app/dev/_gate";
import { onlyInProject } from "./helpers";

// Every branch of the /dev gate, including the Vercel ones that local servers cannot reach.
test.describe("/dev gate logic", () => {
  onlyInProject("desktop");

  const cases: [string, Parameters<typeof devRoutesAllowed>[0], boolean, boolean][] = [
    ["Vercel Preview", { vercelEnv: "preview", localFlag: undefined, host: "x.vercel.app" }, true, true],
    ["Vercel Production in the testing period", { vercelEnv: "production", localFlag: undefined, host: "x.vercel.app" }, true, true],
    ["Vercel Production after go-live", { vercelEnv: "production", localFlag: "1", host: "localhost" }, false, false],
    ["vercel dev", { vercelEnv: "development", localFlag: "1", host: "localhost:3000" }, true, false],
    ["unknown VERCEL_ENV", { vercelEnv: "staging", localFlag: "1", host: "localhost" }, true, false],
    ["local with flag", { vercelEnv: undefined, localFlag: "1", host: "localhost:3100" }, true, true],
    ["local IPv4 with flag", { vercelEnv: undefined, localFlag: "1", host: "127.0.0.1:3100" }, true, true],
    ["local IPv6 with flag", { vercelEnv: undefined, localFlag: "1", host: "[::1]:3100" }, true, true],
    ["local without flag", { vercelEnv: undefined, localFlag: undefined, host: "localhost:3100" }, true, false],
    ["flag value other than 1", { vercelEnv: undefined, localFlag: "true", host: "localhost" }, true, false],
    ["look-alike host", { vercelEnv: undefined, localFlag: "1", host: "localhost.evil.example" }, true, false],
    ["remote host", { vercelEnv: undefined, localFlag: "1", host: "evil.example" }, true, false],
    ["no host", { vercelEnv: undefined, localFlag: "1", host: null }, true, false],
  ];

  for (const [name, input, testingPeriod, expected] of cases) {
    test(`${name}: ${expected ? "open" : "closed"}`, () => {
      expect(devRoutesAllowed(input, testingPeriod)).toBe(expected);
    });
  }
});
