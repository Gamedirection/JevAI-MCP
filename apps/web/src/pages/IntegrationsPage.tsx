import { useState } from "react";
import { api, downloadUrl } from "../api.ts";
import { useAsync } from "../lib/useAsync.ts";
import { formatDateTime, formatDuration, formatRelative } from "../lib/format.ts";
import { CodeBlock, ConnectionPill, ErrorNote, StatusPill } from "../components/ui.tsx";
import type { Guide, TestDecisionResult } from "../types.ts";

export function IntegrationsPage() {
   const [activeId, setActiveId] = useState<string | null>(null);
   const integrations = useAsync(() => api.integrations(), []);
   const guides = integrations.data?.guides ?? [];
   const active = guides.find((guide) => guide.id === activeId) ?? guides[0];

   return (
           	<div>
         	<div className="page-header">
             	<div>
                  	<h1 className="page-title">Integrations</h1>
                  	<p className="page-subtitle">
                       	Connect a coding agent to the MCP endpoint and download its instruction files.
                       	Configurations use the MCP URL currently saved in Settings.
                  	</p>
             	</div>
             	<div style={{ display: "flex", gap: 8 }}>
                  	{integrations.data && (
                       	<button type="button" className="btn" onClick={integrations.reload}>Refresh</button>
                         	)}
                  	<a className="btn primary" href={downloadUrl("/api/integrations/download-all")}>
                       	Download all (ZIP)
                  	</a>
             	</div>
         	</div>

         	<ErrorNote error={integrations.error} />

         	{integrations.data && (
             	<div className="banner">
                  	<span className="muted">The MCP URL agents will connect to:</span>
                  	<CodeBlock code={`${integrations.data.mcpUrl}/mcp`} />
                  	<span className="muted">
                       	Change it in Settings → Integrations so downloads match your real hostname.
                  	</span>
             	</div>
                   	)}

         	{guides.length > 0 && (
             	<div className="tabs" role="tablist" aria-label="Integrations">
                  	{guides.map((guide) => (
                       	<button
                            		key={guide.id}
                            		type="button"
                            		role="tab"
                            		aria-selected={active?.id === guide.id}
                            		className={active?.id === guide.id ? "tab active" : "tab"}
                            		onClick={() => setActiveId(guide.id)}
                       	>
                            	{guide.displayName}
                            	{guide.lastCallAt && (
                                 				<span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>
                                      				{formatRelative(guide.lastCallAt)}
                                 				</span>
                                   				)}
                       	</button>
                      	))}
             	</div>
                   	)}

         	{active && <GuidePanel guide={active} />}

         	{!integrations.loading && guides.length === 0 && !integrations.error && (
             	<div className="center-note">No integrations available.</div>
                   	)}

         	<div className="card section-gap">
             	<h2 className="card-title">Test a decision now</h2>
             	<TestDecisionPanel />
         	</div>
           	</div>
   	);
}

function GuidePanel({ guide }: { guide: Guide }) {
   return (
           	<div>
         	<div className="card">
             	<h2 className="card-title">{guide.displayName}</h2>
             	<p>{guide.summary}</p>
             	<p className="muted">
                  	{guide.requirements.length > 0 && (
                       	<>Requirements: {guide.requirements.join(" · ")} </>
                         	)}
                  	{guide.lastCallAt
                       	? <>Last seen calling this server: {formatDateTime(guide.lastCallAt)}</>
                       	: "This agent has not called the server yet."}
             	</p>
         	</div>

         	<div className="card">
             	<h2 className="card-title">Steps</h2>
             	<ol style={{ margin: 0, paddingLeft: 20 }}>
                  	{guide.steps.map((step, index) => (
                       	<li key={step.title} style={{ marginBottom: 12 }}>
                            	<strong>{step.title}</strong>
                            	{step.detail.map((line) => (
                                 				<p className="muted" key={line.slice(0, 24)} style={{ margin: "4px 0" }}>{line}</p>
                                   				))}
                            	{step.command && <CodeBlock code={step.command} />}
                            	{index === guide.steps.length - 1 && guide.testCommand && (
                                 				<div style={{ marginTop: 8 }}>
                                      				<span className="muted">Then verify:</span>
                                      				<CodeBlock code={guide.testCommand} />
                                 				</div>
                                   				)}
                       	</li>
                      	))}
             	</ol>
             	<p className="muted">{guide.verify}</p>
             	<a className="btn primary" href={downloadUrl(`/api/integrations/${guide.id}/download`)}>
                  	Download {guide.displayName} ZIP
             	</a>
         	</div>

         	<div className="card">
             	<h2 className="card-title">Files in this ZIP</h2>
             	<div className="table-wrap">
                  	<table>
                       	<thead>
                            	<tr><th>File</th><th className="num">Size</th><th /></tr>
                       	</thead>
                       	<tbody>
                            	{guide.files.map((file) => (
                                 				<tr key={file.path}>
                                      				<td className="mono">{file.path}</td>
                                      				<td className="num muted">{file.size.toLocaleString()} chars</td>
                                      				<td>
                                         					<a
                                               		className="btn small"
                                               		href={downloadUrl(`/api/integrations/${guide.id}/file/${file.path}`)}
                                         					>
                                               	View
                                         					</a>
                                      				</td>
                                 				</tr>
                                   				))}
                       	</tbody>
                  	</table>
             	</div>
         	</div>

         	<div className="card">
             	<h2 className="card-title">Troubleshooting</h2>
             	<div className="table-wrap">
                  	<table>
                       	<tbody>
                            	{guide.troubleshooting.map((entry) => (
                                 				<tr key={entry.problem}>
                                      				<td style={{ width: "40%" }}><strong>{entry.problem}</strong></td>
                                      				<td className="muted">{entry.fix}</td>
                                 				</tr>
                                   				))}
                       	</tbody>
                  	</table>
             	</div>
         	</div>
           	</div>
   	);
}

function TestDecisionPanel() {
   const [state, setState] = useState(
      	"A production application returns HTTP 502 through Kubernetes ingress. Users cannot reach the service.",
      );
   const [question, setQuestion] = useState("Which subsystem should be investigated first?");
   const [options, setOptions] = useState("application, service, ingress, storage, database");
   const [result, setResult] = useState<TestDecisionResult | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [running, setRunning] = useState(false);

   async function run() {
      setRunning(true);
      setError(null);
      setResult(null);
      try {
         const optionList = options
               	.split(",")
               	.map((option) => option.trim())
               	.filter((option) => option.length > 0);
         const data = await api.testDecision({
             	state,
             	question,
             	options: optionList.length >= 2 ? optionList : undefined,
                   });
         setResult(data);
            } catch (caught) {
         setError(caught instanceof Error ? caught.message : String(caught));
            } finally {
         setRunning(false);
            }
         }

   const answers = (result?.raw as { answers?: Record<string, unknown> } | undefined)?.answers;

   return (
           	<div>
         	<div className="grid two">
             	<div>
                  	<div className="field">
                       	<label htmlFor="test-state">Context (state)</label>
                       	<textarea id="test-state" rows={4} value={state} onChange={(event) => setState(event.target.value)} />
                  	</div>
                  	<div className="field">
                       	<label htmlFor="test-question">Question</label>
                       	<input id="test-question" type="text" value={question} onChange={(event) => setQuestion(event.target.value)} />
                  	</div>
                  	<div className="field">
                       	<label htmlFor="test-options">Options (comma separated)</label>
                       	<input id="test-options" type="text" value={options} onChange={(event) => setOptions(event.target.value)} />
                       	<span className="hint">Jev picks one option for this question.</span>
                  	</div>
                  	<button type="button" className="btn primary" onClick={run} disabled={running}>
                       	{running ? "Running…" : "Run test decision"}
                  	</button>
             	</div>
             	<div>
                  	{error && <div className="banner bad">{error}</div>}
                  	{result && (
                       	<>
                            	<div className="banner" style={{ marginBottom: 8 }}>
                                 	{result.ok
                                      	? <>
                                           	<StatusPill tone="ok">decision received</StatusPill>
                                           	<span className="muted">{formatDuration(result.durationMs)} · <span className="mono">{result.model}</span></span>
                                      	</>
                                      	: <ConnectionPill state="disconnected" />}
                                 	{result.usage?.input_tokens !== undefined && (
                                      	<span className="muted">{result.usage.input_tokens.toLocaleString()} input tokens</span>
                                    	)}
                            	</div>
                            	{answers && <pre className="code">{JSON.stringify(answers, null, 2)}</pre>}
                            	{!result.ok && result.error && (
                                 	<pre className="code">{JSON.stringify(result.error, null, 2)}</pre>
                                    	)}
                       	</>
                         	)}
                  	{!result && !error && !running && (
                       	<div className="chart-empty">Runs one real Jev decision so you can confirm the key and endpoint work.</div>
                         	)}
             	</div>
         	</div>
           	</div>
   	);
}
