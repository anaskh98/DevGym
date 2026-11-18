import { describe, expect, it } from "vitest";
import { signalById } from "../signals.js";
import { BUILTIN_LADDERS } from "./builtin.js";
import { LEVELS, ladderSchema, type Ladder } from "./schema.js";

const backend = BUILTIN_LADDERS.backend;
const frontend = BUILTIN_LADDERS.frontend;

function items(l: Ladder) {
  return l.areas.flatMap((a) => LEVELS.flatMap((lvl) => a.levels[lvl]));
}

describe("built-in ladders", () => {
  it.each([backend, frontend].map((l) => [l.track, l] as const))("%s passes the schema", (_t, l) => {
    const result = ladderSchema.safeParse(l);
    expect(result.success ? "" : result.error.issues.map((i) => i.message).join(" | ")).toBe("");
  });

  it("only references signals that exist", () => {
    for (const l of [backend, frontend]) for (const i of items(l)) for (const s of i.signals) expect(signalById(s.id), `${i.id} -> ${s.id}`).toBeDefined();
  });

  it("only references exposure signals that exist, and sets the planned ones", () => {
    for (const l of [backend, frontend]) for (const i of items(l)) for (const id of i.exposure_signals ?? []) expect(signalById(id), `${i.id} -> ${id}`).toBeDefined();
    const ex = (l: Ladder, id: string) => items(l).find((i) => i.id === id)!.exposure_signals ?? [];
    expect(ex(backend, "BE.ERR.M2")).toEqual(["io.outside-call"]);
    expect(ex(backend, "BE.ERR.J2")).toEqual(["io.outside-call", "io.db-query"]);
    expect(ex(backend, "BE.ERR.X1")).toEqual([]);
    expect(ex(frontend, "FE.FETCH.M2")).toEqual(["fetch.request"]);
    expect(ex(frontend, "FE.FETCH.X1")).toEqual([]);
  });

  it("writes ERR and FETCH fully: every level has at least one item", () => {
    const err = backend.areas.find((a) => a.id === "ERR")!;
    const fetch = frontend.areas.find((a) => a.id === "FETCH")!;
    for (const lvl of LEVELS) {
      expect(err.levels[lvl].length, `ERR ${lvl}`).toBeGreaterThan(0);
      expect(fetch.levels[lvl].length, `FETCH ${lvl}`).toBeGreaterThan(0);
    }
  });

  it("names the other areas, still empty", () => {
    expect(backend.areas.map((a) => a.id)).toEqual(["ERR", "DATA", "API", "SEC", "PERF", "TEST", "STRUCT", "REQ"]);
    expect(frontend.areas.map((a) => a.id)).toEqual(["FETCH", "STATE", "COMP", "RENDER", "A11Y", "SEC", "TEST", "REQ"]);
  });

  it("has the planned item ids", () => {
    expect(items(backend).map((i) => i.id)).toEqual([
      "BE.ERR.J1", "BE.ERR.J2", "BE.ERR.M1", "BE.ERR.M2", "BE.ERR.M3", "BE.ERR.S1", "BE.ERR.S2", "BE.ERR.X1",
    ]);
    expect(items(frontend).map((i) => i.id)).toEqual([
      "FE.FETCH.J1", "FE.FETCH.J2", "FE.FETCH.M1", "FE.FETCH.M2", "FE.FETCH.M3", "FE.FETCH.S1", "FE.FETCH.S2", "FE.FETCH.X1",
    ]);
  });

  it("gives every item 2 or 3 drills and notes for its common stacks", () => {
    for (const [l, stacks] of [[backend, ["express", "nestjs", "spring"]], [frontend, ["react", "nextjs", "angular"]]] as const) {
      for (const i of items(l)) {
        expect(i.drills.length, i.id).toBeGreaterThanOrEqual(2);
        expect(Object.keys(i.stack_notes).sort(), i.id).toEqual([...stacks].sort());
      }
    }
  });
});
