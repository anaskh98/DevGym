import type { ReactNode } from "react";
import type { ApiError } from "../api/client";
import { apiConfig, apiHost } from "../api/config";

export function Loading({ what }: { what: string }) {
  return (
    <p className="state state--loading" role="status">
      Loading {what}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="state state--empty">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function ErrorState({ error, what }: { error: ApiError; what: string }) {
  const live = apiConfig.mode === "live";
  return (
    <section className="state state--error" role="alert">
      <h2>Could not load {what}</h2>
      <p>{error.message}</p>
      {error.kind === "unreachable" && live && (
        <p>
          The local service at <code>{apiHost(apiConfig)}</code> is not answering. In Claude Code, run{" "}
          <code>/devgym:grow open</code> to start it, or <code>pnpm api</code> when developing.
        </p>
      )}
      {error.kind === "bad_response" && (
        <p>
          The data does not match what this version of the app expects. If you changed the server,
          rebuild the web app too.
        </p>
      )}
    </section>
  );
}
