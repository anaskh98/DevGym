# @ftc/eval

Evaluation for the Stump the Model entry. Week 1 holds the answer key for the synthetic ticket (EV-1); the harness (EV-3) and the scores come later.

## What is here

| Path | What |
| --- | --- |
| `answer-key/DEMO-1.json` | The five ambiguities planted in `DEMO-1`, four decoy questions Fork should not ask, and two extras that count as neither |
| `src/answerKey.ts` | Schema and loader for answer keys |
| `test/answerKey.test.ts` | Checks the key against the ticket and the demo repo, and that nothing from the key has leaked into the demo repo or the plugin |

## Keeping the key away from Fork

If Fork can read the answer key, the score means nothing. Three rules:

1. The key lives in this package, never in `demo-repo/` and never in `packages/plugin/`. A test enforces this.
2. Run Fork on a clone of the **published** demo repo (`scripts/publish-demo-repo.sh`), not inside this monorepo, so the key is not under Claude Code's project folder.
3. Skill text and web mocks use an unrelated sample ticket (`SAMPLE-7`), so they cannot teach Fork the answers to `DEMO-1`.

One gap to close in EV-3: installing the plugin from a git marketplace clones this whole repo under `~/.claude/plugins/marketplaces/`, so the key is on the developer's disk, outside the project folder. For scored runs, have the harness deny reads outside the demo clone, or move this package to its own private repo.

## Scoring a Fork run (for EV-3)

- **Caught**: a saved assumption asks about a planted ambiguity (`planted[].id`).
- **False alarm**: a saved assumption matches a decoy, or asks something else the repo or ticket already settles.
- **Neither**: a saved assumption matches `acceptable_extras`.

`match_hints` are a starting point for matching, not a matcher. Decide in EV-3 whether matching is by hand, by keyword, or by a model with a human check.
