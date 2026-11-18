import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { PrivacyGuard } from "../privacy/guard.js";
import { ReportServer } from "./open.js";
import { REPORT_JS } from "./report-page.js";
import { createApiServer, listen } from "./server.js";

let db: Db;
let dir: string;
let guard: PrivacyGuard;
const servers: Server[] = [];
const reports: ReportServer[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "devgym-open-"));
  db = openDb(":memory:");
  migrate(db);
  guard = new PrivacyGuard({ root: dir, denylist: () => [] });
});
afterEach(async () => {
  for (const r of reports.splice(0)) r.close();
  for (const s of servers.splice(0)) await new Promise((resolve) => s.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function start(webDir?: string): Promise<number> {
  const server = createApiServer({ db, guard, webDir });
  servers.push(server);
  return listen(server, 0);
}

function get(port: number, path: string, headers: Record<string, string> = {}, method = "GET") {
  return new Promise<{ status: number; type: string; csp: string; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), csp: String(res.headers["content-security-policy"] ?? ""), body }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("built-in report page", () => {
  it("is served at / with its script, and the API still works beside it", async () => {
    const port = await start();
    const page = await get(port, "/");
    expect(page.status).toBe(200);
    expect(page.type).toContain("text/html");
    expect(page.body).toContain("<h1>Grow report</h1>");
    expect(page.body).toContain('<script src="/report.js"></script>');
    expect(page.csp).toContain("script-src 'self'");
    expect(page.csp).toContain("default-src 'none'");

    const script = await get(port, "/report.js");
    expect(script.type).toContain("text/javascript");
    expect(script.body).toBe(REPORT_JS);

    expect((await get(port, "/api/health")).status).toBe(200);
    expect((await get(port, "/nothing-here")).status).toBe(404);
    expect((await get(port, "/api")).status).toBe(404);
  });

  it("only shows stored text as text", () => {
    // The page must never build markup from stored text.
    expect(REPORT_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });

  it("keeps the local-only checks for pages too", async () => {
    const port = await start();
    expect((await get(port, "/", { Host: "evil.example" })).status).toBe(403);
    expect((await get(port, "/", {}, "POST")).status).toBe(405);
  });
});

describe("built web app", () => {
  let web: string;
  beforeEach(() => {
    web = join(dir, "web");
    mkdirSync(join(web, "assets"), { recursive: true });
    writeFileSync(join(web, "index.html"), "<!doctype html><title>Real app</title>");
    writeFileSync(join(web, "assets", "app.js"), "console.log('app')");
    writeFileSync(join(dir, "secret.txt"), "outside the web folder");
  });

  it("is served when it exists, with page paths falling back to index.html", async () => {
    const port = await start(web);
    expect((await get(port, "/")).body).toContain("Real app");
    const asset = await get(port, "/assets/app.js");
    expect(asset.type).toContain("text/javascript");
    expect(asset.body).toBe("console.log('app')");
    expect((await get(port, "/grow")).body).toContain("Real app");
    expect((await get(port, "/assets/missing.js")).status).toBe(404);
    expect((await get(port, "/report.js")).status).toBe(404);
  });

  it("never reads outside the web folder", async () => {
    const port = await start(web);
    for (const path of ["/../secret.txt", "/..%2Fsecret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/..%5Csecret.txt"]) {
      const res = await get(port, path);
      expect(res.body, path).not.toContain("outside the web folder");
    }
    expect((await get(port, "/%E0%A4%A")).status).toBe(400);
  });
});

describe("ReportServer", () => {
  function report(options: { port?: number; webDir?: string } = {}) {
    const opened: string[] = [];
    const r = new ReportServer({ db, guard, port: options.port ?? 0, webDir: options.webDir, openUrl: (url) => opened.push(url) });
    reports.push(r);
    return { r, opened };
  }
  const portOf = (url: string) => Number(new URL(url).port);

  it("starts the server once, opens the browser, and the page answers", async () => {
    const { r, opened } = report();
    const first = await r.open();
    expect(first).toMatchObject({ started: true, opened: true });
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(opened).toEqual([first.url]);
    expect((await get(portOf(first.url), "/")).body).toContain("Grow report");
    expect((await get(portOf(first.url), "/api/growth-plan")).body).toBe('{"growth_plan":null}');

    const second = await r.open();
    expect(second).toEqual({ url: first.url, started: false, opened: true });
    expect(opened).toHaveLength(2);
  });

  it("can start without opening the browser", async () => {
    const { r, opened } = report();
    expect(await r.open(false)).toMatchObject({ started: true, opened: false });
    expect(opened).toEqual([]);
  });

  it("points at the web app's grow page when the web app is shipped", async () => {
    const web = join(dir, "web");
    mkdirSync(web);
    writeFileSync(join(web, "index.html"), "<title>Real app</title>");
    const { r } = report({ webDir: web });
    expect((await r.open(false)).url).toMatch(/\/#\/grow$/);
  });

  it("reuses our own server when the port is already taken by it", async () => {
    const port = await start();
    const { r } = report({ port });
    expect(await r.open(false)).toEqual({ url: `http://127.0.0.1:${port}/`, started: false, opened: false });
  });

  it("moves to a free port when something else has the port", async () => {
    const { createServer } = await import("node:http");
    const other = createServer((_req, res) => res.end("not ours"));
    servers.push(other);
    const taken = await listen(other, 0);
    const { r } = report({ port: taken });
    const result = await r.open(false);
    expect(result.started).toBe(true);
    expect(portOf(result.url)).not.toBe(taken);
    expect((await get(portOf(result.url), "/api/health")).status).toBe(200);
  });
});
