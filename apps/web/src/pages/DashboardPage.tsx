import { useState } from "react";
import { api } from "../api.ts";
import { useAsync } from "../lib/useAsync.ts";
import { formatDuration, formatNumber, formatPercent, formatRelative } from "../lib/format.ts";
import { TimelineChart } from "../components/TimelineChart.tsx";
import { BarList } from "../components/BarList.tsx";
import { TimeRangeControl } from "../components/TimeRangeControl.tsx";
import type { TimeRangeValue } from "../components/TimeRangeControl.tsx";
import { ConnectionPill, ErrorNote, StatusPill } from "../components/ui.tsx";
import type { TimeRangePreset } from "../types.ts";

export function DashboardPage() {
   const bootstrap = useAsync(() => api.bootstrap(), []);
   const [range, setRange] = useState<TimeRangeValue>({
      range: (bootstrap.data?.defaultTimeRange ?? "7d") as TimeRangePreset,
           });
   const pollMs = (bootstrap.data?.refreshIntervalSeconds ?? 30) * 1000;
   const dashboard = useAsync(
      () => api.dashboard({ range: range.range, from: range.from, to: range.to }),
      [range.range, range.from, range.to],
      { pollMs },
    );

   const data = dashboard.data;
   const summary = data?.summary;
   const status = data?.serviceStatus;

   return (
      	<div>
         	<div className="page-header">
             	<div>
                  	<h1 className="page-title">Dashboard</h1>
                  	<p className="page-subtitle">
                      	Routing decisions from the Jev decision model through one MCP endpoint.
                  	</p>
              	</div>
              	<TimeRangeControl value={range} onChange={setRange} />
         	</div>

         	<ErrorNote error={dashboard.error} />

         	<div className="grid stats">
              	<Stat label="Total calls" value={formatNumber(summary?.totalCalls)}
                      	sub={data ? `since ${new Date(data.timeRange.from).toLocaleString()}` : " - "} />
              	<Stat label="Success rate" value={formatPercent(summary?.successRate)}
                      	sub={summary ? `${formatNumber(summary.successfulCalls)} ok · ${formatNumber(summary.failedCalls)} failed` : " - "} />
              	<Stat label="Avg duration" value={formatDuration(summary?.avgDurationMs)} sub="upstream call time" />
              	<Stat label="Input tokens" value={formatNumber(summary?.inputTokens)} sub="sent to Jev" />
              	<Stat
                      	label="Est. tokens saved"
                      	value={summary?.estimatedTokensSaved === null
                            	? "off"
                            	: formatNumber(summary?.estimatedTokensSaved)}
                      	sub={summary?.tokenSavingsEnabled
                            	? "vs reading whole files"
                            	: "disabled in settings"}
                   	/>
              	<Stat label="Active clients" value={formatNumber(summary?.activeClients)}
                      	sub={summary?.lastRequestAt ? `last call ${formatRelative(summary.lastRequestAt)}` : "no calls yet"} />
         	</div>

         	{status && (
              	<div className="banner section-gap" aria-label="Service status">
                  	<ConnectionPill state={status.jev} />
                  	<StatusPill tone={status.database === "healthy" ? "ok" : "bad"}>database {status.database}</StatusPill>
                  	<StatusPill tone={status.mcp === "running" ? "ok" : ""}>MCP {status.mcp}</StatusPill>
                  	<span className="muted">
                      	{status.totalDisconnects === 0
                            	? "No disconnects recorded"
                            	: `${formatNumber(status.totalDisconnects)} disconnect events`}
                      	{status.lastFailureAt ? ` · last failure ${formatRelative(status.lastFailureAt)}` : ""}
                  	</span>
                  	{bootstrap.data && (
                      	<span className="muted" style={{ marginLeft: "auto" }} title={bootstrap.data.mcpUrl}>
                            	MCP endpoint: <span className="mono">{bootstrap.data.mcpUrl}/mcp</span>
                      	</span>
                         	)}
              	</div>
                   	)}

         	<div className="card section-gap">
              	<h2 className="card-title">Calls over time</h2>
              	{dashboard.loading && !data
                   	? <div className="center-note">Loading…</div>
                   	: <TimelineChart points={data?.timeline ?? []} bucketSeconds={data?.timeRange.bucketSeconds ?? 3600} />}
         	</div>

         	<div className="card">
              	<h2 className="card-title">Average duration over time</h2>
              	<TimelineChart
                   	points={data?.timeline ?? []}
                   	bucketSeconds={data?.timeRange.bucketSeconds ?? 3600}
                   	metric="duration"
                    	 />
         	</div>

         	<div className="grid two section-gap">
              	<div className="card">
                  	<h2 className="card-title">Calls by tool</h2>
                  	<BarList
                        	items={(data?.byTool ?? [])
                             	.sort((a, b) => b.count - a.count)
                             	.map((row) => ({
                                  	label: row.key,
                                  	value: row.count,
                                  	sub: `${percent(row.success, row.count)} ok`,
                                     }))}
                        	 emptyText="No tool calls yet"
                         	/>
              	</div>
              	<div className="card">
                  	<h2 className="card-title">Calls by agent</h2>
                  	<BarList
                        	items={(data?.byCaller ?? [])
                             	.sort((a, b) => b.count - a.count)
                             	.map((row) => ({
                                  	label: row.key,
                                  	value: row.count,
                                  	sub: row.lastSeenAt ? formatRelative(row.lastSeenAt) : "never",
                                     }))}
                        	 emptyText="No agent calls yet"
                         	/>
              	</div>
         	</div>

         	{status?.lastFailureReason && (
              	<div className="banner bad section-gap">
                  	<strong>Last Jev failure:</strong>
                  	<span>{status.lastFailureReason}</span>
              	</div>
                   	)}
      	</div>
   	);
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
   return (
      	<div className="card">
         	<div className="stat-label">{label}</div>
         	<div className="stat-value">{value}</div>
         	<div className="stat-sub">{sub}</div>
      	</div>
   	);
}

function percent(part: number, total: number): string {
   if (total === 0) return "0%";
   return `${Math.round((part / total) * 100)}%`;
}
