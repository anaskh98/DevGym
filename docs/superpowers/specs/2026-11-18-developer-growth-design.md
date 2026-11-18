# Developer growth: levels, ownership and ticket fit

Status: design, waiting for approval. Nothing here is built yet.
Branch: `dev`, cut from the latest `main` (f57fd25, which includes the Jira ticket import). All new work goes on
`dev`. It does not depend on the `path/evidence` or `path/quality` branches, and they are not pushed.

## 1. Intent

**The main purpose of the plugin is the developer's improvement.** Fork, Paper Trail and the new ticket check all
gather evidence about one developer. Coach turns that evidence into a plan that takes them from their level to the
next. The PR "Decisions" section stays, as a side benefit for reviewers.

Today Coach writes 1 to 3 focus areas from observations the AI wrote, with free-text skill tags and no idea of what
"good" means at a given level. So the plan drifts into general topics, and nobody can tell when a weakness is fixed.

This design makes Coach a **local, level-based study guide for one developer**:

- A **ladder** for backend and frontend says what a junior, mid, senior and staff engineer can do, split into small
  items that can be checked, with best practices for the developer's own stack.
- Evidence comes from the developer's **own work**, quietly, commit by commit. The plugin keeps two facts apart:
  **who wrote the code** and **who made the decision**.
- The developer **owns everything they ship**. Faults in AI-written code they shipped count against them too.
- After coding, a **ticket check** shows code that is missing, extra, or different from what the ticket asked.
- At pull request time, a few **questions**: why the developer made a choice, and, when ready, an interview-style
  **drill** on a new situation.
- **Plain code**, not the AI, decides each item's state and the level.
- The plan names the exact next items, the best practice for this developer's stack, and an exercise on a real spot
  in their own code.

What the developer should feel: "I failed this kind of interview question before. The plugin showed me the gap, I
practised it in my real work, I passed the drill, and now I can pass the interview."

Why this is different from other plugins: other tools review the code. This one tracks **the person**, from their
own daily work, keeps "who wrote" apart from "who decided", holds them to account for what they ship, and proves
growth with a drill instead of a self-rating. It stays on the developer's machine.

## 2. Decisions the user made

| Topic | Decision |
|---|---|
| Purpose | The developer's improvement is the main purpose of the whole plugin. |
| Who it is for | The developer only, locally. A study guide for their career. Not for managers. |
| Ladder | A built-in generic ladder, plus an optional company file that replaces it. **Backend and frontend only** in this phase. |
| Evidence | From the developer's own work, so improvement can be tracked over time. |
| Who wrote vs who decided | Kept apart. AI can write the code of a decision the developer made. |
| Ownership | AI faults in shipped code are the developer's faults too: they should have reviewed it. |
| Timing | Silent per commit, questions at PR time. |
| Judging | Fixed rules plus an AI judge that must cite evidence; plain code decides the state and level. |
| Definition of done | The 4 states in 6.6. **The drill is required to reach Proven.** |
| Ticket check | Shows missing, extra and different code to the developer. **The developer decides** what to do. It is not shown to reviewers. |
| "Efficient" Coach | The plan is really good and fits this developer: it moves them to the next level with the best practices of the part of the project they work in. Also save tokens. |
| Branches | Build on `dev` from `main`. Do not depend on or push `path/evidence` or `path/quality`. |
| Stack | Always the stack of the project the developer is working in, found from the repo. |
| History | Read **all** the developer's past commits, to find bugs that repeat. |

## 3. Goals, non-goals, anti-goals

**Goals**

1. Every plan item names a ladder item at the developer's current or next level, the best practice for their stack,
   and an exercise on a real spot in their code or the next ticket. Never a general topic.
2. Capture is automatic. The developer logs nothing by hand. Storage is done by code, not by the AI remembering.
3. Each item has a clear definition of done the developer can read and check.
4. The developer sees growth over time: when each item changed state, and why.
5. Low token cost: code does the counting and picking; the AI only words things, judges with citations, and reviews
   the changed code once per pull request.
6. Everything stays local.

**Non-goals (this phase)**

- Ladders for mobile, data, DevOps or other tracks.
- A manager or team view, team comparison, or any sharing of levels.
- A web page for levels. The existing `/coach open` report keeps working; a levels page can come later.
- Replacing real interviews or giving a job title.

**Anti-goals (this would be a failure even if it works)**

- It becomes a performance-review or monitoring tool.
- Levels go **up** because the AI wrote good code.
- The AI can raise a level on its own, or the developer can raise it by clicking "I disagree".
- A plan of general advice ("study error handling") that would fit anyone.
- Questions on every commit, or anything that blocks a commit or a pull request.
- Any level, answer, score, fault or ticket-check result leaves the machine.

## 4. Constraints

- Same stack as today: Node 22.13 or newer, `node:sqlite`, the MCP server over stdio, Claude Code hooks, the esbuild
  bundle committed in `packages/plugin/server/`.
- Migrations are append-only. Ids 4, 5 and 6 are used on the path branches; **this work starts at id 7** so a later
  merge cannot clash.
- The rules engine, the git diff reader and a UserPromptSubmit hook exist only on `path/quality`. They are written
  again on `dev` in a **shared, neutral form** (for example `src/rules/engine.ts`, `src/git/diff.ts`, and a prompt
  hook that hands each message to a list of handlers), not copied from the risk code.
- Hooks never break the session: every failure exits 0 quietly, and they stay fast (today about 75 ms).
- The privacy guard applies to every stored text: no code, no secrets, no client names.
- No code is ever stored. Only paths, symbol names, commit ids, line hashes, rule ids, and the developer's own words.
- User-facing text uses short, simple English.

## 5. Approaches considered

**How judging works** (chosen: C)

| | How | Trade-off |
|---|---|---|
| A. AI judges all | The AI reads code and answers and sets the level. | Cheap to build. Not repeatable, easy to inflate, the developer cannot check why. |
| B. Rules only | Regex rules and counts decide everything. | Repeatable. Cannot read the quality of an answer, a design reason, or whether code fits a ticket. |
| **C. Rules + cited AI judge, code decides** | Rules find code signals. The AI may add findings only with a citation the server checks. Plain code turns stored evidence into states and levels. | More to build. Repeatable where it matters, and every state can be explained line by line. |

**When it runs** (chosen: C): A, questions on every commit, is too noisy. B, only on request, is forgotten. C reads
every commit quietly and asks at most 3 questions when a pull request is prepared.

**Where the ladder comes from** (chosen: C): built-in only does not fit companies that have one; company file only
leaves most developers with nothing; C ships a generic ladder and lets a company file replace it.

**What the ticket check does with a finding** (chosen: show it, the developer decides): blocking the PR goes against
"nothing blocks"; telling the reviewer puts the developer's misses in front of others, which hurts the "for the
developer only" promise.

## 6. The design

### 6.1 The ladder file

A JSON file, checked with zod when loaded.

- Built-in files ship in the plugin: `ladders/backend.json` and `ladders/frontend.json`.
- A company file replaces a built-in track if present: first `<repo>/.fork-trail-coach/ladder.json`, then
  `~/.fork-trail-coach/ladder.json`. If it fails the check, the built-in ladder is used and `/coach` says why.

Shape:

```
track: "backend" | "frontend"
areas: [ { id, name, levels: { junior: [item], mid: [item], senior: [item], staff: [item] } } ]
thresholds (optional): overrides the numbers in 6.6
```

Each **item**:

| Field | Meaning |
|---|---|
| `id` | Stable id, for example `BE.ERR.M2` (track, area, level letter, number). |
| `title` | One line: "Handles the failure of an outside call on purpose". |
| `good_looks_like` | 1 to 3 plain sentences: timeout set, retry only when safe, a clear error to the caller. |
| `signals` | Rule ids that show the item in code. Each is `positive` or `negative`; a negative one can be marked `regresses: true`. |
| `explain_angles` | 1 to 3 "why" angles to ask about the developer's own code. |
| `drills` | 2 or 3 new-situation questions. Each has `prompt`, `key_points` (with ids), `red_flags` (with ids) and `pass` (how many key points are needed; default two thirds, rounded up). |
| `study` | 2 to 4 specific topics, for example "idempotency keys", "retry with backoff and jitter". |
| `stack_notes` | Best practice for this item **per stack**, keyed by stack id (6.9): what to use and what to avoid, in 1 to 3 lines, with one link to official docs. |

Built-in areas (the builder may adjust names):

- **Backend**: errors and failure, data and storage, API design, security, performance, testing, code structure,
  **requirements and scope**.
- **Frontend**: state and data flow, components and structure, rendering performance, accessibility, data fetching
  and errors, security, testing, **requirements and scope**.

"Requirements and scope" holds items such as "spots unclear needs before coding" (fed by Fork) and "builds only what
the ticket asks" (fed by the ticket check, 6.8). Both tracks also get a "reviewing AI code" item at each level
(fed by 6.5).

Each area has 2 to 4 items per level. Staff level may have fewer.

### 6.2 Two separate facts: who wrote it, who decided it

**Who wrote the line.** The PostToolUse hook already runs on every Claude edit. It will also save a **hash of each
line Claude wrote** with the file path and session, never the line. Before hashing, the line is cleaned so a formatter
does not turn AI lines into developer lines (my call): all whitespace removed, `'` and `` ` `` turned into `"`, a
trailing `,` or `;` dropped; then SHA-256, first 16 hex characters. Lines shorter than 4 characters after cleaning are
not hashed and never count. When a commit is read, an added line is **AI-written** if its hash matches, else
**developer-written**. Hashes older than 120 days are deleted.

**Who made the decision.** This is about the choice, not the typing. If Claude wrote code, and the developer then
said "no, use a queue instead", Claude wrote the new code too, but the **decision is the developer's**.

- The UserPromptSubmit hook saves each developer message in a tracked session (local only, deleted after 120 days).
- When the AI logs a decision with origin `dev` or `dev_changed_ai`, it must **quote the developer's words** that
  made the choice. The server checks the quote is in a saved message from that session. If not, the origin is
  stored as `ai`, and the reply says why.
- So each decision has an origin the AI cannot fake, and each code line has an author the AI cannot fake.

Known gaps, accepted for this phase and written in the docs: lines from other AI tools (for example Copilot) or pasted
from a chat look developer-written; files Claude writes through the shell look developer-written (the hook sees only
Edit, Write, MultiEdit, NotebookEdit); a formatter that wraps one line into several breaks the match.

### 6.3 Credit and ownership: what counts for and against the developer

One rule, easy to say: **you earn credit for what you wrote or decided; you own the faults in everything you ship.**

| Evidence | Counts for (positive) | Counts against (negative) |
|---|---|---|
| Developer-written lines | Yes | Yes |
| AI-written lines, decision by the developer (quote checked) | Yes, for the decision's item | Yes |
| AI-written lines, decision by the AI | **No** | **Yes**, as an owned fault (6.5) |
| Explain-back answers and drills | Yes | Yes |

So AI code can never raise a level by itself, but a fault the developer let through is still theirs.

**Caught before shipping is a plus.** If an AI-written line had a negative signal and the developer changed or removed
it before it was committed, that is positive evidence for the "reviewing AI code" item.

### 6.4 Silent capture, commit by commit

No git hook is installed. A **catch-up step** reads every new commit on the current repo whose author email is the
developer's `git config user.email`. It runs at the start of `/coach`, `/explain-back`, `/pr-decisions` and
`/coach drill`. It is idempotent (processed commit ids are stored) and reads at most 200 new commits per run.
Commits from before install are read once by the history scan (6.4.1).

For each commit it runs the **signal rules** on the added lines (regex over added lines, with `unless`, comment and
import skipping, filtered by language and track) and stores one **evidence row** per hit: item, signal, positive or
negative, author (AI or developer), decision origin if a decision covers it, commit, file, symbol, ticket, date.
No code.

**What counts as one proof** (my call):

- One proof = one (item, signal, file, symbol). Several hits in the same function count once, even across commits.
- Rebased, squashed or cherry-picked commits are matched by `git patch-id`, so a change is never read twice.
- Ticket for the 2-ticket rule: the Paper Trail ticket, else the branch name. A commit straight on the default branch
  with no ticket uses its calendar week as its "ticket".

#### 6.4.1 The history scan: all past commits

**The plugin reads all the developer's past commits in the repo** (the user's choice), so it can see bugs that repeat.

- It runs once per repo, the first time `/coach` runs there, then the catch-up step keeps it current. It shows
  progress ("read 840 of 1,920 commits") and can stop and resume, because it stores each commit it has read.
- It reads the developer's commits by author email: `git config user.email` plus any extra emails the developer adds
  once in settings (people often have a work and a personal email).
- Plain code does all of it: the same signal rules as 6.4, run on every past commit. No AI call per commit.

**Past commits have no line hashes**, so the plugin cannot tell who wrote each line. The rule (my call):

- **Faults count fully.** The developer owns what they shipped (6.3), whoever typed it.
- **Credit is capped.** A past commit can give at most 1 of the 3 proofs an item needs for Shown, and only if its
  message has no AI trailer (for example `Co-Authored-By: Claude`). Why: it could be AI code, and AI code must not
  raise a level.

**Real bugs, not just rule hits.** The history scan also finds **bugs that reached the main branch**:

1. Code finds fix commits: the message says fix, bug, hotfix, revert, or names an issue key marked as a bug.
2. For each, `git blame` on the lines the fix removed or changed finds the commit that brought the bug in. If that
   commit is the developer's, it is a **shipped bug**.
3. The AI reads the fix diff once and names the ladder item the bug breaks, citing the fix's file and lines. The server
   checks the citation. The result is saved, so each fix is read by the AI only once.
4. To save tokens on the first run, the AI reads at most the 50 latest fix commits; older ones are read on later runs,
   50 at a time (my call). The rule hits need no AI and cover all of history.

**Repeated bugs.** Code groups faults and shipped bugs by ladder item and by signal. A **repeat** is the same item hit
on 3 or more different tickets or weeks. Repeats are shown first in the view and in the plan:

```
Repeats (whole history)
  BE.ERR.M2 Outside call with no time limit     7 times · 5 tickets · last: 2 weeks ago · 2 reached main as bugs
  BE.DATA.M1 Query inside a loop                4 times · 3 tickets · last: 3 months ago
```

A repeat that has not come back in the last 60 days is shown as "fixed habit?", which is good news worth seeing.

### 6.5 Owned faults: the PR-time review

At `/pr-decisions` time, faults are counted on the **final change of the pull request** (base to head), not per
commit, so a fault fixed before the PR does not count. Two sources:

1. **Rules:** negative signals still present in the final change, on any line, AI-written or not.
2. **AI review, once per PR:** the AI reads only the changed functions and lists bad practices, faults and bugs. Each
   finding must give: the ladder item it breaks, the file and line range in the final change, and one plain sentence
   why. The server keeps a finding only if the lines are really in the change and the item exists.

Each kept fault is shown to the developer with who wrote it and who decided it. It is stored as negative evidence
for its item, marked `owned` when the AI wrote it. Then the developer may fix it (best), or keep it. "I disagree"
removes it from the count, with their reason saved.

Faults feed the plan (6.10). A fault on a `regresses: true` signal drops a Shown or Proven item to Learning.

### 6.6 States and the definition of done

Plain code computes each item's state from stored rows, every time it is asked. Numbers are defaults; a company file
may change them.

| State | Rule |
|---|---|
| **Not seen** | No rows for the item. |
| **Learning** | At least 1 positive proof, or any `partial` or `not_yet` answer, or any fault, or it regressed. |
| **Shown** | **Both** of these. **Code:** 3 or more positive proofs (6.3), across 2 or more tickets, within the last 60 days, with no unfixed fault on the item in that time. **Explained:** 2 or more answers on this item rated `clear`, on different tickets, at least one naming the trade-off (6.7). |
| **Proven** | Was Shown when the drill was taken, **and passed a drill** (6.8). Shown never becomes Proven without a drill. |

**Going back.** A fault on a `regresses: true` signal, or a newer `not_yet` answer, drops the item to **Learning**.
After that, only proofs and answers dated after the drop count toward Shown again, and a **new** drill is needed.

**Proven does not expire** (my call). The view shows how long ago the last proof was.

**Level in an area** = the highest level where every item of that level and all lower levels is Proven. There is
never one overall number.

**AI-added evidence limit** (my call): positive evidence the AI proposed (6.7) counts only after its citation is
checked, and for an item that has signal rules, at most 1 of the 3 proofs may come from the AI.

**The developer can lower, never raise.** "I disagree" on positive evidence removes it. "I disagree" on a fault removes
it from the count but keeps the reason, and the developer sees it in `/coach why`. "I disagree" on a drill score voids
that attempt and unlocks another prompt; it never turns a fail into a pass.

Every state change is written to a history table with the reason, so the developer can see "BE.ERR.M2: Learning on
3 Oct, Shown on 28 Oct, Proven on 12 Nov".

### 6.7 Questions at PR time

At `/pr-decisions` (or `/coach`), after the catch-up step, the skill offers **at most 3 questions**. The developer may
answer "later"; those questions stay pending and come back. Nothing blocks the pull request.

Picked by code, worded by the AI, in this order:

1. **Owned faults** from 6.5: "This call has no time limit. What happens to the user when the provider hangs?"
2. **Why-questions on the developer's own decisions and code**, on items that are Not seen or Learning.
3. **Explain-back** on AI decisions, as today, tagged with the item.
4. **A drill offer** (at most 1) for an item that is Shown.

**Answers are captured by the hook, not retyped by the AI** (my call). Questions come one at a time. The AI calls
`ask_question(question_id)` just before asking; this opens that one question for this session only. The
UserPromptSubmit hook saves the developer's next message in this session as the answer and closes it. A reply of only
"later" or "skip" closes it unanswered. An open question with no reply in 30 minutes closes the same way. If the
privacy guard rejects the text, only the rating and matched points are stored, with a note.

**Rating.** The AI gives `clear`, `partial` or `not_yet`. To mark "names the trade-off", it must quote the words from
the answer; the server checks the quote, or drops the flag.

**The AI may also add positive evidence** with `propose_evidence(item_id, commit, file, line_start, line_end, why)`.
The server accepts it only if those lines were added in that commit and pass the credit rule in 6.3.

### 6.8 The ticket check

Runs at `/pr-decisions`, before the questions, and on its own with `/check-ticket <id>`.

Inputs: the ticket text (from the plugin's tickets or Jira, through the existing import), the Fork assumptions, and
the final change of the pull request.

The AI lists findings of three kinds. Each must cite **both** a ticket sentence (or assumption id) and a file and line
range in the change, except "missing", which cites only the ticket sentence:

| Kind | Meaning |
|---|---|
| **Missing** | The ticket asks for it; no code does it. |
| **Extra** | Code that no ticket sentence or assumption asks for. It may work, but nobody needed it. |
| **Different** | Code does something other than what the sentence asks. |

The server keeps a finding only if the quoted ticket words are in the ticket or assumptions and the lines are in the
change. **The developer decides** for each: fix it, or keep it with a short reason typed in their own words (captured
by the hook, as in 6.7). Nothing is shown to reviewers.

Coach evidence ("requirements and scope" area): a kept finding with no good reason is negative; a check with no
findings on a ticket with 3 or more needs is positive. Extra code the AI wrote counts too, as owned (6.3): the
developer accepted it without checking it against the ticket.

### 6.9 The developer's stack and project part

So the plan fits "this segment of the project", code finds:

- **The stack** of the repo, from its files: `package.json` dependencies (for example `express`, `nestjs`, `react`,
  `next`, `angular`, `vue`), `pom.xml` or `build.gradle` (Spring), `*.csproj` (.NET), `requirements.txt` or
  `pyproject.toml` (Django, FastAPI), `go.mod`. Each maps to a stack id used in `stack_notes`.
- **The part the developer works in**: the top folders their commits touched in the last 60 days, and the track of
  those files.

**The stack is always the stack of the project the developer is working in** (the user's choice). There is no fixed
list of supported stacks:

- The ladder ships `stack_notes` for a few common stacks, to start.
- For any other stack, the first time an item needs a note, the AI writes one from the item's `good_looks_like` and
  the stack's official docs, in the same short shape. It is saved locally per (item, stack) and reused, so it is
  written once, not on every run (my call). It is marked "written for your stack by the AI" in the view.
- A repo with two stacks (for example an API and a web app) uses the stack of the folder the item's evidence is in.

### 6.10 The growth plan

`/coach` with no argument:

1. Runs the catch-up step.
2. Shows the progress view, worked out by code.
3. Picks up to **3 focus items by code**, in this order: repeats that are still coming back (6.4.1), then items
   with recent owned faults, then Shown items (they only need a drill), then Learning items with the most proofs, all
   at the lowest level not yet reached in each area the developer works in.
4. For each, builds a **fixed frame** by code: the item, its state, what is missing for the next state, the stack
   note, the study topics, and **one real spot** from the developer's recent code linked to the item (a fault spot
   if there is one), as a file and symbol.
5. The AI fills in only the wording and one exercise: "In `orders/pay.ts`, `chargeCard` has no time limit. Add one,
   decide what the caller sees, and be ready to explain why." It saves the plan with `save_growth_plan`.
6. The server rejects a plan item that has no ladder item, no evidence, or an exercise with no spot or ticket. This is
   what keeps the plan personal and not general.
7. Offers any pending questions.

The first run asks once which tracks to follow: backend, frontend or both. Stored locally.

Progress view (text, in the terminal):

```
Backend · Errors and failure        Level: Mid  ·  working toward Senior
  BE.ERR.M1 Validate input at the edge     PROVEN    drill passed 12 Nov
  BE.ERR.M2 Handle outside-call failure    SHOWN     ready for a drill → /coach drill BE.ERR.M2
  BE.ERR.M3 Errors carry useful context    LEARNING  1 of 3 proofs · 1 owned fault · last answer: partial
  Next for Senior: BE.ERR.S1 Design for partial failure    NOT SEEN

Your stack: Node + Express
Study next: AbortController time limits on fetch · retry with backoff and jitter · idempotency keys
```

Other commands: `/coach why <item-id>` lists every proof, fault, answer and drill for one item, each with an id the
developer can mark "I disagree"; `/coach history` shows state changes over time.

**Token budget** (my call): code does the catch-up, the counting, the picking and the frame. The AI is called for
the PR review and ticket check once per pull request (changed functions only), for wording questions and the plan,
and for scoring answers. No AI call runs per commit.

### 6.11 Data (migration 7 onward)

Names are a proposal; the builder may rename.

| Table | Holds |
|---|---|
| `ai_line_hashes` | session, file path, line hash, created. |
| `developer_messages` | session, message text, created. Local only, deleted after 120 days. |
| `commits_seen` | repo root, commit id, patch id, from history scan (yes/no), processed at. |
| `shipped_bugs` | id, repo, fix commit, origin commit, item id, file, line range, AI read it (yes/no), created. |
| `stack_notes_local` | item id, stack id, note, created. The AI-written notes for stacks the ladder does not cover. |
| `history_scans` | repo root, started, finished, commits read, last commit read (to resume). |
| `skill_evidence` | id, ladder id, item id, kind (`rule`, `judge`, `decision`, `review`, `ticket_check`), polarity, author (`ai`/`dev`), decided by (`ai`/`dev`), owned flag, repo, commit, file, symbol, ticket, signal id, note, created, disagreed (with reason). |
| `ticket_findings` | id, ticket, kind (`missing`/`extra`/`different`), ticket quote, file, line range, developer choice (`fixed`/`kept`), reason, created. |
| `pending_questions` | id, session, kind, item id, what it points at, opened at, answer text, answered at. |
| `drill_attempts` | id, item id, drill prompt id, key points hit, red flags hit, passed, void, created. |
| `item_state_history` | ladder id, item id, from state, to state, reason, at. |
| `coach_settings` | tracks chosen, extra author emails. |

Also: `decisions` gets `item_id` and `origin_quote`; `explain_backs` gets `item_id`, `names_tradeoff` and
`tradeoff_quote`; `growth_plans` focus areas get `item_id`, `spot` and `stack` in their JSON.

**Old Coach data** (my call): `observations` stays and old plans still load. New focus areas cite evidence, answer
or drill ids; `save_growth_plan` accepts those as well as observation ids. `/explain-back` stops writing observations.
`/coach open` keeps working.

**One global database, progress per ladder** (my call): progress on the built-in ladder counts across every repo with
no company file. A company ladder applies only in its repo, with only that repo's evidence. `/coach` shows the ladder
for the current folder.

None of this goes into the PR "Decisions" section.

### 6.12 What the developer does, start to finish

1. Install the plugin. Run `/coach` once and pick backend, frontend or both. It reads your past commits in this repo
   (once) and shows your repeated bugs and a first plan.
2. `/fork` a ticket (from the plugin's tickets or Jira). Answer the questions about unclear needs.
3. `/paper-trail` and code as usual, with Claude. Tell Claude when you want a different way; that makes the decision
   yours. Commit. Nothing is asked while coding.
4. Before the pull request, run `/pr-decisions`. It reads the new commits, runs the ticket check and the fault review,
   and shows what it found. Fix or keep each one. Then answer up to 3 short questions, or say "later".
5. When an item is Shown, take its drill: `/coach drill <id>`.
6. Run `/coach` any time to see your levels, your next 3 items, what to study for your stack, and an exercise in your
   own code.

## 7. How we will know it works

- **Unit tests for the state engine**: each transition in 6.6, the credit and ownership table in 6.3, the 60-day
  window, the 2-ticket rule, the AI-evidence limit, regression, "disagree lowers only", the drill lock.
- **Ladder loading**: valid file, broken company file falls back, unknown signal ids rejected.
- **Who wrote / who decided**: Claude writes lines, the developer asks for a change, Claude rewrites them, the developer
  edits one line by hand; commit. Author and decision must both be right. A decision with a made-up quote is stored as
  `ai`.
- **Owned faults**: an AI-written fault counts against the developer; the same fault fixed before the PR does not, and
  counts as a catch.
- **History scan**: on a sample repo with known fix commits, the shipped bugs and their origin commits are found; a
  stopped scan resumes; past commits give faults fully and at most 1 proof; repeats are grouped right. Also time the
  first scan on a large real repo (a few thousand commits) and report it.
- **Ticket check**: a quote not in the ticket is dropped; missing, extra and different each found on a sample ticket.
- **Plan check**: a plan item with no ladder item, evidence or spot is rejected.
- **A real scenario run** with `claude -p --plugin-dir` on a scratch repo: one item goes Not seen → Learning → Shown →
  drill failed → drill passed → Proven, then regresses after a fault.
- **Signal precision**: run the signal rules over a few real repos and report wrong hits.

## 8. Build order

One design, built in 3 stages, each usable on its own:

1. **Levels core**: ladder format and loader, one area per track fully written, line hashes, catch-up, signal rules,
   state engine, drills, the new `/coach` plan.
2. **Ownership and history**: developer messages, quote-checked decision origin, the credit and ownership rules, the
   PR-time fault review, the "reviewing AI code" items, the history scan, shipped bugs and repeats.
3. **Ticket check**: findings, the developer's fix-or-keep choice, the "requirements and scope" items.

Then fill in the rest of the ladder content.

## 9. Left to the builder

- The exact wording of every item, signal rule, drill key and stack note. Bar: each item is checkable, each drill has
  a key a reviewer could score by hand, and study topics and stack notes are specific.
- Table and column names, indexes, the pruning job.
- How tickets are found when there is no Paper Trail session (branch name pattern).
- Language and file filters for each signal; the stack detection table.
- The exact text of the skills and the progress view, in short, simple English.

## 10. Honest limits

- The thresholds (3 proofs, 2 tickets, 60 days, 2 clear answers) are a starting guess. Real use should tune them.
- Signals are regex rules: they miss things and sometimes hit wrongly. The cited AI review and "I disagree" soften
  this.
- The PR review, the ticket check and drill scores still come from the AI. Citations, quote checks and the developer
  seeing every point make them open and repeatable, not perfect.
- A developer could look up a drill answer. It is their own study tool, so that only fools themself.
- Lines from other AI tools, or written by Claude through the shell, look developer-written.
- Fix commits are found from their messages. A team that writes "update" for every fix hides its bugs from the scan.
- `git blame` can point at the wrong origin after big moves or reformats. The AI's cited reading of the fix and
  "I disagree" soften this.
- The first history scan on a large repo may take minutes. It runs once and can resume.

## 11. Update after stage 1: the "evidence-based growth system" requirements

Stage 1 is built (PR #1). The user then gave a fuller product brief. This section maps each of its points to what is
built, and adds what is missing. Where the brief and this design disagree, **the brief wins**, and the change is
written here.

### 11.1 What already matches

| Brief | Where it is |
|---|---|
| Evidence from real work, every finding traceable | Stage 1 capture: `skill_evidence` rows with commit, file, function, ticket. `/coach why` lists them. |
| Practical drills, fixed keys, new situations | Stage 1 drills: fixed key, quote-checked scoring, key shown only after the answer. |
| AI suggests, code decides | State engine in plain code. The AI can only propose evidence (checked), rate with quotes, and word things. |
| Proven needs both work evidence and a drill | 6.6. |
| Questions at PR time, at most 3, can be postponed, nothing blocks | 6.7 and stage 1. |
| Personal plan: real spot, project stack, evidence | 6.10 and stage 1 (focus frames, plan check). |
| History of every change | `item_state_history`. |
| Local only, no expensive AI per commit | Stage 1. |
| Company ladders, more stacks | Ladder file and stack notes. |

### 11.2 What is missing, and the change

**A. Exposure, kept apart from proficiency** (brief section 4). *Missing.*
- New per-item field in the ladder: `exposure_signals`: rule ids that show the developer **had the chance** to use
  the skill, for example any call to an outside service for BE.ERR.M2, whether or not it had a time limit.
- Capture stores exposure hits like evidence, as `kind: "exposure"` (no credit, no fault).
- Code computes an exposure level per item and per area: **None, Low, Medium, High**, from distinct functions and
  tickets in the last 90 days. The thresholds go in the ladder `thresholds`.
- Exposure is shown next to proficiency everywhere: the view, `/coach why`, the dashboard.

**B. A "Not assessed" state, and Learning only for real gaps** (brief section 5). *Missing; changes 6.6.*

| State | New rule |
|---|---|
| Not seen | No evidence and no exposure. |
| **Not assessed** (new) | Some exposure or some positive evidence, but not enough to judge, and no sign of a gap. |
| Learning | A sign of a gap: an open fault, a `partial` or `not_yet` answer, a failed drill, or a regression. **Positive proofs alone no longer make an item Learning.** |
| Shown | As 6.6. |
| Proven | As 6.6. |

This reverses stage 1 ruling "any proof or answer makes an item Learning".

**C. No downgrade for lack of recent use** (brief section 4). *Conflicts with 6.6.*
- Today Shown needs proofs in the last 60 days, so a Shown item falls back when the developer works on other things.
- Change: once an item is Shown, it **stays Shown** until a regression (serious fault or `not_yet` answer). The 60-day
  window applies only to reaching Shown. Proven already never expires.
- A developer is never penalised for work that does not need a skill. Only real faults and weak answers lower a state.

**D. A drill when exposure is too low** (brief section 4). *Missing; needs the user's decision* (11.4, question 1).

**E. Automatic capture without commands** (brief section 3). *Partly missing.*
- Today capture runs only when `/coach`, `/pr-decisions` or a drill runs.
- Change: a Claude Code **SessionStart** hook and a **Stop** hook start a background catch-up. It is rules only (no AI),
  throttled to at most once every 10 minutes per repo, and never blocks or prints anything.
- The edit hook already records who wrote each line, for every session.

**F. Gentle contextual prompts** (brief sections 3 and 7). *Missing.*
- At SessionStart, if questions are waiting or a drill is ready, add one short line for Claude to mention at a
  natural pause, at most once a day. Never a block, never more than one line.

**G. "Why it matters" and exercise kinds** (brief section 6). *Missing.*
- Ladder items get `why_it_matters` (one or two plain sentences).
- Plan items get an `exercise_kind`: `implement`, `debug`, `review`, `design_tradeoff`, `architecture`, `explain`. The
  ladder lists the kinds that suit each item. The server checks the kind is one of them.
- Study topics are shown only when the item is Learning or a drill was failed, not for every item.

**H. Growth dashboard** (brief section 8). *Mostly missing.*
- New local API endpoints (read only): levels per area with exposure, item detail with evidence, state history,
  open faults, repeats, drills ready, drill results, and the latest plan.
- The Coach page of the web app shows them. Every state links to its evidence.
- The web app is the teammate's area; the API contract goes in `docs/api.md` and `@ftc/shared` first.

**I. Recurring weaknesses, PR activity, ownership** (brief sections 2, 3, 8). *Planned as stage 2.*
- Repeats, shipped bugs, the history scan, owned AI faults and the PR-time fault review are already designed (6.4.1,
  6.5) and not built yet.

### 11.3 Conflicts with current behaviour

1. **Learning meaning** changes (11.2 B). Existing items with only positive proofs become "Not assessed". Old rows
   are kept; only the computed state changes.
2. **The 60-day window** no longer lowers a Shown item (11.2 C). The docs and tests that expect the decay change.
3. **Background hooks** add two more hook runs per session (11.2 E). Each must stay quiet and fast.
4. **The dashboard** is in the teammate's web app (11.2 H). The API comes first, so the backend never waits for the UI.

### 11.4 Decisions (answered by the user on 18 Nov)

- **Drill-only path: (a).** With exposure None or Low, 2 passed drills on different prompts plus 1 clear answer make the item **Shown (by drill)**, marked as such. Proven still needs work evidence.
- **Dashboard: built here**, the API and the web app's Coach page.

The questions as asked:


1. **Drill-only path (11.2 D).** When exposure is None or Low, may a passed drill move the item?
   - (a) *Recommended:* 2 passed drills on different prompts, plus 1 clear answer, make it **Shown (by drill)**, marked
     as such. Proven still needs work evidence.
   - (b) A drill result is only recorded and shown. The state stays Not assessed until work evidence comes.
2. **Dashboard owner (11.2 H).** Build the Coach page here too, or only the API and leave the page to the teammate?

## 12. Roadmap after stage 1

Each stage gets its own plan file (writing-plans) and the same build loop: tests first, full check, real run, review.

| Stage | Contents | Depends on |
|---|---|---|
| **1.5 Assessment model** | Exposure (11.2 A), Not assessed and the new Learning rule (B), no decay (C), drill when exposure is low (D, after the decision), why it matters and exercise kinds (G) | Stage 1 |
| **2 Ownership and history** | 6.2 decision origin, 6.3 ownership, 6.4.1 history scan, shipped bugs, repeats, 6.5 PR-time fault review | 1.5 (exposure counts past commits too) |
| **2.5 Automatic and gentle** | Background catch-up hooks (E), contextual prompt (F) | 2 (the history scan runs in the background) |
| **3 Dashboard** | API endpoints, `@ftc/shared` schemas, `docs/api.md`, Coach page (H) | 1.5 and 2 (it shows exposure and repeats) |
| **4 Ticket check** | 6.8 | 2 |

The stage 1 deferred minors are fixed inside the stage that touches the same code.
