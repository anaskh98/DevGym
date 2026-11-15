# Roomly

A small service for booking meeting rooms with credits. Everything here is synthetic: the code, the data and the tickets exist only to demo and evaluate tooling.

```bash
npm install
npm test        # unit tests
npm run dev     # http://127.0.0.1:4000
```

## How it works

- **Members** belong to a workspace and may belong to one **team**. A member's role is `member` or `admin`.
- **Rooms** cost a number of credits per hour. Weekday office hours are peak time and cost more (`src/pricing.ts`).
- A **booking** reserves one room for a member, with optional attendees. It is paid when it is created, from the member's own wallet or from their team's wallet.
- **Notifications** go through `src/notifier.ts`, which keeps an outbox in memory.
- The **usage report** (`src/reports.ts`) totals bookings, hours and credits per room for a month. Finance uses it for invoicing.

Data is kept in memory (`src/store.ts`) and reset on restart.

## Conventions

**Time.** Every timestamp is an ISO-8601 string in UTC, and all comparisons are done in UTC. Clients convert for display. Use the injected `Clock`; never call `new Date()` in domain code.

**API.**

- The caller is identified by the `x-member-id` header.
- Reads are `GET`. Creating is `POST /<resource>`.
- A state change on an existing resource is `POST /<resource>/:id/<action>`, and returns the updated resource.
- Bookings are always returned through `toBookingResponse` (`src/app.ts`).

**Errors.** Throw `HttpError(status, code, message)` from `src/errors.ts`:

| Status | When |
| --- | --- |
| 400 | The request is malformed |
| 402 | Not enough credits |
| 403 | The caller is not allowed to do this |
| 404 | The resource does not exist |
| 409 | The request conflicts with the current state |

**Tests.** Every behaviour change comes with a test in `test/`.

## Tickets

Work items live in `tickets/` as Markdown files.
