import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAnnotation } from "../api/data.js";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { run, type Run } from "../pointers/git.js";
import { enrichPointer } from "../pointers/service.js";
import * as store from "../store.js";
import { buildDecisionsSection, mergeSection, SECTION_END, SECTION_START } from "./section.js";
import { updatePrDecisions } from "./update.js";

let db: Db;
let repo: string;
let head: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8" }).trim();

// Profile data. None of these strings may ever show up in the PR section.
const PRIVATE = {
  session: "session-7f3a-private",
  developer: "dev-omar-private",
  question: "Why was the limit set to this private value?",
  answer: "Honestly I do not know, the AI picked it.",
  observation: "Could not explain the limit without help.",
  claim: "One answer suggests a gap in reasoning about limits.",
  exercise: "Write the limit down before coding next time.",
  note: "I disagree with this private note.",
};

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "devgym-pr-test-"));
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "export.ts"), "export function exportOrders(limit: number) {\n  const capped = Math.min(limit, 5000);\n  return capped;\n}\n");
  git("init", "-q", "-b", "feature");
  git("remote", "add", "origin", "https://github.com/team/roomly.git");
  git("add", "-A");
  git("commit", "-q", "-m", "feature");
  head = git("rev-parse", "HEAD");

  db = openDb(":memory:");
  migrate(db);
  store.upsertTicket(db, { id: "T-1", title: "Export orders | fast", body: "Ticket body stays local", source: "test" });
  store.saveAssumptions(db, {
    ticket_id: "T-1",
    assumptions: [
      { text: "What does 'recent' mean?", status: "answered_by_po", answer: "Last 90 days" },
      { text: "Which format?\nOne or many?", status: "assumed_by_dev", answer: "Assuming: CSV | one file" },
    ],
  });
  const pointer = await enrichPointer({ repo: "x/y", file_path: "src/export.ts", line_hint: 2 }, repo);
  const d = store.logDecision(
    db,
    { ticket_id: "T-1", session_id: PRIVATE.session, summary: "Cap one export at 5000 rows, ask @alice", alternatives: ["No cap", "Cap at 1000"], origin: "ai", related_files: [], pointer },
    repo,
  );
  store.logDecision(db, { ticket_id: "T-1", session_id: PRIVATE.session, summary: "Keep cancelled orders", alternatives: [], origin: "dev_changed_ai", related_files: [] }, repo);
  const e = store.recordExplainBack(db, { decision_id: d.decision_id, question: PRIVATE.question, answer: PRIVATE.answer, rating: "not_yet" });
  const o = store.saveObservation(db, { developer_id: PRIVATE.developer, skill_tag: "limits-private", summary: PRIVATE.observation, evidence_ids: [d.decision_id, e.explain_back_id] });
  store.saveGrowthPlan(db, { developer_id: PRIVATE.developer, focus_areas: [{ claim: PRIVATE.claim, evidence_ids: [o.observation_id], exercise: PRIVATE.exercise }] });
  addAnnotation(db, { target_id: d.decision_id, note: PRIVATE.note, disagrees: true });
});
afterEach(() => {
  db.close();
  rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("buildDecisionsSection", () => {
  it("lists assumptions and decisions with origin, alternatives and where", () => {
    const { markdown, assumptions, decisions } = buildDecisionsSection(db, "T-1");
    expect({ assumptions, decisions }).toEqual({ assumptions: 2, decisions: 2 });
    expect(markdown.startsWith(SECTION_START)).toBe(true);
    expect(markdown.endsWith(SECTION_END)).toBe(true);
    expect(markdown).toContain("## Decisions");
    expect(markdown).toContain("| What does 'recent' mean? | Answered by PO | Last 90 days |");
    expect(markdown).toContain("1 of 2 is an assumption the product owner has not confirmed.");
    expect(markdown).toContain("   - Who chose: AI chose");
    expect(markdown).toContain("   - Alternatives considered: No cap; Cap at 1000");
    expect(markdown).toContain("   - Where: `src/export.ts` · `exportOrders`");
    expect(markdown).toContain("2. **Keep cancelled orders**\n   - Who chose: Developer changed the AI's choice\n");
  });

  it("keeps text from breaking the table or pinging people", () => {
    const { markdown } = buildDecisionsSection(db, "T-1");
    expect(markdown).toContain("Export orders \\| fast");
    expect(markdown).toContain("| Which format? One or many? | Assumed by dev | Assuming: CSV \\| one file |");
    expect(markdown).not.toContain("@alice");
    expect(markdown).toContain("@​alice");
  });

  it("contains no profile data", () => {
    const { markdown } = buildDecisionsSection(db, "T-1");
    for (const [kind, text] of Object.entries(PRIVATE)) expect(markdown, kind).not.toContain(text);
    for (const word of ["not_yet", "limits-private", "Ticket body stays local", "tentative", "explain", "rating"]) {
      expect(markdown.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
  });

  it("links a pointer once it has a commit, and marks a broken one", () => {
    db.prepare("UPDATE pointers SET commit_sha = 'abc1234', resolved = 1").run();
    expect(buildDecisionsSection(db, "T-1").markdown).toContain(
      "[`src/export.ts` · `exportOrders`](https://github.com/team/roomly/blob/abc1234/src/export.ts#L2)",
    );
    db.prepare("UPDATE pointers SET resolved = 0").run();
    const broken = buildDecisionsSection(db, "T-1").markdown;
    expect(broken).toContain("`src/export.ts` · `exportOrders` (this pointer no longer finds its code)");
    expect(broken).not.toContain("https://github.com/team/roomly/blob");
  });

  it("refuses an unknown ticket and a ticket with nothing to share", () => {
    expect(() => buildDecisionsSection(db, "NOPE")).toThrow(/does not exist/);
    store.upsertTicket(db, { id: "T-2", title: "Empty", body: "b", source: "test" });
    expect(() => buildDecisionsSection(db, "T-2")).toThrow(/no assumptions and no decisions/);
  });
});

describe("mergeSection", () => {
  const section = `${SECTION_START}\nNEW\n${SECTION_END}`;
  it("adds the section to the end of a description", () => {
    expect(mergeSection("Fixes the export.\n\n", section)).toBe(`Fixes the export.\n\n${section}\n`);
    expect(mergeSection("", section)).toBe(`${section}\n`);
  });
  it("replaces an earlier section and leaves the rest alone", () => {
    const body = `Intro\n\n${SECTION_START}\nOLD\n${SECTION_END}\n\n## Testing\nRan it.`;
    const merged = mergeSection(body, section);
    expect(merged).toBe(`Intro\n\n${section}\n\n## Testing\nRan it.`);
    expect(mergeSection(merged, section)).toBe(merged);
  });
});

describe("updatePrDecisions", () => {
  /** A fake gh. Real git still runs, so pointers are checked against the real temp repo. */
  function fakeGh(options: { body?: string; state?: string; missing?: boolean; editFails?: boolean } = {}) {
    const calls: string[][] = [];
    let written: string | null = null;
    let fileGone = false;
    let bodyFile = "";
    const exec: Run = async (command, args, cwd) => {
      if (command !== "gh") return run(command, args, cwd);
      calls.push(args);
      if (options.missing) return { code: null, stdout: "", stderr: "" };
      if (args[1] === "view" && args.includes("number,state,mergeCommit,headRefOid,url")) {
        const merged = options.state === "MERGED";
        return { code: 0, stdout: JSON.stringify({ number: 12, state: options.state ?? "OPEN", mergeCommit: merged ? { oid: head } : null, headRefOid: head, url: "https://github.com/team/roomly/pull/12" }), stderr: "" };
      }
      if (args[1] === "view") return { code: 0, stdout: JSON.stringify({ body: options.body ?? "" }), stderr: "" };
      if (args[1] === "edit") {
        if (options.editFails) return { code: 1, stdout: "", stderr: "GraphQL: Resource not accessible\n" };
        bodyFile = args[args.indexOf("--body-file") + 1] as string;
        written = readFileSync(bodyFile, "utf8");
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "unexpected" };
    };
    return { exec, calls, written: () => written, bodyFileExists: () => (bodyFile ? existsSync(bodyFile) : fileGone) };
  }

  it("writes the section into the PR body, with links pinned to the PR commit", async () => {
    const gh = fakeGh({ body: "Adds the export.\r\n\r\n## Testing\r\nRan it." });
    const result = await updatePrDecisions(db, { ticketId: "T-1", root: repo }, { exec: gh.exec });
    expect(result).toMatchObject({ updated: true, note: null, assumptions: 2, decisions: 2, pr: { number: 12, state: "open" }, pointers: { total: 1, resolved: 1, broken: 0 } });

    const body = gh.written() as string;
    expect(body.startsWith("Adds the export.\n\n## Testing\nRan it.\n\n" + SECTION_START)).toBe(true);
    expect(body).toContain(`(https://github.com/team/roomly/blob/${head}/src/export.ts#L1)`);
    for (const text of Object.values(PRIVATE)) expect(body).not.toContain(text);

    const edit = gh.calls.find((c) => c[1] === "edit") as string[];
    expect(edit.slice(0, 5)).toEqual(["pr", "edit", "12", "--repo", "team/roomly"]);
    expect(gh.bodyFileExists()).toBe(false); // the temporary file is removed
  });

  it("replaces its own earlier section when run again", async () => {
    const first = fakeGh({ body: "Intro" });
    await updatePrDecisions(db, { ticketId: "T-1", root: repo }, { exec: first.exec });
    store.logDecision(db, { ticket_id: "T-1", session_id: "s", summary: "Third decision", alternatives: [], origin: "dev", related_files: [] }, repo);
    const second = fakeGh({ body: first.written() as string });
    await updatePrDecisions(db, { ticketId: "T-1", root: repo, prNumber: 12 }, { exec: second.exec });
    const body = second.written() as string;
    expect(body.split(SECTION_START)).toHaveLength(2);
    expect(body).toContain("3. **Third decision**");
    expect(body.startsWith("Intro\n\n")).toBe(true);
  });

  it("does not touch the pull request on a dry run", async () => {
    const gh = fakeGh();
    const result = await updatePrDecisions(db, { ticketId: "T-1", root: repo, dryRun: true }, { exec: gh.exec });
    expect(result).toMatchObject({ updated: false, note: "Preview only. The pull request was not changed.", pr: { number: 12 } });
    expect(result.markdown).toContain("## Decisions");
    expect(gh.calls.some((c) => c[1] === "edit")).toBe(false);
  });

  it("still gives a preview when gh is missing, and says why it cannot update", async () => {
    const gh = fakeGh({ missing: true });
    const preview = await updatePrDecisions(db, { ticketId: "T-1", root: repo, dryRun: true }, { exec: gh.exec });
    expect(preview.updated).toBe(false);
    expect(preview.note).toMatch(/not installed/);
    expect(preview.markdown).toContain("1. **Cap one export at 5000 rows");
    await expect(updatePrDecisions(db, { ticketId: "T-1", root: repo }, { exec: gh.exec })).rejects.toThrow(/not installed/);
  });

  it("reports a failed update and an empty ticket in plain words", async () => {
    await expect(updatePrDecisions(db, { ticketId: "T-1", root: repo }, { exec: fakeGh({ editFails: true }).exec })).rejects.toThrow(
      /could not update the pull request: GraphQL: Resource not accessible/,
    );
    store.upsertTicket(db, { id: "T-2", title: "Empty", body: "b", source: "test" });
    const gh = fakeGh();
    await expect(updatePrDecisions(db, { ticketId: "T-2", root: repo }, { exec: gh.exec })).rejects.toThrow(/no assumptions and no decisions/);
    expect(gh.calls).toEqual([]);
  });
});
