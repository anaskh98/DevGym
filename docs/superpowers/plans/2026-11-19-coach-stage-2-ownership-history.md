# Coach Stage 2 (Ownership and History) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Make "who decided" unfakeable, hold the developer to account for faults they shipped (AI-written or not),
read all past commits once, and find bugs that reached main and bugs that repeat.

**Spec:** `docs/superpowers/specs/2026-11-18-developer-growth-design.md` sections 6.2, 6.3, 6.4.1, 6.5, 11.2 I.

## Global Constraints
- All stage 1 and 1.5 constraints hold. **Migration id 9** only. Node 22 PATH. No push without OK. Tests first.
- History scan: rules only, no AI per commit. Past commits give faults fully, credit at most 1 proof (`history: true`).
- A decision counts as the developer's only if the AI quotes (12+ chars) words from a developer message saved in that
  session. Otherwise it is stored as origin `ai`.
- Developer messages are local, deleted after 120 days.
- Repeat = the same item and signal on 3 or more distinct tickets or weeks.

## Review Focus
1. A made-up origin quote must never make a decision the developer's.
2. A developer must not be credited for an AI decision they never made.
3. The history scan must resume after a stop and never read a commit twice.
4. A fix commit whose bug came from someone else's commit must not be a shipped bug of this developer.
5. A fault proposed by the AI with lines not in the final change must be refused.

### Task 1: Developer messages and decision origin
Migration 9 (`developer_messages`, `shipped_bugs`, `decisions.origin_quote`). Prompt hook saves every message in a
session that is in a git repo (not slash commands), prunes at 120 days. `log_decision` gets `origin_quote`; for origin
`dev` or `dev_changed_ai` the server checks the quote against that session's messages, else stores `ai` and says why.
A decision with `item_id` writes `skill_evidence` kind `decision` (decided_by from the checked origin).
State engine: decision evidence without developer-written lines counts under the judge cap.

### Task 2: History scan
`historyScan(db, opts)`: all the developer's commits before capture start (and any not yet read), oldest first, in
batches of 200 per call, resumable through `commits_seen` (`history = 1`). Same signal and exposure rules, rows marked
`history`. `coach_status` runs one batch per call and reports progress ("read N of M").

### Task 3: Shipped bugs and repeats
Fix commits found by message (fix, bug, hotfix, revert). For lines removed by a fix that match a negative signal,
`git blame` the parent to find the origin commit; if it is the developer's, store a `shipped_bugs` row and a negative
`review`-kind evidence row `owned`. `repeats(db)` groups faults and shipped bugs by item and signal; the view lists them.

### Task 4: PR-time fault review
`propose_fault(item_id, commit range, file, lines, why)`: refused unless the lines are added in the base..head change
and the item exists. Stored as negative `review` evidence, `owned = 1` when the lines are AI-written by hash.

### Task 5: Skills, docs, full check, real run, review
