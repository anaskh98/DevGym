/**
 * The local MCP server: six tools Claude Code calls over stdio.
 *
 * Input is validated against the zod shapes in @ftc/shared before a handler
 * runs, so bad input is rejected with a message Claude can act on.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  GetTicketInput,
  LogDecisionInput,
  RecordExplainBackInput,
  SaveAssumptionsInput,
  SaveGrowthPlanInput,
  SaveObservationInput,
} from "@ftc/shared";
import type { Config } from "../config";
import type { Store } from "../db/store";
import { FtcError, NotFoundError } from "../errors";
import { isValidTicketId, type TicketSource } from "../tickets/source";

export const SERVER_NAME = "ftc-local-service";
export const SERVER_VERSION = "0.1.0";

export interface ServerDeps {
  store: Store;
  tickets: TicketSource;
  config: Pick<Config, "developerId" | "sessionId" | "ticketsDir">;
}

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Expected failures become tool errors Claude can read; bugs still throw. */
async function guarded(run: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FtcError) return fail(error.message);
    throw error;
  }
}

export function createFtcServer({ store, tickets, config }: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "get_ticket",
    {
      title: "Get ticket",
      description:
        "Fetch a ticket by id from the ticket source and record it in the local store. " +
        "Call this before any other tool that takes a ticket_id.",
      inputSchema: GetTicketInput,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ ticket_id }) =>
      guarded(async () => {
        if (!isValidTicketId(ticket_id)) {
          return fail(
            `"${ticket_id}" is not a valid ticket id. Use letters, digits, ".", "_" or "-".`,
          );
        }
        const found = await tickets.get(ticket_id);
        if (!found) {
          const available = (await tickets.list()).map((t) => t.id);
          throw new NotFoundError(
            `Ticket "${ticket_id}" was not found in ${config.ticketsDir}. ` +
              (available.length > 0
                ? `Available: ${available.join(", ")}.`
                : "That folder has no tickets."),
          );
        }
        const ticket = store.upsertTicket({ ...found, source: tickets.name });
        return ok({
          id: ticket.id,
          title: ticket.title,
          body: ticket.body,
          source: ticket.source,
        });
      }),
  );

  server.registerTool(
    "save_assumptions",
    {
      title: "Save assumptions",
      description:
        "Save the full assumption list from one /fork run on a ticket. Each item is a question " +
        'whose readings lead to different code, tagged "answered_by_po" (the PO answered) or ' +
        '"assumed_by_dev" (nobody answered; the developer proceeds on a stated reading). ' +
        "Describe behaviour in words; never paste code.",
      inputSchema: SaveAssumptionsInput,
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ ticket_id, assumptions }) =>
      guarded(() => {
        const run = store.saveAssumptions(ticket_id, assumptions);
        return ok({
          run_id: run.run_id,
          ticket_id,
          saved: run.assumptions.length,
          answered_by_po: run.assumptions.filter((a) => a.status === "answered_by_po").length,
          assumed_by_dev: run.assumptions.filter((a) => a.status === "assumed_by_dev").length,
          assumption_ids: run.assumptions.map((a) => a.id),
        });
      }),
  );

  server.registerTool(
    "log_decision",
    {
      title: "Log decision",
      description:
        "Record one decision made while coding a ticket: what was decided, the alternatives " +
        "not taken, who decided (origin), and a pointer to where it lives in the code. " +
        "The pointer is a file path and line, never the code itself.",
      inputSchema: LogDecisionInput,
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ ticket_id, summary, alternatives, origin, pointer, session_id }) =>
      guarded(() => {
        const { decision, pointer: saved } = store.logDecision({
          ticket_id,
          summary,
          alternatives,
          origin,
          pointer,
          session_id: session_id ?? config.sessionId,
        });
        return ok({
          decision_id: decision.id,
          pointer_id: saved?.id ?? null,
          session_id: decision.session_id,
        });
      }),
  );

  server.registerTool(
    "record_explain_back",
    {
      title: "Record explain-back",
      description:
        "Store the developer's own explanation of a logged decision, with a rating: " +
        '"clear", "partial" or "not_yet".',
      inputSchema: RecordExplainBackInput,
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (input) =>
      guarded(() => {
        const record = store.recordExplainBack(input);
        return ok({ explain_back_id: record.id, decision_id: record.decision_id });
      }),
  );

  server.registerTool(
    "save_observation",
    {
      title: "Save observation",
      description:
        "Save one observation about the developer's skills. It must cite the decision or " +
        "explain-back ids it rests on. Stored locally; never shared.",
      inputSchema: SaveObservationInput,
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (input) =>
      guarded(() => {
        const record = store.saveObservation({ ...input, developer_id: config.developerId });
        return ok({ observation_id: record.id });
      }),
  );

  server.registerTool(
    "save_growth_plan",
    {
      title: "Save growth plan",
      description:
        "Save a growth plan of 1 to 3 focus areas. Every claim must cite observation ids as " +
        "evidence; a claim without evidence is rejected, and a claim resting on a single " +
        "observation is marked tentative by the server.",
      inputSchema: SaveGrowthPlanInput,
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    ({ focus_areas }) =>
      guarded(() => {
        const plan = store.saveGrowthPlan({ developer_id: config.developerId, focus_areas });
        return ok({
          growth_plan_id: plan.id,
          focus_areas: plan.focus_areas.map((area) => ({
            claim: area.claim,
            evidence: area.evidence_ids.length,
            tentative: area.tentative,
          })),
        });
      }),
  );

  return server;
}
