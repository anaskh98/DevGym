import "@fontsource-variable/atkinson-hyperlegible-next";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import { CoachPage } from "./pages/CoachPage";
import { EvalPage } from "./pages/EvalPage";
import { ForkPage } from "./pages/ForkPage";
import { MyDataPage } from "./pages/MyDataPage";
import { NotFoundPage, PageError } from "./pages/NotFoundPage";
import { PaperTrailPage } from "./pages/PaperTrailPage";
import { TicketsPage } from "./pages/TicketsPage";

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
          { index: true, element: <Navigate to="/fork" replace /> },
          { path: "fork", element: <TicketsPage section="fork" /> },
          { path: "fork/:ticketId", element: <ForkPage /> },
          { path: "paper-trail", element: <TicketsPage section="paper-trail" /> },
          { path: "paper-trail/:ticketId", element: <PaperTrailPage /> },
          { path: "coach", element: <CoachPage /> },
          { path: "eval", element: <EvalPage /> },
          { path: "my-data", element: <MyDataPage /> },
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
