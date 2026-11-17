/**
 * The REST API of the local service, as the web app reads it (docs/api.md).
 *
 * The server builds these responses in packages/server/src/api/data.ts. A server test parses every
 * response with these schemas, so the two cannot drift apart again without a test failing.
 *
 * Dates from the service are UTC without a zone, like "2026-11-16 11:05:58". Use parseServerDate().
 */
import { z } from "zod";
import { AssumptionStatus, DecisionOrigin, ExplainBackRating } from "./labels";

const DateText = z.string();

/** "2026-11-16 11:05:58" (UTC) or an ISO string, as a Date. */
export function parseServerDate(text: string): Date {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
  return new Date(iso);
}

// ---- Tickets -----------------------------------------------------------------------------------

export const TicketSummary = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  created_at: DateText,
  assumption_count: z.number().int(),
  decision_count: z.number().int(),
});
export type TicketSummary = z.infer<typeof TicketSummary>;

/** GET /api/tickets */
export const TicketListResponse = z.object({ tickets: z.array(TicketSummary) });
export type TicketListResponse = z.infer<typeof TicketListResponse>;

export const Ticket = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  source: z.string(),
  created_at: DateText,
});
export type Ticket = z.infer<typeof Ticket>;

export const Assumption = z.object({
  id: z.string(),
  text: z.string(),
  status: AssumptionStatus,
  answer: z.string().nullable(),
  created_at: DateText,
});
export type Assumption = z.infer<typeof Assumption>;

export const Pointer = z.object({
  id: z.string(),
  repo: z.string(),
  pr_number: z.number().int().nullable(),
  file_path: z.string(),
  symbol: z.string().nullable(),
  commit: z.string().nullable(),
  line_hint: z.number().int().nullable(),
  /** GitHub link pinned to the commit. Null until the pointer has a commit. */
  url: z.string().nullable(),
  /** Last resolve check: true = found, false = broken (see resolve_note), null = never checked. */
  resolved: z.boolean().nullable(),
  resolve_note: z.string().nullable(),
});
export type Pointer = z.infer<typeof Pointer>;

export const ExplainBack = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  rating: ExplainBackRating,
  created_at: DateText,
});
export type ExplainBack = z.infer<typeof ExplainBack>;

export const Annotation = z.object({
  id: z.string(),
  target_id: z.string(),
  note: z.string(),
  disagrees: z.boolean(),
  created_at: DateText,
});
export type Annotation = z.infer<typeof Annotation>;

export const Decision = z.object({
  id: z.string(),
  ticket_id: z.string(),
  session_id: z.string(),
  summary: z.string(),
  alternatives: z.array(z.string()),
  origin: DecisionOrigin,
  related_files: z.array(z.string()),
  created_at: DateText,
  pointer: Pointer.nullable(),
  explain_backs: z.array(ExplainBack),
  annotations: z.array(Annotation),
});
export type Decision = z.infer<typeof Decision>;

export const TrailSession = z.object({
  session_id: z.string(),
  started_at: DateText,
  edited_files: z.array(z.object({ file_path: z.string(), edit_count: z.number().int(), explained: z.boolean() })),
  /** Files the session edited that no decision points at. */
  unexplained_files: z.array(z.string()),
});
export type TrailSession = z.infer<typeof TrailSession>;

/** GET /api/tickets/:id — everything for the Fork view and the Paper Trail view. */
export const TicketDetailResponse = z.object({
  ticket: Ticket,
  assumptions: z.array(Assumption),
  decisions: z.array(Decision),
  sessions: z.array(TrailSession),
});
export type TicketDetailResponse = z.infer<typeof TicketDetailResponse>;

// ---- Coach -------------------------------------------------------------------------------------

export const EvidenceItem = z.object({
  id: z.string(),
  kind: z.enum(["decision", "explain_back", "missing"]),
  ticket_id: z.string().optional(),
  origin: DecisionOrigin.optional(),
  rating: ExplainBackRating.optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const Observation = z.object({
  id: z.string(),
  skill_tag: z.string(),
  summary: z.string(),
  created_at: DateText,
  evidence: z.array(EvidenceItem),
});
export type Observation = z.infer<typeof Observation>;

export const FocusArea = z.object({
  /** Use as target_id to add a note to this claim. */
  id: z.string(),
  claim: z.string(),
  /** Set by the server: true when the claim rests on one observation. */
  tentative: z.boolean(),
  exercise: z.string(),
  evidence: z.array(Observation),
  annotations: z.array(Annotation),
});
export type FocusArea = z.infer<typeof FocusArea>;

/** GET /api/growth-plan */
export const GrowthPlanResponse = z.object({
  growth_plan: z
    .object({ id: z.string(), developer_id: z.string(), created_at: DateText, focus_areas: z.array(FocusArea) })
    .nullable(),
});
export type GrowthPlanResponse = z.infer<typeof GrowthPlanResponse>;
export type GrowthPlan = NonNullable<GrowthPlanResponse["growth_plan"]>;

/** POST /api/annotations — the body. */
export const AnnotationInput = z.object({
  target_id: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1, "Write a note first.").max(2000),
  disagrees: z.boolean(),
});
export type AnnotationInput = z.infer<typeof AnnotationInput>;

/** POST /api/annotations — 201. */
export const AnnotationResponse = z.object({ annotation: Annotation });

// ---- My data -----------------------------------------------------------------------------------

/** The tables of the local store, in the order the "My data" page lists them. */
export const STORED_TABLES = [
  "tickets",
  "assumptions",
  "trail_sessions",
  "file_edits",
  "decisions",
  "pointers",
  "explain_backs",
  "observations",
  "growth_plans",
  "annotations",
] as const;
export type StoredTable = (typeof STORED_TABLES)[number];

/** GET /api/export — every stored row. counts[table] equals data[table].length. */
export const ExportResponse = z.object({
  exported_at: z.string(),
  counts: z.record(z.string(), z.number().int()),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
export type ExportResponse = z.infer<typeof ExportResponse>;

/** DELETE /api/data — the body must be exactly this. */
export const DELETE_ALL_BODY = { confirm: "delete-all" } as const;

/** DELETE /api/data — how many rows each table lost. */
export const DeleteAllResponse = z.object({ deleted: z.record(z.string(), z.number().int()) });
export type DeleteAllResponse = z.infer<typeof DeleteAllResponse>;

/** An error from the API. 422 privacy_guard also has field and rule. */
export const ApiErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), field: z.string().optional(), rule: z.string().optional() }),
});

// ---- Eval --------------------------------------------------------------------------------------

export const EvalScoreId = z.enum(["fork", "paper_trail", "pointers", "coach", "privacy"]);
export type EvalScoreId = z.infer<typeof EvalScoreId>;

export const EvalScore = z.object({
  id: EvalScoreId,
  label: z.string(),
  /** What was counted, e.g. "planted ambiguities caught, across 3 runs". */
  measures: z.string(),
  /** "not_run" when this part of the evaluation has not happened yet. */
  status: z.enum(["measured", "not_run"]),
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
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

/** GET /api/eval — the file `pnpm eval` writes. 404 when no evaluation has been run. */
export const EvalResults = z.object({
  run_at: z.string(),
  ticket_id: z.string(),
  fork_runs: z.number().int().nonnegative(),
  scores: z.array(EvalScore),
  failures: z.array(EvalFailure),
});
export type EvalResults = z.infer<typeof EvalResults>;

/** Paths, relative to the API base. Mock mode maps them to static JSON files. */
export const API_PATHS = {
  tickets: () => "/api/tickets",
  ticket: (ticketId: string) => `/api/tickets/${encodeURIComponent(ticketId)}`,
  growthPlan: () => "/api/growth-plan",
  annotations: () => "/api/annotations",
  export: () => "/api/export",
  data: () => "/api/data",
  eval: () => "/api/eval",
} as const;
