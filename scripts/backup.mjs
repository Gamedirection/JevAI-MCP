#!/usr/bin/env node
// Back up the JevAI-MCP SQLite database.
// Usage: node scripts/backup.mjs [output-directory]
// Environment:
//   DATABASE_PATH  path to the live database (default ./data/jevai.db)
// The backup uses the SQLite backup API, so it is safe while the server runs.
// The API key is never part of a backup (it is stored as a hash).

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = process.env.DATABASE_PATH ?? path.join(ROOT, "data/jevai.db");
const outDir = process.argv[2] ?? path.join(ROOT, "backups");

if (!existsSync(dbPath)) {
	console.error(`Database file not found: ${dbPath}`);
	console.error("Set DATABASE_PATH to the location of jevai.db (in Docker: /data/jevai.db).");
	process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 19).replace(/[:\-T]/g, "");
mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, `jevai-${stamp}Z.db`);

const source = new Database(dbPath, { readonly: true });
try {
	await source.backup(target);
	const check = new Database(target, { readonly: true });
	try {
		const integrity = check.prepare("PRAGMA integrity_check").get();
		const verdict = integrity ? Object.values(integrity)[0] : "missing";
		if (verdict !== "ok") {
			console.error(`Integrity check failed: ${String(verdict)}`);
			process.exitCode = 1;
		}
	} finally {
		check.close();
	}
	if (process.exitCode !== 1) console.log(`Backup created: ${target}`);
} finally {
	source.close();
}
