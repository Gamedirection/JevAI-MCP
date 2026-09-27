import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { allGuides } = await import("../apps/server/src/integrations-content.ts");

const ctx = { mcpUrl: "http://localhost:3001", serverName: "jevai", appName: "JevAI-MCP" };
const header =
   		"<!-- Generated file. Regenerate with: npm run generate:integrations\n     The live server generates the same files with the MCP URL configured in Settings. -->\n\n";

let count = 0;
for (const guide of allGuides(ctx)) {
   	for (const file of guide.files) {
      	const directory = path.join(ROOT, "integrations", guide.id);
      	mkdirSync(directory, { recursive: true });
      	writeFileSync(path.join(directory, file.path), header + file.content);
      	count += 1;
            			}
         			}

console.log(`wrote ${count} files under integrations/ from integrations-content.ts`);
