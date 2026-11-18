// Serves the pages of the local web app: the built app when it ships with the plugin,
// otherwise the small built-in Grow report.
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { REPORT_HTML, REPORT_JS } from "./report-page.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

// The built-in page loads nothing from anywhere else, so the browser is told to refuse anything that tries.
const STRICT_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extra,
  });
  res.end(body);
}

/** True when a built web app is there to serve. */
export function hasWebApp(webDir: string | undefined): webDir is string {
  return webDir !== undefined && existsSync(join(webDir, "index.html"));
}

/** Where the Grow report lives: a route of the web app, or the built-in page. */
export function reportPath(webDir: string | undefined): string {
  return hasWebApp(webDir) ? "/#/grow" : "/";
}

export async function servePage(res: ServerResponse, pathname: string, webDir: string | undefined): Promise<void> {
  if (!hasWebApp(webDir)) {
    if (pathname === "/" || pathname === "/index.html") return send(res, 200, TYPES[".html"] as string, REPORT_HTML, { "Content-Security-Policy": STRICT_CSP });
    if (pathname === "/report.js") return send(res, 200, TYPES[".js"] as string, REPORT_JS);
    return send(res, 404, "text/plain; charset=utf-8", "Not found");
  }

  const root = resolve(webDir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, "text/plain; charset=utf-8", "Bad request");
  }
  const file = resolve(root, `.${normalize(`/${decoded}`)}`);
  // Never read outside the web folder, whatever the path says.
  if (file !== root && !file.startsWith(root + sep)) return send(res, 404, "text/plain; charset=utf-8", "Not found");

  const info = await stat(file).catch(() => null);
  if (info?.isFile()) {
    return send(res, 200, TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", await readFile(file));
  }
  // A path with no file extension is a page of the app: let the app's own router handle it.
  if (extname(file) === "") return send(res, 200, TYPES[".html"] as string, await readFile(join(root, "index.html")));
  return send(res, 404, "text/plain; charset=utf-8", "Not found");
}
