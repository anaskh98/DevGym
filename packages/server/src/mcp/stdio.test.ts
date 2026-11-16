import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Starts the bundled server that ships in the plugin, as a real child process, the way Claude Code does.
// Run "pnpm build" first: the test is skipped when the bundle is missing.
const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugin", "server", "start.mjs");

it.skipIf(!existsSync(entry))("serves tools over stdio from the built file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ftc-stdio-"));
  const dbPath = join(dir, "test.sqlite");
  // Empty database: the ticket must come from the demo tickets shipped in the plugin.
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entry],
        env: { ...(process.env as Record<string, string>), FTC_DB_PATH: dbPath, FTC_TICKETS_DIR: join(dir, "none") },
        stderr: "ignore",
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(10);
    const result = await client.callTool({ name: "get_ticket", arguments: { ticket_id: "SAMPLE-1" } });
    expect(result.isError).toBeFalsy();
    expect((result.content as { text: string }[])[0]?.text).toContain("SAMPLE-1");
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
