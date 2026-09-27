import { describe, expect, it } from "vitest";
import { AppContext } from "./context.ts";

const state = { task_type: "bug" };
const questions = {
   q: { type: "choice", instructions: "yes?", criteria: { yes: "a", no: "b" } },
} as const;

const successBody = {
   model: "jev-1.13.0",
   answers: {
      q: { type: "choice", choice: "yes", confidence: 0.9, probabilities: { yes: 0.9, no: 0.1 } },
         },
   usage: { input_tokens: 10, output_tokens: 0 },
};

interface Seen {
   url: string;
   key: string | undefined;
   model: string;
}

function stubFetch(seen: Seen[], behaviour: (url: string) => number) {
   return (async (input: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      const parsed = JSON.parse(String(init?.body)) as { model: string };
      const url = String(input);
      seen.push({
         url,
         key: headers?.Authorization?.replace("Bearer ", ""),
         model: parsed.model,
            });
      const status = behaviour(url);
      if (status === 200) {
         return new Response(JSON.stringify(successBody), {
            status,
            headers: { "Content-Type": "application/json" },
               });
         }
      return new Response(JSON.stringify({ error: "denied" }), {
         status,
         headers: { "Content-Type": "application/json" },
            });
      }) as unknown as typeof fetch;
}

function createContext(env: Record<string, string>) {
   return AppContext.create({
      DATABASE_PATH: ":memory:",
      LOG_LEVEL: "error",
      JEV_RETRIES: "0",
      ...env,
         });
}

describe("AppContext backup credentials", () => {
   it("reports no backups when none are configured", () => {
      const context = createContext({ DEFAPI_API_KEY: "apikey_primary" });
      expect(context.backupLabels()).toEqual([]);
   });

   it("keeps backup slots in order and ignores a slot with no key", () => {
      const context = createContext({
         DEFAPI_API_KEY: "apikey_primary",
         JEV_BACKUP_2_API_KEY: "apikey_slot2",
         JEV_BACKUP_3_ENDPOINT: "https://api.typesafe.ai/v1",
            });
      expect(context.backupLabels()).toEqual(["backup-2"]);
   });

   it("falls back to a second TypeSafe key after a 401", async () => {
      const seen: Seen[] = [];
      const previous = globalThis.fetch;
      globalThis.fetch = stubFetch(seen, (url) => (url.includes("backup.typesafe") ? 200 : 401));
      try {
         const context = createContext({
            DEFAPI_API_KEY: "apikey_primary",
            DEFAPI_API_ENDPOINT: "https://primary.typesafe/v1",
            JEV_BACKUP_2_ENDPOINT: "https://backup.typesafe/v1",
            JEV_BACKUP_2_MODEL: "jev-latest",
            JEV_BACKUP_2_API_KEY: "apikey_slot2",
               });
         const result = await context.client.decide(state, questions);
         expect(seen.map((call) => call.key)).toEqual(["apikey_primary", "apikey_slot2"]);
         expect(seen[1]?.url).toBe("https://backup.typesafe/v1/systemone");
         expect(seen[1]?.model).toBe("jev-latest");
         expect(result.usedBackup).toBe(true);
         expect(result.credentialLabel).toBe("backup-2");
      } finally {
         globalThis.fetch = previous;
         }
   });

   it("sends a DefAPI backup key to the DefAPI endpoint, never to TypeSafe", async () => {
      const seen: Seen[] = [];
      const previous = globalThis.fetch;
      globalThis.fetch = stubFetch(seen, (url) => (url.includes("defapi.org") ? 200 : 401));
      try {
         const context = createContext({
            DEFAPI_API_KEY: "apikey_primary",
            DEFAPI_API_ENDPOINT: "https://api.typesafe.ai/v1",
            JEV_BACKUP_2_ENDPOINT: "https://api.defapi.org/v1",
            JEV_BACKUP_2_MODEL: "google/gemini-3-flash",
            JEV_BACKUP_2_API_KEY: "dk-backup",
               });
         await context.client.decide(state, questions);
         expect(seen[1]?.key).toBe("dk-backup");
         expect(seen[1]?.url).toBe("https://api.defapi.org/v1/systemone");
      } finally {
         globalThis.fetch = previous;
         }
   });

   it("does not reach for a backup on a 404", async () => {
      const seen: Seen[] = [];
      const previous = globalThis.fetch;
      globalThis.fetch = stubFetch(seen, () => 404);
      try {
         const context = createContext({
            DEFAPI_API_KEY: "apikey_primary",
            JEV_BACKUP_2_ENDPOINT: "https://backup.typesafe/v1",
            JEV_BACKUP_2_MODEL: "jev-latest",
            JEV_BACKUP_2_API_KEY: "apikey_slot2",
               });
         await expect(context.client.decide(state, questions)).rejects.toThrow();
         expect(seen).toHaveLength(1);
      } finally {
         globalThis.fetch = previous;
         }
   });
});
