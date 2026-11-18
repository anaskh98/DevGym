# Local REST API

The web app reads and writes the developer's local profile through this API. The schemas in
`packages/shared/src/api.ts` describe every answer; `packages/server/src/api/contract.test.ts` checks the
real answers against them, so the web app and the API cannot drift apart without a failing test.

- Base URL: `http://127.0.0.1:4317/api` (set `DEVGYM_PORT` to change the port)
- Start it: `corepack pnpm build`, then `corepack pnpm api`
- JSON in, JSON out. Dates are UTC strings like `2026-11-16 11:05:58`.

## Safety rules the client must follow

- The server listens on `127.0.0.1` only.
- A request with a body must send `Content-Type: application/json`.
- Browser calls are accepted from the API's own origin and from the web app dev server
  (`http://127.0.0.1:4318` and `http://localhost:4318`). Set `DEVGYM_WEB_ORIGIN` (comma-separated) for other origins.
- Any other `Origin` or `Host` gets `403`.

## Errors

Error answers carry the same CORS header as successful ones, so the web app can show the `message`.

Every error has the same shape:

```json
{ "error": { "code": "not_found", "message": "Ticket 'X' does not exist" } }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_input`, `bad_json` | The body is wrong. `message` names the field. |
| 403 | `bad_origin`, `bad_host` | The call did not come from the local web app. |
| 404 | `not_found` | No such route, ticket, annotation, or note target. |
| 413 | `too_large` | Body over 64 KB. |
| 415 | `unsupported_media_type` | Body not sent as `application/json`. |
| 422 | `privacy_guard` | The note looks like code, a secret, or names a client. Also has `field` and `rule`. Show `message` to the user. |

## Endpoints

### `GET /health`

`{ "status": "ok", "counts": { "tickets": 1, "decisions": 4, ... } }`

`counts` has one number per table. Use it for the "My data" page.

### `GET /tickets`

```json
{ "tickets": [ { "id": "DEMO-1", "title": "...", "source": "markdown", "created_at": "...",
                 "assumption_count": 5, "decision_count": 4 } ] }
```

### `GET /tickets/:id`

Everything for the Clarify view and the Track view.

```json
{
  "ticket": { "id": "DEMO-1", "title": "...", "body": "...", "source": "markdown", "created_at": "..." },
  "assumptions": [
    { "id": "...", "text": "What does 'recent orders' mean?", "status": "answered_by_po", "answer": "Last 90 days.", "created_at": "..." },
    { "id": "...", "text": "What file format?", "status": "assumed_by_dev", "answer": "Assuming: CSV.", "created_at": "..." }
  ],
  "decisions": [
    {
      "id": "...", "ticket_id": "DEMO-1", "session_id": "...", "created_at": "...",
      "summary": "Export is produced one page at a time...",
      "alternatives": ["Build the whole export in memory"],
      "origin": "ai",
      "related_files": ["src/export.test.ts"],
      "pointer": {
        "id": "...", "repo": "owner/name", "pr_number": null, "file_path": "src/export.ts",
        "symbol": "exportOrders", "commit": null, "line_hint": 14, "url": null,
        "resolved": null, "resolve_note": null
      },
      "explain_backs": [ { "id": "...", "question": "...", "answer": "...", "rating": "clear", "created_at": "..." } ],
      "annotations": []
    }
  ],
  "sessions": [
    { "session_id": "...", "started_at": "...",
      "edited_files": [ { "file_path": "src/export.ts", "edit_count": 2, "explained": true } ],
      "unexplained_files": [".gitignore"] }
  ]
}
```

Field values:

- `assumptions[].status`: `answered_by_po` or `assumed_by_dev`
- `decisions[].origin`: `ai`, `dev` or `dev_changed_ai`
- `explain_backs[].rating`: `clear`, `partial` or `not_yet`
- `pointer` is `null` when a decision has no code location.
- `pointer.url` is a GitHub link pinned to a commit. It is `null` until the pointer has a commit: show
  "not linked yet" then.
- `pointer.resolved` is the last resolve check: `true` means the pointer finds its code at `commit`,
  `false` means it is broken and `resolve_note` says why (show the "broken pointer" state), `null` means never checked.
- `pointer.symbol` is the function the server found around the line, for example `Exporter.run` for a method.
- `sessions[].unexplained_files`: files the session edited that no decision points at.

### `GET /tickets/:id/decisions`

`{ "decisions": [ ... ] }` with the same decision shape as above.

### `GET /grow`

The growth dashboard (schema: `GrowDashboard` in `@devgym/shared`). Read only: it reads the database and the ladder, never git or the AI, so it is fast. The background worker keeps the data fresh.

- `areas[]`: each ladder area with its `level`, `working_toward` and **`exposure`** (none, low, medium, high). Each item has its **`state`** (`not_seen`, `not_assessed`, `learning`, `shown`, `proven`) and its own `exposure`, kept apart: low exposure is never low skill. `shown_by` says whether Shown came from the work or from drills. `why_it_matters`, `needs`, `evidence[]` (the proofs and faults behind the state, newest first, up to 12, no code) and `drills[]`.
- `repeats[]`: the same mistake on 3 or more tickets, newest first. `coming_back: false` means nothing new in 60 days.
- `open_faults[]`, `ready_for_assessment[]`, `next_actions[]`, `drill_results[]`, `recent_changes[]` (up or down, with the reason).

Everything here is personal profile data and stays on this machine.

### `GET /growth-plan`

The newest plan, or `{ "growth_plan": null }` when there is none yet.

```json
{
  "growth_plan": {
    "id": "...", "developer_id": "local", "created_at": "...",
    "focus_areas": [
      {
        "id": "...",
        "claim": "One answer suggests a strength in performance.",
        "tentative": true,
        "exercise": "On the next ticket, write down the cost of your approach.",
        "evidence": [
          { "id": "...", "skill_tag": "performance", "summary": "Explained that paging keeps memory flat.", "created_at": "...",
            "evidence": [
              { "id": "...", "kind": "decision", "ticket_id": "DEMO-1", "origin": "ai" },
              { "id": "...", "kind": "explain_back", "ticket_id": "DEMO-1", "rating": "clear" }
            ] }
        ],
        "annotations": [ { "id": "...", "target_id": "...", "note": "I disagree", "disagrees": true, "created_at": "..." } ]
      }
    ]
  }
}
```

- `tentative` is set by the server: `true` when the claim rests on one observation.
- To add a note to a claim, use the focus area's `id` as `target_id`.

### `POST /annotations`

Body: `{ "target_id": "<id>", "note": "1 to 2000 characters", "disagrees": false }` (`disagrees` is optional)

`target_id` can be the id of a growth-plan focus area, a decision, an assumption, an explanation, an observation, a growth plan, or a ticket.

Returns `201` with `{ "annotation": { "id", "target_id", "note", "disagrees", "created_at" } }`.

### `DELETE /annotations/:id`

Returns `204`, or `404` when the note does not exist.

### `GET /eval`

The results file `pnpm eval` writes (`eval-results.json` next to the database; `DEVGYM_EVAL_RESULTS` overrides it),
served as it is. `404` until an evaluation has been run. Shape: `EvalResults` in `packages/shared/src/api.ts`.
It holds scores, not profile data.

### `GET /export`

The whole profile as a download.

```json
{ "exported_at": "2026-11-16T11:05:58.000Z", "counts": { "tickets": 1, ... },
  "data": { "tickets": [...], "assumptions": [...], "pointers": [...], "decisions": [...], "trail_sessions": [...],
            "file_edits": [...], "explain_backs": [...], "observations": [...], "growth_plans": [...], "annotations": [...] } }
```

`data` holds every stored row. `counts[table]` always equals `data[table].length`.

### `DELETE /data`

Deletes every stored row. The body must be exactly `{ "confirm": "delete-all" }`, otherwise nothing happens (`400`).

Returns `{ "deleted": { "tickets": 1, "decisions": 4, ... } }`. After this, `GET /export` returns empty lists.
