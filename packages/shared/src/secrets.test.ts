import { describe, expect, it } from "vitest";
import { maskSecret, redactText, redactValue } from "./secrets.ts";

/**
 * Placeholder values in the exact shapes this project stores. These are not
 * real credentials, they only need to match the patterns.
 */
const KEYS = {
   defapi: "dk-0123456789abcdef0123456789abcdef",
   jevHosted: "jv_live_abcdef1234567890",
   typesafe:
      "apikey_2299f06df8488f04c93abcaada0c8778f84_e4033f8ba13d680aa7f83c74a679d92ea4535d2048c8352a00eb0cfed87dad53",
   openAi: "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAA",
} as const;

describe("redactText", () => {
   it.each(Object.entries(KEYS))("masks the %s key format", (_label, key) => {
      const output = redactText(`Authorization: Bearer ${key}`);
      expect(output).not.toContain(key);
      expect(output).toMatch(/\*/);
   });

   it("masks a key embedded in a longer message", () => {
      const output = redactText(`request failed with key ${KEYS.typesafe} attached`);
      expect(output).not.toContain(KEYS.typesafe);
      expect(output.startsWith("request failed with key ")).toBe(true);
   });

   it("leaves ordinary text untouched", () => {
      const message = "Jev answered with model jev-1.13.0 in 612ms";
      expect(redactText(message)).toBe(message);
   });

   it("masks every key in a message that carries more than one", () => {
      const output = redactText(`primary ${KEYS.typesafe} backup ${KEYS.defapi}`);
      expect(output).not.toContain(KEYS.typesafe);
      expect(output).not.toContain(KEYS.defapi);
   });
});

describe("redactValue", () => {
   it("masks values under secret looking keys", () => {
      const output = redactValue({
         apiKey: KEYS.defapi,
         "JEV_CLOUD_API_KEY": KEYS.openAi,
         password: "hunter2hunter2",
         model: "jev-1.13.0",
            });
      expect(output.apiKey).not.toBe(KEYS.defapi);
      expect(output.JEV_CLOUD_API_KEY).not.toBe(KEYS.openAi);
      expect(output.password).not.toBe("hunter2hunter2");
      expect(output.model).toBe("jev-1.13.0");
   });

   it("walks nested objects and arrays", () => {
      const output = redactValue({
         providers: [{ authorization: `Bearer ${KEYS.typesafe}` }],
            });
      expect(JSON.stringify(output)).not.toContain(KEYS.typesafe);
   });

   it("reports an empty secret as redacted rather than empty", () => {
      const output = redactValue({ apiKey: "" }) as { apiKey: string };
      expect(output.apiKey).toBe("[redacted]");
   });
});

describe("maskSecret", () => {
   it("keeps a short prefix and the last four characters", () => {
      expect(maskSecret(KEYS.defapi)).toBe("dk-************************cdef");
   });

   it("fully masks a value of eight characters or fewer", () => {
      expect(maskSecret("short")).toBe("*****");
   });

   it("never returns the full value", () => {
      for (const key of Object.values(KEYS)) {
         expect(maskSecret(key)).not.toBe(key);
            }
   });
});
