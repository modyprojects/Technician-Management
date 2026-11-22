// The visit flow's steps (D95): the card, the work screen and the close screen, addressed as
// `/tech/visit/<id>`, `?step=work` and `?step=close`.
export type FlowStep = "card" | "work" | "close";

/** The step in the address; anything else is the card. */
export function stepOf(value: string | null | undefined): FlowStep {
  return value === "work" || value === "close" ? value : "card";
}
