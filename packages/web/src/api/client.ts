import {
  API_PATHS,
  ForkResultResponse,
  TicketListResponse,
} from "@ftc/shared";
import type { z } from "zod";
import { apiConfig, resolveUrl, type ApiConfig } from "./config";

export type ApiErrorKind = "not_found" | "unreachable" | "bad_response";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<S extends z.ZodType>(
  config: ApiConfig,
  path: string,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const url = resolveUrl(config, path);
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { accept: "application/json" } });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("unreachable", `Could not reach ${url}.`);
  }
  if (response.status === 404) throw new ApiError("not_found", `Nothing at ${path}.`);
  if (!response.ok) throw new ApiError("bad_response", `${url} answered ${response.status}.`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A dev server answers unknown paths with index.html; treat that as missing.
    throw new ApiError("not_found", `Nothing at ${path}.`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError("bad_response", `${path} returned data in an unexpected shape.`);
  }
  return parsed.data;
}

export function createApi(config: ApiConfig = apiConfig) {
  return {
    config,
    listTickets: (signal?: AbortSignal) =>
      getJson(config, API_PATHS.tickets(), TicketListResponse, signal),
    getForkResult: (ticketId: string, signal?: AbortSignal) =>
      getJson(config, API_PATHS.forkResult(ticketId), ForkResultResponse, signal),
  };
}

export const api = createApi();
