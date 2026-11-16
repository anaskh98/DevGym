// Bundles the MCP server and the edit hook into single files inside the plugin folder.
// An installed plugin only gets packages/plugin, so this code must live there with no node_modules.
import { build } from "esbuild";
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
// The REST API for the local web app. Uses only Node's own http module.
await build({ ...shared, entryPoints: [join(here, "src", "api", "main.ts")], outfile: join(out, "api.mjs") });
console.log("Bundled -> packages/plugin/server/index.mjs, hook.mjs, api.mjs");
