# How to try the plugin (testing guide)

Short and simple. Needs **Node 22.13 or newer** on your PATH and Claude Code.

## 1. Install it from this branch

```bash
git clone https://github.com/anaskh98/ftc.git
cd ftc
git checkout dev
```

Start Claude Code **inside your own project** (any git repo, ideally one with some commits of yours), and load the plugin:

```bash
claude --plugin-dir /path/to/ftc/packages/plugin
```

Check it works: `/fork-trail-coach:status`

## 2. First run: pick your track

```
/fork-trail-coach:coach
```

- It asks: backend, frontend, or both. Answer once.
- It then reads your commits (this repo only) and shows your levels and a first plan.
- Your older commits are read in batches over the next runs ("reading older commits").

Everything is saved in `~/.fork-trail-coach/profile.sqlite` on your machine only.

## 3. Work normally

Nothing else to do. While you code with Claude:

- The edit hook remembers which lines Claude wrote (a hash only, never the line).
- At session start/end a background worker reads your new commits (set `FTC_NO_BACKGROUND=1` to turn this off).
- If questions are waiting, Claude may mention them **once a day**.

## 4. The commands

| Command | What it does |
|---|---|
| `/fork-trail-coach:coach` | Your level per area, exposure, repeats, and a personal plan |
| `/fork-trail-coach:coach drill BE.ERR.M2` | An interview-style drill for one skill |
| `/fork-trail-coach:coach why BE.ERR.M2` | Every piece of evidence behind a skill. You can disagree with it |
| `/fork-trail-coach:coach history` | How your skills moved over time |
| `/fork-trail-coach:coach open` | The dashboard in your browser (levels, evidence, faults, drills) |
| `/fork-trail-coach:fork PROJ-1` | Questions about a ticket before coding (plugin tickets in `tickets/`, or Jira) |
| `/fork-trail-coach:paper-trail PROJ-1` | Log the real choices while coding |
| `/fork-trail-coach:check-ticket PROJ-1` | After coding: code that is missing, extra or different from the ticket (private) |
| `/fork-trail-coach:pr-decisions PROJ-1` | Before the PR: decisions section, fault review, up to 3 questions |

## 5. A good first test (10 minutes)

1. `/fork-trail-coach:coach` and choose a track.
2. Make 2 or 3 commits in your repo that handle an outside call or errors.
3. Run `/fork-trail-coach:coach` again. Look at: **state** (Not assessed, Learning, Shown, Proven) and **exposure** (kept apart).
4. Answer one question. Then run `/fork-trail-coach:coach why <item>` and see your own words saved.
5. Try `/fork-trail-coach:coach drill <item>` on a skill marked "drill available".
6. Run `/fork-trail-coach:coach open` and look at the dashboard.

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
