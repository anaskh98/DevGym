import type { Decision as DecisionView, DecisionOrigin, ExplainBackRating } from "@ftc/shared";
import { plural } from "./fork";

export const ORIGINS: readonly DecisionOrigin[] = ["ai", "dev", "dev_changed_ai"];
export const RATINGS: readonly ExplainBackRating[] = ["clear", "partial", "not_yet"];

export function countByOrigin(
  decisions: readonly Pick<DecisionView, "origin">[],
): Record<DecisionOrigin, number> {
  const counts: Record<DecisionOrigin, number> = { ai: 0, dev: 0, dev_changed_ai: 0 };
  for (const decision of decisions) counts[decision.origin] += 1;
  return counts;
}

export function countByRating(
  decisions: readonly Pick<DecisionView, "explain_backs">[],
): Record<ExplainBackRating, number> {
  const counts: Record<ExplainBackRating, number> = { clear: 0, partial: 0, not_yet: 0 };
  for (const decision of decisions) {
    for (const explainBack of decision.explain_backs) counts[explainBack.rating] += 1;
  }
  return counts;
}

/** "6 decisions: Claude made 3, the developer made 2, and the developer changed 1 of Claude's." */
export function originSentence(decisions: readonly Pick<DecisionView, "origin">[]): string {
  const counts = countByOrigin(decisions);
  const parts: string[] = [];
  if (counts.ai > 0) parts.push(`Claude made ${counts.ai}`);
  if (counts.dev > 0) parts.push(`the developer made ${counts.dev}`);
  if (counts.dev_changed_ai > 0) {
    parts.push(`the developer changed ${counts.dev_changed_ai} of Claude's`);
  }
  const list =
    parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
  const sentence = list.charAt(0).toUpperCase() + list.slice(1);
  return `${plural(decisions.length, "decision")}. ${sentence}.`;
}

/**
 * The position of each decision's coding session, counted from 1, so the
 * timeline can mark where a new session starts.
 */
export function sessionNumbers(decisions: readonly Pick<DecisionView, "session_id">[]): number[] {
  const seen = new Map<string, number>();
  return decisions.map((decision) => {
    let number = seen.get(decision.session_id);
    if (number === undefined) {
      number = seen.size + 1;
      seen.set(decision.session_id, number);
    }
    return number;
  });
}
