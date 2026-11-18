# Project brief: "DevGym", a Claude Code plugin

This brief is written to be pasted into another AI assistant to think the idea through. It is self-contained.

## 1. The idea in one paragraph

AI now writes much of the code. The risk is that developers ship code they did not choose, do not understand, and
do not learn from. This plugin sits inside Claude Code and does three things: **Clarify** asks the right questions
about a ticket before coding, **Track** records every real choice made while coding (and who made it: the
developer or the AI), and **Grow** turns that record into a private growth plan for the developer. **The main
purpose is the developer's improvement.** The pull request "Decisions" section for reviewers is a side benefit.
All profile data stays on the developer's machine.

## 2. What the plugin does today (built and on `main`)

| Part | What it does |
|---|---|
| **Clarify** (`/clarify <ticket>`) | Reads a ticket (from local Markdown tickets, or from Jira through the Atlassian connector), finds the places where it can be read in more than one way that would change the code, asks only those questions, and saves the answers as an assumption list. |
| **Track** (`/track <ticket>`) | Tracks a coding session. A hook records which files Claude edits (paths only). Each real choice is logged as a decision: summary, alternatives, origin (`ai`, `dev`, `dev_changed_ai`), and a pointer to the code (file, function, commit). Never the code itself. |
| **Pointers** (`/pointers`) | Checks each decision's pointer still finds its code, and moves pointers to the merge commit after a PR merges. Uses tree-sitter for function names. |
| **PR Decisions** (`/pr-decisions`) | Writes a "Decisions" section into the pull request: assumptions, decisions, who chose, where. No profile data. |
| **Explain** (`/explain`) | After coding, asks the developer "why" about 2 or 3 decisions and rates the answer `clear`, `partial` or `not_yet`. |
| **Grow** (`/grow`) | Today: writes 1 to 3 focus areas from saved observations, each citing evidence, with one exercise. `/grow open` shows a local web report. |

**Tech:** TypeScript, Node 22 (built-in `node:sqlite`), an MCP server over stdio, Claude Code hooks (PostToolUse
for edits), zod, an esbuild bundle committed inside the plugin, a small local web app for the report. Profiles live
in `~/.devgym/profile.sqlite`. A privacy guard rejects code, secrets and client names in anything saved.
About 300 automated tests.

## 3. What we did so far

1. **Built the whole backend** (13 tasks: data model, MCP tools, hooks, pointers, PR section, grow report, privacy
   guard, eval harness) and replaced a teammate's earlier backend on `main` with a normal commit (no force push).
   The teammate has since added Jira ticket import on `main`.
2. **Explored 3 alternative directions** on separate local branches, to answer the hardest objection a judge might
   raise: *"A developer doesn't need to understand every line, so why does this matter?"*
   - **`path/evidence`** (built, not pushed): an auditor agent runs a locked 3-step audit (begin, submit findings,
     finish) and checks, from the session transcript, who really made each choice.
   - **`path/quality`** (built, not pushed): a **risk gate**. Pitch: *"The AI made a risky choice and no human
     checked it. We catch that before merge."* Fixed regex rules over the git diff find risky spots in four areas
     (money, security, privacy, data loss). The AI can add a spot, never remove one. Only the developer can clear a
     spot, by typing `/risk keep|waive R1: <reason>`; a prompt hook records it and the AI never sees it, so the AI
     cannot approve for the developer. The PR shows "Risk check: PASS / FAIL / INCOMPLETE".
     Measured with real headless runs: 0 false spots on a safe ticket; 11 spots on 3 risky tickets; the AI refused
     to approve for the developer in 3 of 3 runs; a shell workaround was blocked by a guard hook.
   - **`path/productivity`**: not built.
3. **Decided to make developer growth the core**, and designed it (next section). New work goes on a `dev` branch
   from `main`; it does not depend on the path branches.

## 4. The new design: Grow that knows your level

**Problem with today's Grow:** observations are written by the AI with free-text tags, and nothing says what
"good" looks like at a given level. So the plan drifts into general advice ("study error handling"), and nobody can
tell when a weakness is really fixed.

**The goal the developer should feel:** "I failed this kind of interview question before. The plugin showed me the
gap, I practised it in my real work, I passed the drill, and now I can pass the interview."

### Key decisions

- **For the developer only, locally.** A career study guide, not a manager tool.
- **A ladder** for backend and frontend (this phase only): junior, mid, senior, staff. Each area (errors, data,
  API design, security, performance, testing, structure, requirements and scope) is split into small checkable
  items, for example *"BE.ERR.M2: handles the failure of an outside call on purpose: time limit, retry only when
  safe, a clear error to the caller."* Each item has code signals, "why" angles, 2 or 3 interview drills with a fixed
  answer key, study topics, and best-practice notes per stack. A company can replace the built-in ladder with its own
  file.
- **Evidence from the developer's own work.** Two separate facts are tracked:
  - **Who wrote the line:** the edit hook saves a hash of every line Claude writes, so commit lines split into
    AI-written and developer-written.
  - **Who made the decision:** if the developer told Claude "use a queue instead", Claude wrote the code but the
    decision is the developer's. The AI must quote the developer's words; the server checks the quote is in a real
    message the developer sent.
- **Credit and ownership rule:** *you earn credit for what you wrote or decided; you own the faults in everything
  you ship.* AI code can never raise a level, but an AI bug the developer let through counts against them. Catching
  an AI fault before committing counts for them (a "reviewing AI code" skill).
- **Timing:** silent capture per commit (by reading git history, no git hook installed); questions only at pull
  request time, at most 3, and the developer can say "later". Nothing blocks a commit or a PR.
- **All past commits are read once** per repo, to find **repeated bugs** and **bugs that reached main** (fix commits
  traced back with `git blame` to the commit that introduced the bug).
- **Judging:** fixed rules find signals; an AI judge may add findings only with citations the server checks; **plain
  code decides every state and level.** Answers are captured word for word by a prompt hook, so the AI cannot
  rewrite them. Scores need quotes from the real answer.
- **A ticket check** after coding: compares the change with the ticket and the Clarify assumptions and shows
  **missing**, **extra** (works but nobody asked for it) and **different** code. Shown to the developer only; the
  developer fixes it or keeps it with a reason.
- **The stack is the project's own stack**, found from the repo (Express, NestJS, Spring, React, Next.js, Angular,
  and so on). Notes for uncommon stacks are written once by the AI and saved.
- **Efficient = a really good, personal plan**, plus low token use: code does the counting and picking; the AI runs
  once per PR plus short wording steps, never per commit.

### Definition of done for one skill item

| State | Rule |
|---|---|
| **Not seen** | No evidence. |
| **Learning** | Any proof, any weak answer, any fault. |
| **Shown** | **Both:** 3 proofs in the developer's own lines or decisions across 2+ tickets in the last 60 days, with no open fault; **and** 2 "clear" explanation answers on different tickets, at least one naming the trade-off. |
| **Proven** | Shown, **plus a passed interview drill** on a new situation, scored against the fixed answer key. Required. |

A fault on a serious signal, or a "not yet" answer, drops the item back to Learning, and only newer evidence counts
after that. A level in an area is reached when every item at that level is Proven. Levels are per area, never one
number. The developer can say "I disagree" to remove evidence or void a drill score, but that can only lower a
level, never raise it.

### What the developer sees

```
Backend · Errors and failure        Level: Mid  ·  working toward Senior
  BE.ERR.M1 Validate input at the edge     PROVEN    drill passed 12 Nov
  BE.ERR.M2 Handle outside-call failure    SHOWN     ready for a drill → /grow drill BE.ERR.M2
  BE.ERR.M3 Errors carry useful context    LEARNING  1 of 3 proofs · 1 owned fault · last answer: partial
  Next for Senior: BE.ERR.S1 Design for partial failure    NOT SEEN

Repeats (whole history)
  BE.ERR.M2 Outside call with no time limit   7 times · 5 tickets · 2 reached main as bugs

Your stack: Node + Express
Study next: AbortController time limits · retry with backoff and jitter · idempotency keys
```

Each plan item names the skill item, what is missing for the next state, the best practice for the stack, study
topics, and **an exercise on a real spot in the developer's own code**. The server rejects a plan item with no
skill item, no evidence, or no real spot.

### Build plan

Three stages, each usable alone:

1. **Levels core** (planned in detail, 15 tasks, about to start): ladder and loader, one area per track fully
   written, line hashes, commit capture, signal rules, the state engine, questions captured by a hook, drills, the
   new plan.
2. **Ownership and history:** quote-checked decision origin, the PR-time AI fault review, the full history scan,
   shipped bugs, repeats.
3. **Ticket check.**

## 5. Honest limits we know about

- The thresholds (3 proofs, 2 tickets, 60 days) are a first guess.
- Signals are regex rules: they miss things and sometimes hit wrongly.
- AI judging (fault review, ticket check, drill scoring) is made repeatable with citations and quote checks, not
  perfect.
- Code from other AI tools (for example Copilot), or written by Claude through the shell, looks developer-written.
- Fix commits are found from their messages; a team that writes "update" for every fix hides its bugs.
- A developer could look up a drill answer; it is their own study tool.
- Everything so far was tested headless; the interactive app has not been tested by hand.

## 6. Questions to think about with another AI

1. Will judges accept "developer growth" as the main value, or will they still ask "why must a developer understand
   AI code at all"? What is the strongest answer?
2. Is the definition of done (code proof + explanation + drill) convincing as proof that someone improved?
3. Is "you own the faults of everything you ship, but get credit only for what you wrote or decided" fair, or will
   developers find it harsh?
4. What would make this clearly better than code review bots and AI tutors already on the market?
5. Which signals or ladder items would show the most value in a short demo?
6. What could go wrong in real use: privacy worries, gaming the system, too many questions, wrong attribution?
7. How should success be measured: items moved up per month, drill pass rate, fewer repeated bugs?
