import { useState } from "react";
import type { ReactNode } from "react";
import type { ConnectionState } from "../types.ts";

const CONNECTION_TONE: Record<ConnectionState, string> = {
   connected: "ok",
   recovered: "ok",
   disconnected: "bad",
   timeout: "warn",
   auth_failure: "bad",
   rate_limited: "warn",
   unknown: "",
};

export function StatusPill({ tone, children }: { tone: string; children: ReactNode }) {
   return (
      	<span className={`pill ${tone}`}>
         	<span className="dot" aria-hidden="true" />
         	{children}
      	</span>
   	);
}

export function ConnectionPill({ state }: { state: ConnectionState }) {
   return <StatusPill tone={CONNECTION_TONE[state] ?? ""}>{state.replace(/_/g, " ")}</StatusPill>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
   const [copied, setCopied] = useState(false);
   return (
      	<button
         		type="button"
         		className="copy-btn"
         		onClick={() => {
             	void navigator.clipboard?.writeText(text).then(
                   	() => {
                      	setCopied(true);
                      	setTimeout(() => setCopied(false), 1600);
                   		},
                   	() => undefined,
                	);
                	}}
         		aria-label={`${label}: ${text.slice(0, 40)}`}
      	>
         	{copied ? "Copied" : label}
      	</button>
   	);
}

export function CodeBlock({ code }: { code: string }) {
   return (
      	<div className="code-line">
         	<pre className="code">{code}</pre>
         	<CopyButton text={code} />
      	</div>
   	);
}

export function CenterNote({ children }: { children: ReactNode }) {
   return <div className="center-note">{children}</div>;
}

export function ErrorNote({ error }: { error: Error | undefined }) {
   if (!error) return null;
   return (
      	<div className="banner bad" role="alert">
         	<span className="error-text">{error.message}</span>
      	</div>
   	);
}

export function Pagination({
   page,
   pageCount,
   onMove,
}: {
   page: number;
   pageCount: number;
   onMove: (next: number) => void;
}) {
   if (pageCount <= 1) return null;
   return (
      	<div className="pagination">
         	<button type="button" className="btn small" disabled={page <= 0} onClick={() => onMove(page - 1)}>
             	Previous
         	</button>
         	<span>
             	Page {page + 1} of {pageCount}
         	</span>
         	<button
             		type="button"
             		className="btn small"
             		disabled={page >= pageCount - 1}
             		onClick={() => onMove(page + 1)}
         	>
             	Next
         	</button>
      	</div>
   	);
}
