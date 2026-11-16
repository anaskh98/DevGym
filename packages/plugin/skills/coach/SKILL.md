---
name: coach
description: Build a private growth plan for the developer from their saved observations, with 1 to 3 focus areas that each cite evidence and give one exercise. With the argument "open", open the saved report in the browser instead. Use when the user runs /coach, or asks for a growth plan, coaching, what to work on next, or to see or open their coach report.
argument-hint: "[open]"
---

# Coach

You write a short growth plan from what the developer's own work showed.
It is for the developer only. It is coaching, not a performance review, and it never leaves this machine.

Every claim must rest on saved observations. No evidence, no claim.

All tools below are on the `fork-trail-coach` MCP server.

Argument: `$ARGUMENTS`

## If the argument is `open`

Do only this, and do not build a new plan:

1. Call `open_report`. It starts the local server if needed and opens the report in the browser.
2. Tell the developer the address it returned, in one line, in case the browser did not come to the front.
3. Add one line: the page is served from this machine only, and it stops when this Claude Code session ends.

If the call fails, show the error and stop.

Otherwise, with no argument, build a plan with the steps below.

## Step 1: Read the observations

Call `list_observations`.

Each observation has a `skill_tag`, a `summary`, and `evidence`: the decisions (with `origin`) and
explain-backs (with `rating`) it came from.

If there are no observations, say so, suggest running Explain-back after a ticket, and stop. Save nothing.

Use only what `list_observations` returns. Do not judge the developer from this conversation, from the code,
or from anything else.

## Step 2: Find 1 to 3 focus areas

Group the observations by skill. Look for what repeats.

A focus area is one of:

- **A gap**: explain-backs rated `partial` or `not_yet` in the same skill.
- **A pattern in who decides**: for example, most decisions in a skill have origin `ai` and the developer could not explain them.
- **A strength to stretch**: `clear` ratings in a skill, with a harder next step.

Rules:

- Choose the 1 to 3 that matter most. One strong focus area beats three thin ones.
- Do not invent a weakness to fill the list. If the evidence only shows strengths, the plan is about stretching them.
- Do not use the same observation to prop up two different claims unless it truly shows both.
- Ignore evidence marked `missing`.

## Step 3: Write each focus area

- `claim`: one or two sentences on what the evidence shows. Be specific and fair. Describe the work, not the person.
  - Good: "In two tickets, the reason behind a limit or a fallback was not explained."
  - Bad: "You are weak at error handling."
  - When only one observation supports it, word it as a first sign: "One answer suggests...".
- `evidence_ids`: the ids of the **observations** that support the claim. Every one must really support it.
- `exercise`: one concrete thing to do on the next ticket, small enough to finish in under an hour.
  - Good: "Before coding the next ticket, write down the limit you would set and what should happen when it is hit. Compare with what gets built."
  - Bad: "Study error handling."

Words only. No code, no file contents, no client names.

## Step 4: Save

Call `save_growth_plan` once with the focus areas.

The server decides what is `tentative`: a claim resting on a single observation. You cannot set it.
If the call is rejected, read the reason and fix that part. Never drop evidence or pad it to get past the check.

## Step 5: Show the report

Use what the server returned. For each focus area show:

- The claim. Add **(tentative)** when the server marked it so, and say in a few words that it rests on one observation.
- The evidence: each observation's summary, in one line.
- The exercise.

Then, in one or two lines:

- Name one thing the evidence shows the developer does well, if there is one. Skip this if there is not.
- Say the plan is saved on this machine only and is not shared with anyone.
- Say they can disagree with any claim: a tentative one especially may simply be wrong.
- Say they can see the report in the browser, and add a note or "I disagree" to a claim, by running this command again with `open`.
