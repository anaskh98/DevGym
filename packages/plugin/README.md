# Fork, Paper Trail, Coach (`ftc`)

A Claude Code plugin with a small local service.

- **Fork** finds the places where a ticket can be read in more than one way and each reading leads to different code, asks only those questions, and saves the result as assumptions.
- **Paper Trail** records each decision made while coding, with who made it and a pointer to the code. *(week 2)*
- **Coach** builds a growth plan from evidence. *(week 3)*

Everything is stored in one SQLite file on your machine. Nothing in it is sent anywhere.

## Install

```bash
claude plugin marketplace add <owner>/<repo> && claude plugin install ftc@md-labs
```

Needs Node.js 22.13 or later. There is nothing else to install: the service is one bundled file in `dist/`.

## Components

| Component | What it does |
| --- | --- |
| Skill `/ftc:fork [ticket-id]` | Runs Fork on a ticket |
| MCP server `service` | Local stdio server with six tools: `get_ticket`, `save_assumptions`, `log_decision`, `record_explain_back`, `save_observation`, `save_growth_plan` |

Run `/mcp` in Claude Code to check the server shows as `plugin:ftc:service`.

## Use

In a repository that has a `tickets/` folder of Markdown tickets:

```
/ftc:fork DEMO-1
```

Fork reads the ticket and the code it touches, then asks its questions. Answer as the product owner where you know the answer; skip a question to leave it as an assumption. The list is saved with each item tagged "answered by PO" or "assumed by dev".

## Settings

All optional. Set them in your shell before starting Claude Code.

| Variable | Default | What |
| --- | --- | --- |
| `FTC_DB_PATH` | `~/.ftc/ftc.sqlite` | The local SQLite file |
| `FTC_TICKETS_DIR` | `<project>/tickets` | Where Markdown tickets live |
| `FTC_DEVELOPER_ID` | your OS user name | Who observations and growth plans belong to |

## Ticket format

```markdown
---
id: DEMO-1
title: Let members cancel a booking
---

The ticket body, in Markdown.
```

## Not built yet

The privacy guard (BE-9) is a placeholder that allows every write. Until it lands, use the plugin only with synthetic repositories and tickets.

`dist/server.mjs` is generated from `packages/server`. Do not edit it; run `pnpm plugin:bundle` in the monorepo.
