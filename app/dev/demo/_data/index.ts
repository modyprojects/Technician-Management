// FICTITIOUS DATA ONLY: the UI demo's fictional data (D53). Allowed only under app/dev (G-05);
// eslint.config.mjs blocks imports from anywhere else. Ported from docs/demo.html.
// This barrel includes the seeded calls: import it in Server Components only. In "use client"
// files import types or the client-safe modules directly (dates, reference, status, roles,
// routes, notifications) and receive call data as props.
export { FIXTURE_SENTINEL } from "../../showcase/_fixtures";
export * from "./dates";
export * from "./notifications";
export * from "./params";
export * from "./queries";
export * from "./reference";
export * from "./roles";
export * from "./routes";
export * from "./status";
export type * from "./types";
