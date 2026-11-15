import "@fontsource-variable/atkinson-hyperlegible-next";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import { ForkPage } from "./pages/ForkPage";
import { NotBuiltPage } from "./pages/NotBuiltPage";
import { TicketsPage } from "./pages/TicketsPage";

// Hash routes, so the built app works when the local server (BE-13) serves it
// as plain static files, with no rewrite rules.
const router = createHashRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/fork" replace /> },
      { path: "fork", element: <TicketsPage /> },
      { path: "fork/:ticketId", element: <ForkPage /> },
      {
        path: "paper-trail",
        element: (
          <NotBuiltPage
            title="Paper Trail"
            willShow="Each decision made while coding a ticket: who made it, what else was considered, and a link to the function it lives in."
            planned="FE-3 and FE-4, week 2"
          />
        ),
      },
      {
        path: "coach",
        element: (
          <NotBuiltPage
            title="Coach"
            willShow="Your growth plan: one to three focus areas, each linked to its evidence, with room to add a note or disagree."
            planned="FE-5, week 3"
          />
        ),
      },
      {
        path: "eval",
        element: (
          <NotBuiltPage
            title="Eval"
            willShow="The five scores from the latest evaluation run, and the log of where the model failed."
            planned="FE-7, week 3"
          />
        ),
      },
      {
        path: "my-data",
        element: (
          <NotBuiltPage
            title="My data"
            willShow="Everything stored about you on this computer, with buttons to export it as JSON and to delete it all."
            planned="FE-6, week 2"
          />
        ),
      },
      {
        path: "*",
        element: (
          <NotBuiltPage
            title="Page not found"
            willShow="There is nothing at this address."
            planned="never"
          />
        ),
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
