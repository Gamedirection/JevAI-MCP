import { useEffect, useState } from "react";
import { api, downloadUrl } from "../api.ts";
import { useAsync } from "../lib/useAsync.ts";
import { formatDateTime } from "../lib/format.ts";
import { ErrorNote } from "../components/ui.tsx";
import type { LogRow } from "../types.ts";

const PAGE_SIZE = 100;

export function LogsPage() {
   const [level, setLevel] = useState("");
   const [component, setComponent] = useState("");
   const [search, setSearch] = useState("");
   const [live, setLive] = useState(true);
   const [maxId, setMaxId] = useState<number | undefined>(undefined);
   const [extra, setExtra] = useState<LogRow[]>([]);

   const logs = useAsync(
      () =>
          api.logs({
               level: level || undefined,
               component: component || undefined,
               search: search || undefined,
               limit: PAGE_SIZE,
              }),
       [level, component, search],
      );

   useEffect(() => {
      setExtra([]);
      const firstPage = logs.data?.records ?? [];
      const highest = firstPage.reduce((max, record) => Math.max(max, record.id), 0);
      setMaxId(highest);
          }, [logs.data]);

   useEffect(() => {
      if (!live || maxId === undefined) return;
      const handle = setInterval(() => {
         void api
             	.logs({ after: maxId })
             	.then((result) => {
                   	if ((result.live?.length ?? 0) === 0) return;
                   	setExtra((current) => {
                         	const seen = new Set(current.map((record) => record.id));
                         	const fresh = (result.live ?? []).filter((record) => !seen.has(record.id));
                         	if (fresh.length === 0) return current;
                         	return [...current, ...fresh].sort((a, b) => a.id - b.id).slice(-PAGE_SIZE);
                             	});
                   	setMaxId(result.maxId);
                       	})
             	.catch(() => undefined);
           	}, 4_000);
      return () => clearInterval(handle);
          	}, [live, maxId]);

   const rows = [...(logs.data?.records ?? []), ...extra].sort((a, b) => b.id - a.id);
   const filterQuery = new URLSearchParams();
   if (level) filterQuery.set("level", level);
   if (component) filterQuery.set("component", component);
   if (search) filterQuery.set("search", search);

   return (
           	<div>
         	<div className="page-header">
             	<div>
                  	<h1 className="page-title">Logs</h1>
                  	<p className="page-subtitle">Application log stream. Secrets are redacted before storage.</p>
             	</div>
             	<div style={{ display: "flex", gap: 8 }}>
                  	<a className="btn" href={downloadUrl(`/api/logs/download?format=json&${filterQuery}`)}>
                       	Download JSON
                  	</a>
                  	<a className="btn" href={downloadUrl(`/api/logs/download?format=text&${filterQuery}`)}>
                       	Download text
                  	</a>
             	</div>
         	</div>

         	<div className="toolbar">
             	<label className="checkline">
                  	Level
                  	<select value={level} onChange={(event) => setLevel(event.target.value)}>
                      	<option value="">All</option>
                      	<option value="debug">debug</option>
                      	<option value="info">info</option>
                      	<option value="warn">warn</option>
                      	<option value="error">error</option>
                  	</select>
             	</label>
             	<label className="checkline">
                  	Component
                  	<select value={component} onChange={(event) => setComponent(event.target.value)}>
                      	<option value="">All</option>
                      	<option value="mcp">mcp</option>
                      	<option value="jev">jev</option>
                      	<option value="api">api</option>
                      	<option value="database">database</option>
                      	<option value="system">system</option>
                      	<option value="frontend">frontend</option>
                  	</select>
             	</label>
             	<input
                  		type="search"
                  		placeholder="Search messages"
                  		value={search}
                  		onChange={(event) => setSearch(event.target.value)}
                  		style={{ width: 240 }}
             	/>
             	<label className="checkline" title="Follow new log lines automatically">
                  	<input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} />
                  	Live
             	</label>
             	<span className="spacer" />
             	<button type="button" className="btn small" onClick={logs.reload}>Refresh</button>
         	</div>

         	<ErrorNote error={logs.error} />

         	<div className="card table-wrap">
             	<table>
                  	<thead>
                      	<tr>
                         	<th>Time</th>
                         	<th>Level</th>
                         	<th>Component</th>
                         	<th>Message</th>
                      	</tr>
                  	</thead>
                  	<tbody>
                      	{rows.map((record) => (
                         	<tr key={record.id}>
                            	<td className="nowrap mono muted">{formatDateTime(record.timestamp)}</td>
                            	<td className={`level-${record.level}`} style={{ fontWeight: 600 }}>
                                  	{record.level.toUpperCase()}
                            	</td>
                            	<td className="mono muted">{record.component}</td>
                            	<td>
                                  	{record.message}
                                  	{record.context && Object.keys(record.context).length > 0 && (
                                     				<div className="mono muted" style={{ marginTop: 2 }}>
                                        				{JSON.stringify(record.context)}
                                     				</div>
                                        				)}
                            	</td>
                         	</tr>
                         	))}
                      	{!logs.loading && rows.length === 0 && (
                         	<tr><td colSpan={4} className="chart-empty">No log entries match these filters.</td></tr>
                         	)}
                  	</tbody>
              	</table>
         	</div>
           	</div>
   	);
   		}
