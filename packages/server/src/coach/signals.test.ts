import { describe, expect, it } from "vitest";
import { ruleMatches } from "../rules/engine.js";
import { SIGNALS, signalById } from "./signals.js";

const PLANNED = [
  "err.empty-catch",
  "err.timeout-set",
  "err.retry-backoff",
  "err.error-cause",
  "err.rethrow-message-only",
  "err.error-leak",
  "fetch.console-only",
  "fetch.res-ok-check",
  "fetch.abort-controller",
  "fetch.loading-state",
  "fetch.error-boundary",
  "io.outside-call",
  "io.db-query",
  "err.try-catch",
  "err.throw",
  "api.request-body",
  "fetch.request",
];

describe("SIGNALS", () => {
  it("has every planned signal, once", () => {
    expect(SIGNALS.map((s) => s.id).sort()).toEqual([...PLANNED].sort());
  });

  it.each(SIGNALS.map((s) => [s.id, s] as const))("%s matches its hit examples and none of its miss examples", (_id, s) => {
    expect(s.examples.hit.length).toBeGreaterThanOrEqual(2);
    expect(s.examples.miss.length).toBeGreaterThanOrEqual(2);
    for (const ex of s.examples.hit) expect(ruleMatches(s, ex.file, ex.line), `hit: ${ex.line}`).toBe(true);
    for (const ex of s.examples.miss) expect(ruleMatches(s, ex.file, ex.line), `miss: ${ex.line}`).toBe(false);
  });

  it("finds a signal by id", () => {
    expect(signalById("err.timeout-set")?.id).toBe("err.timeout-set");
    expect(signalById("nope")).toBeUndefined();
  });
});
