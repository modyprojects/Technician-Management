import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Import restrictions. A later config object replaces (does not merge) the rule options of an
// earlier one for the same files, so every block repeats the patterns it must keep.

/** Fictitious data stays under app/dev (demo-deviations G-05). */
const FIXTURE_PATTERNS = [
  {
    group: ["**/_fixtures", "**/_fixtures.*"],
    message: "Fictitious showcase data is allowed only under app/dev.",
  },
  {
    // UI demo (D53): fictitious data and the demo frame stay under app/dev/demo.
    group: ["**/demo/_data", "**/demo/_data/**", "**/demo/_components", "**/demo/_components/**"],
    message: "UI-demo data and demo components are allowed only under app/dev.",
  },
];

/** Owner architecture rule (2026-11-03): shared code never depends on routes. */
const NO_APP_IMPORTS = {
  regex: "^(@/app(/|$)|(\\.\\./)+app(/|$))",
  message:
    "components/, features/ and lib/ must not import from app/ (owner architecture rule, 2026-11-03): " +
    "take DTO types from features/*/data/types and receive data as props.",
};

/**
 * Owner architecture rule (2026-11-03): "screens must read data only through a typed data-access
 * layer ... No fixture data inside components." Demo screens may import from _data only the
 * adapter (demoDataAccess), routes, roles (viewpoints and navigation presentation config), dates
 * (formatting and the demo's TODAY) and params (build-time static params of the dynamic routes).
 */
const DEMO_DATA_ONLY_THROUGH_LAYER = {
  regex: "(^|/)_data(/(?!(adapter|routes|roles|dates|params)$)[^/]+)?$",
  message:
    "Demo screens read data only through the data-access layer (owner architecture rule, 2026-11-03): " +
    "use demoDataAccess from _data/adapter and DTO types from features/*/data/types. " +
    "Allowed from _data: adapter, routes, roles, dates, params.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mts}"],
    ignores: ["app/dev/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: FIXTURE_PATTERNS }],
    },
  },
  {
    files: ["components/**/*.{ts,tsx,mts}", "features/**/*.{ts,tsx,mts}", "lib/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...FIXTURE_PATTERNS, NO_APP_IMPORTS] }],
    },
  },
  {
    files: ["app/dev/demo/**/*.{ts,tsx,mts}"],
    ignores: ["app/dev/demo/_data/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [DEMO_DATA_ONLY_THROUGH_LAYER] }],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
