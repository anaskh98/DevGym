/**
 * The one switch between mock JSON and the real local API.
 *
 *   VITE_API_MODE=mock   read public/mock/<path>.json   (default)
 *   VITE_API_MODE=live   call VITE_API_BASE<path>       (needs BE-12)
 *
 * In mock mode, VITE_MOCK_DIR picks the folder under public/: "mock" is the
 * committed sample, "mock-local" is what `pnpm db:export-mock` writes from
 * your own database (never committed).
 */
export type ApiMode = "mock" | "live";

export interface ApiConfig {
  mode: ApiMode;
  /** Base URL of the local REST API. Used in live mode. */
  apiBase: string;
  /** Where the app itself is served from. Used to find the mock files. */
  appBase: string;
  /** Folder under public/ that holds the mock JSON. */
  mockDir: string;
}

export function readApiConfig(env: Record<string, string | undefined>): ApiConfig {
  return {
    mode: env.VITE_API_MODE === "live" ? "live" : "mock",
    apiBase: (env.VITE_API_BASE ?? "http://127.0.0.1:4317").replace(/\/+$/, ""),
    appBase: env.BASE_URL ?? "/",
    mockDir: (env.VITE_MOCK_DIR ?? "mock").replace(/^\/+|\/+$/g, "") || "mock",
  };
}

/** Turns an API path such as "/api/tickets" into the URL to fetch. */
export function resolveUrl(config: ApiConfig, path: string): string {
  if (config.mode === "live") return `${config.apiBase}${path}`;
  const base = config.appBase.endsWith("/") ? config.appBase : `${config.appBase}/`;
  return `${base}${config.mockDir}${path}.json`;
}

export const apiConfig = readApiConfig(import.meta.env as Record<string, string | undefined>);
