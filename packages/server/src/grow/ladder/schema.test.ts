import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, ladderSchema, passCount, type Drill, type Ladder, type LadderItem } from "./schema.js";

function drill(points = 3, extra: Partial<Drill> = {}): Drill {
  return {
    id: "d1",
    prompt: "Your service calls a slow payment provider. How do you design the call?",
    key_points: Array.from({ length: points }, (_, i) => ({ id: `k${i + 1}`, text: `point ${i + 1}` })),
    red_flags: [{ id: "r1", text: "retries a charge with no idempotency key" }],
    ...extra,
  };
}

function item(id = "BE.ERR.M2", extra: Partial<LadderItem> = {}): LadderItem {
  return {
    id,
    title: "Handles the failure of an outside call on purpose",
    good_looks_like: ["Sets a time limit, retries only when safe, gives the caller a clear error."],
    signals: [{ id: "err.timeout-set", polarity: "positive" }],
    explain_angles: ["Why this time limit?"],
    drills: [drill()],
    study: ["retry with backoff and jitter", "idempotency keys"],
    stack_notes: { express: { note: "Use AbortSignal.timeout on fetch.", link: "https://nodejs.org/api/globals.html" } },
    ...extra,
  };
}

function ladder(items: Partial<Record<"junior" | "mid" | "senior" | "staff", LadderItem[]>> = { mid: [item()] }): Ladder {
  return {
    track: "backend",
    areas: [{ id: "ERR", name: "Errors and failure", levels: { junior: [], mid: [], senior: [], staff: [], ...items } }],
  };
}

const errorOf = (value: unknown) => {
  const result = ladderSchema.safeParse(value);
  return result.success ? "" : result.error.issues.map((i) => i.message).join(" | ");
};

describe("ladderSchema", () => {
  it("accepts a minimal valid ladder, with empty levels", () => {
    expect(errorOf(ladder())).toBe("");
  });

  it("rejects a duplicate item id", () => {
    expect(errorOf(ladder({ mid: [item(), item()] }))).toMatch(/BE\.ERR\.M2.*more than once/);
  });

  it("rejects a frontend id in a backend ladder", () => {
    expect(errorOf(ladder({ mid: [item("FE.ERR.M2")] }))).toMatch(/FE\.ERR\.M2/);
  });

  it("rejects an item placed under the wrong level", () => {
    expect(errorOf(ladder({ mid: [item("BE.ERR.S1")] }))).toMatch(/BE\.ERR\.S1 sits under mid but its id says senior/);
  });

  it("rejects a bad item id", () => {
    expect(errorOf(ladder({ mid: [item("be.err.m2")] }))).not.toBe("");
  });

  it("rejects a drill with one key point", () => {
    expect(errorOf(ladder({ mid: [item("BE.ERR.M2", { drills: [drill(1)] })] }))).not.toBe("");
  });

  it("rejects a pass count above the number of key points", () => {
    expect(errorOf(ladder({ mid: [item("BE.ERR.M2", { drills: [drill(3, { pass: 4 })] })] }))).toMatch(/pass/);
  });

  it("rejects an item with no drill", () => {
    expect(errorOf(ladder({ mid: [item("BE.ERR.M2", { drills: [] })] }))).not.toBe("");
  });

  it("rejects a stack note link that is not https", () => {
    const notes = { express: { note: "x note", link: "http://example.com" } };
    expect(errorOf(ladder({ mid: [item("BE.ERR.M2", { stack_notes: notes })] }))).toMatch(/https/);
  });
});

describe("passCount", () => {
  it("defaults to two thirds of the key points, rounded up", () => {
    expect(passCount(drill(3))).toBe(2);
    expect(passCount(drill(4))).toBe(3);
    expect(passCount(drill(3, { pass: 3 }))).toBe(3);
  });
});

describe("DEFAULT_THRESHOLDS", () => {
  it("holds the values from the spec", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({
      proofs: 3,
      tickets: 2,
      window_days: 60,
      clear_answers: 2,
      judge_cap: 1,
      drill_retry_days: 3,
      question_timeout_min: 30,
      max_questions: 3,
      hash_keep_days: 120,
      catchup_max: 200,
      exposure_window_days: 90,
      exposure_low: 1,
      exposure_medium: 3,
      exposure_high: 6,
    });
  });
});
