import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoachDashboard } from "@ftc/shared";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { coachDashboard } from "./dashboard.js";
import { setTracks } from "./settings.js";

let db: Db;
const NOW = new Date("2026-11-18T12:00:00Z");
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});
afterEach(() => db.close());

const dash = () => coachDashboard(db, { root: "/nowhere", home: "/nowhere", now: NOW });
function evidence(item: string, o: { polarity?: string; ticket?: string; symbol?: string; signal?: string; owned?: number; fixed?: boolean } = {}) {
  db.prepare(
    "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, owned, ticket, signal_id, file_path, symbol, at, fixed_at) VALUES (?, 'builtin/backend', ?, 'rule', ?, 'dev', ?, ?, ?, 'src/pay.ts', ?, '2026-11-10T10:00:00Z', ?)",
  ).run(randomUUID(), item, o.polarity ?? "positive", o.owned ?? 0, o.ticket ?? "T-1", o.signal ?? "err.timeout-set", o.symbol ?? "charge", o.fixed ? "2026-11-11T10:00:00Z" : null);
}

describe("coachDashboard", () => {
  it("is empty and valid before tracks are chosen", () => {
    const d = dash();
    expect(CoachDashboard.safeParse(d).success).toBe(true);
    expect(d.areas).toEqual([]);
  });

  it("shows proficiency and exposure apart, with the evidence behind each state", () => {
    setTracks(db, ["backend"]);
    evidence("BE.ERR.M2");
    const d = dash();
    const parsed = CoachDashboard.safeParse(d);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    const m2 = d.areas[0]!.items.find((i) => i.item_id === "BE.ERR.M2")!;
    expect(m2.state).toBe("not_assessed");
    expect(m2.exposure).toBe("low");
    expect(m2.why_it_matters.length).toBeGreaterThan(10);
    expect(m2.evidence).toHaveLength(1);
    expect(d.ready_for_assessment).toContain("BE.ERR.M2");
  });

  it("lists open faults with who owns them, and what to do first", () => {
    setTracks(db, ["backend"]);
    evidence("BE.ERR.J1", { polarity: "negative", signal: "err.empty-catch", owned: 1 });
    const d = dash();
    expect(d.open_faults).toHaveLength(1);
    expect(d.open_faults[0]).toMatchObject({ item_id: "BE.ERR.J1", owned: true, file: "src/pay.ts" });
    expect(d.next_actions[0]).toMatch(/Fix the open fault in src\/pay\.ts/);
  });

  it("lists repeats, drill results and recent changes", () => {
    setTracks(db, ["backend"]);
    for (const t of ["T-1", "T-2", "T-3"]) evidence("BE.ERR.J1", { polarity: "negative", signal: "err.empty-catch", ticket: t, symbol: `f${t}` });
    db.prepare("INSERT INTO pending_questions (id, kind, ladder_id, item_id, ticket) VALUES ('q', 'drill', 'builtin/backend', 'BE.ERR.M2', 'drill')").run();
    db.prepare("INSERT INTO drill_attempts (id, ladder_id, item_id, drill_id, question_id, passed, created_at) VALUES ('d', 'builtin/backend', 'BE.ERR.M2', 'd1', 'q', 1, '2026-11-15 10:00:00')").run();
    db.prepare("INSERT INTO item_state_history (id, ladder_id, item_id, from_state, to_state, reason) VALUES ('h', 'builtin/backend', 'BE.ERR.M2', 'not_assessed', 'shown', 'why')").run();
    const d = dash();
    expect(d.repeats[0]).toMatchObject({ item_id: "BE.ERR.J1", times: 3 });
    expect(d.drill_results[0]).toMatchObject({ item_id: "BE.ERR.M2", passed: true });
    expect(d.recent_changes[0]).toMatchObject({ item_id: "BE.ERR.M2", direction: "up" });
  });
});
