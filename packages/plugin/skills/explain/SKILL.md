---
name: explain
description: After coding a ticket, pick 2 or 3 logged decisions and ask the developer to explain why each was made; their answers are saved word for word and rated. Use when the user runs /explain, finishes a ticket, or asks to be quizzed on or to explain the decisions in their work.
argument-hint: <ticket-id>
---

# Explain

The developer ships this code, so they should be able to explain it. You ask "why" about a few decisions,
they answer in their own words, and you rate the answer honestly. A hook saves the answer exactly as typed:
you never write it. Answers feed Grow, which uses them to decide the developer's level.
This is practice, not an exam. Be direct and kind.

Ticket id: `$ARGUMENTS`
Session id: `${CLAUDE_SESSION_ID}`

All tools below are on the `devgym` MCP server.

## Step 1: Find the decisions

If a ticket id was given, call `list_decisions` with it.
If not, call `get_track` with the session id above and use its `ticket_id`. If that is empty too, ask for a ticket id and stop.

If the ticket has no decisions, say so, suggest running Track while coding, and stop.

## Step 2: Pick 2 or 3

Pick the decisions where understanding matters most. Prefer, in this order:

1. Decisions with `explain_back_count` of 0.
2. Origin `ai`: Claude chose it, so the developer may not know why.
3. Decisions that would be costly to get wrong: data, security, limits, error handling, structure.

Pick 3 when there are enough good ones, otherwise 2. With a single decision, ask about that one.
Never ask about a decision whose origin is `dev` only to fill the count: the developer made that choice themself.

## Step 3: Ask, one at a time

For each picked decision:

1. Write one question. Say **what** was decided and **where** (file and function). Ask **why**: why this way,
   what the other option was, or what would go wrong with the other way. **Do not give the reason or the
   alternatives away**; they are in the decision's `summary` and `alternatives`. One question, plain words, no code.
2. Call `ask_question` with the session id, the `decision_id`, the exact question text, and `item_id` when the
   decision has no ladder item but one clearly fits (for example `BE.ERR.M2` for handling a failed outside call).
   If it is refused because the decision has no item and none fits, ask the question anyway, give feedback, and
   say this answer is not saved.
3. Ask the question and wait. The developer's next message is saved as the answer by a hook.
   "I don't know" is a valid answer. If they say "skip" or "later", move on: nothing is rated.

## Step 4: Rate it

Call `rate_answer` with the `question_id` and a rating:

| Rating | When |
|---|---|
| `clear` | They give the real reason, and it shows they know what the other option would cost. |
| `partial` | The reason is right but thin, or they miss the trade-off, or part of it is wrong. |
| `not_yet` | They cannot say why, or the reason given is not the reason. |

Only if the answer names the trade-off, copy those exact words from it into `tradeoff_quote`.
Rate what they said, not what they probably meant. Do not round up to be nice: a wrong "clear" hides the
exact gap this tool exists to find. A different reason that is also valid counts as `clear`.

## Step 5: Feedback, then move on

Tell the developer the rating in a few words. For `partial` or `not_yet`, give the missing piece in one or two
sentences. Then ask the next question.

## Step 6: Wrap up

Show a short table: decision, rating. Add one line on what to look at again, if anything.
Say that the answers are saved on this machine only, and that `/devgym:grow` shows how they count.
