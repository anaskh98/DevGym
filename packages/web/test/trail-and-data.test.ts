import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ForkResultResponse,
  MyDataResponse,
  PaperTrailResponse,
  STORED_KINDS,
  TicketListResponse,
} from "@ftc/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "../src/api/client";
import { readApiConfig } from "../src/api/config";
import { buildExport, countRecords, KIND_INFO, totalRecords } from "../src/lib/myData";
import { countByOrigin, countByRating, originSentence, sessionNumbers } from "../src/lib/trail";

const MOCK_DIR = join(dirname(fileURLToPath(import.meta.url)), "../public/mock");
const mockFile = async (path: string) =>
  JSON.parse(await readFile(join(MOCK_DIR, `${path}.json`), "utf8")) as unknown;

/** Serves the committed mock files to fetch, the way the dev server does. */
function serveMocks() {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    const path = url.replace(/^\/mock/, "").replace(/\.json$/, "");
    try {
      return new Response(JSON.stringify(await mockFile(path)), { status: 200 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("committed sample data", () => {
  it("matches the shapes the app validates against", async () => {
    const { tickets } = TicketListResponse.parse(await mockFile("/api/tickets"));
    expect(tickets.length).toBeGreaterThan(0);
    for (const ticket of tickets) {
      ForkResultResponse.parse(await mockFile(`/api/tickets/${ticket.id}/fork`));
      const trail = PaperTrailResponse.parse(await mockFile(`/api/tickets/${ticket.id}/trail`));
      expect(trail.decisions).toHaveLength(ticket.decisions);
    }
    MyDataResponse.parse(await mockFile("/api/data"));
  });

  it("covers every state the Paper Trail view has to draw", async () => {
    const trail = PaperTrailResponse.parse(await mockFile("/api/tickets/SAMPLE-7/trail"));
    const origins = countByOrigin(trail.decisions);
    const ratings = countByRating(trail.decisions);
    expect(Object.values(origins).every((n) => n > 0)).toBe(true);
    expect(Object.values(ratings).every((n) => n > 0)).toBe(true);
    // A pointer with a function name, one with only a line, and one not linked yet.
    expect(trail.decisions.some((d) => d.pointer?.symbol && d.pointer.commit)).toBe(true);
    expect(trail.decisions.some((d) => d.pointer && !d.pointer.symbol && d.pointer.commit)).toBe(true);
    expect(trail.decisions.some((d) => d.pointer && !d.pointer.commit)).toBe(true);
    expect(trail.decisions.some((d) => d.explain_backs.length === 0)).toBe(true);
  });
});

describe("Paper Trail helpers", () => {
  const decision = (origin: "ai" | "dev" | "dev_changed_ai", session_id = "s1") => ({
    origin,
    session_id,
    explain_backs: [],
  });

  it("describes who made the decisions", () => {
    expect(originSentence([decision("ai"), decision("ai"), decision("dev"), decision("dev_changed_ai")])).toBe(
      "4 decisions. Claude made 2, the developer made 1, and the developer changed 1 of Claude's.",
    );
    expect(originSentence([decision("dev")])).toBe("1 decision. The developer made 1.");
    expect(originSentence([decision("ai"), decision("dev")])).toBe(
      "2 decisions. Claude made 1 and the developer made 1.",
    );
  });

  it("numbers coding sessions in the order they first appear", () => {
    expect(sessionNumbers([decision("ai", "a"), decision("ai", "a"), decision("ai", "b"), decision("ai", "a")])).toEqual(
      [1, 1, 2, 1],
    );
  });
});

describe("My data (FE-6)", () => {
  it("exports exactly what the page shows", async () => {
    const response = MyDataResponse.parse(await mockFile("/api/data"));
    const file = buildExport(response, new Date("2026-11-16T08:00:00Z"));
    expect(file.filename).toBe("ftc-data-2026-11-16.json");
    expect(JSON.parse(file.text)).toEqual(response);
  });

  it("counts every kind, and has a label for each", async () => {
    const response = MyDataResponse.parse(await mockFile("/api/data"));
    const counts = countRecords(response);
    expect(Object.keys(counts).sort()).toEqual([...STORED_KINDS].sort());
    expect(totalRecords(response)).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    for (const kind of STORED_KINDS) expect(KIND_INFO[kind].label).toBeTruthy();
  });

  it("in mock mode, delete empties every view until reload and reports what it removed", async () => {
    serveMocks();
    const api = createApi(readApiConfig({ BASE_URL: "/" }));
    const before = await api.getMyData();
    expect(totalRecords(before)).toBeGreaterThan(0);

    const result = await api.deleteAll();
    expect(result.deleted).toEqual(countRecords(before));

    expect(totalRecords(await api.getMyData())).toBe(0);
    expect((await api.listTickets()).tickets).toEqual([]);
    await expect(api.getTrail("SAMPLE-7")).rejects.toBeInstanceOf(ApiError);
    await expect(api.getForkResult("SAMPLE-7")).rejects.toMatchObject({ kind: "not_found" });

    // Deleting again removes nothing.
    expect(Object.values((await api.deleteAll()).deleted).every((n) => n === 0)).toBe(true);
    // A fresh page load has the sample data back.
    expect(totalRecords(await createApi(readApiConfig({ BASE_URL: "/" })).getMyData())).toBeGreaterThan(0);
  });

  it("in live mode, delete calls DELETE /api/data on the local service", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ deleted: { decisions: 6 } }), { status: 200 });
    });
    const api = createApi(readApiConfig({ VITE_API_MODE: "live", VITE_API_BASE: "http://127.0.0.1:4317" }));
    expect(await api.deleteAll()).toEqual({ deleted: { decisions: 6 } });
    expect(calls).toEqual([{ url: "http://127.0.0.1:4317/api/data", method: "DELETE" }]);
  });

  it("reports an unreachable local service instead of pretending to delete", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const api = createApi(readApiConfig({ VITE_API_MODE: "live" }));
    await expect(api.deleteAll()).rejects.toMatchObject({ kind: "unreachable" });
  });
});
