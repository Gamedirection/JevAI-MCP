<!-- Generated file. Regenerate with: npm run generate:integrations
     The live server generates the same files with the MCP URL configured in Settings. -->

# When to call JevAI-MCP

JevAI-MCP exposes the Jev decision model through the MCP server at http://localhost:3001.
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

Pass caller metadata on every call: {"caller": "custom"}. Optionally add client_version, project, repository, session_id.