import { DECISION_ORIGIN_LABEL, type DecisionOrigin } from "@devgym/shared";

const DESCRIPTION: Record<DecisionOrigin, string> = {
  ai: "Claude made this decision",
  dev: "The developer made this decision",
  dev_changed_ai: "The developer changed what Claude proposed",
};

/** Who made a decision: AI, dev, or dev changed AI. Used by Track (FE-3). */
export function OriginBadge({ origin }: { origin: DecisionOrigin }) {
  return (
    <span className={`origin origin--${origin}`} title={DESCRIPTION[origin]}>
      {DECISION_ORIGIN_LABEL[origin]}
    </span>
  );
}
