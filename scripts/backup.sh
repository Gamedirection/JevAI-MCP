#!/usr/bin/env bash
# Back up the JevAI-MCP SQLite database using the Node backup script.
# Usage: ./scripts/backup.sh [output-directory]
# Environment: DATABASE_PATH (default ./data/jevai.db; in Docker /data/jevai.db)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/backup.mjs" "$@"
