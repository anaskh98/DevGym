# Demo script

The end-of-week-3 dry run, on the synthetic ticket DEMO-1. Every step below was run end to end on 16 Nov 2026,
with one difference: Claude Code itself was not used. The plugin's service was driven over the same protocol,
and the Clarify questions were the ones a model asked in the stand-in run of 15 Nov. Rehearse it once in Claude Code
before showing it.

## Before the demo

1. Node 22.13 or later and the Claude Code CLI on the demo machine. `gh` signed in, for step 5.
2. Publish the demo repo once: `scripts/publish-demo-repo.sh <owner>/roomly`. Clone it **outside** this monorepo,
   so the answer key is not in Claude Code's project folder.
3. Start from an empty profile: delete `~/.devgym/` (or use "Delete everything" on the My data page).

## The steps

| # | Do | Show |
| --- | --- | --- |
| 1 | `claude plugin marketplace add <owner>/<repo>` then `claude plugin install devgym@devgym`. Start `claude` in the roomly clone, run `/mcp` | `plugin:devgym:devgym` connected |
| 2 | `/devgym:clarify DEMO-1`. Answer two questions as the PO, skip the rest. Then, in this repo, `pnpm eval:save-run` | The table of questions: 2 "answered by PO", the rest "assumed by dev" |
| 3 | On a branch, `/devgym:track DEMO-1`, then ask Claude to implement the ticket. Override one of its choices | The edit hook's reminders; decisions logged as AI, dev, and dev changed AI |
| 4 | `/devgym:explain DEMO-1` and answer the 2 or 3 questions | Ratings: clear, partial, not yet |
| 5 | Push, open the PR, `/devgym:pr-decisions DEMO-1`. Squash merge on GitHub, `git pull`, then `/devgym:pointers DEMO-1 <pr>` | The "Decisions" section in the PR; after the merge, every pointer resolves at the merge commit |
| 6 | `/devgym:grow`, then `/devgym:grow open` | Evidence links (they open the Track at the decision), one "tentative" claim; add an "I disagree" note, reload, it is still there |
| 7 | In this repo, `pnpm eval`, then open Eval in the web app | The five scores and the failure log. Track and Grow say "Not run yet" until EV-2 and EV-4 exist |
| 8 | My data: "Export as JSON", then "Delete everything" | The file downloads; afterwards every page is empty |

## What the rehearsal on 16 Nov produced

- Clarify: 5 of 5 planted ambiguities caught in 1 run, no false alarms.
- Track: 3 decisions, one per origin; the function names were worked out from line numbers; README.md, edited
  with no decision, was flagged.
- Pointers: 3 of 3 resolved on the branch, and 3 of 3 again at the squash-merge commit.
- Privacy guard: 16 of 16 red-team attempts rejected, 0 plain descriptions wrongly blocked. A note with code in it
  was refused in the browser with the guard's own reason.
- Grow: the one-observation claim was marked tentative by the service; a disagree note survived a reload.
- My data: 25 records deleted; every page empty afterwards.

## Known limits to say out loud

- Clarify's score matches questions to the answer key by keyword. The failure log lists anything it could not match,
  for a person to check.
- The Track and Grow scores need the hand-marked decisions (EV-2) and the senior review (EV-4).
- Run Clarify three times for the real score: run, `pnpm eval:save-run`, and repeat. Clarify replaces its list on each run.
