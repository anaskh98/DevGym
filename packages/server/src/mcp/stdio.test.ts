import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  // The server's working folder is the developer's project.
  const project = join(dir, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "orders.ts"), "export class Pager {\n  next() {\n    return 1;\n  }\n}\n");

  // Empty database: the ticket must come from the demo tickets shipped in the plugin.
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  const text = (result: Awaited<ReturnType<Client["callTool"]>>) => (result.content as { text: string }[])[0]?.text ?? "";
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entry],
        cwd: project,
        env: { ...(process.env as Record<string, string>), FTC_DB_PATH: dbPath, FTC_TICKETS_DIR: join(dir, "none") },
        stderr: "ignore",
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(20);
    const ticket = await client.callTool({ name: "get_ticket", arguments: { ticket_id: "SAMPLE-1" } });
    expect(ticket.isError).toBeFalsy();
    expect(text(ticket)).toContain("SAMPLE-1");

    // The bundled server must find its tree-sitter .wasm files to name the function around a line.
    const logged = await client.callTool({
      name: "log_decision",
      arguments: {
        ticket_id: "SAMPLE-1",
        session_id: "s1",
        summary: "Page through results one at a time",
        origin: "ai",
        pointer: { repo: "team/demo", file_path: "src/orders.ts", line_hint: 3 },
      },
    });
    expect(logged.isError, text(logged)).toBeFalsy();
    const trail = JSON.parse(text(await client.callTool({ name: "get_trail", arguments: { session_id: "s1" } })));
    expect(trail.decisions[0]).toMatchObject({ file_path: "src/orders.ts", symbol: "Pager.next" });
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
