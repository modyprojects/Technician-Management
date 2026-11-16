import type { TechTab } from "@/components/tech/TechBottomNav";
import { TECH_PROFILE_PATH, TECH_START_PATH } from "@/features/auth/landing";

// The technician's temporary navigation (Step 2 PR 2.5; Q18 TEMPORARY, AU-03 PROPOSED): only built
// items, "היום" (the start screen) and "פרופיל"; "יומן" is not built yet.
export const TECH_START_TABS: readonly TechTab[] = ["home", "prof"];
export const TECH_START_HREFS = { home: TECH_START_PATH, prof: TECH_PROFILE_PATH } as const;
