export interface IntegrationContext {
   mcpUrl: string;
   serverName: string;
   appName: string;
}

export interface IntegrationStep {
   title: string;
   detail?: string[];
   command?: string;
   code?: string;
   language?: string;
   copyable?: boolean;
}

export interface IntegrationGuide {
   id: "codex" | "claude" | "opencode" | "gemini" | "generic";
   displayName: string;
   summary: string;
   requirements: string[];
   steps: IntegrationStep[];
   verify: string;
   testCommand?: string;
   troubleshooting: Array<{ problem: string; fix: string }>;
   files: Array<{ path: string; content: string }>;
   zipName: string;
    }

function routingPolicySection(ctx: IntegrationContext): string {
   return `# When to call JevAI-MCP

JevAI-MCP exposes the Jev decision model through the MCP server at ${ctx.mcpUrl}.
Jev is a router, not the primary coder. Use it to make structured decisions cheaply and quickly.

## Call Jev for

- classify the type of a task (bug, feature, refactor, documentation, investigation, infrastructure, security, testing, deployment);
- select one strategy from a known set of options;
- estimate task complexity (trivial, small, moderate, complex, high-risk);
- evaluate risk and whether to prioritize one investigation path over another;
- decide which subsystem to investigate first (logs, git diff, application, ingress, database, storage, network);
- decide whether more context is required before acting;
- decide whether expensive deep reasoning is justified by the decision at stake;
- choose between tools when several are reasonable;
- classify CI, infrastructure, Kubernetes, and test failures into a root-cause domain.

## Do not call Jev for

- code generation, natural-language writing, or explanations;
- deterministic operations, exact arithmetic, or simple shell commands;
- tasks already obvious from context;
- decisions where only one option is valid;
- tiny decisions where MCP round-trip latency exceeds the value of the answer;
- every individual reasoning step of a task.

Jev must reduce work. It must not become another unnecessary step.

## Batch decisions

When several questions share the same context, send them in ONE jev_decide call.

Bad: four separate calls for task type, complexity, risk, and escalation.
Good: one call with a state and four questions (task_type, complexity, risk, escalation).

Batching reduces repeated tokens, API calls, latency, and cost.

## Confidence rules

Defaults. Tune them per project.

- confidence >= 0.80: use the decision.
- confidence 0.55 to 0.79: treat the decision as guidance.
- confidence < 0.55: decide independently yourself.

For probability-based yes/no (noul) answers:

- probability >= 0.80: strong yes.
- probability <= 0.20: strong no.
- probability 0.21 to 0.79: you decide.

## When JevAI-MCP is unavailable

If a Jev tool returns success=false, times out, or the server is unreachable, continue with your
normal reasoning process. Never block work on Jev. Jev is an optimization, not a dependency.
`;
}

function toolReference(): string {
   return `# JevAI-MCP tool reference

## jev_decide
General-purpose batched decision call.
Inputs: state (string/object/array), questions (map of {type: choice|score|noul, instructions, criteria?}), caller {caller, client_version?, project?, repository?, session_id?}, metadata (optional).
Returns: answers map, usage (input tokens), duration, guidance levels.

choice: criteria is a map { key: "what this option means" } (null values allowed). Returns chosen key, probabilities, confidence.
score: criteria is an ordered array of 2-10 level descriptions (describe each level concretely, not just "medium"). Returns score, probabilities, legend, confidence.
noul: no criteria needed. Returns calibrated probability (0-1) that the statement is true.

## jev_route_task
Classifies the task type. Optional choices map overrides the defaults
(bug, feature, refactor, documentation, investigation, infrastructure, security, testing, deployment, other).

## jev_assess_complexity
Ordered scale: trivial, small, moderate, complex, high-risk.

## jev_should_escalate
Returns the probability that deeper reasoning is justified. Consider ambiguity,
production impact, number of systems, security, destructive actions, architecture changes, and insufficient context.

## jev_choose_strategy
Selects the best first strategy from your provided strategies map
(for example inspect_logs, inspect_git_diff, inspect_application, inspect_ingress, inspect_database, inspect_storage, inspect_network).

Always include caller metadata such as {"caller": "codex", "project": "my-project"} so usage is attributed correctly.
`;
}

function callerBlock(caller: string): string {
   return `Pass caller metadata on every call: {"caller": "${caller}"}. Optionally add client_version, project, repository, session_id.`;
}

function troubleshootingRows(extra: Array<{ problem: string; fix: string }> = []): Array<{ problem: string; fix: string }> {
   return [
      {
          problem: "The agent does not see Jev tools.",
          fix: "Verify the server is running and reachable from the agent machine (curl the health endpoint). Confirm the MCP entry has the correct transport type for the tool.",
           },
      {
          problem: "Tools load but calls return JEV_UNAVAILABLE.",
          fix: "The DefAPI key may be missing or invalid. Confirm 'API Key Source' on the Settings page and use Test Connection.",
           },
      {
          problem: "Connection fails immediately after correct URL.",
          fix: "Confirm the URL includes the path and no stray trailing slash, and confirm the transport key spelled for that tool (http for Claude/Gemini, remote for OpenCode, url-table for Codex).",
           },
      ...extra,
        ];
}

export function codexGuide(ctx: IntegrationContext): IntegrationGuide {
   const toml = `# ${ctx.serverName} decision routing -  add to ~/.codex/config.toml
[mcp_servers.${ctx.serverName}]
url = "${ctx.mcpUrl}/mcp"`;
   const routing = `${routingPolicySection(ctx)}\n${callerBlock("codex")}`;
   return {
      id: "codex",
      displayName: "Codex",
      summary: "Connect Codex CLI (and the ChatGPT desktop Codex host) to JevAI-MCP over streamable HTTP.",
      requirements: [
          "OpenAI Codex CLI installed and signed in",
          "Network access to the JevAI-MCP server",
           ],
      steps: [
         {
            title: "Add the MCP server",
            detail: ["Codex stores MCP servers in ~/.codex/config.toml together with other Codex settings."],
            command: `codex mcp add ${ctx.serverName} --url ${ctx.mcpUrl}/mcp`,
             },
         {
            title: "Or configure config.toml directly",
            detail: ["Edit ~/.codex/config.toml (or .codex/config.toml inside a trusted project for a project-scoped server)."],
            code: toml,
            language: "toml",
            copyable: true,
             },
         {
            title: "Install the routing instructions",
            detail: ["Copy jev-routing.md into the directory you work on, or reference it from AGENTS.md.",
                       "Codex reads AGENTS.md from the project root and uses it as session guidance."],
             },
         {
            title: "Test the MCP connection",
            command: "codex mcp list",
             },
         {
            title: "Verify Jev is called",
            detail: ["Start codex, describe a task, and watch for jev_route_task or jev_decide calls.",
                       "Each call appears on the JevAI-MCP dashboard within a few seconds."],
             },
           ],
      verify: "codex mcp list shows the server as enabled with transport streamable_http and status connected.",
      testCommand: "codex mcp list",
      troubleshooting: troubleshootingRows([
          { problem: "Error loading config.toml: url is not supported for stdio",
             fix: "The entry lost its url-based transport. Remove the [mcp_servers.NAME] block and re-add it with --url." },
            ]),
      files: [
         { path: "AGENTS.md", content: `# Agent instructions\n\nThe jev-routing.md file in this directory is the routing policy for JevAI-MCP.\nFollow it when deciding whether to call Jev.\n\nSee jev-routing.md for the full policy.\n` },
         { path: "jev-routing.md", content: routing },
         { path: "config.toml.example", content: toml },
         { path: "TOOL-REFERENCE.md", content: toolReference() },
         { path: "README.md", content: integrationReadme(ctx, "Codex") },
           ],
      zipName: "codex-jev-integration.zip",
        };
}

export function claudeGuide(ctx: IntegrationContext): IntegrationGuide {
   const mcpJson = `{
   "mcpServers": {
      "${ctx.serverName}": {
         "type": "http",
         "url": "${ctx.mcpUrl}/mcp"
         }
      }
}`;
   const routing = `${routingPolicySection(ctx)}\n${callerBlock("claude-code")}`;
   return {
      id: "claude",
      displayName: "Claude Code",
      summary: "Connect Claude Code to JevAI-MCP over the streamable HTTP transport.",
      requirements: [
          "Claude Code installed (claude CLI)",
          "Network access to the JevAI-MCP server",
           ],
      steps: [
         {
            title: "Add the MCP server",
            detail: ["Registers the server for the current project (local scope). Add --scope user to make it active in all projects."],
            command: `claude mcp add --transport http ${ctx.serverName} ${ctx.mcpUrl}/mcp`,
             },
         {
            title: "Or edit .mcp.json directly",
            detail: ["Create .mcp.json at the project root (or add to ~/.claude.json for user scope).",
                       "The type field is required. Without type Claude Code treats the entry as stdio and skips it.",
                       "streamable-http is accepted as an alias for http."],
            code: mcpJson,
            language: "json",
            copyable: true,
             },
         {
            title: "Install agent instructions",
            detail: ["Append the routing policy to CLAUDE.md in the project, or import jev-routing.md.",
                       "CLAUDE.md is read automatically at session start."],
             },
         {
            title: "Test the MCP connection",
            command: "claude mcp list",
             },
         {
            title: "Verify Jev is called",
            detail: ["In a Claude session run /mcp to confirm the tools are loaded.",
                       "Describe a task and watch for jev_route_task calls on the dashboard."],
             },
           ],
      verify: "claude mcp list reports the server with a check mark and /mcp shows the five jev tools.",
      testCommand: `claude mcp get ${ctx.serverName}`,
      troubleshooting: troubleshootingRows([
          { problem: "Entry with a url but no type",
             fix: "Add \"type\": \"http\" to the .mcp.json entry. A typeless url entry is read as stdio and skipped." },
          { problem: "Edited .mcp.json but changes do not apply",
             fix: "Claude Code reads .mcp.json at session start. Restart the session." },
            ]),
      files: [
        { path: "CLAUDE.md", content: `${routing}\n` },
        { path: "jev-routing.md", content: routing },
        { path: "mcp.json.example", content: mcpJson },
        { path: "TOOL-REFERENCE.md", content: toolReference() },
        { path: "README.md", content: integrationReadme(ctx, "Claude Code") },
           ],
      zipName: "claude-jev-integration.zip",
       };
}

export function opencodeGuide(ctx: IntegrationContext): IntegrationGuide {
   const json = `{
   "$schema": "https://opencode.ai/config.json",
   "mcp": {
      "${ctx.serverName}": {
         "type": "remote",
         "url": "${ctx.mcpUrl}/mcp",
         "enabled": true,
         "oauth": false
         }
      }
}`;
   const routing = `${routingPolicySection(ctx)}\n${callerBlock("opencode")}`;
   const rules = `# Jev routing rules\n\nThese rules apply to every agent in this project.\n\n${routing}`;
   return {
      id: "opencode",
      displayName: "OpenCode",
      summary: "Connect OpenCode to JevAI-MCP with the remote (streamable HTTP) MCP transport.",
      requirements: [
          "OpenCode installed",
          "Network access to the JevAI-MCP server",
           ],
      steps: [
         {
            title: "Add the MCP server",
            detail: ["Add an entry under mcp in opencode.json at the project root, or in ~/.config/opencode/opencode.json for global scope.",
                       "type remote selects the streamable HTTP transport. Set oauth false so OpenCode does not try an OAuth flow first.",
                       "Secrets stay in environment variables; never commit raw tokens."],
            code: json,
            language: "jsonc",
            copyable: true,
             },
         {
            title: "Install agent instructions",
            detail: ["Place jev-routing.md into the .opencode/ directory or reference it from the project instructions.",
                       "Custom rules can also live in AGENTS.md which OpenCode reads."],
             },
         {
            title: "Test the MCP connection",
            detail: ["Open opencode and check the MCP status. Tools jev_decide and friends should appear."],
             },
         {
            title: "Verify Jev is called",
            detail: ["Describe a task and confirm jev tool calls appear in the TUI and on the dashboard."],
             },
           ],
      verify: "OpenCode lists the server as connected and exposes the five jev tools.",
      troubleshooting: troubleshootingRows([
          { problem: "Server stays on needs_auth",
             fix: "Set oauth false for the server entry. OpenCode otherwise attempts an OAuth flow; this server uses no auth." },
          { problem: "Tools missing",
             fix: "The default timeout for fetching tools is 5000 ms. Raise timeout if the server is remote or slow." },
            ]),
      files: [
         { path: "opencode.json.example", content: json },
         { path: "instructions.md", content: rules },
         { path: "jev-routing.md", content: routing },
         { path: "AGENTS.md", content: rules },
         { path: "TOOL-REFERENCE.md", content: toolReference() },
         { path: "README.md", content: integrationReadme(ctx, "OpenCode") },
           ],
      zipName: "opencode-jev-integration.zip",
        };
}

export function geminiGuide(ctx: IntegrationContext): IntegrationGuide {
   const settingsJson = `{
   "mcpServers": {
      "${ctx.serverName}": {
         "httpUrl": "${ctx.mcpUrl}/mcp",
         "trusted": true,
         "timeout": 30000
         }
      }
}`;
   const routing = `${routingPolicySection(ctx)}\n${callerBlock("gemini")}`;
   return {
      id: "gemini",
      displayName: "Gemini CLI",
      summary: "Connect Gemini CLI to JevAI-MCP using the httpUrl (streamable HTTP) transport.",
      requirements: [
          "Gemini CLI installed",
          "Network access to the JevAI-MCP server",
           ],
      steps: [
         {
            title: "Add the MCP server",
            detail: ["Add the server at user scope with -s user so it is available in every project.",
                       "Without -s it writes a project-scoped file and the server exists only in that directory."],
            command: `gemini mcp add --transport http -s user ${ctx.serverName} ${ctx.mcpUrl}/mcp`,
             },
         {
            title: "Or edit settings.json directly",
            detail: ["Add the entry to ~/.gemini/settings.json.",
                       "Use httpUrl for streamable HTTP. url means SSE and will fail silently against a streamable HTTP endpoint."],
            code: settingsJson,
            language: "json",
            copyable: true,
             },
         {
            title: "Install agent instructions",
            detail: ["Reference jev-routing.md from GEMINI.md in the project. Gemini CLI loads GEMINI.md as context."],
             },
         {
            title: "Test the MCP connection",
            command: "gemini mcp list",
             },
         {
            title: "Verify Jev is called",
            detail: ["Start gemini, describe a task, and confirm jev calls reach the dashboard."],
             },
           ],
      verify: "gemini mcp list shows the server connected, and /mcp in the CLI lists the jev tools.",
      testCommand: "gemini mcp list",
      troubleshooting: troubleshootingRows([
          { problem: "Server silent, no tools, no error",
             fix: "Check settings.json uses httpUrl, not url. url selects the SSE transport and connection errors for background servers are quiet." },
          { problem: "Works in one folder only",
             fix: "Re-add with -s user. Project-scope entries apply only to the directory they were added in." },
            ]),
      files: [
         { path: "GEMINI.md", content: routing },
         { path: "jev-routing.md", content: routing },
         { path: "settings.json.example", content: settingsJson },
         { path: "TOOL-REFERENCE.md", content: toolReference() },
         { path: "README.md", content: integrationReadme(ctx, "Gemini CLI") },
           ],
      zipName: "gemini-jev-integration.zip",
        };
}

export function genericGuide(ctx: IntegrationContext): IntegrationGuide {
   const config = `{
   "mcpServers": {
      "${ctx.serverName}": {
         "type": "streamable-http",
         "url": "${ctx.mcpUrl}/mcp"
         }
      }
}`;
   const routing = `${routingPolicySection(ctx)}\n${callerBlock("custom")}`;
   return {
      id: "generic",
      displayName: "Generic MCP client",
      summary: "Connect any MCP client that supports the streamable HTTP transport.",
      requirements: ["An MCP client that supports streamable HTTP transport"],
      steps: [
         {
            title: "MCP connection",
            detail: ["Endpoint summary: streamable HTTP. No authentication is required on a trusted internal network.",
                       "The endpoint is a single URL. There are no stdio commands."],
            code: config,
            language: "json",
            copyable: true,
             },
         {
            title: "Install instructions",
            detail: ["Copy JEV-ROUTING.md wherever your client loads persistent instructions from",
                       "(AGENTS.md, system prompts, or knowledge files)."],
             },
         {
            title: "Test",
            detail: ["Send an initialize request with POST to the /mcp endpoint. A valid result lists the five jev tools."],
            command: `curl -s ${ctx.mcpUrl}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' | head -c 400`,
             },
         {
            title: "Verify tools",
            detail: ["Call tools/list the same way and expect jev_decide, jev_route_task, jev_assess_complexity, jev_should_escalate, jev_choose_strategy."],
             },
           ],
      verify: "initialize returns a serverInfo response and tools/list returns the five tools.",
      troubleshooting: troubleshootingRows(),
      files: [
         { path: "JEV-ROUTING.md", content: routing },
         { path: "mcp-config.example.json", content: config },
         { path: "TOOL-REFERENCE.md", content: toolReference() },
         { path: "README.md", content: integrationReadme(ctx, "Generic MCP") },
           ],
      zipName: "generic-jev-integration.zip",
        };
}

function integrationReadme(ctx: IntegrationContext, name: string): string {
   return `# ${name} integration package

Server: ${ctx.serverName}
JevAI-MCP address: ${ctx.mcpUrl}
Generated from the JevAI-MCP Integrations page.

Contents
- jev-routing.md: shared routing policy. Install it where ${name} reads instructions.
- TOOL-REFERENCE.md: description of the five tools.
- Example MCP configuration for ${name}.

If JevAI-MCP is unavailable, continue with your normal reasoning.
`;
}

export function allGuides(ctx: IntegrationContext): IntegrationGuide[] {
   return [codexGuide(ctx), claudeGuide(ctx), opencodeGuide(ctx), geminiGuide(ctx), genericGuide(ctx)];
}
