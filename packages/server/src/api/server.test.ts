import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { PrivacyGuard } from "../privacy/guard.js";
import * as store from "../store.js";
import { createApiServer, listen } from "./server.js";

let db: Db;
let server: Server;
let port: number;
let repo: string;
let ids: { decision: string; explainBack: string; observation: string; plan: string; claim: string };

const VITE = "http://localhost:5173";

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "ftc-api-"));
  db = openDb(":memory:");
  migrate(db);
  store.upsertTicket(db, { id: "SAMPLE-1", title: "Export orders", body: "Body", source: "markdown" });
  store.saveAssumptions(db, {
    ticket_id: "SAMPLE-1",
    assumptions: [
      { text: "What is recent?", status: "answered_by_po", answer: "90 days" },
      { text: "Format?", status: "assumed_by_dev", answer: "Assuming: CSV" },
    ],
  });
  store.startTrail(db, { ticket_id: "SAMPLE-1", session_id: "s1" });
  store.recordFileEdit(db, "s1", "src/export.ts");
  store.recordFileEdit(db, "s1", ".gitignore");
  const d = store.logDecision(
    db,
    {
      ticket_id: "SAMPLE-1",
      session_id: "s1",
      summary: "Stream the export in pages",
      alternatives: ["Build it all in memory"],
      origin: "ai",
      related_files: [],
      pointer: { repo: "team/demo", file_path: "src/export.ts", symbol: "exportOrders", line_hint: 14, commit: "abc1234" },
    },
    repo,
  );
  store.logDecision(db, { ticket_id: "SAMPLE-1", session_id: "s1", summary: "CSV output", alternatives: [], origin: "dev", related_files: [] }, repo);
  const e = store.recordExplainBack(db, { decision_id: d.decision_id, question: "Why pages?", answer: "Memory", rating: "partial" });
  const o = store.saveObservation(db, { skill_tag: "performance", summary: "Knows paging saves memory", evidence_ids: [d.decision_id, e.explain_back_id] });
  const p = store.saveGrowthPlan(db, { focus_areas: [{ claim: "One answer suggests a gap", evidence_ids: [o.observation_id], exercise: "Write the limit down first" }] });
  ids = { decision: d.decision_id, explainBack: e.explain_back_id, observation: o.observation_id, plan: p.growth_plan_id, claim: p.focus_areas[0]!.id };

  server = createApiServer({
    db,
    guard: new PrivacyGuard({ root: repo, denylist: () => ["Globex"] }),
    allowedOrigins: [VITE],
    evalFile: join(repo, "eval-results.json"),
  });
  port = await listen(server, 0);
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(repo, { recursive: true, force: true });
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

/** Pages outside /api answer with text, not JSON. */
function parseBody(text: string): any {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Raw HTTP so tests can set Host and Origin, which fetch does not allow. */
function call(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; rawBody?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        // Content-Length is set by hand: Node's client does not frame a DELETE body on its own.
        headers: {
          ...(payload === undefined ? {} : { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(payload)) }),
          ...opts.headers,
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parseBody(text) }));
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

describe("reading", () => {
  it("lists tickets with counts", async () => {
    const res = await call("GET", "/api/tickets");
    expect(res.status).toBe(200);
    expect(res.body.tickets).toMatchObject([{ id: "SAMPLE-1", title: "Export orders", assumption_count: 2, decision_count: 2 }]);
  });

  it("returns a ticket with assumptions, decisions, explain-backs and unexplained files", async () => {
    const { status, body } = await call("GET", "/api/tickets/SAMPLE-1");
    expect(status).toBe(200);
    expect(body.ticket).toMatchObject({ id: "SAMPLE-1", body: "Body" });
    expect(body.assumptions).toMatchObject([
      { text: "What is recent?", status: "answered_by_po", answer: "90 days" },
      { text: "Format?", status: "assumed_by_dev" },
    ]);
    expect(body.decisions).toMatchObject([
      {
        id: ids.decision,
        origin: "ai",
        alternatives: ["Build it all in memory"],
        pointer: {
          repo: "team/demo",
          file_path: "src/export.ts",
          symbol: "exportOrders",
          url: "https://github.com/team/demo/blob/abc1234/src/export.ts#L14",
        },
        explain_backs: [{ id: ids.explainBack, question: "Why pages?", rating: "partial" }],
        annotations: [],
      },
      { origin: "dev", pointer: null, explain_backs: [] },
    ]);
    expect(body.sessions).toMatchObject([{ session_id: "s1", unexplained_files: [".gitignore"] }]);
    expect((await call("GET", "/api/tickets/SAMPLE-1/decisions")).body.decisions).toHaveLength(2);
  });

  it("returns the latest growth plan with evidence filled in", async () => {
    const { body } = await call("GET", "/api/growth-plan");
    expect(body.growth_plan).toMatchObject({
      id: ids.plan,
      focus_areas: [
        {
          id: ids.claim,
          claim: "One answer suggests a gap",
          tentative: true,
          evidence: [{ id: ids.observation, skill_tag: "performance", evidence: [{ kind: "decision" }, { kind: "explain_back", rating: "partial" }] }],
          annotations: [],
        },
      ],
    });
  });

  it("handles a plan saved before claims had ids", async () => {
    db.prepare("UPDATE growth_plans SET focus_areas = json_remove(focus_areas, '$[0].id')").run();
    const plan = (await call("GET", "/api/growth-plan")).body.growth_plan;
    expect(plan.focus_areas[0].id).toBe(`${ids.plan}:0`);
    const res = await call("POST", "/api/annotations", { body: { target_id: `${ids.plan}:0`, note: "Fair point" } });
    expect(res.status).toBe(201);
    expect((await call("GET", "/api/growth-plan")).body.growth_plan.focus_areas[0].annotations).toHaveLength(1);
    expect((await call("POST", "/api/annotations", { body: { target_id: `${ids.plan}:7`, note: "x" } })).status).toBe(404);
  });

  it("answers 404 for unknown things and null for a missing plan", async () => {
    expect((await call("GET", "/api/tickets/NOPE")).status).toBe(404);
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("GET", "/elsewhere")).status).toBe(404);
    db.exec("DELETE FROM growth_plans");
    expect((await call("GET", "/api/growth-plan")).body).toEqual({ growth_plan: null });
  });
});

describe("annotations", () => {
  it("saves a note on a claim and shows it on reload", async () => {
    const res = await call("POST", "/api/annotations", { body: { target_id: ids.claim, note: "I disagree, I did know this", disagrees: true } });
    expect(res.status).toBe(201);
    expect(res.body.annotation).toMatchObject({ target_id: ids.claim, disagrees: true });
    const plan = (await call("GET", "/api/growth-plan")).body.growth_plan;
    expect(plan.focus_areas[0].annotations).toMatchObject([{ note: "I disagree, I did know this", disagrees: true }]);

    expect((await call("DELETE", `/api/annotations/${res.body.annotation.id}`)).status).toBe(204);
    expect((await call("DELETE", `/api/annotations/${res.body.annotation.id}`)).status).toBe(404);
  });

  it("saves a note on a decision", async () => {
    await call("POST", "/api/annotations", { body: { target_id: ids.decision, note: "Paging was my idea" } });
    const { body } = await call("GET", "/api/tickets/SAMPLE-1");
    expect(body.decisions[0].annotations).toMatchObject([{ note: "Paging was my idea", disagrees: false }]);
  });

  it("rejects bad input", async () => {
    const post = (body: unknown) => call("POST", "/api/annotations", { body });
    expect((await post({ target_id: ids.claim })).status).toBe(400);
    expect((await post({ target_id: ids.claim, note: "x", disagrees: "yes" })).status).toBe(400);
    expect((await post({ target_id: ids.claim, note: "x", extra: 1 })).status).toBe(400);
    expect((await post({ target_id: "nothing", note: "x" })).status).toBe(404);
    expect((await call("POST", "/api/annotations", { rawBody: "{not json" })).status).toBe(400);
    expect((await call("POST", "/api/annotations", { rawBody: JSON.stringify({ target_id: ids.claim, note: "x".repeat(70_000) }) })).status).toBe(413);
  });

  it("runs the privacy guard on notes", async () => {
    const code = await call("POST", "/api/annotations", { body: { target_id: ids.claim, note: "const rows = orders.filter(isRecent)" } });
    expect(code.status).toBe(422);
    expect(code.body.error).toMatchObject({ code: "privacy_guard", field: "note", rule: "variable-declaration" });
    const name = await call("POST", "/api/annotations", { body: { target_id: ids.claim, note: "This was for Globex" } });
    expect(name.body.error).toMatchObject({ code: "privacy_guard", rule: "client-name" });
    expect(db.prepare("SELECT count(*) AS n FROM annotations").get()).toEqual({ n: 0 });
  });
});

describe("export and delete-all", () => {
  it("exports every stored row", async () => {
    const res = await call("GET", "/api/export");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="fork-trail-coach-export-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.body.counts).toMatchObject({ tickets: 1, assumptions: 2, decisions: 2, pointers: 1, explain_backs: 1, observations: 1, growth_plans: 1, trail_sessions: 1, file_edits: 2 });
    for (const [table, n] of Object.entries(res.body.counts)) expect(res.body.data[table], table).toHaveLength(n as number);
    expect(res.body.data.decisions[0].alternatives).toEqual(["Build it all in memory"]);
    expect(res.body.data.growth_plans[0].focus_areas[0].claim).toBe("One answer suggests a gap");
  });

  it("deletes everything only when asked on purpose, and the export is then empty", async () => {
    expect((await call("DELETE", "/api/data")).status).toBe(415);
    expect((await call("DELETE", "/api/data", { body: {} })).status).toBe(400);
    expect((await call("DELETE", "/api/data", { body: { confirm: "yes" } })).status).toBe(400);
    expect((await call("GET", "/api/health")).body.counts.decisions).toBe(2);

    const res = await call("DELETE", "/api/data", { body: { confirm: "delete-all" } });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toMatchObject({ tickets: 1, decisions: 2 });
    const after = (await call("GET", "/api/export")).body;
    expect(Object.values(after.counts).every((n) => n === 0)).toBe(true);
    expect(Object.values(after.data).every((list) => (list as unknown[]).length === 0)).toBe(true);
    // The schema survives, so the tools keep working.
    expect(migrate(db)).toEqual([]);
  });
});

describe("local-only safety", () => {
  it("listens on 127.0.0.1 only", () => {
    expect(server.address()).toMatchObject({ address: "127.0.0.1" });
  });

  it("refuses a request whose Host is not this server (DNS rebinding)", async () => {
    const res = await call("GET", "/api/export", { headers: { Host: "evil.example" } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("bad_host");
    expect((await call("GET", "/api/export", { headers: { Host: `evil.example:${port}` } })).status).toBe(403);
    expect((await call("GET", "/api/health", { headers: { Host: `localhost:${port}` } })).status).toBe(200);
  });

  it("refuses other websites and allows the local web app", async () => {
    const evil = await call("GET", "/api/export", { headers: { Origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    expect((await call("DELETE", "/api/data", { body: { confirm: "delete-all" }, headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await call("OPTIONS", "/api/data", { headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "DELETE" } })).status).toBe(403);
    expect((await call("GET", "/api/health")).body.counts.decisions).toBe(2);

    const vite = await call("GET", "/api/tickets", { headers: { Origin: VITE } });
    expect(vite.status).toBe(200);
    expect(vite.headers["access-control-allow-origin"]).toBe(VITE);
    const preflight = await call("OPTIONS", "/api/annotations", { headers: { Origin: VITE, "Access-Control-Request-Method": "POST" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain("POST");
    expect((await call("GET", "/api/tickets", { headers: { Origin: `http://127.0.0.1:${port}` } })).status).toBe(200);
  });

  it("refuses a form-style post, which browsers send without asking permission", async () => {
    const res = await call("POST", "/api/annotations", {
      rawBody: JSON.stringify({ target_id: ids.claim, note: "x" }),
      headers: { "Content-Type": "text/plain" },
    });
    expect(res.status).toBe(415);
  });
});

describe("errors the web app must be able to read", () => {
  it("sends the CORS header on an error too, so the page can show why a note was rejected", async () => {
    const rejected = await call("POST", "/api/annotations", {
      headers: { Origin: VITE },
      body: { target_id: ids.claim, note: "const x = 1; doIt(x);" },
    });
    expect(rejected.status).toBe(422);
    expect(rejected.headers["access-control-allow-origin"]).toBe(VITE);
    expect(rejected.body.error.code).toBe("privacy_guard");

    const missing = await call("GET", "/api/tickets/NOPE", { headers: { Origin: VITE } });
    expect(missing.status).toBe(404);
    expect(missing.headers["access-control-allow-origin"]).toBe(VITE);
  });

  it("still gives a refused origin no CORS header", async () => {
    const res = await call("GET", "/api/tickets/NOPE", { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("eval results", () => {
  it("answers 404 until the harness has written a results file", async () => {
    const res = await call("GET", "/api/eval");
    expect(res.status).toBe(404);
  });

  it("serves the results file as it is", async () => {
    const results = { run_at: "2026-11-16T10:00:00.000Z", ticket_id: "DEMO-1", fork_runs: 3, scores: [], failures: [] };
    writeFileSync(join(repo, "eval-results.json"), JSON.stringify(results));
    const res = await call("GET", "/api/eval");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(results);
  });

  it("reports a broken results file instead of crashing", async () => {
    writeFileSync(join(repo, "eval-results.json"), "{not json");
    const res = await call("GET", "/api/eval");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("bad_eval_file");
  });
});

describe("GET /api/coach", () => {
  it("serves the growth dashboard in the shared shape", async () => {
    const res = await call("GET", "/api/coach");
    expect(res.status).toBe(200);
    const parsed = (await import("@ftc/shared")).CoachDashboard.safeParse(res.body);
    expect(parsed.success).toBe(true);
  });
});

describe("delete everything also deletes the Coach tables (I8)", () => {
  it("removes developer messages, evidence and questions too", async () => {
    db.prepare("INSERT INTO developer_messages (id, session_id, message) VALUES ('m', 's', 'something I typed here')").run();
    db.prepare("INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, at) VALUES ('e', 'builtin/backend', 'BE.ERR.M2', 'rule', 'positive', 'dev', 'T', '2026-11-01')").run();
    const res = await call("DELETE", "/api/data", { body: { confirm: "delete-all" } });
    expect(res.status).toBe(200);
    expect(db.prepare("SELECT count(*) AS n FROM developer_messages").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM skill_evidence").get()).toEqual({ n: 0 });
  });
});
