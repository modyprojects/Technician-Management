import type { TechTab } from "@/components/tech/TechBottomNav";
import { TECH_PROFILE_PATH, TECH_START_PATH } from "@/features/auth/landing";

export const TECH_CALENDAR_PATH = "/tech/calendar";

// The technician's navigation (TE-32, D83): "היום", "יומן" (the calendar, D85) and "פרופיל".
export const TECH_START_TABS: readonly TechTab[] = ["home", "cal", "prof"];
export const TECH_START_HREFS = { home: TECH_START_PATH, cal: TECH_CALENDAR_PATH, prof: TECH_PROFILE_PATH } as const;
