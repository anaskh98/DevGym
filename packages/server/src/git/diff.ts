// Reads git diffs: which lines a commit added and removed. Shared by every feature that reads code changes.
import { createHash } from "node:crypto";
import { run, type Run } from "../pointers/git.js";

export interface DiffLine {
  /** Line number in the new file for an added line, in the old file for a removed line. */
  line: number;
  text: string;
}

export interface FileDiff {
  path: string;
  /** The path before a rename, or null. */
  oldPath: string | null;
  added: DiffLine[];
  removed: DiffLine[];
  binary: boolean;
}

/** Removes git's a/ or b/ prefix and the quotes git puts around unusual names. */
function cleanPath(raw: string): string | null {
  let path = raw.trim();
  if (path === "/dev/null") return null;
  if (path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).replace(/\\(["\\])/g, "$1").replace(/\\t/g, "\t");
  }
  return path.replace(/^[ab]\//, "");
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parses `git diff` / `git show` output. Works with -U0 and with context lines. */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/.exec(line);
      file = { path: match?.[2] ?? "", oldPath: null, added: [], removed: [], binary: false };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    if (!inHunk) {
      if (line.startsWith("rename from ")) file.oldPath = line.slice("rename from ".length);
      else if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
      else if (line.startsWith("--- ")) {
        const old = cleanPath(line.slice(4));
        if (old && file.oldPath === null && old !== file.path) file.oldPath = old;
        if (old) file.path = file.path || old;
      } else if (line.startsWith("+++ ")) {
        const next = cleanPath(line.slice(4));
        if (next) file.path = next;
        else if (file.oldPath === null) {
          // A deleted file: keep the old path as its name.
        }
      } else if (line.startsWith("Binary files ")) file.binary = true;
    }
    const hunk = HUNK.exec(line);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) file.added.push({ line: newLine++, text: line.slice(1) });
    else if (line.startsWith("-")) file.removed.push({ line: oldLine++, text: line.slice(1) });
    else if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
    }
  }
  // A deleted file has "+++ /dev/null": its name stays the old one, and it was not renamed.
  for (const f of files) if (f.oldPath === f.path) f.oldPath = null;
  return files;
}

/** The lines one commit added and removed, with no context lines. */
export async function commitDiff(root: string, sha: string, exec: Run = run): Promise<FileDiff[]> {
  const result = await exec("git", ["show", "--format=", "--no-color", "--no-ext-diff", "--text", "--no-textconv", "-U0", "-M", sha], root);
  if (result.code !== 0) throw new Error(`git show ${sha} failed: ${result.stderr.trim()}`);
  return parseUnifiedDiff(result.stdout);
}

/** An id for the change itself, not the commit: a rebased or cherry-picked copy gets the same id. */
export function changeId(diff: FileDiff[]): string {
  const parts = [...diff]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}\n+${f.added.map((l) => l.text).join("\n")}\n-${f.removed.map((l) => l.text).join("\n")}`);
  return createHash("sha256").update(parts.join("\n\0\n")).digest("hex").slice(0, 16);
}
