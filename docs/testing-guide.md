# How to try the plugin (testing guide)

Short and simple. Needs **Node 22.13 or newer** on your PATH and Claude Code.

## 1. Install it

**Option A: install from GitHub (the normal way).** In any terminal:

```bash
claude plugin marketplace add anaskh98/ftc
claude plugin install devgym@md-labs
```

Restart Claude Code. (Not tested by me: I tested option B.)

**Option B: load it from a local copy (best for testing a change).**

```bash
git clone https://github.com/anaskh98/ftc.git
cd ftc            # the branch is main
claude --plugin-dir /path/to/ftc/packages/plugin
```

Start Claude Code **inside your own project** (a git repo, ideally with some commits of yours).
Check it works: `/devgym:status`. It should list the commands and say the local service is running.

## 2. First run: pick your track

```
/devgym:grow
```

- It asks: backend, frontend, or both. Answer once.
- It then reads your commits (this repo only) and shows your levels and a first plan.
- Your older commits are read in batches over the next runs ("reading older commits").

Everything is saved in `~/.devgym/profile.sqlite` on your machine only.

## 3. Work normally

Nothing else to do. While you code with Claude:

- The edit hook remembers which lines Claude wrote (a hash only, never the line).
- At session start/end a background worker reads your new commits (set `DEVGYM_NO_BACKGROUND=1` to turn this off).
- If questions are waiting, Claude may mention them **once a day**.

## 4. The commands

| Command | What it does |
|---|---|
| `/devgym:grow` | Your level per area, exposure, repeats, and a personal plan |
| `/devgym:grow drill BE.ERR.M2` | An interview-style drill for one skill |
| `/devgym:grow why BE.ERR.M2` | Every piece of evidence behind a skill. You can disagree with it |
| `/devgym:grow history` | How your skills moved over time |
| `/devgym:grow open` | The dashboard in your browser (levels, evidence, faults, drills) |
| `/devgym:clarify PROJ-1` | Questions about a ticket before coding (plugin tickets in `tickets/`, or Jira) |
| `/devgym:track PROJ-1` | Log the real choices while coding |
| `/devgym:check PROJ-1` | After coding: code that is missing, extra or different from the ticket (private) |
| `/devgym:pr-decisions PROJ-1` | Before the PR: decisions section, fault review, up to 3 questions |

## 5. The flow from A to Z (about 20 minutes)

Use a scratch git repo with a `tickets/` folder (a ticket is a Markdown file such as `tickets/PAY-1.md` with `id` and `title` at the top), or Jira.

1. **Setup:** `/devgym:grow`, choose a track.
2. **Before coding:** `/devgym:clarify PAY-1`. Answer the questions about unclear needs. (This earns credit for spotting unclear needs.)
3. **Code with Claude:** `/devgym:track PAY-1`, then ask Claude to build it. Say it your way once (for example: "No, use a queue for the retries"). Claude logs that decision as yours, quoting your words. Commit as you go (put `PAY-1` in the message).
4. **After coding:** `/devgym:check PAY-1`. See what is missing, extra or different. Decide about each in your own words.
5. **Before the PR:** `/devgym:pr-decisions PAY-1`. It adds the Decisions section (review it before it is posted), reviews the final change for faults, and asks up to 3 short questions. Say `later` to skip any.
6. **Your picture:** `/devgym:grow`. Look for the state (Not assessed, Learning, Shown, Proven) and exposure, shown separately.
7. **Why:** `/devgym:grow why BE.ERR.M2` lists the evidence. Try disagreeing with a proof.
8. **Drill:** `/devgym:grow drill BE.ERR.M2`. Give a weak answer, then a strong one.
9. **Dashboard:** `/devgym:grow open`. Check the Growth section and the My data page.
10. **Delete test:** on the My data page, delete everything; the levels should come back empty.

## 5b. A quick first test (10 minutes)

1. `/devgym:grow` and choose a track.
2. Make 2 or 3 commits in your repo that handle an outside call or errors.
3. Run `/devgym:grow` again. Look at: **state** (Not assessed, Learning, Shown, Proven) and **exposure** (kept apart).
4. Answer one question. Then run `/devgym:grow why <item>` and see your own words saved.
5. Try `/devgym:grow drill <item>` on a skill marked "drill available".
6. Run `/devgym:grow open` and look at the dashboard.

## 6. What to know

- **Not assessed is not a weakness.** It means your work gave too little chance to show the skill.
- **Once Shown, a skill stays Shown** until a serious fault or a "not yet" answer.
- **Proven needs both** real work evidence and a passed drill.
- **You own what you ship.** A fault in AI-written code you committed counts for you too.
- **Who decided is checked.** The AI must quote your own words to claim a decision is yours.
- Private by design: nothing here goes into the pull request except the "Decisions" section.

## 7. Known limits (be honest when testing)

- Everything was tested headless (`claude -p`). The interactive app has not been tested by hand.
- Only the **Errors and failure** (backend) and **Data fetching and errors** (frontend) areas, plus **Requirements and scope**, are fully written. The other areas are named but empty.
- Signals are regex rules: they miss things and sometimes hit wrongly. Use `why` and "I disagree".
- Old commits give no "who wrote this line" data, so their credit is capped.
- The ticket check and fault review rely on the AI to find things; quote and line checks make them traceable, not complete.
- The stack-note doc links were written from memory and not all opened.
