import {
  Annotation,
  AnnotationInput,
  API_PATHS,
  CoachReportResponse,
  DeleteAllResponse,
  EvalResults,
  ForkResultResponse,
  MyDataResponse,
  PaperTrailResponse,
  STORED_KINDS,
  TicketListResponse,
} from "@ftc/shared";
import type { z } from "zod";
import { apiConfig, resolveUrl, type ApiConfig } from "./config";
import { browserStorage, createNoteStore, type NoteStore } from "./mockNotes";

export type ApiErrorKind = "not_found" | "unreachable" | "bad_response" | "invalid";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<S extends z.ZodType>(
  url: string,
  path: string,
  schema: S,
  init: { method?: "GET" | "DELETE" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      signal: init.signal,
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

function emptied(data: MyDataResponse): MyDataResponse {
  return {
    ...data,
    data: {
      tickets: [],
      assumptions: [],
      pointers: [],
      decisions: [],
      explain_backs: [],
      observations: [],
      growth_plans: [],
      annotations: [],
    },
  };
}

export function createApi(
  config: ApiConfig = apiConfig,
  notes: NoteStore = createNoteStore(browserStorage()),
) {
  // The sample files are read-only. In mock mode, "delete everything" is
  // remembered here until the page reloads, and notes are kept in the browser
  // (see mockNotes.ts). Live mode calls the local service for both.
  let mockDeleted = false;
  const mock = config.mode === "mock";

  const get = <S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal) =>
    request(resolveUrl(config, path), path, schema, { signal });

  const getStoredData = async (signal?: AbortSignal): Promise<MyDataResponse> => {
    const response = await get(API_PATHS.data(), MyDataResponse, signal);
    if (!mock) return response;
    if (mockDeleted) return emptied(response);
    return {
      ...response,
      data: { ...response.data, annotations: [...response.data.annotations, ...notes.list()] },
    };
  };

  return {
    config,

    listTickets: async (signal?: AbortSignal) => {
      if (mock && mockDeleted) return { tickets: [] };
      return get(API_PATHS.tickets(), TicketListResponse, signal);
    },

    getForkResult: async (ticketId: string, signal?: AbortSignal) => {
      const path = API_PATHS.forkResult(ticketId);
      if (mock && mockDeleted) throw new ApiError("not_found", `Nothing at ${path}.`);
      return get(path, ForkResultResponse, signal);
    },

    getTrail: async (ticketId: string, signal?: AbortSignal) => {
      const path = API_PATHS.trail(ticketId);
      if (mock && mockDeleted) throw new ApiError("not_found", `Nothing at ${path}.`);
      return get(path, PaperTrailResponse, signal);
    },

    getCoachReport: async (signal?: AbortSignal): Promise<CoachReportResponse> => {
      const report = await get(API_PATHS.coach(), CoachReportResponse, signal);
      if (!mock || !report.plan) return report;
      if (mockDeleted) return { ...report, plan: null };
      const added = notes.list();
      return {
        ...report,
        plan: {
          ...report.plan,
          focus_areas: report.plan.focus_areas.map((area) => ({
            ...area,
            annotations: [
              ...area.annotations,
              ...added.filter((note) => note.target_id === area.target_id),
            ],
          })),
        },
      };
    },

    addAnnotation: async (input: AnnotationInput): Promise<Annotation> => {
      const parsed = AnnotationInput.safeParse(input);
      if (!parsed.success) {
        throw new ApiError("invalid", parsed.error.issues[0]?.message ?? "The note is not valid.");
      }
      if (!mock) {
        const path = API_PATHS.annotations();
        return request(resolveUrl(config, path), path, Annotation, { method: "POST", body: parsed.data });
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

    getMyData: getStoredData,

    deleteAll: async (): Promise<DeleteAllResponse> => {
      if (!mock) {
        const path = API_PATHS.data();
        return request(resolveUrl(config, path), path, DeleteAllResponse, { method: "DELETE" });
      }
      const before = await getStoredData();
      mockDeleted = true;
      notes.clear();
      return {
        deleted: Object.fromEntries(STORED_KINDS.map((kind) => [kind, before.data[kind].length])),
      };
    },
  };
}

export const api = createApi();
