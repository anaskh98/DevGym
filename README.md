# Fork, Paper Trail, Coach

One Claude Code plugin with a small local service and web app.

- **Fork** finds the places where a ticket can be read in more than one way and each reading leads to different code, asks only those questions, and saves what was answered and what was assumed.
- **Paper Trail** records each decision made while coding, with who made it and a pointer to the code.
- **Explain-back** asks the developer why a few of those decisions were made, and saves the answers with a rating.
- **Coach** builds a growth plan from evidence.

Developer profiles live in a SQLite file on the developer's machine and never leave it. Only the PR's "Decisions" section is shared with the team.

## Status

| Part | State |
| --- | --- |
| Backend: BE-1 to BE-12 | Built and tested |
| Backend: BE-13 (`coach open`) | Not started |
| Web app: all pages | Built on sample data. **Not yet connected to the REST API**, see below |
| Eval: EV-1 (demo repo, ticket, answer key) | Built |

**The web app and the REST API do not match yet.** The web app was built against the shapes in `packages/shared/src/api.ts` and its mock JSON. The REST API serves the shapes in [docs/api.md](docs/api.md). The web app is to be changed to match the API. Until then `pnpm dev:web` shows sample data only.

`docs/week-1-status.md` and `docs/frontend-status.md` describe an earlier backend. Where they disagree with this file about the backend, this file is right.

## Install the plugin

```bash
claude plugin marketplace add <owner>/<repo>
```

```bash
claude plugin install fork-trail-coach@fork-trail-coach
```

Needs Node.js 22.13 or later on your PATH. Then, in a repository with a `tickets/` folder:

| Command | What it does |
| --- | --- |
| `/fork-trail-coach:fork DEMO-1` | Ask the questions that change the code, save the assumption list |
| `/fork-trail-coach:paper-trail DEMO-1` | Start logging decisions for this coding session |
| `/fork-trail-coach:explain-back DEMO-1` | Explain 2 or 3 logged decisions, save answers and ratings |
| `/fork-trail-coach:pr-decisions DEMO-1` | Add the "Decisions" section to the pull request. Needs the GitHub CLI (`gh`), signed in |
| `/fork-trail-coach:pointers DEMO-1 12` | After the PR is opened or merged: move the pointers to its commit and check they resolve |
| `/fork-trail-coach:coach` | Build a growth plan from the saved observations |
| `/fork-trail-coach:status` | Check the plugin and the local service |

Claude Code prefixes a plugin's skills with the plugin name, so the plan's `/fork` is `/fork-trail-coach:fork`.

## Work on it

pnpm runs through corepack, so no global install is needed.

```bash
corepack pnpm install
corepack pnpm check      # typecheck, bundle the server, run every test
corepack pnpm dev:web    # web app on http://127.0.0.1:4318, with sample data
corepack pnpm api        # REST API on http://127.0.0.1:4317/api
```

| Command | What it does |
| --- | --- |
| `pnpm plugin:bundle` | Rebuild the files in `packages/plugin/server/` after changing the server. **Commit the result** |
| `pnpm plugin:validate` | Run Claude Code's validator on the marketplace and the plugin |
| `pnpm db:seed` | Create your local database and load the sample ticket |
| `pnpm db:status` | Show your local database and its row counts |

An installed plugin only gets the `packages/plugin` folder, and no build runs on install. So the server is
bundled into `packages/plugin/server/*.mjs` and those files are committed.

To try the plugin from a working copy without installing it:

```bash
claude --plugin-dir ./packages/plugin
```

## Layout

```
.claude-plugin/marketplace.json   makes this repo a plugin marketplace
packages/
  plugin/    the Claude Code plugin: manifest, .mcp.json, hooks, skills, bundled server
  server/    local service: SQLite, privacy guard, ticket adapter, MCP server, edit hook, REST API
  shared/    record and API shapes the web app was built against (see Status)
  web/       React + Vite app the plugin opens on localhost
  eval/      answer key now; harness and scores later
demo-repo/   Roomly, the synthetic service, and ticket DEMO-1
docs/api.md  the REST API, endpoint by endpoint
scripts/     publish-demo-repo.sh
```

How the pieces connect:

```
Claude Code + plugin ──stdio──▶ MCP server ──▶ privacy guard ──▶ SQLite (local file)
        │                                            ▲               │
        └── edit hook (file paths only) ─────────────┘               │
                                web app ◀──HTTP── REST API ◀─────────┘
```

## Privacy guard

Every write is checked before it is saved. A write is refused, with a reason, when the text:

- names a client on the denylist,
- looks like code or holds a secret,
- copies a run of code from the repo you are working in.

Put client names in `~/.fork-trail-coach/denylist.txt`, one per line (`#` starts a comment). The list stays on your machine.

The edit hook records file paths only, and only for sessions started with `paper-trail`.

## The demo repo and the answer key

`demo-repo/` is the source of the synthetic service. It is published as **its own GitHub repository**, and Fork runs on a clone of that:

```bash
scripts/publish-demo-repo.sh <owner>/roomly
```

The answer key is in `packages/eval/answer-key/`. It must stay out of `demo-repo/` and out of `packages/plugin/`; a test in `packages/eval` fails if anything from it leaks into either. Do not run Fork from inside this monorepo: the key would be inside Claude Code's project folder. See [packages/eval/README.md](packages/eval/README.md).

The plugin ships one ticket of its own, `SAMPLE-1`, so the tools can be tried anywhere. It is unrelated to `DEMO-1`.

## Settings

| Variable | Default | Used by |
| --- | --- | --- |
| `FTC_DB_PATH` | `~/.fork-trail-coach/profile.sqlite` | server |
| `FTC_TICKETS_DIR` | `<project>/tickets` | server |
| `FTC_DEVELOPER_ID` | `local` | server |
| `FTC_DENYLIST_PATH` | `denylist.txt` next to the database | server |
| `FTC_DENYLIST` | empty | server: extra client names, comma-separated |
| `FTC_PORT` | `4317` | REST API |
| `FTC_WEB_ORIGIN` | `http://127.0.0.1:4318,http://localhost:4318` | REST API: browser origins allowed to call it |
| `VITE_API_MODE` | `mock` | web: `mock` or `live` |
| `VITE_API_BASE` | `http://127.0.0.1:4317` | web, live mode |
| `VITE_MOCK_DIR` | `mock` | web, mock mode |
