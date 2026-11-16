// REST API for the local web app. It serves the developer's private profile, so it only listens on
// 127.0.0.1 and refuses requests that a web page on another site could send.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import type { Db } from "../db/connection.js";
import { PrivacyError, StoreError } from "../errors.js";
import type { PrivacyGuard } from "../privacy/guard.js";
import * as data from "./data.js";

export const API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 4317;
const MAX_BODY_BYTES = 64 * 1024;

export interface ApiOptions {
  db: Db;
  guard: PrivacyGuard;
  /** Extra browser origins that may call the API, for example the Vite dev server. */
  allowedOrigins?: string[];
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

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        send(res, err.status, { error: { code: err.code, message: err.message, ...err.extra } });
      } else if (err instanceof PrivacyError) {
        send(res, 422, { error: { code: "privacy_guard", message: err.message, field: err.field, rule: err.rule } });
      } else if (err instanceof StoreError) {
        send(res, 404, { error: { code: "not_found", message: err.message } });
      } else {
        console.error(err);
        send(res, 500, { error: { code: "internal", message: "Internal error" } });
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = (server.address() as AddressInfo).port;
    const own = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

    // The Host header must be this server. This stops a hostile site that points its own domain
    // name at 127.0.0.1 (DNS rebinding) from reading the profile.
    if (!own.includes(`http://${req.headers.host ?? ""}`)) {
      throw new HttpError(403, "bad_host", "This API only answers on 127.0.0.1");
    }
    // Browsers name the calling page in Origin. Only the local web app may call.
    const origin = req.headers.origin;
    const cors: Record<string, string> = {};
    if (origin !== undefined) {
      if (!own.includes(origin) && !extraOrigins.has(origin)) {
        throw new HttpError(403, "bad_origin", "This origin may not call the API");
      }
      cors["Access-Control-Allow-Origin"] = origin;
      cors["Vary"] = "Origin";
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
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.shift() !== "api") throw new HttpError(404, "not_found", "Not found");
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

      case "POST /annotations": {
        const input = parse(annotationInput, await readJson(req));
        guard.check(input); // A note is a write like any other.
        return ok({ annotation: data.addAnnotation(db, input) }, 201);
      }

      case "DELETE /annotations/:id":
        if (!data.deleteAnnotation(db, id)) throw notFound("Annotation");
        return ok(undefined, 204);

      case "GET /export":
        return ok(data.exportAll(db), 200, {
          "Content-Disposition": `attachment; filename="fork-trail-coach-export-${new Date().toISOString().slice(0, 10)}.json"`,
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
