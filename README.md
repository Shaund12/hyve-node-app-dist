# Hyve Validator Dashboard

A full-featured web dashboard for monitoring and managing your Hyve blockchain validator node. Built for validators running the Hyve chain (EVM-compatible Cosmos SDK, chain ID `hyve_7847-1`).

![Dashboard](https://img.shields.io/badge/status-active-brightgreen) ![Python](https://img.shields.io/badge/python-3.10%2B-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Real-time monitoring** — Live block height, peers, signing uptime, rewards, commission via WebSocket
- **Staking operations** — Claim rewards, compound (claim + restake), delegate, redelegate
- **SHADE token** — Balance, pending claims, allocation tracking, one-click claim
- **Governance** — View proposals, cast votes directly from the dashboard
- **35+ tabs** — Validators, signing, slash risk, strategy, auto-compound, health score, rank tracker, uptime heatmap, benchmarks, delegators, chain params, block explorer, peer map, peer quality, TX history, system stats, disk forecast, RPC monitor, notes/journal, tax report, alert config, export/backup, logs, timeline, validator comparison, earnings calculator, resource charts, commission income, consensus participation, whale alerts
- **Auto-compound** — Configurable automatic claim + restake when rewards exceed threshold
- **Discord integration** — Webhook alerts, hourly status reports, daily journal summaries
- **Dark/Light theme** — Toggle with button or keyboard shortcut
- **Command palette** — Ctrl+K for quick navigation (35+ searchable actions)
- **Keyboard shortcuts** — Press `?` to see all shortcuts
- **Node control** — Start, stop, restart your hyved node from the browser
- **PostgreSQL** — Full metrics history with automatic JSON fallback
- **Security** — Cookie-based auth, PBKDF2-SHA256 password hashing, rate-limited login

---

## Prerequisites (IMPORTANT — Read Before Installing)

Before installing the dashboard, you **must** have a fully installed, initialized, and synced Hyve validator node on the same machine. The dashboard connects to the node's local RPC ports — it cannot run on a separate machine.

### Required Software

| Software | Version | How to check | Install |
|----------|---------|-------------|---------|
| **Linux** | Ubuntu 22.04+ recommended | `cat /etc/os-release` | — |
| **Python** | 3.10 or higher | `python3 --version` | `sudo apt install python3 python3-venv python3-pip` |
| **Hyve Node** | Latest | `~/.config/hyve-node/bin/hyved version` | See below |
| **PostgreSQL** | 14+ *(optional, recommended)* | `psql --version` | `sudo apt install postgresql postgresql-client` |

### Required: Hyve Node Installation

You must have the Hyve node installed before setting up the dashboard. The default installation creates the following directory structure:

```
~/.config/hyve-node/              <-- HYVE_NODE_DIR (this is the root)
├── bin/
│   ├── hyved                     <-- The validator binary (MUST be executable)
│   └── *.so / *.dylib            <-- Shared libraries (LD_LIBRARY_PATH must include this dir)
├── home/                         <-- hyved --home directory (chain state & keyring)
│   ├── config/
│   │   ├── config.toml           <-- CometBFT config (RPC ports, peers, etc.)
│   │   ├── app.toml              <-- Cosmos app config (REST, gRPC, EVM ports)
│   │   ├── genesis.json          <-- Chain genesis
│   │   ├── node_key.json         <-- Node identity key
│   │   └── priv_validator_key.json  <-- Consensus signing key
│   ├── data/                     <-- Blockchain database (grows over time, 10+ GB)
│   │   ├── application.db/
│   │   ├── blockstore.db/
│   │   └── state.db/
│   └── keyring-test/             <-- Local test keyring (dashboard imports signing key here)
│       └── *.info / *.address    <-- Auto-created by the dashboard on first run
└── logs/
    └── app.log                   <-- hyved log output (tailed by the dashboard)
```

**If your node is installed elsewhere** (not at `~/.config/hyve-node/`), set the `HYVE_NODE_DIR` environment variable in your `.env` file to point to the correct location.

### Required: Node Must Be Running & Synced

The dashboard connects to your node's local RPC ports. All of these must be accessible on `127.0.0.1`:

| Service | Default Port | Config File | Config Key | What It's Used For |
|---------|-------------|-------------|------------|-------------------|
| **CometBFT RPC** | `26657` | `config.toml` | `[rpc] laddr` | Block height, validators, signing info, peers |
| **Cosmos REST API** | `1317` | `app.toml` | `[api] address` | Staking, balances, governance, delegators |
| **EVM JSON-RPC** | `8545` | `app.toml` | `[json-rpc] address` | SHADE token contract, EVM interactions |
| **gRPC** | `9090` | `app.toml` | `[grpc] address` | Alternative queries (not required) |

**Verify your node is running and accessible before starting the dashboard:**

```bash
# Check the node process
ps aux | grep hyved

# Check CometBFT RPC (should return JSON with sync_info)
curl -s http://127.0.0.1:26657/status | python3 -m json.tool | head -20

# Check Cosmos REST (should return node info)
curl -s http://127.0.0.1:1317/cosmos/base/tendermint/v1beta1/node_info | head -5

# Check EVM RPC (should return chain ID)
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

# Check sync status (catching_up should be false)
curl -s http://127.0.0.1:26657/status | python3 -c "
import json,sys
d=json.load(sys.stdin)['result']['sync_info']
print(f\"Latest block: {d['latest_block_height']}\")
print(f\"Catching up:  {d['catching_up']}\")
"
```

If `catching_up` is `true`, wait for your node to finish syncing before using the dashboard.

---

## Quick Start

### 1. Clone and run the guided installer

```bash
git clone <this-repo> hyve-node-app
cd hyve-node-app
chmod +x install.sh
./install.sh
```

The setup script will:
- Verify Python 3.10+ and python3-venv are installed
- Create a Python virtual environment (`venv/`) and install all dependencies
- Copy `.env.example` → `.env` and prompt you to edit it
- Create PostgreSQL user and database (if PostgreSQL is installed)
- Create necessary directories (`~/.config/hyve-node/logs/`, `data/`)
- Install and enable two systemd services (`hyve-node`, `hyve-dashboard`)

### 2. Configure your `.env` file (REQUIRED)

```bash
nano .env
```

You **must** set at least `VALIDATOR_PRIVATE_KEY`. See the **Environment Variables** section below for the full list.

### 3. Start the services

```bash
sudo systemctl start hyve-node        # Start your validator node
sleep 10                               # Wait for the node to initialize
sudo systemctl start hyve-dashboard    # Start the dashboard
```

### 4. Get your login credentials

On first run, the dashboard auto-generates an admin password and prints it to the log:

```bash
sudo journalctl -u hyve-dashboard | grep "Admin password"
```

**Save this password!** You will need it to log into the dashboard. You can change it later from the Settings tab.

### 5. Access the dashboard

Open `http://127.0.0.1:8420` in your browser.

- **Username:** `admin`
- **Password:** *(from step 4)*

---

## Environment Variables — Complete Reference

All variables are set in the `.env` file in the dashboard directory. Only `VALIDATOR_PRIVATE_KEY` is required — everything else has sensible defaults.

### VALIDATOR_PRIVATE_KEY (REQUIRED)

```bash
VALIDATOR_PRIVATE_KEY=your_64_character_hex_private_key_here
```

- **What it is:** Your validator's private key in hex format
- **Format:** 64-character hex string, **without** the `0x` prefix
- **Example:** `a1b2c3d4e5f6...` (64 chars)
- **Used for:** Signing transactions — claim rewards, delegate, compound, vote on governance
- **How to get it:** Export from your wallet (e.g., MetaMask → Account Details → Export Private Key) or from your keyring
- **Security:** This file is git-ignored and never leaves your machine. The key is imported into hyved's local `test` keyring at startup. **Never share this key or commit it to git.**
- **Without it:** The dashboard will run in **read-only mode** — you can view all metrics but cannot execute transactions

### DATABASE_URL (Optional, Recommended)

```bash
DATABASE_URL=postgresql://hyvedash:your_password@127.0.0.1:5432/hyvedash
```

- **What it is:** PostgreSQL connection string
- **Default:** `postgresql://hyvedash:hyvedash_local_2024@127.0.0.1:5432/hyvedash`
- **Format:** `postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE_NAME`
- **Used for:** Storing metrics history, RPC performance data, rewards log, rank history, notes, and configuration
- **Without it:** The dashboard falls back to local JSON files. This works but limits history retention and query performance.
- **Database tables created automatically:** `metrics_history`, `rpc_metrics`, `rewards_log`, `rank_history`, `notes`, `config`

**To set up PostgreSQL manually:**

```bash
# Install PostgreSQL
sudo apt install postgresql postgresql-client

# Create the user and database
sudo -u postgres psql <<EOF
CREATE USER hyvedash WITH PASSWORD 'choose_a_strong_password_here';
CREATE DATABASE hyvedash OWNER hyvedash;
GRANT ALL PRIVILEGES ON DATABASE hyvedash TO hyvedash;
EOF

# Then set in .env:
# DATABASE_URL=postgresql://hyvedash:choose_a_strong_password_here@127.0.0.1:5432/hyvedash
```

### HYVE_NODE_DIR (Optional)

```bash
HYVE_NODE_DIR=/home/your_username/.config/hyve-node
```

- **What it is:** Absolute path to your Hyve node installation directory
- **Default:** `~/.config/hyve-node` (expands to `/home/your_username/.config/hyve-node`)
- **Must contain:**
  - `bin/hyved` — The validator binary (must be executable: `chmod +x bin/hyved`)
  - `home/` — The hyved home directory with `config/`, `data/`, `keyring-test/`
  - `logs/` — Log directory (created by setup script if missing)
- **Used for:** Locating the hyved binary, reading logs, managing the keyring, running transactions via `hyved tx` commands
- **Change this if:** Your node is installed somewhere other than the default location

### HYVE_DASH_PORT (Optional)

```bash
HYVE_DASH_PORT=8420
```

- **What it is:** TCP port the dashboard web server listens on
- **Default:** `8420`
- **Change this if:** Port 8420 is already in use, or you want a custom port

### HYVE_DASH_HOST (Optional)

```bash
HYVE_DASH_HOST=127.0.0.1
```

- **What it is:** Network interface the dashboard binds to
- **Default:** `127.0.0.1` (localhost only — accessible only from this machine)
- **Set to `0.0.0.0`** to allow access from other machines on your LAN
- **Security warning:** If you bind to `0.0.0.0`, anyone on your network can access the dashboard login page. Use a firewall or reverse proxy for production.

### Full `.env` Example

```bash
# ── Required ────────────────────────────────────────────
VALIDATOR_PRIVATE_KEY=a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890

# ── Optional (uncomment and change as needed) ───────────
# DATABASE_URL=postgresql://hyvedash:my_secure_password@127.0.0.1:5432/hyvedash
# HYVE_NODE_DIR=/home/myuser/.config/hyve-node
# HYVE_DASH_PORT=8420
# HYVE_DASH_HOST=0.0.0.0
```

---

## Chain Constants (Hard-Coded — Do NOT Change)

These values are specific to the Hyve chain and are built into `server.py`. They are listed here for reference only:

| Constant | Value | Description |
|----------|-------|-------------|
| `CHAIN_ID` | `hyve_7847-1` | Hyve chain identifier |
| `EVM_CHAIN_ID` | `7847` | EVM-compatible chain ID |
| `DENOM` | `ahyve` | Smallest denomination (like wei for ETH) |
| `DENOM_EXPONENT` | `18` | 1 HYVE = 10^18 ahyve |
| `RPC_URL` | `http://127.0.0.1:26657` | CometBFT RPC URL |
| `REST_URL` | `http://127.0.0.1:1317` | Cosmos REST API URL |
| `EVM_RPC_URL` | `http://127.0.0.1:8545` | EVM JSON-RPC URL |
| `SHADE_TOKEN` | `0x57b58dec...fDbf` | SHADE token ERC-20 contract address |
| `SHADE_EMISSION` | `0x14D0203...85d1` | SHADE emission contract address |

**Address prefixes:** `hyve` (accounts), `hyvevaloper` (validator operator), `hyvevalcons` (validator consensus)

---

## Manual Setup (Step-by-Step, Without setup.sh)

If you prefer to set things up manually or the automated script doesn't work for your environment:

### Step 1: Create Python Virtual Environment

```bash
cd hyve-node-app
python3 -m venv venv
source venv/bin/activate
```

### Step 2: Install Dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt

# Recommended optional packages:
pip install asyncpg        # PostgreSQL async driver (enables full metrics history)
pip install eth-account    # EVM transaction signing (required for SHADE token claims)
```

### Step 3: Create and Configure `.env`

```bash
cp .env.example .env
nano .env
```

At minimum, set `VALIDATOR_PRIVATE_KEY` (see Environment Variables section above for full details).

### Step 4: Set Up PostgreSQL (Optional but Recommended)

```bash
sudo -u postgres psql -c "CREATE USER hyvedash WITH PASSWORD 'choose_a_password';"
sudo -u postgres psql -c "CREATE DATABASE hyvedash OWNER hyvedash;"
```

Then update `DATABASE_URL` in `.env` to match the password you chose.

### Step 5: Verify Your Node Is Running

```bash
# The hyved binary must be at this path (or wherever HYVE_NODE_DIR points):
ls -la ~/.config/hyve-node/bin/hyved

# The node must be running:
curl -s http://127.0.0.1:26657/status | python3 -c "
import json,sys
d=json.load(sys.stdin)['result']['sync_info']
print(f\"Block: {d['latest_block_height']}, Catching up: {d['catching_up']}\")
"
```

### Step 6: Run the Dashboard

```bash
./run.sh
# Or directly:
python3 -m uvicorn server:app --host 127.0.0.1 --port 8420 --log-level warning
```

### Step 7: Get Your Admin Password

On first startup, the dashboard generates a random admin password and prints it to stdout:
```
Admin password: xxxxxxxx
```

If running via systemd, find it in the journal:
```bash
sudo journalctl -u hyve-dashboard | grep "Admin password"
```

---

## Systemd Services — Detailed Setup

The repository includes two systemd service files. **Both require editing before use.**

### What Needs to Change in the Service Files

#### `hyve-node.service` — Runs the hyved validator process

Every instance of `YOUR_USERNAME` must be replaced with your actual Linux username. The file contains **10+ occurrences:**

| Line | Placeholder | Replace with | Example |
|------|------------|-------------|---------|
| `User=` | `YOUR_USERNAME` | Your Linux username | `User=alice` |
| `Group=` | `YOUR_USERNAME` | Your Linux username | `Group=alice` |
| `WorkingDirectory=` | `/home/YOUR_USERNAME/...` | Your actual home path | `/home/alice/.config/hyve-node/home` |
| `Environment=` | `/home/YOUR_USERNAME/...` | Your actual home path | `LD_LIBRARY_PATH=/home/alice/.config/hyve-node/bin` |
| `ExecStart=` | `/home/YOUR_USERNAME/...` | Your actual home path | `/home/alice/.config/hyve-node/bin/hyved start ...` |
| `StandardOutput=` | `/home/YOUR_USERNAME/...` | Your actual home path | `append:/home/alice/.config/hyve-node/logs/app.log` |

#### `hyve-dashboard.service` — Runs the dashboard web server

| Line | Placeholder | Replace with | Example |
|------|------------|-------------|---------|
| `User=` | `YOUR_USERNAME` | Your Linux username | `User=alice` |
| `Group=` | `YOUR_USERNAME` | Your Linux username | `Group=alice` |
| `WorkingDirectory=` | `/home/YOUR_USERNAME/hyve-node-app` | Full path to dashboard directory | `/home/alice/hyve-node-app` |
| `ExecStart=` | `/home/YOUR_USERNAME/hyve-node-app/...` | Full path to dashboard venv + directory | See below |

**Important:** If you cloned the dashboard to a directory other than `~/hyve-node-app/`, you must also update the `WorkingDirectory` and `--app-dir` paths in `hyve-dashboard.service`.

### Quick Replace (One Command)

```bash
# Replace all YOUR_USERNAME placeholders with your actual username:
sed -i "s/YOUR_USERNAME/$(whoami)/g" hyve-node.service hyve-dashboard.service

# If your dashboard is NOT at ~/hyve-node-app/, also fix the dashboard paths:
# Example: if dashboard is at /opt/hyve-dashboard/
# sed -i "s|/home/$(whoami)/hyve-node-app|/opt/hyve-dashboard|g" hyve-dashboard.service
```

### Verify the Service Files Before Installing

```bash
# Review and confirm paths are correct:
echo "=== hyve-node.service ==="
grep -E "User=|WorkingDirectory=|ExecStart=|Environment=" hyve-node.service

echo ""
echo "=== hyve-dashboard.service ==="
grep -E "User=|WorkingDirectory=|ExecStart=" hyve-dashboard.service
```

Make sure:
- All paths exist on disk
- `User=` matches your Linux username (check with `whoami`)
- The hyved binary is executable: `chmod +x ~/.config/hyve-node/bin/hyved`
- The venv python exists: `ls -la venv/bin/python3`

### Install and Enable Services

```bash
sudo cp hyve-node.service /etc/systemd/system/
sudo cp hyve-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable hyve-node hyve-dashboard

# Start the node first, then the dashboard:
sudo systemctl start hyve-node
sleep 10         # Give the node time to start up
sudo systemctl start hyve-dashboard
```

### Service Commands Reference

```bash
# ── Check status ──
sudo systemctl status hyve-node
sudo systemctl status hyve-dashboard

# ── View live logs ──
sudo journalctl -u hyve-node -f          # Node logs
sudo journalctl -u hyve-dashboard -f     # Dashboard logs

# ── Restart after config changes ──
sudo systemctl restart hyve-dashboard

# ── Stop everything ──
sudo systemctl stop hyve-dashboard
sudo systemctl stop hyve-node

# ── After editing .service files ──
sudo systemctl daemon-reload
sudo systemctl restart hyve-node hyve-dashboard
```

---

## What Gets Created Automatically at Runtime

When you start the dashboard for the first time, it creates several files automatically. **You do NOT need to create these yourself:**

| File | Location | Purpose | Can You Delete It? |
|------|----------|---------|-------------------|
| `.auth.json` | Dashboard directory | Admin username, hashed password, session key | Yes — dashboard regenerates it with a new password on restart |
| `.secret_key` | Dashboard directory | Session signing key (random hex) | Yes — dashboard regenerates on restart (invalidates active sessions) |
| `data/` | Dashboard directory | Runtime data storage | Yes — but you lose any locally stored data |
| `history.json` | Dashboard directory | JSON metrics fallback (if no PostgreSQL) | Auto-migrated to PostgreSQL when DB becomes available |
| `keyring-test/` | `HYVE_NODE_DIR/home/` | Validator signing key imported by dashboard | Recreated on dashboard restart if private key is in `.env` |

---

## Dashboard Default Settings (Configurable via UI)

These defaults are built in and can be changed from the dashboard Settings and Alert Config tabs:

| Setting | Default | Where to Change |
|---------|---------|----------------|
| Admin username | `admin` | Cannot be changed (hardcoded) |
| Admin password | Auto-generated | Settings tab → Change Password |
| Missed blocks warning | `100` blocks | Alert Config tab |
| Missed blocks critical | `500` blocks | Alert Config tab |
| Uptime warning | `99.0%` | Alert Config tab |
| Uptime critical | `95.0%` | Alert Config tab |
| Low balance warning | `1.0` HYVE | Alert Config tab |
| Stale block alert | `60` seconds | Alert Config tab |
| Auto-compound enabled | `No` | Auto-Compound tab |
| Auto-compound threshold | `10.0` HYVE | Auto-Compound tab |
| Auto-compound interval | `24` hours | Auto-Compound tab |
| Whale alert threshold | `1000` HYVE | Built-in (whale delegation alerts) |
| Discord webhook | *(not set)* | Alert Config tab |
| Login rate limit | 5 attempts / 5 min | Built-in (not configurable) |

---

## LAN Access

By default, the dashboard only listens on `127.0.0.1` (localhost). To access it from other devices on your LAN:

### Option 1: Set in `.env` (Persistent)

```bash
echo "HYVE_DASH_HOST=0.0.0.0" >> .env
sudo systemctl restart hyve-dashboard
```

### Option 2: Environment Variable (Temporary)

```bash
HYVE_DASH_HOST=0.0.0.0 ./run.sh
```

Then access the dashboard from any device on your network at:
```
http://<your-server-ip>:8420
```

Find your server's IP with: `hostname -I | awk '{print $1}'`

### Firewall

If you're using `ufw`, allow the dashboard port:
```bash
sudo ufw allow 8420/tcp
```

---

## Discord Alerts Setup

1. In your Discord server, go to **Server Settings → Integrations → Webhooks**
2. Click **New Webhook**, name it (e.g., "Hyve Validator"), choose a channel
3. Copy the webhook URL
4. In the dashboard, go to the **Alert Config** tab
5. Paste the webhook URL and toggle notifications on

The dashboard can send:
- **Instant alerts** — Missed blocks, low uptime, low balance, stale blocks
- **Hourly status reports** — Block height, signing %, rewards, peers
- **Daily journal summaries** — Aggregated daily metrics

---

## File Structure

```
hyve-node-app/                      <-- Dashboard installation directory
├── server.py                       # FastAPI backend — all API endpoints, WebSockets, DB logic
├── dashboard.html                  # Single-file frontend — HTML + CSS + JS (uses Chart.js)
├── requirements.txt                # Python package dependencies
├── .env.example                    # Environment variable template (copy to .env)
├── .env                            # ⚠️  YOUR config — contains private key (git-ignored)
├── run.sh                          # Dev launcher (activates venv, runs uvicorn)
├── setup.sh                        # Automated first-time setup script
├── hyve-node.service               # systemd unit file for the hyved process
├── hyve-dashboard.service          # systemd unit file for the dashboard server
├── .auth.json                      # 🔒 Auto-generated admin credentials (git-ignored)
├── .secret_key                     # 🔒 Auto-generated session key (git-ignored)
├── venv/                           # Python virtual environment (created by setup.sh)
└── data/                           # Runtime data storage (git-ignored)
```

---

## API Endpoints Reference

The dashboard exposes 60+ REST endpoints under `/api/` and 2 WebSocket endpoints. Key endpoints:

| Endpoint | Method | Auth Required | Description |
|----------|--------|:---:|-------------|
| `/api/auth/login` | POST | No | Log in (returns session cookie) |
| `/api/status` | GET | Yes | Node status, block height, peers, catching_up |
| `/api/staking` | GET | Yes | Staking data, delegation, rewards, commission |
| `/api/signing` | GET | Yes | Signing uptime %, missed blocks, window |
| `/api/shade` | GET | Yes | SHADE token balance, pending claims |
| `/api/network` | GET | Yes | Network overview, validator count, inflation |
| `/api/delegators` | GET | Yes | Your delegators and their stakes |
| `/api/tx/claim` | POST | Yes | Claim pending rewards + commission |
| `/api/tx/compound` | POST | Yes | Claim + restake in one transaction |
| `/api/tx/delegate` | POST | Yes | Delegate HYVE to your validator |
| `/api/governance` | GET | Yes | Active governance proposals |
| `/api/tx/vote` | POST | Yes | Cast a governance vote |
| `/api/health-score` | GET | Yes | Composite node health score |
| `/api/validator-compare` | GET | Yes | Top 20 validators comparison |
| `/api/resource-history` | GET | Yes | CPU, memory, disk, peer count history |
| `/api/commission-income` | GET | Yes | Daily commission income (90-day chart) |
| `/api/consensus` | GET | Yes | Block proposals, voting power share |
| `/api/whale-alerts` | GET | Yes | Large delegation/undelegation events |
| `/ws/live` | WebSocket | Yes | Real-time updates (2-second interval) |
| `/ws/logs` | WebSocket | Yes | Live hyved log streaming |

---

## RPC Ports Reference

These are the ports your Hyve node exposes locally. The dashboard connects to all of them on `127.0.0.1`:

| Service | Port | Config file | Used for |
|---------|------|-------------|----------|
| CometBFT RPC | `26657` | `~/.config/hyve-node/home/config/config.toml` | Block data, validators, signing, peers |
| Cosmos REST API | `1317` | `~/.config/hyve-node/home/config/app.toml` | Staking, governance, balances, delegators |
| EVM JSON-RPC | `8545` | `~/.config/hyve-node/home/config/app.toml` | SHADE token, EVM contract interactions |
| gRPC | `9090` | `~/.config/hyve-node/home/config/app.toml` | Alternative query interface (not required) |
| **Dashboard** | `8420` | `.env` (`HYVE_DASH_PORT`) | This dashboard's web UI |

If your node uses non-default ports, you will need to edit the constants in `server.py` (lines ~45-47: `RPC_URL`, `REST_URL`, `EVM_RPC_URL`).

---

## Troubleshooting

### Dashboard shows "Offline"
1. Verify hyved is running: `sudo systemctl status hyve-node`
2. Check RPC is accessible: `curl http://127.0.0.1:26657/status`
3. Check if node is syncing: Look for `catching_up: true` in the status output
4. Check dashboard logs: `sudo journalctl -u hyve-dashboard -f`
5. Check the hyved log: `tail -50 ~/.config/hyve-node/logs/app.log`

### "VALIDATOR_PRIVATE_KEY not configured"
1. Edit `.env`: `nano .env`
2. Set `VALIDATOR_PRIVATE_KEY=your_64_char_hex_key` (no `0x` prefix, no quotes)
3. Restart: `sudo systemctl restart hyve-dashboard`
4. The dashboard still works without it, but you cannot sign transactions

### Transactions fail / "key not found"
1. Verify the private key is correct (64 hex characters, no `0x` prefix)
2. Check that the key's associated address has funds on Hyve chain
3. Check the keyring was created: `ls ~/.config/hyve-node/home/keyring-test/`
4. Restart the dashboard to re-import: `sudo systemctl restart hyve-dashboard`

### PostgreSQL connection failed
- The dashboard **automatically** falls back to JSON file storage — it will still work
- To fix: `sudo systemctl status postgresql` (must be active)
- Verify DSN: `psql "postgresql://hyvedash:your_password@127.0.0.1:5432/hyvedash"` (should connect)
- Check `DATABASE_URL` in `.env` matches your PostgreSQL credentials

### Login password lost
```bash
rm .auth.json
sudo systemctl restart hyve-dashboard
sudo journalctl -u hyve-dashboard | grep "Admin password"
```
A new random password will be generated.

### Port already in use
```bash
# Check what's using port 8420:
sudo lsof -i :8420

# Option 1: Kill the existing process
pkill -f "uvicorn.*8420"

# Option 2: Use a different port
# Add to .env: HYVE_DASH_PORT=9000
# Then restart: sudo systemctl restart hyve-dashboard
```

### hyve-node.service fails to start
1. Check the hyved binary exists and is executable:
   ```bash
   ls -la ~/.config/hyve-node/bin/hyved
   chmod +x ~/.config/hyve-node/bin/hyved
   ```
2. Check LD_LIBRARY_PATH is set correctly in the service file
3. Try running hyved manually to see the error:
   ```bash
   export LD_LIBRARY_PATH=~/.config/hyve-node/bin
   ~/.config/hyve-node/bin/hyved start --home ~/.config/hyve-node/home --chain-id hyve_7847-1
   ```
4. Check logs: `sudo journalctl -u hyve-node -f`

### Dashboard starts but shows no data
1. The node must be **fully synced** (`catching_up: false`)
2. All three RPC ports must be accessible (26657, 1317, 8545)
3. Check each port individually:
   ```bash
   curl -s http://127.0.0.1:26657/status > /dev/null && echo "RPC OK" || echo "RPC FAIL"
   curl -s http://127.0.0.1:1317/cosmos/base/tendermint/v1beta1/node_info > /dev/null && echo "REST OK" || echo "REST FAIL"
   curl -s -X POST http://127.0.0.1:8545 -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' > /dev/null && echo "EVM OK" || echo "EVM FAIL"
   ```

---

## Security Notes

- **`.env` contains your private key** — never commit it, share it, or back it up to cloud storage
- The `.env`, `.auth.json`, and `.secret_key` files are all in `.gitignore`
- The dashboard is designed for **local/LAN use only** — do NOT expose port 8420 to the public internet without:
  - A reverse proxy (nginx/caddy) with TLS/HTTPS
  - Firewall rules to restrict access
- Auth uses **PBKDF2-SHA256** with 200,000 iterations and random salts
- Login is **rate-limited** to 5 attempts per 5 minutes per IP address
- Sessions are stored **in-memory** — they don't survive dashboard restarts
- The `test` keyring backend is used for signing — it stores keys unencrypted on disk in `keyring-test/`

---

## Mobile App

A React Native companion app is included in `hyve-mobile/`. It connects remotely to your dashboard server and provides full feature parity — staking, governance, analytics, node control, logs, and more — all from your phone.

- **Android** — Build the APK on any platform with Java 17 + Android SDK
- **iOS** — Requires a Mac with Xcode 15+

See [`hyve-mobile/README.md`](hyve-mobile/README.md) for complete build and setup instructions.

---

## License

MIT
