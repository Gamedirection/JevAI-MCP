import { useState } from "react";
import { api } from "../api.ts";
import { useAsync } from "../lib/useAsync.ts";
import { formatDateTime, formatDuration, formatNumber } from "../lib/format.ts";
import { TimeRangeControl } from "../components/TimeRangeControl.tsx";
import type { TimeRangeValue } from "../components/TimeRangeControl.tsx";
import { ErrorNote, Pagination, StatusPill } from "../components/ui.tsx";
import type { RequestDetail, RequestRow } from "../types.ts";

const PAGE_SIZE = 25;

export function RequestsPage() {
   const [range, setRange] = useState<TimeRangeValue>({ range: "7d" });
   const [caller, setCaller] = useState("");
   const [tool, setTool] = useState("");
   const [status, setStatus] = useState("");
   const [search, setSearch] = useState("");
   const [page, setPage] = useState(0);
   const [selected, setSelected] = useState<number | null>(null);

   const facets = useAsync(() => api.requestFacets(), []);
   const list = useAsync(
      () =>
          api.requests({
               range: range.range,
               from: range.from,
               to: range.to,
               caller: caller || undefined,
               tool: tool || undefined,
               status: status || undefined,
               search: search || undefined,
               limit: PAGE_SIZE,
               offset: page * PAGE_SIZE,
             }),
       [range.range, range.from, range.to, caller, tool, status, search, page],
     );

   const detail = useAsync(
      () => (selected === null ? Promise.resolve(undefined) : api.requestDetail(selected)),
      [selected],
     );

   const records = list.data?.records ?? [];
   const total = list.data?.total ?? 0;

   return (
      		<div>
         	<div className="page-header">
             	<div>
                  	<h1 className="page-title">Requests</h1>
                  	<p className="page-subtitle">Every decision Jev answered, with caller, tool, latency and tokens.</p>
             	</div>
             	<TimeRangeControl value={range} onChange={setRange} />
         	</div>

         	<div className="toolbar">
             	<label className="checkline">
                  	Agent
                  	<select value={caller} onChange={(event) => { setCaller(event.target.value); setPage(0); }}>
                      	<option value="">All</option>
                      	{(facets.data?.callers ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
                  	</select>
             	</label>
             	<label className="checkline">
                  	Tool
                  	<select value={tool} onChange={(event) => { setTool(event.target.value); setPage(0); }}>
                      	<option value="">All</option>
                      	{(facets.data?.tools ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
                  	</select>
             	</label>
             	<label className="checkline">
                  	Status
                  	<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
                      	<option value="">All</option>
                      	<option value="success">success</option>
                      	<option value="error">error</option>
                  	</select>
             	</label>
             	<input
                  		type="search"
                  		placeholder="Search request id or project"
                  		value={search}
                  		onChange={(event) => { setSearch(event.target.value); setPage(0); }}
                  		style={{ width: 240 }}
             	/>
             	<span className="spacer" />
             	<button type="button" className="btn small" onClick={list.reload}>Refresh</button>
         	</div>

         	<ErrorNote error={list.error} />

         	<div className="card table-wrap">
             	<table>
                  	<thead>
                      	<tr>
                         	<th>Time</th>
                         	<th>Request</th>
                         	<th>Agent</th>
                         	<th>Tool</th>
                         	<th className="num">Duration</th>
                         	<th className="num">In</th>
                         	<th className="num">Out</th>
                         	<th>Status</th>
                      	</tr>
                  	</thead>
                  	<tbody>
                      	{records.map((row) => <RequestRowLine key={row.id} row={row} onOpen={() => setSelected(row.id)} />)}
                      	{!list.loading && records.length === 0 && (
                         	<tr>
                            	<td colSpan={8} className="chart-empty">No requests in this time range.</td>
                         	</tr>
                               	)}
                  	</tbody>
              	</table>
             	<Pagination page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} onMove={setPage} />
         	</div>

         	{selected !== null && (
             		<RequestDetailModal
                   	id={selected}
                   	detail={detail.data}
                   	error={detail.error}
                   	onClose={() => setSelected(null)}
               		/>
                   	)}
      		</div>
   		);
   		}

function RequestRowLine({ row, onOpen }: { row: RequestRow; onOpen: () => void }) {
   return (
      		<tr className="clickable" onClick={onOpen}>
         	<td className="nowrap">{formatDateTime(row.timestamp)}</td>
         	<td className="mono muted">{row.requestId.slice(0, 8)}</td>
         	<td>{row.caller}</td>
         	<td className="mono">{row.tool}</td>
         	<td className="num">{formatDuration(row.durationMs)}</td>
         	<td className="num">{formatNumber(row.inputTokens)}</td>
         	<td className="num">{formatNumber(row.outputTokens)}</td>
         	<td>
             	{row.status === "success"
                   	? <StatusPill tone="ok">success</StatusPill>
                   	: <StatusPill tone="bad">{row.errorCategory ?? "error"}</StatusPill>}
         	</td>
      		</tr>
   		);
   		}

function RequestDetailModal({
   id,
   detail,
   error,
   onClose,
}: {
   id: number;
   detail: RequestDetail | undefined;
   error: Error | undefined;
   onClose: () => void;
}) {
   return (
      		<div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Request ${id}`}>
         	<div className="modal" onClick={(event) => event.stopPropagation()}>
             	<div className="modal-header">
                  	<h3>Request detail</h3>
                  	<button type="button" className="btn small" onClick={onClose}>Close</button>
             	</div>
             	{error && <ErrorNote error={error} />}
             	{!detail && !error && <div className="center-note">Loading…</div>}
             	{detail && (
                  		<>
                      	<dl className="kv">
                         	<dt>Request ID</dt><dd className="mono">{detail.requestId}</dd>
                         	<dt>Time</dt><dd>{formatDateTime(detail.timestamp)}</dd>
                         	<dt>Agent</dt><dd>{detail.caller}{detail.project ? ` · ${detail.project}` : ""}</dd>
                         	<dt>Tool</dt><dd className="mono">{detail.tool}</dd>
                         	<dt>Model</dt><dd className="mono">{detail.model ?? " - "}</dd>
                         	<dt>Duration</dt><dd>{formatDuration(detail.durationMs)}</dd>
                         	<dt>Tokens</dt><dd>{formatNumber(detail.inputTokens)} in · {formatNumber(detail.outputTokens)} out</dd>
                         	<dt>Status</dt>
                         	<dd>{detail.status === "success"
                               	? <StatusPill tone="ok">success</StatusPill>
                               	: <StatusPill tone="bad">{detail.errorCategory ?? "error"}</StatusPill>}</dd>
                         	{detail.errorMessage && (<><dt>Error</dt><dd className="error-text">{detail.errorMessage}</dd></>)}
                         	<dt>Questions</dt><dd>{formatNumber(detail.questionCount)}</dd>
                         	<dt>State size</dt><dd>{detail.stateSizeChars === null ? " - " : `${formatNumber(detail.stateSizeChars)} chars`}</dd>
                         	{detail.repository && (<><dt>Repository</dt><dd className="mono">{detail.repository}</dd></>)}
                         	{detail.sessionId && (<><dt>Session</dt><dd className="mono">{detail.sessionId}</dd></>)}
                         	<dt>Content policy</dt>
                         	<dd className="muted">
                            	state: {detail.contentPolicy.requestState} · responses: {detail.contentPolicy.storeResponses ? "stored" : "not stored"}
                         	</dd>
                      	</dl>
                      	{detail.stateNote && <p className="muted">{detail.stateNote}</p>}
                      	{typeof detail.state === "object" && detail.state !== null && (
                         	<>
                            	<h4 className="card-title">Request state</h4>
                            	<pre className="code">{JSON.stringify(detail.state, null, 2)}</pre>
                         	</>
                               	)}
                      	{detail.responseNote && <p className="muted">{detail.responseNote}</p>}
                      	{typeof detail.response === "object" && detail.response !== null && (
                         	<>
                            	<h4 className="card-title">Jev response</h4>
                            	<pre className="code">{JSON.stringify(detail.response, null, 2)}</pre>
                         	</>
                               	)}
                  		</>
                   	)}
         	</div>
      		</div>
   		);
   		}
