// One wording for a control or value that waits for an open owner decision (docs/decisions.md,
// open decisions): the profile's report (d26), the call card's cancel (d08) and the pending
// Settings items. The screen shows it as visible text next to a disabled control; it never
// resolves the decision. The decision code helps the owner find the decision; error messages do
// not carry it.
export const pendingDecisionHint = (decision: string): string => `ממתין להחלטת בעלים (${decision})`;
