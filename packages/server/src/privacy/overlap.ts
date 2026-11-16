// Code-overlap check: does a piece of text copy a run of code from the repo?
// It compares runs of tokens, so changing spaces or line breaks does not hide a copy.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { cleanText } from "./rules.js";

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".java", ".kt", ".go", ".rs", ".cs", ".rb", ".php",
  ".c", ".h", ".cpp", ".hpp", ".swift", ".scala", ".sql", ".sh", ".vue", ".svelte", ".html", ".css", ".scss",
]);
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", "vendor", "coverage", ".next", ".venv", "venv", "__pycache__",
]);

const WINDOW = 7; // tokens in a row that count as a copy
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const REFRESH_MS = 30_000; // the repo changes while the session codes, so re-read it now and then

const TOKEN = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s\w]/g;
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g;

/**
 * Each quoted string becomes one placeholder token. Code is compared by its shape, and the words
 * inside a string (a UI label, an error message) are prose that an honest summary may repeat.
 */
function tokenize(text: string): string[] {
  return cleanText(text).replace(STRING_LITERAL, " \u0002 ").match(TOKEN) ?? [];
}

/** Every run of WINDOW tokens that looks like code: at least two of the tokens are symbols, not words. */
function* codeWindows(tokens: string[]): Generator<string> {
  for (let i = 0; i + WINDOW <= tokens.length; i++) {
    const window = tokens.slice(i, i + WINDOW);
    if (window.filter((t) => !/^[\w$]/.test(t)).length >= 2) yield window.join("\u0001");
  }
}

function* codeFiles(root: string): Generator<string> {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        yield full;
      }
    }
  }
}

export class RepoCodeIndex {
  private windows = new Set<string>();
  private builtAt = 0;

  constructor(
    private readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  private refresh(): void {
    if (this.builtAt !== 0 && this.now() - this.builtAt < REFRESH_MS) return;
    const windows = new Set<string>();
    let files = 0;
    let bytes = 0;
    for (const file of codeFiles(this.root)) {
      if (files >= MAX_FILES || bytes >= MAX_TOTAL_BYTES) break;
      try {
        const size = statSync(file).size;
        if (size > MAX_FILE_BYTES) continue;
        for (const w of codeWindows(tokenize(readFileSync(file, "utf8")))) windows.add(w);
        files++;
        bytes += size;
      } catch {
        // Unreadable file: skip it.
      }
    }
    this.windows = windows;
    this.builtAt = this.now();
  }

  /** True when the text contains a run of code that also appears in a repo source file. */
  overlaps(text: string): boolean {
    const tokens = tokenize(text);
    if (tokens.length < WINDOW) return false;
    this.refresh();
    if (this.windows.size === 0) return false;
    for (const w of codeWindows(tokens)) if (this.windows.has(w)) return true;
    return false;
  }
}
