// Bundles the MCP server and the edit hook into single files inside the plugin folder.
// An installed plugin only gets packages/plugin, so this code must live there with no node_modules.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "plugin", "server");

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  legalComments: "none",
  // Some bundled CommonJS code calls require() for Node built-ins. ESM has no require, so give it one.
  banner: {
    js: "import { createRequire as __ftcCreateRequire } from 'node:module';\nconst require = __ftcCreateRequire(import.meta.url);",
  },
};

await build({ ...shared, entryPoints: [join(here, "src", "mcp", "stdio.ts")], outfile: join(out, "index.mjs") });
// The hook runs on every file edit, so it is a separate small file without the MCP library.
await build({ ...shared, entryPoints: [join(here, "src", "hook", "post-tool-use.ts")], outfile: join(out, "hook.mjs") });
// The prompt hook runs on every message the developer sends: it saves the answer to an open Coach question.
await build({ ...shared, entryPoints: [join(here, "src", "hook", "prompt-submit.ts")], outfile: join(out, "prompt.mjs") });
// The session hook is tiny: it only decides whether to start the background worker and whether to add one line.
await build({ ...shared, entryPoints: [join(here, "src", "hook", "session-hook.ts")], outfile: join(out, "session.mjs") });
// The background worker reads commits after a session starts or ends, so Coach stays current on its own.
await build({ ...shared, entryPoints: [join(here, "src", "hook", "background.ts")], outfile: join(out, "background.mjs") });
// The REST API for the local web app. Uses only Node's own http module.
await build({ ...shared, entryPoints: [join(here, "src", "api", "main.ts")], outfile: join(out, "api.mjs") });

// tree-sitter runs as WebAssembly, so it needs no native build. The .wasm files cannot be
// inlined into the bundle, so they are copied next to it (see wasmPath in src/pointers/symbols.ts).
const wasm = [
  ["web-tree-sitter", "web-tree-sitter.wasm"],
  ["tree-sitter-typescript", "tree-sitter-typescript.wasm"],
  ["tree-sitter-typescript", "tree-sitter-tsx.wasm"],
  ["tree-sitter-javascript", "tree-sitter-javascript.wasm"],
];
mkdirSync(join(out, "wasm"), { recursive: true });
for (const [pkg, file] of wasm) copyFileSync(join(here, "node_modules", pkg, file), join(out, "wasm", file));

console.log("Bundled -> packages/plugin/server/index.mjs, hook.mjs, prompt.mjs, api.mjs, wasm/");
