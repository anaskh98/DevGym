import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changeId, commitDiff, parseUnifiedDiff } from "./diff.js";
import { currentBranch, defaultBranchCommits, developerEmails, isGitRepo, listCommits, repoTopLevel } from "./log.js";

let repo: string;

function git(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

/** Writes files and commits them as the given author. Returns the commit id. */
function commit(files: Record<string, string>, message: string, email = "dev@example.com", date = "2026-11-10T10:00:00Z"): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message], {
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_NAME: "A",
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
  return git(["rev-parse", "HEAD"]);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ftc-git-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "Dev@Example.com"]);
  git(["config", "user.name", "Dev"]);
  git(["config", "commit.gpgsign", "false"]);
});
afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

describe("parseUnifiedDiff", () => {
  it("reads added and removed lines with their line numbers, and strips \\r", () => {
    const text = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3 +3,2 @@",
      "-old line\r",
      "+new line\r",
      "+second",
      "diff --git a/img.png b/img.png",
      "Binary files a/img.png and b/img.png differ",
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    const files = parseUnifiedDiff(text);
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "img.png", "gone.ts"]);
    expect(files[0]!.added).toEqual([
      { line: 3, text: "new line" },
      { line: 4, text: "second" },
    ]);
    expect(files[0]!.removed).toEqual([{ line: 3, text: "old line" }]);
    expect(files[1]!.binary).toBe(true);
    expect(files[2]!.removed).toEqual([{ line: 1, text: "bye" }]);
  });

  it("follows a rename", () => {
    const text = ["diff --git a/old.ts b/new.ts", "similarity index 90%", "rename from old.ts", "rename to new.ts", "--- a/old.ts", "+++ b/new.ts", "@@ -2 +2 @@", "-a", "+b"].join("\n");
    const [file] = parseUnifiedDiff(text);
    expect(file!.path).toBe("new.ts");
    expect(file!.oldPath).toBe("old.ts");
  });
});

describe("commitDiff and changeId", () => {
  it("reads a real commit's added and removed lines", async () => {
    commit({ "src/pay.ts": "a\nb\nc\n" }, "first");
    const sha = commit({ "src/pay.ts": "a\nB\nc\nd\n" }, "second");
    const [file] = await commitDiff(repo, sha);
    expect(file!.path).toBe("src/pay.ts");
    expect(file!.added.map((l) => l.text)).toEqual(["B", "d"]);
    expect(file!.removed.map((l) => l.text)).toEqual(["b"]);
  });

  it("gives the same change id to a cherry-picked commit", async () => {
    commit({ "base.txt": "base\n" }, "base");
    git(["checkout", "-q", "-b", "feature"]);
    const original = commit({ "src/x.ts": "const x = 1;\n" }, "add x");
    git(["checkout", "-q", "main"]);
    commit({ "other.txt": "o\n" }, "other");
    git(["cherry-pick", original]);
    const picked = git(["rev-parse", "HEAD"]);
    expect(picked).not.toBe(original);
    expect(changeId(await commitDiff(repo, picked))).toBe(changeId(await commitDiff(repo, original)));
  });
});

describe("log helpers", () => {
  it("lists only the developer's commits, oldest first, by email in any case", async () => {
    commit({ "a.txt": "1\n" }, "mine 1", "dev@example.com", "2026-11-01T10:00:00Z");
    commit({ "b.txt": "1\n" }, "theirs", "other@example.com", "2026-11-02T10:00:00Z");
    commit({ "c.txt": "1\n" }, "mine 2", "DEV@example.com", "2026-11-03T10:00:00Z");
    const emails = await developerEmails(repo, ["Second@Example.com"]);
    expect(emails).toEqual(["dev@example.com", "second@example.com"]);
    const commits = await listCommits(repo, { authorEmails: emails });
    expect(commits.map((c) => c.subject)).toEqual(["mine 1", "mine 2"]);
    expect(commits[0]!.authorDate).toMatch(/^2026-11-01T10:00:00/);
    const since = await listCommits(repo, { authorEmails: emails, sinceIso: "2026-11-02T00:00:00Z" });
    expect(since.map((c) => c.subject)).toEqual(["mine 2"]);
  });

  it("knows the repo, the branch and the default branch commits", async () => {
    const first = commit({ "a.txt": "1\n" }, "one");
    git(["checkout", "-q", "-b", "PAY-1-feature"]);
    const second = commit({ "b.txt": "1\n" }, "two");
    expect(await isGitRepo(repo)).toBe(true);
    expect(await currentBranch(repo)).toBe("PAY-1-feature");
    const onMain = await defaultBranchCommits(repo);
    expect(onMain.has(first)).toBe(true);
    expect(onMain.has(second)).toBe(false);
    expect((await repoTopLevel(join(repo)))?.toLowerCase()).toBe(repo.replaceAll("\\", "/").toLowerCase());
  });

  it("answers plainly outside a git repo", async () => {
    const plain = mkdtempSync(join(tmpdir(), "ftc-plain-"));
    try {
      expect(await isGitRepo(plain)).toBe(false);
      expect(await repoTopLevel(plain)).toBeNull();
      expect(await currentBranch(plain)).toBeNull();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
