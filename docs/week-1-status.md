# Week 1 status

> **Note, 16 Nov 2026:** the backend this file describes (`packages/server`, `packages/plugin`) was replaced by a different one. For the current backend, commands and API, see the [README](../README.md) and [api.md](api.md). The frontend, demo repo and eval parts still apply.

15 Nov 2026. Covers the week 1 column of the build plan: BE-1 to BE-5, FE-1, FE-2 and EV-1.

**The week 1 gate, "Fork runs end to end on the demo ticket", is not passed yet.** Everything Fork needs is built and tested up to the model: the plugin installs, the skill loads, and the MCP tools take the calls the skill makes. Nobody has yet run `/ftc:fork DEMO-1` in Claude Code on a clone of the demo repo. That run is the gate.

## Stand-in run, 15 Nov

Fork was run once without Claude Code: a fresh Claude agent that had not seen the answer key was given the skill file and a copy of the demo repo, and it called the plugin's bundled service over stdio. The answer key was moved out of the repo for the run.

| Check | Outcome |
| --- | --- |
| Questions asked | 5 |
| Planted ambiguities caught | 5 of 5 |
| Decoy questions asked (false alarms) | 0 of 4 |
| Tags | 2 answered by PO, 3 assumed by dev, matching the replies given |
| Saved | Accepted by `save_assumptions` on the first call |
| Demo repo | Unchanged; Fork did not start coding |

Read this as "the skill and the service work together", not as a score:

- The ticket, the answer key and the skill have the same author, so the result is optimistic. It is also one run; EV-3 calls for three.
- Claude Code loading the skill and tools natively, and the question dialog, were not exercised. The questions went through the skill's plain-text fallback.
- Installing from `anaskh98/ftc` could not be tried: the repo is private. Teammates need access to it.

Three things changed because of the run:

1. **Answer key, version 2.** Fork treated "delete the booking or keep it as cancelled" as settled, because the ticket says cancelling "returns the updated booking". That is a fair reading, so the plant was weak. A2 is now the part that is open (does a cancelled booking still count in the usage report?), and delete-or-keep is a fifth decoy. The eval owner should review this change.
2. **Skill: answers.** Saved answers no longer repeat how the fork was settled ("the product owner said assume"), and a picked option is saved as its text, not its letter.
3. **Skill: options.** Each option must make sense read on its own.

## What is built

| Task | State | Checked by |
| --- | --- | --- |
| BE-1 Monorepo and plugin skeleton | Done | `claude plugin validate` passes for the marketplace and the plugin; installing from a local marketplace loads 1 skill and 1 MCP server |
| BE-2 SQLite schema, migrations, seed | Done | Tests: all eight tables exist, migration is idempotent; `pnpm db:seed` loads DEMO-1 |
| BE-3 MCP server, six tools, zod validation | Done | 29 server tests, plus `pnpm smoke`: 17 checks over stdio against the bundled server, good and bad input |
| BE-4 Markdown ticket adapter | Done | Tests, including ids that try to leave the tickets folder |
| BE-5 `/ftc:fork` skill | Written, not yet run with a model | Tool contract tested; skill loads in Claude Code |
| FE-1 App skeleton | Done | Typecheck, 12 tests, production build; mock to live is `VITE_API_MODE` |
| FE-2 Fork view | Done on sample data | Viewed at desktop and phone widths |
| EV-1 Demo repo, ticket, answer key | Built, not yet published | Demo repo: typecheck and 17 tests pass standalone. Answer key: 5 tests, including a leak check |

Not in week 1 and not started: EV-2 (ground truth from a reference coding session), which the timeline also puts in week 1 for the eval owner.

## To pass the gate

1. Push this repo to GitHub.
2. Publish the demo repo: `scripts/publish-demo-repo.sh <owner>/roomly`.
3. On a developer machine: `claude plugin marketplace add <owner>/<repo> && claude plugin install ftc@md-labs`.
4. Clone the demo repo somewhere outside this monorepo, start Claude Code in it, run `/ftc:fork DEMO-1`. Answer two questions as the PO and skip the rest.
5. Back in this repo: `pnpm db:export-mock`, then `VITE_MOCK_DIR=mock-local pnpm dev:web`. The Fork view should show the ticket, the questions and both tags.

Compare the questions Fork asked with `packages/eval/answer-key/DEMO-1.json` by hand. That is the first informal score.

## Decisions made while building

These go beyond the plan, or differ from it. Each is easy to reverse this week and harder later.

1. **Commands are `/ftc:fork`, not `/fork`.** Claude Code always prefixes a plugin's skills with the plugin name. The plugin is named `ftc` to keep that short. The demo script should say `/ftc:fork`, `/ftc:explain-back`, `/ftc:coach`.
2. **SQLite through Node's built-in `node:sqlite`, not a native package.** Claude Code copies only the plugin folder on install, so the server ships as one bundled file (`packages/plugin/dist/server.mjs`, committed). A native SQLite module cannot be bundled. Cost: Node 22.13 or later, and the module is still marked experimental in Node 22.
3. **A fifth package, `shared`.** The record schemas, tool inputs and API shapes are used by the server, the web app and the eval harness.
4. **Assumptions carry three fields beyond the plan's key fields**: `readings` (the readings offered), `run_id` (one per `/ftc:fork` run, so the harness can score three runs separately) and `position`.
5. **The privacy guard is a seam, not a guard.** Every write goes through `Store`, and `Store` calls the guard first; tests prove no write path skips it and that a rejection writes nothing. The guard itself allows everything until BE-9. Until then, synthetic data only.
6. **The server-side Coach rule is already in.** `save_growth_plan` rejects a claim without evidence and marks a single-observation claim tentative. That is the server half of BE-11; the skill is still to do.
7. **Web mocks and skill examples use an unrelated ticket (`SAMPLE-7`)**, so neither can teach Fork the answers to `DEMO-1`.
8. **The web app uses hash routes** (`/#/fork/DEMO-1`), so BE-13 can serve the build as plain static files.
9. **The database is `~/.ftc/ftc.sqlite`**, not the plugin's data folder, so the web app, REST API and eval harness find the same file, and uninstalling the plugin does not delete a developer's data.

## Open questions for the team

- **Where should the answer key live for scored runs?** Installing from a git marketplace clones this whole repo under `~/.claude/plugins/marketplaces/`, so the key is on the developer's disk, outside the project folder. Options: the harness denies reads outside the demo clone, or `packages/eval` moves to a private repo. Decide before EV-3.
- **Pointer required on every decision?** `log_decision` accepts a decision without a pointer today (some decisions have no single location). BE-6 and BE-7 may want to require it.
- **An empty Fork run leaves no row.** `save_assumptions` accepts an empty list, but nothing records that the run happened. If EV-3 needs to count empty runs, add a `fork_runs` table.

## Week 2 starts from here

- BE-6: add the Paper Trail skill rule and the PostToolUse hook (`packages/plugin/hooks/hooks.json`). `log_decision` is ready.
- BE-7: fill `symbol`, `repo` and `commit` on pointers. The table and `PointerLink` are ready; a pointer without repo or commit renders as "not linked yet".
- BE-8: `/ftc:explain-back` skill. `record_explain_back` is ready.
- BE-9: implement `PrivacyGuard` in `packages/server/src/privacy/` and swap it in for `PendingGuard` in `src/mcp/main.ts`. No caller changes.
- FE-3, FE-4, FE-6: add response shapes to `packages/shared/src/api.ts` first, then mocks, then pages. `OriginBadge` and `PointerLink` exist.
