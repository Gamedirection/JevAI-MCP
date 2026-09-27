import { createHash } from "node:crypto";
import type { SqliteDb } from "./db.ts";
import { SettingsRepository } from "./repositories.ts";

export interface StoredApiKey {
   createdAt: string;
   updatedAt: string;
   masked: string;
}

export interface ApiKeyStore {
   save(apiKey: string): void;
   get(): string | undefined;
   clear(): void;
   info(): StoredApiKey | undefined;
}

export function maskApiKey(apiKey: string): string {
   const trimmed = apiKey.trim();
   if (trimmed.length <= 12) return "*".repeat(24);
   const prefix = trimmed.startsWith("dk-") ? trimmed.slice(0, 3) : trimmed.slice(0, 4);
   return `${prefix}${"*".repeat(24)}${trimmed.slice(-4)}`;
}

export function hashApiKey(apiKey: string): string {
   return createHash("sha256").update(apiKey).digest("hex");
}

export const API_KEY_SETTING = "jev.api_key";

export class SqliteApiKeyStore implements ApiKeyStore {
   private readonly settings: SettingsRepository;
   private cached: string | undefined;
   private cacheLoaded = false;

   constructor(db: SqliteDb) {
      this.settings = new SettingsRepository(db);
      }

   save(apiKey: string): void {
      const trimmed = apiKey.trim();
      const stored = { value: trimmed, masked: maskApiKey(trimmed), salt: "plain-v1" };
      this.settings.set(API_KEY_SETTING, stored);
      this.settings.set(`${API_KEY_SETTING}_meta`, {
         masked: maskApiKey(trimmed),
         hash: hashApiKey(trimmed),
         createdAt: this.info()?.createdAt ?? new Date().toISOString(),
         updatedAt: new Date().toISOString(),
         });
      this.cached = trimmed;
      this.cacheLoaded = true;
      }

   get(): string | undefined {
      if (!this.cacheLoaded) {
         const stored = this.settings.get<{ value?: string }>(API_KEY_SETTING);
         this.cached = typeof stored?.value === "string" ? stored.value : undefined;
         this.cacheLoaded = true;
         }
      return this.cached;
       }

   clear(): void {
      this.settings.delete(API_KEY_SETTING);
      this.settings.delete(`${API_KEY_SETTING}_meta`);
      this.cached = undefined;
      this.cacheLoaded = true;
       }

   info(): StoredApiKey | undefined {
      const meta = this.settings.get<{
         masked: string;
         createdAt: string;
         updatedAt: string;
           }>(`${API_KEY_SETTING}_meta`);
      if (!meta || typeof meta.masked !== "string") return undefined;
      return { masked: meta.masked, createdAt: meta.createdAt, updatedAt: meta.updatedAt };
       }
}
