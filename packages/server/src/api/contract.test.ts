// The web app reads the API through the schemas in @devgym/shared. These tests send every route's real answer
// through them, so a change on either side that breaks the other fails here, not in the demo.
import {
  AnnotationResponse,
  DeleteAllResponse,
  EvalResults,
  ExportResponse,
  GrowthPlanResponse,
  STORED_TABLES,
  TicketDetailResponse,
  TicketListResponse,
} from "@devgym/shared";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { buildSampleProfile } from "../demo/sample.js";
import { SAMPLE_EVAL } from "../demo/sample-eval.js";
import { PrivacyGuard } from "../privacy/guard.js";
import { createApiServer, listen } from "./server.js";

let dir: string;
let db: Db;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "devgym-contract-"));
  buildSampleProfile(join(dir, "profile.sqlite"), dir);
  writeFileSync(join(dir, "eval.json"), JSON.stringify(SAMPLE_EVAL));
  db = openDb(join(dir, "profile.sqlite"));
  server = createApiServer({ db, guard: new PrivacyGuard({ root: dir, denylist: () => [] }), evalFile: join(dir, "eval.json") });
  base = `http://127.0.0.1:${await listen(server, 0)}`;
});
afterAll(async () => {
  await new Promise((done) => server.close(done));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string) => (await fetch(`${base}${path}`)).json();

describe("API responses match what the web app expects", () => {
  it("GET /api/tickets", async () => {
    expect(TicketListResponse.parse(await get("/api/tickets")).tickets).toHaveLength(1);
  });

  it("GET /api/tickets/:id", async () => {
    const detail = TicketDetailResponse.parse(await get("/api/tickets/SAMPLE-1"));
    expect(detail.decisions.length).toBeGreaterThan(0);
    expect(detail.sessions[0]?.unexplained_files.length).toBeGreaterThan(0);
  });

  it("GET /api/growth-plan", async () => {
    const plan = GrowthPlanResponse.parse(await get("/api/growth-plan")).growth_plan;
    expect(plan?.focus_areas.some((a) => a.tentative)).toBe(true);
  });

  it("POST /api/annotations", async () => {
    const plan = GrowthPlanResponse.parse(await get("/api/growth-plan")).growth_plan;
    const response = await fetch(`${base}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: plan?.focus_areas[0]?.id, note: "I see it differently.", disagrees: true }),
    });
    expect(response.status).toBe(201);
    AnnotationResponse.parse(await response.json());
  });

  it("GET /api/eval", async () => {
    EvalResults.parse(await get("/api/eval"));
  });

  it("GET /api/export, then DELETE /api/data", async () => {
    const exported = ExportResponse.parse(await get("/api/export"));
    expect(Object.keys(exported.data).sort()).toEqual([...STORED_TABLES].sort());
    const response = await fetch(`${base}/api/data`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "delete-all" }),
    });
    DeleteAllResponse.parse(await response.json());
    expect(TicketListResponse.parse(await get("/api/tickets")).tickets).toEqual([]);
  });
});
