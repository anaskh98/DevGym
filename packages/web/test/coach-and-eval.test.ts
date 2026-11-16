import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CoachReportResponse, EvalResults, PaperTrailResponse, type EvalScore } from "@ftc/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../src/api/client";
import { readApiConfig } from "../src/api/config";
import { createNoteStore } from "../src/api/mockNotes";
import {
  failuresByArea,
  isMeasured,
  missed,
  orderedScores,
  SCORE_ORDER,
  scoreText,
  sortedFailures,
} from "../src/lib/eval";

const MOCK_DIR = join(dirname(fileURLToPath(import.meta.url)), "../public/mock");
const mockFile = async (path: string) =>
  JSON.parse(await readFile(join(MOCK_DIR, `${path}.json`), "utf8")) as unknown;

function serveMocks() {
  vi.stubGlobal("fetch", async (url: string) => {
    const path = url.replace(/^\/mock/, "").replace(/\.json$/, "");
    try {
      return new Response(JSON.stringify(await mockFile(path)), { status: 200 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

/** A stand-in for the browser's local storage. */
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const mockConfig = readApiConfig({ BASE_URL: "/" });

afterEach(() => vi.unstubAllGlobals());

describe("committed sample data for Coach and Eval", () => {
  it("matches the shapes the app validates against", async () => {
    CoachReportResponse.parse(await mockFile("/api/coach"));
    EvalResults.parse(await mockFile("/api/eval"));
  });

  it("covers what the Coach page has to draw", async () => {
    const { plan } = CoachReportResponse.parse(await mockFile("/api/coach"));
    expect(plan?.focus_areas.length).toBeGreaterThanOrEqual(2);
    expect(plan?.focus_areas.some((area) => area.tentative)).toBe(true);
    expect(plan?.focus_areas.some((area) => !area.tentative && area.observations.length > 1)).toBe(true);
    expect(plan?.focus_areas.some((area) => area.annotations.some((note) => note.disagrees))).toBe(true);
    for (const area of plan?.focus_areas ?? []) {
      expect(area.tentative).toBe(area.observations.length === 1);
    }
  });

  it("links every piece of evidence to a decision that is on the Paper Trail", async () => {
    const { plan } = CoachReportResponse.parse(await mockFile("/api/coach"));
    const refs = (plan?.focus_areas ?? []).flatMap((area) => area.observations.flatMap((o) => o.evidence));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const trail = PaperTrailResponse.parse(await mockFile(`/api/tickets/${ref.ticket_id}/trail`));
      expect(trail.decisions.map((d) => d.id), ref.label).toContain(ref.decision_id);
    }
  });

  it("has sample eval numbers that agree with the failure log", async () => {
    const results = EvalResults.parse(await mockFile("/api/eval"));
    expect(results.scores.map((score) => score.id)).toEqual([...SCORE_ORDER]);
    const logged = failuresByArea(results.failures);
    for (const score of results.scores) {
      const extra = score.id === "fork" ? (score.also.find((a) => a.label === "false alarms")?.value ?? 0) : 0;
      expect(logged[score.id], score.id).toBe(missed(score) + extra);
    }
  });
});

describe("Coach notes (FE-5)", () => {
  it("saves a note and shows it with its claim, also after a reload", async () => {
    serveMocks();
    const storage = fakeStorage();
    const api = createApi(mockConfig, createNoteStore(storage));
    const target = (await api.getCoachReport()).plan?.focus_areas[0];
    if (!target) throw new Error("sample plan has no focus area");
    const before = target.annotations.length;

    const saved = await api.addAnnotation({
      target_id: target.target_id,
      note: "  I see it differently.  ",
      disagrees: true,
    });
    expect(saved).toMatchObject({ target_id: target.target_id, note: "I see it differently.", disagrees: true });

    // A reload is a new page with the same browser storage.
    const reloaded = createApi(mockConfig, createNoteStore(storage));
    const areas = (await reloaded.getCoachReport()).plan?.focus_areas ?? [];
    expect(areas[0]?.annotations).toHaveLength(before + 1);
    expect(areas[0]?.annotations.at(-1)).toEqual(saved);
    expect(areas[1]?.annotations.some((note) => note.id === saved.id)).toBe(false);
  });

  it("refuses an empty note", async () => {
    serveMocks();
    const api = createApi(mockConfig, createNoteStore(fakeStorage()));
    await expect(api.addAnnotation({ target_id: "plan_x/focus/1", note: "   ", disagrees: false })).rejects.toMatchObject(
      { kind: "invalid", message: "Write a note first." },
    );
  });

  it("counts notes in My data, and delete removes them for good", async () => {
    serveMocks();
    const storage = fakeStorage();
    const api = createApi(mockConfig, createNoteStore(storage));
    const sample = (await api.getMyData()).data.annotations.length;
    const target = (await api.getCoachReport()).plan?.focus_areas[0]?.target_id ?? "";
    await api.addAnnotation({ target_id: target, note: "Mine.", disagrees: false });
    expect((await api.getMyData()).data.annotations).toHaveLength(sample + 1);

    expect((await api.deleteAll()).deleted.annotations).toBe(sample + 1);
    expect((await api.getCoachReport()).plan).toBeNull();
    expect(storage.items.size).toBe(0);

    // After a reload the sample is back, but the note that was deleted is not.
    const reloaded = createApi(mockConfig, createNoteStore(storage));
    expect((await reloaded.getMyData()).data.annotations).toHaveLength(sample);
  });

  it("still works when the browser has no storage", async () => {
    serveMocks();
    const api = createApi(mockConfig, createNoteStore(null));
    const target = (await api.getCoachReport()).plan?.focus_areas[0]?.target_id ?? "";
    const saved = await api.addAnnotation({ target_id: target, note: "Kept for this visit.", disagrees: false });
    expect((await api.getCoachReport()).plan?.focus_areas[0]?.annotations.at(-1)).toEqual(saved);
  });

  it("ignores stored notes that are not in the expected shape", () => {
    const storage = fakeStorage();
    storage.setItem("ftc.mock.annotations", '[{"not":"a note"}]');
    expect(createNoteStore(storage).list()).toEqual([]);
    storage.setItem("ftc.mock.annotations", "{broken");
    expect(createNoteStore(storage).list()).toEqual([]);
  });

  it("in live mode, posts the note to the local service", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({ id: "ann_1", target_id: "plan_1/focus/1", note: "n", disagrees: false, created_at: "2026-11-16T08:00:00Z" }),
        { status: 200 },
      );
    });
    const api = createApi(readApiConfig({ VITE_API_MODE: "live", VITE_API_BASE: "http://127.0.0.1:4317" }));
    const saved = await api.addAnnotation({ target_id: "plan_1/focus/1", note: "n", disagrees: false });
    expect(saved.id).toBe("ann_1");
    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:4317/api/annotations",
        method: "POST",
        body: { target_id: "plan_1/focus/1", note: "n", disagrees: false },
      },
    ]);
  });
});

describe("Eval dashboard (FE-7)", () => {
  const score = (overrides: Partial<EvalScore>): EvalScore => ({
    id: "fork",
    label: "Fork",
    measures: "things",
    status: "measured",
    passed: 3,
    total: 5,
    also: [],
    ...overrides,
  });

  it("always shows five scores, in the same order, marking the ones not run", () => {
    const scores = orderedScores({ scores: [score({ id: "privacy", label: "Privacy guard" }), score({})] });
    expect(scores.map((s) => s.id)).toEqual(["fork", "paper_trail", "pointers", "coach", "privacy"]);
    expect(scores.map(scoreText)).toEqual(["3 of 5", "Not run yet", "Not run yet", "Not run yet", "3 of 5"]);
  });

  it("does not present a score that was not run as a zero", () => {
    const notRun = score({ status: "not_run", passed: 0, total: 0 });
    expect(isMeasured(notRun)).toBe(false);
    expect(scoreText(notRun)).toBe("Not run yet");
    expect(missed(notRun)).toBe(0);
    expect(scoreText(score({ passed: 0, total: 4 }))).toBe("0 of 4");
  });

  it("orders the failure log by area, then by Fork run", () => {
    const failure = (id: string, area: "fork" | "coach" | "privacy", run: number | null) => ({
      id,
      area,
      run,
      what: "",
      expected: "",
      got: "",
    });
    const sorted = sortedFailures([
      failure("d", "privacy", null),
      failure("c", "fork", 3),
      failure("b", "coach", null),
      failure("a", "fork", 1),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("serves the results in mock mode, and reports a missing file as not found", async () => {
    serveMocks();
    const api = createApi(mockConfig, createNoteStore(null));
    expect((await api.getEvalResults()).scores).toHaveLength(5);

    vi.stubGlobal("fetch", async () => new Response("<!doctype html>", { status: 200 }));
    await expect(api.getEvalResults()).rejects.toMatchObject({ kind: "not_found" });
  });
});
