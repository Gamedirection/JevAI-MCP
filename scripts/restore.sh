#!/usr/bin/env bash
# Restore the JevAI-MCP SQLite database from a backup file.
# Usage: ./scripts/restore.sh <backup-file>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/restore.mjs" "$@"
