import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EvalResults,
  ExportResponse,
  GrowthPlanResponse,
  TicketDetailResponse,
  TicketListResponse,
  type EvalScore,
} from "@ftc/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../src/api/client";
import { readApiConfig } from "../src/api/config";
import { createNoteStore } from "../src/api/mockNotes";
import { failuresByArea, isMeasured, missed, orderedScores, scoreText, sortedFailures } from "../src/lib/eval";
import { buildExport, totalRecords } from "../src/lib/myData";
import { countByOrigin, originSentence, sessionNumbers } from "../src/lib/trail";

const MOCK_DIR = join(dirname(fileURLToPath(import.meta.url)), "../public/mock");
const mockFile = async (path: string) => JSON.parse(await readFile(join(MOCK_DIR, `${path}.json`), "utf8")) as unknown;
const mockConfig = readApiConfig({ BASE_URL: "/" });
const live = readApiConfig({ VITE_API_MODE: "live", VITE_API_BASE: "http://127.0.0.1:4317" });

/** Serves the committed sample files to fetch, the way the dev server does. */
function serveMocks() {
  vi.stubGlobal("fetch", async (url: string) => {
    const path = url.replace(/^\/mock/, "").replace(/\.json$/, "");
    try {
      return new Response(JSON.stringify(await mockFile(path)), { status: 200 });
    } catch {
      return new Response("<!doctype html>", { status: 200 });
    }
  });
}

/** Answers like the local service, and records what was asked. */
function serveLive(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("sample data (generated from the real API by pnpm mock:refresh)", () => {
  it("parses with the same schemas the app uses on live data", async () => {
    TicketListResponse.parse(await mockFile("/api/tickets"));
    TicketDetailResponse.parse(await mockFile("/api/tickets/SAMPLE-1"));
    GrowthPlanResponse.parse(await mockFile("/api/growth-plan"));
    ExportResponse.parse(await mockFile("/api/export"));
    EvalResults.parse(await mockFile("/api/eval"));
  });

  it("covers every state the pages draw", async () => {
    const detail = TicketDetailResponse.parse(await mockFile("/api/tickets/SAMPLE-1"));
    expect(Object.values(countByOrigin(detail.decisions)).every((n) => n > 0)).toBe(true);
    expect(new Set(detail.decisions.flatMap((d) => d.explain_backs.map((e) => e.rating)))).toEqual(
      new Set(["clear", "partial", "not_yet"]),
    );
    expect(detail.decisions.some((d) => d.pointer?.resolved === false)).toBe(true);
    expect(detail.decisions.some((d) => d.pointer?.resolved === true)).toBe(true);
    expect(detail.sessions[0]?.unexplained_files.length).toBeGreaterThan(0);
    expect(new Set(detail.assumptions.map((a) => a.status))).toEqual(new Set(["answered_by_po", "assumed_by_dev"]));

    const plan = GrowthPlanResponse.parse(await mockFile("/api/growth-plan")).growth_plan;
    expect(plan?.focus_areas.some((a) => a.tentative)).toBe(true);
    expect(plan?.focus_areas.some((a) => !a.tentative)).toBe(true);
    expect(plan?.focus_areas.some((a) => a.annotations.some((n) => n.disagrees))).toBe(true);
    for (const area of plan?.focus_areas ?? []) expect(area.tentative).toBe(area.evidence.length === 1);
  });

  it("links every piece of Coach evidence to something on the ticket's Paper Trail", async () => {
    const plan = GrowthPlanResponse.parse(await mockFile("/api/growth-plan")).growth_plan;
    const detail = TicketDetailResponse.parse(await mockFile("/api/tickets/SAMPLE-1"));
    const known = new Set(detail.decisions.flatMap((d) => [d.id, ...d.explain_backs.map((e) => e.id)]));
    const items = (plan?.focus_areas ?? []).flatMap((a) => a.evidence.flatMap((o) => o.evidence));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(known.has(item.id), item.id).toBe(true);
  });
});

describe("live mode talks to the local service as docs/api.md says", () => {
  it("posts a note and returns the saved annotation", async () => {
    const saved = { id: "a1", target_id: "f1", note: "n", disagrees: true, created_at: "2026-11-16 10:00:00" };
    const calls = serveLive(201, { annotation: saved });
    expect(await createApi(live).addAnnotation({ target_id: "f1", note: "n", disagrees: true })).toEqual(saved);
    expect(calls).toEqual([
      { url: "http://127.0.0.1:4317/api/annotations", method: "POST", body: { target_id: "f1", note: "n", disagrees: true } },
    ]);
  });

  it("shows the privacy guard's own reason when a note is rejected", async () => {
    serveLive(422, { error: { code: "privacy_guard", message: "Rejected by the privacy guard: field 'note' looks like code." } });
    await expect(createApi(live).addAnnotation({ target_id: "f1", note: "x = 1;", disagrees: false })).rejects.toMatchObject({
      kind: "rejected",
      message: "Rejected by the privacy guard: field 'note' looks like code.",
    });
  });

  it("deletes with the confirmation body the service requires", async () => {
    const calls = serveLive(200, { deleted: { tickets: 1 } });
    expect(await createApi(live).deleteAll()).toEqual({ deleted: { tickets: 1 } });
    expect(calls).toEqual([{ url: "http://127.0.0.1:4317/api/data", method: "DELETE", body: { confirm: "delete-all" } }]);
  });

  it("reports a missing ticket as not found, with the service's message", async () => {
    serveLive(404, { error: { code: "not_found", message: "Ticket 'X' does not exist" } });
    await expect(createApi(live).getTicket("X")).rejects.toMatchObject({ kind: "not_found", message: "Ticket 'X' does not exist" });
  });

  it("reports an unreachable service", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createApi(live).listTickets()).rejects.toMatchObject({ kind: "unreachable" });
  });
});

describe("mock mode", () => {
  it("keeps a note in the browser, shows it with its claim, and keeps it after a reload", async () => {
    serveMocks();
    const storage = fakeStorage();
    const api = createApi(mockConfig, createNoteStore(storage));
    const area = (await api.getGrowthPlan()).growth_plan?.focus_areas[0];
    if (!area) throw new Error("sample plan has no focus area");
    const saved = await api.addAnnotation({ target_id: area.id, note: "  Mine.  ", disagrees: true });
    expect(saved.note).toBe("Mine.");
    const reloaded = createApi(mockConfig, createNoteStore(storage));
    expect((await reloaded.getGrowthPlan()).growth_plan?.focus_areas[0]?.annotations.at(-1)).toEqual(saved);
  });

  it("refuses an empty note", async () => {
    await expect(createApi(mockConfig, createNoteStore(null)).addAnnotation({ target_id: "f", note: " ", disagrees: false })).rejects.toMatchObject({
      message: "Write a note first.",
    });
  });

  it("delete empties every view until reload, and removes the browser's notes", async () => {
    serveMocks();
    const storage = fakeStorage();
    const api = createApi(mockConfig, createNoteStore(storage));
    const area = (await api.getGrowthPlan()).growth_plan?.focus_areas[0];
    await api.addAnnotation({ target_id: area?.id ?? "", note: "Mine.", disagrees: false });
    const before = await api.getExport();
    expect((await api.deleteAll()).deleted).toEqual(before.counts);
    expect(totalRecords(await api.getExport())).toBe(0);
    expect((await api.listTickets()).tickets).toEqual([]);
    expect((await api.getGrowthPlan()).growth_plan).toBeNull();
    await expect(api.getTicket("SAMPLE-1")).rejects.toMatchObject({ kind: "not_found" });
    expect(storage.items.size).toBe(0);
  });
});

describe("page helpers", () => {
  it("exports exactly what the service exported", async () => {
    const response = ExportResponse.parse(await mockFile("/api/export"));
    const file = buildExport(response, new Date("2026-11-16T08:00:00Z"));
    expect(file.filename).toBe("fork-trail-coach-export-2026-11-16.json");
    expect(JSON.parse(file.text)).toEqual(response);
  });

  it("describes who made the decisions and numbers sessions", () => {
    const d = (origin: "ai" | "dev" | "dev_changed_ai", session_id = "s") => ({ origin, session_id, explain_backs: [] });
    expect(originSentence([d("ai"), d("ai"), d("dev"), d("dev_changed_ai")])).toBe(
      "4 decisions. Claude made 2, the developer made 1, and the developer changed 1 of Claude's.",
    );
    expect(sessionNumbers([d("ai", "a"), d("ai", "b"), d("ai", "a")])).toEqual([1, 2, 1]);
  });

  it("always shows five scores in order, and never shows a score that was not run as zero", () => {
    const score = (o: Partial<EvalScore>): EvalScore => ({ id: "fork", label: "Fork", measures: "m", status: "measured", passed: 3, total: 5, also: [], ...o });
    const scores = orderedScores({ scores: [score({ id: "privacy" }), score({}), score({ id: "coach", status: "not_run", total: 0, passed: 0 })] });
    expect(scores.map((s) => s.id)).toEqual(["fork", "paper_trail", "pointers", "coach", "privacy"]);
    expect(scores.map(scoreText)).toEqual(["3 of 5", "Not run yet", "Not run yet", "Not run yet", "3 of 5"]);
    expect(isMeasured(scores[3]!)).toBe(false);
    expect(missed(score({ passed: 0, total: 4 }))).toBe(4);
  });

  it("orders the failure log by area, then run", async () => {
    const results = EvalResults.parse(await mockFile("/api/eval"));
    const sorted = sortedFailures(results.failures);
    expect(sorted[0]?.area).toBe("fork");
    expect(sorted.at(-1)?.area).toBe("privacy");
    expect(Object.values(failuresByArea(results.failures)).reduce((a, b) => a + b, 0)).toBe(results.failures.length);
  });
});
