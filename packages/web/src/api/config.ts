/**
 * Where the app reads its data.
 *
 *   VITE_API_MODE=live   the local service's REST API (docs/api.md). This is how the plugin ships it:
 *                        the service serves the app and the API from one address, so no base is needed.
 *   VITE_API_MODE=mock   the sample JSON in public/mock (default in development).
 *
 *   VITE_API_BASE        live mode only: where the API is, when the app runs elsewhere, for example
 *                        http://127.0.0.1:4317 while developing with `pnpm dev:web`. Empty = same address.
 */
export type ApiMode = "mock" | "live";

export interface ApiConfig {
  mode: ApiMode;
  /** Base URL of the REST API in live mode. "" means the address the app was loaded from. */
  apiBase: string;
  /** Where the app itself is served from. Used to find the mock files. */
  appBase: string;
  /** Folder under public/ that holds the mock JSON. */
  mockDir: string;
}

export function readApiConfig(env: Record<string, string | undefined>): ApiConfig {
  return {
    mode: env.VITE_API_MODE === "live" ? "live" : "mock",
    apiBase: (env.VITE_API_BASE ?? "").trim().replace(/\/+$/, ""),
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

/** "127.0.0.1:4317", for the line that says where the data comes from. */
export function apiHost(config: ApiConfig): string {
  if (config.apiBase) return config.apiBase.replace(/^https?:\/\//, "");
  return typeof location === "undefined" ? "this computer" : location.host;
}

export const apiConfig = readApiConfig(import.meta.env as Record<string, string | undefined>);
