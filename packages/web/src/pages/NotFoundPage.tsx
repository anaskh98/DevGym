import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { EmptyState } from "../components/States";
import { useTitle } from "../lib/useTitle";

/** An address the app has no page for. */
export function NotFoundPage() {
  useTitle("Page not found");
  return (
    <>
      <h1 className="page-title">Page not found</h1>
      <EmptyState title="There is nothing at this address">
        <p>
          <Link to="/fork">Go to Fork</Link>, or pick a section from the menu.
        </p>
      </EmptyState>
    </>
  );
}

/**
 * Shown instead of a blank screen when a page fails while drawing.
 * Rendered inside the layout, so the menu still works.
 */
export function PageError() {
  const error = useRouteError();
  useTitle("Something went wrong");
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;

  const detail = error instanceof Error ? error.message : null;
  return (
    <>
      <h1 className="page-title">This page could not be shown</h1>
      <section className="state state--error" role="alert">
        <h2>The page stopped while drawing</h2>
        <p>
          Your data has not been changed. Reload the page; if it happens again, the data and this
          version of the app may not match.
        </p>
        {detail && (
          <p>
            <code>{detail}</code>
          </p>
        )}
        <p>
          <button type="button" className="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      </section>
    </>
  );
}
