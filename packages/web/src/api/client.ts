import {
  Annotation,
  AnnotationInput,
  AnnotationResponse,
  API_PATHS,
  ApiErrorBody,
  GrowDashboard,
  DELETE_ALL_BODY,
  DeleteAllResponse,
  EvalResults,
  ExportResponse,
  GrowthPlanResponse,
  STORED_TABLES,
  TicketDetailResponse,
  TicketListResponse,
} from "@devgym/shared";
import type { z } from "zod";
import { apiConfig, resolveUrl, type ApiConfig } from "./config";
import { browserStorage, createNoteStore, type NoteStore } from "./mockNotes";

/**
 * not_found: nothing there. unreachable: the service is not running.
 * rejected: the service refused the input (for example the privacy guard); the message says why.
 * bad_response: the data is not in the shape this app expects.
 */
export type ApiErrorKind = "not_found" | "unreachable" | "bad_response" | "rejected";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestInit {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  signal?: AbortSignal | undefined;
}

async function request<S extends z.ZodType>(url: string, path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      signal: init.signal ?? null,
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("unreachable", `Could not reach ${url}.`);
  }

  let body: unknown;
  try {
    body = response.status === 204 ? undefined : await response.json();
  } catch {
    // A dev server answers unknown paths with index.html; treat that as missing.
    throw new ApiError("not_found", `Nothing at ${path}.`);
  }

  if (!response.ok) {
    const parsed = ApiErrorBody.safeParse(body);
    const message = parsed.success ? parsed.data.error.message : `${path} answered ${response.status}.`;
    if (response.status === 404) throw new ApiError("not_found", message);
    if (response.status >= 400 && response.status < 500) throw new ApiError("rejected", message);
    throw new ApiError("bad_response", message);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError("bad_response", `${path} returned data in an unexpected shape.`);
  return parsed.data;
}

function emptyExport(response: ExportResponse): ExportResponse {
  const tables = new Set([...STORED_TABLES, ...Object.keys(response.data)]);
  return {
    ...response,
    counts: Object.fromEntries([...tables].map((t) => [t, 0])),
    data: Object.fromEntries([...tables].map((t) => [t, []])),
  };
}

export function createApi(config: ApiConfig = apiConfig, notes: NoteStore = createNoteStore(browserStorage())) {
  // The sample files are read-only. In mock mode, "delete everything" is remembered until the page
  // reloads, and notes are kept in the browser (see mockNotes.ts). Live mode calls the service for both.
  let mockDeleted = false;
  const mock = config.mode === "mock";
  const get = <S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal) =>
    request(resolveUrl(config, path), path, schema, { signal });

  const getExport = async (signal?: AbortSignal): Promise<ExportResponse> => {
    const response = await get(API_PATHS.export(), ExportResponse, signal);
    if (!mock) return response;
    if (mockDeleted) return emptyExport(response);
    const added = notes.list();
    const annotations = [...(response.data.annotations ?? []), ...added];
    return {
      ...response,
      counts: { ...response.counts, annotations: annotations.length },
      data: { ...response.data, annotations },
    };
  };

  return {
    config,

    listTickets: async (signal?: AbortSignal) => {
      if (mock && mockDeleted) return { tickets: [] };
      return get(API_PATHS.tickets(), TicketListResponse, signal);
    },

    getTicket: async (ticketId: string, signal?: AbortSignal) => {
      const path = API_PATHS.ticket(ticketId);
      if (mock && mockDeleted) throw new ApiError("not_found", `Ticket '${ticketId}' does not exist`);
      return get(path, TicketDetailResponse, signal);
    },

    getGrow: (signal?: AbortSignal) => get(API_PATHS.grow(), GrowDashboard, signal),

    getGrowthPlan: async (signal?: AbortSignal): Promise<GrowthPlanResponse> => {
      const response = await get(API_PATHS.growthPlan(), GrowthPlanResponse, signal);
      const plan = response.growth_plan;
      if (!mock || !plan) return response;
      if (mockDeleted) return { growth_plan: null };
      const added = notes.list();
      return {
        growth_plan: {
          ...plan,
          focus_areas: plan.focus_areas.map((area) => ({
            ...area,
            annotations: [...area.annotations, ...added.filter((note) => note.target_id === area.id)],
          })),
        },
      };
    },

    addAnnotation: async (input: AnnotationInput): Promise<Annotation> => {
      const parsed = AnnotationInput.safeParse(input);
      if (!parsed.success) throw new ApiError("rejected", parsed.error.issues[0]?.message ?? "The note is not valid.");
      if (!mock) {
        const path = API_PATHS.annotations();
        const saved = await request(resolveUrl(config, path), path, AnnotationResponse, { method: "POST", body: parsed.data });
        return saved.annotation;
      }
      const note: Annotation = {
        id: `ann_local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        ...parsed.data,
        created_at: new Date().toISOString(),
      };
      notes.add(note);
      return note;
    },

    /** The eval results come from a results file, not from the developer's data. */
    getEvalResults: (signal?: AbortSignal) => get(API_PATHS.eval(), EvalResults, signal),

    getExport,

    deleteAll: async (): Promise<DeleteAllResponse> => {
      if (!mock) {
        const path = API_PATHS.data();
        return request(resolveUrl(config, path), path, DeleteAllResponse, { method: "DELETE", body: DELETE_ALL_BODY });
      }
      const before = await getExport();
      mockDeleted = true;
      notes.clear();
      return { deleted: before.counts };
    },
  };
}

export const api = createApi();
