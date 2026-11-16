/**
 * pnpm smoke — drive the bundled MCP server over stdio, the way Claude Code
 * does, with a sample ticket and a throwaway database.
 *
 * It calls all six tools, checks that bad input is rejected, and exits
 * non-zero if anything is off.
 *
 *   --db <path>   Keep the database at this path (default: a temp file)
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOL_NAMES } from "@ftc/shared";
import { flag, PLUGIN_BUNDLE, REPO_ROOT } from "./shared";

const FIXTURES = resolve(REPO_ROOT, "packages/server/fixtures");

interface ToolOutcome {
  isError: boolean;
  text: string;
  json: Record<string, unknown> | null;
}

let failures = 0;
function check(label: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!pass) failures += 1;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content.map((part) => part.text ?? "").join("\n");
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // not JSON: an error message
    }
    return { isError: result.isError === true, text, json };
  } catch (error) {
    // Older SDKs report invalid input as a protocol error instead of a tool error.
    return { isError: true, text: error instanceof Error ? error.message : String(error), json: null };
  }
}

if (!existsSync(PLUGIN_BUNDLE)) {
  console.error(`Missing ${PLUGIN_BUNDLE}. Run: pnpm plugin:bundle`);
  process.exit(1);
}

const dbPath = flag("db") ?? join(await mkdtemp(join(tmpdir(), "ftc-smoke-")), "ftc.sqlite");
const sample = JSON.parse(await readFile(join(FIXTURES, "sample-fork-run.json"), "utf8")) as {
  ticket_id: string;
  assumptions: unknown[];
};

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) env[key] = value;
}
Object.assign(env, {
  FTC_DB_PATH: dbPath,
  FTC_TICKETS_DIR: join(FIXTURES, "tickets"),
  FTC_DEVELOPER_ID: "sample-dev",
});

const client = new Client({ name: "ftc-smoke", version: "0.1.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["--disable-warning=ExperimentalWarning", PLUGIN_BUNDLE],
    env,
    stderr: "inherit",
  }),
);

console.log(`\nbundle:   ${PLUGIN_BUNDLE}`);
console.log(`database: ${dbPath}\n`);

const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
check("lists the six tools", JSON.stringify(tools) === JSON.stringify([...TOOL_NAMES].sort()), tools.join(", "));

// --- Fork ------------------------------------------------------------------
const ticket = await call(client, "get_ticket", { ticket_id: sample.ticket_id });
check("get_ticket returns the ticket", !ticket.isError && ticket.json?.id === sample.ticket_id);

const missing = await call(client, "get_ticket", { ticket_id: "NOPE-404" });
check("get_ticket rejects an unknown ticket", missing.isError, missing.text.split("\n")[0]);

const traversal = await call(client, "get_ticket", { ticket_id: "../../etc/passwd" });
check("get_ticket rejects a path as an id", traversal.isError);

const saved = await call(client, "save_assumptions", sample);
check(
  "save_assumptions saves the list with both tags",
  !saved.isError && saved.json?.saved === sample.assumptions.length,
  `answered_by_po=${String(saved.json?.answered_by_po)}, assumed_by_dev=${String(saved.json?.assumed_by_dev)}`,
);

const badStatus = await call(client, "save_assumptions", {
  ticket_id: sample.ticket_id,
  assumptions: [{ text: "Q?", readings: ["a", "b"], status: "maybe", answer: "x" }],
});
check("save_assumptions rejects an unknown status", badStatus.isError);

const oneReading = await call(client, "save_assumptions", {
  ticket_id: sample.ticket_id,
  assumptions: [{ text: "Q?", readings: ["only one"], status: "assumed_by_dev", answer: "x" }],
});
check("save_assumptions rejects a question with a single reading", oneReading.isError);

const noTicket = await call(client, "save_assumptions", { ticket_id: "NEVER-FETCHED", assumptions: [] });
check("save_assumptions rejects a ticket that was never fetched", noTicket.isError);

// --- Paper Trail, explain-back, observations, coach ---------------------------
const decision = await call(client, "log_decision", {
  ticket_id: sample.ticket_id,
  summary: "Stream the CSV row by row instead of building it in memory.",
  alternatives: ["Build the whole file in memory, then send it."],
  origin: "dev_changed_ai",
  pointer: { file_path: "src/invoices/export.ts", line_hint: 42, symbol: "streamInvoicesCsv" },
});
check("log_decision saves a decision with a pointer", !decision.isError && Boolean(decision.json?.pointer_id));

const badOrigin = await call(client, "log_decision", {
  ticket_id: sample.ticket_id,
  summary: "x",
  origin: "robot",
});
check("log_decision rejects an unknown origin", badOrigin.isError);

const decisionId = String(decision.json?.decision_id);
const explain = await call(client, "record_explain_back", {
  decision_id: decisionId,
  question: "Why stream the file instead of building it first?",
  answer: "Memory stays flat however many invoices match the filter.",
  rating: "clear",
});
check("record_explain_back links to its decision", !explain.isError && explain.json?.decision_id === decisionId);

const orphan = await call(client, "record_explain_back", {
  decision_id: "dec_missing",
  question: "q",
  answer: "a",
  rating: "clear",
});
check("record_explain_back rejects an unknown decision", orphan.isError);

const observation = await call(client, "save_observation", {
  skill_tag: "resource-use",
  summary: "Chooses streaming when the size of the result is not bounded.",
  evidence_ids: [decisionId, String(explain.json?.explain_back_id)],
});
check("save_observation saves with evidence", !observation.isError);

const noEvidence = await call(client, "save_observation", {
  skill_tag: "x",
  summary: "No evidence.",
  evidence_ids: [],
});
check("save_observation rejects an observation without evidence", noEvidence.isError);

const plan = await call(client, "save_growth_plan", {
  focus_areas: [
    {
      claim: "Reasons well about memory use on unbounded results.",
      evidence_ids: [String(observation.json?.observation_id)],
      exercise: "Add a test that exports 100,000 rows and asserts on peak memory.",
    },
  ],
});
const areas = (plan.json?.focus_areas ?? []) as Array<{ tentative: boolean }>;
check(
  "save_growth_plan marks a single-observation claim tentative",
  !plan.isError && areas[0]?.tentative === true,
);

const unsupported = await call(client, "save_growth_plan", {
  focus_areas: [{ claim: "Unsupported claim.", evidence_ids: ["obs_missing"], exercise: "x" }],
});
check("save_growth_plan rejects a claim whose evidence does not exist", unsupported.isError);

const empty = await call(client, "save_growth_plan", {
  focus_areas: [{ claim: "No evidence at all.", evidence_ids: [], exercise: "x" }],
});
check("save_growth_plan rejects a claim without evidence", empty.isError);

await client.close();

console.log(failures === 0 ? "\nsmoke test passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
