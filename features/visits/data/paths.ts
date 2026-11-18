// The real technician addresses (Step 3). Pure. A visit is addressed by its database id (a uuid,
// `visits.id`): the technician reads his own visits rows under RLS, and another technician's id is
// simply not found. The id is encoded, so a malformed value can never change the path.
export const TECH_HOME_PATH = "/tech";
export const TECH_DONE_PATH = "/tech/done";

/** "/tech/visit/<id>". */
export const techVisitPath = (id: string): string => `/tech/visit/${encodeURIComponent(id)}`;

/** "/tech/visit/<id>/work": the work screen of a visit in progress (Step 4). */
export const techWorkPath = (id: string): string => `${techVisitPath(id)}/work`;

/** "/tech/visit/<id>/close": the closure of a visit in progress (Step 4). */
export const techClosePath = (id: string): string => `${techVisitPath(id)}/close`;
