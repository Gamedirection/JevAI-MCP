import { describe, expect, it } from "vitest";
import { JevClient } from "./client.ts";

// Real end-to-end calls against DefAPI. They are skipped unless both
// JEV_REAL_TESTS=1 and DEFAPI_API_KEY are present, so npm test stays
// offline, free and deterministic by default.
//
//   JEV_REAL_TESTS=1 DEFAPI_API_KEY=dk-... npx vitest run packages/jev-client

const enabled = process.env.JEV_REAL_TESTS === "1" && Boolean(process.env.DEFAPI_API_KEY);

const suite = enabled ? describe : describe.skip;

function newClient(): JevClient {
   return new JevClient({
      endpoint: process.env.DEFAPI_API_ENDPOINT ?? "https://api.defapi.org/v1",
      model: process.env.JEV_MODEL ?? "typesafe/jev-1.13",
      getApiKey: () => process.env.DEFAPI_API_KEY,
      timeoutMs: 20_000,
      retries: 1,
         });
      }

suite("jev real api (JEV_REAL_TESTS=1)", () => {
   it("answers a real choice decision", async () => {
      const result = await newClient().decide(
         	"A production application returns HTTP 502 through Kubernetes ingress.",
         	{
              	subsystem: {
                    	type: "choice",
                    	instructions: "Which subsystem should be investigated first?",
                    	criteria: { application: null, service: null, ingress: null },
                       	},
                 	},
         	{ caller: "real-suite" },
             	);
      expect(result.model).toBeTruthy();
      expect(result.response.answers.subsystem).toBeDefined();
         	});

   it("reports a structured failure with a bad key", async () => {
      const client = new JevClient({
           	endpoint: process.env.DEFAPI_API_ENDPOINT ?? "https://api.defapi.org/v1",
           	model: process.env.JEV_MODEL ?? "typesafe/jev-1.13",
           	getApiKey: () => "dk-definitely-invalid-key-for-tests-only",
           	timeoutMs: 20_000,
           	retries: 0,
                 	});
      const result = await client.testConnection();
      expect(result.ok).toBe(false);
      expect(result.error?.type).toBe("JEV_AUTH_FAILURE");
         	});
      });
