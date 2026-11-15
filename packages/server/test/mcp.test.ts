import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TOOL_NAMES } from "@ftc/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/connection";
import { createFtcServer } from "../src/mcp/server";
import { MarkdownTicketSource } from "../src/tickets/markdown";
import { count, memoryStore, SpyGuard, ticketsDir } from "./helpers";

interface Outcome {
  isError: boolean;
  text: string;
  json: any;
}

let client: Client;
let db: Db;
let guard: SpyGuard;

async function call(name: string, args: Record<string, unknown>): Promise<Outcome> {
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = ((result.content ?? []) as Array<{ text?: string }>).map((p) => p.text ?? "").join("\n");
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // error text
    }
    return { isError: result.isError === true, text, json };
  } catch (error) {
    return { isError: true, text: String(error), json: null };
  }
}

beforeEach(async () => {
  guard = new SpyGuard();
  const memory = memoryStore(guard);
  db = memory.db;
  const dir = await ticketsDir({
    "DEMO-1.md": "---\nid: DEMO-1\ntitle: Let members cancel a booking\n---\nBody of the ticket.",
  });
  const server = createFtcServer({
    store: memory.store,
    tickets: new MarkdownTicketSource(dir),
    config: { developerId: "dev-1", sessionId: "sess-test", ticketsDir: dir },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

const assumption = (overrides: Record<string, unknown> = {}) => ({
  text: "What happens to a late cancellation?",
  readings: ["Refuse it", "Allow it without a refund"],
  status: "assumed_by_dev",
  answer: "Refuse it",
  ...overrides,
});

describe("MCP server (BE-3)", () => {
  it("exposes exactly the six tools, each with an input schema", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
      expect(Object.keys(tool.inputSchema.properties ?? {}).length, tool.name).toBeGreaterThan(0);
    }
  });

  it("get_ticket returns the ticket and records it locally", async () => {
    const result = await call("get_ticket", { ticket_id: "DEMO-1" });
    expect(result.isError).toBe(false);
    expect(result.json).toEqual({
      id: "DEMO-1",
      title: "Let members cancel a booking",
      body: "Body of the ticket.",
      source: "markdown",
    });
    expect(count(db, "tickets")).toBe(1);
    await call("get_ticket", { ticket_id: "DEMO-1" });
    expect(count(db, "tickets")).toBe(1);
  });

  it("get_ticket rejects unknown and malformed ids", async () => {
    const unknown = await call("get_ticket", { ticket_id: "DEMO-9" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("Available: DEMO-1");

    for (const args of [{ ticket_id: "../secrets" }, { ticket_id: "" }, { ticket_id: 7 }, {}]) {
      expect((await call("get_ticket", args)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(count(db, "tickets")).toBe(0);
  });

  it("save_assumptions saves the list with both tags (BE-5 contract)", async () => {
    await call("get_ticket", { ticket_id: "DEMO-1" });
    const result = await call("save_assumptions", {
      ticket_id: "DEMO-1",
      assumptions: [
        assumption({ status: "answered_by_po", answer: "Allow it without a refund" }),
        assumption({ text: "Who is notified?" }),
        assumption({ text: "Does the rule apply to admins?" }),
      ],
    });
    expect(result.isError).toBe(false);
    expect(result.json).toMatchObject({ ticket_id: "DEMO-1", saved: 3, answered_by_po: 1, assumed_by_dev: 2 });
    expect(result.json.assumption_ids).toHaveLength(3);
    expect(count(db, "assumptions")).toBe(3);
  });

  it("save_assumptions accepts an empty list for a ticket with no forks", async () => {
    await call("get_ticket", { ticket_id: "DEMO-1" });
    const result = await call("save_assumptions", { ticket_id: "DEMO-1", assumptions: [] });
    expect(result.isError).toBe(false);
    expect(result.json.saved).toBe(0);
  });

  it("save_assumptions rejects bad input and saves nothing", async () => {
    await call("get_ticket", { ticket_id: "DEMO-1" });
    const bad: Array<Record<string, unknown>> = [
      { ticket_id: "DEMO-1", assumptions: [assumption({ status: "maybe" })] },
      { ticket_id: "DEMO-1", assumptions: [assumption({ readings: ["only one reading"] })] },
      { ticket_id: "DEMO-1", assumptions: [assumption({ answer: "   " })] },
      { ticket_id: "DEMO-1", assumptions: [assumption({ text: undefined })] },
      { ticket_id: "DEMO-1", assumptions: "not a list" },
      { ticket_id: "DEMO-1" },
      { ticket_id: "NEVER-FETCHED", assumptions: [assumption()] },
    ];
    for (const args of bad) {
      expect((await call("save_assumptions", args)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(count(db, "assumptions")).toBe(0);
  });

  it("runs the whole path: decision, explain-back, observation, growth plan", async () => {
    await call("get_ticket", { ticket_id: "DEMO-1" });
    const decision = await call("log_decision", {
      ticket_id: "DEMO-1",
      summary: "Keep cancelled bookings and mark them.",
      alternatives: ["Delete the record."],
      origin: "ai",
      pointer: { file_path: "src/bookings.ts", line_hint: 88 },
    });
    expect(decision.isError).toBe(false);
    expect(decision.json.session_id).toBe("sess-test");
    expect(decision.json.pointer_id).toMatch(/^ptr_/);

    const explain = await call("record_explain_back", {
      decision_id: decision.json.decision_id,
      question: "Why keep the record?",
      answer: "The usage report still needs it.",
      rating: "not_yet",
    });
    expect(explain.isError).toBe(false);

    const observation = await call("save_observation", {
      skill_tag: "data-modelling",
      summary: "Considers reporting when changing a record's lifecycle.",
      evidence_ids: [decision.json.decision_id, explain.json.explain_back_id],
    });
    expect(observation.isError).toBe(false);
    expect(db.prepare("SELECT developer_id FROM observations").get()?.developer_id).toBe("dev-1");

    const plan = await call("save_growth_plan", {
      focus_areas: [
        {
          claim: "Thinks about downstream readers of a record.",
          evidence_ids: [observation.json.observation_id],
          exercise: "List every reader of Booking before the next schema change.",
        },
      ],
    });
    expect(plan.isError).toBe(false);
    expect(plan.json.focus_areas).toEqual([
      { claim: "Thinks about downstream readers of a record.", evidence: 1, tentative: true },
    ]);
  });

  it("rejects bad input on the remaining tools", async () => {
    await call("get_ticket", { ticket_id: "DEMO-1" });
    const decision = await call("log_decision", { ticket_id: "DEMO-1", summary: "x", origin: "dev" });
    expect(decision.isError).toBe(false);
    const id = decision.json.decision_id;

    const bad: Array<[string, Record<string, unknown>]> = [
      ["log_decision", { ticket_id: "DEMO-1", summary: "x", origin: "robot" }],
      ["log_decision", { ticket_id: "DEMO-1", origin: "ai" }],
      ["log_decision", { ticket_id: "DEMO-1", summary: "x", origin: "ai", pointer: { line_hint: 3 } }],
      ["log_decision", { ticket_id: "DEMO-1", summary: "x", origin: "ai", pointer: { file_path: "a.ts", line_hint: -1 } }],
      ["log_decision", { ticket_id: "DEMO-1", summary: "x", origin: "ai", pointer: { file_path: "a.ts", repo: "not a repo" } }],
      ["log_decision", { ticket_id: "NOPE-1", summary: "x", origin: "ai" }],
      ["record_explain_back", { decision_id: id, question: "q", answer: "a", rating: "great" }],
      ["record_explain_back", { decision_id: "dec_missing", question: "q", answer: "a", rating: "clear" }],
      ["save_observation", { skill_tag: "t", summary: "s", evidence_ids: [] }],
      ["save_observation", { skill_tag: "t", summary: "s", evidence_ids: ["dec_missing"] }],
      ["save_growth_plan", { focus_areas: [] }],
      ["save_growth_plan", { focus_areas: [{ claim: "c", evidence_ids: [], exercise: "e" }] }],
      ["save_growth_plan", { focus_areas: [{ claim: "c", evidence_ids: ["obs_missing"], exercise: "e" }] }],
      [
        "save_growth_plan",
        { focus_areas: Array.from({ length: 4 }, () => ({ claim: "c", evidence_ids: ["obs_x"], exercise: "e" })) },
      ],
    ];
    for (const [tool, args] of bad) {
      expect((await call(tool, args)).isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
    }
    expect(count(db, "decisions")).toBe(1);
    expect(count(db, "explain_backs")).toBe(0);
    expect(count(db, "observations")).toBe(0);
    expect(count(db, "growth_plans")).toBe(0);
  });

  it("reports a privacy rejection as a readable tool error", async () => {
    await call("get_ticket", { ticket_id: "DEMO-1" });
    guard.reject = true;
    const result = await call("save_assumptions", { ticket_id: "DEMO-1", assumptions: [assumption()] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Rejected by the privacy guard");
    expect(count(db, "assumptions")).toBe(0);
  });
});
