// "grow open": make sure the local server is running, then open the Grow report in the browser.
import { spawn } from "node:child_process";
import type { Server } from "node:http";
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import type { PrivacyGuard } from "../privacy/guard.js";
import { API_HOST, createApiServer, DEFAULT_API_PORT, listen } from "./server.js";
import { reportPath } from "./static.js";

export interface ReportOptions {
  db: Db;
  guard: PrivacyGuard;
  port?: number | undefined;
  webDir?: string | undefined;
  growRoot?: string | undefined;
  allowedOrigins?: string[] | undefined;
  /** Opens a URL in the developer's browser. Replaced in tests. */
  openUrl?: ((url: string) => void) | undefined;
}

export interface OpenReportResult {
  url: string;
  /** True when this call started the server. False when one was already running. */
  started: boolean;
  /** True when the browser was asked to open the page. */
  opened: boolean;
}

/** Asks the operating system to open a URL in the default browser. Does not wait for it. */
export function openInBrowser(url: string): void {
  // The URL is always built here from 127.0.0.1, a port number and a fixed path. Nothing in it comes from stored text.
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command as string, args as string[], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {}); // No browser opener on this machine: the caller still gets the URL to show.
  child.unref();
}

/** True when our own API already answers on this port (for example from another Claude Code session). */
async function isOurApi(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${API_HOST}:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok && ((await response.json()) as { status?: string }).status === "ok";
  } catch {
    return false;
  }
}

export class ReportServer {
  private server: Server | undefined;
  private port: number | undefined;

  constructor(private readonly options: ReportOptions) {}

  /** Starts the local server if needed, and returns the address of the Grow report. */
  async open(openBrowser = true): Promise<OpenReportResult> {
    const { started, port } = await this.ensureRunning();
    const url = `http://${API_HOST}:${port}${reportPath(this.options.webDir)}`;
    if (openBrowser) (this.options.openUrl ?? openInBrowser)(url);
    return { url, started, opened: openBrowser };
  }

  private async ensureRunning(): Promise<{ started: boolean; port: number }> {
    if (this.port !== undefined) return { started: false, port: this.port };
    const wanted = this.options.port ?? DEFAULT_API_PORT;
    const create = () =>
      createApiServer({
        db: this.options.db,
        guard: this.options.guard,
        webDir: this.options.webDir,
        growRoot: this.options.growRoot,
        allowedOrigins: this.options.allowedOrigins ?? [],
      });
    let server = create();
    try {
      this.port = await listen(server, wanted);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      // Another session of ours already serves the same local data: use it.
      if (await isOurApi(wanted)) {
        this.port = wanted;
        return { started: false, port: wanted };
      }
      // Something else has the port. Take any free one.
      server = create();
      try {
        this.port = await listen(server, 0);
      } catch {
        throw new StoreError(`Could not start the local server: port ${wanted} is in use and no other port could be opened.`);
      }
    }
    this.server = server;
    return { started: true, port: this.port };
  }

  close(): void {
    this.server?.close();
    this.server = undefined;
    this.port = undefined;
  }
}
