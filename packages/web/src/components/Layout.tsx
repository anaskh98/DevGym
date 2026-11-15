import { NavLink, Outlet } from "react-router";
import { apiConfig } from "../api/config";

const SECTIONS = [
  { to: "/fork", label: "Fork" },
  { to: "/paper-trail", label: "Paper Trail" },
  { to: "/coach", label: "Coach" },
  { to: "/eval", label: "Eval" },
  { to: "/my-data", label: "My data" },
];

function DataSource() {
  if (apiConfig.mode === "live") {
    return (
      <p className="rail__source">
        Reading your local data from <code>{apiConfig.apiBase.replace(/^https?:\/\//, "")}</code>
      </p>
    );
  }
  return (
    <p className="rail__source rail__source--mock">
      {apiConfig.mockDir === "mock"
        ? "Showing sample data, not your own."
        : "Showing an export of your local data."}
    </p>
  );
}

export function Layout() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="rail">
        <p className="rail__name">Fork, Paper Trail, Coach</p>
        <nav aria-label="Sections">
          <ul>
            {SECTIONS.map((section) => (
              <li key={section.to}>
                <NavLink to={section.to}>{section.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="rail__foot">
          <DataSource />
          <p className="rail__privacy">Everything here stays on this computer.</p>
        </div>
      </header>
      <main id="main" className="main">
        <Outlet />
      </main>
    </div>
  );
}
