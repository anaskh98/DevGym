# How Coach decides your level

Coach is a private study guide. It shows where you stand on a ladder for each area of your work, using evidence
from **your own** code and answers, and what to do next to move up. Everything stays on your machine.
Nothing here goes into a pull request.

Design: [docs/superpowers/specs/2026-11-18-developer-growth-design.md](superpowers/specs/2026-11-18-developer-growth-design.md).
This page covers stage 1 (the levels core).

## The ladder

- Two tracks: **backend** and **frontend**. You pick one or both the first time you run `/fork-trail-coach:coach`.
- Each track has areas (errors, data, API design, security, ...) and four levels: junior, mid, senior, staff.
- Each level is split into small items you can check, for example **BE.ERR.M2: Handles the failure of an outside
  call on purpose**. Each item has: what good looks like, code signals, "why" angles, 2 or 3 interview drills with
  a fixed answer key, study topics, and best-practice notes for common stacks.
- Stage 1 writes one area fully per track: **Errors and failure** (backend) and **Data fetching and errors**
  (frontend). The other areas are named and still empty.
- A company can replace the built-in ladder with its own file: `<repo>/.fork-trail-coach/ladder.json`, else
  `~/.fork-trail-coach/ladder.json`. A broken file is ignored, and Coach says why.

## Who wrote the line

When Claude edits a file, a hook saves a short hash of each line it wrote (never the line). When Coach reads a
commit, a line whose hash matches is **AI-written**; any other line is **yours**. The hash ignores spaces, quote
style and a trailing comma or semicolon, so a formatter does not turn Claude's lines into yours.

**AI-written code never counts for you.** Faults count whoever wrote them: you shipped them.

Coach reads your commits (by your `git config user.email`) quietly each time it runs, starting from Claude's first
edit in the repo. No git hook is installed. Lockfiles, build output and generated files are skipped.

## Proficiency and exposure

Coach keeps two things apart for every item:

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

At pull request time (`/fork-trail-coach:pr-decisions`) and in `/fork-trail-coach:coach`, Coach offers at most 3
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

`/fork-trail-coach:coach drill <item-id>`, once an item is Shown.

- The prompt comes from the ladder's fixed list, never the same one twice until all were used.
- The AI lists which key points and red flags your answer shows, quoting your words. The server keeps only real
  quotes. You pass with enough key points (two thirds, by default) and no red flag.
- You see every key point as hit or missed, and what to study for the missed ones.
- After a failed drill, try again after one new code proof or 3 days.

## You can lower, never raise

`/fork-trail-coach:coach why <item-id>` lists every piece of evidence, answer and drill, each with an id.
You can disagree with a code proof (it stops counting, your reason is kept) or a drill score (it becomes void and
you can try another prompt). You can also disagree with a fault: your reason is kept and shown, but **the fault still
counts** until the code is fixed, because removing a fault would raise a state. Disagreeing never raises a state.
Answers cannot be disagreed away; ask for a new question.

## The plan

`/fork-trail-coach:coach` picks up to 3 focus items by code: open faults first, then Shown items (a drill away),
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
3. `/coach` showed **BE.ERR.M2 LEARNING, 3 of 3 code proofs**, stack `express`. Claude's own time limit was stored
   as **AI-written and did not count**. The plan was saved with an exercise naming `src/pay.ts`.
4. Two why-questions, one per ticket. The prompt hook saved both answers **word for word**. Both were rated clear,
   and the trade-off quote was checked. M2 became **SHOWN**.
5. Drill, weak answer: **failed**, with every missed key point shown. Retrying at once was **refused** (no new proof).
6. After a new commit with a time limit (PAY-3), the drill opened with a **new prompt** (d2). Strong answer:
   **passed**, 3 of 3 key points with real quotes. M2 became **PROVEN**.
7. Committing an empty catch in `charge` (PAY-4) dropped M2 back to **LEARNING**, with 0 of 3 proofs counted.

The history table recorded each change: not seen → learning → shown → proven → learning.

**What the real run found and fixed** (each with a test that failed first):

- `/coach drill` did not read new commits, so a fresh proof never unlocked a failed drill.
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
- A commit's ticket came from the branch checked out at the time Coach ran, and `UTF-8` looked like a ticket key.
- Disagreeing with a fault could raise a state. Now a fault keeps counting.
- The same function proposed by the AI three times counted as three proofs.
- An answer refused by the privacy check still counted as an answer.
- A captured message that was not an answer could not be put back.
