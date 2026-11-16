import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import { PrivacyGuard } from "../privacy/guard.js";
import * as store from "../store.js";
import type { TicketAdapter } from "../tickets/adapter.js";
import {
  getTicketInput,
  getTrailInput,
  listDecisionsInput,
  listObservationsInput,
  logDecisionInput,
  recordExplainBackInput,
  saveAssumptionsInput,
  saveGrowthPlanInput,
  saveObservationInput,
  startTrailInput,
} from "./schemas.js";

export const SERVER_NAME = "fork-trail-coach";
export const SERVER_VERSION = "0.1.0";

/** Runs a store call and turns the outcome into a tool result. */
async function reply(run: () => unknown): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await run(), null, 2) }] };
  } catch (err) {
    // Only StoreError messages are written for the caller. Anything else is a bug: keep details out.
    const message = err instanceof StoreError ? err.message : "Internal error while saving";
    if (!(err instanceof StoreError)) console.error(err);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

export interface ServerOptions {
  /** The repo folder the session works in. File paths are stored relative to it. */
  root?: string;
  /** Checks every write. Defaults to a guard for `root` with the developer's local denylist. */
  guard?: PrivacyGuard;
}

export function createServer(db: Db, tickets: TicketAdapter, options: ServerOptions = {}): McpServer {
  const root = options.root ?? process.cwd();
  const guard = options.guard ?? new PrivacyGuard({ root });
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  /** Every tool that writes goes through here: the privacy guard runs before anything is saved. */
  const write = <T>(input: T, save: (input: T) => unknown) =>
    reply(() => {
      guard.check(input);
      return save(input);
    });
  const ticket = (ticketId: string) => store.ensureTicket(db, tickets, ticketId, guard);

  server.registerTool(
    "get_ticket",
    {
      title: "Get ticket",
      description: "Read one ticket (id, title, body) by its id.",
      inputSchema: getTicketInput,
      annotations: { readOnlyHint: true },
    },
    // Reading a ticket also saves a local copy, so it is guarded like a write.
    (input) => write(input, (i) => ticket(i.ticket_id)),
  );

  server.registerTool(
    "save_assumptions",
    {
      title: "Save assumptions",
      description:
        "Save the assumption list for a ticket after Fork. Each item is 'answered_by_po' (with the answer) or 'assumed_by_dev'. Replaces the ticket's previous list. Words only: text that looks like code, a secret, or a client name is rejected.",
      inputSchema: saveAssumptionsInput,
    },
    (input) =>
      write(input, async (i) => {
        await ticket(i.ticket_id);
        return store.saveAssumptions(db, i);
      }),
  );

  server.registerTool(
    "log_decision",
    {
      title: "Log decision",
      description:
        "Log one design or implementation choice made while coding a ticket: what was chosen, the alternatives, who chose it, and a pointer to where it lives. Describe the choice in words; never paste code. Text that looks like code, a secret, or a client name is rejected.",
      inputSchema: logDecisionInput,
    },
    (input) =>
      write(input, async (i) => {
        await ticket(i.ticket_id);
        return store.logDecision(db, i, root);
      }),
  );

  server.registerTool(
    "start_trail",
    {
      title: "Start Paper Trail",
      description:
        "Start tracking a coding session for a ticket. From then on the plugin records which files the session edits (paths only). Returns the ticket and its saved assumptions.",
      inputSchema: startTrailInput,
    },
    (input) =>
      write(input, async (i) => {
        await ticket(i.ticket_id);
        return store.startTrail(db, i);
      }),
  );

  server.registerTool(
    "get_trail",
    {
      title: "Get Paper Trail",
      description:
        "List a session's logged decisions and edited files. 'unexplained_files' are edited files that no decision points at.",
      inputSchema: getTrailInput,
      annotations: { readOnlyHint: true },
    },
    (input) => reply(() => store.getTrail(db, input.session_id)),
  );

  server.registerTool(
    "list_decisions",
    {
      title: "List decisions",
      description:
        "List every decision logged for a ticket, across sessions, with how many explain-backs each one already has.",
      inputSchema: listDecisionsInput,
      annotations: { readOnlyHint: true },
    },
    (input) => reply(() => store.listDecisions(db, input.ticket_id)),
  );

  server.registerTool(
    "record_explain_back",
    {
      title: "Record explain-back",
      description:
        "Save the developer's own explanation of a logged decision, with a rating of how clear it was. Words only: code, secrets and client names are rejected.",
      inputSchema: recordExplainBackInput,
    },
    (input) => write(input, (i) => store.recordExplainBack(db, i)),
  );

  server.registerTool(
    "save_observation",
    {
      title: "Save observation",
      description:
        "Save one observation about a developer skill. It must cite the decisions or explain-backs it is based on. Words only: code, secrets and client names are rejected.",
      inputSchema: saveObservationInput,
    },
    (input) => write(input, (i) => store.saveObservation(db, i)),
  );

  server.registerTool(
    "list_observations",
    {
      title: "List observations",
      description:
        "List the developer's saved observations, each with its evidence: the decisions (with origin) and explain-backs (with rating) it is based on.",
      inputSchema: listObservationsInput,
      annotations: { readOnlyHint: true },
    },
    (input) => reply(() => store.listObservations(db, input.developer_id)),
  );

  server.registerTool(
    "save_growth_plan",
    {
      title: "Save growth plan",
      description:
        "Save a growth plan with 1 to 3 focus areas. Each claim must cite observation ids. The server marks a claim 'tentative' when it rests on a single observation. Words only: code, secrets and client names are rejected.",
      inputSchema: saveGrowthPlanInput,
    },
    (input) => write(input, (i) => store.saveGrowthPlan(db, i)),
  );

  return server;
}
