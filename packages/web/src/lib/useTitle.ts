import { useEffect } from "react";

const APP = "Fork, Paper Trail, Coach";

/** Sets the browser tab title for the current page. */
export function useTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} - ${APP}` : APP;
  }, [title]);
}
