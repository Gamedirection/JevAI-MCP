import { useState } from "react";
import { api, downloadUrl } from "../api.ts";
import { useAsync } from "../lib/useAsync.ts";
import { formatBytes, formatDateTime, formatUptime, formatRelative } from "../lib/format.ts";
import { ConnectionPill, ErrorNote, StatusPill } from "../components/ui.tsx";
import type { ConnectionState } from "../types.ts";

export function SystemPage() {
   const status = useAsync(() => api.systemStatus(), [], { pollMs: 15_000 });
   const events = useAsync(() => api.connectionEvents(100), [], { pollMs: 30_000 });
   const [actionMessage, setActionMessage] = useState<string | null>(null);
   const data = status.data;

   async function runRetention() {
      setActionMessage(null);
      try {
         const result = await api.runRetention();
         setActionMessage(
             	`Retention complete: ${result.requestsDeleted} requests, ${result.logsDeleted} logs and ${result.connectionEventsDeleted} connection events removed.`,
                	);
         status.reload();
         events.reload();
            	} catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : String(caught));
            	}
         	}

   return (
           	<div>
         	<div className="page-header">
             	<div>
                  	<h1 className="page-title">System</h1>
                  	<p className="page-subtitle">Runtime state, connection history and diagnostics.</p>
             	</div>
             	<div style={{ display: "flex", gap: 8 }}>
                  	<a className="btn" href={downloadUrl("/metrics")} target="_blank" rel="noreferrer">
                       	Prometheus metrics
                  	</a>
                  	<a className="btn primary" href={downloadUrl("/api/system/diagnostics")}>
                       	Download diagnostics (ZIP)
                  	</a>
             	</div>
         	</div>

         	<ErrorNote error={status.error} />

         	{data && (
             	<div className="grid stats">
                  	<Card label="Version" value={data.application.version}
                             	sub={`${data.application.commit ?? "no commit"} · built ${data.application.buildDate ?? "unknown"}`} />
                  	<Card label="Uptime" value={formatUptime(data.application.uptimeSeconds)}
                             	sub={`started ${formatDateTime(data.application.startedAt)}`} />
                  	<Card label="Jev connection" value={data.jev.state.replace(/_/g, " ")}
                             	sub={data.jev.lastSuccessAt ? `last success ${formatRelative(data.jev.lastSuccessAt)}` : "no successful call yet"} />
                  	<Card label="Database" value={data.database.healthy ? "healthy" : "unhealthy"}
                             	sub={`schema v${data.database.schemaVersion} · ${formatBytes(data.database.sizeBytes)}`} />
                  	<Card label="Memory (RSS)" value={formatBytes(data.memory.rssBytes)}
                             	sub={`heap ${formatBytes(data.memory.heapUsedBytes)}`} />
                  	<Card label="Disconnects" value={String(data.jev.totalDisconnects)}
                             	sub={data.jev.lastFailureAt ? `last failure ${formatRelative(data.jev.lastFailureAt)}` : "clean record"} />
             	</div>
                	)}

         	{data && (
             	<div className="card section-gap">
                  	<h2 className="card-title">Runtime</h2>
                  	<dl className="kv">
                       	<dt>Node.js</dt><dd className="mono">{data.application.node}</dd>
                       	<dt>Platform</dt><dd className="mono">{data.application.platform}</dd>
                       	<dt>Jev endpoint</dt><dd className="mono">{data.jev.endpoint}</dd>
                       	<dt>Jev model</dt><dd className="mono">{data.jev.model}</dd>
                       	<dt>API key source</dt><dd>{data.jev.apiKeySource}</dd>
                       	<dt>MCP</dt><dd className="mono">{data.mcp.url}/mcp · standalone port {data.mcp.port} ({data.mcp.enabled ? "enabled" : "disabled"})</dd>
                       	{data.database.path !== "persistent" && (<><dt>Database path</dt><dd className="mono">{data.database.path}</dd></>)}
                  	</dl>
                  	{data.jev.lastFailureReason && (
                       	<p className="error-text" style={{ marginTop: 10 }}>
                            	Last failure: {data.jev.lastFailureReason}
                            	{data.jev.lastFailureStatus ? ` (HTTP ${data.jev.lastFailureStatus})` : ""}
                       	</p>
                         	)}
             	</div>
                	)}

         	<div className="card">
             	<h2 className="card-title">Actions</h2>
             	<div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  	<button type="button" className="btn" onClick={runRetention}>Run retention now</button>
                  	<button type="button" className="btn" onClick={() => { status.reload(); events.reload(); }}>Refresh</button>
                  	{actionMessage && <span className="muted">{actionMessage}</span>}
             	</div>
         	</div>

         	<div className="card">
             	<h2 className="card-title">Connection events</h2>
             	{events.data && (
                  	<p className="muted" style={{ marginTop: 0 }}>
                       	Current state: <ConnectionPill state={events.data.current.state} />
                       	{" · total disconnects: "}{events.data.totalDisconnects}
                  	</p>
                	)}
             	<ErrorNote error={events.error} />
             	<div className="table-wrap">
                  	<table>
                       	<thead>
                            	<tr><th>Time</th><th>State</th><th>Reason</th><th className="num">Status</th></tr>
                       	</thead>
                       	<tbody>
                            	{(events.data?.events ?? []).map((event) => (
                                 					<tr key={event.id}>
                                      					<td className="nowrap mono muted">{formatDateTime(event.timestamp)}</td>
                                      					<td><StatePill state={event.state} /></td>
                                      					<td className="muted">{event.reason ?? " - "}</td>
                                      					<td className="num">{event.statusCode ?? " - "}</td>
                                 					</tr>
                                					))}
                            	{!events.loading && (events.data?.events.length ?? 0) === 0 && (
                                 					<tr><td colSpan={4} className="chart-empty">No connection events recorded.</td></tr>
                                					)}
                       	</tbody>
                  	</table>
             	</div>
         	</div>
           	</div>
   	);
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
   return (
           	<div className="card">
         	<div className="stat-label">{label}</div>
         	<div className="stat-value" style={{ fontSize: 20 }}>{value}</div>
         	<div className="stat-sub">{sub}</div>
           	</div>
   	);
}

const STATE_TONE: Record<ConnectionState, string> = {
   connected: "ok",
   recovered: "ok",
   disconnected: "bad",
   timeout: "warn",
   auth_failure: "bad",
   rate_limited: "warn",
   unknown: "",
};

function StatePill({ state }: { state: ConnectionState }) {
   return <StatusPill tone={STATE_TONE[state] ?? ""}>{state.replace(/_/g, " ")}</StatusPill>;
}
