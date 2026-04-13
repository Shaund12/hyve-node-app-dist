#!/usr/bin/env bash
# ============================================================================
# Hyve Validator Dashboard — Guided Installer
# ============================================================================
# Interactive installer that walks you through each step.
#
# PREREQUISITE:
#   You MUST have already set up and activated your validator using the
#   Hyve Validator desktop app (Windows/Linux). The node must be installed
#   at ~/.config/hyve-node/ (or a custom path you specify).
#
# Usage:
#   chmod +x install.sh
#   ./install.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

USER_NAME="$(whoami)"
HOME_DIR="$HOME"
HYVE_NODE_DIR="${HYVE_NODE_DIR:-$HOME_DIR/.config/hyve-node}"

# ── Colors & helpers ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${DIM}$1${NC}"; }
header() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}  $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

prompt_yn() {
    local msg="$1" default="${2:-y}"
    if [[ "$default" == "y" ]]; then
        read -rp "  $msg [Y/n]: " answer
        [[ -z "$answer" || "$answer" =~ ^[Yy] ]]
    else
        read -rp "  $msg [y/N]: " answer
        [[ "$answer" =~ ^[Yy] ]]
    fi
}

prompt_input() {
    local msg="$1" default="${2:-}"
    if [[ -n "$default" ]]; then
        read -rp "  $msg [$default]: " answer
        echo "${answer:-$default}"
    else
        read -rp "  $msg: " answer
        echo "$answer"
    fi
}

wait_key() {
    echo ""
    read -rp "  Press Enter to continue..." _
}

# ── Welcome ──────────────────────────────────────────────────────────────────
clear 2>/dev/null || true
echo ""
echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║                                                  ║"
echo "  ║     Hyve Validator Dashboard — Installer         ║"
echo "  ║                                                  ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  This installer will guide you through setting up the"
echo -e "  Hyve Validator Dashboard on this machine."
echo ""
echo -e "  ${YELLOW}Before continuing, make sure you have:${NC}"
echo ""
echo "    1. Installed the Hyve Validator app (Windows/Linux)"
echo "    2. Activated your validator through the app"
echo "    3. Your node is installed and has synced at least once"
echo ""

if ! prompt_yn "Have you completed the steps above?" "y"; then
    echo ""
    echo -e "  ${YELLOW}Please set up and activate your validator first using the"
    echo -e "  Hyve Validator desktop app, then re-run this installer.${NC}"
    echo ""
    exit 0
fi

# ── Step 1: System Requirements ──────────────────────────────────────────────
header "Step 1 of 7 — Checking System Requirements"

ERRORS=0
WARNINGS=0

# Python
if command -v python3 &>/dev/null; then
    PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    PY_MAJOR=$(python3 -c "import sys; print(sys.version_info.major)")
    PY_MINOR=$(python3 -c "import sys; print(sys.version_info.minor)")
    if [[ "$PY_MAJOR" -ge 3 && "$PY_MINOR" -ge 10 ]]; then
        ok "Python $PY_VERSION"
    else
        fail "Python $PY_VERSION is too old (need 3.10+)"
        ERRORS=$((ERRORS + 1))
    fi
else
    fail "Python 3 not found"
    info "Install with: sudo apt update && sudo apt install python3 python3-venv python3-pip"
    ERRORS=$((ERRORS + 1))
fi

# python3-venv
if python3 -c "import venv" &>/dev/null 2>&1; then
    ok "python3-venv"
else
    fail "python3-venv not installed"
    info "Install with: sudo apt install python3-venv"
    ERRORS=$((ERRORS + 1))
fi

# curl
if command -v curl &>/dev/null; then
    ok "curl"
else
    fail "curl not found"
    info "Install with: sudo apt install curl"
    ERRORS=$((ERRORS + 1))
fi

# PostgreSQL (optional)
HAS_PG=false
if command -v psql &>/dev/null; then
    ok "PostgreSQL (full metrics history enabled)"
    HAS_PG=true
else
    warn "PostgreSQL not found (optional)"
    info "Dashboard will store metrics in local JSON files."
    info "For full history, install later: sudo apt install postgresql postgresql-client"
    WARNINGS=$((WARNINGS + 1))
fi

if [[ $ERRORS -gt 0 ]]; then
    echo ""
    fail "Missing ${ERRORS} required package(s). Install them and re-run the installer."
    exit 1
fi

echo ""
ok "All required packages found"
wait_key

# ── Step 2: Locate Hyve Node ─────────────────────────────────────────────────
header "Step 2 of 7 — Locating Your Hyve Node"

echo "  The dashboard needs access to your Hyve node installation."
echo "  Default location: ~/.config/hyve-node/"
echo ""

if [[ -d "$HYVE_NODE_DIR" && -f "$HYVE_NODE_DIR/bin/hyved" ]]; then
    ok "Found node at: $HYVE_NODE_DIR"
    echo ""
    if ! prompt_yn "Is this correct?" "y"; then
        HYVE_NODE_DIR=$(prompt_input "Enter the full path to your Hyve node directory")
    fi
else
    if [[ -d "$HYVE_NODE_DIR" ]]; then
        warn "Directory exists but hyved binary not found at: $HYVE_NODE_DIR/bin/hyved"
    else
        warn "Default node directory not found: $HYVE_NODE_DIR"
    fi
    echo ""
    echo "  Common locations:"
    echo "    ~/.config/hyve-node/"
    echo "    ~/hyve-node/"
    echo "    /opt/hyve/"
    echo ""
    HYVE_NODE_DIR=$(prompt_input "Enter the full path to your Hyve node directory" "$HYVE_NODE_DIR")
fi

# Validate the node directory
echo ""
NODE_ERRORS=0

if [[ ! -d "$HYVE_NODE_DIR" ]]; then
    fail "Directory does not exist: $HYVE_NODE_DIR"
    echo ""
    echo -e "  ${YELLOW}You need to install and activate your validator first.${NC}"
    echo -e "  ${YELLOW}Use the Hyve Validator desktop app, then re-run this installer.${NC}"
    exit 1
fi

if [[ -f "$HYVE_NODE_DIR/bin/hyved" ]]; then
    if [[ -x "$HYVE_NODE_DIR/bin/hyved" ]]; then
        ok "hyved binary found and executable"
    else
        warn "hyved binary found but NOT executable — fixing..."
        chmod +x "$HYVE_NODE_DIR/bin/hyved"
        ok "Fixed permissions on hyved"
    fi
else
    fail "hyved binary not found at $HYVE_NODE_DIR/bin/hyved"
    NODE_ERRORS=$((NODE_ERRORS + 1))
fi

if [[ -d "$HYVE_NODE_DIR/home/config" ]]; then
    ok "Node config directory found"
else
    fail "Node config not found — node may not be initialized"
    NODE_ERRORS=$((NODE_ERRORS + 1))
fi

if [[ -d "$HYVE_NODE_DIR/home/data" ]]; then
    ok "Node data directory found"
else
    warn "Node data directory not found — node may not have synced yet"
    WARNINGS=$((WARNINGS + 1))
fi

if [[ $NODE_ERRORS -gt 0 ]]; then
    echo ""
    fail "Your node installation appears incomplete."
    echo -e "  ${YELLOW}Make sure you've set up and activated your validator using"
    echo -e "  the Hyve Validator desktop app first.${NC}"
    exit 1
fi

# Check if node is running
echo ""
if pgrep -x hyved &>/dev/null; then
    ok "Node is running (PID $(pgrep -x hyved | head -1))"
    # Check sync status
    SYNC_STATUS=$(curl -s --connect-timeout 3 http://127.0.0.1:26657/status 2>/dev/null | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)['result']['sync_info']
    catching=d['catching_up']
    height=d['latest_block_height']
    if catching=='true' or catching==True:
        print(f'SYNCING|{height}')
    else:
        print(f'SYNCED|{height}')
except: print('UNKNOWN|0')" 2>/dev/null || echo "ERROR|0")

    SYNC_STATE="${SYNC_STATUS%%|*}"
    SYNC_HEIGHT="${SYNC_STATUS##*|}"

    if [[ "$SYNC_STATE" == "SYNCED" ]]; then
        ok "Node is fully synced (block $SYNC_HEIGHT)"
    elif [[ "$SYNC_STATE" == "SYNCING" ]]; then
        warn "Node is still syncing (block $SYNC_HEIGHT)"
        echo ""
        echo -e "  ${YELLOW}The dashboard works best with a fully synced node."
        echo -e "  You can continue the install, but some features won't work"
        echo -e "  until the node finishes syncing.${NC}"
        echo ""
        if ! prompt_yn "Continue anyway?" "y"; then
            echo ""
            echo "  Wait for the node to finish syncing, then re-run the installer."
            exit 0
        fi
    else
        warn "Could not check sync status (RPC may not be ready)"
    fi
else
    warn "Node is not currently running"
    echo ""
    echo -e "  ${DIM}The node doesn't need to be running during installation,"
    echo -e "  but it must be running before you start the dashboard.${NC}"
fi

wait_key

# ── Step 3: Python Environment ───────────────────────────────────────────────
header "Step 3 of 7 — Setting Up Python Environment"

echo "  Installing dashboard dependencies..."
echo ""

if [[ ! -d "$SCRIPT_DIR/venv" ]]; then
    echo -n "  Creating virtual environment... "
    python3 -m venv "$SCRIPT_DIR/venv"
    echo -e "${GREEN}done${NC}"
else
    ok "Virtual environment already exists"
fi

source "$SCRIPT_DIR/venv/bin/activate"

echo -n "  Updating pip... "
pip install --upgrade pip -q 2>/dev/null
echo -e "${GREEN}done${NC}"

echo -n "  Installing core packages... "
pip install -r "$SCRIPT_DIR/requirements.txt" -q 2>/dev/null
echo -e "${GREEN}done${NC}"

echo -n "  Installing PostgreSQL driver (asyncpg)... "
if pip install asyncpg -q 2>/dev/null; then
    echo -e "${GREEN}done${NC}"
else
    echo -e "${YELLOW}skipped${NC} (optional)"
fi

echo -n "  Installing EVM signing (eth-account)... "
if pip install eth-account -q 2>/dev/null; then
    echo -e "${GREEN}done${NC}"
else
    echo -e "${YELLOW}skipped${NC} (optional)"
fi

echo -n "  Installing RLP decoder... "
if pip install rlp -q 2>/dev/null; then
    echo -e "${GREEN}done${NC}"
else
    echo -e "${YELLOW}skipped${NC} (optional)"
fi

echo ""
ok "All dependencies installed"
wait_key

# ── Step 4: Private Key Configuration ────────────────────────────────────────
header "Step 4 of 7 — Configuring Your Validator Key"

echo "  The dashboard needs your validator private key to sign"
echo "  transactions (claim rewards, delegate, vote, etc.)."
echo ""
echo "  Without it, the dashboard runs in ${BOLD}read-only mode${NC}"
echo "  (monitoring works, but no transactions)."
echo ""
echo -e "  ${YELLOW}Your key format:${NC}"
echo "    • 64-character hexadecimal string"
echo "    • No \"0x\" prefix, no quotes"
echo ""
echo -e "  ${YELLOW}Where to find it:${NC}"
echo "    • Hyve Validator app → Settings → Export Private Key"
echo "    • MetaMask → Account Details → Export Private Key"
echo "    • Or derive from your seed phrase"
echo ""

NEED_KEY=true
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    EXISTING_KEY=$(grep -E "^VALIDATOR_PRIVATE_KEY=" "$SCRIPT_DIR/.env" 2>/dev/null | head -1 | cut -d'=' -f2 | tr -d ' "'"'" || echo "")
    if [[ -n "$EXISTING_KEY" && "$EXISTING_KEY" != "your_64_character_hex_private_key_here" && ${#EXISTING_KEY} -eq 64 ]]; then
        ok "Private key already configured (${EXISTING_KEY:0:4}...${EXISTING_KEY: -4})"
        if ! prompt_yn "Keep existing key?" "y"; then
            NEED_KEY=true
        else
            NEED_KEY=false
        fi
    fi
fi

if [[ "$NEED_KEY" == "true" ]]; then
    echo ""
    echo -e "  ${BOLD}Choose an option:${NC}"
    echo ""
    echo "    1) Enter private key now"
    echo "    2) Skip — I'll add it later (read-only mode)"
    echo ""
    CHOICE=$(prompt_input "Enter choice (1 or 2)" "1")

    if [[ "$CHOICE" == "1" ]]; then
        echo ""
        echo -e "  ${DIM}(Your input will be hidden for security)${NC}"
        read -rsp "  Paste your 64-character private key: " PRIV_KEY
        echo ""

        # Validate
        PRIV_KEY=$(echo "$PRIV_KEY" | tr -d '[:space:]' | sed 's/^0x//')
        if [[ ${#PRIV_KEY} -ne 64 ]] || ! [[ "$PRIV_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
            echo ""
            fail "Invalid key format. Expected 64 hex characters."
            echo -e "  ${DIM}You can add it later by editing: $SCRIPT_DIR/.env${NC}"
            PRIV_KEY=""
        else
            echo ""
            ok "Key validated (${PRIV_KEY:0:4}...${PRIV_KEY: -4})"
        fi
    else
        PRIV_KEY=""
        echo ""
        info "Skipping key setup. Dashboard will run in read-only mode."
        info "Add your key later: nano $SCRIPT_DIR/.env"
    fi

    # Write .env
    if [[ -f "$SCRIPT_DIR/.env" ]]; then
        # Update existing .env
        if grep -q "^VALIDATOR_PRIVATE_KEY=" "$SCRIPT_DIR/.env"; then
            sed -i "s|^VALIDATOR_PRIVATE_KEY=.*|VALIDATOR_PRIVATE_KEY=${PRIV_KEY:-your_64_character_hex_private_key_here}|" "$SCRIPT_DIR/.env"
        else
            echo "VALIDATOR_PRIVATE_KEY=${PRIV_KEY:-your_64_character_hex_private_key_here}" >> "$SCRIPT_DIR/.env"
        fi
    else
        cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
        sed -i "s|^VALIDATOR_PRIVATE_KEY=.*|VALIDATOR_PRIVATE_KEY=${PRIV_KEY:-your_64_character_hex_private_key_here}|" "$SCRIPT_DIR/.env"
    fi

    # Write HYVE_NODE_DIR if non-default
    DEFAULT_NODE_DIR="$HOME_DIR/.config/hyve-node"
    if [[ "$HYVE_NODE_DIR" != "$DEFAULT_NODE_DIR" ]]; then
        if grep -q "^HYVE_NODE_DIR=" "$SCRIPT_DIR/.env" 2>/dev/null; then
            sed -i "s|^HYVE_NODE_DIR=.*|HYVE_NODE_DIR=$HYVE_NODE_DIR|" "$SCRIPT_DIR/.env"
        elif grep -q "^# *HYVE_NODE_DIR=" "$SCRIPT_DIR/.env" 2>/dev/null; then
            sed -i "s|^# *HYVE_NODE_DIR=.*|HYVE_NODE_DIR=$HYVE_NODE_DIR|" "$SCRIPT_DIR/.env"
        else
            echo "HYVE_NODE_DIR=$HYVE_NODE_DIR" >> "$SCRIPT_DIR/.env"
        fi
    fi

    # Secure the .env file
    chmod 600 "$SCRIPT_DIR/.env"
    ok ".env file configured (permissions: owner-only)"
fi

wait_key

# ── Step 5: Database Setup ───────────────────────────────────────────────────
header "Step 5 of 7 — Database Setup"

if [[ "$HAS_PG" == "true" ]]; then
    echo "  PostgreSQL is installed. The dashboard can store full metrics"
    echo "  history in a local database for charts and trend analysis."
    echo ""

    if prompt_yn "Set up the PostgreSQL database now?" "y"; then
        echo ""
        DB_CREATED=true

        echo -n "  Creating database user... "
        if sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='hyvedash'" 2>/dev/null | grep -q 1; then
            echo -e "${GREEN}already exists${NC}"
        elif sudo -u postgres psql -c "CREATE USER hyvedash WITH PASSWORD 'hyvedash_local_2024';" 2>/dev/null; then
            echo -e "${GREEN}done${NC}"
        else
            echo -e "${YELLOW}failed (you may need to set this up manually)${NC}"
            DB_CREATED=false
        fi

        echo -n "  Creating database... "
        if sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='hyvedash'" 2>/dev/null | grep -q 1; then
            echo -e "${GREEN}already exists${NC}"
        elif sudo -u postgres psql -c "CREATE DATABASE hyvedash OWNER hyvedash;" 2>/dev/null; then
            echo -e "${GREEN}done${NC}"
        else
            echo -e "${YELLOW}failed (you may need to set this up manually)${NC}"
            DB_CREATED=false
        fi

        if [[ "$DB_CREATED" == "true" ]]; then
            ok "Database ready"
        else
            warn "Some database steps failed. The dashboard will fall back to JSON storage."
            info "You can set up PostgreSQL manually later."
        fi
    else
        info "Skipping database setup. Dashboard will use JSON file storage."
    fi
else
    echo "  PostgreSQL is not installed. The dashboard will store metrics"
    echo "  in local JSON files. This works fine but has limited history."
    echo ""
    info "To enable full metrics history later, install PostgreSQL:"
    info "  sudo apt install postgresql postgresql-client"
    info "Then re-run the installer or set up the database manually."
fi

wait_key

# ── Step 6: Create Directories & Install Services ────────────────────────────
header "Step 6 of 7 — Installing Services"

echo "  The dashboard runs as two systemd services:"
echo ""
echo "    • ${BOLD}hyve-node${NC}     — Manages the hyved validator process"
echo "    • ${BOLD}hyve-dashboard${NC} — Runs the web dashboard (port 8420)"
echo ""
echo "  Both services start automatically on boot."
echo ""

# Create directories
mkdir -p "$HYVE_NODE_DIR/logs" 2>/dev/null || true
mkdir -p "$SCRIPT_DIR/data" 2>/dev/null || true

if prompt_yn "Install and enable systemd services?" "y"; then
    echo ""

    # Generate service files with correct paths
    sed "s|YOUR_USERNAME|$USER_NAME|g; s|/home/YOUR_USERNAME|$HOME_DIR|g" \
        "$SCRIPT_DIR/hyve-node.service" > /tmp/hyve-node.service.tmp

    sed "s|YOUR_USERNAME|$USER_NAME|g; s|/home/YOUR_USERNAME/hyve-node-app|$SCRIPT_DIR|g" \
        "$SCRIPT_DIR/hyve-dashboard.service" > /tmp/hyve-dashboard.service.tmp

    echo "  Installing requires sudo..."
    echo ""

    sudo cp /tmp/hyve-node.service.tmp /etc/systemd/system/hyve-node.service
    sudo cp /tmp/hyve-dashboard.service.tmp /etc/systemd/system/hyve-dashboard.service
    sudo chmod 644 /etc/systemd/system/hyve-node.service /etc/systemd/system/hyve-dashboard.service
    sudo systemctl daemon-reload
    sudo systemctl enable hyve-node.service 2>/dev/null
    sudo systemctl enable hyve-dashboard.service 2>/dev/null

    rm -f /tmp/hyve-node.service.tmp /tmp/hyve-dashboard.service.tmp

    ok "Services installed and enabled (start on boot)"
    SERVICES_INSTALLED=true
else
    info "Skipping service installation."
    info "You can run the dashboard manually with: ./run.sh"
    SERVICES_INSTALLED=false
fi

wait_key

# ── Step 7: Start & Verify ───────────────────────────────────────────────────
header "Step 7 of 7 — Starting the Dashboard"

if [[ "${SERVICES_INSTALLED:-false}" == "true" ]]; then
    if prompt_yn "Start the services now?" "y"; then
        echo ""

        # Check if node is already running
        if pgrep -x hyved &>/dev/null; then
            ok "Node is already running"
        else
            echo -n "  Starting hyve-node... "
            sudo systemctl start hyve-node.service
            echo -e "${GREEN}done${NC}"
            echo -n "  Waiting for node to initialize"
            for i in {1..10}; do
                echo -n "."
                sleep 1
            done
            echo ""
        fi

        echo -n "  Starting hyve-dashboard... "
        sudo systemctl start hyve-dashboard.service
        echo -e "${GREEN}done${NC}"

        sleep 3

        # Verify dashboard is accessible
        if curl -s --connect-timeout 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:8420/login 2>/dev/null | grep -q "200"; then
            ok "Dashboard is running and accessible!"
        else
            warn "Dashboard started but not yet responding (may need a moment)"
        fi

        # Get the admin password
        echo ""
        ADMIN_PASS=$(sudo journalctl -u hyve-dashboard --no-pager -n 50 2>/dev/null | grep -oP 'Admin password: \K.+' | tail -1 || echo "")

        if [[ -n "$ADMIN_PASS" ]]; then
            echo -e "  ${BOLD}Your login credentials:${NC}"
            echo ""
            echo -e "    Username: ${CYAN}admin${NC}"
            echo -e "    Password: ${CYAN}${ADMIN_PASS}${NC}"
            echo ""
            echo -e "  ${YELLOW}Save this password! You'll need it to log in.${NC}"
            echo -e "  ${DIM}You can change it from the Settings tab once logged in.${NC}"
        else
            echo -e "  ${DIM}To get your login password:${NC}"
            echo "    sudo journalctl -u hyve-dashboard | grep 'Admin password'"
        fi
    else
        info "Services installed but not started."
        info "Start them with:"
        info "  sudo systemctl start hyve-node"
        info "  sudo systemctl start hyve-dashboard"
    fi
else
    echo "  To run the dashboard manually:"
    echo ""
    echo "    cd $SCRIPT_DIR"
    echo "    source venv/bin/activate"
    echo "    ./run.sh"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo ""
echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║                                                  ║"
echo "  ║         Installation Complete!                   ║"
echo "  ║                                                  ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "  ${BOLD}Dashboard URL:${NC}  http://127.0.0.1:8420"
echo ""

echo -e "  ${BOLD}Useful Commands:${NC}"
echo ""
echo "    Status:     sudo systemctl status hyve-dashboard"
echo "    Logs:       sudo journalctl -u hyve-dashboard -f"
echo "    Restart:    sudo systemctl restart hyve-dashboard"
echo "    Stop all:   sudo systemctl stop hyve-dashboard && sudo systemctl stop hyve-node"
echo ""

if [[ -z "${PRIV_KEY:-}" && "${NEED_KEY:-true}" == "true" ]]; then
    echo -e "  ${YELLOW}Reminder: Add your private key to enable transactions:${NC}"
    echo "    nano $SCRIPT_DIR/.env"
    echo ""
fi

echo -e "  ${BOLD}Files:${NC}"
echo ""
echo "    .env          — Configuration (private key, settings)"
echo "    data/         — Runtime data"
echo "    venv/         — Python virtual environment"
echo ""
echo -e "  ${DIM}Auto-generated on first run (do not edit):${NC}"
echo "    .auth.json    — Login credentials (delete to reset password)"
echo "    .secret_key   — Session signing key"
echo ""
echo -e "  ${GREEN}Happy validating! 🚀${NC}"
echo ""
