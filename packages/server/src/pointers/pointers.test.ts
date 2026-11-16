import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import * as store from "../store.js";
import { lookupPr, parseRepoSlug, type Run } from "./git.js";
import { enrichPointer, resolvePointers } from "./service.js";
import { findSymbol, listSymbols, symbolAtLine } from "./symbols.js";

const SOURCE = `import { Order } from "./types";

export const PAGE_SIZE = 100;

export class Exporter {
  private rows = 0;

  run(orders: Order[]): string[] {
    const keep = (order: Order) => {
      return order.status !== "cancelled";
    };
    return orders.filter(keep).map((order) => toRow(order));
  }

  reset = () => {
    this.rows = 0;
  };
}

export const toRow = (order: Order): string => {
  return [order.id, order.total].join(",");
};

function helper() {
  return 1;
}

export interface Order {
  id: string;
}
`;

describe("symbols", () => {
  it("lists declarations with qualified names", async () => {
    const names = (await listSymbols("src/export.ts", SOURCE))?.map((s) => s.name);
    expect(names).toEqual(["PAGE_SIZE", "Exporter", "Exporter.run", "Exporter.run.keep", "Exporter.reset", "toRow", "helper", "Order"]);
  });

  it("finds the innermost declaration around a line", async () => {
    const at = async (line: number) => (await symbolAtLine("src/export.ts", SOURCE, line))?.name ?? null;
    expect(await at(12)).toBe("Exporter.run"); // the return inside run
    expect(await at(10)).toBe("Exporter.run.keep"); // inside the inner arrow function
    expect(await at(16)).toBe("Exporter.reset"); // class field holding a function
    expect(await at(6)).toBe("Exporter"); // a plain field
    expect(await at(21)).toBe("toRow");
    expect(await at(25)).toBe("helper");
    expect(await at(1)).toBeNull(); // an import line
  });

  it("finds a declaration by full or short name", async () => {
    expect(await findSymbol("a.ts", SOURCE, "Exporter.run")).toMatchObject({ name: "Exporter.run", startLine: 8, endLine: 13 });
    expect((await findSymbol("a.ts", SOURCE, "run"))?.name).toBe("Exporter.run");
    expect(await findSymbol("a.ts", SOURCE, "missing")).toBeNull();
  });

  it("does not guess when a short name is ambiguous", async () => {
    const two = "class A { run() {} }\nclass B { run() {} }\n";
    expect(await findSymbol("a.ts", two, "run")).toBeNull();
    expect((await findSymbol("a.ts", two, "B.run"))?.startLine).toBe(2);
  });

  it("handles TSX and JavaScript, and skips other languages", async () => {
    expect((await symbolAtLine("Button.tsx", "export function Button() {\n  return <button>Go</button>;\n}\n", 2))?.name).toBe("Button");
    expect((await symbolAtLine("lib.js", "module.exports.run = 1;\nfunction go() {\n  return 2;\n}\n", 3))?.name).toBe("go");
    expect(await listSymbols("main.py", "def go():\n    return 1\n")).toBeNull();
    expect(await symbolAtLine("notes.md", "# hi", 1)).toBeNull();
  });
});

describe("parseRepoSlug", () => {
  it("reads owner/name from https and ssh remotes", () => {
    expect(parseRepoSlug("https://github.com/team/roomly.git\n")).toBe("team/roomly");
    expect(parseRepoSlug("https://github.com/team/roomly")).toBe("team/roomly");
    expect(parseRepoSlug("git@github.com:team/room.ly.git")).toBe("team/room.ly");
    expect(parseRepoSlug("https://gitlab.com/team/roomly.git")).toBeNull();
  });
});

describe("lookupPr", () => {
  const gh = (result: { code: number | null; stdout?: string; stderr?: string }): Run => async (command) =>
    command === "gh" ? { code: result.code, stdout: result.stdout ?? "", stderr: result.stderr ?? "" } : { code: 1, stdout: "", stderr: "" };

  it("uses the merge commit of a merged PR", async () => {
    const exec = gh({ code: 0, stdout: JSON.stringify({ number: 7, state: "MERGED", mergeCommit: { oid: "a".repeat(40) }, headRefOid: "b".repeat(40), url: "u" }) });
    expect(await lookupPr("team/roomly", 7, ".", { exec })).toEqual({ number: 7, state: "merged", commit: "a".repeat(40), url: "u" });
  });

  it("uses the branch head of an open PR", async () => {
    const exec = gh({ code: 0, stdout: JSON.stringify({ number: 7, state: "OPEN", mergeCommit: null, headRefOid: "b".repeat(40), url: "u" }) });
    expect(await lookupPr("team/roomly", undefined, ".", { exec })).toMatchObject({ state: "open", commit: "b".repeat(40) });
  });

  it("reports a gh failure in plain words", async () => {
    const exec = gh({ code: 1, stderr: "no pull requests found for branch main\nmore" });
    await expect(lookupPr("team/roomly", undefined, ".", { exec })).rejects.toThrow(/no pull requests found for branch main/);
  });

  it("falls back to the public API when gh is not installed and the number is known", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ number: 7, state: "closed", merged: true, merge_commit_sha: "c".repeat(40), head: { sha: "d".repeat(40) }, html_url: "h" }));
    }) as typeof fetch;
    const pr = await lookupPr("team/roomly", 7, ".", { exec: gh({ code: null }), fetch: fakeFetch });
    expect(pr).toEqual({ number: 7, state: "merged", commit: "c".repeat(40), url: "h" });
    expect(calls).toEqual(["https://api.github.com/repos/team/roomly/pulls/7"]);
  });

  it("explains what to do when gh is missing and nothing else is known", async () => {
    await expect(lookupPr("team/roomly", undefined, ".", { exec: gh({ code: null }) })).rejects.toThrow(/not installed.*pr_number or commit/);
    const notFound = (async () => new Response("{}", { status: 404 })) as typeof fetch;
    await expect(lookupPr("team/roomly", 9, ".", { exec: gh({ code: null }), fetch: notFound })).rejects.toThrow(/HTTP 404.*private repository/);
  });
});

// A real repository on disk, with a real squash merge.
describe("pointers through a squash merge", () => {
  let repo: string;
  let db: Db;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8" }).trim();
  const write = (file: string, text: string) => writeFileSync(join(repo, file), text);

  const BASE = `export function listOrders() {\n  return [];\n}\n`;
  const FEATURE = `export function listOrders() {\n  return [];\n}\n\nexport function exportOrders(limit: number) {\n  const capped = Math.min(limit, 5000);\n  return listOrders().slice(0, capped);\n}\n\nexport class Pager {\n  next() {\n    return 1;\n  }\n}\n`;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "ftc-pointers-"));
    mkdirSync(join(repo, "src"));
    git("init", "-q", "-b", "main");
    git("remote", "add", "origin", "https://github.com/team/roomly.git");
    write("src/orders.ts", BASE);
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    db = openDb(":memory:");
    migrate(db);
    store.upsertTicket(db, { id: "T-1", title: "t", body: "b", source: "test" });
  });
  afterEach(() => {
    db.close();
    rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function log(pointer: { file_path: string; line_hint?: number; symbol?: string }) {
    const enriched = await enrichPointer({ repo: "wrong/guess", ...pointer }, repo);
    return store.logDecision(db, { ticket_id: "T-1", session_id: "s1", summary: "s", alternatives: [], origin: "ai", related_files: [], pointer: enriched }, repo);
  }
  const pointerRows = () =>
    db.prepare("SELECT file_path, symbol, line_hint, repo, commit_sha, pr_number, resolved, resolve_note FROM pointers ORDER BY rowid").all().map((r) => ({ ...r }));
  const mergedPr = (commit: string): Run => async (command, args, cwd) => {
    if (command !== "gh") return (await import("./git.js")).run(command, args, cwd);
    return { code: 0, stdout: JSON.stringify({ number: 12, state: "MERGED", mergeCommit: { oid: commit }, headRefOid: "0".repeat(40), url: "https://github.com/team/roomly/pull/12" }), stderr: "" };
  };

  it("fills the repo and the function name when a decision is logged", async () => {
    write("src/orders.ts", FEATURE);
    await log({ file_path: join(repo, "src", "orders.ts"), line_hint: 6 });
    await log({ file_path: "src/orders.ts", symbol: "next" });
    await log({ file_path: "src/not-written-yet.ts", line_hint: 3, symbol: "guess" });
    expect(pointerRows()).toMatchObject([
      { file_path: "src/orders.ts", symbol: "exportOrders", line_hint: 6, repo: "team/roomly" },
      { file_path: "src/orders.ts", symbol: "Pager.next", line_hint: 11, repo: "team/roomly" },
      { file_path: "src/not-written-yet.ts", symbol: "guess", line_hint: 3, repo: "team/roomly" },
    ]);
  });

  it("moves every pointer to the merge commit and they all still resolve", async () => {
    // Work on a branch, in two commits, logging decisions as the code is written.
    git("checkout", "-q", "-b", "feature");
    write("src/orders.ts", FEATURE);
    git("commit", "-q", "-am", "add export");
    await log({ file_path: "src/orders.ts", line_hint: 6 });
    await log({ file_path: "src/orders.ts", line_hint: 12 });
    write("src/notes.md", "# Notes\n");
    git("add", "-A");
    git("commit", "-q", "-m", "notes");
    await log({ file_path: "src/notes.md" });
    const branchHead = git("rev-parse", "HEAD");

    // Meanwhile main moves: new lines above our code, so every line number shifts.
    git("checkout", "-q", "main");
    write("src/orders.ts", `// Orders module\n// Owner: platform\n\n${BASE}`);
    git("commit", "-q", "-am", "header");

    // Squash merge, then delete the branch: its commits are no longer reachable from main.
    git("merge", "-q", "--squash", "feature");
    git("commit", "-q", "-m", "Add export (#12)");
    const mergeCommit = git("rev-parse", "HEAD");
    git("branch", "-q", "-D", "feature");
    expect(mergeCommit).not.toBe(branchHead);

    const result = await resolvePointers(db, { ticketId: "T-1", root: repo }, { exec: mergedPr(mergeCommit) });
    expect(result).toMatchObject({ repo: "team/roomly", commit: mergeCommit, total: 3, resolved: 3, broken: [], pr: { number: 12, state: "merged" } });
    expect(pointerRows()).toMatchObject([
      { symbol: "exportOrders", line_hint: 8, commit_sha: mergeCommit, pr_number: 12, resolved: 1, resolve_note: null },
      { symbol: "Pager.next", line_hint: 14, commit_sha: mergeCommit, pr_number: 12, resolved: 1 },
      { file_path: "src/notes.md", symbol: null, commit_sha: mergeCommit, resolved: 1 },
    ]);
  });

  it("flags a pointer whose function or file is gone, with the reason", async () => {
    write("src/orders.ts", FEATURE);
    write("src/old.ts", "export const x = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "feature");
    await log({ file_path: "src/orders.ts", line_hint: 6 });
    await log({ file_path: "src/orders.ts", line_hint: 12 });
    await log({ file_path: "src/old.ts", line_hint: 1 });

    write("src/orders.ts", FEATURE.replace("exportOrders", "exportAll"));
    git("rm", "-q", "src/old.ts");
    git("commit", "-q", "-am", "rename and delete");
    const commit = git("rev-parse", "HEAD");

    const result = await resolvePointers(db, { ticketId: "T-1", root: repo, commit });
    expect(result).toMatchObject({ total: 3, resolved: 1, pr: null });
    expect(result.broken).toMatchObject([
      { file_path: "src/orders.ts", symbol: "exportOrders", reason: "'exportOrders' is no longer in the file" },
      { file_path: "src/old.ts", reason: "The file does not exist at this commit" },
    ]);
    expect(pointerRows().map((p) => p.resolved)).toEqual([0, 1, 0]);

    // Fixing the code and checking again clears the flag.
    write("src/orders.ts", FEATURE);
    git("commit", "-q", "-am", "rename back");
    const again = await resolvePointers(db, { ticketId: "T-1", root: repo, commit: git("rev-parse", "HEAD") });
    expect(again.broken.map((b) => b.file_path)).toEqual(["src/old.ts"]);
  });

  it("gives clear errors for an unknown ticket or commit", async () => {
    await expect(resolvePointers(db, { ticketId: "NOPE", root: repo, commit: git("rev-parse", "HEAD") })).rejects.toThrow(/does not exist/);
    const noFetch: Run = async (command, args, cwd) =>
      args[0] === "fetch" ? { code: 1, stdout: "", stderr: "" } : (await import("./git.js")).run(command, args, cwd);
    await expect(resolvePointers(db, { ticketId: "T-1", root: repo, commit: "f".repeat(40) }, { exec: noFetch })).rejects.toThrow(/not in this clone/);
  });
});
