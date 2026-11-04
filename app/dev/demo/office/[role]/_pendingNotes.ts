// Visible notes of behaviour that waits for an open owner decision (docs/decisions.md, open
// decisions). Demo pages pass them to shared components as props; components never write them.
import { pendingDecisionHint } from "@/components/ui/pending-hint";
import type { OpenDecisionId } from "@/features/settings/data/types";

/**
 * The product return window ("חזר תוך זמן קצר"). TEMPORARY: the spec says only "within a short
 * time"; the definition is the owner's (open decision #20, board ref d31, the KPI definitions;
 * related to #15 / d23). Shown as pending, never as a decided rule.
 */
const RETURN_WINDOW_DECISION: OpenDecisionId = "d31";

export const RETURN_WINDOW_NOTE = `חלון זמני · ${pendingDecisionHint(RETURN_WINDOW_DECISION)}`;
