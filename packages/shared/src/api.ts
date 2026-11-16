/**
 * Response shapes shared by the REST API (BE-12) and the web app.
 *
 * The web app's mock JSON uses exactly these shapes, so switching from mocks
 * to the real API is one config change (VITE_API_MODE).
 */
import { z } from "zod";
import {
  Annotation,
  Assumption,
  Decision,
  ExplainBack,
  FocusArea,
  GrowthPlan,
  Observation,
  Pointer,
  Ticket,
} from "./records";

/** GET /api/tickets */
export const TicketSummary = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  fork_runs: z.number().int(),
  decisions: z.number().int(),
  updated_at: z.string(),
});
export type TicketSummary = z.infer<typeof TicketSummary>;

export const TicketListResponse = z.object({
  tickets: z.array(TicketSummary),
});
export type TicketListResponse = z.infer<typeof TicketListResponse>;

/** One /fork run: the assumption list saved by one save_assumptions call. */
export const ForkRun = z.object({
  run_id: z.string(),
  created_at: z.string(),
  assumptions: z.array(Assumption),
});
export type ForkRun = z.infer<typeof ForkRun>;

/** GET /api/tickets/:id/fork — newest run first. */
export const ForkResultResponse = z.object({
  ticket: Ticket,
  runs: z.array(ForkRun),
});
export type ForkResultResponse = z.infer<typeof ForkResultResponse>;

/** A decision with the pointer it refers to and what the developer said about it. */
export const DecisionView = Decision.extend({
  pointer: Pointer.nullable(),
  explain_backs: z.array(ExplainBack),
});
export type DecisionView = z.infer<typeof DecisionView>;

/** GET /api/tickets/:id/trail — decisions in the order they were made. */
export const PaperTrailResponse = z.object({
  ticket: Ticket,
  decisions: z.array(DecisionView),
});
export type PaperTrailResponse = z.infer<typeof PaperTrailResponse>;

/** Every record in the local store, by kind. */
export const StoredData = z.object({
  tickets: z.array(Ticket),
  assumptions: z.array(Assumption),
  pointers: z.array(Pointer),
  decisions: z.array(Decision),
  explain_backs: z.array(ExplainBack),
  observations: z.array(Observation),
  growth_plans: z.array(GrowthPlan),
  annotations: z.array(Annotation),
});
export type StoredData = z.infer<typeof StoredData>;
export type StoredKind = keyof StoredData;

export const STORED_KINDS = [
  "tickets",
  "assumptions",
  "decisions",
  "pointers",
  "explain_backs",
  "observations",
  "growth_plans",
  "annotations",
] as const satisfies readonly StoredKind[];

/**
 * GET /api/data — everything stored on this computer.
 * The "Export as JSON" file is this response, unchanged.
 */
export const MyDataResponse = z.object({
  exported_at: z.string(),
  /** Where the SQLite file is, for display. */
  stored_in: z.string(),
  developer_id: z.string(),
  data: StoredData,
});
export type MyDataResponse = z.infer<typeof MyDataResponse>;

/** DELETE /api/data — how many records of each kind were removed. */
export const DeleteAllResponse = z.object({
  deleted: z.record(z.string(), z.number().int()),
});
export type DeleteAllResponse = z.infer<typeof DeleteAllResponse>;

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

/** One thing an observation rests on: a decision, or an explain-back of one. */
export const EvidenceRef = z.object({
  id: z.string(),
  kind: z.enum(["decision", "explain_back"]),
  ticket_id: z.string(),
  /** The decision itself, or the decision the explain-back is about. */
  decision_id: z.string(),
  /** The decision's summary, or the explain-back's question. */
  label: z.string(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const ObservationView = Observation.extend({
  evidence: z.array(EvidenceRef),
});
export type ObservationView = z.infer<typeof ObservationView>;

export const FocusAreaView = FocusArea.extend({
  /** What an annotation on this claim points at. See focusTargetId(). */
  target_id: z.string(),
  observations: z.array(ObservationView),
  annotations: z.array(Annotation),
});
export type FocusAreaView = z.infer<typeof FocusAreaView>;

/** GET /api/coach — the developer's latest growth plan, or null when there is none. */
export const CoachReportResponse = z.object({
  developer_id: z.string(),
  plan: z
    .object({
      id: z.string(),
      created_at: z.string(),
      focus_areas: z.array(FocusAreaView),
    })
    .nullable(),
});
export type CoachReportResponse = z.infer<typeof CoachReportResponse>;

/** The id annotations use to point at one focus area of a plan. */
export function focusTargetId(planId: string, index: number): string {
  return `${planId}/focus/${index + 1}`;
}

/** POST /api/annotations — the body. The response is the saved Annotation. */
export const AnnotationInput = z.object({
  target_id: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1, "Write a note first.").max(1000),
  disagrees: z.boolean(),
});
export type AnnotationInput = z.infer<typeof AnnotationInput>;

// ---------------------------------------------------------------------------
// Eval
// ---------------------------------------------------------------------------

export const EvalScoreId = z.enum(["fork", "paper_trail", "pointers", "coach", "privacy"]);
export type EvalScoreId = z.infer<typeof EvalScoreId>;

export const EvalScore = z.object({
  id: EvalScoreId,
  label: z.string(),
  /** What was counted, e.g. "planted ambiguities caught across 3 runs". */
  measures: z.string(),
  /** "not_run" when this part of the evaluation has not happened yet. */
  status: z.enum(["measured", "not_run"]),
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** Other numbers that matter for this score, e.g. false alarms. */
  also: z.array(z.object({ label: z.string(), value: z.number().int().nonnegative() })),
  note: z.string().optional(),
});
export type EvalScore = z.infer<typeof EvalScore>;

export const EvalFailure = z.object({
  id: z.string(),
  area: EvalScoreId,
  /** Which Fork run, when the failure belongs to one. */
  run: z.number().int().positive().nullable(),
  what: z.string(),
  expected: z.string(),
  got: z.string(),
});
export type EvalFailure = z.infer<typeof EvalFailure>;

/**
 * GET /api/eval — the results file the eval harness (EV-3) writes, with the
 * senior review (EV-4) and the privacy red-team (EV-5) added to it.
 * 404 when no evaluation has been run.
 */
export const EvalResults = z.object({
  run_at: z.string(),
  ticket_id: z.string(),
  fork_runs: z.number().int().positive(),
  scores: z.array(EvalScore),
  failures: z.array(EvalFailure),
});
export type EvalResults = z.infer<typeof EvalResults>;

/** Paths, relative to the API base. Mock mode maps them to static JSON files. */
export const API_PATHS = {
  tickets: () => "/api/tickets",
  forkResult: (ticketId: string) => `/api/tickets/${encodeURIComponent(ticketId)}/fork`,
  trail: (ticketId: string) => `/api/tickets/${encodeURIComponent(ticketId)}/trail`,
  data: () => "/api/data",
  coach: () => "/api/coach",
  annotations: () => "/api/annotations",
  eval: () => "/api/eval",
} as const;
