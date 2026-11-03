import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Fictitious showcase data may only be used under app/dev (demo-deviations G-05).
    files: ["**/*.{ts,tsx,mts}"],
    ignores: ["app/dev/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/_fixtures", "**/_fixtures.*"],
              message: "Fictitious showcase data is allowed only under app/dev.",
            },
            {
              // UI demo (D53): fictitious data and the demo frame stay under app/dev/demo.
              group: ["**/demo/_data", "**/demo/_data/**", "**/demo/_components", "**/demo/_components/**"],
              message: "UI-demo data and demo components are allowed only under app/dev.",
            },
          ],
        },
      ],
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
