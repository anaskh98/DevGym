# Coach Stage 1.5 (Assessment Model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep proficiency apart from exposure, add the "Not assessed" state, make Learning mean a real gap, stop
Shown from decaying, add the drill-only path for low-exposure skills, and add "why it matters" and exercise kinds.

**Architecture:** Builds on stage 1 in `packages/server/src/coach/`. A new `skill_exposure` table (migration 8) holds
"had the chance" hits from new exposure signals. The pure state engine gains the new states and rules. No new hook.

**Tech Stack:** as stage 1.

**Spec:** `docs/superpowers/specs/2026-11-18-developer-growth-design.md`, section 11 (11.2 A, B, C, D, G and 11.4).

## Global Constraints

- All stage 1 global constraints still hold (Node 22 PATH, `dev` branch, no push without OK, append-only migrations, no
  code stored, privacy guard, hooks exit 0, rebuild the bundle when server code changes, simple English).
- This plan adds **migration id 8** only.
- Exposure thresholds, exact defaults: window 90 days; Low from 1 distinct function, Medium from 3, High from 6.
- Drill-only Shown: exposure None or Low, **2 passed non-void drills on different prompts**, and **1 clear answer**, all
  after the regression point. Marked `shown_by: "drill"`. Proven still needs work-Shown plus a drill passed while
  work-Shown.
- Exercise kinds: `implement`, `debug`, `review`, `design_tradeoff`, `architecture`, `explain`.
- Old company ladder files without the new fields must still load (new fields are optional).

## Review Focus

1. A developer with positive proofs and no gap must see **Not assessed**, never Learning. Test in Task 2.
2. A Shown item with no new activity for a year must stay Shown. Test in Task 2.
3. A low-exposure developer can never reach **Proven** from drills alone. Test in Task 3.
4. AI-written lines still give exposure (the task needed the skill) but never credit. Test in Task 1.
5. A company ladder without `exposure_signals`, `why_it_matters` or `exercise_kinds` loads and works. Test in Task 4.

---

### Task 1: Exposure

**Files:** `db/migrations.ts` (migration 8 `skill_exposure`), `coach/ladder/schema.ts` (`exposure_signals?: string[]`,
thresholds `exposure_window_days`, `exposure_low`, `exposure_medium`, `exposure_high`), `coach/signals.ts` (new
signals), `coach/ladder/builtin/*.json`, `coach/capture.ts`, `coach/exposure.ts` (new), tests.

**Interfaces:**
- Table `skill_exposure(id PK, ladder_id, item_id, repo_root, commit_sha, file_path, symbol, ticket, signal_id, at,
  created_at)`, index `(ladder_id, item_id)`.
- New signals: `io.outside-call` (fetch, axios, http clients, requests, RestTemplate, WebClient, `http.Get`),
  `io.db-query`, `err.try-catch`, `err.throw`, `api.request-body`, `fetch.request` (fetch, useQuery, useSWR, axios,
  Angular HttpClient).
- Built-in `exposure_signals`: BE.ERR.J1 `err.try-catch`; J2 `io.outside-call`, `io.db-query`; M1 `api.request-body`;
  M2 `io.outside-call`; M3 `err.throw`; S1 `io.outside-call`; S2 `err.try-catch`; X1 none. Every FE.FETCH item except
  X1: `fetch.request`.
- `type ExposureLevel = "none" | "low" | "medium" | "high"`.
- `exposureFor(db, ladderId, itemId, now, t): { level: ExposureLevel; functions: number }`: distinct (file, symbol)
  in the window, from `skill_exposure` rows **and** rule evidence rows (positive or negative) of the item.
- Capture: exposure hits on added code lines, **any author**, one row per (ladder, item, signal, file, symbol) per
  commit.

**Tests:** migration 8 creates the table; each new signal's examples; capture stores an exposure row for an outside call
with no time limit, and for an AI-written call (Review Focus 4); `exposureFor` gives none/low/medium/high at 0/1/3/6
functions and ignores rows older than 90 days.

### Task 2: States

**Files:** `coach/state.ts`, `coach/status.ts` (view, history reasons), `coach/questions.ts`, `coach/plan.ts`, tests.

**Interfaces:**
- `ItemState` adds `"not_assessed"`. `ItemStatus` adds `exposure: ExposureLevel`, `exposure_functions: number`,
  `shown_by: "work" | "drill" | null`, `shown_at: string | null`.
- `itemStatus` input adds `exposure: { level; functions }`.
- Rules, in order: **proven** (as now) > **shown** (work: the snapshot was Shown at any moment after the regression
  point, sticky; drill: 11.4 rule) > **learning** (a gap: regression point set, an unfixed counted fault, the latest
  rated answer is partial or not_yet, or the latest non-void drill failed with no pass after it) > **not_assessed** (any
  credit, answer, drill, fixed fault, or exposure) > **not_seen**.
- `needs` for not_assessed adds "more chances in your work, or take a drill" when exposure is None or Low.
- Questions are proposed for items that are not_seen, not_assessed or learning. Focus includes not_assessed items
  with credit, after learning items.

**Tests:** Review Focus 1 and 2; a fixed fault on another ticket alone gives not_assessed; a failed latest drill gives
learning; the history reason for a drop names the cause.

### Task 3: Drill-only path

**Files:** `coach/state.ts`, `coach/drills.ts`, `coach/questions.ts` (`openQuestion` with `item_id` only),
`mcp/schemas.ts`, `mcp/server.ts`, tests.

**Interfaces:**
- `drillGate` allows a drill when state is shown (as now) **or** exposure is None/Low and state is not proven.
- `openQuestion` accepts `{ session_id, item_id, text }` (no question or decision id): a `why` follow-up question on
  the item, `target_ref` `followup:<item_id>`, ticket `drill`.
- `drillsReady` stays Shown items only. Not-assessed low-exposure items show "drill available" in their detail.

**Tests:** low exposure, 2 passed drills on different prompts + 1 clear answer → shown with `shown_by: "drill"`; same
with 1 drill → not shown; the same drill prompt twice → not shown; drill-shown + more drills, still no work evidence →
never proven (Review Focus 3); high exposure + no work-Shown → drill refused.

### Task 4: Why it matters, exercise kinds, study rule

**Files:** `coach/ladder/schema.ts` (`why_it_matters?: string`, `exercise_kinds?: ExerciseKind[]`), built-in JSON,
`coach/plan.ts` (frame adds `why_it_matters`, `exercise_kinds`; `study` only when learning or a drill failed),
`store.ts` + `mcp/schemas.ts` (`exercise_kind` on item focus areas, required with `item_id`), tests.

**Rules:** `checkItemArea` refuses a kind not in the item's list (all kinds when the list is missing). With a spot, the
exercise names its file. With no spot, the kind must be `design_tradeoff`, `architecture` or `explain`, or the exercise
mentions the next ticket.

**Tests:** frame carries why_it_matters; study empty for a not_assessed item, filled for learning; a wrong kind is
refused; a design_tradeoff exercise without spot or ticket is accepted; a company ladder without the new fields loads
and a plan item saves (Review Focus 5).

### Task 5: View, skills, docs

- Progress view: state names include NOT ASSESSED; each area line shows its exposure; items show "little chance in
  your work · drill available" when that applies; "Study next" only from items with study topics.
- `coach` skill: explain exposure vs proficiency; the drill-only path and its follow-up question; exercise kinds and
  why it matters in the plan; study topics only when given.
- `docs/coach-levels.md`: the five states, exposure, no decay, the drill-only path.
- Plugin version 0.16.0.

### Task 6: Full check, real run, review

- `corepack pnpm check` green; restore regenerated web files.
- Real run in a scratch repo: an item with only good proofs shows NOT ASSESSED with its exposure; a low-exposure item
  reaches Shown (by drill) with 2 drills and a follow-up answer and stays out of Proven.
- Fresh whole-stage review; fix Critical and Important with tests first.
