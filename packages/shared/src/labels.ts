/** The fixed values the service stores, and the words the web app shows for them. */
import { z } from "zod";

export const AssumptionStatus = z.enum(["answered_by_po", "assumed_by_dev"]);
export type AssumptionStatus = z.infer<typeof AssumptionStatus>;
export const ASSUMPTION_STATUS_LABEL: Record<AssumptionStatus, string> = {
  answered_by_po: "answered by PO",
  assumed_by_dev: "assumed by dev",
};

export const DecisionOrigin = z.enum(["ai", "dev", "dev_changed_ai"]);
export type DecisionOrigin = z.infer<typeof DecisionOrigin>;
export const DECISION_ORIGIN_LABEL: Record<DecisionOrigin, string> = {
  ai: "AI",
  dev: "dev",
  dev_changed_ai: "dev changed AI",
};

export const ExplainBackRating = z.enum(["clear", "partial", "not_yet"]);
export type ExplainBackRating = z.infer<typeof ExplainBackRating>;
export const EXPLAIN_BACK_RATING_LABEL: Record<ExplainBackRating, string> = {
  clear: "clear",
  partial: "partial",
  not_yet: "not yet",
};
