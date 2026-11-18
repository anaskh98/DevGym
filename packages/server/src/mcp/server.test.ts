import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { defaultTicketsDir } from "../db/seed.js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivacyGuard } from "../privacy/guard.js";
import { recordFileEdit } from "../store.js";
import { MarkdownTicketAdapter } from "../tickets/markdown.js";
import { latestGrowthPlan } from "../api/data.js";
import { saveAiLines } from "../coach/attribution.js";
import { saveMessage } from "../coach/messages.js";
import { repoIdentitySync } from "../git/identity.js";
import { createServer } from "./server.js";

let db: Db;
let client: Client;
let repo: string;
let opened: string[];

// No seed here: tickets must reach the database through the adapter.
beforeEach(async () => {
  db = openDb(":memory:");
  migrate(db);
  for (const session of ["s1", "s2"]) saveMessage(db, session, "Please do it, the developer asked for this exact approach for it");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  // A fixed denylist and a small temp repo: tests must not read the developer's real list or this repo.
  repo = mkdtempSync(join(tmpdir(), "ftc-server-"));
  writeFileSync(join(repo, "export.ts"), "export const pageSize = Math.min(requested ?? 500, 5000);\n");
  writeFileSync(join(repo, "GLOBEX-1.md"), "---\nid: GLOBEX-1\ntitle: Export for the Globex tenant\n---\nBody");
  const guard = new PrivacyGuard({ root: repo, denylist: () => ["Globex"] });
  const tickets = new MarkdownTicketAdapter([defaultTicketsDir(), repo]);
  opened = [];
  await createServer(db, tickets, { root: repo, guard, coachHome: repo, report: { port: 0, openUrl: (url) => opened.push(url) } }).connect(serverSide);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
});
afterEach(async () => {
  await client.close();
  db.close();
  rmSync(repo, { recursive: true, force: true });
});

type Outcome = { ok: true; data: any } | { ok: false; error: string };

/** Calls a tool. Bad input may come back as an error result or a protocol error: both count as rejected. */
async function call(name: string, args: Record<string, unknown>): Promise<Outcome> {
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    return result.isError ? { ok: false, error: text } : { ok: true, data: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function ok(name: string, args: Record<string, unknown>): Promise<any> {
  const out = await call(name, args);
  if (!out.ok) throw new Error(`${name} failed: ${out.error}`);
  return out.data;
}

async function rejected(name: string, args: Record<string, unknown>): Promise<string> {
  const out = await call(name, args);
  if (out.ok) throw new Error(`${name} accepted bad input: ${JSON.stringify(args)}`);
  return out.error;
}

const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

const decision = (extra: Record<string, unknown> = {}) => ({
  ticket_id: "SAMPLE-1",
  session_id: "s1",
  summary: "Export as CSV, streamed in pages",
  origin: "ai",
  ...extra,
});

describe("tool list", () => {
  it("offers exactly the expected tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ask_question",
      "coach_history",
      "coach_item",
      "coach_status",
      "disagree",
      "drill_key",
      "get_ticket",
      "get_trail",
      "import_ticket",
      "list_decisions",
      "list_observations",
      "log_decision",
      "open_report",
      "propose_evidence",
      "rate_answer",
      "record_explain_back",
      "release_answer",
      "resolve_pointers",
      "save_assumptions",
      "save_growth_plan",
      "save_observation",
      "save_stack_note",
      "score_drill",
      "set_coach_tracks",
      "start_drill",
      "start_trail",
      "update_pr_decisions",
    ]);
  });
});

describe("privacy guard on every write tool", () => {
  const CODE = "const rows = orders.filter(isRecent)";
  const TABLES = ["assumptions", "decisions", "pointers", "explain_backs", "observations", "growth_plans", "trail_sessions"];
  const totalRows = () => TABLES.reduce((sum, t) => sum + count(t), 0);

  it("rejects code, client names and repo copies in each tool, with a reason, and saves nothing", async () => {
    const { decision_id } = await ok("log_decision", decision());
    const { observation_id } = await ok("save_observation", { skill_tag: "t", summary: "s", evidence_ids: [decision_id] });
    const before = totalRows();

    const attempts: [string, Record<string, unknown>, RegExp][] = [
      ["save_assumptions", { ticket_id: "SAMPLE-1", assumptions: [{ text: CODE, status: "assumed_by_dev" }] }, /looks like code/],
      ["save_assumptions", { ticket_id: "SAMPLE-1", assumptions: [{ text: "Format?", status: "answered_by_po", answer: "As Globex wants" }] }, /client denylist/],
      ["log_decision", decision({ summary: CODE }), /'summary' looks like code/],
      ["log_decision", decision({ alternatives: ["fine", CODE] }), /'alternatives\[1\]' looks like code/],
      ["log_decision", decision({ summary: "The limit is Math.min(requested ?? 500, 5000) for one page" }), /copies code from this repository/],
      ["log_decision", decision({ pointer: { repo: "team/demo", file_path: "src/globex/export.ts" } }), /'pointer.file_path'.*client denylist/],
      ["log_decision", decision({ summary: "Upload with password=Hunter2secret" }), /secret or credential/],
      ["record_explain_back", { decision_id, question: "Why?", answer: CODE, rating: "clear" }, /'answer' looks like code/],
      ["save_observation", { skill_tag: "t", summary: "Knows the Globex setup well", evidence_ids: [decision_id] }, /client denylist/],
      ["save_growth_plan", { focus_areas: [{ claim: "c", evidence_ids: [observation_id], exercise: CODE }] }, /'focus_areas\[0\].exercise' looks like code/],
      ["start_trail", { ticket_id: "SAMPLE-1", session_id: "globex-session" }, /client denylist/],
    ];
    for (const [tool, args, reason] of attempts) {
      const error = await rejected(tool, args);
      expect(error, `${tool} ${JSON.stringify(args)}`).toMatch(reason);
      expect(error).toMatch(/privacy guard/);
    }
    expect(totalRows()).toBe(before);
  });

  it("does not store a ticket that names a client", async () => {
    expect(await rejected("get_ticket", { ticket_id: "GLOBEX-1" })).toMatch(/client denylist/);
    expect(await rejected("log_decision", decision({ ticket_id: "GLOBEX-1" }))).toMatch(/client denylist/);
    expect(count("tickets")).toBe(0);
  });
});

describe("open_report", () => {
  it("starts the local server, opens the browser once per call, and the report page answers", async () => {
    const first = await ok("open_report", {});
    expect(first).toMatchObject({ started: true, opened: true });
    expect(opened).toEqual([first.url]);
    const page = await fetch(first.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Coach report");

    const second = await ok("open_report", { open_browser: false });
    expect(second).toEqual({ url: first.url, started: false, opened: false });
    expect(opened).toHaveLength(1);
    await rejected("open_report", { open_browser: "yes" });
  });
});

describe("paper trail", () => {
  const edit = (file: string) => recordFileEdit(db, "s1", file);

  it("start_trail returns the ticket and its assumptions, and can be called twice", async () => {
    await ok("save_assumptions", { ticket_id: "SAMPLE-1", assumptions: [{ text: "Format?", status: "assumed_by_dev", answer: "Assuming: CSV" }] });
    const out = await ok("start_trail", { ticket_id: "SAMPLE-1", session_id: "s1" });
    expect(out.ticket.id).toBe("SAMPLE-1");
    expect(out.assumptions).toMatchObject([{ text: "Format?", status: "assumed_by_dev", answer: "Assuming: CSV" }]);
    await ok("start_trail", { ticket_id: "SAMPLE-1", session_id: "s1" });
    expect(count("trail_sessions")).toBe(1);
    await rejected("start_trail", { ticket_id: "NOPE", session_id: "s2" });
    await rejected("start_trail", { ticket_id: "SAMPLE-1" });
  });

  it("records edits only for a tracked session", async () => {
    expect(edit("src/a.ts")).toEqual({ tracked: false, first: false });
    expect(count("file_edits")).toBe(0);
    await ok("start_trail", { ticket_id: "SAMPLE-1", session_id: "s1" });
    expect(edit("src/a.ts")).toEqual({ tracked: true, first: true });
    expect(edit("src/a.ts")).toEqual({ tracked: true, first: false });
    expect(db.prepare("SELECT file_path, edit_count FROM file_edits").all()).toEqual([{ file_path: "src/a.ts", edit_count: 2 }]);
  });

  it("flags edited files that no decision points at as unexplained", async () => {
    await ok("start_trail", { ticket_id: "SAMPLE-1", session_id: "s1" });
    for (const f of ["src/export.ts", "src/export.test.ts", "src/routes.ts", "README.md"]) edit(f);
    await ok(
      "log_decision",
      decision({
        pointer: { repo: "acme/demo", file_path: "src\\Export.ts", symbol: "exportOrders" },
        related_files: ["./src/export.test.ts"],
      }),
    );
    // A decision from another session must not explain this session's files.
    await ok("log_decision", decision({ session_id: "other", pointer: { repo: "acme/demo", file_path: "README.md" } }));

    const trail = await ok("get_trail", { session_id: "s1" });
    expect(trail.tracking).toBe(true);
    expect(trail.ticket_id).toBe("SAMPLE-1");
    expect(trail.decisions).toHaveLength(1);
    expect(trail.decisions[0]).toMatchObject({ origin: "ai", file_path: "src/Export.ts", symbol: "exportOrders", related_files: ["src/export.test.ts"] });
    expect(trail.unexplained_files).toEqual(["src/routes.ts", "README.md"]);
    expect(trail.edited_files.map((f: { explained: boolean }) => f.explained)).toEqual([true, true, false, false]);
  });

  it("reports an untracked session as not tracking", async () => {
    const trail = await ok("get_trail", { session_id: "never-started" });
    expect(trail).toMatchObject({ tracking: false, ticket_id: null, decisions: [], unexplained_files: [] });
  });

  it("rejects bad related_files", async () => {
    await rejected("log_decision", decision({ related_files: "src/a.ts" }));
    await rejected("log_decision", decision({ related_files: [""] }));
  });
});

describe("get_ticket", () => {
  it("returns the demo ticket from Markdown and keeps a local copy", async () => {
    expect(count("tickets")).toBe(0);
    const ticket = await ok("get_ticket", { ticket_id: "SAMPLE-1" });
    expect(ticket.title).toBe("Let customers export their order history");
    expect(ticket.source).toBe("markdown");
    expect(count("tickets")).toBe(1);
  });

  it("still returns a saved ticket when the source no longer has it", async () => {
    db.prepare("INSERT INTO tickets (id, title, body, source) VALUES ('OLD-1', 'Old', 'b', 'jira')").run();
    expect((await ok("get_ticket", { ticket_id: "OLD-1" })).source).toBe("jira");
  });

  it("lets the save tools work without calling get_ticket first", async () => {
    await ok("log_decision", decision());
    await ok("save_assumptions", { ticket_id: "SAMPLE-1", assumptions: [{ text: "x", status: "assumed_by_dev" }] });
    expect(count("tickets")).toBe(1);
  });

  it("rejects an unknown ticket and bad input", async () => {
    expect(await rejected("get_ticket", { ticket_id: "NOPE" })).toMatch(/does not exist/);
    await rejected("get_ticket", {});
    await rejected("get_ticket", { ticket_id: 5 });
    await rejected("get_ticket", { ticket_id: "SAMPLE-1", extra: true });
  });
});

describe("import_ticket", () => {
  const jira = (extra: Record<string, unknown> = {}) => ({
    ticket_id: "PROJ-42",
    title: "Let admins archive old rooms",
    // Ticket text may describe code: it is source material, not something the developer wrote.
    body: "Archived rooms are hidden from search.\n\n```ts\nconst rows = rooms.filter(isArchived)\n```",
    source: "jira",
    ...extra,
  });

  it("saves a Jira ticket that the other tools can then use", async () => {
    const saved = await ok("import_ticket", jira());
    expect(saved).toMatchObject({ id: "PROJ-42", title: "Let admins archive old rooms", source: "jira" });
    expect((await ok("get_ticket", { ticket_id: "PROJ-42" })).source).toBe("jira");
    await ok("save_assumptions", { ticket_id: "PROJ-42", assumptions: [{ text: "Can archived rooms be restored?", status: "assumed_by_dev", answer: "Assuming: yes" }] });
    await ok("log_decision", decision({ ticket_id: "PROJ-42" }));
    expect(count("assumptions")).toBe(1);
  });

  it("replaces the saved copy when imported again, and accepts an empty description", async () => {
    await ok("import_ticket", jira());
    await ok("import_ticket", jira({ title: "Archive rooms", body: "" }));
    expect(await ok("get_ticket", { ticket_id: "PROJ-42" })).toMatchObject({ title: "Archive rooms", body: "" });
    expect(count("tickets")).toBe(1);
  });

  it("refuses an id that the plugin's own tickets already use", async () => {
    expect(await rejected("import_ticket", jira({ ticket_id: "SAMPLE-1" }))).toMatch(/already exists.*get_ticket/);
    expect(count("tickets")).toBe(0);
  });

  it("does not store a ticket that names a client", async () => {
    expect(await rejected("import_ticket", jira({ title: "Archive rooms for Globex" }))).toMatch(/client denylist/);
    expect(await rejected("import_ticket", jira({ body: "Globex asked for this" }))).toMatch(/client denylist/);
    expect(count("tickets")).toBe(0);
  });

  it("rejects bad input", async () => {
    await rejected("import_ticket", jira({ source: "trello" }));
    await rejected("import_ticket", jira({ title: "" }));
    await rejected("import_ticket", jira({ ticket_id: "" }));
    await rejected("import_ticket", jira({ extra: true }));
    await rejected("import_ticket", { ticket_id: "PROJ-1", source: "jira" });
    expect(count("tickets")).toBe(0);
  });
});

describe("save_assumptions", () => {
  it("saves both kinds and replaces the list on a second call", async () => {
    const first = await ok("save_assumptions", {
      ticket_id: "SAMPLE-1",
      assumptions: [
        { text: "How far back is 'recent'?", status: "answered_by_po", answer: "12 months" },
        { text: "Export format is CSV", status: "assumed_by_dev" },
      ],
    });
    expect(first.assumption_ids).toHaveLength(2);
    await ok("save_assumptions", {
      ticket_id: "SAMPLE-1",
      assumptions: [{ text: "Only one left", status: "assumed_by_dev" }],
    });
    expect(db.prepare("SELECT text, status, answer FROM assumptions").all()).toEqual([
      { text: "Only one left", status: "assumed_by_dev", answer: null },
    ]);
  });

  it("rejects bad input and keeps the old list", async () => {
    await ok("save_assumptions", { ticket_id: "SAMPLE-1", assumptions: [{ text: "Keep me", status: "assumed_by_dev" }] });
    await rejected("save_assumptions", { ticket_id: "SAMPLE-1", assumptions: [] });
    await rejected("save_assumptions", { ticket_id: "SAMPLE-1", assumptions: [{ text: "x", status: "guessed" }] });
    expect(
      await rejected("save_assumptions", { ticket_id: "SAMPLE-1", assumptions: [{ text: "x", status: "answered_by_po" }] }),
    ).toMatch(/answer/);
    await rejected("save_assumptions", { ticket_id: "NOPE", assumptions: [{ text: "x", status: "assumed_by_dev" }] });
    expect(count("assumptions")).toBe(1);
  });
});

describe("log_decision", () => {
  it("saves a decision with alternatives and a pointer", async () => {
    const out = await ok(
      "log_decision",
      decision({
        alternatives: ["Build the whole file in memory"],
        origin: "dev_changed_ai",
        origin_quote: "developer asked for this exact approach",
        pointer: { repo: "acme/demo", file_path: "src/export.ts", symbol: "exportOrders", line_hint: 42 },
      }),
    );
    const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(out.decision_id) as Record<string, unknown>;
    expect(row.origin).toBe("dev_changed_ai");
    expect(JSON.parse(row.alternatives as string)).toEqual(["Build the whole file in memory"]);
    expect(row.pointer_id).toBe(out.pointer_id);
    expect(db.prepare("SELECT symbol FROM pointers WHERE id = ?").get(out.pointer_id)).toEqual({ symbol: "exportOrders" });
  });

  it("saves a decision with no pointer and no alternatives", async () => {
    const out = await ok("log_decision", decision());
    expect(out.pointer_id).toBeNull();
  });

  it("rejects bad input and writes nothing", async () => {
    await rejected("log_decision", decision({ origin: "robot" }));
    await rejected("log_decision", decision({ summary: "" }));
    await rejected("log_decision", decision({ summary: "x".repeat(501) }));
    await rejected("log_decision", decision({ alternatives: "none" }));
    await rejected("log_decision", decision({ pointer: { repo: "acme/demo" } }));
    await rejected("log_decision", decision({ pointer: { repo: "a/b", file_path: "f.ts", commit: "not-a-sha" } }));
    await rejected("log_decision", decision({ pointer: { repo: "a/b", file_path: "f.ts", code: "const x = 1" } }));
    expect(await rejected("log_decision", decision({ ticket_id: "NOPE" }))).toMatch(/does not exist/);
    expect(count("decisions")).toBe(0);
    expect(count("pointers")).toBe(0);
  });
});

describe("list_decisions", () => {
  it("lists a ticket's decisions across sessions with their explain-back counts", async () => {
    const first = await ok("log_decision", decision({ pointer: { repo: "team/demo", file_path: "src/export.ts", symbol: "exportOrders" } }));
    await ok("log_decision", decision({ session_id: "s2", summary: "Limit one export to 10,000 rows", origin: "dev", origin_quote: "developer asked for this exact approach" }));
    await ok("record_explain_back", { decision_id: first.decision_id, question: "Why?", answer: "To keep memory low", rating: "clear" });

    const out = await ok("list_decisions", { ticket_id: "SAMPLE-1" });
    expect(out.decisions).toMatchObject([
      { id: first.decision_id, session_id: "s1", origin: "ai", file_path: "src/export.ts", symbol: "exportOrders", explain_back_count: 1 },
      { session_id: "s2", origin: "dev", file_path: null, explain_back_count: 0 },
    ]);
  });

  it("returns an empty list for a ticket with no decisions, and rejects an unknown ticket", async () => {
    await ok("get_ticket", { ticket_id: "SAMPLE-1" });
    expect((await ok("list_decisions", { ticket_id: "SAMPLE-1" })).decisions).toEqual([]);
    expect(await rejected("list_decisions", { ticket_id: "NOPE" })).toMatch(/does not exist/);
  });
});

describe("record_explain_back", () => {
  it("saves an answer linked to its decision", async () => {
    const { decision_id } = await ok("log_decision", decision());
    const out = await ok("record_explain_back", {
      decision_id,
      question: "Why stream the export?",
      answer: "So a big export does not fill memory.",
      rating: "clear",
    });
    expect(db.prepare("SELECT decision_id, rating FROM explain_backs WHERE id = ?").get(out.explain_back_id)).toEqual({
      decision_id,
      rating: "clear",
    });
  });

  it("rejects an unknown decision and a bad rating", async () => {
    const { decision_id } = await ok("log_decision", decision());
    const base = { decision_id, question: "Why?", answer: "Because." };
    await rejected("record_explain_back", { ...base, rating: "great" });
    await rejected("record_explain_back", { ...base, rating: "clear", decision_id: "NOPE" });
    await rejected("record_explain_back", { decision_id, question: "Why?", rating: "clear" });
    expect(count("explain_backs")).toBe(0);
  });
});

describe("save_observation", () => {
  it("saves an observation that cites real evidence", async () => {
    const { decision_id } = await ok("log_decision", decision());
    const out = await ok("save_observation", {
      skill_tag: "streaming",
      summary: "Explained clearly why streaming avoids memory spikes.",
      evidence_ids: [decision_id],
    });
    const row = db.prepare("SELECT developer_id, evidence_ids FROM observations WHERE id = ?").get(out.observation_id);
    expect(row).toEqual({ developer_id: "local", evidence_ids: JSON.stringify([decision_id]) });
  });

  it("rejects missing or made-up evidence and a bad tag", async () => {
    const { decision_id } = await ok("log_decision", decision());
    const base = { skill_tag: "streaming", summary: "x" };
    await rejected("save_observation", { ...base, evidence_ids: [] });
    await rejected("save_observation", base);
    expect(await rejected("save_observation", { ...base, evidence_ids: ["made-up"] })).toMatch(/not a known/);
    await rejected("save_observation", { ...base, skill_tag: "Has Spaces", evidence_ids: [decision_id] });
    expect(count("observations")).toBe(0);
  });
});

describe("list_observations", () => {
  it("lists observations with what each piece of evidence is", async () => {
    const { decision_id } = await ok("log_decision", decision({ origin: "dev_changed_ai", origin_quote: "developer asked for this exact approach" }));
    const { explain_back_id } = await ok("record_explain_back", { decision_id, question: "Why?", answer: "Not sure", rating: "partial" });
    const { observation_id } = await ok("save_observation", {
      skill_tag: "performance",
      summary: "Knew paging helps memory, not why the limit exists.",
      evidence_ids: [decision_id, explain_back_id],
    });
    await ok("save_observation", { developer_id: "someone-else", skill_tag: "x", summary: "s", evidence_ids: [decision_id] });

    const out = await ok("list_observations", {});
    expect(out.developer_id).toBe("local");
    expect(out.observations).toMatchObject([
      {
        id: observation_id,
        skill_tag: "performance",
        evidence: [
          { id: decision_id, kind: "decision", ticket_id: "SAMPLE-1", origin: "dev_changed_ai" },
          { id: explain_back_id, kind: "explain_back", ticket_id: "SAMPLE-1", rating: "partial" },
        ],
      },
    ]);
    expect((await ok("list_observations", { developer_id: "nobody" })).observations).toEqual([]);
  });
});

describe("save_growth_plan", () => {
  async function observation(tag: string): Promise<string> {
    const { decision_id } = await ok("log_decision", decision());
    const out = await ok("save_observation", { skill_tag: tag, summary: "s", evidence_ids: [decision_id] });
    return out.observation_id;
  }
  const area = (evidence_ids: string[]) => ({ claim: "Could explain trade-offs more", evidence_ids, exercise: "Write two alternatives before coding" });

  it("marks a claim with one observation as tentative, and with two as not", async () => {
    const a = await observation("a");
    const b = await observation("b");
    const out = await ok("save_growth_plan", { focus_areas: [area([a]), area([a, b]), area([b, b])] });
    expect(out.focus_areas.map((f: { tentative: boolean }) => f.tentative)).toEqual([true, false, true]);
    const row = db.prepare("SELECT focus_areas FROM growth_plans WHERE id = ?").get(out.growth_plan_id) as { focus_areas: string };
    expect(JSON.parse(row.focus_areas)).toEqual(out.focus_areas);
  });

  it("does not let the caller set 'tentative'", async () => {
    const a = await observation("a");
    await rejected("save_growth_plan", { focus_areas: [{ ...area([a]), tentative: false }] });
  });

  it("rejects claims without real evidence and more than three areas", async () => {
    const a = await observation("a");
    await rejected("save_growth_plan", { focus_areas: [] });
    await rejected("save_growth_plan", { focus_areas: [area([])] });
    expect(await rejected("save_growth_plan", { focus_areas: [area(["made-up"])] })).toMatch(/not an observation/);
    await rejected("save_growth_plan", { focus_areas: [area([a]), area([a]), area([a]), area([a])] });
    expect(await rejected("save_growth_plan", { developer_id: "someone-else", focus_areas: [area([a])] })).toMatch(
      /not an observation/,
    );
    expect(count("growth_plans")).toBe(0);
  });
});

describe("coach tools", () => {
  const evidence = (id: string, itemId = "BE.ERR.M2") =>
    db
      .prepare(
        "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, signal_id, file_path, symbol, at) VALUES (?, 'builtin/backend', ?, 'rule', 'positive', 'dev', 'T-1', 'err.timeout-set', 'src/pay.ts', 'charge', ?)",
      )
      .run(id, itemId, new Date(Date.now() - 86_400_000).toISOString());

  it("sets tracks and reports them in the status", async () => {
    await ok("set_coach_tracks", { tracks: ["backend"] });
    const status = await ok("coach_status", {});
    expect(status.tracks).toEqual(["backend"]);
  });

  it("lowers an item when the developer disagrees with its evidence", async () => {
    const id = randomUUID();
    evidence(id);
    expect((await ok("coach_item", { item_id: "BE.ERR.M2" })).status.proofs).toBe(1);
    const out = await ok("disagree", { target_id: id, reason: "That timeout was copied from the old service" });
    expect(out.target).toBe("evidence");
    expect((await ok("coach_item", { item_id: "BE.ERR.M2" })).status.proofs).toBe(0);
  });

  it("does not let an answer be disagreed away", async () => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO pending_questions (id, kind, ladder_id, item_id, ticket, answer, answered_at, rating) VALUES (?, 'why', 'builtin/backend', 'BE.ERR.M2', 'T-1', 'a', '2026-11-10T10:00:00Z', 'not_yet')",
    ).run(id);
    expect(await rejected("disagree", { target_id: id, reason: "I did know the answer really" })).toMatch(/ask for a new question/);
  });

  it("checks the item id on log_decision", async () => {
    expect(await rejected("log_decision", decision({ item_id: "BE.NOPE.M1" }))).toMatch(/Unknown ladder item/);
    const { decision_id } = await ok("log_decision", decision({ item_id: "BE.ERR.M2" }));
    expect(db.prepare("SELECT ladder_id, item_id FROM decisions WHERE id = ?").get(decision_id)).toEqual({ ladder_id: "builtin/backend", item_id: "BE.ERR.M2" });
  });

  it("rejects proposed evidence for lines the commit did not add", async () => {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    git(["init", "-q"]);
    git(["config", "user.email", "dev@example.com"]);
    git(["config", "user.name", "Dev"]);
    git(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(repo, "pay.ts"), "export function charge() {\n  return 1;\n}\n");
    git(["add", "pay.ts"]);
    git(["commit", "-q", "-m", "PAY-1 charge"]);
    const sha = git(["rev-parse", "HEAD"]);
    const base = { item_id: "BE.ERR.S1", commit: sha, file: "pay.ts", why: "Shows a design for partial failure" };
    expect(await rejected("propose_evidence", { ...base, line_start: 50, line_end: 60 })).toMatch(/were not added/);
    const out = await ok("propose_evidence", { ...base, line_start: 1, line_end: 3 });
    expect(db.prepare("SELECT kind, author, symbol, ticket FROM skill_evidence WHERE id = ?").get(out.evidence_id)).toEqual({ kind: "judge", author: "dev", symbol: "charge", ticket: "PAY-1" });
  });
});

describe("personal growth plans", () => {
  const proof = (itemId = "BE.ERR.M2") => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, signal_id, file_path, symbol, at) VALUES (?, 'builtin/backend', ?, 'rule', 'positive', 'dev', 'T-1', 'err.timeout-set', 'api/pay.ts', 'charge', '2026-11-10T10:00:00Z')",
    ).run(id, itemId);
    return id;
  };
  const area = (evidence: string[], exercise: string) => ({
    claim: "One call to the provider had a time limit; the retry rule is not clear yet.",
    evidence_ids: evidence,
    exercise,
    item_id: "BE.ERR.M2",
    spot: { file: "api/pay.ts", symbol: "charge" },
    stack: "express",
    exercise_kind: "implement",
  });

  it("refuses an exercise that does not name the spot file", async () => {
    expect(await rejected("save_growth_plan", { focus_areas: [area([proof()], "Study how timeouts work.")] })).toMatch(/pay\.ts/);
  });

  it("refuses evidence of another item", async () => {
    expect(await rejected("save_growth_plan", { focus_areas: [area([proof("BE.ERR.M3")], "In pay.ts, decide when to retry.")] })).toMatch(/not evidence for BE\.ERR\.M2/);
  });

  it("saves a personal plan item and returns it from the report data", async () => {
    await ok("save_growth_plan", { focus_areas: [area([proof()], "In pay.ts, decide when charge may retry and write it down.")] });
    const plan = latestGrowthPlan(db)!;
    expect(plan.focus_areas[0]).toMatchObject({ item_id: "BE.ERR.M2", spot: { file: "api/pay.ts", symbol: "charge" }, stack: "express" });
  });

  it("saves a stack note only for a stack the ladder lacks", async () => {
    expect(await rejected("save_stack_note", { item_id: "BE.ERR.M2", stack_id: "express", note: "Use AbortSignal.timeout.", link: "https://nodejs.org" })).toMatch(/already has a note/);
    expect((await ok("save_stack_note", { item_id: "BE.ERR.M2", stack_id: "fastify", note: "Set a request timeout on the client.", link: "https://fastify.dev/docs/latest/" })).saved).toBe(true);
  });
});

describe("start_drill reads new commits first", () => {
  it("unlocks a failed drill when a new proof was just committed", async () => {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    git(["init", "-q"]);
    git(["config", "user.email", "dev@example.com"]);
    git(["config", "user.name", "Dev"]);
    git(["config", "commit.gpgsign", "false"]);
    const top = repoIdentitySync(repo)!.key;
    db.prepare("INSERT INTO ai_line_hashes (repo_root, file_path, hash, session_id, created_at) VALUES (?, 'x', 'seed', 's0', datetime('now', '-1 day'))").run(top);
    await ok("set_coach_tracks", { tracks: ["backend"] });
    // Shown: 3 proofs on 2 tickets and 2 clear answers, then a failed drill just now.
    const proof = db.prepare(
      "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, signal_id, file_path, symbol, at) VALUES (?, 'builtin/backend', 'BE.ERR.M2', 'rule', 'positive', 'dev', ?, 'err.timeout-set', 'a.ts', ?, ?)",
    );
    const earlier = new Date(Date.now() - 3_600_000).toISOString();
    proof.run(randomUUID(), "T-1", "a", earlier);
    proof.run(randomUUID(), "T-1", "b", earlier);
    proof.run(randomUUID(), "T-2", "c", earlier);
    const answer = db.prepare(
      "INSERT INTO pending_questions (id, kind, ladder_id, item_id, ticket, answer, answered_at, closed_reason, rating, names_tradeoff) VALUES (?, 'why', 'builtin/backend', 'BE.ERR.M2', ?, 'a', ?, 'answered', 'clear', ?)",
    );
    answer.run(randomUUID(), "T-1", earlier, 1);
    answer.run(randomUUID(), "T-2", earlier, 0);
    const q = randomUUID();
    const failedAt = new Date(Date.now() - 60_000).toISOString();
    db.prepare("INSERT INTO pending_questions (id, kind, ladder_id, item_id, target_ref, ticket, answer, answered_at, closed_reason) VALUES (?, 'drill', 'builtin/backend', 'BE.ERR.M2', 'drill:d1', 'drill', 'x', ?, 'answered')").run(q, failedAt);
    db.prepare("INSERT INTO drill_attempts (id, ladder_id, item_id, drill_id, question_id, passed, created_at) VALUES (?, 'builtin/backend', 'BE.ERR.M2', 'd1', ?, 0, ?)").run(randomUUID(), q, failedAt);
    expect(await rejected("start_drill", { item_id: "BE.ERR.M2", session_id: "s1" })).toMatch(/new code proof/);

    writeFileSync(join(repo, "quote.ts"), "export async function quote(url: string) {\n  return fetch(url, { signal: AbortSignal.timeout(3000) });\n}\n");
    git(["add", "quote.ts"]);
    git(["commit", "-q", "-m", "PAY-3 time limit on quote"]);
    const started = await ok("start_drill", { item_id: "BE.ERR.M2", session_id: "s1" });
    expect(started.drill_id).toBe("d2");
  });
});

describe("review fixes: proposed evidence must be the developer's lines", () => {
  it("refuses a range where Claude wrote some of the lines", async () => {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    git(["init", "-q"]);
    git(["config", "user.email", "dev@example.com"]);
    git(["config", "user.name", "Dev"]);
    git(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(repo, "pay.ts"), "export function charge() {\n  return compensateLater();\n}\n");
    git(["add", "pay.ts"]);
    git(["commit", "-q", "-m", "PAY-1 charge"]);
    const sha = git(["rev-parse", "HEAD"]);
    saveAiLines(db, repoIdentitySync(repo)!.key, "pay.ts", "s1", ["  return compensateLater();"]);
    const out = await rejected("propose_evidence", { item_id: "BE.ERR.S1", commit: sha, file: "pay.ts", line_start: 1, line_end: 3, why: "Shows a design for partial failure" });
    expect(out).toMatch(/Claude wrote/);
  });
});

describe("stage 2: decision origin must be quoted", () => {
  it("keeps origin dev only when the quote is in a developer message of that session", async () => {
    saveMessage(db, "s1", "No, use a queue for the retries instead of looping in the handler");
    const real = await ok("log_decision", decision({ origin: "dev", origin_quote: "use a queue for the retries" }));
    const fake = await ok("log_decision", decision({ origin: "dev", origin_quote: "I told you to build it this exact way" }));
    const none = await ok("log_decision", decision({ origin: "dev_changed_ai" }));
    const origin = (id: string) => (db.prepare("SELECT origin FROM decisions WHERE id = ?").get(id) as { origin: string }).origin;
    expect(origin(real.decision_id)).toBe("dev");
    expect(origin(fake.decision_id)).toBe("ai");
    expect(fake.note).toMatch(/not in a message/);
    expect(origin(none.decision_id)).toBe("ai");
  });

  it("makes decision evidence for an item, credited only when the developer decided", async () => {
    saveMessage(db, "s1", "No, use a queue for the retries instead of looping in the handler");
    await ok("log_decision", decision({ origin: "dev", origin_quote: "use a queue for the retries", item_id: "BE.ERR.M2" }));
    await ok("log_decision", decision({ origin: "ai", item_id: "BE.ERR.M3" }));
    const rows = db.prepare("SELECT item_id, kind, decided_by FROM skill_evidence ORDER BY item_id").all().map((r) => ({ ...r }));
    expect(rows).toEqual([
      { item_id: "BE.ERR.M2", kind: "decision", decided_by: "dev" },
      { item_id: "BE.ERR.M3", kind: "decision", decided_by: "ai" },
    ]);
  });
});
