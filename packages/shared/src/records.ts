/**
 * The eight records of the data model, as stored in the local SQLite file.
 *
 * Code is referenced by Pointer, never copied into a record.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums, with the labels the web app and the PR section show
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const IsoDate = z.string();

export const Ticket = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  /** Which adapter the ticket came from, e.g. "markdown" (later "jira"). */
  source: z.string(),
  created_at: IsoDate,
  updated_at: IsoDate,
});
export type Ticket = z.infer<typeof Ticket>;

export const Assumption = z.object({
  id: z.string(),
  ticket_id: z.string(),
  /** One /fork run saves one list; the run id groups it. */
  run_id: z.string(),
  position: z.number().int(),
  /** The question, as it was put to the PO. */
  text: z.string(),
  /** The readings that would each lead to different code. */
  readings: z.array(z.string()),
  status: AssumptionStatus,
  /** The PO's answer, or the reading the developer assumed. */
  answer: z.string(),
  created_at: IsoDate,
});
export type Assumption = z.infer<typeof Assumption>;

export const Pointer = z.object({
  id: z.string(),
  /** "owner/name" on GitHub. Null until known. */
  repo: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  file_path: z.string(),
  /** Function or class name. Filled by the pointer service (BE-7). */
  symbol: z.string().nullable(),
  /** Merge commit after merge; the working commit before. */
  commit: z.string().nullable(),
  line_hint: z.number().int().nullable(),
  created_at: IsoDate,
});
export type Pointer = z.infer<typeof Pointer>;

export const Decision = z.object({
  id: z.string(),
  ticket_id: z.string(),
  session_id: z.string(),
  summary: z.string(),
  alternatives: z.array(z.string()),
  origin: DecisionOrigin,
  pointer_id: z.string().nullable(),
  created_at: IsoDate,
});
export type Decision = z.infer<typeof Decision>;

export const ExplainBack = z.object({
  id: z.string(),
  decision_id: z.string(),
  question: z.string(),
  answer: z.string(),
  rating: ExplainBackRating,
  created_at: IsoDate,
});
export type ExplainBack = z.infer<typeof ExplainBack>;

export const Observation = z.object({
  id: z.string(),
  developer_id: z.string(),
  skill_tag: z.string(),
  summary: z.string(),
  /** Ids of the decisions and explain-backs this observation rests on. */
  evidence_ids: z.array(z.string()),
  created_at: IsoDate,
});
export type Observation = z.infer<typeof Observation>;

export const FocusArea = z.object({
  claim: z.string(),
  /** Ids of the observations that support the claim. */
  evidence_ids: z.array(z.string()),
  /** Set by the server: true when the claim rests on a single observation. */
  tentative: z.boolean(),
  exercise: z.string(),
});
export type FocusArea = z.infer<typeof FocusArea>;

export const GrowthPlan = z.object({
  id: z.string(),
  developer_id: z.string(),
  focus_areas: z.array(FocusArea),
  created_at: IsoDate,
});
export type GrowthPlan = z.infer<typeof GrowthPlan>;

export const Annotation = z.object({
  id: z.string(),
  /** Id of the record the note is about (a focus area, decision, ...). */
  target_id: z.string(),
  note: z.string(),
  disagrees: z.boolean(),
  created_at: IsoDate,
});
export type Annotation = z.infer<typeof Annotation>;

/** Id prefixes, so an evidence id says what it points at. */
export const ID_PREFIX = {
  assumption: "asm",
  forkRun: "run",
  pointer: "ptr",
  decision: "dec",
  explainBack: "exp",
  observation: "obs",
  growthPlan: "plan",
  annotation: "ann",
} as const;
