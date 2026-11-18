import { z } from "zod";

// Short limits on purpose: these fields hold summaries, never pasted code or long text.
const id = z.string().trim().min(1).max(200);
const shortText = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(2000);

export const ASSUMPTION_STATUSES = ["answered_by_po", "assumed_by_dev"] as const;
export const DECISION_ORIGINS = ["ai", "dev", "dev_changed_ai"] as const;
export const RATINGS = ["clear", "partial", "not_yet"] as const;

export const getTicketInput = z.strictObject({
  ticket_id: id.describe("Ticket id, for example SAMPLE-1"),
});

export const TICKET_IMPORT_SOURCES = ["jira"] as const;

// A ticket read through another connector (the Atlassian MCP, for example) and handed to this server.
// Title and body are source material, so they may describe code; they are not run through the code checks.
export const importTicketInput = z.strictObject({
  ticket_id: id.describe("The ticket's key in its source, for example PROJ-123"),
  title: z.string().trim().min(1).max(500).describe("The ticket's summary"),
  body: z.string().trim().max(50_000).default("").describe("The ticket's description, as Markdown or plain text"),
  source: z.enum(TICKET_IMPORT_SOURCES).describe("Where the ticket was read from"),
});

export const saveAssumptionsInput = z.strictObject({
  ticket_id: id,
  assumptions: z
    .array(
      z
        .strictObject({
          text: shortText.describe("The open question or reading of the ticket"),
          status: z.enum(ASSUMPTION_STATUSES),
          answer: longText.optional().describe("The PO's answer, or what the developer assumed"),
        })
        .refine((a) => a.status !== "answered_by_po" || a.answer !== undefined, {
          message: "An assumption with status 'answered_by_po' needs an answer",
          path: ["answer"],
        }),
    )
    .min(1)
    .max(30),
});

export const pointerInput = z.strictObject({
  repo: z.string().trim().min(1).max(200).describe("owner/name"),
  file_path: z.string().trim().min(1).max(500),
  symbol: z.string().trim().min(1).max(200).optional().describe("Function or class name"),
  line_hint: z.number().int().positive().optional(),
  pr_number: z.number().int().positive().optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/i, "commit must be a git SHA")
    .optional(),
});

export const itemId = z
  .string()
  .trim()
  .regex(/^(BE|FE)\.[A-Z][A-Z0-9]{1,7}\.[JMSX]\d{1,2}$/, "item ids look like BE.ERR.M2")
  .describe("A ladder item id, for example BE.ERR.M2");

export const logDecisionInput = z.strictObject({
  ticket_id: id,
  session_id: id,
  summary: shortText.describe("The choice that was made, in one or two sentences. No code."),
  alternatives: z.array(shortText).max(10).default([]).describe("Other options that were considered"),
  origin: z.enum(DECISION_ORIGINS).describe("ai = Claude chose, dev = developer chose, dev_changed_ai = developer overrode Claude"),
  pointer: pointerInput.optional().describe("Where the decision lives in the code. A reference only, never the code."),
  related_files: z
    .array(z.string().trim().min(1).max(500))
    .max(20)
    .default([])
    .describe("Other files this same decision covers, for example its test file. Paths only."),
  item_id: itemId.optional().describe("The ladder item this decision is about, if one fits. For example BE.ERR.M2"),
});

export const startTrailInput = z.strictObject({
  ticket_id: id,
  session_id: id.describe("The Claude Code session id"),
});

export const listDecisionsInput = z.strictObject({
  ticket_id: id,
});

export const resolvePointersInput = z.strictObject({
  ticket_id: id,
  pr_number: z.number().int().positive().optional().describe("The pull request. Leave out to use the current branch's PR."),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/i, "commit must be a git SHA")
    .optional()
    .describe("Check against this commit and skip the pull request lookup"),
});

export const openReportInput = z.strictObject({
  open_browser: z.boolean().default(true).describe("false = start the local server and return the address, but do not open the browser"),
});

export const updatePrDecisionsInput = z.strictObject({
  ticket_id: id,
  pr_number: z.number().int().positive().optional().describe("The pull request. Leave out to use the current branch's PR."),
  dry_run: z.boolean().default(false).describe("true = build and return the section, but do not change the pull request"),
});

export const listObservationsInput = z.strictObject({
  developer_id: id.optional().describe("Leave out to use the local developer"),
});

export const getTrailInput = z.strictObject({
  session_id: id.describe("The Claude Code session id"),
});

export const recordExplainBackInput = z.strictObject({
  decision_id: id,
  question: shortText,
  answer: longText.describe("The developer's own explanation"),
  rating: z.enum(RATINGS),
});

export const saveObservationInput = z.strictObject({
  developer_id: id.optional().describe("Leave out to use the local developer"),
  skill_tag: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,49}$/, "skill_tag must be lowercase letters, digits and dashes"),
  summary: shortText,
  evidence_ids: z.array(id).min(1).max(20).describe("Ids of the decisions or explain-backs that support this"),
});

export const saveGrowthPlanInput = z.strictObject({
  developer_id: id.optional().describe("Leave out to use the local developer"),
  focus_areas: z
    .array(
      z.strictObject({
        claim: shortText,
        evidence_ids: z.array(id).min(1).max(20).describe("Observation ids that support the claim"),
        exercise: longText.describe("One concrete thing to practise"),
      }),
    )
    .min(1)
    .max(3),
});

export const coachStatusInput = z.strictObject({});

export const setCoachTracksInput = z.strictObject({
  tracks: z.array(z.enum(["backend", "frontend"])).min(1).max(2).describe("What the developer works on"),
  extra_emails: z.array(z.email()).max(5).optional().describe("Other emails the developer commits with"),
});

const ladderId = z.string().trim().min(1).max(200);

export const coachItemInput = z.strictObject({
  item_id: itemId,
  ladder_id: ladderId.optional().describe("Leave out to use the active ladder"),
});

export const coachHistoryInput = z.strictObject({
  ladder_id: ladderId.optional(),
});

export const proposeEvidenceInput = z.strictObject({
  item_id: itemId,
  ladder_id: ladderId.optional(),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/i, "commit must be a git SHA"),
  file: z.string().trim().min(1).max(500).describe("Repo-relative path"),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  why: shortText.describe("Why these lines show the item, in plain words. No code."),
});

export const disagreeInput = z.strictObject({
  target_id: id.describe("The id of a piece of evidence or a drill attempt"),
  reason: z.string().trim().min(8).max(500).describe("The developer's reason, in their own words"),
});

export const askQuestionInput = z
  .strictObject({
    session_id: id.describe("The Claude Code session id"),
    question_id: id.optional().describe("A pending question from coach_status"),
    decision_id: id.optional().describe("Or: a decision to ask an explain-back about"),
    item_id: itemId.optional().describe("With decision_id: the ladder item, when the decision has none"),
    text: shortText.describe("The question exactly as you will ask it. It must not give the answer away"),
  })
  .refine((i) => (i.question_id === undefined) !== (i.decision_id === undefined), { message: "Give exactly one of question_id or decision_id" });

export const rateAnswerInput = z.strictObject({
  question_id: id,
  rating: z.enum(RATINGS),
  tradeoff_quote: z.string().trim().min(12).max(500).optional().describe("Words copied exactly from the answer that name the trade-off. Leave out if it names none"),
});

export const startDrillInput = z.strictObject({
  item_id: itemId,
  ladder_id: z.string().trim().min(1).max(200).optional(),
  session_id: id.describe("The Claude Code session id"),
});

const scoredPoint = z.strictObject({
  id: z.string().trim().min(1).max(50).describe("A key point or red flag id from the drill"),
  quote: z.string().trim().min(12).max(500).describe("The exact words from the answer that show it"),
});

export const scoreDrillInput = z.strictObject({
  question_id: id,
  hits: z.array(scoredPoint).max(10).describe("Key points the answer hits"),
  red_flags: z.array(scoredPoint).max(10).describe("Red flags the answer shows"),
});

export type ImportTicketInput = z.infer<typeof importTicketInput>;
export type SaveAssumptionsInput = z.infer<typeof saveAssumptionsInput>;
export type StartTrailInput = z.infer<typeof startTrailInput>;
export type LogDecisionInput =z.infer<typeof logDecisionInput>;
export type RecordExplainBackInput = z.infer<typeof recordExplainBackInput>;
export type SaveObservationInput = z.infer<typeof saveObservationInput>;
export type SaveGrowthPlanInput = z.infer<typeof saveGrowthPlanInput>;
