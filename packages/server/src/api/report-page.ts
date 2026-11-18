// The built-in Grow report page. The local server shows it until the full web app
// (packages/web) is shipped inside the plugin. It is plain HTML and one small script,
// served from this server, so it needs no build step and no files on disk.

export const REPORT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grow report</title>
<style>
  :root { --bg:#f7f7f5; --card:#ffffff; --text:#1f2328; --muted:#5b636d; --line:#d9dce0; --accent:#1f5fbf; --warn-bg:#fff4d6; --warn:#7a5200; --bad:#a3261d; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16181c; --card:#1f2228; --text:#e6e8eb; --muted:#9aa3ad; --line:#353a42; --accent:#7fb0ff; --warn-bg:#4a3a10; --warn:#ffd97a; --bad:#ff9d94; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:760px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:1.6rem; margin:0 0 4px; }
  h2 { font-size:1.15rem; margin:0 0 8px; }
  h3 { font-size:.8rem; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); margin:16px 0 6px; }
  p { margin:0 0 8px; }
  .muted { color:var(--muted); font-size:.9rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-top:16px; }
  .badge { display:inline-block; font-size:.75rem; font-weight:600; padding:2px 8px; border-radius:999px; background:var(--warn-bg); color:var(--warn); margin-left:8px; vertical-align:middle; }
  ul { margin:0; padding-left:20px; }
  li { margin-bottom:6px; }
  .note { border-left:3px solid var(--line); padding:4px 0 4px 10px; margin-bottom:6px; }
  .note.disagrees { border-left-color:var(--bad); }
  .note b { color:var(--bad); }
  textarea { width:100%; min-height:64px; padding:8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--text); font:inherit; }
  label.check { display:inline-flex; align-items:center; gap:6px; margin:8px 12px 0 0; }
  button { margin-top:8px; padding:6px 14px; border:1px solid var(--accent); border-radius:6px; background:var(--accent); color:#fff; font:inherit; cursor:pointer; }
  button:disabled { opacity:.6; cursor:default; }
  .error { color:var(--bad); margin-top:6px; }
</style>
</head>
<body>
<main>
  <h1>Grow report</h1>
  <p class="muted">Private to you. Stored on this machine only and never shared.</p>
  <div id="report" aria-live="polite"><p class="muted">Loading…</p></div>
</main>
<script src="/report.js"></script>
</body>
</html>
`;

// Everything is written with textContent, never innerHTML: stored text is shown as text, not run as markup.
export const REPORT_JS = `"use strict";
(function () {
  var root = document.getElementById("report");

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function message(text, className) {
    root.replaceChildren(el("p", className || "muted", text));
  }
  var RATING = { clear: "explained clearly", partial: "partly explained", not_yet: "not explained yet" };
  var ORIGIN = { ai: "AI chose", dev: "developer chose", dev_changed_ai: "developer changed the AI's choice" };

  function evidenceLine(observation) {
    var item = el("li", "", observation.summary);
    var parts = [];
    (observation.evidence || []).forEach(function (e) {
      if (e.kind === "explain_back") parts.push("explanation on " + e.ticket_id + ": " + (RATING[e.rating] || e.rating));
      if (e.kind === "decision") parts.push("decision on " + e.ticket_id + ": " + (ORIGIN[e.origin] || e.origin));
    });
    if (parts.length) item.appendChild(el("div", "muted", "Based on " + parts.join("; ")));
    return item;
  }

  function noteForm(area) {
    var form = el("form");
    var box = el("textarea");
    box.setAttribute("aria-label", "Your note on this claim");
    box.maxLength = 2000;
    box.placeholder = "Add a note. Words only, no code.";
    var check = el("label", "check");
    var tick = el("input");
    tick.type = "checkbox";
    check.appendChild(tick);
    check.appendChild(document.createTextNode("I disagree with this claim"));
    var send = el("button", "", "Save note");
    send.type = "submit";
    var error = el("div", "error");
    error.setAttribute("role", "alert");
    form.append(box, check, send, error);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var note = box.value.trim();
      if (!note) { error.textContent = "Write a note first."; return; }
      send.disabled = true;
      error.textContent = "";
      fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: area.id, note: note, disagrees: tick.checked })
      }).then(function (response) {
        return response.json().then(function (body) { return { ok: response.ok, body: body }; });
      }).then(function (result) {
        if (!result.ok) throw new Error((result.body.error && result.body.error.message) || "The note was not saved.");
        load();
      }).catch(function (problem) {
        send.disabled = false;
        error.textContent = problem.message;
      });
    });
    return form;
  }

  function areaCard(area, index) {
    var card = el("section", "card");
    var title = el("h2", "", "Focus area " + (index + 1));
    if (area.tentative) {
      var badge = el("span", "badge", "Tentative");
      badge.title = "This claim rests on a single observation, so it may be wrong.";
      title.appendChild(badge);
    }
    card.appendChild(title);
    card.appendChild(el("p", "", area.claim));
    if (area.tentative) card.appendChild(el("p", "muted", "Based on one observation only. Treat it as a first sign."));

    card.appendChild(el("h3", "", "Evidence"));
    var list = el("ul");
    (area.evidence || []).forEach(function (o) { list.appendChild(evidenceLine(o)); });
    if (!list.children.length) list.appendChild(el("li", "muted", "The evidence for this claim was deleted."));
    card.appendChild(list);

    card.appendChild(el("h3", "", "Exercise"));
    card.appendChild(el("p", "", area.exercise));

    card.appendChild(el("h3", "", "Your notes"));
    (area.annotations || []).forEach(function (a) {
      var note = el("div", a.disagrees ? "note disagrees" : "note");
      if (a.disagrees) { note.appendChild(el("b", "", "I disagree. ")); }
      note.appendChild(document.createTextNode(a.note));
      card.appendChild(note);
    });
    card.appendChild(noteForm(area));
    return card;
  }

  function render(plan) {
    if (!plan) {
      message("No growth plan yet. Run the grow command in Claude Code, then reload this page.");
      return;
    }
    var nodes = [el("p", "muted", "Plan made " + plan.created_at + " UTC · " + plan.focus_areas.length + " focus area" + (plan.focus_areas.length === 1 ? "" : "s"))];
    plan.focus_areas.forEach(function (area, index) { nodes.push(areaCard(area, index)); });
    root.replaceChildren.apply(root, nodes);
  }

  function load() {
    fetch("/api/growth-plan").then(function (response) {
      if (!response.ok) throw new Error("The local service answered " + response.status + ".");
      return response.json();
    }).then(function (body) {
      render(body.growth_plan);
    }).catch(function (problem) {
      message("Could not load the report. " + problem.message + " Is the local service still running?", "error");
    });
  }
  load();
})();
`;
