# How Grow decides your level

Grow is a private study guide. It shows where you stand on a ladder for each area of your work, using evidence
from **your own** code and answers, and what to do next to move up. Everything stays on your machine.
Nothing here goes into a pull request.

Design: [docs/superpowers/specs/2026-11-18-developer-growth-design.md](superpowers/specs/2026-11-18-developer-growth-design.md).
This page covers stage 1 (the levels core).

## The ladder

- Two tracks: **backend** and **frontend**. You pick one or both the first time you run `/devgym:grow`.
- Each track has areas (errors, data, API design, security, ...) and four levels: junior, mid, senior, staff.
- Each level is split into small items you can check, for example **BE.ERR.M2: Handles the failure of an outside
  call on purpose**. Each item has: what good looks like, code signals, "why" angles, 2 or 3 interview drills with
  a fixed answer key, study topics, and best-practice notes for common stacks.
- Stage 1 writes one area fully per track: **Errors and failure** (backend) and **Data fetching and errors**
  (frontend). The other areas are named and still empty.
- A company can replace the built-in ladder with its own file: `<repo>/.devgym/ladder.json`, else
  `~/.devgym/ladder.json`. A broken file is ignored, and Grow says why.

## Who wrote the line

When Claude edits a file, a hook saves a short hash of each line it wrote (never the line). When Grow reads a
commit, a line whose hash matches is **AI-written**; any other line is **yours**. The hash ignores spaces, quote
style and a trailing comma or semicolon, so a formatter does not turn Claude's lines into yours.

**AI-written code never counts for you.** Faults count whoever wrote them: you shipped them.

Grow reads your commits (by your `git config user.email`) quietly each time it runs, starting from Claude's first
edit in the repo. No git hook is installed. Lockfiles, build output and generated files are skipped.

## Proficiency and exposure

Grow keeps two things apart for every item:

- **Proficiency**: the item's state (below). What your work and answers have shown you can do.
- **Exposure**: none, low, medium or high. How much your work gave you a chance to use the skill, used well or not.
  For example, any call to an outside service is a chance to handle its failure. Counted as distinct functions in the
  last 90 days (low from 1, medium from 3, high from 6).

Low exposure is never read as low skill. You are never pulled back for working on things that do not need a skill.

## The five states of an item

| State | What it takes |
|---|---|
| **Not seen** | Nothing yet: no evidence and no exposure. |
| **Not assessed** | Some evidence or exposure, but not enough to judge, and no sign of a gap. |
| **Learning** | A sign of a real gap: an open fault, a weak latest answer, a failed latest drill, or a drop back. |
| **Shown** | **Both:** 3 code proofs in your own lines, across 2 or more tickets, in the last 60 days, with no open fault on the item; **and** 2 answers rated "clear" on different tickets, at least one naming the trade-off. |
| **Proven** | Shown in your work, **plus a passed drill**. A drill is an interview question about a new situation. |

**Once Shown, an item stays Shown** until a serious fault or a "not yet" answer. Not using a skill for a while never
lowers it.

**When your work gives little chance** (exposure none or low), you can take drills instead: 2 passed drills on
different prompts plus 1 clear answer make the item **Shown (by drill)**. It becomes Proven only once the skill also
shows in your work.

Details, all decided by plain code:

- One proof is one signal in one function. Ten hits in the same function count once.
- A fault you fix in the same ticket, before it ships, does not count.
- A serious fault, or a "not yet" answer, drops the item back to **Learning**. After that, only newer proofs and
  answers count, and you need a new drill.
- **Proven does not expire.**
- Your level in an area is the highest level where every item, and every item below it, is Proven. There is never
  one overall number.

## Questions and answers

At pull request time (`/devgym:pr-decisions`) and in `/devgym:grow`, Grow offers at most 3
short questions about your own work. You can say "later".

- Questions come one at a time. Your next message is saved **exactly as you typed it** by a hook. The AI never
  writes or improves your answer.
- A message that ends with "?" and is short is treated as you asking back, not as an answer. A slash command is
  never an answer.
- The AI rates the answer (clear, partial, not yet). To say it names the trade-off, it must copy your exact words;
  the server checks they are really in your answer. An answer is rated once.
- If your answer contains code, a secret or a client name, it is not saved and the question stays open; answer in
  plain words.
- If a message you sent was saved but was not an answer (you changed the subject), the AI puts it back with
  `release_answer` before rating it.

## Drills

`/devgym:grow drill <item-id>`, once an item is Shown.

- The prompt comes from the ladder's fixed list, never the same one twice until all were used.
- The AI lists which key points and red flags your answer shows, quoting your words. The server keeps only real
  quotes. You pass with enough key points (two thirds, by default) and no red flag.
- You see every key point as hit or missed, and what to study for the missed ones.
- After a failed drill, try again after one new code proof or 3 days.

## You can lower, never raise

`/devgym:grow why <item-id>` lists every piece of evidence, answer and drill, each with an id.
You can disagree with a code proof (it stops counting, your reason is kept) or a drill score (it becomes void and
you can try another prompt). You can also disagree with a fault: your reason is kept and shown, but **the fault still
counts** until the code is fixed, because removing a fault would raise a state. Disagreeing never raises a state.
Answers cannot be disagreed away; ask for a new question.

## The plan

`/devgym:grow` picks up to 3 focus items by code: open faults first, then Shown items (a drill away),
then Learning items with the most proofs, at the level you are working on or the next one, in areas you work in.

Each plan item gives what is still missing, the best practice for **your project's stack** (found from the repo,
for example Express or Next.js), study topics, and one exercise on **a real spot in your code** or your next
ticket. The server refuses a plan item that has no evidence of its own item, or an exercise that names no real
spot. For a stack the ladder does not cover, the AI writes the note once and it is saved and reused.

## Honest limits

- The thresholds (3 proofs, 2 tickets, 60 days, 2 clear answers) are a first guess. Real use should tune them.
- Signals are regex rules: they miss things and sometimes hit wrongly. "I disagree" and AI-proposed evidence (which
  must cite lines the server checks) soften this.
- Answer ratings and drill scores come from the AI. The fixed key, the quote checks and seeing every point make
  them open and repeatable, not perfect.
- Code from other AI tools (for example Copilot), or written by Claude through the shell, looks like yours.
- A formatter that wraps one line into several breaks the match.
- A commit's ticket comes from a key in its message, else the current branch, else its calendar week.
- Commits from before Claude's first edit in a repo are not read yet (the history scan is stage 2).
- You could look up a drill answer. It is your own study tool, so that only fools yourself.

## Measured results (stage 1)

**Automated tests:** the full check passes (typecheck, build, server, eval and web tests).

**One real run**, headless (`claude -p --plugin-dir`, Sonnet), in a scratch repo with an Express `package.json`.
Each step was checked in the database as well as in Claude's reply.

1. Claude wrote `src/client.ts` with a 5-second time limit. The edit hook saved 5 line hashes.
2. As the developer, I committed time limits in `charge` and `refund` (ticket PAY-1) and a retry with backoff (PAY-2).
3. `/grow` showed **BE.ERR.M2 LEARNING, 3 of 3 code proofs**, stack `express`. Claude's own time limit was stored
   as **AI-written and did not count**. The plan was saved with an exercise naming `src/pay.ts`.
4. Two why-questions, one per ticket. The prompt hook saved both answers **word for word**. Both were rated clear,
   and the trade-off quote was checked. M2 became **SHOWN**.
5. Drill, weak answer: **failed**, with every missed key point shown. Retrying at once was **refused** (no new proof).
6. After a new commit with a time limit (PAY-3), the drill opened with a **new prompt** (d2). Strong answer:
   **passed**, 3 of 3 key points with real quotes. M2 became **PROVEN**.
7. Committing an empty catch in `charge` (PAY-4) dropped M2 back to **LEARNING**, with 0 of 3 proofs counted.

The history table recorded each change: not seen → learning → shown → proven → learning.

**What the real run found and fixed** (each with a test that failed first):

- `/grow drill` did not read new commits, so a fresh proof never unlocked a failed drill.
- Claude was never given the drill's key point ids, so it could not score the second drill. Now `drill_key` gives the
  key, but only after the answer is saved.
- After one why-question on an item, no second one was asked, so an item could never reach two clear answers.
- If every saved hash was older than 120 days, capture would stop. The start point is now saved per repo.
- A Proven item above the level being worked on was hidden from the view.

**Not covered by the run:**

- The interactive app: every step ran headless.
- The frontend track.
- A company ladder file.
- Large real repos.

**Hook time** on this machine, 10 runs each, while it was busy:

| Process | Median time |
|---|---|
| Empty Node process | about 141 ms |
| Edit hook (one `git` call plus the database) | about 240 ms |
| Prompt hook (runs on every message once the database exists) | about 220 ms |

So each hook adds roughly 80 to 100 ms of its own work.

**Wording:** in one plan, Claude wrote that `charge` "retries" when it does not; the retry is in `withRetry`. The
server checks that an exercise names a real file, but it cannot check every sentence.

**What the whole-branch review found and fixed** (each with a test that failed first):

- One huge commit (for example a big binary file) could break capture for good. Binary files are no longer printed,
  generated paths are left out by git, and a commit git cannot read is marked read and skipped.
- No area level could ever rise, because junior items with only "against" signals could never be Shown.
- AI lines counted as yours when Claude ran in a parent folder or a worktree. Lines are now matched by the repo's
  identity (its shared `.git` folder), the same in every worktree.
- A company ladder got two different ids depending on how the folder path was written.
- A commit's ticket came from the branch checked out at the time Grow ran, and `UTF-8` looked like a ticket key.
- Disagreeing with a fault could raise a state. Now a fault keeps counting.
- The same function proposed by the AI three times counted as three proofs.
- An answer refused by the privacy check still counted as an answer.
- A captured message that was not an answer could not be put back.

## Measured results (stage 1.5)

**Automated tests:** the full check passes. Server tests: 423.

**One real headless run** (Sonnet), in a fresh scratch repo with an Express `package.json`:

1. One developer commit added a call with a time limit. `/grow` showed **BE.ERR.M2 NOT ASSESSED**, exposure low,
   "drill available", and not Learning. J2 and S1 were Not assessed from the exposure of the same call.
2. The first drill passed. Claude then said a drill alone could not move the item, which was wrong. The cause: the
   server's "needs" list did not spell out the drill path. Fixed with a test, so `needs` now says how many drills and
   answers are left.
3. The second drill (new prompt) passed. Claude asked one follow-up question, and the answer was rated clear with the
   trade-off checked. M2 became **SHOWN (by drill)** and stayed short of Proven, with "show it in your work, then pass
   a drill".
4. The history recorded not seen → not assessed → shown, with the reason "passed 2 drills and gave a clear answer,
   with little chance in the work".

## Stage 2 to 4: ownership, history, automatic capture, dashboard and ticket check

**Who decided is checked, not claimed.** The prompt hook saves what you type (locally, deleted after 120 days; slash
commands are never saved). When the AI logs a decision as yours (`dev` or `dev_changed_ai`) it must quote your own
words, and the server checks the quote is in a message you sent in that session. Otherwise it is stored as an AI
choice. A decision on a ladder item becomes evidence that counts for you only if you decided it, and it shares the cap
on AI-assisted proof (at most 1 of the 3 proofs).

**You own what you ship.** A fault in code the AI wrote counts against you too: you shipped it. At pull request time
the AI reviews the final change and may name a fault (`propose_fault`), but only with lines the server finds added in
that change. A later commit that changes the same function clears it.

**History.** Grow also reads your older commits, one batch of 200 per run, so it can see mistakes that keep coming
back. Faults from old commits count fully; their credit is capped at 1 proof (it cannot tell who typed old lines).
Fix commits (messages with fix, bug, hotfix or revert) are traced with `git blame` to the commit that brought the bug
in; if that commit is yours, it is a **bug you shipped**. A **repeat** is the same mistake on 3 or more tickets. A
repeat with nothing new in 60 days shows as a possible fixed habit.

**Automatic.** A SessionStart and a Stop hook start a throttled (every 10 minutes) background worker that reads new
commits, so nobody has to remember to run a command. It prints nothing and never blocks. At the start of a session, if
questions are waiting, Claude gets one short line, at most once a day. Set `DEVGYM_NO_BACKGROUND=1` to turn the worker off.

**Dashboard.** `/grow open` shows your levels per area, exposure apart from proficiency, the evidence behind every
state, repeats, open faults, drills ready and done, recent improvements and regressions, and what to do next
(`GET /api/grow`, documented in `docs/api.md`).

**Ticket check.** `/devgym:check <ticket>` looks for code that is missing, extra or different from
the ticket. The AI must quote the ticket's own words and point at lines the server finds in the change. You decide
what to do about each finding, in your own words (the server checks them against what you typed). A finding you decide
on before the pull request is not counted. Nothing from the ticket check reaches the pull request or reviewers.
It feeds a new area, **Requirements and scope**: "builds what the ticket asks, and nothing extra" (also credited by a
clean check on a ticket with 3 or more needs) and "spots unclear needs before coding" (credited when Clarify asks the
product owner).

**Honest limits (stage 2 to 4).** Fix commits are found by their message. `git blame` can point at the wrong commit
after large moves. Old commits give no line hashes, so their credit is capped. The history scan does not check for an
AI trailer in old commit messages. The ticket check relies on the AI to find findings; the quote and line checks make
them traceable, not complete.

## Measured results (stages 2 to 4)

**Automated tests:** the full check passes (server 468, eval 5, web 28), and the plugin validates.

**Real headless runs** (Sonnet, scratch repos):

- **Dashboard API** on real data from an earlier run: `GET /api/grow` returned BE.ERR.M2 as Shown by drills with
  exposure low, two items Not assessed with a drill available, and the history of state changes. The built page was
  served. The page itself was **not** looked at in a browser: it is covered by type checks and helper tests only.
- **Ticket check**, on a ticket with 4 needs and a branch where Claude wrote two stub functions: 5 findings (3
  missing, 1 different, 1 extra), each with a ticket quote the server found in the ticket and, for code, lines the
  server found in the change. The Claude-written code was marked **owned**. When I said, in my own words, to keep
  the extra function, the server found my words in the saved message and recorded only that decision; the other 4
  stayed open. My setup first put the ticket in the wrong folder (tickets must be in `tickets/`).

**Covered by automated tests only (not in a real run):** the background worker and the daily nudge (tests run the built
hook and worker), the history scan, shipped bugs and repeats, `propose_fault`, quote-checked decision origins.

## What the review of stages 2 to 4 found and fixed

Each fix has a test that failed first.

- The AI could pass an old commit as the pull request's base, so any line (even years old, or a teammate's) looked
  "added in this change". The server now finds the base itself, and accepts a given one only if it lies on the branch.
- Two catch-ups running at once (the background worker and `/grow`) could read the same commit twice and double its
  evidence. A commit is now claimed first, inside the same transaction.
- A company ladder without the new Requirements and scope items broke saving Clarify's assumptions. The ticket check now
  skips the skill quietly when the ladder lacks it.
- An older message ("please check the ticket") could be reused to decide a finding. Only words sent after the finding
  was raised count.
- Review faults compared times as text (UTC against a local offset), so a commit could close a fault it came before.
- The dashboard listed old faults the state engine ignores. It now uses the same rule (inside the window, not fixed).
- Developer messages were saved for everyone, and "delete everything" left all Grow data (including stage 1 tables).
  Messages are saved only once you choose tracks, and delete-all now removes every Grow table.

**Rulings and deferred, not fixed:**

- **A kept finding counts as a decision, not a fault**, once you give a reason in your own words. The spec said a kept
  finding "with no good reason" is negative, but there is no rating of reasons yet. Cost if wrong: a poor reason clears
  a finding. Needs your call.
- A bug added and fixed inside the same branch can count as "reached main" in merge-commit workflows.
- Faults in a shared pull-request branch are blamed on the developer even for a teammate's lines.
- History credit does not check old commit messages for an AI trailer.
- Ticket credit (`needs`, `answered_by_po`) rests on the AI's word, with no cap for items without rule signals.
- A fault is closed by any later change to the same function, which is loose.
- The "Export my data" page still does not include the Grow tables; delete-all does remove them.
- The nudge ignores "a drill is ready", and the background throttle is per folder, not per repo.
