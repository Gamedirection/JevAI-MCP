import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = path.join(ROOT, "apps/web");
const OUTFILE = path.join(ROOT, "apps/server/dist/server.dev.js");

if (!existsSync(path.join(ROOT, "node_modules/vite"))) {
   console.error("Dependencies are not installed. Run npm install first.");
   process.exit(1);
       		}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let serverChild = null;
let shuttingDown = false;

function startServer() {
   serverChild = spawn(process.execPath, ["--env-file-if-exists=.env", OUTFILE], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "development" },
          		});
   serverChild.on("exit", (code) => {
      if (shuttingDown) return;
      console.error(`[server] exited with code ${code}; waiting for file changes to restart`);
          		});
       		}

function restartServer() {
   if (serverChild && !serverChild.killed) serverChild.kill("SIGTERM");
   startServer();
       		}

const workspacePlugins = [
   	{
      name: "jevai-workspace-ts",
      setup(api) {
           	api.onResolve({ filter: /^@jevai\// }, (args) => ({
                 	path: path.resolve(ROOT, "packages", args.path.slice("@jevai/".length), "src/index.ts"),
                       		}));
           	api.onLoad({ filter: /\.ts$/ }, async (args) => ({
                 	contents: (await import("node:fs")).readFileSync(args.path, "utf8"),
                 	loader: "ts",
                 	resolveDir: path.dirname(args.path),
                       		}));
               		},
      	},
   	{
      name: "restart-on-rebuild",
      setup(api) {
           	api.onEnd((result) => {
                 	if (result.errors.length === 0 && existsSync(OUTFILE)) restartServer();
                       		});
               		},
      	},
   	];

const ctx = await context({
   entryPoints: [path.join(ROOT, "apps/server/src/server.ts")],
   outfile: OUTFILE,
   bundle: true,
   platform: "node",
   format: "esm",
   target: "node22",
   packages: "external",
   plugins: workspacePlugins,
      	});

await ctx.watch();

const webChild = spawn(npm, ["run", "dev"], {
   cwd: WEB_DIR,
   stdio: "inherit",
      	});
webChild.on("exit", (code) => {
   if (!shuttingDown) shutdown(code ?? 0);
      	});

console.log("[dev] dashboard http://localhost:5173 (proxied) · api http://localhost:8080 · mcp http://localhost:3001/mcp");

function shutdown(code) {
   shuttingDown = true;
   if (serverChild) serverChild.kill("SIGTERM");
   webChild.kill("SIGTERM");
   void ctx.dispose();
   setTimeout(() => process.exit(code), 300);
       		}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
