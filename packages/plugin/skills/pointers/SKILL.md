---
name: pointers
description: Check that every decision's pointer for a ticket still finds its code, and move the pointers to the pull request's merge commit after a merge. Use when the user runs /pointers, has opened or merged the pull request for a ticket, or asks whether the decision links still work.
argument-hint: <ticket-id> [pr-number]
---

# Pointers

Each logged decision points at a file and a function. After a squash merge the branch's commits are gone,
so the pointers must move to the merge commit. This skill does that and reports what no longer resolves.

Arguments: `$ARGUMENTS` (a ticket id, then an optional pull request number)

If no ticket id was given, ask for one and stop.

## Step 1: Resolve

Call `resolve_pointers` on the `devgym` MCP server with the ticket id.
Pass `pr_number` when one was given.

- With no `pr_number`, the server finds the pull request of the current branch.
- If the call fails because the pull request cannot be found, ask the developer for the number and call again.
- If it fails because a commit is not in this clone, ask the developer to pull, then call again.
- Do not pass `commit` unless the developer gives you one.

## Step 2: Report

Say, in a few lines:

- Which pull request and commit the pointers now use, and whether the pull request is merged or still open.
- How many pointers resolved out of the total.
- Each broken pointer: the file, the function, and the reason.

A broken pointer usually means the function was renamed or the file was moved or deleted before the merge.
Do not edit code to make a pointer resolve, and do not log new decisions here. Just report.

If the pull request is still open, say that the pointers use the branch's newest commit for now, and that
this should be run again after the merge.
