export const APP_NAME = "JevAI-MCP";

export const KNOWN_CALLERS = [
   "codex",
   "claude-code",
   "opencode",
   "gemini",
   "generic",
   "unknown",
] as const;

export type KnownCaller = (typeof KNOWN_CALLERS)[number];

export const KNOWN_CALLER_SET: ReadonlySet<string> = new Set(KNOWN_CALLERS);

export const MCP_TOOL_NAMES = [
   "jev_decide",
   "jev_route_task",
   "jev_assess_complexity",
   "jev_should_escalate",
   "jev_choose_strategy",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const COMPLEXITY_LEVELS = [
   "No code changes needed. Read-only questions, answering, or verification.",
   "Small, local change. One or two files, well-understood pattern, no behavior change beyond the request.",
   "Moderate change. Multiple files, some design decisions, limited blast radius.",
   "Complex change. Architecture decisions, multiple subsystems, or uncertain approach.",
   "High-risk change. Production impact, data loss potential, security-sensitive, or irreversible actions possible.",
] as const;

export const TASK_TYPE_CRITERIA: Record<string, string> = {
   bug: "Fixing incorrect behavior, crashes, or defects.",
   feature: "Adding new functionality requested by a user or product.",
   refactor: "Restructuring existing code without changing external behavior.",
   documentation: "Writing or updating docs, comments, READMEs, or guides.",
   investigation: "Diagnosing, reproducing, or understanding something; no code change decided yet.",
   infrastructure: "CI/CD, provisioning, containers, networking, or platform work.",
   security: "Vulnerabilities, auth, permissions, secrets, or security review.",
   testing: "Writing, fixing, or improving tests and test infrastructure.",
   deployment: "Releasing, rolling out, rolling back, or monitoring deployments.",
   other: "None of the above categories fit.",
};

export const ESCALATION_CONSIDERATIONS =
   "Consider: ambiguity of the request; production impact; number of systems involved; " +
   "security implications; destructive or irreversible actions; architecture changes; " +
   "and whether the provided context is insufficient to proceed safely.";

export const DEFAULT_EXAMPLE_STATE =
   "A production application returns HTTP 502 through Kubernetes ingress. " +
   "Users cannot reach the service. The deployment rolled out 20 minutes ago.";

export const DEFAULT_EXAMPLE_QUESTION = "Which subsystem should be investigated first?";

export const DEFAULT_EXAMPLE_OPTIONS = [
   "application",
   "service",
   "ingress",
   "storage",
   "database",
] as const;

export const RETENTION_DAYS_OPTIONS = [7, 30, 90, 365] as const;

export const UNLIMITED_RETENTION_DAYS = 0;

export const SERVER_INSTRUCTIONS = [
   "JevAI-MCP provides fast typed decisions from the Jev decision model.",
   "Use Jev for structured decisions: classify a task, select a strategy from known options, estimate complexity, evaluate risk, prioritize investigation paths, or decide whether deeper reasoning is justified.",
   "Batch every related question that shares the same context into one jev_decide call. Do not call Jev once per question.",
   "Do not call Jev for code generation, writing, explanations, deterministic operations, exact arithmetic, or decisions that are already obvious or have a single valid option.",
   "Follow the guidance levels: use a decision when guidance is 'use'; treat 'guidance' as advice; decide independently when guidance is 'independent' or the verdict is 'agent_decides'.",
   "If JevAI-MCP is unavailable or returns success=false, continue using your normal reasoning process. Jev is an optimization, never a dependency.",
].join(" ");
