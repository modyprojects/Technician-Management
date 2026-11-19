// The app servers of the local-stack suite (playwright.auth.config.ts): the main one (simulator on),
// one with the Outlook invitation simulator switched off and one that says it is Vercel Production
// (D24, SIM-11: the simulator is never on there, whatever the switch says).
export const AUTH_TEST_PORT = 3120;
export const SIMULATOR_OFF_PORT = 3121;
export const SIMULATOR_PRODUCTION_PORT = 3122;
export const originOf = (port: number): string => `http://127.0.0.1:${port}`;
