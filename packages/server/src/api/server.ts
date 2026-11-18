// REST API for the local web app. It serves the developer's private profile, so it only listens on
// 127.0.0.1 and refuses requests that a web page on another site could send.
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defaultDbPath, type Db } from "../db/connection.js";
import { PrivacyError, StoreError } from "../errors.js";
import type { PrivacyGuard } from "../privacy/guard.js";
import { growDashboard } from "../grow/dashboard.js";
import * as data from "./data.js";
import { servePage } from "./static.js";

export const API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 4317;
const MAX_BODY_BYTES = 64 * 1024;

export interface ApiOptions {
  db: Db;
  guard: PrivacyGuard;
  /** Extra browser origins that may call the API, for example the Vite dev server. */
  allowedOrigins?: string[];
  /** Folder with the built web app. When it is missing, the built-in Grow report page is served. */
  webDir?: string | undefined;
  /** The results file the eval harness writes. Defaults to defaultEvalResultsPath(). */
  evalFile?: string | undefined;
  /** The project folder the Grow dashboard reads its ladder from. Defaults to the current folder. */
  growRoot?: string | undefined;
  /** Home folder for the developer-level ladder file (tests change it). */
  growHome?: string | undefined;
}

/** The eval results live next to the local database, outside any repo. DEVGYM_EVAL_RESULTS overrides the path. */
export function defaultEvalResultsPath(): string {
  return process.env.DEVGYM_EVAL_RESULTS ?? join(dirname(defaultDbPath()), "eval-results.json");
}

const annotationInput = z.strictObject({
  target_id: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1).max(2000),
  disagrees: z.boolean().default(false),
});
const deleteAllInput = z.strictObject({ confirm: z.literal("delete-all") });

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  // Requiring JSON makes a browser ask permission (a CORS preflight) before a cross-site page can post.
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
    throw new HttpError(415, "unsupported_media_type", "Send the body as application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "Request body is too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_json", "Request body is not valid JSON");
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, "invalid_input", `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
  }
  return result.data;
}

export function createApiServer(options: ApiOptions): Server {
  const { db, guard } = options;
  const extraOrigins = new Set(options.allowedOrigins ?? []);

  const ownOrigins = () => {
    const port = (server.address() as AddressInfo).port;
    return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  };
  /** CORS headers for a caller we accept. Errors need them too, or the web app cannot read why a call failed. */
  const corsFor = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin;
    if (origin === undefined || (!ownOrigins().includes(origin) && !extraOrigins.has(origin))) return {};
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const cors = corsFor(req);
      if (err instanceof HttpError) {
        send(res, err.status, { error: { code: err.code, message: err.message, ...err.extra } }, cors);
      } else if (err instanceof PrivacyError) {
        send(res, 422, { error: { code: "privacy_guard", message: err.message, field: err.field, rule: err.rule } }, cors);
      } else if (err instanceof StoreError) {
        send(res, 404, { error: { code: "not_found", message: err.message } }, cors);
      } else {
        console.error(err);
        send(res, 500, { error: { code: "internal", message: "Internal error" } }, cors);
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const own = ownOrigins();

    // The Host header must be this server. This stops a hostile site that points its own domain
    // name at 127.0.0.1 (DNS rebinding) from reading the profile.
    if (!own.includes(`http://${req.headers.host ?? ""}`)) {
      throw new HttpError(403, "bad_host", "This API only answers on 127.0.0.1");
    }
    // Browsers name the calling page in Origin. Only the local web app may call.
    const cors = corsFor(req);
    if (req.headers.origin !== undefined && cors["Access-Control-Allow-Origin"] === undefined) {
      throw new HttpError(403, "bad_origin", "This origin may not call the API");
    }
    const method = req.method ?? "GET";
    if (method === "OPTIONS") {
      send(res, 204, undefined, {
        ...cors,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      return;
    }

    const url = new URL(req.url ?? "/", own[0]);
    // Anything outside /api is a page or a file of the web app.
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
      if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "method_not_allowed", "Only GET is allowed here");
      await servePage(res, url.pathname, options.webDir);
      return;
    }
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    parts.shift();
    const route = `${method} /${parts.map((p, i) => (i % 2 === 1 ? ":id" : p)).join("/")}`;
    const id = parts[1] ?? "";
    const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      send(res, status, body, { ...cors, ...headers });
    const notFound = (what: string) => new HttpError(404, "not_found", `${what} '${id}' does not exist`);

    switch (route) {
      case "GET /health":
        return ok({ status: "ok", counts: data.countAll(db) });

      case "GET /tickets":
        return ok({ tickets: data.listTickets(db) });

      case "GET /tickets/:id": {
        const detail = data.ticketDetail(db, id);
        if (!detail) throw notFound("Ticket");
        return ok(detail);
      }

      case "GET /tickets/:id/decisions": {
        if (!data.ticketDetail(db, id)) throw notFound("Ticket");
        return ok({ decisions: data.ticketDecisions(db, id) });
      }

      case "GET /growth-plan":
        return ok({ growth_plan: data.latestGrowthPlan(db) });

      case "GET /grow":
        return ok(growDashboard(db, { root: options.growRoot ?? process.cwd(), ...(options.growHome ? { home: options.growHome } : {}) }));

      case "POST /annotations": {
        const input = parse(annotationInput, await readJson(req));
        guard.check(input); // A note is a write like any other.
        return ok({ annotation: data.addAnnotation(db, input) }, 201);
      }

      case "DELETE /annotations/:id":
        if (!data.deleteAnnotation(db, id)) throw notFound("Annotation");
        return ok(undefined, 204);

      case "GET /eval": {
        // Not profile data: the scores the eval harness wrote. The file is served as it is.
        let raw: string;
        try {
          raw = await readFile(options.evalFile ?? defaultEvalResultsPath(), "utf8");
        } catch {
          throw new HttpError(404, "not_found", "No evaluation has been run yet");
        }
        try {
          return ok(JSON.parse(raw));
        } catch {
          throw new HttpError(500, "bad_eval_file", "The eval results file is not valid JSON");
        }
      }
      case "GET /export":
        return ok(data.exportAll(db), 200, {
          "Content-Disposition": `attachment; filename="devgym-export-${new Date().toISOString().slice(0, 10)}.json"`,
        });

      case "DELETE /data": {
        // The body must say so on purpose. A stray DELETE does nothing.
        parse(deleteAllInput, await readJson(req));
        return ok({ deleted: data.deleteAll(db) });
      }

      default:
        throw new HttpError(404, "not_found", "Not found");
    }
  }

  return server;
}

/** Starts the API on 127.0.0.1 only. Resolves once it is listening. */
export function listen(server: Server, port: number = DEFAULT_API_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, API_HOST, () => resolve((server.address() as AddressInfo).port));
  });
}
