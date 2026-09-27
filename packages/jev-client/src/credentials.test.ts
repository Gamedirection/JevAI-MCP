import { describe, expect, it } from "vitest";
import { JevClient } from "./client.ts";
import { JevClientError } from "./errors.ts";

const body = {
   model: "jev-1.13.0",
   answers: {
      q: {
         type: "choice",
         choice: "yes",
         confidence: 0.9,
         probabilities: { yes: 0.9, no: 0.1 },
            },
      },
   usage: { input_tokens: 10, output_tokens: 0 },
};

function jsonResponse(payload: unknown, status = 200): Response {
   return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
         });
}

function recordingFetch(responses: Array<() => Response>) {
   const calls: Array<{ url: string; key: string | null; model: string }> = [];
   let index = 0;
   const impl = (async (input: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      const parsed = JSON.parse(String(init?.body)) as { model: string };
      calls.push({
         url: String(input),
         key: headers?.Authorization ?? null,
         model: parsed.model,
            });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (!next) throw new Error("no response configured");
      return next();
         }) as unknown as typeof fetch;
   return { calls, impl };
}

const questions = {
   q: { type: "choice", instructions: "yes?", criteria: { yes: "a", no: "b" } },
} as const;

function buildClient(fetchImpl: typeof fetch, backupKeys: Record<string, string> = {}) {
   return new JevClient({
      endpoint: "https://api.typesafe.ai/v1",
      model: "jev-1.13.0",
      getApiKey: () => "apikey_primary_aaaaaaaa_bbbbbbbb",
      backupCredentials: Object.entries(backupKeys).map(([label, key]) => ({
         label,
         endpoint: label === "typesafe" ? "https://api.typesafe.ai/v1" : "https://api.defapi.org/v1",
         model: "jev-1.13.0",
         getApiKey: () => key,
            })),
      timeoutMs: 1_000,
      retries: 0,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
      fetchImpl,
         });
}

describe("JevClient credential chain", () => {
   it("uses the primary credential when it works and does not rotate", async () => {
      const recorder = recordingFetch([() => jsonResponse(body)]);
      const client = buildClient(recorder.impl, { typesafe: "apikey_backup_cccccccc_dddddddd" });

      const result = await client.decide("state", questions);

      expect(recorder.calls).toHaveLength(1);
      expect(result.credentialLabel).toBe("primary");
      expect(result.usedBackup).toBe(false);
   });

   it("moves to a TypeSafe backup key after a 401 without changing the endpoint", async () => {
      const recorder = recordingFetch([
         () => jsonResponse({ error: "unauthorized" }, 401),
         () => jsonResponse(body),
         ]);
      const client = buildClient(recorder.impl, { typesafe: "apikey_backup_cccccccc_dddddddd" });

      const result = await client.decide("state", questions);

      expect(recorder.calls).toHaveLength(2);
      expect(recorder.calls[0]?.key).toBe("Bearer apikey_primary_aaaaaaaa_bbbbbbbb");
      expect(recorder.calls[1]?.key).toBe("Bearer apikey_backup_cccccccc_dddddddd");
      expect(recorder.calls[1]?.url).toBe("https://api.typesafe.ai/v1/systemone");
      expect(result.credentialLabel).toBe("typesafe");
      expect(result.usedBackup).toBe(true);
   });

   it("carries the endpoint and model across providers so a DefAPI key is never sent to TypeSafe", async () => {
      const recorder = recordingFetch([
         () => jsonResponse({ error: "unauthorized" }, 401),
         () => jsonResponse(body),
         ]);
      const client = buildClient(recorder.impl, { defapi: "dk-backup-key-value" });

      await client.decide("state", questions);

      expect(recorder.calls[1]?.url).toBe("https://api.defapi.org/v1/systemone");
      expect(recorder.calls[1]?.key).toBe("Bearer dk-backup-key-value");
   });

   it("rotates on a 429 rate limit", async () => {
      const recorder = recordingFetch([
         () => jsonResponse({ error: "rate limit" }, 429),
         () => jsonResponse(body),
         ]);
      const client = buildClient(recorder.impl, { typesafe: "apikey_backup_cccccccc_dddddddd" });

      const result = await client.decide("state", questions);

      expect(recorder.calls).toHaveLength(2);
      expect(result.usedBackup).toBe(true);
   });

   it("does not rotate on a 404, because a second key cannot fix a wrong endpoint", async () => {
      const recorder = recordingFetch([
         () => jsonResponse({ error: "not found" }, 404),
         () => jsonResponse(body),
         ]);
      const client = buildClient(recorder.impl, { typesafe: "apikey_backup_cccccccc_dddddddd" });

      const error = await client.decide("state", questions).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(JevClientError);
      expect((error as JevClientError).statusCode).toBe(404);
      expect(recorder.calls).toHaveLength(1);
   });

   it("walks every backup in order before giving up", async () => {
      const recorder = recordingFetch([
         () => jsonResponse({ error: "unauthorized" }, 401),
         () => jsonResponse({ error: "unauthorized" }, 401),
         () => jsonResponse({ error: "unauthorized" }, 401),
         ]);
      const client = buildClient(recorder.impl, {
         typesafe: "apikey_backup_cccccccc_dddddddd",
         defapi: "dk-backup-key-value",
         });

      const error = await client.decide("state", questions).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(JevClientError);
      expect(recorder.calls).toHaveLength(3);
      expect(recorder.calls.map((call) => call.url)).toEqual([
         "https://api.typesafe.ai/v1/systemone",
         "https://api.typesafe.ai/v1/systemone",
         "https://api.defapi.org/v1/systemone",
            ]);
   });

   it("skips a backup with no key instead of failing", async () => {
      const recorder = recordingFetch([
         () => jsonResponse({ error: "unauthorized" }, 401),
         () => jsonResponse(body),
         ]);
      const client = new JevClient({
         endpoint: "https://api.typesafe.ai/v1",
         model: "jev-1.13.0",
         getApiKey: () => "apikey_primary_aaaaaaaa_bbbbbbbb",
         backupCredentials: [
            { label: "blank", endpoint: "https://api.typesafe.ai/v1", model: "jev-1.13.0", getApiKey: () => undefined },
            { label: "typesafe", endpoint: "https://api.typesafe.ai/v1", model: "jev-1.13.0", getApiKey: () => "apikey_backup_cccccccc_dddddddd" },
               ],
         timeoutMs: 1_000,
         retries: 0,
         fetchImpl: recorder.impl,
            });

      const result = await client.decide("state", questions);

      expect(result.credentialLabel).toBe("typesafe");
      expect(recorder.calls).toHaveLength(2);
   });

   it("reports a missing key as an auth failure when nothing is configured", async () => {
      const recorder = recordingFetch([() => jsonResponse(body)]);
      const client = new JevClient({
         endpoint: "https://api.typesafe.ai/v1",
         model: "jev-1.13.0",
         getApiKey: () => undefined,
         timeoutMs: 1_000,
         retries: 0,
         fetchImpl: recorder.impl,
            });

      const error = await client.decide("state", questions).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(JevClientError);
      expect((error as JevClientError).category).toBe("JEV_AUTH_FAILURE");
      expect(recorder.calls).toHaveLength(0);
   });

   it("does not leak the key into the error message", async () => {
      const recorder = recordingFetch([() => jsonResponse({ error: "unauthorized" }, 401)]);
      const client = buildClient(recorder.impl);

      const error = await client.decide("state", questions).catch((caught: unknown) => caught);

      expect((error as Error).message).not.toContain("apikey_primary");
   });
});
