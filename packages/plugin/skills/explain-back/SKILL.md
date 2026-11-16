---
name: explain-back
description: After coding a ticket, pick 2 or 3 logged decisions and ask the developer to explain why each was made, then save their answers with a rating. Use when the user runs /explain-back, finishes a ticket, or asks to be quizzed on or to explain the decisions in their work.
argument-hint: <ticket-id>
---

# Explain-back

The developer ships this code, so they should be able to explain it. You ask "why" about a few decisions,
they answer in their own words, and you save the answer with an honest rating.
This is practice, not an exam. Be direct and kind.

Ticket id: `$ARGUMENTS`
Session id: `${CLAUDE_SESSION_ID}`

All tools below are on the `fork-trail-coach` MCP server.

## Step 1: Find the decisions

If a ticket id was given, call `list_decisions` with it.
If not, call `get_trail` with the session id above and use its `ticket_id`. If that is empty too, ask for a ticket id and stop.

If the ticket has no decisions, say so, suggest running Paper Trail while coding, and stop.

## Step 2: Pick 2 or 3

Pick the decisions where understanding matters most. Prefer, in this order:

1. Decisions with `explain_back_count` of 0.
2. Origin `ai`: Claude chose it, so the developer may not know why.
3. Decisions that would be costly to get wrong: data, security, limits, error handling, structure.

Pick 3 when there are enough good ones, otherwise 2. With a single decision, ask about that one.
Never ask about a decision whose origin is `dev` only to fill the count: the developer made that choice themself.

## Step 3: Ask, one at a time

For each picked decision, ask one question and wait for the answer before the next.

- Say **what** was decided and **where** (file and function).
- Ask **why**: why this way, what the other option was, or what would go wrong with the other way.
- **Do not give the reason or the alternatives away.** They are in the decision's `summary` and `alternatives`.
  Rephrase so the question does not contain its own answer.
- One question. Plain words. No code.

The developer may answer "I don't know". That is a valid answer. If they say "skip", skip that decision and save nothing for it.

## Step 4: Rate the answer

Compare the answer with the decision's summary and alternatives:

| Rating | When |
|---|---|
| `clear` | They give the real reason, and it shows they know what the other option would cost. |
| `partial` | The reason is right but thin, or they miss the trade-off, or part of it is wrong. |
| `not_yet` | They cannot say why, or the reason given is not the reason. |

Rate what they said, not what they probably meant. Do not round up to be nice: a wrong "clear" hides the
exact gap this tool exists to find. A different reason that is also valid counts as `clear`.

## Step 5: Save it

Call `record_explain_back` with:

- `decision_id`: the decision's id.
- `question`: the question you asked.
- `answer`: the developer's answer in their own words. Trim it, do not improve it.
- `rating`: your rating.

If the privacy guard rejects the answer (for example it holds code or a client name), save a faithful
plain-words version of what they said, and tell them you did.

Then call `save_observation` once for the answer:

- `skill_tag`: the skill the decision exercises, lowercase with dashes, for example `error-handling`, `data-modeling`, `api-design`, `performance`, `security`, `testing`.
- `summary`: one neutral sentence on what the answer showed. Describe the understanding, not the person.
  Good: "Explained why paging keeps memory flat, but not why the row limit exists."
- `evidence_ids`: the decision id and the explain-back id.

## Step 6: Give feedback, then move on

Tell the developer the rating in a few words. For `partial` or `not_yet`, give the missing piece in one or two
sentences. Then ask the next question.

## Step 7: Wrap up

Show a short table: decision, rating. Add one line on what to look at again, if anything.
Say that the answers are saved on this machine only.
