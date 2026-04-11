#!/usr/bin/env bash
# Launch the Hyve Validator Dashboard
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Use venv if it exists, otherwise system python
if [[ -d "$SCRIPT_DIR/venv" ]]; then
    source "$SCRIPT_DIR/venv/bin/activate"
fi

PORT="${HYVE_DASH_PORT:-8420}"
HOST="${HYVE_DASH_HOST:-127.0.0.1}"

echo "==================================="
echo "  Hyve Validator Dashboard"
echo "  http://${HOST}:${PORT}"
echo "==================================="

exec python3 -m uvicorn server:app --host "$HOST" --port "$PORT" --log-level warning
