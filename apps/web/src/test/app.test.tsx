import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.tsx";

function renderApp() {
   return render(
      	<MemoryRouter>
         	<App />
      	</MemoryRouter>,
      	);
   }

function jsonResponse(data: unknown): Promise<Response> {
   return Promise.resolve(
      	new Response(JSON.stringify({ success: true, data }), {
           	status: 200,
           	headers: { "Content-Type": "application/json" },
                	}),
      	);
      }

beforeEach(() => {
   vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
            const path = String(input);
           	if (path.includes("/api/bootstrap")) {
                 	return jsonResponse({
                       	version: { version: "1.0.0", applicationName: "JevAI-MCP", commit: null, buildDate: null },
                       	defaultTimeRange: "7d",
                       	refreshIntervalSeconds: 0,
                       	mcpUrl: "http://localhost:3001",
                       	apiKeySource: "none",
                       	thresholds: { use: 0.8, guidance: 0.55, noulYes: 0.8, noulNo: 0.2 },
                       	tokenSavings: { enabled: true, estimatedAvoidedTokens: 1500 },
                       	mcpEnabled: true,
                         	});
                  	}
           	if (path.includes("/api/version")) {
                 	return jsonResponse({ version: "1.0.0", commit: null, buildDate: null });
                  	}
           	if (path.includes("/api/dashboard")) {
                 	return jsonResponse({
                       	timeRange: { from: new Date().toISOString(), to: new Date().toISOString(), label: "Last 7 days", bucketSeconds: 3600 },
                       	summary: {
                             	totalCalls: 3, successfulCalls: 2, failedCalls: 1, successRate: 66.7,
                             	avgDurationMs: 120, inputTokens: 450, estimatedTokensSaved: 3000,
                             	tokenSavingsEnabled: true, activeClients: 1, lastRequestAt: new Date().toISOString(),
                               	},
                       	serviceStatus: {
                             	app: "healthy", jev: "connected", database: "healthy", mcp: "running",
                             	lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null, totalDisconnects: 0,
                               	},
                       	timeline: [],
                       	byCaller: [{ key: "codex", count: 2, success: 2, failed: 0, avgDurationMs: 100, inputTokens: 200, lastSeenAt: new Date().toISOString() }],
                       	byTool: [{ key: "jev_decide", count: 2, success: 2, failed: 0, avgDurationMs: 100, inputTokens: 200, lastSeenAt: new Date().toISOString() }],
                         	});
                  	}
           	if (path.includes("/api/agents")) {
                 	return jsonResponse([
                       	{
                             	caller: "codex", known: true, requests: 2, successRate: 100,
                             	avgDurationMs: 100, inputTokens: 200, mostUsedTool: "jev_decide",
                             	lastSeenAt: new Date().toISOString(), lastSeenSecondsAgo: 5,
                               	},
                         	]);
                  	}
           	return jsonResponse([]);
             	}),
      );
          	});

describe("dashboard shell", () => {
   it("renders navigation and known callers", async () => {
      renderApp();
      const dashboardHeadings = await screen.findAllByText("Dashboard");
      expect(dashboardHeadings.length).toBeGreaterThan(1);
      expect(await screen.findByText("codex")).toBeInTheDocument();
          	});

   it("shows the fail-open promise in the footer", async () => {
      renderApp();
      expect(
         	await screen.findByText("The Jev decision model is an optimization, never a dependency."),
             	).toBeInTheDocument();
          	});
});
