import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Root of the monorepo, from packages/server/src/cli. */
export const REPO_ROOT = resolve(here, "../../../..");
export const DEMO_TICKETS_DIR = resolve(REPO_ROOT, "demo-repo/tickets");
/** The committed sample the web app shows by default. */
export const WEB_MOCK_DIR = resolve(REPO_ROOT, "packages/web/public/mock");
/** An export of your own database. Ignored by git. */
export const WEB_MOCK_LOCAL_DIR = resolve(REPO_ROOT, "packages/web/public/mock-local");
export const PLUGIN_BUNDLE = resolve(REPO_ROOT, "packages/plugin/dist/server.mjs");
/** Where the eval harness (EV-3) writes its results. Ignored by git. */
export const EVAL_RESULTS_FILE = resolve(REPO_ROOT, "packages/eval/results/latest.json");

/** Reads `--name value` from argv. */
export function flag(name: string, argv: string[] = process.argv.slice(2)): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

export function hasFlag(name: string, argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes(`--${name}`);
}
