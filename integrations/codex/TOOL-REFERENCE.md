<!-- Generated file. Regenerate with: npm run generate:integrations
     The live server generates the same files with the MCP URL configured in Settings. -->

# JevAI-MCP tool reference

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
