#!/usr/bin/env node
// Restore the JevAI-MCP SQLite database from a backup file.
// Usage: node scripts/restore.mjs <backup-file>
// Environment:
//   DATABASE_PATH  where the live database lives (default ./data/jevai.db)
// Stop the server before restoring. The current database is saved next to
// itself with the .before-restore suffix first, so the operation is reversible.

import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backupFile = process.argv[2];
const dbPath = process.env.DATABASE_PATH ?? path.join(ROOT, "data/jevai.db");

if (!backupFile || !existsSync(backupFile)) {
	console.error("Usage: node scripts/restore.mjs <backup-file>");
	process.exit(1);
}

const probe = new Database(backupFile, { readonly: true });
try {
	const integrity = probe.prepare("PRAGMA integrity_check").get();
	const verdict = integrity ? Object.values(integrity)[0] : "missing";
	if (verdict !== "ok") {
		console.error(`Refusing to restore: backup fails integrity check (${String(verdict)}).`);
		process.exit(1);
	}
	const tables = probe
		.prepare("SELECT name FROM sqlite_master WHERE type='table'")
		.all()
		.map((row) => String(row.name));
	for (const required of ["requests", "logs", "settings"]) {
		if (!tables.includes(required)) {
			console.error(`Refusing to restore: backup is missing table '${required}'. It is not a JevAI-MCP backup.`);
			process.exit(1);
		}
	}
} finally {
	probe.close();
}

mkdirSync(path.dirname(dbPath), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
	if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, `${dbPath}.before-restore${suffix}`);
	if (existsSync(`${backupFile}${suffix}`)) copyFileSync(`${backupFile}${suffix}`, dbPath + suffix);
}

copyFileSync(backupFile, dbPath);
console.log(`Restored ${dbPath} from ${backupFile}.`);
console.log(`The previous database was kept at ${dbPath}.before-restore in case you need to undo this.`);
console.log("Start the server again to use the restored data.");
