---
name: status
description: Show that the Fork / Paper Trail / Coach plugin is installed and which parts are ready. Use when the user asks if the plugin works or what it can do.
---

Tell the user the plugin is installed, then list what is ready:

- `/fork-trail-coach:fork <ticket-id>` — ready. Finds the questions in a ticket that change the code and saves the assumption list.
- `/fork-trail-coach:paper-trail <ticket-id>` — ready. Logs each real choice made while coding the ticket, and flags edited files with no decision.
- `/fork-trail-coach:explain-back <ticket-id>` — ready. Asks the developer why 2 or 3 logged decisions were made, and saves the answers with a rating.
- `/fork-trail-coach:pr-decisions <ticket-id> [pr-number]` — ready. Adds the "Decisions" section to the pull request. Needs the GitHub CLI to update the PR.
- `/fork-trail-coach:pointers <ticket-id> [pr-number]` — ready. Moves the decision pointers to the pull request commit and checks each one still finds its code.
- `/fork-trail-coach:coach` — ready. Shows the developer's level per area on the backend or frontend ladder, from their own commits and answers, and a personal plan with exercises on real spots in their code.
- `/fork-trail-coach:coach drill <item-id>` — ready. An interview-style drill; passing it is what makes a skill item Proven.
- `/fork-trail-coach:coach open` — ready. Starts the local server and opens the Coach report in the browser.

Then check the local service: call `get_ticket` on the `fork-trail-coach` MCP server with ticket id `SAMPLE-1`.
If it works, say the local service is running. If the tool is missing or fails, say the local service is not
running and that it needs Node 22 or newer.

Then check Jira: if Atlassian connector tools such as `getJiraIssue` are available, say Fork can read Jira tickets by
their key. If not, say Fork reads only the plugin's Markdown tickets, and that connecting the Atlassian connector
adds Jira tickets. Do not call any Atlassian tool for this check.

Keep the answer to these lines. Do not invent features.
