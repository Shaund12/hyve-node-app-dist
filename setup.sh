#!/usr/bin/env bash
# ============================================================================
# Hyve Validator Dashboard — Full Setup Script
# ============================================================================
#
# This script sets up everything you need to run the Hyve Validator Dashboard.
# Run it once after cloning the repository.
#
# PREREQUISITES (must be done BEFORE running this script):
#   1. Hyve node installed at ~/.config/hyve-node/ (or custom HYVE_NODE_DIR)
#      - The bin/hyved binary must exist and be executable
#      - The node must be initialized (home/config/ and home/data/ exist)
#      - The node should be synced (catching_up = false)
#   2. Python 3.10+ and python3-venv installed
#   3. (Optional) PostgreSQL 14+ for full metrics history
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# What this script does:
#   [1/7] Checks prerequisites (Python, PostgreSQL, hyved binary, node dirs)
#   [2/7] Creates Python virtual environment and installs dependencies
#   [3/7] Creates .env from template (you must edit it afterward)
#   [4/7] Sets up PostgreSQL database (if available)
#   [5/7] Creates required directories (logs, data)
#   [6/7] Installs systemd services (replaces YOUR_USERNAME automatically)
#   [7/7] Prints summary and next steps
#
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

USER_NAME="$(whoami)"
HOME_DIR="$HOME"
HYVE_NODE_DIR="${HYVE_NODE_DIR:-$HOME_DIR/.config/hyve-node}"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       Hyve Validator Dashboard — Setup           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  User:           $USER_NAME"
echo "  Home:           $HOME_DIR"
echo "  Node Dir:       $HYVE_NODE_DIR"
echo "  Dashboard Dir:  $SCRIPT_DIR"
echo ""

# ── Step 1: Check prerequisites ──────────────────────────────────────────────
echo "[1/7] Checking prerequisites..."
echo ""
WARNINGS=0

# Python
if ! command -v python3 &>/dev/null; then
    echo "  ✗ ERROR: python3 not found."
    echo "    Install it with: sudo apt update && sudo apt install python3 python3-venv python3-pip"
    exit 1
fi
PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "  ✓ Python:         $PY_VERSION"

if ! python3 -c "import venv" &>/dev/null; then
    echo "  ✗ ERROR: python3-venv not installed."
    echo "    Install it with: sudo apt install python3-venv"
    exit 1
fi
echo "  ✓ python3-venv:   installed"

# PostgreSQL
if ! command -v psql &>/dev/null; then
    echo "  ⚠ PostgreSQL:     NOT FOUND (optional — will use JSON file fallback)"
    echo "                    For full metrics history, install with:"
    echo "                    sudo apt install postgresql postgresql-client"
    HAS_PG=false
    WARNINGS=$((WARNINGS + 1))
else
    echo "  ✓ PostgreSQL:     $(psql --version | head -1)"
    HAS_PG=true
fi

# Hyve node directory structure checks
echo ""
echo "  ── Hyve Node Directory Check ──"
if [[ ! -d "$HYVE_NODE_DIR" ]]; then
    echo "  ✗ WARNING: Hyve node directory NOT FOUND at:"
    echo "             $HYVE_NODE_DIR"
    echo ""
    echo "    The Hyve node must be installed before the dashboard can work."
    echo "    Expected directory structure:"
    echo ""
    echo "      $HYVE_NODE_DIR/"
    echo "      ├── bin/"
    echo "      │   └── hyved          ← Validator binary (must be executable)"
    echo "      ├── home/"
    echo "      │   ├── config/"
    echo "      │   │   ├── config.toml    ← CometBFT config (RPC port, peers)"
    echo "      │   │   ├── app.toml       ← App config (REST, gRPC, EVM ports)"
    echo "      │   │   └── genesis.json   ← Chain genesis file"
    echo "      │   └── data/              ← Chain database (10+ GB when synced)"
    echo "      └── logs/                  ← Log directory (created below)"
    echo ""
    echo "    If your node is installed elsewhere, set HYVE_NODE_DIR:"
    echo "      export HYVE_NODE_DIR=/path/to/your/node && ./setup.sh"
    echo "    Or add it to .env after setup:"
    echo "      HYVE_NODE_DIR=/path/to/your/node"
    echo ""
    WARNINGS=$((WARNINGS + 1))
else
    echo "  ✓ Node directory: $HYVE_NODE_DIR"

    # Check for the hyved binary
    if [[ -f "$HYVE_NODE_DIR/bin/hyved" ]]; then
        if [[ -x "$HYVE_NODE_DIR/bin/hyved" ]]; then
            echo "  ✓ hyved binary:   $HYVE_NODE_DIR/bin/hyved (executable)"
        else
            echo "  ⚠ hyved binary:   Found but NOT executable"
            echo "                    Fix with: chmod +x $HYVE_NODE_DIR/bin/hyved"
            WARNINGS=$((WARNINGS + 1))
        fi
    else
        echo "  ✗ hyved binary:   NOT FOUND at $HYVE_NODE_DIR/bin/hyved"
        echo "                    The dashboard needs this binary to execute transactions."
        WARNINGS=$((WARNINGS + 1))
    fi

    # Check for home directory (config + data)
    if [[ -d "$HYVE_NODE_DIR/home/config" ]]; then
        echo "  ✓ Node config:    $HYVE_NODE_DIR/home/config/"
    else
        echo "  ✗ Node config:    NOT FOUND — node may not be initialized"
        echo "                    Run: $HYVE_NODE_DIR/bin/hyved init <moniker> --home $HYVE_NODE_DIR/home"
        WARNINGS=$((WARNINGS + 1))
    fi

    if [[ -d "$HYVE_NODE_DIR/home/data" ]]; then
        echo "  ✓ Node data:      $HYVE_NODE_DIR/home/data/"
    else
        echo "  ⚠ Node data:      NOT FOUND — node may not be synced yet"
        WARNINGS=$((WARNINGS + 1))
    fi

    # Check if the node is currently running
    if pgrep -x hyved &>/dev/null; then
        echo "  ✓ Node process:   hyved is running (PID $(pgrep -x hyved | head -1))"
        # Try to check sync status
        if command -v curl &>/dev/null; then
            SYNC_STATUS=$(curl -s --connect-timeout 3 http://127.0.0.1:26657/status 2>/dev/null | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)['result']['sync_info']
    print(f\"block {d['latest_block_height']}, catching_up={d['catching_up']}\")
except: print('unknown')" 2>/dev/null || echo "RPC not responding")
            echo "  ✓ Node status:    $SYNC_STATUS"
        fi
    else
        echo "  ⚠ Node process:   hyved is NOT running"
        echo "                    Start it before using the dashboard:"
        echo "                    sudo systemctl start hyve-node"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

echo ""
if [[ $WARNINGS -gt 0 ]]; then
    echo "  ── $WARNINGS warning(s) above. Setup will continue, but review them. ──"
else
    echo "  ── All checks passed ──"
fi

# ── Step 2: Create Python virtual environment ────────────────────────────────
echo ""
echo "[2/7] Setting up Python virtual environment..."

if [[ ! -d "$SCRIPT_DIR/venv" ]]; then
    python3 -m venv "$SCRIPT_DIR/venv"
    echo "  Created venv"
else
    echo "  venv already exists"
fi

source "$SCRIPT_DIR/venv/bin/activate"
pip install --upgrade pip -q
pip install -r "$SCRIPT_DIR/requirements.txt" -q

# Install optional dependencies
pip install asyncpg -q 2>/dev/null && echo "  Installed asyncpg (PostgreSQL support)" || echo "  asyncpg skipped (optional)"
pip install eth-account -q 2>/dev/null && echo "  Installed eth-account (EVM signing)" || echo "  eth-account skipped (optional)"

echo "  Dependencies installed"

# ── Step 3: Create .env file ─────────────────────────────────────────────────
echo ""
echo "[3/7] Configuring environment..."

if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo "  Created .env from template"
    echo ""
    echo "  ╔═══════════════════════════════════════════════════╗"
    echo "  ║  IMPORTANT: Edit .env and set your private key!  ║"
    echo "  ║  nano $SCRIPT_DIR/.env                           ║"
    echo "  ╚═══════════════════════════════════════════════════╝"
    echo ""
else
    echo "  .env already exists (keeping existing)"
fi

# ── Step 4: Set up PostgreSQL (optional) ─────────────────────────────────────
echo ""
echo "[4/7] Database setup..."

if [[ "$HAS_PG" == "true" ]]; then
    echo "  Attempting to create PostgreSQL database..."
    if sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='hyvedash'" 2>/dev/null | grep -q 1; then
        echo "  User 'hyvedash' already exists"
    else
        sudo -u postgres psql -c "CREATE USER hyvedash WITH PASSWORD 'hyvedash_local_2024';" 2>/dev/null && \
            echo "  Created user 'hyvedash'" || \
            echo "  Could not create user (you may need to do this manually)"
    fi
    if sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='hyvedash'" 2>/dev/null | grep -q 1; then
        echo "  Database 'hyvedash' already exists"
    else
        sudo -u postgres psql -c "CREATE DATABASE hyvedash OWNER hyvedash;" 2>/dev/null && \
            echo "  Created database 'hyvedash'" || \
            echo "  Could not create database (you may need to do this manually)"
    fi
else
    echo "  PostgreSQL not installed — using JSON file storage (limited history)"
    echo "  To enable full features later, install PostgreSQL and re-run setup."
fi

# ── Step 5: Create log directory ─────────────────────────────────────────────
echo ""
echo "[5/7] Creating directories..."
mkdir -p "$HYVE_NODE_DIR/logs" 2>/dev/null || true
mkdir -p "$SCRIPT_DIR/data" 2>/dev/null || true
echo "  OK"

# ── Step 6: Install systemd services ─────────────────────────────────────────
echo ""
echo "[6/7] Installing systemd services..."

# Generate service files with correct paths
sed "s|YOUR_USERNAME|$USER_NAME|g; s|/home/YOUR_USERNAME|$HOME_DIR|g" \
    "$SCRIPT_DIR/hyve-node.service" > /tmp/hyve-node.service

# For dashboard service, also fix the working directory
sed "s|YOUR_USERNAME|$USER_NAME|g; s|/home/YOUR_USERNAME/hyve-node-app|$SCRIPT_DIR|g" \
    "$SCRIPT_DIR/hyve-dashboard.service" > /tmp/hyve-dashboard.service

echo "  Service files generated. Installing requires sudo..."
sudo cp /tmp/hyve-node.service /etc/systemd/system/hyve-node.service
sudo cp /tmp/hyve-dashboard.service /etc/systemd/system/hyve-dashboard.service
sudo chmod 644 /etc/systemd/system/hyve-node.service /etc/systemd/system/hyve-dashboard.service
sudo systemctl daemon-reload
sudo systemctl enable hyve-node.service
sudo systemctl enable hyve-dashboard.service
echo "  Services installed and enabled"

rm -f /tmp/hyve-node.service /tmp/hyve-dashboard.service

# ── Step 7: Summary ──────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║             Setup Complete!                      ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  ═══ WHAT YOU NEED TO DO NEXT ═══"
echo ""
echo "  ┌─────────────────────────────────────────────────────────────────┐"
echo "  │ STEP 1: Configure your private key (REQUIRED)                  │"
echo "  │                                                                 │"
echo "  │   nano $SCRIPT_DIR/.env"
echo "  │                                                                 │"
echo "  │   Set VALIDATOR_PRIVATE_KEY to your 64-character hex key.       │"
echo "  │   This is required for transactions (claim, delegate, vote).    │"
echo "  │   Without it, the dashboard runs in read-only mode.             │"
echo "  │                                                                 │"
echo "  │   Format: 64 hex chars, NO 0x prefix, NO quotes                │"
echo "  │   Example: VALIDATOR_PRIVATE_KEY=a1b2c3d4e5f6...               │"
echo "  └─────────────────────────────────────────────────────────────────┘"
echo ""
echo "  ┌─────────────────────────────────────────────────────────────────┐"
echo "  │ STEP 2: Make sure your Hyve node is running                     │"
echo "  │                                                                 │"
echo "  │   The dashboard connects to your node's local RPC ports:        │"
echo "  │     - CometBFT RPC:   http://127.0.0.1:26657                   │"
echo "  │     - Cosmos REST:    http://127.0.0.1:1317                     │"
echo "  │     - EVM JSON-RPC:   http://127.0.0.1:8545                    │"
echo "  │                                                                 │"
echo "  │   Verify with: curl http://127.0.0.1:26657/status              │"
echo "  │   Node must be fully synced (catching_up = false).              │"
echo "  └─────────────────────────────────────────────────────────────────┘"
echo ""
echo "  ┌─────────────────────────────────────────────────────────────────┐"
echo "  │ STEP 3: Start the services                                      │"
echo "  │                                                                 │"
echo "  │   sudo systemctl start hyve-node                                │"
echo "  │   sleep 10                                                      │"
echo "  │   sudo systemctl start hyve-dashboard                           │"
echo "  └─────────────────────────────────────────────────────────────────┘"
echo ""
echo "  ┌─────────────────────────────────────────────────────────────────┐"
echo "  │ STEP 4: Get your login password                                 │"
echo "  │                                                                 │"
echo "  │   sudo journalctl -u hyve-dashboard | grep 'Admin password'     │"
echo "  │                                                                 │"
echo "  │   Username: admin                                               │"
echo "  │   Password: (from the command above)                            │"
echo "  └─────────────────────────────────────────────────────────────────┘"
echo ""
echo "  ┌─────────────────────────────────────────────────────────────────┐"
echo "  │ STEP 5: Open the dashboard                                      │"
echo "  │                                                                 │"
echo "  │   http://127.0.0.1:8420                                         │"
echo "  │                                                                 │"
echo "  │   For LAN access, set HYVE_DASH_HOST=0.0.0.0 in .env           │"
echo "  └─────────────────────────────────────────────────────────────────┘"
echo ""
echo "  ═══ QUICK REFERENCE ═══"
echo ""
echo "  Status:    sudo systemctl status hyve-dashboard"
echo "  Logs:      sudo journalctl -u hyve-dashboard -f"
echo "  Restart:   sudo systemctl restart hyve-dashboard"
echo "  Stop:      sudo systemctl stop hyve-dashboard && sudo systemctl stop hyve-node"
echo ""
echo "  ═══ FILES CREATED ═══"
echo ""
echo "  .env              — Your config (edit this!)"
echo "  venv/             — Python virtual environment"
echo "  data/             — Runtime data directory"
echo ""
echo "  Auto-generated on first run (do NOT edit):"
echo "  .auth.json        — Admin credentials (delete to reset password)"
echo "  .secret_key       — Session signing key"
echo ""
echo "  ═══ ENVIRONMENT VARIABLES (.env) ═══"
echo ""
echo "  VALIDATOR_PRIVATE_KEY  — (REQUIRED) Your hex private key, no 0x"
echo "  DATABASE_URL           — PostgreSQL DSN (default: local hyvedash DB)"
echo "  HYVE_NODE_DIR          — Node install path (default: ~/.config/hyve-node)"
echo "  HYVE_DASH_PORT         — Dashboard port (default: 8420)"
echo "  HYVE_DASH_HOST         — Bind address (default: 127.0.0.1)"
echo ""
echo "  For detailed docs, see: README.md"
echo ""
