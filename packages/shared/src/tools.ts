/**
 * Input shapes for the six MCP tools. The server validates every call against
 * these, and the skills are written to match them.
 *
 * Each export is a "raw shape" (a plain object of zod types), which is what
 * the MCP SDK's registerTool takes; wrap it in z.object() to parse directly.
 */
import { z } from "zod";
import { AssumptionStatus, DecisionOrigin, ExplainBackRating } from "./records";

const text = (max: number) => z.string().trim().min(1).max(max);

export const GetTicketInput = {
  ticket_id: text(64).describe('Ticket id, for example "DEMO-1".'),
};

export const AssumptionInput = z.object({
  text: text(600).describe("The question, as it was put to the product owner."),
  readings: z
    .array(text(400))
    .min(2)
    .max(6)
    .describe("The readings of the ticket that would each lead to different code."),
  status: AssumptionStatus.describe(
    '"answered_by_po" only when the PO actually answered; otherwise "assumed_by_dev".',
  ),
  answer: text(800).describe("The PO's answer, or the reading the developer assumed."),
});
export type AssumptionInput = z.infer<typeof AssumptionInput>;

export const SaveAssumptionsInput = {
  ticket_id: text(64),
  assumptions: z
    .array(AssumptionInput)
    .max(20)
    .describe("The full list for this /fork run. Empty when the ticket has no forks."),
};

export const PointerInput = z.object({
  file_path: text(400).describe("Path relative to the repository root."),
  line_hint: z.number().int().positive().optional(),
  symbol: text(200).optional().describe("Function or class name, if known."),
  repo: text(200)
    .regex(/^[\w.-]+\/[\w.-]+$/, 'Expected "owner/name".')
    .optional(),
  commit: text(64)
    .regex(/^[0-9a-f]{7,64}$/i, "Expected a commit SHA.")
    .optional(),
  pr_number: z.number().int().positive().optional(),
});
export type PointerInput = z.infer<typeof PointerInput>;

export const LogDecisionInput = {
  ticket_id: text(64),
  summary: text(600).describe("What was decided, in one or two sentences. No code."),
  alternatives: z
    .array(text(400))
    .max(6)
    .default([])
    .describe("The options that were considered and not taken."),
  origin: DecisionOrigin.describe(
    '"ai" if Claude chose, "dev" if the developer chose, "dev_changed_ai" if the developer overrode Claude.',
  ),
  pointer: PointerInput.optional().describe("Where the decision lives in the code."),
  session_id: text(128).optional().describe("Defaults to the current server session."),
};

export const RecordExplainBackInput = {
  decision_id: text(64),
  question: text(600),
  answer: text(2000).describe("The developer's explanation, in their own words."),
  rating: ExplainBackRating,
};

export const SaveObservationInput = {
  skill_tag: text(64).describe('Short tag for the skill observed, for example "error-handling".'),
  summary: text(600),
  evidence_ids: z
    .array(text(64))
    .min(1)
    .max(20)
    .describe("Ids of the decisions and explain-backs this observation rests on."),
};

export const FocusAreaInput = z.object({
  claim: text(600),
  evidence_ids: z
    .array(text(64))
    .min(1, "A claim needs at least one observation as evidence.")
    .max(20)
    .describe("Ids of the observations that support the claim."),
  exercise: text(800).describe("One concrete thing to practise."),
});
export type FocusAreaInput = z.infer<typeof FocusAreaInput>;

export const SaveGrowthPlanInput = {
  focus_areas: z.array(FocusAreaInput).min(1).max(3),
};

export const TOOL_NAMES = [
  "get_ticket",
  "save_assumptions",
  "log_decision",
  "record_explain_back",
  "save_observation",
  "save_growth_plan",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
