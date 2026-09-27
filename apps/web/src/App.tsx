import { NavLink, Route, Routes } from "react-router-dom";
import { api } from "./api.ts";
import { useAsync } from "./lib/useAsync.ts";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { RequestsPage } from "./pages/RequestsPage.tsx";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { LogsPage } from "./pages/LogsPage.tsx";
import { IntegrationsPage } from "./pages/IntegrationsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { SystemPage } from "./pages/SystemPage.tsx";

const NAV_ITEMS = [
   { to: "/", label: "Dashboard", end: true },
   { to: "/requests", label: "Requests", end: false },
   { to: "/agents", label: "Agents", end: false },
   { to: "/logs", label: "Logs", end: false },
   { to: "/integrations", label: "Integrations", end: false },
   { to: "/settings", label: "Settings", end: false },
   { to: "/system", label: "System", end: false },
];

export function App() {
   const version = useAsync(() => api.version(), []);
   return (
      <div className="layout">
         <header className="topbar">
            <div className="brand">
               <span className="brand-dot" aria-hidden="true" />
               JevAI-MCP
            </div>
            <nav className="nav" aria-label="Main navigation">
               {NAV_ITEMS.map((item) => (
                  <NavLink
                     key={item.to}
                     to={item.to}
                     end={item.end}
                     className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
                  >
                     {item.label}
                  </NavLink>
               ))}
            </nav>
         </header>
         <main className="content">
            <Routes>
               <Route path="/" element={<DashboardPage />} />
               <Route path="/requests" element={<RequestsPage />} />
               <Route path="/agents" element={<AgentsPage />} />
               <Route path="/logs" element={<LogsPage />} />
               <Route path="/integrations" element={<IntegrationsPage />} />
               <Route path="/settings" element={<SettingsPage />} />
               <Route path="/system" element={<SystemPage />} />
            </Routes>
         </main>
         <footer className="footer">
            <span>
               {version.data ? `JevAI-MCP v${version.data.version}` : "JevAI-MCP"}
               {version.data?.commit ? ` · ${version.data.commit}` : ""}
               {version.data?.buildDate ? ` · built ${version.data.buildDate}` : ""}
            </span>
            <span>The Jev decision model is an optimization, never a dependency.</span>
         </footer>
      </div>
   );
}
