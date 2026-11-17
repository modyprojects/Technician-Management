// The Outlook invitation simulator adapter (D24). It produces normalized events for the single
// ingestion service (features/calendar/ingestion) and has no business logic of its own (SIM-06).
export {
  buildSimulatorEvent,
  isSimulatorId,
  parseSimulatorRequest,
  simulatedInvitationSchema,
  simulatorRequestSchema,
  SIMULATOR_CALENDAR_ID,
  type SimulatedInvitation,
  type SimulatorAction,
  type SimulatorDeps,
  type SimulatorRequest,
} from "./commands";
export { simulatorEnabled, SIMULATOR_FLAG_NAME, type SimulatorEnvInput } from "./env";
