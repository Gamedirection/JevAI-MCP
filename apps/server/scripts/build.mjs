import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(SERVER_DIR, "../..");
const OUT_DIR = path.join(SERVER_DIR, "dist");

// Everything under node_modules stays external. The workspace packages
// (@jevai/*) point "main" at raw TypeScript, so those are the only things
// esbuild needs to inline for the bundle to run on plain Node.
const EXTERNAL = [
   "better-sqlite3",
   "hono",
   "@hono/node-server",
   "zod",
   "fflate",
   "@cfworker/json-schema",
   "@modelcontextprotocol/sdk",
   "@modelcontextprotocol/sdk/*",
];

function gitCommit() {
   for (const envName of ["GIT_COMMIT", "CI_COMMIT_SHA"]) {
      if (process.env[envName]) return process.env[envName];
   }
   try {
      return execFileSync("git", ["rev-parse", "HEAD"], {
         cwd: REPO_ROOT,
         encoding: "utf8",
         stdio: ["ignore", "pipe", "ignore"],
      }).trim();
   } catch {
      return "unknown";
   }
}

mkdirSync(OUT_DIR, { recursive: true });

await build({
   entryPoints: [path.join(SERVER_DIR, "src/server.ts")],
   outfile: path.join(OUT_DIR, "server.js"),
   bundle: true,
   platform: "node",
   format: "esm",
   target: "node22",
   sourcemap: true,
   minify: false,
   logLevel: "info",
   external: EXTERNAL,
   banner: {
      js: [
         "import { createRequire as __createRequire } from 'node:module';",
         "const require = __createRequire(import.meta.url);",
      ].join("\n"),
   },
});

const commit = gitCommit();
const buildDate = process.env.BUILD_DATE ?? new Date().toISOString();

// apps/server/src/version.ts reads APP_VERSION / GIT_COMMIT / BUILD_DATE
// from the environment first, so CI can inject them without a rebuild.
// BUILD_INFO is the local fallback for the same values.
writeFileSync(
   path.join(SERVER_DIR, "dist", "BUILD_INFO"),
   `commit=${commit}\nbuild_date=${buildDate}\n`,
   "utf8",
);

console.log(`built apps/server/dist/server.js (commit=${commit})`);
