---
name: paper-trail
description: Start a Paper Trail for a ticket, so every real choice made while coding it is logged with who made it and what the alternatives were. Use when the user runs /paper-trail, starts coding a ticket, or asks to track or log decisions for a ticket.
argument-hint: <ticket-id>
---

# Paper Trail

Ticket id: `$ARGUMENTS`
Session id: `${CLAUDE_SESSION_ID}`

If no ticket id was given, ask for one and stop.

## Start

Call `start_trail` on the `fork-trail-coach` MCP server with the ticket id and the session id above.
If it fails, tell the user the error and stop.

It returns the ticket and its saved assumptions. Show the assumptions in one short list.
Treat them as requirements: code to the answers the product owner gave and to the assumptions the developer chose.
If there are none, suggest running Fork on the ticket first, then carry on if the developer wants to.

Then say that Paper Trail is on, and continue with what the developer asks.

## The rule, for the rest of this session

**Each time a real choice is made, call `log_decision` right after the edit that implements it.**

A real choice has all of these:

- There were at least two workable options.
- A reviewer could reasonably ask "why this way?".
- It affects behaviour, data, an interface, structure, a dependency, error handling, security, or performance.

Typical choices: a data shape, an algorithm, a library, where code lives, how an error is handled, a limit or
default value, a trade-off, or reading the ticket one way and not another.

Not a choice: formatting, a rename, an import, boilerplate, or code with only one sensible way to write it.
Do not log these. Padding the trail makes it useless.

### What to send

- `ticket_id` and `session_id`: the values above.
- `summary`: what was chosen and why, in one or two sentences. **Words only. Never code, never file contents.**
- `alternatives`: the other options that were really considered, one short phrase each. Do not invent some afterwards.
- `origin`: be honest, this is the point of the trail.
  - `ai`: you chose it yourself. The developer did not tell you which way to go.
  - `dev`: the developer told you which way to go.
  - `dev_changed_ai`: you proposed or wrote one way, and the developer changed it to another.
- `pointer`: where the choice lives.
  - `repo`: `owner/name` from the git remote. If there is no remote, the project folder name. The server corrects it from the git remote when there is one.
  - `file_path`: relative to the project root.
  - `line_hint`: a line inside the function where the choice was made. **Always send it when you can.** The server reads the file and works out the function name from this line.
  - `symbol`: the function, class or method name. Send it when you cannot give a line, or for a language the server does not parse (it parses TypeScript and JavaScript).
- `related_files`: other files the same choice covers, for example its test.

When the developer overrides something you already logged, log a new decision with `dev_changed_ai`.
Name the old way in `alternatives`.

If a call is rejected, fix what it complains about and send it again. Do not silently skip the decision.

## Before you say the work is done

Call `get_trail` with the session id. Look at `unexplained_files`: files this session edited that no decision points at.

For each one:

- A decision you logged already covers it: nothing was lost, but the link is missing. Say so in the report.
- It holds a real choice you did not log: log it now.
- It was routine, with no real choice: leave it. Do not invent a decision to clear the flag.

Then report in a few lines: how many decisions were logged, split by origin, and the files still flagged
"unexplained" with a short reason for each.
