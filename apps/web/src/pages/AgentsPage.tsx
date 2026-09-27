import { useState } from "react";
import { api } from "../api.ts";
import { useAsync } from "../lib/useAsync.ts";
import { formatDateTime, formatDuration, formatNumber, formatPercent, formatRelative } from "../lib/format.ts";
import { TimeRangeControl } from "../components/TimeRangeControl.tsx";
import type { TimeRangeValue } from "../components/TimeRangeControl.tsx";
import { ErrorNote, StatusPill } from "../components/ui.tsx";

export function AgentsPage() {
   const [range, setRange] = useState<TimeRangeValue>({ range: "7d" });
   const agents = useAsync(
      () => api.agents({ range: range.range, from: range.from, to: range.to }),
      [range.range, range.from, range.to],
      { pollMs: 30_000 },
      );

   const rows = agents.data ?? [];
   const active = rows.filter((agent) => agent.requests > 0);

   return (
           	<div>
         	<div className="page-header">
             	<div>
                  	<h1 className="page-title">Agents</h1>
                  	<p className="page-subtitle">Which coding agents are using JevAI-MCP, and how.</p>
             	</div>
             	<TimeRangeControl value={range} onChange={setRange} />
         	</div>

         	<ErrorNote error={agents.error} />

         	<div className="card table-wrap">
             	<table>
                  	<thead>
                      	<tr>
                         	<th>Agent</th>
                         	<th className="num">Requests</th>
                         	<th className="num">Success</th>
                         	<th className="num">Avg duration</th>
                         	<th className="num">Input tokens</th>
                         	<th>Most used tool</th>
                         	<th>Last seen</th>
                      	</tr>
                  	</thead>
                  	<tbody>
                      	{rows.map((agent) => (
                         	<tr key={agent.caller}>
                            	<td>
                                  	<strong>{agent.caller}</strong>
                                  	{!agent.known && <span className="pill" style={{ marginLeft: 8 }}>custom</span>}
                                  	{agent.lastSeenSecondsAgo !== null && agent.lastSeenSecondsAgo < 300 && (
                                     			<StatusPill tone="ok">active</StatusPill>
                                        			)}
                            	</td>
                            	<td className="num">{formatNumber(agent.requests)}</td>
                            	<td className="num">{formatPercent(agent.successRate)}</td>
                            	<td className="num">{formatDuration(agent.avgDurationMs)}</td>
                            	<td className="num">{formatNumber(agent.inputTokens)}</td>
                            	<td className="mono">{agent.mostUsedTool ?? " - "}</td>
                            	<td className="nowrap muted">
                                  	{agent.lastSeenAt ? `${formatRelative(agent.lastSeenAt)} · ${formatDateTime(agent.lastSeenAt)}` : "never"}
                            	</td>
                         	</tr>
                         	))}
                      	{!agents.loading && rows.length === 0 && (
                         	<tr><td colSpan={7} className="chart-empty">No agents seen yet.</td></tr>
                         	)}
                  	</tbody>
              	</table>
         	</div>

         	<div className="card section-gap">
             	<h2 className="card-title">Registered agent types</h2>
             	<p className="muted">
                  	Codex, Claude Code, OpenCode and Gemini CLI are recognised automatically from request
                  	headers. Any other client appears under <span className="mono">generic</span> until it
                  	sends a caller name, and remains listed here as custom.
             	</p>
             	{active.length === 0 && <p className="muted">No agent has called Jev in this time range yet.</p>}
         	</div>
           	</div>
   	);
   	}
