import { z } from "zod";

export const jevStateSchema = z.union([
   z.string().min(1).max(200_000),
   z.record(z.string(), z.unknown()),
   z.array(z.string().min(1)),
]);

export type JevState = z.infer<typeof jevStateSchema>;

export const choiceQuestionSchema = z.object({
   type: z.literal("choice"),
   instructions: z.string().min(1).max(8_000),
   criteria: z.record(z.string().min(1).max(200), z.string().min(1).max(800).nullable()),
});

export const scoreQuestionSchema = z.object({
   type: z.literal("score"),
   instructions: z.string().min(1).max(8_000),
   criteria: z.array(z.string().min(1).max(800)).min(2).max(10),
});

export const noulQuestionSchema = z.object({
   type: z.literal("noul"),
   instructions: z.string().min(1).max(8_000),
   criteria: z.record(z.string(), z.string()).optional(),
});

export const jevQuestionSchema = z.discriminatedUnion("type", [
   choiceQuestionSchema,
   scoreQuestionSchema,
   noulQuestionSchema,
]);

export type JevQuestion = z.infer<typeof jevQuestionSchema>;
export type ChoiceQuestion = z.infer<typeof choiceQuestionSchema>;
export type ScoreQuestion = z.infer<typeof scoreQuestionSchema>;
export type NoulQuestion = z.infer<typeof noulQuestionSchema>;

export const questionsSchema = z
   .record(z.string().min(1).max(100), jevQuestionSchema)
   .refine((q) => Object.keys(q).length >= 1, "At least one question is required")
   .refine((q) => Object.keys(q).length <= 32, "At most 32 questions per request");

const numberInRange = (min: number, max: number) =>
   z.number().refine((n) => Number.isFinite(n) && n >= min && n <= max);

export const choiceAnswerSchema = z.object({
   type: z.literal("choice"),
   choice: z.string(),
   confidence: numberInRange(0, 1).optional(),
   probabilities: z.record(z.string(), z.number()).optional(),
});

export const scoreAnswerSchema = z.object({
   type: z.literal("score"),
   score: z.number(),
   confidence: numberInRange(0, 1).optional(),
   probabilities: z.record(z.string(), z.number()).optional(),
   legend: z.record(z.string(), z.string()).optional(),
});

export const noulAnswerSchema = z.object({
   type: z.literal("noul"),
   noul: numberInRange(0, 1),
   confidence: numberInRange(0, 1).optional(),
});

export const jevAnswerSchema = z.discriminatedUnion("type", [
   choiceAnswerSchema,
   scoreAnswerSchema,
   noulAnswerSchema,
]);

export type JevAnswer = z.infer<typeof jevAnswerSchema>;
export type ChoiceAnswer = z.infer<typeof choiceAnswerSchema>;
export type ScoreAnswer = z.infer<typeof scoreAnswerSchema>;
export type NoulAnswer = z.infer<typeof noulAnswerSchema>;

export const jevUsageSchema = z.object({
   input_tokens: z.number().int().nonnegative().optional(),
   output_tokens: z.number().int().nonnegative().optional(),
   cost_usd: z.number().nonnegative().optional(),
   credits_remaining_usd: z.number().nonnegative().optional(),
});

export type JevUsage = z.infer<typeof jevUsageSchema>;

export const jevDecisionRequestSchema = z.object({
   state: jevStateSchema,
   questions: questionsSchema,
});

export type JevDecisionRequest = z.infer<typeof jevDecisionRequestSchema>;

export const jevDecisionResponseSchema = z.object({
   model: z.string(),
   answers: z.record(z.string(), jevAnswerSchema),
   usage: jevUsageSchema.optional(),
});

export type JevDecisionResponse = z.infer<typeof jevDecisionResponseSchema>;

export type JevGuidance = "use" | "guidance" | "independent";

export const DEFAULT_CONFIDENCE_THRESHOLDS = {
   use: 0.8,
   guidance: 0.55,
   noulYes: 0.8,
   noulNo: 0.2,
} as const;

export interface ConfidenceThresholds {
   use?: number;
   guidance?: number;
   noulYes?: number;
   noulNo?: number;
}

export function guidanceLevel(
   confidence: number | undefined,
   thresholds: ConfidenceThresholds = {},
): JevGuidance {
   const use = thresholds.use ?? DEFAULT_CONFIDENCE_THRESHOLDS.use;
   const guidance = thresholds.guidance ?? DEFAULT_CONFIDENCE_THRESHOLDS.guidance;
   if (confidence === undefined) return "independent";
   if (confidence >= use) return "use";
   if (confidence >= guidance) return "guidance";
   return "independent";
}

export type NoulVerdict = "strong_yes" | "strong_no" | "agent_decides";

export function noulVerdict(
   probability: number,
   thresholds: ConfidenceThresholds = {},
): NoulVerdict {
   const yesThreshold = thresholds.noulYes ?? DEFAULT_CONFIDENCE_THRESHOLDS.noulYes;
   const noThreshold = thresholds.noulNo ?? DEFAULT_CONFIDENCE_THRESHOLDS.noulNo;
   if (probability >= yesThreshold) return "strong_yes";
   if (probability <= noThreshold) return "strong_no";
   return "agent_decides";
}
