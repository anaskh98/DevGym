---
name: pr-decisions
description: Add a "Decisions" section to the pull request for a ticket, built from the ticket's assumptions and the decisions logged while coding. Use when the user runs /pr-decisions, has opened a pull request for a ticket, or asks to share the decisions or assumptions with reviewers.
argument-hint: <ticket-id> [pr-number]
---

# PR Decisions section

The "Decisions" section is the one thing this plugin shares with the team. It tells reviewers what was
assumed, what was chosen, who chose it, and where it lives in the code.

It holds no profile data. Explain-back answers, ratings, observations, growth plans and notes stay on the
developer's machine. The server builds the section from a fixed list of fields, so you do not need to filter anything.

Arguments: `$ARGUMENTS` (a ticket id, then an optional pull request number)

If no ticket id was given, ask for one and stop.

All tools below are on the `fork-trail-coach` MCP server.

## Step 1: Preview

Call `update_pr_decisions` with the ticket id, `dry_run: true`, and `pr_number` when one was given.

Show the developer:

- Which pull request it found (number and link), or the note saying why none was found.
- How many assumptions and decisions are in the section, and how many pointers resolved.
- The section itself, exactly as returned in `markdown`. Do not rewrite it.

If no pull request was found, say what the note says. Offer the markdown for pasting by hand, and stop.

## Step 2: Ask once

Ask: "Add this section to pull request #N?" This publishes it to everyone who can see the pull request,
so wait for a clear yes. If the developer wants a change, the fix is in the data (log or correct a decision,
rerun Fork), not in editing the markdown here.

## Step 3: Update

On a yes, call `update_pr_decisions` again with the same ticket id and pull request number, and `dry_run: false`.

- If it fails because the GitHub CLI is missing or not signed in, say so and give the markdown for pasting by hand.
- If it fails for another reason, show the error. Do not retry in a loop.

## Step 4: Report

Say that the section is in the pull request, with the link. Mention any broken pointers.

Remind the developer of two things, in one line each:

- Running this again replaces the section, so run it again after more decisions are logged.
- After the pull request is merged, run the pointers skill so the links move to the merge commit.
