---
name: coach
description: Show the developer's level on the backend or frontend ladder, built from their own commits and answers, and a personal growth plan with exercises on real spots in their code. Also runs interview drills, explains why an item has its state, and shows growth over time. With "open", opens the saved report in the browser. Use when the user runs /coach, asks for a growth plan, coaching, their level, what to study next, a drill, or to see their coach report.
argument-hint: "[open | drill <item-id> | why <item-id> | history]"
---

# Coach

Coach is a private study guide for this developer. It shows where they stand on a ladder (junior, mid, senior,
staff) for each area, using evidence from **their own** code and answers, and what to do next to move up.
It is coaching, not a performance review, and it never leaves this machine.

**Plain code decides every state and level. You never set one, and never say a level the server did not return.**

All tools below are on the `fork-trail-coach` MCP server.

Argument: `$ARGUMENTS`
Session id: `${CLAUDE_SESSION_ID}`

## `open`

Call `open_report`. Tell the developer the address it returned, in one line. Add that the page is served from
this machine only and stops when this Claude Code session ends. If the call fails, show the error and stop.

## No argument: status and plan

### Step 1: Status

Call `coach_status`.

- If `tracks` is empty, ask once: "Do you work on backend, frontend, or both?" Call `set_coach_tracks` with the
  answer, then call `coach_status` again.
- Show any `ladders[].warning` and the `catch_up.note` in one line each, if present.
- Show `text` exactly as returned, in a code block. Do not change it.

### Step 2: The plan

For each frame in `focus` (at most 3):

1. If the frame has a `stack` but `stack_note` is null, write one short best-practice note for this item in that
   stack (1 to 3 plain lines, from the item's meaning and the stack's official docs, with one `https://` link to
   those docs) and save it with `save_stack_note`. Then use it.
2. Write the claim: one or two sentences on what the evidence shows and what the frame's `needs` says is missing.
   Describe the work, not the person.
3. Write one exercise the developer can finish in under an hour:
   - If the frame has a `spot`, the exercise is about that spot and **names its file**:
     "In `pay.ts`, `charge` has no rule for when to retry. Decide it, write it down, and be ready to explain why."
   - If there is no spot, tie it to **the next ticket**: "On your next ticket, set a time limit on every outside call."
   - Use the stack note and the study topics so it fits their stack.

Save all of them with one `save_growth_plan` call. Each focus area has `claim`, `evidence_ids` (the frame's
`evidence_ids`), `exercise`, `item_id`, `ladder_id`, and `spot` and `stack` when the frame has them.
If the server refuses an area, read the reason and fix that part. Never pad evidence or make the exercise vague.

Then show, for each focus item: the item id and title, the claim, the exercise, the stack note with its link, and
the study topics. If the server marked a claim tentative, say it rests on one piece of evidence.

Say in one line that the plan is saved on this machine only.

### Step 3: Questions and drills

If `questions` is not empty, offer to answer them now (at most 3). The developer can say "later".
Ask them as in **Asking a question** below.

If `drills_ready` is not empty, say which items are ready for a drill and how to start one:
`/fork-trail-coach:coach drill <item-id>`.

## Asking a question

One question at a time:

1. Word one question from the question's `about`. Ask **why** the code is this way, or what would go wrong another
   way. Never give the answer away. Plain words, no code.
2. Call `ask_question` with the session id, the `question_id`, and the exact text, **right before** you ask it.
3. Ask it, and wait. The developer's next message is saved as the answer by a hook, word for word.
   You do not record it. If they reply "later" or "skip", the question is kept for next time: move on.
4. Call `rate_answer`:
   - `clear`: the real reason, and they know what the other way would cost.
   - `partial`: right but thin, or the trade-off is missing, or part is wrong.
   - `not_yet`: they cannot say why, or the reason is not the reason.
   - Only if the answer names the trade-off, copy those exact words into `tradeoff_quote`.
   Rate what they said, not what they meant. Never rate up to be kind: a wrong `clear` hides the gap this exists to find.
5. Tell them the rating in a few words. For `partial` or `not_yet`, give the missing piece in one or two sentences.

## `drill <item-id>`

1. Call `start_drill` with the item id and the session id. If it is refused, say why (the item must be Shown, or
   they must wait after a failed drill) and stop.
2. Ask the returned `prompt` exactly as it is. Say it is an interview-style question about a new situation.
3. Wait for the answer. It is saved by the hook.
4. Call `drill_key` with the drill's `question_id`. It returns the key points and red flags with their ids. It works
   only after the answer is saved, so you never see the key while asking.
5. Call `score_drill`. For each key point and red flag the answer really shows, give its id and the **exact words**
   from the answer. Do not stretch: a point the answer does not make is missed.
6. Show the result: passed or not; each key point as hit or missed, using the key's own wording; any red flag; then
   the study topics for the missed points. If passed, say the item is now Proven.

## `why <item-id>`

Call `coach_item`. Show the state and what it still needs. Then list, each with its id:

- code proofs and faults (file, function, ticket, date, who wrote it),
- answers (question, rating),
- drills (passed or not).

Say the developer can disagree with a piece of evidence or a drill score, and that disagreeing can only lower a
state, never raise it. If they want to, call `disagree` with the id and their reason in their own words.

## `history`

Call `coach_history`. Show each change as "item: from → to, date, reason", oldest first. Point out items that
moved up. If there are none yet, say so.

## Rules

- Never say a state or level the server did not return.
- No code, file contents or client names in anything you save.
- Do not judge the developer from this conversation. Use only what the tools return.
