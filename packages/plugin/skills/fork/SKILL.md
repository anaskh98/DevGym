---
name: fork
description: Finds the places where a ticket can be read in more than one way and each reading leads to different code, asks the product owner only those questions, and saves the result as assumptions tagged "answered by PO" or "assumed by dev". Use before coding a ticket, when the developer runs /ftc:fork, or asks what is unclear or ambiguous in a ticket.
argument-hint: "[ticket-id]"
allowed-tools: mcp__plugin_ftc_service__get_ticket mcp__plugin_ftc_service__save_assumptions Read Grep Glob AskUserQuestion
---

# Fork

A fork is a point in a ticket where two reasonable people would write different code. Find the forks, ask about those and nothing else, and record what was answered and what was assumed.

Ticket: `$ARGUMENTS`

If no ticket id was given, ask for one and stop until there is an answer.

## 1. Get the ticket

Call `get_ticket` with the ticket id. Use the tool even if the ticket file is visible in the repository: the call records the ticket in the local store, and later steps depend on that.

If the tool returns an error, show it to the developer and stop.

## 2. Read the code the ticket touches

Read enough of the repository to know what each reading of the ticket would change:

- the README and any conventions document, because they settle many questions
- the types, functions and tests the ticket will touch
- anything else that reads or writes the same data, such as reports, jobs and notifications

Stay inside the project folder. Do not read files outside it.

## 3. List the candidate forks

Go through the ticket line by line. For each phrase that could be read in more than one way, write down two to four concrete readings. State each reading as what the system would do, not as a vague theme.

Look especially for:

- a rule that says when something is allowed but not what happens otherwise
- a word with a loose everyday meaning and a strict technical one ("archive", "recent", "all users")
- a group of people or records whose members are not listed
- a second role or actor mentioned in passing, without their own rules
- data the ticket changes that something else in the code also reads

## 4. Keep only the real forks

Apply one test to each candidate: **would at least two of its readings lead to different code?** Different code means different behaviour a user can observe, a different data model, a different API contract, different permissions, or different tests.

Drop a candidate when any of these is true:

- The repository already settles it: a convention in the README, an existing type, an established pattern for the same kind of change.
- The ticket itself settles it elsewhere.
- Every reading leads to the same code.
- It is about naming, style, file layout or which library to use. Those are the developer's call, and the product owner would not notice the difference.
- It is a question about how to build it, not about what to build.

Merge candidates that are two sides of the same fork into one question.

A short list is a good result. Asking a question the repository already answers wastes the product owner's time and counts against the run. If no candidate survives, say so, save an empty list (step 7) and stop.

## 5. Ask

Tell the developer once, before the questions:

> Answer as the product owner where you know the answer. Skip a question, or say "assume", to leave it as an assumption.

Then ask one question per fork with AskUserQuestion, at most four questions per call, with as many calls as needed:

- Write the question for a product owner: plain words, no file names, no code.
- Offer the readings as the options, the most likely one first. Each option is a full sentence saying what the system would do, and makes sense read on its own, without the question or the other options.
- Do not add a "not sure" option. Skipping is how a question is left open.

If AskUserQuestion is not available, ask the same questions as a numbered list in plain text and wait for the reply.

## 6. Tag each fork

- **`answered_by_po`**: the developer gave an answer. Record the answer in their words. If they picked an option, record that option's text, not its letter or number.
- **`assumed_by_dev`**: the question was skipped, or the answer was "assume", "not sure" or similar. Choose the reading that best fits the ticket's intent and the existing code, and record it with a short reason.

The tag already says how each fork was settled. Do not repeat it in the answer: no "Assumed:", no "the question was skipped", no "the product owner said assume".

Never tag a fork `answered_by_po` unless a person actually answered it. An assumption that looks like an answer is the failure this skill exists to prevent.

## 7. Save

Call `save_assumptions` once, with the ticket id and the full list. For each fork:

| Field | Content |
| --- | --- |
| `text` | The question as it was asked |
| `readings` | The readings that were offered (at least two) |
| `status` | `answered_by_po` or `assumed_by_dev` |
| `answer` | The answer given, or the reading assumed with its reason |

Describe behaviour in words. Do not paste code into any field; refer to a file or function by name if needed.

If the tool rejects the input, fix what it names and call it again. Do not drop a fork to make the call pass.

## 8. Report and stop

Show a short table: question, tag, answer. Under it, list the `assumed_by_dev` items as the ones to confirm with the product owner before merge.

Do not start implementing the ticket. The developer decides when to begin.

## Example

A ticket in an invoicing app is titled *"Export invoices as CSV"* and says: *"Add an Export button to the invoice list. The file should contain the invoices with their amounts."*

| Candidate | Kept? | Why |
| --- | --- | --- |
| Every invoice, or only the ones matching the filters on screen? | Kept | Changes the query and the tests |
| Include voided invoices? | Kept | Changes which rows are written |
| Amounts as shown to customers, or in minor units as stored? | Kept | Changes the file's contents |
| CSV or XLSX? | Dropped | The ticket title says CSV |
| What should the endpoint be called? | Dropped | Naming; the README has a route convention |
| Which CSV library? | Dropped | How to build it, not what to build |
