import { z } from "zod";
import {
   callerMetaSchema,
   jevStateSchema,
   questionsSchema,
} from "@jevai/shared";

export const jevDecideInputSchema = z.object({
   state: jevStateSchema,
   questions: questionsSchema,
   caller: callerMetaSchema.optional(),
   metadata: z.record(z.string(), z.unknown()).optional(),
});

export const jevRouteTaskInputSchema = z.object({
   state: jevStateSchema,
   choices: z.record(z.string().min(1).max(200), z.string().min(1).max(800).nullable()).optional(),
   caller: callerMetaSchema.optional(),
   metadata: z.record(z.string(), z.unknown()).optional(),
});

export const jevAssessComplexityInputSchema = z.object({
   state: jevStateSchema,
   caller: callerMetaSchema.optional(),
   metadata: z.record(z.string(), z.unknown()).optional(),
});

export const jevShouldEscalateInputSchema = z.object({
   state: jevStateSchema,
   caller: callerMetaSchema.optional(),
   metadata: z.record(z.string(), z.unknown()).optional(),
});

export const jevChooseStrategyInputSchema = z.object({
   state: jevStateSchema,
   strategies: z.record(z.string().min(1).max(200), z.string().min(1).max(800).nullable()),
   caller: callerMetaSchema.optional(),
   metadata: z.record(z.string(), z.unknown()).optional(),
});

export type JevDecideInput = z.infer<typeof jevDecideInputSchema>;
export type JevRouteTaskInput = z.infer<typeof jevRouteTaskInputSchema>;
export type JevAssessComplexityInput = z.infer<typeof jevAssessComplexityInputSchema>;
export type JevShouldEscalateInput = z.infer<typeof jevShouldEscalateInputSchema>;
export type JevChooseStrategyInput = z.infer<typeof jevChooseStrategyInputSchema>;

export const JEV_DECIDE_DESCRIPTION = `Ask Jev for one or more structured decisions about a state in a single request.

Use this when several related decisions share the same context. Batch them into one call as a map of questions. Each question is one of:
- choice: pick one option from a criteria map of labelled options.
- score: position the state on an ordered scale of 2-10 level descriptions.
- noul: a calibrated yes/no probability for a statement.

Returns typed answers with probabilities and confidence. If JevAI-MCP is unavailable, continue using your normal reasoning process.`;

export const JEV_ROUTE_TASK_DESCRIPTION = `Classify what type of software engineering task is being performed.

Default categories: bug, feature, refactor, documentation, investigation, infrastructure, security, testing, deployment, other. Provide custom choices to override the defaults.

Batch related questions (for example task type plus complexity) into a single jev_decide call instead of several calls. If JevAI-MCP is unavailable, continue using your normal reasoning process.`;

export const JEV_ASSESS_COMPLEXITY_DESCRIPTION = `Estimate task complexity and risk on an ordered scale: trivial, small, moderate, complex, high-risk.

Use the score answer with its level legend. Treat low-confidence results as guidance and apply your own judgement. If JevAI-MCP is unavailable, continue using your normal reasoning process.`;

export const JEV_SHOULD_ESCALATE_DESCRIPTION = `Determine whether the primary AI should escalate to deeper or more expensive reasoning.

Jev considers ambiguity, production impact, number of systems involved, security implications, destructive actions, architecture changes, and insufficient context. The answer is the probability that escalation is justified.

Confidence rules: probability >= 0.80 strong yes; probability <= 0.20 strong no; in between the primary agent decides. If JevAI-MCP is unavailable, continue using your normal reasoning process.`;

export const JEV_CHOOSE_STRATEGY_DESCRIPTION = `Select the best first investigation strategy or tool from caller-provided strategies.

Example strategies: inspect_logs, inspect_git_diff, inspect_application, inspect_ingress, inspect_database, inspect_storage, inspect_network. Describe each strategy in the criteria so Jev can rank them.

Use the probabilities to prioritize investigation paths. If JevAI-MCP is unavailable, continue using your normal reasoning process.`;
