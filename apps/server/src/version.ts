import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface VersionInfo {
   version: string;
   commit: string | null;
   buildDate: string | null;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const version: VersionInfo = {
   version:
      process.env.APP_VERSION ??
      readPackageVersion() ??
      "1.0.0",
   commit: process.env.GIT_COMMIT ?? detectCommit() ?? null,
   buildDate: process.env.BUILD_DATE ?? null,
};

function readPackageVersion(): string | undefined {
   for (const candidate of [
      path.resolve(HERE, "../package.json"),
      path.resolve(HERE, "../../package.json"),
         ]) {
      try {
         if (existsSync(candidate)) {
               const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
               if (parsed.version) return parsed.version;
                  }
             } catch {
               // ignore and keep looking
             }
         }
   return undefined;
}

function detectCommit(): string | null {
   const raw = process.env.GIT_COMMIT_OVERRIDE ?? null;
   if (raw) return raw.slice(0, 40);
   try {
      const require = createRequire(import.meta.url);
       void require;
       const candidates = [
               	path.resolve(HERE, "BUILD_INFO"),
               	path.resolve(HERE, "../BUILD_INFO"),
               	path.resolve(HERE, "../../BUILD_INFO"),
                  	];
       for (const infoPath of candidates) {
            	if (existsSync(infoPath)) {
                  	const match = /^commit=(.+)$/m.exec(readFileSync(infoPath, "utf8"));
                  	if (match?.[1]) return match[1].slice(0, 40);
                         	}
           	}
       return null;
            } catch {
      return null;
            }
}

export function versionString(): string {
   return `v${version.version}`;
}
