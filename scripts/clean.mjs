import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
   	"apps/server/dist",
   	"apps/web/dist",
   	"packages/shared/dist",
   	"packages/jev-client/dist",
   	"packages/database/dist",
   	"packages/mcp-tools/dist",
   	".turbo",
   	"node_modules/.vite",
   	".data",
   	];

for (const target of TARGETS) {
   const absolute = path.join(ROOT, target);
   if (!absolute.startsWith(ROOT)) continue;
   try {
      rmSync(absolute, { recursive: true, force: true });
      console.log(`removed ${target}`);
      	} catch {
   // nothing to remove
       		}
}
