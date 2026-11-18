# Coach Levels, Stage 1 (Levels Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Coach into a level-based study guide: a BE/FE ladder, silent capture of the developer's own code
from commits, a state engine that decides each item's state (Not seen → Learning → Shown → Proven), questions
whose answers the prompt hook captures word for word, drills, and a growth plan made of fixed frames.

**Architecture:** A new `packages/server/src/coach/` module holds the ladder, capture, state engine, questions,
drills and plan. Two shared, neutral helpers are written fresh on `dev`: `src/rules/engine.ts` (regex line rules)
and `src/git/` (diff and log reading). Plain code computes every state; the AI only words questions, rates answers
with quotes the server checks, and fills in plan wording. New MCP tools expose this to rewritten skills.

**Tech Stack:** TypeScript 7, Node 22.13+ (`node:sqlite`), zod 4, `@modelcontextprotocol/sdk` 1.32, vitest 5,
esbuild bundle, web-tree-sitter (existing `symbolAtLine`).

**Spec:** `docs/superpowers/specs/2026-11-18-developer-growth-design.md` (section 8, stage 1). Stage 2 (ownership
and history) and stage 3 (ticket check) get their own plans after this one ships.

**What stage 1 leaves out on purpose:** quote-checked decision origin, the PR-time AI fault review, the history scan
of past commits, shipped bugs and repeats (all stage 2); the ticket check (stage 3). The state engine already
implements the full credit table of spec 6.3, so stage 2 only fills in new data.

## Global Constraints

- Node 22.13 or newer. Run every command with `export PATH="/c/Users/DELL/AppData/Local/nvm/v22.23.4:$PATH"` first; pnpm runs as `corepack pnpm`.
- Work on branch `dev`. Never push `path/evidence` or `path/quality`. Do not push without the user's OK.
- Migrations are append-only. This plan adds migration **id 7** only. Ids 4, 5, 6 must stay unused on `dev`.
- No code is ever stored: only paths, symbol names, commit ids, line hashes, rule ids, and the developer's own words.
- Every stored text goes through the existing `PrivacyGuard` (`guard.check(...)`) before saving.
- Hooks never break the session: every failure ends with exit code 0 and no stdout.
- The bundle in `packages/plugin/server/` is committed; rebuild it (`corepack pnpm build`) in any task that changes hook or server code.
- User-facing text (skills, tool descriptions, the progress view) uses short, simple English.
- Default thresholds, exact values: 3 proofs, 2 tickets, 60-day window, 2 clear answers, judge cap 1, drill retry after 3 days, question timeout 30 minutes, at most 3 questions, line hashes kept 120 days, at most 200 commits per catch-up run.
- Line hash: remove all whitespace, turn `'` and `` ` `` into `"`, drop one trailing `,` or `;`; skip if shorter than 4 characters; SHA-256 hex, first 16 characters.
- Levels are `junior`, `mid`, `senior`, `staff`. Item ids look like `BE.ERR.M2`: track `BE`/`FE`, area code, level letter `J`/`M`/`S`/`X` (`X` = staff), number.

## Review Focus

1. **No git, no commits, or no `user.email`.** `/coach` in a folder that is not a git repo, or where the developer has no commits, must return a clear note and an empty view, never an error. Test in Task 8.
2. **Huge or generated files** (lockfiles, `dist/`, minified bundles, a 20,000-line generated file). Catch-up must skip them, stay fast, and add no proofs from them. Test in Task 8.
3. **A clarifying reply while a question is open** ("wait, what do you mean by timeout?"). It must not be saved as the answer; the question stays open. Also a slash command typed while a question is open is not an answer. Test in Task 11.
4. **Windows line endings.** A line Claude wrote with `\r\n` and the same line in a commit diff must hash the same. Test in Task 6.
5. **Evidence for items no longer in the ladder** (a company file renamed or removed an item). The view and the state engine must ignore those rows without crashing. Test in Task 10.

---

### Task 1: Migration 7 `coach_levels`

**Files:**
- Modify: `packages/server/src/db/migrations.ts` (append to `migrations`)
- Test: `packages/server/src/db/db.test.ts`

**Interfaces:**
- Produces: tables used by every later task, with these exact names and columns:
  - `ai_line_hashes(repo_root TEXT, file_path TEXT, hash TEXT, session_id TEXT, created_at TEXT DEFAULT now, PRIMARY KEY(repo_root, file_path, hash))`, index on `(repo_root, created_at)`.
  - `commits_seen(repo_root TEXT, sha TEXT, change_id TEXT, history INTEGER NOT NULL DEFAULT 0 CHECK 0/1, processed_at TEXT DEFAULT now, PRIMARY KEY(repo_root, sha))`, index on `(repo_root, change_id)`.
  - `skill_evidence(id TEXT PK, ladder_id TEXT, item_id TEXT, kind TEXT CHECK IN ('rule','judge','decision','review','ticket_check'), polarity TEXT CHECK IN ('positive','negative'), author TEXT CHECK IN ('ai','dev','unknown'), decided_by TEXT NULL CHECK IN ('ai','dev'), owned INTEGER DEFAULT 0 CHECK 0/1, regresses INTEGER DEFAULT 0 CHECK 0/1, history INTEGER DEFAULT 0 CHECK 0/1, repo_root TEXT, commit_sha TEXT, file_path TEXT, symbol TEXT, ticket TEXT NOT NULL, signal_id TEXT, note TEXT, at TEXT NOT NULL, fixed_at TEXT, fixed_ticket TEXT, disagreed_at TEXT, disagree_reason TEXT, created_at TEXT DEFAULT now)`, index on `(ladder_id, item_id)`.
  - `pending_questions(id TEXT PK, kind TEXT CHECK IN ('why','explain_back','drill'), ladder_id TEXT, item_id TEXT, target_ref TEXT, decision_id TEXT NULL REFERENCES decisions(id) ON DELETE SET NULL, ticket TEXT NOT NULL, question TEXT, created_at TEXT DEFAULT now, opened_at TEXT, open_session TEXT, answer TEXT, answered_at TEXT, closed_reason TEXT CHECK IN ('answered','later','timeout') OR NULL, rating TEXT CHECK IN ('clear','partial','not_yet') OR NULL, names_tradeoff INTEGER DEFAULT 0, tradeoff_quote TEXT, rated_at TEXT)`, index on `(open_session)`.
  - `drill_attempts(id TEXT PK, ladder_id TEXT, item_id TEXT, drill_id TEXT, question_id TEXT REFERENCES pending_questions(id) ON DELETE CASCADE, hits TEXT CHECK json_valid, red_flags TEXT CHECK json_valid, passed INTEGER CHECK 0/1, void INTEGER DEFAULT 0 CHECK 0/1, created_at TEXT DEFAULT now)`.
  - `item_state_history(id TEXT PK, ladder_id TEXT, item_id TEXT, from_state TEXT, to_state TEXT, reason TEXT, at TEXT DEFAULT now)`.
  - `coach_settings(key TEXT PK, value TEXT CHECK json_valid)`.
  - `stack_notes_local(ladder_id TEXT, item_id TEXT, stack_id TEXT, note TEXT, link TEXT, created_at TEXT DEFAULT now, PRIMARY KEY(ladder_id, item_id, stack_id))`.
  - `ALTER TABLE decisions ADD COLUMN ladder_id TEXT; ADD COLUMN item_id TEXT`.
  - `ALTER TABLE explain_backs ADD COLUMN question_id TEXT; ADD COLUMN item_id TEXT`.

- [ ] **Step 1: Write the failing tests** in `db.test.ts`:

```ts
it("creates the coach level tables (migration 7)", () => {
  const names = tableNames(db); // existing helper pattern in this file
  for (const t of ["ai_line_hashes", "commits_seen", "skill_evidence", "pending_questions", "drill_attempts",
    "item_state_history", "coach_settings", "stack_notes_local"]) expect(names).toContain(t);
  expect(db.prepare("SELECT name FROM schema_migrations WHERE id = 7").get()).toEqual({ name: "coach_levels" });
});
it("leaves migration ids 4, 5 and 6 unused", () => {
  expect(migrations.map((m) => m.id)).not.toEqual(expect.arrayContaining([4]));
  expect(migrations.some((m) => m.id === 5 || m.id === 6)).toBe(false);
});
it("rejects an unknown evidence kind and polarity", () => {
  const insert = (kind: string, polarity: string) => db.prepare(
    "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, at) VALUES (?, 'builtin/backend', 'BE.ERR.M2', ?, ?, 'dev', 'T-1', '2026-11-01')",
  ).run(randomUUID(), kind, polarity);
  expect(() => insert("guess", "positive")).toThrow();
  expect(() => insert("rule", "maybe")).toThrow();
});
```

- [ ] **Step 2: Run to see them fail**
  Run: `corepack pnpm --filter @ftc/server exec vitest run src/db/db.test.ts`
  Expected: FAIL (tables missing).
- [ ] **Step 3: Add migration `{ id: 7, name: "coach_levels", sql }`** with the tables above. Keep the comment style of earlier migrations: one comment line per table saying what it holds and that no code is stored. Update the "Id 4 is left free" comment to say ids 4 to 6 are used on other branches.
- [ ] **Step 4: Run the tests** (same command). Expected: PASS.
- [ ] **Step 5: Commit** `git add packages/server/src/db && git commit -m "Add migration 7 for coach levels"`

---

### Task 2: Shared regex line rules engine

**Files:**
- Create: `packages/server/src/rules/engine.ts`
- Test: `packages/server/src/rules/engine.test.ts`

**Interfaces:**
- Produces:
  - `interface LineRule { id: string; pattern: RegExp; unless?: RegExp; extensions: readonly string[] }` (extensions lowercase with dot, e.g. `".ts"`; empty list = all code files)
  - `isCodeLine(line: string): boolean` — false for blank lines, comment lines (`//`, `#`, `--`, `/*`, `*` continuation, `<!--`), and whole-line imports (`import ... from`, `import "x"`, `const x = require(...)`, `using X;`, `package x;`, `from x import y`).
  - `ruleMatches(rule: LineRule, filePath: string, line: string): boolean` — extension filter, `isCodeLine`, `pattern` hits, `unless` does not.
  - `matchLine(rules: readonly LineRule[], filePath: string, line: string): LineRule[]`
  - `extensionOf(filePath: string): string` (lowercase, with dot, `""` when none)

- [ ] **Step 1: Write the failing tests:**

```ts
const rule: LineRule = { id: "t.timeout", pattern: /timeout\s*:\s*\d/, unless: /timeout\s*:\s*0\b/, extensions: [".ts", ".js"] };
it("matches code lines in the listed extensions", () => {
  expect(ruleMatches(rule, "src/pay.ts", "  const opts = { timeout: 5000 };")).toBe(true);
  expect(ruleMatches(rule, "src/pay.py", "timeout: 5000")).toBe(false);
});
it("honours unless", () => expect(ruleMatches(rule, "a.ts", "fetch(u, { timeout: 0 })")).toBe(false));
it("skips comments and imports", () => {
  for (const line of ["// timeout: 5000", " * timeout: 5", "# timeout: 5", "/* timeout: 5 */", "import { timeout } from './t';"])
    expect(isCodeLine(line)).toBe(false);
  expect(isCodeLine("const t = { timeout: 5 };")).toBe(true);
});
it("lists every matching rule", () => {
  const other: LineRule = { id: "t.any", pattern: /fetch\(/, extensions: [] };
  expect(matchLine([rule, other], "a.ts", "fetch(u, { timeout: 5 })").map((r) => r.id)).toEqual(["t.timeout", "t.any"]);
});
```

- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/rules/engine.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** the functions in `engine.ts`. Patterns are used without the `g` flag; reject a rule with a `g` or `y` flag by throwing at module load (a stateful regex gives wrong answers on reuse).
- [ ] **Step 4: Run the tests** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add a shared regex line rules engine"`

---

### Task 3: Ladder schema and thresholds

**Files:**
- Create: `packages/server/src/coach/ladder/schema.ts`
- Test: `packages/server/src/coach/ladder/schema.test.ts`

**Interfaces:**
- Produces:
  - `type Track = "backend" | "frontend"`; `const LEVELS = ["junior", "mid", "senior", "staff"] as const; type Level`
  - `interface SignalRef { id: string; polarity: "positive" | "negative"; regresses?: boolean }`
  - `interface Drill { id: string; prompt: string; key_points: { id: string; text: string }[]; red_flags: { id: string; text: string }[]; pass?: number }`
  - `interface StackNote { note: string; link: string }`
  - `interface LadderItem { id: string; title: string; good_looks_like: string[]; signals: SignalRef[]; explain_angles: string[]; drills: Drill[]; study: string[]; stack_notes: Record<string, StackNote> }`
  - `interface Area { id: string; name: string; levels: Record<Level, LadderItem[]> }`
  - `interface Thresholds { proofs: number; tickets: number; window_days: number; clear_answers: number; judge_cap: number; drill_retry_days: number; question_timeout_min: number; max_questions: number; hash_keep_days: number; catchup_max: number }`
  - `const DEFAULT_THRESHOLDS: Thresholds` = `{ proofs: 3, tickets: 2, window_days: 60, clear_answers: 2, judge_cap: 1, drill_retry_days: 3, question_timeout_min: 30, max_questions: 3, hash_keep_days: 120, catchup_max: 200 }`
  - `interface Ladder { track: Track; areas: Area[]; thresholds?: Partial<Thresholds> }`
  - `const ladderSchema: z.ZodType<Ladder>`; `function passCount(drill: Drill): number` = `drill.pass ?? Math.ceil((2 / 3) * drill.key_points.length)`
  - `const ITEM_ID = /^(BE|FE)\.[A-Z]{2,8}\.[JMSX]\d{1,2}$/`

Schema rules: item ids match `ITEM_ID`, start with `BE` for backend and `FE` for frontend, and are unique in the ladder; the level letter matches the level the item sits in; each item has 1 to 3 `drills`; each drill has 2+ `key_points`, unique point and flag ids, and `pass` between 1 and the number of key points; `good_looks_like` 1 to 3 entries; `study` 2 to 4; stack note `link` starts with `https://`. An area may have empty levels (not written yet).

- [ ] **Step 1: Write the failing tests**: a minimal valid ladder fixture (one area, one mid item `BE.ERR.M2` with one drill of 3 key points) parses; then one test per rule that breaks it: duplicate item id, `FE.` id in a backend ladder, `BE.ERR.S1` placed under `mid`, a drill with 1 key point, `pass: 4` with 3 points, an `http://` link. Assert `passCount` gives 2 for 3 points and 3 for 4 points.
- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/coach/ladder/schema.test.ts` → FAIL.
- [ ] **Step 3: Implement** `ladderSchema` with zod `superRefine` for the cross-field rules; error messages name the item id and the rule in plain words ("BE.ERR.S1 sits under mid but its id says senior").
- [ ] **Step 4: Run the tests** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the ladder schema and default thresholds"`

---

### Task 4: Signal rules and the built-in ladders (one area per track)

**Files:**
- Create: `packages/server/src/coach/signals.ts`
- Create: `packages/server/src/coach/ladder/builtin/backend.json`, `packages/server/src/coach/ladder/builtin/frontend.json`
- Modify: `packages/server/tsconfig.json` (add `"resolveJsonModule": true`)
- Test: `packages/server/src/coach/signals.test.ts`, `packages/server/src/coach/ladder/builtin.test.ts`

**Interfaces:**
- Consumes: `LineRule`, `ruleMatches` (Task 2); `ladderSchema` (Task 3).
- Produces:
  - `interface SignalRule extends LineRule { examples: { hit: string[]; miss: string[]; file: string } }`
  - `const SIGNALS: readonly SignalRule[]`; `function signalById(id: string): SignalRule | undefined`
  - `backend.json` / `frontend.json`, imported with `import backend from "./builtin/backend.json" with { type: "json" }` (bundled by esbuild, so the plugin needs no extra files).

Signal ids to write (regex wording is the builder's; each needs 2+ `hit` and 2+ `miss` examples covering JS/TS and at least one other backend language where it applies):

| id | Polarity in use | Meaning |
|---|---|---|
| `err.empty-catch` | negative, regresses | An empty `catch {}` / `catch (e) {}` / `except: pass` / `if err != nil {}` |
| `err.timeout-set` | positive | A time limit on an outside call: `AbortSignal.timeout(`, `timeout: <n>`, `context.WithTimeout`, `.timeout(Duration` |
| `err.retry-backoff` | positive | Retry with backoff or jitter named on the line |
| `err.error-cause` | positive | An error that keeps its cause: `{ cause:`, `raise X from e`, `%w` in `fmt.Errorf` |
| `err.rethrow-message-only` | negative | `throw new Error(e.message)` or `throw new Error(err)` (loses the cause) |
| `err.error-leak` | negative, regresses | Sending raw error details to the client: `res.status(500).json(err)`, `.send(err.stack)` |
| `fetch.console-only` | negative, regresses | `.catch(console.error)`, `.catch(() => {})` on a request |
| `fetch.res-ok-check` | positive | `if (!res.ok)`, `response.ok`, `status >= 400` checks |
| `fetch.abort-controller` | positive | `new AbortController()` or `signal:` passed to a fetch |
| `fetch.loading-state` | positive | `isLoading`, `setLoading(`, `isPending`, `status === "loading"` |
| `fetch.error-boundary` | positive | `ErrorBoundary` or `componentDidCatch` |

Built-in ladder content:

- `backend.json`: areas `ERR` "Errors and failure" (fully written), and empty areas `DATA` "Data and storage", `API` "API design", `SEC` "Security", `PERF` "Performance", `TEST` "Testing", `STRUCT` "Code structure", `REQ` "Requirements and scope".
- `frontend.json`: area `FETCH` "Data fetching and errors" (fully written), and empty areas `STATE`, `COMP`, `RENDER`, `A11Y`, `SEC`, `TEST`, `REQ`.
- Items to write (titles may be polished; ids are fixed because tests use them):
  - `BE.ERR.J1` Never hides an error (`err.empty-catch` −, regresses) · `BE.ERR.J2` Checks the result of calls that can fail · `BE.ERR.M1` Validates input at the edge · `BE.ERR.M2` Handles the failure of an outside call on purpose (`err.timeout-set` +, `err.retry-backoff` +, `err.empty-catch` −) · `BE.ERR.M3` Errors carry useful context without leaking data (`err.error-cause` +, `err.rethrow-message-only` −, `err.error-leak` −, regresses) · `BE.ERR.S1` Designs for partial failure · `BE.ERR.S2` Makes failures observable · `BE.ERR.X1` Sets the error-handling standard for a system.
  - `FE.FETCH.J1` Shows loading and error states (`fetch.loading-state` +) · `FE.FETCH.J2` Never swallows a failed request (`fetch.console-only` −, regresses; `err.empty-catch` −) · `FE.FETCH.M1` Checks the response before using it (`fetch.res-ok-check` +) · `FE.FETCH.M2` Cancels stale requests (`fetch.abort-controller` +) · `FE.FETCH.M3` Caches and dedupes server data on purpose · `FE.FETCH.S1` Designs for slow and flaky networks · `FE.FETCH.S2` Recovers from errors with boundaries (`fetch.error-boundary` +) · `FE.FETCH.X1` Sets the data-fetching standard for an app.
- Every item: 2 or 3 drills whose key a reviewer could score by hand, 2 to 4 specific study topics, and `stack_notes` for `express`, `nestjs` and `spring` (backend) or `react`, `nextjs` and `angular` (frontend), each with an official-docs `https://` link.

- [ ] **Step 1: Write the failing tests:**

```ts
it.each(SIGNALS)("$id matches its hit examples and none of its miss examples", (s) => {
  for (const line of s.examples.hit) expect(ruleMatches(s, s.examples.file, line)).toBe(true);
  for (const line of s.examples.miss) expect(ruleMatches(s, s.examples.file, line)).toBe(false);
});
it("has unique signal ids", () => expect(new Set(SIGNALS.map((s) => s.id)).size).toBe(SIGNALS.length));
it.each([backend, frontend])("built-in $track ladder passes the schema", (l) => expect(() => ladderSchema.parse(l)).not.toThrow());
it("only references signals that exist", () => {
  for (const l of [backend, frontend]) for (const a of l.areas) for (const lvl of LEVELS) for (const i of a.levels[lvl])
    for (const s of i.signals) expect(signalById(s.id), `${i.id} -> ${s.id}`).toBeDefined();
});
it("writes ERR and FETCH fully: every level has at least one item", () => {
  const err = backend.areas.find((a) => a.id === "ERR")!; const fetch = frontend.areas.find((a) => a.id === "FETCH")!;
  for (const lvl of LEVELS) { expect(err.levels[lvl].length).toBeGreaterThan(0); expect(fetch.levels[lvl].length).toBeGreaterThan(0); }
});
```

- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/coach/signals.test.ts src/coach/ladder/builtin.test.ts` → FAIL.
- [ ] **Step 3: Write `signals.ts`** with the 11 rules and their examples.
- [ ] **Step 4: Write the two JSON ladders** with the content above.
- [ ] **Step 5: Run the tests** → PASS. Also run `corepack pnpm --filter @ftc/server typecheck` → no errors (JSON import works).
- [ ] **Step 6: Commit** `git commit -m "Add signal rules and the built-in backend and frontend ladders"`

---

### Task 5: Ladder loader with company override

**Files:**
- Create: `packages/server/src/coach/ladder/load.ts`
- Test: `packages/server/src/coach/ladder/load.test.ts`

**Interfaces:**
- Consumes: `ladderSchema`, `DEFAULT_THRESHOLDS` (Task 3); built-in JSON and `signalById` (Task 4).
- Produces:
  - `interface LoadedLadder { ladder_id: string; track: Track; source: "builtin" | "repo" | "home"; ladder: Ladder; thresholds: Thresholds; warning?: string }`
  - `loadLadder(track: Track, opts: { repoRoot: string; home?: string }): LoadedLadder` — looks for `<repoRoot>/.fork-trail-coach/ladder.json`, then `<home>/.fork-trail-coach/ladder.json` (`home` defaults to `os.homedir()`); a company file may hold one ladder object or an array of ladders, one per track; a file that has no ladder for this track is skipped.
  - Ladder ids: `"builtin/backend"`, `"builtin/frontend"`, `"home/<track>"`, `"repo:<first 8 hex of sha256(repoRoot)>/<track>"`.
  - `thresholds` = `{ ...DEFAULT_THRESHOLDS, ...ladder.thresholds }`.
  - `findItem(ladder: Ladder, itemId: string): { area: Area; level: Level; item: LadderItem } | null`
  - `loadActiveLadders(tracks: Track[], opts): LoadedLadder[]`

- [ ] **Step 1: Write the failing tests** (temp folders for repo and home):
  - no company files → `ladder_id` `"builtin/backend"`, `source` `"builtin"`, no warning;
  - valid repo file → `source` `"repo"`, id starts with `"repo:"`; a repo file wins over a home file;
  - repo file with bad JSON → built-in is used and `warning` contains `"ladder.json"` and the parse reason;
  - repo file referencing signal `"nope.signal"` → built-in is used, warning names `nope.signal`;
  - company file with `thresholds: { proofs: 2 }` → `thresholds.proofs === 2`, `thresholds.tickets === 2`;
  - `findItem(backend, "BE.ERR.M2")` returns level `"mid"`; unknown id returns `null`.
- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/coach/ladder/load.test.ts` → FAIL.
- [ ] **Step 3: Implement** `load.ts`. Read files with `readFileSync` inside try/catch; never throw for a bad company file.
- [ ] **Step 4: Run the tests** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Load the ladder with a company file override"`

---

### Task 6: Git readers and line attribution (with the edit hook)

**Files:**
- Create: `packages/server/src/git/diff.ts`, `packages/server/src/git/log.ts`, `packages/server/src/coach/attribution.ts`
- Modify: `packages/server/src/hook/post-tool-use.ts`
- Test: `packages/server/src/git/git.test.ts`, `packages/server/src/coach/attribution.test.ts`, `packages/server/src/hook/hook.test.ts`

**Interfaces:**
- Consumes: `Run`, `run` from `src/pointers/git.ts`; `toRepoPath` from `src/paths.ts`.
- Produces:
  - `interface DiffLine { line: number; text: string }` (new-file line number for added, old-file for removed)
  - `interface FileDiff { path: string; oldPath: string | null; added: DiffLine[]; removed: DiffLine[]; binary: boolean }`
  - `parseUnifiedDiff(text: string): FileDiff[]` — handles `-U0` hunks, renames, `/dev/null`, binary markers, quoted paths, and strips a trailing `\r` from each line.
  - `commitDiff(root: string, sha: string, exec?: Run): Promise<FileDiff[]>` — `git show --format= --no-color --no-ext-diff --text --no-textconv -U0 -M <sha>`
  - `changeId(diff: FileDiff[]): string` — sha256 (first 16 hex) of the sorted `path + "\n+" + added texts + "\n-" + removed texts`, ignoring line numbers; same change after a rebase gives the same id.
  - `interface CommitInfo { sha: string; authorEmail: string; authorDate: string; subject: string }`
  - `listCommits(root: string, opts: { authorEmails: string[]; sinceIso?: string; exec?: Run }): Promise<CommitInfo[]>` — `git log --branches --no-merges --format=%H%x1f%ae%x1f%aI%x1f%s` (plus `--since`), filtered in code by lowercase email, returned oldest first.
  - `developerEmails(root: string, extra: string[], exec?: Run): Promise<string[]>` — `git config user.email` plus `extra`, lowercased, unique; `[]` when none.
  - `isGitRepo(root: string, exec?: Run): Promise<boolean>`; `currentBranch(root, exec?): Promise<string | null>`; `defaultBranchCommits(root, exec?): Promise<Set<string>>` (`git rev-list` of `origin/HEAD`, else `main`, else `master`; empty set if none).
  - `normalizeLine(line: string): string | null`; `lineHash(normalized: string): string`
  - `linesFromToolInput(toolName: string, toolInput: unknown): string[]` — `Edit`: `new_string`; `MultiEdit`: each `edits[].new_string`; `Write`: `content`; `NotebookEdit`: `new_source`.
  - `saveAiLines(db: Db, repoRoot: string, filePath: string, sessionId: string, lines: string[]): number`
  - `aiHashesFor(db: Db, repoRoot: string, filePath: string): Set<string>`
  - `firstHashAt(db: Db, repoRoot: string): string | null`; `pruneAiLines(db: Db, keepDays: number, now?: Date): number`
  - Hook change: after the existing logic, for **every** session (tracked or not) whose file is inside a git work tree, save AI line hashes. The hook now creates the database when missing (hashes are needed before any session is tracked). The repo root is found with `git rev-parse --show-toplevel` from `cwd`; on failure, skip.

- [ ] **Step 1: Write the failing tests:**

```ts
// attribution.test.ts
it("hashes lines the same across formatting and line endings", () => {
  expect(normalizeLine("  const a = 'x';\r")).toBe(normalizeLine('const a = "x"'));
  expect(lineHash(normalizeLine("call(a, b),")!)).toBe(lineHash(normalizeLine("call(a,b)")!));
  expect(normalizeLine("  });")).toBeNull();
  expect(lineHash("abcd")).toMatch(/^[0-9a-f]{16}$/);
});
it("reads the written lines from each edit tool", () => {
  expect(linesFromToolInput("MultiEdit", { edits: [{ new_string: "a\nb" }, { new_string: "c" }] })).toEqual(["a", "b", "c"]);
  expect(linesFromToolInput("Write", { content: "x\r\ny" })).toEqual(["x", "y"]);
  expect(linesFromToolInput("Bash", { command: "echo" })).toEqual([]);
});
it("saves, finds, and prunes AI line hashes", () => { /* save 2 lines, aiHashesFor has both, prune with keepDays 0 and a future now removes them */ });

// git.test.ts (uses a temp git repo created with execFileSync("git", ...))
it("parses added and removed lines of a -U0 diff, with renames", ...);
it("gives the same change id to a cherry-picked commit", ...);
it("lists only the developer's commits, oldest first", ...);
```

  In `hook.test.ts` add: an `Edit` event in an untracked session inside a temp git repo saves one hash per non-trivial line of `new_string`; the hook still exits 0 with no stdout when `FTC_DB_PATH` points into a folder that cannot be created.
- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/git src/coach/attribution.test.ts` → FAIL.
- [ ] **Step 3: Implement** `diff.ts`, `log.ts` and `attribution.ts`.
- [ ] **Step 4: Change the hook** as described; keep it a separate small bundle with no MCP library.
- [ ] **Step 5: Rebuild and run the tests** — `corepack pnpm build && corepack pnpm --filter @ftc/server exec vitest run src/git src/coach src/hook` → PASS.
- [ ] **Step 6: Commit** `git commit -m "Read git diffs and record which lines Claude wrote"`

---

### Task 7: Stack detection

**Files:**
- Create: `packages/server/src/coach/stack.ts`
- Test: `packages/server/src/coach/stack.test.ts`

**Interfaces:**
- Produces:
  - `interface StackHit { stack_id: string; track: Track; folder: string }` (`folder` is repo-relative, `""` for the root)
  - `detectStacks(root: string): StackHit[]` — reads the root and folders up to 2 levels deep (skipping `node_modules`, `.git`, `dist`, `build`, `vendor`): `package.json` dependencies (`express`, `@nestjs/core` → `nestjs`, `fastify`, `koa`; `react`, `next` → `nextjs`, `@angular/core` → `angular`, `vue`, `svelte`), `pom.xml` / `build.gradle(.kts)` with `spring` → `spring`, `*.csproj` → `dotnet`, `requirements.txt` / `pyproject.toml` with `django` / `fastapi` / `flask`, `go.mod` → `go`. `nextjs` wins over `react` in the same folder.
  - `stackForPath(stacks: StackHit[], filePath: string, track: Track): string | null` — the hit of that track whose folder is the deepest prefix of the path.

- [ ] **Step 1: Write the failing tests**: a temp monorepo with `api/package.json` (express) and `web/package.json` (react + next) → two hits, `web` is `nextjs`; `stackForPath(hits, "web/app/page.tsx", "frontend") === "nextjs"`; `stackForPath(hits, "api/src/pay.ts", "backend") === "express"`; an empty folder → `[]`; a broken `package.json` is skipped without throwing.
- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/coach/stack.test.ts` → FAIL.
- [ ] **Step 3: Implement** `stack.ts`.
- [ ] **Step 4: Run the tests** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Detect the project stack per folder"`

---

### Task 8: Catch-up capture

**Files:**
- Create: `packages/server/src/coach/capture.ts`
- Test: `packages/server/src/coach/capture.test.ts`

**Interfaces:**
- Consumes: Task 4 `SIGNALS`, Task 5 `LoadedLadder`, Task 6 git readers and attribution, `symbolAtLine` and `isSupported` from `src/pointers/symbols.ts`, `fileAtCommit` from `src/pointers/git.ts`.
- Produces:
  - `interface CatchUpResult { started: boolean; note?: string; commits_read: number; evidence_added: number; faults_fixed: number; more_left: boolean }`
  - `catchUp(db: Db, opts: { root: string; ladders: LoadedLadder[]; extraEmails?: string[]; now?: Date; exec?: Run }): Promise<CatchUpResult>`
  - `ticketForCommit(c: CommitInfo, ctx: { onDefault: boolean; branch: string | null }): string` — first `[A-Z][A-Z0-9]+-\d+` in the subject; else the branch name when the commit is not on the default branch and a branch is known; else `week:<ISO year>-W<2-digit week>` of the author date.
  - `isGeneratedPath(path: string): boolean` — lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `*.lock`), `dist/`, `build/`, `vendor/`, `node_modules/`, `*.min.*`, `*.generated.*`, `__generated__/`.

Algorithm (the parts the tests do not fix):

0. First, `pruneAiLines(db, thresholds.hash_keep_days, now)` (the 120-day limit is kept here, not in the hook, so the hook stays fast).
1. Not a git repo, or no developer emails → `{ started: false, note }` with a plain note ("No git user.email is set, so Coach can't tell which commits are yours."). Stage 1 starts at `firstHashAt(db, root)`; none → `{ started: false, note: "Coach starts reading commits after Claude's first edit in this repo." }`.
2. Commits since that time, minus those in `commits_seen`, oldest first, at most `thresholds.catchup_max`; `more_left` when more remain.
3. Per commit: skip binary and generated files, and files with more than 3,000 added lines. A commit whose `changeId` is already in `commits_seen` for this repo is recorded and skipped.
4. Per added code line: author is `"ai"` if its hash is in `aiHashesFor(file)`, else `"dev"`. For each matching signal, and each item of each active ladder that lists it, one row: `kind: "rule"`, polarity and `regresses` from the item's `SignalRef`, symbol from `symbolAtLine` (only for files with hits; `null` when unsupported), `ticket` from `ticketForCommit`, `at` = author date. Dedupe in a commit by `(ladder_id, item_id, signal_id, file, symbol)`.
5. Per removed line matching a negative signal: set `fixed_at` and `fixed_ticket` on open faults (`polarity = 'negative' AND fixed_at IS NULL`) with the same `signal_id`, file and symbol.
6. Write all rows of one commit and its `commits_seen` row in one transaction.

- [ ] **Step 1: Write the failing tests** (temp git repo, `user.email` set, fixed `now`; seed one `ai_line_hashes` row dated before the first commit so capture starts):
  - a developer commit adding `const r = await fetch(u, { signal: AbortSignal.timeout(5000) });` in `src/pay.ts` adds a positive `err.timeout-set` row for `BE.ERR.M2` with `author: "dev"` and the enclosing function as `symbol`;
  - the same line whose hash was saved by `saveAiLines` first → `author: "ai"`;
  - running `catchUp` twice adds nothing the second time;
  - a hash row older than 120 days is gone after `catchUp`;
  - a cherry-picked copy of a read commit adds no rows;
  - an empty catch added on ticket `PAY-1`, then removed in a later `PAY-1` commit → the fault row has `fixed_ticket === "PAY-1"`;
  - `ticketForCommit` gives `"PAY-12"` for subject `"PAY-12 add retry"`, the branch name for a commit off the default branch, and `"week:2026-W46"` for a commit on main on 2026-11-12 with no key;
  - **Review Focus 1:** a folder that is not a git repo, and a repo where `user.email` is unset → `started: false` with a note, no throw;
  - **Review Focus 2:** a commit adding `package-lock.json`, `dist/app.min.js` and a 20,000-line `src/schema.generated.ts` full of `catch (e) {}` adds no rows and finishes in under 2 seconds.
- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/coach/capture.test.ts` → FAIL.
- [ ] **Step 3: Implement** `capture.ts`.
- [ ] **Step 4: Run the tests** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Capture skill evidence from the developer's new commits"`

---

### Task 9: The state engine

**Files:**
- Create: `packages/server/src/coach/state.ts`
- Test: `packages/server/src/coach/state.test.ts`

**Interfaces:**
- Consumes: `LadderItem`, `Area`, `Level`, `Thresholds` (Task 3).
- Produces:
  - `type ItemState = "not_seen" | "learning" | "shown" | "proven"`
  - `interface EvidenceFact { id: string; kind: "rule" | "judge" | "decision" | "review" | "ticket_check"; polarity: "positive" | "negative"; author: "ai" | "dev" | "unknown"; decided_by: "ai" | "dev" | null; history: boolean; regresses: boolean; signal_id: string | null; file: string | null; symbol: string | null; ticket: string; at: string; fixed_at: string | null; fixed_ticket: string | null; disagreed: boolean }`
  - `interface AnswerFact { id: string; rating: "clear" | "partial" | "not_yet"; ticket: string; names_tradeoff: boolean; at: string }`
  - `interface DrillFact { id: string; drill_id: string; passed: boolean; void: boolean; at: string }`
  - `interface ItemStatus { item_id: string; state: ItemState; proofs: number; proof_tickets: number; clear_answers: number; tradeoff_named: boolean; open_faults: number; regressed_at: string | null; last_proof_at: string | null; proven_at: string | null; needs: string[] }`
  - `itemStatus(input: { item: LadderItem; evidence: EvidenceFact[]; answers: AnswerFact[]; drills: DrillFact[] }, now: Date, t: Thresholds): ItemStatus`
  - `areaLevel(area: Area, statuses: Map<string, ItemStatus>): { level: Level | null; working_toward: Level | null }`

The rules, exactly (spec 6.3 and 6.6):

- **Counts as credit**: positive, not disagreed, and `author === "dev"` or `decided_by === "dev"`. A positive with `author: "ai"` and `decided_by` not `"dev"` never counts.
- **Fault**: negative, not disagreed, and not (`fixed_ticket !== null && fixed_ticket === ticket`) — a fault fixed in the same ticket before shipping does not count. Faults count whoever wrote the line.
- **Regression point `R`**: the latest `at` among faults with `regresses: true` and answers rated `not_yet`. Only evidence, answers and drills with `at > R` count toward Shown and Proven.
- **Proofs**: credit rows after `R` and within `window_days` of the moment being judged, grouped by `(signal_id ?? id, file, symbol)`; each group is one proof, ticketed by its earliest row. At most `judge_cap` proofs from `kind: "judge"` when the item has signals; at most 1 proof from `history: true` rows (stage 2 data).
- **Shown at time `T`**: proofs ≥ `proofs`, distinct proof tickets ≥ `tickets`, no unfixed fault (`fixed_at === null`) dated in the window, and ≥ `clear_answers` `clear` answers after `R` on distinct tickets, at least one with `names_tradeoff`.
- **Proven**: a drill with `passed && !void`, `at > R`, and the item was Shown at that drill's `at` (evaluate Shown with only the facts dated ≤ that `at`). Proven does not expire.
- **Learning**: not Shown or Proven, and any credit row, any `partial`/`not_yet` answer, any fault, or `R !== null`.
- **Not seen**: none of the above.
- **needs**: plain phrases for what is missing for the next state, e.g. `"1 more code proof"`, `"proof on 1 more ticket"`, `"1 more clear answer"`, `"an answer that names the trade-off"`, `"fix the open fault in pay.ts"`, `"pass a drill"`.
- **areaLevel**: walk `LEVELS` in order; a level with no items is passed through; `level` is the last level whose items (and all lower ones) are all Proven, or `null`; `working_toward` is the next level that has items, or `null` at the top.

- [ ] **Step 1: Write the failing tests** (`now = 2026-11-18`, `DEFAULT_THRESHOLDS`, small fact builders `dev(...)`, `ai(...)`, `clear(...)`, `drill(...)`):

```ts
it("is not_seen with no facts", ...);                                  // state "not_seen"
it("is learning with one dev proof", ...);
it("ignores AI-written positives unless the developer decided", ...); // ai() rows → proofs 0; ai({decided_by:"dev"}) → proofs 1
it("needs both code and explained to be shown", ...);                 // 3 proofs on 2 tickets + 0 answers → learning; + 2 clear (1 trade-off) → shown
it("needs two distinct tickets", ...);                                 // 3 proofs, one ticket → learning, needs contains "proof on 1 more ticket"
it("counts hits in the same function once", ...);                      // 3 rows same signal/file/symbol → proofs 1
it("drops proofs older than 60 days", ...);
it("blocks shown while a fault is unfixed", ...);
it("does not count a fault fixed in the same ticket", ...);
it("caps judge proofs at 1 when the item has signals", ...);
it("becomes proven only with a drill passed while shown", ...);      // drill before shown → stays shown
it("stays proven after the window passes", ...);
it("ignores a void drill", ...);
it("drops to learning after a regressing fault and needs fresh proofs", ...); // old proofs before R no longer count
it("drops to learning after a not_yet answer", ...);
it("ignores disagreed evidence", ...);
it("gives the area level from proven items", ...);                    // all junior proven, one mid shown → level "junior", working_toward "mid"
```

- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/coach/state.test.ts` → FAIL.
- [ ] **Step 3: Implement** `state.ts` as pure functions (no database, no clock reads: `now` is passed in).
- [ ] **Step 4: Run the tests** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the item state engine and area levels"`

---

### Task 10: Coach status, history, and the read and evidence tools

**Files:**
- Create: `packages/server/src/coach/facts.ts` (loads `EvidenceFact`/`AnswerFact`/`DrillFact` rows per item), `packages/server/src/coach/status.ts`, `packages/server/src/coach/settings.ts`
- Modify: `packages/server/src/mcp/schemas.ts`, `packages/server/src/mcp/server.ts`, `packages/server/src/store.ts` (`logDecision` stores `ladder_id`/`item_id`)
- Test: `packages/server/src/coach/status.test.ts`, `packages/server/src/mcp/server.test.ts`

**Interfaces:**
- Consumes: Tasks 5 to 9.
- Produces:
  - `getTracks(db: Db): Track[]` / `setTracks(db: Db, tracks: Track[]): void`; `getExtraEmails(db)` / `setExtraEmails(db, emails: string[])` (stored in `coach_settings`).
  - `factsForItem(db: Db, ladderId: string, itemId: string): { evidence: EvidenceFact[]; answers: AnswerFact[]; drills: DrillFact[] }` — answers are `pending_questions` rows with a `rating`.
  - `recordStateChanges(db: Db, ladderId: string, statuses: ItemStatus[], reasonFor: (s: ItemStatus) => string): number` — inserts into `item_state_history` only when the state differs from the item's last row.
  - `interface AreaView { ladder_id: string; area_id: string; name: string; level: Level | null; working_toward: Level | null; items: { item_id: string; title: string; level: Level; state: ItemState; detail: string }[] }`
  - `interface CoachStatus { tracks: Track[]; ladders: { ladder_id: string; track: Track; source: string; warning?: string }[]; stacks: StackHit[]; catch_up: CatchUpResult; areas: AreaView[]; focus: FocusFrame[]; questions: QuestionView[]; drills_ready: string[]; text: string }` (`FocusFrame` from Task 13 and `QuestionView` from Task 11; until those tasks land, return `[]` for both)
  - `coachStatus(db: Db, opts: { root: string; now?: Date; exec?: Run; home?: string }): Promise<CoachStatus>` — runs `catchUp`, computes every item of every written area of the chosen tracks, records state changes, builds `text` with `renderProgress`.
  - `renderProgress(s: Omit<CoachStatus, "text">): string` — the exact layout of spec 6.10 (area line with level and "working toward"; one line per item at the current and next level: id, title, state in capitals, detail; "Next for <level>:" for the first not-seen item above; then `Your stack:` and `Study next:` lines). Areas with no items show once at the end as "Not written yet: …".
  - `itemDetail(db: Db, ladderId: string, itemId: string, now?: Date): { item: LadderItem; status: ItemStatus; evidence: …; answers: …; drills: … }` and `stateHistory(db: Db, ladderId?: string): …[]`.
  - `proposeEvidence(db: Db, root: string, input: ProposeEvidenceInput, exec?: Run): Promise<{ evidence_id: string }>` — accepted only if the commit is the developer's, lines `line_start..line_end` include at least one line added in that commit, and at least one of them is developer-written by hash; inserts `kind: "judge"`, positive.
  - `disagree(db: Db, input: { target_id: string; reason: string }): { target: "evidence" | "drill"; effect: string }` — `skill_evidence` row → sets `disagreed_at`/`disagree_reason`; `drill_attempts` row → sets `void = 1`. Any other id (including answers) → `StoreError("You can disagree with evidence or a drill score. To change an answer, ask for a new question.")`.
  - MCP tools (zod inputs in `schemas.ts`, `reply`/`write` wrappers as existing tools do):
    - `coach_status` `{}` → `CoachStatus`
    - `set_coach_tracks` `{ tracks: Track[] (1-2), extra_emails?: string[] (max 5, emails) }`
    - `coach_item` `{ item_id, ladder_id? }` → `itemDetail` (ladder defaults to the active ladder of the item's track)
    - `coach_history` `{ ladder_id? }`
    - `propose_evidence` `{ item_id, ladder_id?, commit, file, line_start, line_end, why: shortText }`
    - `disagree` `{ target_id, reason: shortText (min 8) }`
    - `log_decision` gets optional `item_id`; unknown ids for the active ladders → `StoreError` naming the id.

- [ ] **Step 1: Write the failing tests:**
  - `status.test.ts`: with a temp repo holding a captured `err.timeout-set` proof, `coachStatus` returns the `ERR` area with `BE.ERR.M2` `learning` and `text` containing `"BE.ERR.M2"`, `"LEARNING"` and `"Your stack: express"` (the repo has an express `package.json`); a second call with no new facts adds no history row; after adding facts that make it Shown, exactly one history row `learning → shown`;
  - **Review Focus 5:** a `skill_evidence` row for `"BE.ERR.M9"` (not in the ladder) is ignored: no throw, and it is absent from `areas`;
  - `server.test.ts`: `disagree` on an evidence id sets it disagreed and the item's proofs drop; on an answer id returns the error text above; `propose_evidence` with lines the commit did not add is rejected; `log_decision` with `item_id: "BE.NOPE.M1"` is rejected.
- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/coach/status.test.ts src/mcp/server.test.ts` → FAIL.
- [ ] **Step 3: Implement** `settings.ts`, `facts.ts`, `status.ts`, `proposeEvidence`, `disagree`.
- [ ] **Step 4: Register the tools** in `server.ts` with short plain descriptions that say the AI never sets a state or a level.
- [ ] **Step 5: Run the tests** → PASS.
- [ ] **Step 6: Commit** `git commit -m "Add coach status, history, evidence and disagree tools"`

---

### Task 11: Questions and the prompt hook

**Files:**
- Create: `packages/server/src/coach/questions.ts`, `packages/server/src/hook/prompt-submit.ts`
- Modify: `packages/server/bundle.mjs` (add `prompt.mjs`), `packages/plugin/server/start.mjs` (mode `prompt` → `./prompt.mjs`, exits 0 on old Node like `hook`), `packages/plugin/hooks/hooks.json` (add `UserPromptSubmit` running `start.mjs prompt`, timeout 10), `packages/server/src/coach/status.ts` (fill `questions`), `mcp/schemas.ts`, `mcp/server.ts`
- Test: `packages/server/src/coach/questions.test.ts`, `packages/server/src/hook/prompt.test.ts`

**Interfaces:**
- Consumes: Task 10 statuses and facts.
- Produces:
  - `interface QuestionView { question_id: string; kind: "why" | "explain_back" | "drill"; item_id: string; ticket: string; about: string; opened: boolean }` (`about` says what to ask about: the decision summary, or the signal meaning plus file and symbol; never code)
  - `proposeQuestions(db: Db, statuses: Map<string, ItemStatus>, ctx: { ladders: LoadedLadder[]; max: number }): QuestionView[]` — keeps unanswered pending questions first; tops up to `max` in this order: `why` on the newest dev-authored row (positive or fault) of a Not seen or Learning item; `explain_back` on decisions with an `item_id`, origin `ai`, and no explain-back. Never two questions on the same item.
  - `openQuestion(db: Db, input: { session_id: string; question_id?: string; decision_id?: string; item_id?: string; text: string }, now?: Date): QuestionView` — exactly one of `question_id` or `decision_id` (the latter creates an `explain_back` question); saves the worded `text`; closes any other open question of that session as `later`.
  - `captureAnswer(db: Db, sessionId: string, message: string, now?: Date): { captured: false } | { captured: true; question_id: string; closed: "answered" | "later" }` — finds the open question of this session; closes it as `timeout` if opened more than `question_timeout_min` ago; ignores slash commands (`/…`) and clarifications (`isClarification`).
  - `isLaterReply(text: string): boolean` — the whole message is `later`, `skip`, `not now`, or `later please`, any case, optional trailing punctuation.
  - `isClarification(text: string): boolean` — under 120 characters and ends with `?`.
  - `type Rating = (typeof RATINGS)[number]` (from `mcp/schemas.ts`)
  - `rateAnswer(db: Db, input: { question_id: string; rating: Rating; tradeoff_quote?: string }): { rating: Rating; names_tradeoff: boolean; note?: string }` — only for `answered` questions; `names_tradeoff` is true only if `tradeoff_quote` is found in the saved answer (`quoteIn`, Task 12) — otherwise false with `note: "The quote is not in the answer, so the trade-off flag was dropped."`; for `explain_back` also inserts an `explain_backs` row (`question_id`, `item_id`, the saved answer, the question text). The privacy guard runs on the answer at capture time: if it rejects, `answer` is stored as `"(held back: the answer contained code or a name on the denylist)"` and rating still works.
  - Prompt hook: on an open question, saves the message as described; prints `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Coach: saved this message as the answer to question <id>. Rate it with rate_answer."}}` when captured. Never blocks the prompt. No database → exits 0 at once.
  - MCP tools: `ask_question` (input of `openQuestion`), `rate_answer` (input of `rateAnswer`).

- [ ] **Step 1: Write the failing tests:**
  - `questions.test.ts`: `proposeQuestions` on a Learning item with a dev proof returns one `why` question; a second call returns the same pending one, not a new one; with `max: 3` and 5 candidates returns 3 on 3 different items;
  - open → `captureAnswer("s1", "Because the provider can hang")` → captured, closed `answered`, answer stored exactly; `captureAnswer` in session `s2` → not captured;
  - `"Later."` closes it as `later` and it shows again in the next `proposeQuestions`;
  - **Review Focus 3:** `"wait, what do you mean by timeout?"` and `"/coach"` are not captured and the question stays open;
  - an open question older than 30 minutes is closed as `timeout` and the message is not captured;
  - `rateAnswer` with a quote not in the answer → `names_tradeoff: false` and the note; with a real quote → `true`;
  - `prompt.test.ts` (runs the bundled `start.mjs prompt`, skipped when not built): an open question gets the answer and the context line is printed; no open question → no stdout, exit 0.
- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/coach/questions.test.ts src/hook/prompt.test.ts` → FAIL.
- [ ] **Step 3: Implement** `questions.ts` and `prompt-submit.ts`; wire bundle, `start.mjs`, `hooks.json`, `status.ts` and the two tools.
- [ ] **Step 4: Rebuild and run the tests** — `corepack pnpm build && corepack pnpm --filter @ftc/server exec vitest run src/coach src/hook` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Ask coach questions and capture answers with the prompt hook"`

---

### Task 12: Drills

**Files:**
- Create: `packages/server/src/coach/drills.ts`
- Modify: `packages/server/src/coach/status.ts` (fill `drills_ready`), `mcp/schemas.ts`, `mcp/server.ts`
- Test: `packages/server/src/coach/drills.test.ts`

**Interfaces:**
- Consumes: `passCount` (Task 3), `itemStatus` (Task 9), `openQuestion` and `captureAnswer` (Task 11).
- Produces:
  - `quoteIn(answer: string, quote: string): boolean` — case-insensitive match after squeezing whitespace; the quote must be at least 12 characters.
  - `drillGate(status: ItemStatus, attempts: DrillFact[], newProofsSinceLastFail: number, now: Date, t: Thresholds): { allowed: true } | { allowed: false; reason: string }` — allowed only when the state is `shown`; after a failed attempt, needs `newProofsSinceLastFail >= 1` or `drill_retry_days` days passed.
  - `pickDrill(item: LadderItem, attempts: DrillFact[]): Drill` — the first drill never tried (void attempts count as tried); if all were tried, the one tried longest ago.
  - `startDrill(db: Db, input: { item_id: string; ladder_id?: string; session_id: string }, now?: Date): { question_id: string; drill_id: string; prompt: string }` — checks the gate, creates and opens a `drill` question with the drill prompt as its text.
  - `scoreDrill(db: Db, input: { question_id: string; hits: { id: string; quote: string }[]; red_flags: { id: string; quote: string }[] }): { passed: boolean; kept_hits: string[]; dropped: string[]; missed_points: { id: string; text: string }[]; red_flags_hit: string[]; study: string[] }` — only for an answered drill question; drops ids not in the drill and quotes not in the answer; `passed` = kept hits ≥ `passCount(drill)` and no kept red flag; inserts a `drill_attempts` row; returns the missed key points with the key's own wording and the item's study topics.
  - MCP tools: `start_drill` (input of `startDrill`), `score_drill` (input of `scoreDrill`).

- [ ] **Step 1: Write the failing tests:**
  - gate: `learning` → not allowed, reason mentions Shown; `shown` → allowed; after a fail today with no new proof → not allowed; 3 days later → allowed;
  - `pickDrill` never repeats until all drills are used, then returns the oldest;
  - `scoreDrill` with 2 of 3 real quotes and no red flag → `passed: true` and the item becomes `proven` in `itemStatus`; a made-up quote is in `dropped` and not counted; one kept red flag → `passed: false` even with 3 hits; a hit id not in the drill is dropped;
  - `scoreDrill` on an unanswered question → `StoreError`;
  - `disagree` on the drill attempt (Task 10) voids it and the item goes back to `shown`.
- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/coach/drills.test.ts` → FAIL.
- [ ] **Step 3: Implement** `drills.ts`; register the two tools; fill `drills_ready` with the ids of Shown items whose gate is open.
- [ ] **Step 4: Run the tests** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add interview drills scored against a fixed key"`

---

### Task 13: Focus frames, the plan check, and stack notes

**Files:**
- Create: `packages/server/src/coach/plan.ts`
- Modify: `packages/server/src/store.ts` (`saveGrowthPlan`), `packages/server/src/coach/status.ts` (fill `focus`), `mcp/schemas.ts` (`saveGrowthPlanInput`, `saveStackNoteInput`), `mcp/server.ts`, `packages/server/src/api/data.ts` (`latestGrowthPlan` passes `item_id`, `spot`, `stack` through)
- Test: `packages/server/src/coach/plan.test.ts`, `packages/server/src/mcp/server.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 9, 10.
- Produces:
  - `interface FocusFrame { ladder_id: string; item_id: string; title: string; state: ItemState; needs: string[]; stack: string | null; stack_note: { note: string; link: string; source: "ladder" | "local" } | null; study: string[]; spot: { file: string; symbol: string | null } | null; evidence_ids: string[] }`
  - `pickFocus(statuses: ItemStatus[], ctx: { ladders: LoadedLadder[]; recentFaultItems: Set<string>; workedAreas: Set<string> }, max = 3): ItemStatus[]` — only areas the developer has evidence in (`workedAreas`), only items at the lowest level not yet reached in that area or the next one; order: items with a recent unfixed fault, then `shown`, then `learning` by most proofs; at most one item per area unless fewer than `max` areas qualify.
  - `buildFrame(db: Db, status: ItemStatus, ctx: { ladder: LoadedLadder; stacks: StackHit[] }): FocusFrame` — `spot` is the newest unfixed fault of the item, else its newest dev proof; `stack` from `stackForPath` on that spot's file (else the first stack of the track); `stack_note` from the ladder, else `stack_notes_local`, else `null`.
  - `saveStackNote(db: Db, input: { ladder_id: string; item_id: string; stack_id: string; note: string; link: string }): void` — refused when the ladder already has a note for that stack; `link` must be `https://`.
  - `saveGrowthPlan` changes: each focus area may carry `item_id`, `ladder_id`, `spot`, `stack`. When `item_id` is set: the item must exist in that ladder; every evidence id must be a `skill_evidence`, rated `pending_questions` or `drill_attempts` id **of that item**; there must be a `spot`, or the exercise must contain the word `ticket`; when there is a `spot`, the exercise must name the spot's file name. `tentative` keeps its meaning (one piece of evidence). Old focus areas with observation ids and no `item_id` still save as today.
  - MCP tool: `save_stack_note`.

- [ ] **Step 1: Write the failing tests:**
  - `pickFocus` puts an item with an open fault before a `shown` item, a `shown` item before a `learning` item, and never picks from an area with no evidence;
  - `buildFrame` uses the fault spot when there is one, `stack: "express"` for a file under the express folder, and the ladder's stack note;
  - a frame for a stack the ladder lacks has `stack_note: null`; after `saveStackNote` it has `source: "local"`; `saveStackNote` for `express` (already in the ladder) is refused;
  - `save_growth_plan` with `item_id: "BE.ERR.M2"` and an exercise that does not name the spot file is rejected; with an evidence id of another item it is rejected; a valid one saves and `latestGrowthPlan` returns `item_id` and `spot`; an old-style plan with observation ids still saves.
- [ ] **Step 2: Run to see them fail** — `corepack pnpm --filter @ftc/server exec vitest run src/coach/plan.test.ts src/mcp/server.test.ts` → FAIL.
- [ ] **Step 3: Implement** `plan.ts` and the `saveGrowthPlan` change; fill `focus` in `coachStatus`; register `save_stack_note`.
- [ ] **Step 4: Run the tests** → PASS, plus the existing API tests: `corepack pnpm --filter @ftc/server exec vitest run src/api` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Build focus frames and check that plans stay personal"`

---

### Task 14: Skills, docs and version

**Files:**
- Modify: `packages/plugin/skills/coach/SKILL.md` (rewrite), `packages/plugin/skills/explain-back/SKILL.md`, `packages/plugin/skills/pr-decisions/SKILL.md`, `packages/plugin/skills/paper-trail/SKILL.md` (mention `item_id` on `log_decision`), `packages/plugin/skills/status/SKILL.md`, `packages/plugin/.claude-plugin/plugin.json` (version `0.15.0`), `README.md`
- Create: `docs/coach-levels.md`
- Test: `packages/server/src/mcp/stdio.test.ts` (tool list)

**Interfaces:**
- Consumes: every tool from Tasks 10 to 13.

What each skill must say (wording is the builder's, short and simple):

- **coach** — argument modes: none, `open` (unchanged), `drill <item-id>`, `why <item-id>`, `history`.
  - No argument: if `coach_status` shows no tracks, ask once "backend, frontend, or both?" and call `set_coach_tracks`. Show `text` exactly as returned. Show any ladder warning and the catch-up note. For each `focus` frame, write the claim from its `needs` and evidence, and one exercise that names the frame's `spot` file (or the next ticket when there is no spot), using the stack note and study topics; if a frame has `stack` but no `stack_note`, write one short note from the item's `good_looks_like` and the stack's official docs and save it with `save_stack_note` first. Save with `save_growth_plan` (with `item_id`, `ladder_id`, `spot`, `stack`). Then offer the pending `questions` (step below) and any `drills_ready`.
  - Asking a question: one at a time; word it from `about` without giving the answer away; call `ask_question` right before asking; wait; then call `rate_answer` with an honest rating, and a `tradeoff_quote` copied word for word from the answer only if it names the trade-off. Tell the developer that "later" or "skip" keeps the question for next time.
  - `drill <id>`: `start_drill`, ask the prompt, wait, then `score_drill` with each hit and red flag and the exact words that show it. Show each key point as hit or missed with the key's wording, then the study topics for the missed ones.
  - `why <id>`: `coach_item`; list proofs, faults, answers and drills with their ids; say the developer can `disagree` with evidence or a drill score, and that disagreeing never raises a level.
  - Rules: never say a level or state the server did not return; never rate up to be kind; no code in saved text.
- **explain-back** — use `ask_question` with `decision_id` (and `item_id` when the decision has one) and `rate_answer` instead of `record_explain_back`; stop calling `save_observation`.
- **pr-decisions** — after the section is written, call `coach_status`, then offer up to 3 of its `questions` (asking as in the coach skill) and one drill from `drills_ready`. Say clearly these stay on the developer's machine and are not in the pull request.
- **docs/coach-levels.md** — how Coach decides a level: the ladder, who wrote a line, the 4 states with the exact thresholds, drills, "disagree lowers only", what stays local, and the honest limits of spec section 10 that apply to stage 1.

- [ ] **Step 1: Update the tool-list test** in `stdio.test.ts` to expect the new tools (`coach_status`, `set_coach_tracks`, `coach_item`, `coach_history`, `propose_evidence`, `disagree`, `ask_question`, `rate_answer`, `start_drill`, `score_drill`, `save_stack_note`).
- [ ] **Step 2: Run it** — `corepack pnpm build && corepack pnpm --filter @ftc/server exec vitest run src/mcp/stdio.test.ts` → PASS (tools already exist; the test pins the list).
- [ ] **Step 3: Rewrite the skills and docs** as above; bump `plugin.json` to `0.15.0`.
- [ ] **Step 4: Validate the plugin** — `corepack pnpm plugin:validate` → both validate with no errors.
- [ ] **Step 5: Commit** `git commit -m "Rewrite the coach skills for levels, drills and questions (0.15.0)"`

---

### Task 15: Full check and a real run

**Files:**
- Modify: `docs/coach-levels.md` (add a "Measured results" section with what the run showed)

- [ ] **Step 1: Full check** — `corepack pnpm check` → typecheck, build and all tests pass (server, eval, web). Write down the test counts.
- [ ] **Step 2: Real run** in a scratch repo under the session scratchpad, with `claude -p --plugin-dir C:/work/plugin/packages/plugin` and `FTC_DB_PATH` pointing at a scratch database:
  1. Ask Claude to write a small express service with an outside call (this records AI line hashes).
  2. As the developer, commit by hand on branch `PAY-1`: a time limit on the call (dev line); then on `PAY-2` another call with a time limit and retry with backoff.
  3. Run `/fork-trail-coach:coach` → the view shows `BE.ERR.M2` with proofs counted from the developer's lines only; the plan's exercise names a real file.
  4. Answer two why-questions with clear answers on the two tickets, one naming the trade-off → `BE.ERR.M2` is `SHOWN`.
  5. Run `/fork-trail-coach:coach drill BE.ERR.M2`; give a weak answer → fail; check the retry rule; after a new proof, a good answer → `PROVEN`.
  6. Commit an empty catch in the same function → the item drops to `LEARNING`.
  Expected: each state above appears as written. Record what really happened.
- [ ] **Step 3: Write the results** into `docs/coach-levels.md` ("Measured results"), including anything that did not work as expected. Never write "works" for a step that was not seen working.
- [ ] **Step 4: Commit** `git commit -m "Record the coach levels real-run results"`
