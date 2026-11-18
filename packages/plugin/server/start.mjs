// Entry point for everything the plugin runs with Node:
//   node start.mjs        the MCP server (Claude Code starts this)
//   node start.mjs hook   the edit hook
//   node start.mjs prompt the prompt hook (saves the answer to an open Coach question)
//   node start.mjs api    the REST API for the local web app
// It checks the Node version first, so an old Node gives a clear message instead of a crash.
const FILES = { mcp: "./index.mjs", hook: "./hook.mjs", prompt: "./prompt.mjs", session: "./session.mjs", background: "./background.mjs", api: "./api.mjs" };
const mode = Object.hasOwn(FILES, process.argv[2] ?? "") ? process.argv[2] : "mcp";
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  // A hook must never block the developer's work, so on an old Node it just does nothing.
  if (mode === "hook" || mode === "prompt" || mode === "session" || mode === "background") process.exit(0);
  console.error(
    `fork-trail-coach needs Node 22 or newer (found ${process.versions.node}). Install Node 22+ and restart Claude Code.`,
  );
  process.exit(1);
}
// The built-in SQLite module prints an "experimental" warning on some Node 22 versions. Hide only that one.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes("SQLite is an experimental feature")) return;
  return emitWarning.call(process, warning, ...rest);
};
await import(FILES[mode]);
