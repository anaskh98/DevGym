# Fork, Paper Trail, Coach

One Claude Code plugin with a small local service and web app.

- **Fork** finds the places where a ticket can be read in more than one way and each reading leads to different code, asks only those questions, and saves what was answered and what was assumed.
- **Paper Trail** records each decision made while coding, with who made it and a pointer to the code.
- **Coach** builds a growth plan from evidence.

Developer profiles live in a SQLite file on the developer's machine and never leave it. Only the PR's "Decisions" section is shared with the team.

**Status: week 1 of 3.** Fork works end to end through the local service; Paper Trail and Coach have their data model and tools but no skills yet. See [docs/week-1-status.md](docs/week-1-status.md).

## Install the plugin

```bash
claude plugin marketplace add <owner>/<repo> && claude plugin install ftc@md-labs
```

Needs Node.js 22.13 or later. Then, in a repository with a `tickets/` folder:

```
/ftc:fork DEMO-1
```

Claude Code prefixes a plugin's skills with the plugin name, so the plan's `/fork` is `/ftc:fork`.

## Work on it

```bash
pnpm install
pnpm check          # typecheck, tests, plugin bundle check, stdio smoke test
pnpm dev:web        # web app on http://127.0.0.1:4318, with sample data
```

| Command | What it does |
| --- | --- |
| `pnpm plugin:bundle` | Rebuild `packages/plugin/dist/server.mjs` after changing the server. Commit the result |
| `pnpm plugin:validate` | Run Claude Code's validator on the marketplace and the plugin |
| `pnpm smoke` | Drive the bundled MCP server over stdio: all six tools, good and bad input |
| `pnpm db:migrate` | Create or update your local database (`~/.ftc/ftc.sqlite`) |
| `pnpm db:seed` | Load the demo ticket into it |
| `pnpm db:export-mock` | Write your local database as JSON the web app can show: `VITE_MOCK_DIR=mock-local pnpm dev:web` |
| `pnpm mock:refresh` | Regenerate the committed sample mocks in `packages/web/public/mock` |

To try the plugin from a working copy without installing it:

```bash
claude --plugin-dir ./packages/plugin
```

## Layout

```
.claude-plugin/marketplace.json   makes this repo a plugin marketplace
packages/
  plugin/    the Claude Code plugin: manifest, .mcp.json, skills, bundled server
  server/    local service: SQLite, privacy-guard seam, ticket adapter, MCP server
  shared/    the eight records, tool inputs and API shapes, as zod schemas
  web/       React + Vite app the plugin opens on localhost
  eval/      answer key now; harness and scores later
demo-repo/   Roomly, the synthetic service, and ticket DEMO-1
scripts/     publish-demo-repo.sh
```

How the pieces connect:

```
Claude Code + plugin ──stdio──▶ MCP server ──▶ privacy guard ──▶ SQLite (local file)
                                                                     │
                                web app ◀──HTTP── REST API (BE-12) ◀─┘
```

## The demo repo and the answer key

`demo-repo/` is the source of the synthetic service. It is published as **its own GitHub repository**, and Fork runs on a clone of that:

```bash
scripts/publish-demo-repo.sh <owner>/roomly
```

The answer key is in `packages/eval/answer-key/`. It must stay out of `demo-repo/` and out of `packages/plugin/`; a test in `packages/eval` fails if anything from it leaks into either. Do not run Fork from inside this monorepo: the key would be inside Claude Code's project folder. See [packages/eval/README.md](packages/eval/README.md).

## Settings

| Variable | Default | Used by |
| --- | --- | --- |
| `FTC_DB_PATH` | `~/.ftc/ftc.sqlite` | server |
| `FTC_TICKETS_DIR` | `<project>/tickets` | server |
| `FTC_DEVELOPER_ID` | OS user name | server |
| `VITE_API_MODE` | `mock` | web: `mock` or `live` |
| `VITE_API_BASE` | `http://127.0.0.1:4317` | web, live mode |
| `VITE_MOCK_DIR` | `mock` | web, mock mode |
