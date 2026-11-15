import { useEffect, useState } from "react";
import { ApiError } from "./client";

export type Loadable<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: ApiError };

/** Loads data when `key` changes, and cancels a request that is no longer wanted. */
export function useApi<T>(key: string, load: (signal: AbortSignal) => Promise<T>): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal).then(
      (data) => setState({ status: "ready", data }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error:
            error instanceof ApiError
              ? error
              : new ApiError("bad_response", error instanceof Error ? error.message : String(error)),
        });
      },
    );
    return () => controller.abort();
    // `load` is recreated on every render; `key` says when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
