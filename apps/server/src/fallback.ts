import {
   FALLBACK_DEFAULTS,
   buildFallbackProviders,
   runFallbackChain,
   type FallbackChainResult,
} from "@jevai/jev-client";
import { envBool, envInt, type JevQuestion, type JevState } from "@jevai/shared";
import type { AppContext } from "./context.ts";

export interface FallbackDeps {
   fallback: (
      state: JevState,
      questions: Record<string, JevQuestion>,
   ) => Promise<FallbackChainResult>;
}

/**
 * Builds the fallback dependency from the environment, or returns undefined when
 * no provider is configured so callers keep the original fail-open behaviour.
 */
export function buildFallbackDeps(application: AppContext): FallbackDeps | undefined {
   const providers = buildFallbackProviders(
      {
         enabled: envBool(process.env.JEV_FALLBACK_ENABLED, false),
         ...(process.env.JEV_LOCAL_API_URL ? { localBaseUrl: process.env.JEV_LOCAL_API_URL } : {}),
         ...(process.env.JEV_LOCAL_MODEL ? { localModel: process.env.JEV_LOCAL_MODEL } : {}),
         ...(process.env.JEV_CLOUD_API_URL ? { cloudBaseUrl: process.env.JEV_CLOUD_API_URL } : {}),
         ...(process.env.JEV_CLOUD_MODEL ? { cloudModel: process.env.JEV_CLOUD_MODEL } : {}),
         ...(process.env.JEV_CLOUD_API_KEY ? { cloudApiKey: process.env.JEV_CLOUD_API_KEY } : {}),
         localTimeoutMs: envInt(process.env.JEV_LOCAL_TIMEOUT_MS, FALLBACK_DEFAULTS.localTimeoutMs),
         cloudTimeoutMs: envInt(process.env.JEV_CLOUD_TIMEOUT_MS, FALLBACK_DEFAULTS.cloudTimeoutMs),
      },
      application.log("fallback"),
   );

   if (providers.length === 0) return undefined;
   const logger = application.log("fallback");

   return {
      fallback: (state, questions) =>
         runFallbackChain(state, questions, { providers, logger }),
   };
}
