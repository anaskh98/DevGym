import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_LADDERS } from "./builtin.js";
import { findItem, loadActiveLadders, loadLadder } from "./load.js";
import type { Ladder } from "./schema.js";

let dir: string;
let repo: string;
let home: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ftc-ladder-"));
  repo = join(dir, "repo");
  home = join(dir, "home");
  mkdirSync(join(repo, ".fork-trail-coach"), { recursive: true });
  mkdirSync(join(home, ".fork-trail-coach"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A small company ladder: the built-in backend ladder with only the ERR area. */
function company(extra: Partial<Ladder> = {}): Ladder {
  const backend = structuredClone(BUILTIN_LADDERS.backend);
  return { ...backend, areas: backend.areas.filter((a) => a.id === "ERR"), ...extra };
}
const writeRepo = (value: unknown) => writeFileSync(join(repo, ".fork-trail-coach", "ladder.json"), typeof value === "string" ? value : JSON.stringify(value));
const writeHome = (value: unknown) => writeFileSync(join(home, ".fork-trail-coach", "ladder.json"), JSON.stringify(value));

describe("loadLadder", () => {
  it("uses the built-in ladder when there is no company file", () => {
    const loaded = loadLadder("backend", { repoRoot: repo, home });
    expect(loaded.ladder_id).toBe("builtin/backend");
    expect(loaded.source).toBe("builtin");
    expect(loaded.warning).toBeUndefined();
    expect(loaded.thresholds.proofs).toBe(3);
  });

  it("uses a valid repo file, and it wins over a home file", () => {
    writeHome(company());
    writeRepo(company());
    const loaded = loadLadder("backend", { repoRoot: repo, home });
    expect(loaded.source).toBe("repo");
    expect(loaded.ladder_id).toMatch(/^repo:[0-9a-f]{8}\/backend$/);
    expect(loaded.ladder.areas.map((a) => a.id)).toEqual(["ERR"]);
  });

  it("uses a home file when the repo has none", () => {
    writeHome(company());
    expect(loadLadder("backend", { repoRoot: repo, home }).ladder_id).toBe("home/backend");
  });

  it("falls back to the built-in ladder on bad JSON, and says why", () => {
    writeRepo("{ not json");
    const loaded = loadLadder("backend", { repoRoot: repo, home });
    expect(loaded.source).toBe("builtin");
    expect(loaded.warning).toMatch(/ladder\.json/);
  });

  it("falls back when the file names a signal that does not exist", () => {
    const bad = company();
    const item = bad.areas[0]!.levels.mid[0]!;
    bad.areas[0]!.levels.mid[0] = { ...item, signals: [{ id: "nope.signal", polarity: "positive" }] };
    writeRepo(bad);
    const loaded = loadLadder("backend", { repoRoot: repo, home });
    expect(loaded.source).toBe("builtin");
    expect(loaded.warning).toMatch(/nope\.signal/);
  });

  it("skips a company file with no ladder for this track", () => {
    writeRepo(company());
    expect(loadLadder("frontend", { repoRoot: repo, home }).ladder_id).toBe("builtin/frontend");
  });

  it("reads an array of ladders, one per track", () => {
    writeRepo([company(), { ...BUILTIN_LADDERS.frontend }]);
    expect(loadLadder("frontend", { repoRoot: repo, home }).source).toBe("repo");
  });

  it("merges company thresholds over the defaults", () => {
    writeRepo(company({ thresholds: { proofs: 2 } }));
    const t = loadLadder("backend", { repoRoot: repo, home }).thresholds;
    expect(t.proofs).toBe(2);
    expect(t.tickets).toBe(2);
  });
});

describe("loadActiveLadders", () => {
  it("loads one ladder per chosen track", () => {
    expect(loadActiveLadders(["backend", "frontend"], { repoRoot: repo, home }).map((l) => l.ladder_id)).toEqual([
      "builtin/backend",
      "builtin/frontend",
    ]);
  });
});

describe("findItem", () => {
  it("finds an item with its area and level", () => {
    const found = findItem(BUILTIN_LADDERS.backend, "BE.ERR.M2");
    expect(found?.level).toBe("mid");
    expect(found?.area.id).toBe("ERR");
    expect(findItem(BUILTIN_LADDERS.backend, "BE.ERR.M9")).toBeNull();
  });
});

describe("review fixes: one id for a repo ladder", () => {
  it("gives the same ladder id however the repo path is spelled", () => {
    writeRepo(company());
    const forward = loadLadder("backend", { repoRoot: repo.replaceAll("\\", "/"), home });
    const native = loadLadder("backend", { repoRoot: repo, home });
    const trailing = loadLadder("backend", { repoRoot: `${repo}/`, home });
    expect(forward.source).toBe("repo");
    expect(native.ladder_id).toBe(forward.ladder_id);
    expect(trailing.ladder_id).toBe(forward.ladder_id);
  });
});
