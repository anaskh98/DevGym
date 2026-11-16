# Frontend status

> **Note, 16 Nov 2026:** the backend this file describes (`packages/server`, `packages/plugin`) was replaced by a different one. For the current backend, commands and API, see the [README](../README.md) and [api.md](api.md). The frontend, demo repo and eval parts still apply.

16 Nov 2026. Every frontend task in the build plan (FE-1 to FE-8) is built. Only Fork has been run against real data; the other pages run on sample data, because the backend pieces they read from are not built yet.

## What is built

| Task | State | Still needs |
| --- | --- | --- |
| FE-1 App skeleton | Done | |
| FE-2 Fork view | Done | |
| FE-3 Paper Trail view | Done on sample data | Real pointers from BE-7, so links open the right file on GitHub |
| FE-4 Explain-back panel | Done on sample data | Real explain-backs from BE-8 |
| FE-5 Coach report | Done on sample data | A real plan from BE-11; notes saved through BE-12 |
| FE-6 "My data" page | Done on sample data | BE-12, so delete empties the real database |
| FE-7 Eval dashboard | Done on sample data | The results file from EV-3 |
| FE-8 States and polish | Done | A pass on real data before the demo |

How it was checked: typecheck, 35 web tests, and every flow below driven in a real browser at desktop and phone widths. Not run on Windows.

## What each page shows

**Fork** (`/#/fork/<ticket>`): the ticket, the questions Fork asked, and each one tagged "answered by PO" or "assumed by dev".

**Paper Trail** (`/#/paper-trail/<ticket>`)

- The decisions in the order they were made, each with the time, an origin badge (AI, dev, dev changed AI), the options not taken, and a link to the file and function.
- The explain-back under its decision: the question, the developer's answer, and the rating (clear, partial, not yet).
- A filter by origin.

**Coach** (`/#/coach`)

- The latest growth plan: one to three focus areas.
- Each claim with the observations it rests on, and under each observation links to the decisions and explain-backs behind it. A link opens the Paper Trail at that decision.
- A "tentative" tag on a claim that rests on a single observation.
- The exercise for each claim.
- "Add a note" with "I disagree with this claim". A saved note shows under the claim, and is still there after a reload.

**Eval** (`/#/eval`)

- The five scores, each as "passed of total" with one cell per item counted.
- The failure log: area, what went wrong, what was expected, what happened.
- A score that was not run says "Not run yet" instead of showing zero.

**My data** (`/#/my-data`)

- Where the file is, and each of the eight kinds of record with a count and the records themselves.
- "Export as JSON", which downloads exactly what the page shows.
- "Delete everything", with a confirmation step.

## States (FE-8)

No screen is blank. Each page has a loading line, an empty state that says what to do next, and an error state that says what went wrong.

| Situation | What the user sees |
| --- | --- |
| Data still loading | "Loading ..." |
| Nothing stored yet | What to run in Claude Code to create it |
| Ticket not in the store | "No ticket called X", with a link to the ones that are |
| Local service not reachable (live mode) | The address it tried, and how to switch to sample data |
| Data in an unexpected shape | Says the app and the data do not match |
| Pointer without repo or commit | The path, marked "not linked yet", with no link |
| Decision with no pointer | "No place in the code recorded" |
| No evaluation run | What the harness does and that results will appear here |
| No growth plan | How to get one |
| Unknown address | "Page not found", with a way back |
| A page fails while drawing | An error panel inside the layout; the menu still works |

Also: a browser tab title per page, scroll position reset on navigation, visible keyboard focus, and a skip link.

## Two things I had to decide

**What "the five scores" are.** The plan says the dashboard shows five scores but does not list them. From the eval tasks I took them to be: Fork (planted ambiguities caught, with false alarms beside it), Paper Trail (hand-marked decisions that were logged), Pointers (still resolving after the squash merge), Coach (claims seniors rated as supported), and Privacy guard (red-team attempts rejected). The eval owner should confirm or change this before EV-3 writes the file.

**Where notes go on sample data.** The sample files are read-only, so a note added in mock mode is kept in the browser's local storage. That is what makes "shown on reload" work without a backend. "Delete everything" clears those notes too. In live mode notes go to the local service and nothing is kept in the browser.

## The API the backend needs to provide (BE-12)

The web app validates every response against the shapes in `packages/shared/src/api.ts`.

| Method and path | Shape | Used by |
| --- | --- | --- |
| `GET /api/tickets` | `TicketListResponse` | Fork, Paper Trail |
| `GET /api/tickets/:id/fork` | `ForkResultResponse` | Fork |
| `GET /api/tickets/:id/trail` | `PaperTrailResponse` | Paper Trail |
| `GET /api/coach` | `CoachReportResponse` | Coach |
| `POST /api/annotations` | body `AnnotationInput`, returns `Annotation` | Coach |
| `GET /api/eval` | `EvalResults`, or 404 when there is no results file | Eval |
| `GET /api/data` | `MyDataResponse` | My data, and its export |
| `DELETE /api/data` | `DeleteAllResponse` | My data |

The store already has everything except delete: `listTickets`, `listForkRuns`, `listDecisionViews`, `getCoachReport`, `addAnnotation`, `readAll`. BE-12 is an HTTP layer over those, plus `deleteAll`, bound to 127.0.0.1. In development the web app runs on another port, so the API has to allow that origin.

## The eval results file (EV-3)

The Eval page reads `packages/eval/results/latest.json` in the `EvalResults` shape: five scores (`id`, `label`, `measures`, `status`, `passed`, `total`, `also`) and a list of failures (`area`, `run`, `what`, `expected`, `got`). `pnpm db:export-mock` picks the file up when it exists. See `packages/server/fixtures/sample-eval.json` for an example.

## Sample data

`pnpm mock:refresh` plays a made-up coding session through the real store, with the same input checks the MCP tools use, and writes the mocks from it. The eval numbers come from a fixture, and the Eval page says they are made up. Tests in the web package fail if the committed mocks stop matching the shared shapes, if the sample stops covering a state a page has to draw, or if the sample scores and the sample failure log disagree.

## Left out on purpose

- **"Unexplained" files.** BE-6 flags edited files that have no decision. There is no record for edited files yet, so the Paper Trail view does not show them.
- **Opening the report from Claude Code.** That is `/ftc:coach open` (BE-13).
- **Links from sample data.** The sample repository is made up, so its GitHub links do not resolve.

## Numbers

- Server: 39 tests. Web: 35 tests. Eval: 5 tests. Demo repo: 17 tests.
- `pnpm check` passes: typecheck, all tests, bundle check, and the 17-check stdio smoke test.
