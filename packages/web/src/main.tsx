import "@fontsource-variable/plus-jakarta-sans";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider, useParams } from "react-router";
import { Layout } from "./components/Layout";
import { GrowPage } from "./pages/GrowPage";
import { EvalPage } from "./pages/EvalPage";
import { ClarifyPage } from "./pages/ClarifyPage";
import { MyDataPage } from "./pages/MyDataPage";
import { NotFoundPage, PageError } from "./pages/NotFoundPage";
import { TrackPage } from "./pages/TrackPage";
import { TicketsPage } from "./pages/TicketsPage";

/** Links from before the rename (Fork, Paper Trail, Coach) still land on the right page. */
function Renamed({ to }: { to: string }) {
  const { ticketId } = useParams();
  return <Navigate to={ticketId ? `${to}/${encodeURIComponent(ticketId)}` : to} replace />;
}

// Hash routes, so the built app works when the local server (BE-13) serves it
// as plain static files, with no rewrite rules.
const router = createHashRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      {
        // A page that fails while drawing is replaced by PageError, inside the
        // layout, so the screen is never blank and the menu still works.
        errorElement: <PageError />,
        children: [
          { index: true, element: <Navigate to="/clarify" replace /> },
          { path: "clarify", element: <TicketsPage section="clarify" /> },
          { path: "clarify/:ticketId", element: <ClarifyPage /> },
          { path: "track", element: <TicketsPage section="track" /> },
          { path: "track/:ticketId", element: <TrackPage /> },
          { path: "grow", element: <GrowPage /> },
          { path: "eval", element: <EvalPage /> },
          { path: "my-data", element: <MyDataPage /> },
          { path: "fork", element: <Renamed to="/clarify" /> },
          { path: "fork/:ticketId", element: <Renamed to="/clarify" /> },
          { path: "paper-trail", element: <Renamed to="/track" /> },
          { path: "paper-trail/:ticketId", element: <Renamed to="/track" /> },
          { path: "coach", element: <Renamed to="/grow" /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
