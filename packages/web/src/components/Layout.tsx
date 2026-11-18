import { NavLink, Outlet, ScrollRestoration } from "react-router";
import { apiConfig, apiHost } from "../api/config";
import { Icon, type IconName } from "./Icon";

const SECTIONS: { to: string; label: string; icon: IconName }[] = [
  { to: "/fork", label: "Fork", icon: "fork" },
  { to: "/paper-trail", label: "Paper Trail", icon: "trail" },
  { to: "/coach", label: "Coach", icon: "coach" },
  { to: "/eval", label: "Eval", icon: "eval" },
  { to: "/my-data", label: "My data", icon: "data" },
];

function DataSource() {
  if (apiConfig.mode === "live") {
    return (
      <p className="rail__source">
        Reading your local data from <code>{apiHost(apiConfig)}</code>
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
        <p className="rail__name">
          <span className="rail__logo">
            <Icon name="logo" />
          </span>
          <span>Fork, Paper Trail, Coach</span>
        </p>
        <nav aria-label="Sections">
          <p className="rail__label" aria-hidden="true">
            Menu
          </p>
          <ul>
            {SECTIONS.map((section) => (
              <li key={section.to}>
                <NavLink to={section.to}>
                  <Icon name={section.icon} />
                  <span>{section.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="rail__foot">
          <span className="rail__shield">
            <Icon name="shield" />
          </span>
          <p className="rail__privacy">Everything here stays on this computer.</p>
          <DataSource />
        </div>
      </header>
      <main id="main" className="main">
        <Outlet />
      </main>
      <ScrollRestoration />
    </div>
  );
}
