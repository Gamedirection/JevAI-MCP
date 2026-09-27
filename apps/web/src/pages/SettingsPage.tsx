import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError } from "../api.ts";
import { useAsync } from "../lib/useAsync.ts";
import { formatDuration } from "../lib/format.ts";
import { CodeBlock, ConnectionPill, ErrorNote, StatusPill } from "../components/ui.tsx";
import type { AppSettings, TestDecisionResult } from "../types.ts";

export function SettingsPage() {
   const settingsResource = useAsync(() => api.settings(), []);
   const [draft, setDraft] = useState<AppSettings | null>(null);
   const [saveResult, setSaveResult] = useState<string | null>(null);
   const [saveError, setSaveError] = useState<string | null>(null);

   useEffect(() => {
      if (settingsResource.data) setDraft(structuredClone(settingsResource.data.settings));
          	}, [settingsResource.data]);

   const redacted = settingsResource.data;
   if (!draft || !redacted) {
      return (
           	<div>
                 	<h1 className="page-title">Settings</h1>
                 	{settingsResource.error && <ErrorNote error={settingsResource.error} />}
                 	{!settingsResource.error && <div className="center-note">Loading…</div>}
           	</div>
           	);
         	}

   const envLocked = new Set(redacted.envOverrideKeys);

   async function save() {
      setSaveResult(null);
      setSaveError(null);
      try {
         await api.saveSettings(draft);
         setSaveResult("Settings saved.");
         settingsResource.reload();
             } catch (caught) {
         if (caught instanceof ApiError && Array.isArray(caught.details)) {
             	setSaveError(
                   	`Invalid values: ${(caught.details as Array<{ path?: string[]; message?: string }>)
                         	.map((issue) => `${(issue.path ?? []).join(".")} ${issue.message ?? ""}`.trim())
                         	.join("; ")}`,
                   	);
                  	} else {
             	setSaveError(caught instanceof Error ? caught.message : String(caught));
                  	}
            	}
         	}

   async function resetToDefaults() {
      setSaveResult(null);
      setSaveError(null);
      try {
         await api.resetSettings();
         setSaveResult("Settings reset to defaults.");
         settingsResource.reload();
             } catch (caught) {
         setSaveError(caught instanceof Error ? caught.message : String(caught));
            	}
         	}

   function setSection<K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) {
      setDraft((current) => (current ? { ...current, [section]: { ...current[section], ...patch } } : current));
         	}

   const invalidUrl = !isHttpUrl(draft.jev.endpoint);

   return (
           	<div>
         	<div className="page-header">
             	<div>
                  	<h1 className="page-title">Settings</h1>
                  	<p className="page-subtitle">
                       	Values here persist in the local database. Environment variables take precedence when set.
                  	</p>
             	</div>
             	<div style={{ display: "flex", gap: 8 }}>
                  	<button type="button" className="btn small" onClick={resetToDefaults}>Reset to defaults</button>
                  	<button type="button" className="btn primary" onClick={save}>Save settings</button>
             	</div>
         	</div>

         	<ErrorNote error={settingsResource.error} />
         	{saveResult && <div className="banner ok">{saveResult}</div>}
         	{saveError && <div className="banner bad">{saveError}</div>}

         	<div className="banner">
             	<span className="muted">API key source:</span>
             	<StatusPill tone={redacted.apiKeySource === "none" ? "bad" : "ok"}>{redacted.apiKeySource}</StatusPill>
             	{redacted.apiKeyMasked && <span className="mono">{redacted.apiKeyMasked}</span>}
             	<span className="muted"> -  keys are never displayed or logged in full.</span>
         	</div>

         	<ApiKeyPanel
               	source={redacted.apiKeySource}
               	onChanged={() => settingsResource.reload()}
           	   />

         	<div className="card">
             	<h2 className="card-title">Jev connection</h2>
             	<div className="grid two">
                  	<EnvField name="jev.endpoint" lock={envLocked} label="DefAPI endpoint">
                       	<input
                            		type="text"
                            		value={draft.jev.endpoint}
                            		className={invalidUrl ? "invalid" : undefined}
                            		disabled={envLocked.has("jev.endpoint")}
                            		onChange={(event) => setSection("jev", { endpoint: event.target.value })}
                       		/>
                       	{invalidUrl && <span className="hint error-text">Must be a valid http(s) URL.</span>}
                  	</EnvField>
                  	<EnvField name="jev.model" lock={envLocked} label="Model">
                       	<input
                            		type="text"
                            		value={draft.jev.model}
                            		disabled={envLocked.has("jev.model")}
                            		onChange={(event) => setSection("jev", { model: event.target.value })}
                       		/>
                  	</EnvField>
                  	<EnvField name="jev.timeoutMs" lock={envLocked} label="Timeout (ms)">
                       	<NumberInput value={draft.jev.timeoutMs} min={50} max={120000} disabled={envLocked.has("jev.timeoutMs")} onChange={(v) => setSection("jev", { timeoutMs: v })} />
                  	</EnvField>
                  	<EnvField name="jev.retries" lock={envLocked} label="Retries (transient failures only)">
                       	<NumberInput value={draft.jev.retries} min={0} max={10} disabled={envLocked.has("jev.retries")} onChange={(v) => setSection("jev", { retries: v })} />
                  	</EnvField>
                  	<EnvField name="jev.retryBaseDelayMs" lock={envLocked} label="Retry base delay (ms)">
                       	<NumberInput value={draft.jev.retryBaseDelayMs} min={1} max={10000} disabled={envLocked.has("jev.retryBaseDelayMs")} onChange={(v) => setSection("jev", { retryBaseDelayMs: v })} />
                  	</EnvField>
                  	<EnvField name="jev.retryMaxDelayMs" lock={envLocked} label="Retry max delay (ms)">
                       	<NumberInput value={draft.jev.retryMaxDelayMs} min={2} max={60000} disabled={envLocked.has("jev.retryMaxDelayMs")} onChange={(v) => setSection("jev", { retryMaxDelayMs: v })} />
                  	</EnvField>
             	</div>
             	<TestConnectionButton />
         	</div>

         	<div className="card">
             	<h2 className="card-title">MCP server</h2>
             	<div className="grid two">
                  	<EnvField name="mcp.enabled" lock={envLocked} label="MCP server">
                       	<Checkbox checked={draft.mcp.enabled} disabled={envLocked.has("mcp.enabled")} onChange={(v) => setSection("mcp", { enabled: v })} label="Serve MCP endpoint /mcp" />
                  	</EnvField>
                  	<EnvField name="mcp.host" lock={envLocked} label="MCP bind host">
                       	<input type="text" value={draft.mcp.host} disabled={envLocked.has("mcp.host")} onChange={(event) => setSection("mcp", { host: event.target.value })} />
                  	</EnvField>
                  	<EnvField name="mcp.port" lock={envLocked} label="MCP standalone port">
                       	<NumberInput value={draft.mcp.port} min={1} max={65535} disabled={envLocked.has("mcp.port")} onChange={(v) => setSection("mcp", { port: v })} />
                  	</EnvField>
             	</div>
             	<p className="muted">
                  	The MCP endpoint is also always available under this dashboard at <span className="mono">/mcp</span>.
                  	The standalone port exists for deployments that expose MCP separately.
             	</p>
         	</div>

         	<div className="card">
             	<h2 className="card-title">Privacy & retention</h2>
             	<div className="grid two">
                  	<EnvField name="storage.requestState" lock={envLocked} label="What to store about request state">
                       	<select
                            		value={draft.storage.requestState}
                            		disabled={envLocked.has("storage.requestState")}
                            		onChange={(event) => setSection("storage", { requestState: event.target.value as AppSettings["storage"]["requestState"] })}
                       	>
                            	<option value="off">Off -  no request content</option>
                            	<option value="metadata_only">Metadata only -  sizes and counts (default)</option>
                            	<option value="full">Full -  store state sent to Jev</option>
                       	</select>
                       	<span className="hint">Question text and option text count as content and follow this setting.</span>
                  	</EnvField>
                  	<EnvField name="storage.storeResponses" lock={envLocked} label="Store responses">
                       	<Checkbox checked={draft.storage.storeResponses} disabled={envLocked.has("storage.storeResponses")} onChange={(v) => setSection("storage", { storeResponses: v })} label="Store answers returned by Jev" />
                  	</EnvField>
                  	<EnvField name="storage.retentionDays" lock={envLocked} label="Retention (days)">
                       	<NumberInput value={draft.storage.retentionDays} min={0} max={3650} disabled={envLocked.has("storage.retentionDays")} onChange={(v) => setSection("storage", { retentionDays: v })} />
                       	<span className="hint">0 keeps data until you delete it manually.</span>
                  	</EnvField>
                  	<EnvField name="logging.level" lock={envLocked} label="Log level">
                       	<select value={draft.logging.level} disabled={envLocked.has("logging.level")} onChange={(event) => setSection("logging", { level: event.target.value as AppSettings["logging"]["level"] })}>
                            	<option value="debug">debug</option>
                            	<option value="info">info</option>
                            	<option value="warn">warn</option>
                            	<option value="error">error</option>
                       	</select>
                  	</EnvField>
                  	<EnvField name="logging.retentionDays" lock={envLocked} label="Log retention (days)">
                       	<NumberInput value={draft.logging.retentionDays} min={1} max={3650} disabled={envLocked.has("logging.retentionDays")} onChange={(v) => setSection("logging", { retentionDays: v })} />
                  	</EnvField>
             	</div>
             	<p className="muted">
                  	API keys are stored as a hash with a masked preview. Error messages are redacted before storage.
             	</p>
         	</div>

         	<div className="card">
             	<h2 className="card-title">Metrics & savings</h2>
             	<div className="grid two">
                  	<EnvField name="metrics.tokenSavingsEnabled" lock={envLocked} label="Token savings">
                       	<Checkbox checked={draft.metrics.tokenSavingsEnabled} disabled={envLocked.has("metrics.tokenSavingsEnabled")} onChange={(v) => setSection("metrics", { tokenSavingsEnabled: v })} label="Show estimated tokens saved" />
                  	</EnvField>
                  	<EnvField name="metrics.estimatedAvoidedTokens" lock={envLocked} label="Avoided tokens per decision">
                       	<NumberInput value={draft.metrics.estimatedAvoidedTokens} min={0} max={1000000} disabled={envLocked.has("metrics.estimatedAvoidedTokens")} onChange={(v) => setSection("metrics", { estimatedAvoidedTokens: v })} />
                       	<span className="hint">Estimate of context an agent avoids loading for each answered decision.</span>
                  	</EnvField>
             	</div>
         	</div>

         	<div className="card">
             	<h2 className="card-title">Dashboard</h2>
             	<div className="grid two">
                  	<EnvField name="ui.defaultTimeRange" lock={envLocked} label="Default time range">
                       	<select value={draft.ui.defaultTimeRange} disabled={envLocked.has("ui.defaultTimeRange")} onChange={(event) => setSection("ui", { defaultTimeRange: event.target.value as AppSettings["ui"]["defaultTimeRange"] })}>
                            	<option value="today">Today</option>
                            	<option value="7d">Last 7 days</option>
                            	<option value="30d">Last 30 days</option>
                            	<option value="month">This month</option>
                            	<option value="year">This year</option>
                            	<option value="custom">Custom</option>
                       	</select>
                  	</EnvField>
                  	<EnvField name="ui.refreshIntervalSeconds" lock={envLocked} label="Auto-refresh (seconds)">
                       	<NumberInput value={draft.ui.refreshIntervalSeconds} min={0} max={3600} disabled={envLocked.has("ui.refreshIntervalSeconds")} onChange={(v) => setSection("ui", { refreshIntervalSeconds: v })} />
                       	<span className="hint">0 disables auto-refresh.</span>
                  	</EnvField>
             	</div>
         	</div>

         	<div className="card">
             	<h2 className="card-title">Integration URLs</h2>
             	<div className="grid two">
                  	<EnvField name="integration.publicProtocol" lock={envLocked} label="Public protocol">
                       	<select value={draft.integration.publicProtocol} disabled={envLocked.has("integration.publicProtocol")} onChange={(event) => setSection("integration", { publicProtocol: event.target.value as "http" | "https" })}>
                            	<option value="http">http</option>
                            	<option value="https">https</option>
                       	</select>
                  	</EnvField>
                  	<EnvField name="integration.publicHostname" lock={envLocked} label="Public hostname">
                       	<input type="text" value={draft.integration.publicHostname} disabled={envLocked.has("integration.publicHostname")} onChange={(event) => setSection("integration", { publicHostname: event.target.value })} />
                  	</EnvField>
                  	<EnvField name="integration.publicPort" lock={envLocked} label="Public MCP port">
                       	<NumberInput value={draft.integration.publicPort} min={1} max={65535} disabled={envLocked.has("integration.publicPort")} onChange={(v) => setSection("integration", { publicPort: v })} />
                  	</EnvField>
             	</div>
             	<p className="muted">This URL is written into every generated agent configuration and ZIP.</p>
             	<CodeBlock code={`${redacted.mcpUrl}/mcp`} />
         	</div>

         	{envLocked.size > 0 && (
             	<div className="banner warn">
                  	<span className="muted">
                       	Locked by environment variables: {Array.from(envLocked).join(", ")}.
                       	Set or unset the variables to change these values.
                  	</span>
             	</div>
                   	)}
           	</div>
   	);
}

function ApiKeyPanel({ source, onChanged }: { source: string; onChanged: () => void }) {
   const [key, setKey] = useState("");
   const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
   const [busy, setBusy] = useState(false);

   async function saveKey() {
      setBusy(true);
      setMessage(null);
      try {
         await api.saveApiKey(key);
         setMessage({ tone: "ok", text: "API key saved. Only the masked preview is stored." });
         setKey("");
         onChanged();
             } catch (caught) {
         setMessage({ tone: "bad", text: caught instanceof Error ? caught.message : String(caught) });
            	} finally {
         setBusy(false);
            	}
   }

   async function removeKey() {
      setBusy(true);
      setMessage(null);
      try {
         await api.deleteApiKey();
         setMessage({ tone: "ok", text: "Stored API key removed." });
         onChanged();
             } catch (caught) {
         setMessage({ tone: "bad", text: caught instanceof Error ? caught.message : String(caught) });
            	} finally {
         setBusy(false);
            	}
   }

   return (
           	<div className="card">
         	<h2 className="card-title">DefAPI API key</h2>
         	<p className="muted">
             	Preferred setup: provide <span className="mono">DEFAPI_API_KEY</span> as an environment variable.
             	You can also store the key in this application. The key is stored as a hash; you can replace it but not read it.
         	</p>
         	{message && <div className={`banner ${message.tone}`}>{message.text}</div>}
         	{source === "environment" ? (
             	<p className="muted">
                   	A key from the environment is active. Remove the environment variable to store a key here.
             	</p>
                	) : (
             	<div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                  	<div className="field" style={{ flex: 1, minWidth: 260, marginBottom: 0 }}>
                       	<label htmlFor="api-key">API key (dk-…)</label>
                       	<input
                            		id="api-key"
                            		type="password"
                            		autoComplete="off"
                            		placeholder="dk-..."
                            		value={key}
                            		onChange={(event) => setKey(event.target.value)}
                       	/>
                  	</div>
                  	<button type="button" className="btn primary" onClick={saveKey} disabled={busy || key.trim().length < 8}>
                       	{source === "database" ? "Replace key" : "Save key"}
                  	</button>
                  	{source === "database" && (
                       	<button type="button" className="btn danger" onClick={removeKey} disabled={busy}>
                            	Remove key
                       	</button>
                         	)}
             	</div>
                	)}
           	</div>
   	);
}

function TestConnectionButton() {
   const [result, setResult] = useState<TestDecisionResult | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);

   async function test() {
      setBusy(true);
      setResult(null);
      setError(null);
      try {
         setResult(await api.testJevConnection());
             } catch (caught) {
         setError(caught instanceof Error ? caught.message : String(caught));
            	} finally {
         setBusy(false);
            	}
         	}

   return (
           	<div style={{ marginTop: 8 }}>
         	<button type="button" className="btn" onClick={test} disabled={busy}>
             	{busy ? "Testing…" : "Test connection"}
         	</button>
         	{result && (
             	<span style={{ marginLeft: 10 }}>
                  	{result.ok
                       	? <><StatusPill tone="ok">connected</StatusPill> <span className="muted">{formatDuration(result.durationMs)}</span></>
                       	: <><ConnectionPill state="disconnected" /> <span className="error-text">{result.error?.message}</span></>}
             	</span>
                	)}
         	{error && <span className="error-text" style={{ marginLeft: 10 }}>{error}</span>}
           	</div>
   	);
}

function EnvField({
   name,
   lock,
   label,
   children,
}: {
   name: string;
   lock: Set<string>;
   label: string;
   children: ReactNode;
}) {
   const locked = lock.has(name);
   return (
           	<div className="field">
         	<label>
             	{label}
             	{locked && (
                 	<span className="pill info" title={`Set by environment variable: ${name}`}>
                    	env
                 	</span>
                    	)}
         	</label>
         	{children}
           	</div>
         	);
         	}

function NumberInput({
   value,
   min,
   max,
   disabled,
   onChange,
}: {
   value: number;
   min: number;
   max: number;
   disabled: boolean;
   onChange: (value: number) => void;
}) {
   const [text, setText] = useState(String(value));
   useEffect(() => setText(String(value)), [value]);
   const outOfRange = text.trim() !== "" && !/^\d+$/.test(text.trim());
   return (
           	<input
                 	type="text"
                 	inputMode="numeric"
                 	value={text}
                 	disabled={disabled}
                 	className={outOfRange ? "invalid" : undefined}
                 	aria-invalid={outOfRange}
                 	onChange={(event) => {
                       	setText(event.target.value);
                       	const parsed = Number.parseInt(event.target.value, 10);
                       	if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
                            	}}
                 	style={{ maxWidth: 200 }}
           	/>
         	);
         	}

function Checkbox({
   checked,
   disabled,
   label,
   onChange,
}: {
   checked: boolean;
   disabled: boolean;
   label: string;
   onChange: (value: boolean) => void;
}) {
   return (
           	<label className="checkline">
                 	<input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
                 	{label}
           	</label>
         	);
         	}

function isHttpUrl(value: string): boolean {
   try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
        } catch {
   return false;
        }
}
