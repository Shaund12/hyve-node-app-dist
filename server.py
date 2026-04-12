#!/usr/bin/env python3
"""Hyve Validator Dashboard - Full-featured with auth, PostgreSQL, and monitoring."""

import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import subprocess
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import httpx
import psutil
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

try:
    import asyncpg
except ImportError:
    asyncpg = None

try:
    from eth_account import Account as EthAccount
    from eth_account.signers.local import LocalAccount
except ImportError:
    EthAccount = None
    LocalAccount = None

try:
    import asyncssh
except ImportError:
    asyncssh = None

# ── Configuration ────────────────────────────────────────────────────────────
HYVE_NODE_DIR = Path(os.environ.get("HYVE_NODE_DIR", Path.home() / ".config" / "hyve-node"))
HYVED_BIN = HYVE_NODE_DIR / "bin" / "hyved"
HYVED_HOME = HYVE_NODE_DIR / "home"
CHAIN_ID = "hyve_7847-1"
RPC_URL = "http://127.0.0.1:26657"
REST_URL = "http://127.0.0.1:1317"
LOG_DIR = HYVE_NODE_DIR / "logs"
LOG_FILE = LOG_DIR / "app.log"
VALIDATOR_OPERATOR_FILE = HYVED_HOME / "validator-operator.json"
DASHBOARD_DIR = Path(__file__).parent
HISTORY_FILE = DASHBOARD_DIR / "history.json"
AUTH_FILE = DASHBOARD_DIR / ".auth.json"
DENOM = "ahyve"
DENOM_EXPONENT = 18

EVM_RPC_URL = "http://127.0.0.1:8545"
SHADE_TOKEN = "0x57b58dec11e91DB9f19acAe660093b178859fDbf"
SHADE_EMISSION = "0x14D0203886A4cbA5c146F8C60f8c9F0FbB2785d1"
SHADE_DECIMALS = 18

SECRET_KEY = ""
DB_DSN = os.environ.get("DATABASE_URL", "postgresql://hyvedash:hyvedash_local_2024@127.0.0.1:5432/hyvedash")
VALIDATOR_PRIVATE_KEY = ""
EVM_CHAIN_ID = 7847

app = FastAPI(title="Hyve Validator Dashboard")

db_pool = None
_sessions = {}
_eth_account: "LocalAccount | None" = None
_rpc_buffer = deque(maxlen=500)
_auth_config = None
_login_attempts = {}
_alert_config = {
    "missed_blocks_warn": 100, "missed_blocks_crit": 500,
    "uptime_warn": 99.0, "uptime_crit": 95.0,
    "low_balance": 1.0, "stale_blocks_secs": 60,
}
_discord_config = {"webhook_url": "", "enabled": False}
_last_notified = {}  # type -> timestamp, to avoid spam
_auto_compound_config = {"enabled": False, "threshold": 10.0, "interval_hours": 24}
_whale_threshold = 1000  # HYVE
_last_hyved_pid = None  # For node restart detection
_last_known_valset = set()  # For validator set change tracking
_last_known_delegators = {}  # For delegation change tracking
_rank_history = deque(maxlen=720)  # ~30 days at 1/hour
_failover_config = {
    "enabled": False, "host": "", "port": 22, "username": "root",
    "ssh_key_path": "", "remote_hyved_path": "", "remote_hyved_home": "",
    "remote_rpc_port": 26657, "auto_failover": False,
    "health_check_interval": 30, "max_failures": 3,
}
_failover_state = {
    "active_node": "primary", "failover_available": False,
    "primary_healthy": True, "failover_healthy": False,
    "consecutive_failures": 0, "last_check": None,
    "last_failover_event": None,
}


# ── Pydantic Models ──────────────────────────────────────────────────────────
class TxRequest(BaseModel):
    password: str = ""

class DelegateRequest(TxRequest):
    amount: str = Field(..., pattern=r"^\d+(\.\d+)?$")
    validator: str = Field(..., pattern=r"^hyvevaloper[a-z0-9]+$")

class RedelegateRequest(TxRequest):
    amount: str = Field(..., pattern=r"^\d+(\.\d+)?$")
    src_validator: str = Field(..., pattern=r"^hyvevaloper[a-z0-9]+$")
    dst_validator: str = Field(..., pattern=r"^hyvevaloper[a-z0-9]+$")

class LoginRequest(BaseModel):
    username: str
    password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)

class NoteRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field("", max_length=5000)
    category: str = Field("general", pattern=r"^(general|upgrade|incident|maintenance)$")

class AlertConfigRequest(BaseModel):
    missed_blocks_warn: int = Field(100, ge=1, le=100000)
    missed_blocks_crit: int = Field(500, ge=1, le=100000)
    uptime_warn: float = Field(99.0, ge=50, le=100)
    uptime_crit: float = Field(95.0, ge=50, le=100)
    low_balance: float = Field(1.0, ge=0)
    stale_blocks_secs: int = Field(60, ge=10, le=600)

class DiscordConfigRequest(BaseModel):
    webhook_url: str = ""
    enabled: bool = False

class FailoverConfigRequest(BaseModel):
    host: str = Field("", max_length=255)
    port: int = Field(22, ge=1, le=65535)
    username: str = Field("root", max_length=64)
    ssh_key_path: str = Field("", max_length=500)
    remote_hyved_path: str = Field("", max_length=500)
    remote_hyved_home: str = Field("", max_length=500)
    remote_rpc_port: int = Field(26657, ge=1, le=65535)
    auto_failover: bool = False
    health_check_interval: int = Field(30, ge=10, le=300)
    max_failures: int = Field(3, ge=1, le=20)
    enabled: bool = False


# ── Core Helpers ─────────────────────────────────────────────────────────────
def to_display(amount_str: str) -> float:
    try:
        return int(float(amount_str)) / (10 ** DENOM_EXPONENT)
    except (ValueError, TypeError):
        return 0.0

def to_raw(display_amount: str) -> str:
    return str(int(float(display_amount) * (10 ** DENOM_EXPONENT)))

async def rest_call(path: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{REST_URL}{path}")
            r.raise_for_status()
            return r.json()
    except Exception:
        return None

async def rpc_call(endpoint: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{RPC_URL}/{endpoint}")
            r.raise_for_status()
            return r.json()
    except Exception:
        return None

async def evm_call(to: str, data: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(EVM_RPC_URL, json={
                "jsonrpc": "2.0", "method": "eth_call",
                "params": [{"to": to, "data": data}, "latest"], "id": 1,
            })
            result = r.json()
            return result.get("result") if "error" not in result else None
    except Exception:
        return None

def decode_uint256(hex_result: str | None) -> int:
    if not hex_result:
        return 0
    try:
        return int(hex_result, 16)
    except (ValueError, TypeError):
        return 0

def pad_address(addr: str) -> str:
    return addr.lower().replace("0x", "").zfill(64)


# ── Bech32 ───────────────────────────────────────────────────────────────────
BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

def _convertbits(data, frombits, tobits, pad=True):
    acc, bits, ret = 0, 0, []
    maxv = (1 << tobits) - 1
    for value in data:
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    return ret

def hex_to_bech32(hrp: str, hex_str: str) -> str:
    data = list(bytes.fromhex(hex_str))
    conv = _convertbits(data, 8, 5)
    hrp_exp = [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]
    polymod = 1
    for v in hrp_exp + conv + [0, 0, 0, 0, 0, 0]:
        b = polymod >> 25
        polymod = ((polymod & 0x1ffffff) << 5) ^ v
        for i, g in enumerate([0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]):
            if (b >> i) & 1:
                polymod ^= g
    polymod ^= 1
    checksum = [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]
    return hrp + "1" + "".join(BECH32_CHARSET[d] for d in conv + checksum)


# ── Auth System ──────────────────────────────────────────────────────────────
def _hash_pw(pw: str, salt: bytes = None) -> tuple[str, str]:
    if salt is None:
        salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200000)
    return salt.hex(), dk.hex()

def _verify_pw(pw: str, salt_hex: str, hash_hex: str) -> bool:
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt_hex), 200000)
    return hmac.compare_digest(dk.hex(), hash_hex)

def _init_auth():
    global _auth_config, SECRET_KEY
    key_file = DASHBOARD_DIR / ".secret_key"
    if key_file.exists():
        SECRET_KEY = key_file.read_text().strip()
    else:
        SECRET_KEY = secrets.token_hex(32)
        key_file.write_text(SECRET_KEY)
        key_file.chmod(0o600)
    if AUTH_FILE.exists():
        _auth_config = json.loads(AUTH_FILE.read_text())
    else:
        pw = secrets.token_urlsafe(16)
        salt, hsh = _hash_pw(pw)
        _auth_config = {"username": "admin", "salt": salt, "hash": hsh}
        AUTH_FILE.write_text(json.dumps(_auth_config))
        AUTH_FILE.chmod(0o600)
        print(f"\n{'='*60}")
        print(f"  DASHBOARD LOGIN CREDENTIALS")
        print(f"  Username: admin")
        print(f"  Password: {pw}")
        print(f"  (change after first login)")
        print(f"{'='*60}\n")

def _create_session(username: str) -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = {"user": username, "expires": time.time() + 86400 * 7}
    now = time.time()
    for k in list(_sessions):
        if _sessions[k]["expires"] < now:
            del _sessions[k]
    return token

def _check_rate_limit(ip: str) -> bool:
    now = time.time()
    if ip in _login_attempts:
        count, last = _login_attempts[ip]
        if now - last > 300:
            _login_attempts[ip] = [0, now]
            return True
        if count >= 5:
            return False
    return True

def _record_login_attempt(ip: str, success: bool):
    now = time.time()
    if success:
        _login_attempts.pop(ip, None)
    else:
        if ip in _login_attempts:
            _login_attempts[ip][0] += 1
            _login_attempts[ip][1] = now
        else:
            _login_attempts[ip] = [1, now]


# ── System Stats ─────────────────────────────────────────────────────────────
def get_system_stats() -> dict:
    cpu_pct = psutil.cpu_percent(percpu=True)
    cpu_freq = psutil.cpu_freq()
    load = os.getloadavg()
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    disk = psutil.disk_usage(str(HYVED_HOME))
    net = psutil.net_io_counters()
    temps = {}
    try:
        for name, entries in psutil.sensors_temperatures().items():
            temps[name] = [{"label": e.label or name, "current": e.current, "high": e.high, "critical": e.critical} for e in entries]
    except Exception:
        pass
    return {
        "cpu": {
            "per_core": cpu_pct, "avg": round(sum(cpu_pct) / len(cpu_pct), 1) if cpu_pct else 0,
            "cores": psutil.cpu_count(logical=False), "threads": psutil.cpu_count(logical=True),
            "freq_mhz": round(cpu_freq.current) if cpu_freq else 0,
            "load_1m": round(load[0], 2), "load_5m": round(load[1], 2), "load_15m": round(load[2], 2),
        },
        "memory": {
            "total_gb": round(mem.total / (1024**3), 1), "used_gb": round(mem.used / (1024**3), 1),
            "avail_gb": round(mem.available / (1024**3), 1), "pct": mem.percent,
            "swap_total_gb": round(swap.total / (1024**3), 1), "swap_used_gb": round(swap.used / (1024**3), 1),
            "swap_pct": swap.percent,
        },
        "disk": {
            "total_gb": round(disk.total / (1024**3), 1), "used_gb": round(disk.used / (1024**3), 1),
            "free_gb": round(disk.free / (1024**3), 1), "pct": disk.percent,
        },
        "network": {
            "bytes_sent": net.bytes_sent, "bytes_recv": net.bytes_recv,
            "pkts_sent": net.packets_sent, "pkts_recv": net.packets_recv,
        },
        "temperatures": temps,
        "uptime_secs": int(time.time() - psutil.boot_time()),
        "platform": {"hostname": os.uname().nodename, "kernel": os.uname().release, "arch": os.uname().machine},
    }

def get_disk_info() -> dict:
    try:
        usage = psutil.disk_usage(str(HYVED_HOME))
        return {"total_gb": round(usage.total / (1024**3), 1), "used_gb": round(usage.used / (1024**3), 1),
                "free_gb": round(usage.free / (1024**3), 1), "pct": usage.percent}
    except Exception:
        return {}


# ── Process & Log Helpers ────────────────────────────────────────────────────
def find_hyved_process() -> psutil.Process | None:
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            cmdline = proc.info.get("cmdline") or []
            if any("hyved" in arg for arg in cmdline) and "start" in cmdline:
                return proc
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return None

def get_process_stats(proc: psutil.Process | None) -> dict:
    if not proc:
        return {"cpu_percent": 0, "memory_mb": 0, "uptime_seconds": 0}
    try:
        with proc.oneshot():
            mem = proc.memory_info()
            cpu = proc.cpu_percent(interval=0)
            return {"cpu_percent": round(cpu, 1), "memory_mb": round(mem.rss / (1024 * 1024), 1),
                    "uptime_seconds": int(time.time() - proc.create_time())}
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return {"cpu_percent": 0, "memory_mb": 0, "uptime_seconds": 0}

_SENSITIVE_RE = re.compile(r'(key|password|secret|token|private|mnemonic)\s*[=:]\s*\S+', re.I)

def read_log_tail(n: int = 80) -> list[str]:
    if not LOG_FILE.exists():
        return []
    try:
        result = subprocess.run(["tail", f"-n{n}", str(LOG_FILE)], capture_output=True, text=True, timeout=3)
        return [_SENSITIVE_RE.sub(r'\1=***', line) for line in result.stdout.splitlines()]
    except Exception:
        return []

def load_operator_info() -> dict:
    if VALIDATOR_OPERATOR_FILE.exists():
        try:
            return json.loads(VALIDATOR_OPERATOR_FILE.read_text())
        except Exception:
            pass
    return {}

def load_history() -> list[dict]:
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text())
        except Exception:
            pass
    return []

def save_history(history: list[dict]):
    history = history[-2880:]
    HISTORY_FILE.write_text(json.dumps(history))

def _load_env_file():
    """Load .env from dashboard dir."""
    env_file = DASHBOARD_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip()
            if k and v:
                os.environ.setdefault(k, v)


def _init_validator_key():
    """Load private key from env and import into hyved test keyring if needed."""
    global VALIDATOR_PRIVATE_KEY, _eth_account
    _load_env_file()
    pk = os.environ.get("VALIDATOR_PRIVATE_KEY", "").strip()
    if not pk:
        print("[dashboard] WARNING: VALIDATOR_PRIVATE_KEY not set. TX signing disabled.")
        print("[dashboard] Set it in .env file: VALIDATOR_PRIVATE_KEY=<hex-private-key>")
        return
    # Normalise: remove 0x prefix if present
    pk = pk.removeprefix("0x").removeprefix("0X")
    VALIDATOR_PRIVATE_KEY = pk
    # Init eth_account for EVM signing
    if EthAccount:
        try:
            _eth_account = EthAccount.from_key(bytes.fromhex(pk))
            print(f"[dashboard] Loaded EVM key: {_eth_account.address}")
        except Exception as e:
            print(f"[dashboard] ERROR loading EVM key: {e}")
    # Import into hyved test keyring if not already there
    _import_key_to_keyring(pk)


def _import_key_to_keyring(pk_hex: str):
    """Import the private key into hyved test keyring for Cosmos TX signing."""
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = f"{HYVE_NODE_DIR / 'bin'}:{env.get('LD_LIBRARY_PATH', '')}"
    # Check if key already exists
    try:
        result = subprocess.run(
            [str(HYVED_BIN), "keys", "list", "--home", str(HYVED_HOME),
             "--keyring-backend", "test", "--output", "json"],
            capture_output=True, text=True, timeout=10, env=env
        )
        keys = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("["):
                try:
                    keys = json.loads(line)
                except Exception:
                    pass
        if any(k.get("name") == "validator-operator" for k in keys):
            print("[dashboard] Key 'validator-operator' already in test keyring")
            return
    except Exception:
        pass
    # Import
    try:
        result = subprocess.run(
            [str(HYVED_BIN), "keys", "unsafe-import-eth-key", "validator-operator", pk_hex,
             "--home", str(HYVED_HOME), "--keyring-backend", "test"],
            capture_output=True, text=True, timeout=10, env=env
        )
        output = (result.stdout + result.stderr).strip()
        # Filter noisy warnings
        output = re.sub(r"service cosmos\.evm\.precisebank\.v1\.Msg[^\n]*\n?", "", output).strip()
        if result.returncode == 0:
            print(f"[dashboard] Imported key into test keyring")
        else:
            print(f"[dashboard] Key import note: {output}")
    except Exception as e:
        print(f"[dashboard] Key import error: {e}")


def run_hyved_tx(args: list[str], password: str = "") -> dict:
    if not VALIDATOR_PRIVATE_KEY:
        return {"ok": False, "error": "VALIDATOR_PRIVATE_KEY not configured. Set it in the .env file."}
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = f"{HYVE_NODE_DIR / 'bin'}:{env.get('LD_LIBRARY_PATH', '')}"
    cmd = [str(HYVED_BIN), *args, "--home", str(HYVED_HOME), "--chain-id", CHAIN_ID,
           "--keyring-backend", "test", "--gas", "auto", "--gas-adjustment", "1.5",
           "--gas-prices", "10000000000ahyve", "--yes", "--output", "json"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env)
        output = result.stdout + result.stderr
        for line in output.splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    return {"ok": True, "result": json.loads(line)}
                except json.JSONDecodeError:
                    pass
        if result.returncode != 0:
            err = re.sub(r"service cosmos\.evm\.precisebank\.v1\.Msg[^\n]*\n?", "", output).strip()
            return {"ok": False, "error": err or "Transaction failed"}
        return {"ok": True, "result": {"raw_output": output.strip()}}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Transaction timed out"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Database Helpers ─────────────────────────────────────────────────────────
async def _db_ensure_tables():
    if not db_pool:
        return
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS metrics_history (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            height BIGINT, peers INT, rewards DOUBLE PRECISION, commission DOUBLE PRECISION,
            delegated DOUBLE PRECISION, available DOUBLE PRECISION, memory_mb DOUBLE PRECISION,
            cpu_pct DOUBLE PRECISION, uptime_pct DOUBLE PRECISION, shade_balance DOUBLE PRECISION,
            shade_pending DOUBLE PRECISION, disk_pct DOUBLE PRECISION, load_avg DOUBLE PRECISION
        )""")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS rpc_metrics (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            method TEXT NOT NULL, path TEXT NOT NULL, status_code INT,
            duration_ms DOUBLE PRECISION, client_ip TEXT
        )""")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS rewards_log (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            event TEXT NOT NULL, amount DOUBLE PRECISION,
            tx_hash TEXT, details JSONB
        )""")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            title TEXT NOT NULL, content TEXT DEFAULT '',
            category TEXT DEFAULT 'general', pinned BOOLEAN DEFAULT FALSE
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics_history(ts DESC)")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_rpc_ts ON rpc_metrics(ts DESC)")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_rewards_ts ON rewards_log(ts DESC)")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_notes_ts ON notes(ts DESC)")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS dashboard_config (
            key TEXT PRIMARY KEY, value JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS rank_history (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            rank INT NOT NULL, voting_power DOUBLE PRECISION, total_validators INT,
            delegator_count INT
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_rank_ts ON rank_history(ts DESC)")
    # ── New tracking tables ──
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS delegation_events (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            event TEXT NOT NULL, delegator TEXT, amount DOUBLE PRECISION,
            validator TEXT, tx_hash TEXT
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_deleg_ts ON delegation_events(ts DESC)")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS network_snapshots (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            total_supply DOUBLE PRECISION, bonded_tokens DOUBLE PRECISION,
            bonded_ratio DOUBLE PRECISION, inflation DOUBLE PRECISION,
            active_validators INT, avg_block_time DOUBLE PRECISION,
            avg_commission DOUBLE PRECISION
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_netsn_ts ON network_snapshots(ts DESC)")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS validator_set_changes (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            event TEXT NOT NULL, moniker TEXT, valoper TEXT,
            tokens DOUBLE PRECISION, rank INT
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_valset_ts ON validator_set_changes(ts DESC)")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS alert_history (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            alert_type TEXT NOT NULL, severity TEXT NOT NULL,
            message TEXT, value DOUBLE PRECISION,
            notified BOOLEAN DEFAULT FALSE
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_alerthist_ts ON alert_history(ts DESC)")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS node_restarts (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            pid INT, prev_pid INT, uptime_before TEXT,
            reason TEXT DEFAULT 'detected'
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_noderestart_ts ON node_restarts(ts DESC)")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS peer_history (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            peer_count INT, peer_ids TEXT[]
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_peerhist_ts ON peer_history(ts DESC)")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS block_time_history (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            avg_block_time DOUBLE PRECISION, height_start BIGINT, height_end BIGINT
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_blocktime_ts ON block_time_history(ts DESC)")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS governance_votes (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            proposal_id INT NOT NULL, proposal_title TEXT,
            vote_option TEXT, tx_hash TEXT
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_govvote_ts ON governance_votes(ts DESC)")
    await db_pool.execute("""
        CREATE TABLE IF NOT EXISTS failover_events (
            id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            event_type TEXT NOT NULL, source_node TEXT, target_node TEXT,
            details TEXT, success BOOLEAN DEFAULT TRUE
        )""")
    await db_pool.execute("CREATE INDEX IF NOT EXISTS idx_failover_ts ON failover_events(ts DESC)")

async def _db_save_config(key: str, value: dict):
    if not db_pool:
        return
    try:
        await db_pool.execute(
            "INSERT INTO dashboard_config (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
            key, json.dumps(value),
        )
    except Exception:
        pass

async def _db_load_config(key: str) -> dict | None:
    if not db_pool:
        return None
    try:
        row = await db_pool.fetchval("SELECT value FROM dashboard_config WHERE key = $1", key)
        if row:
            return json.loads(row) if isinstance(row, str) else dict(row)
    except Exception:
        pass
    return None

async def _db_load_all_configs():
    global _discord_config, _alert_config, _auto_compound_config, _failover_config
    dc = await _db_load_config("discord")
    if dc:
        _discord_config = dc
    ac = await _db_load_config("alert_config")
    if ac:
        _alert_config = ac
    cc = await _db_load_config("auto_compound")
    if cc:
        _auto_compound_config = cc
    fc = await _db_load_config("failover")
    if fc:
        _failover_config.update(fc)


async def _db_record_metrics(data: dict):
    if not db_pool:
        return
    try:
        await db_pool.execute(
            "INSERT INTO metrics_history (height,peers,rewards,commission,delegated,available,memory_mb,cpu_pct,uptime_pct,shade_balance,shade_pending,disk_pct,load_avg) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
            data.get("height", 0), data.get("peers", 0), data.get("rewards", 0), data.get("commission", 0),
            data.get("delegated", 0), data.get("available", 0), data.get("memory_mb", 0), data.get("cpu_pct", 0),
            data.get("uptime_pct", 0), data.get("shade_balance", 0), data.get("shade_pending", 0),
            data.get("disk_pct", 0), data.get("load_avg", 0),
        )
    except Exception:
        pass

async def _db_record_rpc(method: str, path: str, status: int, duration: float, ip: str):
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "method": method, "path": path,
             "status": status, "duration_ms": round(duration, 2), "ip": ip}
    _rpc_buffer.append(entry)
    if db_pool:
        try:
            await db_pool.execute(
                "INSERT INTO rpc_metrics (method,path,status_code,duration_ms,client_ip) VALUES ($1,$2,$3,$4,$5)",
                method, path, status, duration, ip,
            )
        except Exception:
            pass


# ── Middleware ───────────────────────────────────────────────────────────────
PUBLIC_PATHS = frozenset({"/login", "/api/auth/login", "/api/auth/check", "/favicon.ico"})

@app.middleware("http")
async def main_middleware(request: Request, call_next):
    path = request.url.path
    start = time.monotonic()
    if path not in PUBLIC_PATHS:
        token = request.cookies.get("session")
        if not token:
            auth_h = request.headers.get("authorization", "")
            if auth_h.startswith("Bearer "):
                token = auth_h[7:]
        authed = False
        if token and token in _sessions:
            if _sessions[token]["expires"] > time.time():
                authed = True
            else:
                del _sessions[token]
        if not authed:
            if path.startswith("/api/") or path.startswith("/ws/"):
                return JSONResponse({"error": "unauthorized"}, status_code=401)
            return RedirectResponse("/login", status_code=302)
    response = await call_next(request)
    if path.startswith("/api/") and path not in PUBLIC_PATHS:
        duration = (time.monotonic() - start) * 1000
        asyncio.create_task(_db_record_rpc(
            request.method, path, response.status_code, duration,
            request.client.host if request.client else ""
        ))
    return response


# ── Auth Endpoints ───────────────────────────────────────────────────────────
@app.post("/api/auth/login")
async def login(req: LoginRequest, request: Request):
    ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(ip):
        return JSONResponse({"error": "Too many attempts. Try again in 5 minutes."}, status_code=429)
    if not _auth_config:
        return JSONResponse({"error": "Auth not configured"}, status_code=500)
    if req.username != _auth_config["username"] or not _verify_pw(req.password, _auth_config["salt"], _auth_config["hash"]):
        _record_login_attempt(ip, False)
        return JSONResponse({"error": "Invalid credentials"}, status_code=401)
    _record_login_attempt(ip, True)
    token = _create_session(req.username)
    resp = JSONResponse({"ok": True, "username": req.username, "token": token})
    resp.set_cookie("session", token, max_age=86400 * 7, httponly=True, samesite="lax")
    return resp

@app.get("/api/auth/check")
async def auth_check(request: Request):
    token = request.cookies.get("session")
    if not token:
        auth_h = request.headers.get("authorization", "")
        if auth_h.startswith("Bearer "):
            token = auth_h[7:]
    if token and token in _sessions and _sessions[token]["expires"] > time.time():
        return {"authenticated": True, "username": _sessions[token]["user"]}
    return JSONResponse({"authenticated": False}, status_code=401)

@app.post("/api/auth/logout")
async def logout(request: Request):
    token = request.cookies.get("session")
    if not token:
        auth_h = request.headers.get("authorization", "")
        if auth_h.startswith("Bearer "):
            token = auth_h[7:]
    if token and token in _sessions:
        del _sessions[token]
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("session")
    return resp

@app.post("/api/auth/change-password")
async def change_password(req: ChangePasswordRequest):
    global _auth_config
    if not _auth_config or not _verify_pw(req.current_password, _auth_config["salt"], _auth_config["hash"]):
        return JSONResponse({"error": "Current password is incorrect"}, status_code=401)
    salt, hsh = _hash_pw(req.new_password)
    _auth_config["salt"] = salt
    _auth_config["hash"] = hsh
    AUTH_FILE.write_text(json.dumps(_auth_config))
    AUTH_FILE.chmod(0o600)
    return {"ok": True}


# ── API: Status ──────────────────────────────────────────────────────────────
@app.get("/api/status")
async def get_status():
    proc = find_hyved_process()
    running = proc is not None
    process_stats = get_process_stats(proc) if running else {}
    status_data = await rpc_call("status") if running else None
    net_info = await rpc_call("net_info") if running else None
    validators = await rpc_call("validators") if running else None
    result = {"running": running, "process": process_stats, "operator": load_operator_info(), "disk": get_disk_info()}
    if status_data and "result" in status_data:
        s = status_data["result"]
        si, vi, ni = s.get("sync_info", {}), s.get("validator_info", {}), s.get("node_info", {})
        result["node"] = {"moniker": ni.get("moniker", ""), "network": ni.get("network", ""), "version": ni.get("version", "")}
        result["sync"] = {
            "latest_block_height": int(si.get("latest_block_height", 0)),
            "latest_block_time": si.get("latest_block_time", ""),
            "latest_block_hash": si.get("latest_block_hash", ""),
            "earliest_block_height": int(si.get("earliest_block_height", 0)),
            "catching_up": si.get("catching_up", False),
        }
        result["validator"] = {"address": vi.get("address", ""), "voting_power": vi.get("voting_power", "0")}
    if net_info and "result" in net_info:
        n = net_info["result"]
        peers = []
        for p in n.get("peers", []):
            pi, cs = p.get("node_info", {}), p.get("connection_status", {})
            peers.append({
                "moniker": pi.get("moniker", ""), "id": pi.get("id", "")[:12],
                "addr": pi.get("listen_addr", ""), "is_outbound": p.get("is_outbound", False),
                "send_rate": cs.get("SendMonitor", {}).get("AvgRate", 0),
                "recv_rate": cs.get("RecvMonitor", {}).get("AvgRate", 0),
            })
        result["peers"] = {"count": int(n.get("n_peers", 0)), "list": peers}
    if validators and "result" in validators:
        v = validators["result"]
        val_list = [{"address": val.get("address", ""), "voting_power": val.get("voting_power", "0"),
                     "proposer_priority": val.get("proposer_priority", "0")} for val in v.get("validators", [])]
        result["validator_set"] = {
            "block_height": v.get("block_height", "0"), "validators": val_list,
            "total_voting_power": sum(int(x.get("voting_power", 0)) for x in v.get("validators", [])),
        }
    return result


# ── API: Staking ─────────────────────────────────────────────────────────────
@app.get("/api/staking")
async def get_staking():
    op = load_operator_info()
    cosmos_addr = op.get("cosmosAddr", "")
    valoper_addr = op.get("valoperAddr", "")
    if not cosmos_addr:
        return {"error": "No operator info found"}
    balance_data, delegation_data, rewards_data, commission_data, validator_data, all_validators_data, staking_params, supply_data = await asyncio.gather(
        rest_call(f"/cosmos/bank/v1beta1/balances/{cosmos_addr}"),
        rest_call(f"/cosmos/staking/v1beta1/delegations/{cosmos_addr}"),
        rest_call(f"/cosmos/distribution/v1beta1/delegators/{cosmos_addr}/rewards"),
        rest_call(f"/cosmos/distribution/v1beta1/validators/{valoper_addr}/commission") if valoper_addr else asyncio.sleep(0),
        rest_call(f"/cosmos/staking/v1beta1/validators/{valoper_addr}") if valoper_addr else asyncio.sleep(0),
        rest_call("/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=100"),
        rest_call("/cosmos/staking/v1beta1/params"),
        rest_call("/cosmos/bank/v1beta1/supply"),
    )
    result = {}
    if balance_data:
        for b in balance_data.get("balances", []):
            if b["denom"] == DENOM:
                result["available"] = to_display(b["amount"])
                result["available_raw"] = b["amount"]
    if delegation_data:
        total = 0
        delegations = []
        for d in delegation_data.get("delegation_responses", []):
            amt = int(d["balance"]["amount"])
            total += amt
            delegations.append({"validator": d["delegation"]["validator_address"], "amount": to_display(str(amt))})
        result["delegated"] = to_display(str(total))
        result["delegated_raw"] = str(total)
        result["delegations"] = delegations
    if rewards_data:
        total_rewards = 0
        for r in rewards_data.get("rewards", []):
            for coin in r.get("reward", []):
                if coin["denom"] == DENOM:
                    total_rewards += float(coin["amount"])
        result["pending_rewards"] = to_display(str(total_rewards))
        result["pending_rewards_raw"] = str(int(total_rewards))
    if commission_data and isinstance(commission_data, dict):
        for coin in commission_data.get("commission", {}).get("commission", []):
            if coin["denom"] == DENOM:
                result["pending_commission"] = to_display(coin["amount"])
                result["pending_commission_raw"] = str(int(float(coin["amount"])))
    if validator_data and isinstance(validator_data, dict):
        v = validator_data.get("validator", {})
        result["our_validator"] = {
            "moniker": v.get("description", {}).get("moniker", ""),
            "tokens": to_display(v.get("tokens", "0")),
            "status": v.get("status", ""),
            "jailed": v.get("jailed", False),
            "commission_rate": float(v.get("commission", {}).get("commission_rates", {}).get("rate", "0")) * 100,
            "max_commission": float(v.get("commission", {}).get("commission_rates", {}).get("max_rate", "0")) * 100,
        }
    if all_validators_data and isinstance(all_validators_data, dict):
        vals = []
        for v in all_validators_data.get("validators", []):
            vals.append({
                "operator_address": v.get("operator_address", ""),
                "moniker": v.get("description", {}).get("moniker", ""),
                "tokens": to_display(v.get("tokens", "0")),
                "commission_rate": float(v.get("commission", {}).get("commission_rates", {}).get("rate", "0")) * 100,
                "jailed": v.get("jailed", False),
            })
        vals.sort(key=lambda x: x["tokens"], reverse=True)
        result["all_validators"] = vals
        result["total_bonded"] = sum(v["tokens"] for v in vals)
    if staking_params and isinstance(staking_params, dict):
        p = staking_params.get("params", {})
        result["staking_params"] = {
            "unbonding_time_days": int(p.get("unbonding_time", "0s").rstrip("s")) / 86400,
            "max_validators": p.get("max_validators", 0),
        }
    if supply_data and isinstance(supply_data, dict):
        for s in supply_data.get("supply", []):
            if s["denom"] == DENOM:
                result["total_supply"] = to_display(s["amount"])
    result["total_assets"] = round(
        result.get("available", 0) + result.get("delegated", 0) +
        result.get("pending_rewards", 0) + result.get("pending_commission", 0), 6
    )
    return result


# ── API: History & Logs ──────────────────────────────────────────────────────
@app.get("/api/history")
async def get_history():
    if db_pool:
        try:
            rows = await db_pool.fetch(
                "SELECT ts, height, peers, rewards, commission, delegated, available, "
                "memory_mb, cpu_pct, uptime_pct, shade_balance, shade_pending, disk_pct, load_avg "
                "FROM metrics_history ORDER BY ts DESC LIMIT 2880"
            )
            return {"history": [dict(r) for r in reversed(rows)]}
        except Exception:
            pass
    return {"history": load_history()}

@app.get("/api/logs")
async def get_logs():
    return {"lines": read_log_tail(300)}


# ── API: Signing Status ─────────────────────────────────────────────────────
@app.get("/api/signing")
async def get_signing():
    status_data = await rpc_call("status")
    if not status_data or "result" not in status_data:
        return {}
    hex_addr = status_data["result"].get("validator_info", {}).get("address", "")
    if not hex_addr:
        return {}
    current_height = int(status_data["result"].get("sync_info", {}).get("latest_block_height", 0))
    cons_addr = hex_to_bech32("hyvevalcons", hex_addr)
    signing_data, slashing_params = await asyncio.gather(
        rest_call(f"/cosmos/slashing/v1beta1/signing_infos/{cons_addr}"),
        rest_call("/cosmos/slashing/v1beta1/params"),
    )
    if not signing_data:
        return {}
    info = signing_data.get("val_signing_info", {})
    params = slashing_params.get("params", {}) if slashing_params else {}
    window = int(params.get("signed_blocks_window", 100000))
    missed = int(info.get("missed_blocks_counter", 0))
    signed = window - missed
    start_height = int(info.get("start_height", 0))
    blocks_since_start = max(current_height - start_height, 0)
    window_progress = min(blocks_since_start / window, 1.0) if window > 0 else 1.0
    blocks_until_clean = max(missed - max(blocks_since_start - window, 0), 0) if missed > 0 else 0
    uptime = (signed / window * 100) if window > 0 else 0
    return {
        "consensus_address": cons_addr, "start_height": start_height,
        "current_height": current_height, "blocks_since_start": blocks_since_start,
        "window_progress": round(window_progress * 100, 2),
        "blocks_until_clean": blocks_until_clean,
        "jailed_until": info.get("jailed_until", ""), "tombstoned": info.get("tombstoned", False),
        "missed_blocks": missed, "signed_blocks": signed, "window": window,
        "uptime_pct": round(uptime, 4),
        "min_signed_pct": float(params.get("min_signed_per_window", 0)) * 100,
        "slash_downtime_pct": float(params.get("slash_fraction_downtime", 0)) * 100,
        "slash_double_sign_pct": float(params.get("slash_fraction_double_sign", 0)) * 100,
        "jail_duration": params.get("downtime_jail_duration", ""),
    }


# ── API: Shade Token ────────────────────────────────────────────────────────
@app.get("/api/shade")
async def get_shade():
    op = load_operator_info()
    evm_addr = op.get("evmAddr", "")
    if not evm_addr:
        return {}
    padded = pad_address(evm_addr)
    results = await asyncio.gather(
        evm_call(SHADE_TOKEN, f"0x70a08231{padded}"),
        evm_call(SHADE_EMISSION, f"0x0a7e9c63{padded}"),
        evm_call(SHADE_EMISSION, f"0xef5d9ae8{padded}"),
        evm_call(SHADE_EMISSION, f"0xad449996{padded}"),
        evm_call(SHADE_EMISSION, f"0x0b5a006b{padded}"),
        evm_call(SHADE_EMISSION, "0x3f90916a"),
        evm_call(SHADE_EMISSION, "0x82ee21fc"),
        evm_call(SHADE_EMISSION, "0x06a4c983"),
        evm_call(SHADE_EMISSION, "0xac4746ab"),
        evm_call(SHADE_EMISSION, "0x829965cc"),
        evm_call(SHADE_TOKEN, "0x18160ddd"),
    )
    d = 10 ** SHADE_DECIMALS
    balance, pending_raw, claimed, alloc = decode_uint256(results[0]), decode_uint256(results[1]), decode_uint256(results[2]), decode_uint256(results[3])
    # Check if claim is actually possible right now via gas estimation
    claimable_now = False
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            gas_r = await client.post(EVM_RPC_URL, json={
                "jsonrpc": "2.0", "method": "eth_estimateGas",
                "params": [{"from": evm_addr, "to": SHADE_EMISSION, "data": "0x4e71d92d"}], "id": 1,
            })
            gas_result = gas_r.json()
            claimable_now = "error" not in gas_result
    except Exception:
        pass
    pending = pending_raw if claimable_now else 0
    return {
        "balance": balance / d, "pending_reward": pending / d, "total_claimed": claimed / d,
        "allocation": alloc / d, "remaining": max(0, (alloc - claimed)) / d,
        "claim_pct": round(claimed / alloc * 100, 2) if alloc > 0 else 0,
        "claimable": claimable_now, "next_reward": pending_raw / d,
        "is_active": decode_uint256(results[4]) == 1,
        "total_distributed": decode_uint256(results[5]) / d,
        "emission_per_period": decode_uint256(results[6]) / d,
        "period_finish": decode_uint256(results[7]),
        "claim_interval_hrs": decode_uint256(results[8]) / 3600,
        "current_epoch": decode_uint256(results[9]),
        "total_supply": decode_uint256(results[10]) / d,
        "token_address": SHADE_TOKEN, "emission_address": SHADE_EMISSION,
    }


# ── API: Chain Info ──────────────────────────────────────────────────────────
@app.get("/api/chain")
async def get_chain_info():
    results = await asyncio.gather(
        rest_call("/cosmos/staking/v1beta1/params"),
        rest_call("/cosmos/slashing/v1beta1/params"),
        rest_call("/cosmos/distribution/v1beta1/params"),
        rest_call("/cosmos/bank/v1beta1/supply"),
        rest_call("/cosmos/distribution/v1beta1/community_pool"),
        rest_call("/cosmos/mint/v1beta1/params"),
    )
    staking_p, slashing_p, dist_p, supply_d, pool_d, mint_p = results
    out = {}
    if staking_p:
        p = staking_p.get("params", {})
        out["staking"] = {
            "unbonding_days": int(p.get("unbonding_time", "0s").rstrip("s")) / 86400,
            "max_validators": p.get("max_validators", 0),
            "max_entries": p.get("max_entries", 0),
            "bond_denom": p.get("bond_denom", ""),
        }
    if slashing_p:
        p = slashing_p.get("params", {})
        out["slashing"] = {
            "window": int(p.get("signed_blocks_window", 0)),
            "min_signed_pct": float(p.get("min_signed_per_window", 0)) * 100,
            "jail_duration": p.get("downtime_jail_duration", ""),
            "slash_downtime": float(p.get("slash_fraction_downtime", 0)) * 100,
            "slash_double_sign": float(p.get("slash_fraction_double_sign", 0)) * 100,
        }
    if dist_p:
        out["distribution"] = {"community_tax": float(dist_p.get("params", {}).get("community_tax", 0)) * 100}
    if supply_d:
        out["supply"] = [{"denom": s["denom"], "amount": s["amount"]} for s in supply_d.get("supply", [])]
    if pool_d:
        for c in pool_d.get("pool", []):
            if c["denom"] == DENOM:
                out["community_pool_hyve"] = to_display(c["amount"].split(".")[0])
    if mint_p:
        out["blocks_per_year"] = int(mint_p.get("params", {}).get("blocks_per_year", 0))
    return out


# ── API: Governance ──────────────────────────────────────────────────────────
@app.get("/api/governance")
async def get_governance():
    results = await asyncio.gather(
        rest_call("/cosmos/gov/v1/proposals?pagination.limit=20&pagination.reverse=true"),
        rest_call("/cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD&pagination.limit=20"),
    )
    all_props, voting_props = results
    op = load_operator_info()
    cosmos_addr = op.get("cosmosAddr", "")
    proposals = []
    raw_props = (all_props or {}).get("proposals", [])
    for p in raw_props:
        prop_id = p.get("id", "0")
        status = p.get("status", "")
        messages = p.get("messages", [])
        title = p.get("title", "")
        summary = p.get("summary", "")
        if not title and messages:
            content = messages[0].get("content", {})
            title = content.get("title", f"Proposal #{prop_id}")
            summary = content.get("description", "")[:200]
        my_vote = ""
        if cosmos_addr and status == "PROPOSAL_STATUS_VOTING_PERIOD":
            vote_data = await rest_call(f"/cosmos/gov/v1/proposals/{prop_id}/votes/{cosmos_addr}")
            if vote_data and "vote" in vote_data:
                options = vote_data["vote"].get("options", [])
                if options:
                    my_vote = options[0].get("option", "").replace("VOTE_OPTION_", "")
        tally = p.get("final_tally_result", {})
        proposals.append({
            "id": prop_id, "title": title, "summary": summary[:300],
            "status": status.replace("PROPOSAL_STATUS_", ""),
            "submit_time": p.get("submit_time", ""),
            "voting_end_time": p.get("voting_end_time", ""),
            "my_vote": my_vote,
            "tally": {
                "yes": to_display(tally.get("yes_count", "0")),
                "no": to_display(tally.get("no_count", "0")),
                "abstain": to_display(tally.get("abstain_count", "0")),
                "veto": to_display(tally.get("no_with_veto_count", "0")),
            },
        })
    return {"proposals": proposals}


class VoteRequest(BaseModel):
    proposal_id: str = Field(..., pattern=r"^\d+$")
    option: str = Field(..., pattern=r"^(yes|no|abstain|no_with_veto)$")


@app.post("/api/tx/vote")
async def cast_vote(req: VoteRequest):
    result = run_hyved_tx(["tx", "gov", "vote", req.proposal_id, req.option, "--from", "validator-operator"])
    if result.get("ok") and db_pool:
        try:
            await db_pool.execute(
                "INSERT INTO governance_votes (proposal_id, proposal_title, vote_option, tx_hash) VALUES ($1,$2,$3,$4)",
                req.proposal_id, "", req.option, result.get("result", {}).get("txhash", ""),
            )
        except Exception:
            pass
    return result


# ── API: Delegators ─────────────────────────────────────────────────────────
@app.get("/api/delegators")
async def get_delegators():
    op = load_operator_info()
    valoper = op.get("valoperAddr", "")
    if not valoper:
        return {"delegators": []}
    data = await rest_call(f"/cosmos/staking/v1beta1/validators/{valoper}/delegations?pagination.limit=200")
    if not data:
        return {"delegators": []}
    delegators = []
    for d in data.get("delegation_responses", []):
        addr = d.get("delegation", {}).get("delegator_address", "")
        amt = to_display(d.get("balance", {}).get("amount", "0"))
        delegators.append({"address": addr, "amount": amt})
    delegators.sort(key=lambda x: x["amount"], reverse=True)
    total = sum(d["amount"] for d in delegators)
    for d in delegators:
        d["share_pct"] = round(d["amount"] / total * 100, 2) if total > 0 else 0
    return {"delegators": delegators, "total": total, "count": len(delegators)}


# ── API: Network Overview ───────────────────────────────────────────────────
@app.get("/api/network")
async def get_network():
    results = await asyncio.gather(
        rest_call("/cosmos/staking/v1beta1/pool"),
        rest_call("/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=100"),
        rest_call("/cosmos/bank/v1beta1/supply"),
        rest_call("/cosmos/mint/v1beta1/inflation"),
        rest_call("/cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD&pagination.limit=20"),
    )
    pool_data, validators_data, supply_data, inflation_data, active_props = results
    out = {}
    if pool_data:
        pool = pool_data.get("pool", {})
        bonded = to_display(pool.get("bonded_tokens", "0"))
        not_bonded = to_display(pool.get("not_bonded_tokens", "0"))
        out["bonded_tokens"] = bonded
        out["not_bonded_tokens"] = not_bonded
        total_supply = bonded + not_bonded
        if supply_data:
            for s in supply_data.get("supply", []):
                if s["denom"] == DENOM:
                    total_supply = to_display(s["amount"])
        out["total_supply"] = total_supply
        out["bonded_ratio"] = round(bonded / total_supply * 100, 2) if total_supply > 0 else 0
    if validators_data:
        vals = validators_data.get("validators", [])
        out["active_validators"] = len(vals)
        commissions = [float(v.get("commission", {}).get("commission_rates", {}).get("rate", "0")) * 100 for v in vals]
        out["avg_commission"] = round(sum(commissions) / len(commissions), 2) if commissions else 0
        out["min_commission"] = round(min(commissions), 2) if commissions else 0
        out["max_commission"] = round(max(commissions), 2) if commissions else 0
    if inflation_data:
        inf = inflation_data.get("inflation", "0")
        out["inflation"] = round(float(inf) * 100, 4)
    if active_props:
        out["active_proposals"] = len(active_props.get("proposals", []))
    # Block time average from recent blocks
    try:
        status = await rpc_call("status")
        if status and "result" in status:
            latest_height = int(status["result"]["sync_info"]["latest_block_height"])
            block_1 = await rpc_call(f"block?height={latest_height}")
            block_2 = await rpc_call(f"block?height={max(1, latest_height - 50)}")
            if block_1 and block_2:
                t1 = datetime.fromisoformat(block_1["result"]["block"]["header"]["time"].replace("Z", "+00:00"))
                t2 = datetime.fromisoformat(block_2["result"]["block"]["header"]["time"].replace("Z", "+00:00"))
                diff = (t1 - t2).total_seconds()
                blocks = latest_height - max(1, latest_height - 50)
                out["avg_block_time"] = round(diff / blocks, 2) if blocks > 0 else 0
    except Exception:
        pass
    return out


# ── API: Transaction History ────────────────────────────────────────────────
@app.get("/api/tx-history")
async def get_tx_history():
    op = load_operator_info()
    cosmos_addr = op.get("cosmosAddr", "")
    if not cosmos_addr:
        return {"transactions": []}
    results = await asyncio.gather(
        rest_call(f"/cosmos/tx/v1beta1/txs?events=message.sender%3D%27{cosmos_addr}%27&order_by=ORDER_BY_DESC&pagination.limit=30"),
        rest_call(f"/cosmos/tx/v1beta1/txs?events=transfer.recipient%3D%27{cosmos_addr}%27&order_by=ORDER_BY_DESC&pagination.limit=20"),
    )
    sent_data, recv_data = results
    txs = {}
    for source in [sent_data, recv_data]:
        if not source:
            continue
        for tx in source.get("tx_responses", []):
            txhash = tx.get("txhash", "")
            if txhash in txs:
                continue
            msgs = tx.get("tx", {}).get("body", {}).get("messages", [])
            msg_types = []
            for m in msgs:
                t = m.get("@type", "").split(".")[-1]
                t = t.replace("Msg", "").replace("Exec", "")
                msg_types.append(t)
            txs[txhash] = {
                "hash": txhash,
                "height": int(tx.get("height", 0)),
                "timestamp": tx.get("timestamp", ""),
                "code": tx.get("code", 0),
                "gas_used": int(tx.get("gas_used", 0)),
                "gas_wanted": int(tx.get("gas_wanted", 0)),
                "types": msg_types,
                "memo": tx.get("tx", {}).get("body", {}).get("memo", ""),
            }
    tx_list = sorted(txs.values(), key=lambda x: x["height"], reverse=True)[:40]
    return {"transactions": tx_list}


# ── API: Rewards History ────────────────────────────────────────────────────
@app.get("/api/rewards-history")
async def get_rewards_history():
    if not db_pool:
        return {"data": [], "error": "PostgreSQL not available"}
    try:
        rows = await db_pool.fetch("""
            SELECT DATE_TRUNC('hour', ts) AS hour,
                   MAX(rewards) AS rewards, MAX(commission) AS commission,
                   MAX(delegated) AS delegated, MAX(shade_pending) AS shade_pending,
                   MAX(uptime_pct) AS uptime_pct
            FROM metrics_history
            WHERE ts > NOW() - INTERVAL '7 days'
            GROUP BY hour ORDER BY hour
        """)
        return {"data": [dict(r) for r in rows]}
    except Exception as e:
        return {"data": [], "error": str(e)}


# ── API: Performance Benchmarks ─────────────────────────────────────────────
@app.get("/api/benchmarks")
async def get_benchmarks():
    op = load_operator_info()
    valoper = op.get("valoperAddr", "")
    results = await asyncio.gather(
        rest_call("/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=100"),
        get_signing(),
    )
    vals_data, our_signing = results
    if not vals_data or not isinstance(vals_data, dict):
        return {}
    vals = vals_data.get("validators", [])
    commissions = [float(v.get("commission", {}).get("commission_rates", {}).get("rate", "0")) * 100 for v in vals]
    stakes = [to_display(v.get("tokens", "0")) for v in vals]
    our_val = None
    our_rank = 0
    for i, v in enumerate(sorted(vals, key=lambda x: int(x.get("tokens", "0")), reverse=True)):
        if v.get("operator_address") == valoper:
            our_val = v
            our_rank = i + 1
            break
    out = {
        "network": {
            "avg_commission": round(sum(commissions) / len(commissions), 2) if commissions else 0,
            "median_commission": round(sorted(commissions)[len(commissions) // 2], 2) if commissions else 0,
            "avg_stake": round(sum(stakes) / len(stakes), 2) if stakes else 0,
            "median_stake": round(sorted(stakes)[len(stakes) // 2], 2) if stakes else 0,
            "total_validators": len(vals),
        }
    }
    if our_val:
        out["ours"] = {
            "rank": our_rank,
            "commission": float(our_val.get("commission", {}).get("commission_rates", {}).get("rate", "0")) * 100,
            "stake": to_display(our_val.get("tokens", "0")),
            "uptime": our_signing.get("uptime_pct", 0) if isinstance(our_signing, dict) else 0,
            "missed_blocks": our_signing.get("missed_blocks", 0) if isinstance(our_signing, dict) else 0,
        }
    return out


# ── API: Alerts ─────────────────────────────────────────────────────────────
_alert_state = {"last_height": 0, "last_check": 0, "alerts": []}


@app.get("/api/alerts")
async def get_alerts():
    """Check for alert conditions and return active alerts."""
    alerts = []
    now = time.time()
    if now - _alert_state["last_check"] < 10:
        return {"alerts": _alert_state["alerts"]}
    _alert_state["last_check"] = now
    cfg = _alert_config

    try:
        signing = await get_signing()
        staking = await get_staking()
        status_data = await rpc_call("status")

        if isinstance(signing, dict) and signing.get("missed_blocks", 0) > cfg["missed_blocks_warn"]:
            sev = "critical" if signing["missed_blocks"] > cfg["missed_blocks_crit"] else "warning"
            alerts.append({"type": "missed_blocks", "severity": sev,
                           "message": f"Missed {signing['missed_blocks']} blocks in signing window",
                           "value": signing["missed_blocks"]})

        if isinstance(signing, dict) and signing.get("uptime_pct", 100) < cfg["uptime_warn"]:
            sev = "critical" if signing["uptime_pct"] < cfg["uptime_crit"] else "warning"
            alerts.append({"type": "low_uptime", "severity": sev,
                           "message": f"Signing uptime at {signing['uptime_pct']:.2f}%",
                           "value": signing["uptime_pct"]})

        if isinstance(signing, dict):
            jailed_until = signing.get("jailed_until", "")
            if jailed_until and jailed_until != "1970-01-01T00:00:00Z":
                alerts.append({"type": "jailed", "severity": "critical",
                               "message": "Validator is JAILED!", "value": jailed_until})

        if isinstance(staking, dict) and staking.get("available", 0) < cfg["low_balance"]:
            alerts.append({"type": "low_balance", "severity": "warning",
                           "message": f"Low available balance: {staking['available']:.4f} HYVE",
                           "value": staking.get("available", 0)})

        if not status_data:
            alerts.append({"type": "node_down", "severity": "critical",
                           "message": "Node is not responding", "value": 0})
        else:
            sync = status_data.get("result", {}).get("sync_info", {})
            if sync.get("catching_up"):
                alerts.append({"type": "syncing", "severity": "warning",
                               "message": "Node is catching up / syncing", "value": 0})
            block_time = sync.get("latest_block_time", "")
            if block_time:
                try:
                    bt = datetime.fromisoformat(block_time.replace("Z", "+00:00"))
                    age = (datetime.now(timezone.utc) - bt).total_seconds()
                    if age > cfg["stale_blocks_secs"]:
                        alerts.append({"type": "stale_blocks", "severity": "warning",
                                       "message": f"Last block was {int(age)}s ago",
                                       "value": int(age)})
                except Exception:
                    pass

        props = await rest_call("/cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD&pagination.limit=10")
        if props and props.get("proposals"):
            count = len(props["proposals"])
            alerts.append({"type": "active_proposals", "severity": "info",
                           "message": f"{count} active governance proposal{'s' if count > 1 else ''}",
                           "value": count})

    except Exception:
        pass

    _alert_state["alerts"] = alerts
    # Send notifications for critical/warning alerts
    for a in alerts:
        if a["severity"] in ("critical", "warning"):
            key = f"{a['type']}_{a['severity']}"
            if now - _last_notified.get(key, 0) > 300:  # 5-min cooldown
                _last_notified[key] = now
                asyncio.create_task(_send_notifications(a))
                asyncio.create_task(_record_alert_to_db(a))
    return {"alerts": alerts}


# ── API: System Stats ───────────────────────────────────────────────────────
@app.get("/api/system")
async def get_system():
    return get_system_stats()


# ── API: RPC Metrics ────────────────────────────────────────────────────────
@app.get("/api/rpc-metrics")
async def get_rpc_metrics():
    result = {"recent": list(_rpc_buffer)[-100:], "stats": [], "totals": {"hour": 0, "day": 0}}
    if db_pool:
        try:
            stats = await db_pool.fetch(
                "SELECT path, COUNT(*)::int as count, ROUND(AVG(duration_ms)::numeric,2)::float as avg_ms, "
                "ROUND(MAX(duration_ms)::numeric,2)::float as max_ms "
                "FROM rpc_metrics WHERE ts > NOW() - INTERVAL '1 hour' "
                "GROUP BY path ORDER BY count DESC LIMIT 20"
            )
            result["stats"] = [dict(r) for r in stats]
            h = await db_pool.fetchval("SELECT COUNT(*) FROM rpc_metrics WHERE ts > NOW() - INTERVAL '1 hour'")
            d = await db_pool.fetchval("SELECT COUNT(*) FROM rpc_metrics WHERE ts > NOW() - INTERVAL '24 hours'")
            result["totals"] = {"hour": h or 0, "day": d or 0}
        except Exception:
            pass
    else:
        result["totals"] = {"hour": len(_rpc_buffer), "day": len(_rpc_buffer)}
    return result


# ── API: Tracking Data ──────────────────────────────────────────────────────
@app.get("/api/delegation-events")
async def api_delegation_events(limit: int = 100):
    if not db_pool:
        return {"events": []}
    rows = await db_pool.fetch(
        "SELECT id, ts, event, delegator, amount, validator, tx_hash FROM delegation_events ORDER BY ts DESC LIMIT $1", limit
    )
    return {"events": [dict(r) for r in rows]}


@app.get("/api/network-snapshots")
async def api_network_snapshots(hours: int = 168):
    if not db_pool:
        return {"snapshots": []}
    rows = await db_pool.fetch(
        "SELECT id, ts, total_supply, bonded_tokens, bonded_ratio, inflation, active_validators, avg_block_time, avg_commission "
        "FROM network_snapshots WHERE ts > NOW() - make_interval(hours => $1) ORDER BY ts", hours
    )
    return {"snapshots": [dict(r) for r in rows]}


@app.get("/api/validator-set-changes")
async def api_validator_set_changes(limit: int = 100):
    if not db_pool:
        return {"changes": []}
    rows = await db_pool.fetch(
        "SELECT id, ts, event, moniker, valoper, tokens, rank FROM validator_set_changes ORDER BY ts DESC LIMIT $1", limit
    )
    return {"changes": [dict(r) for r in rows]}


@app.get("/api/alert-history")
async def api_alert_history(limit: int = 200):
    if not db_pool:
        return {"alerts": []}
    rows = await db_pool.fetch(
        "SELECT id, ts, alert_type, severity, message, value, notified FROM alert_history ORDER BY ts DESC LIMIT $1", limit
    )
    return {"alerts": [dict(r) for r in rows]}


@app.get("/api/node-restarts")
async def api_node_restarts(limit: int = 50):
    if not db_pool:
        return {"restarts": []}
    rows = await db_pool.fetch(
        "SELECT id, ts, pid, prev_pid, uptime_before, reason FROM node_restarts ORDER BY ts DESC LIMIT $1", limit
    )
    return {"restarts": [dict(r) for r in rows]}


@app.get("/api/peer-history")
async def api_peer_history(hours: int = 168):
    if not db_pool:
        return {"history": []}
    rows = await db_pool.fetch(
        "SELECT id, ts, peer_count, peer_ids FROM peer_history WHERE ts > NOW() - make_interval(hours => $1) ORDER BY ts", hours
    )
    return {"history": [dict(r) for r in rows]}


@app.get("/api/block-time-history")
async def api_block_time_history(hours: int = 168):
    if not db_pool:
        return {"history": []}
    rows = await db_pool.fetch(
        "SELECT id, ts, avg_block_time, height_start, height_end FROM block_time_history "
        "WHERE ts > NOW() - make_interval(hours => $1) ORDER BY ts", hours
    )
    return {"history": [dict(r) for r in rows]}


@app.get("/api/governance-votes")
async def api_governance_votes(limit: int = 50):
    if not db_pool:
        return {"votes": []}
    rows = await db_pool.fetch(
        "SELECT id, ts, proposal_id, proposal_title, vote_option, tx_hash FROM governance_votes ORDER BY ts DESC LIMIT $1", limit
    )
    return {"votes": [dict(r) for r in rows]}


# ── TX Endpoints ─────────────────────────────────────────────────────────────
@app.post("/api/tx/claim-rewards")
async def claim_rewards(req: TxRequest):
    op = load_operator_info()
    valoper = op.get("valoperAddr", "")
    if not valoper:
        return {"ok": False, "error": "No operator info"}
    result = run_hyved_tx(["tx", "distribution", "withdraw-rewards", valoper, "--from", "validator-operator", "--commission"])
    if result.get("ok") and db_pool:
        try:
            await db_pool.execute(
                "INSERT INTO rewards_log (event, tx_hash, details) VALUES ($1, $2, $3)",
                "claim_rewards", result.get("result", {}).get("txhash", ""),
                json.dumps({"type": "cosmos_claim"})
            )
        except Exception:
            pass
    return result

@app.post("/api/tx/delegate")
async def delegate(req: DelegateRequest):
    return run_hyved_tx(["tx", "staking", "delegate", req.validator, f"{to_raw(req.amount)}{DENOM}", "--from", "validator-operator"])

@app.post("/api/tx/redelegate")
async def redelegate(req: RedelegateRequest):
    return run_hyved_tx(["tx", "staking", "redelegate", req.src_validator, req.dst_validator,
                         f"{to_raw(req.amount)}{DENOM}", "--from", "validator-operator"])

@app.post("/api/tx/compound")
async def compound(req: TxRequest):
    op = load_operator_info()
    cosmos = op.get("cosmosAddr", "")
    valoper = op.get("valoperAddr", "")
    if not cosmos or not valoper:
        return {"ok": False, "error": "No operator info"}
    claim_result = run_hyved_tx(["tx", "distribution", "withdraw-rewards", valoper, "--from", "validator-operator", "--commission"])
    if not claim_result.get("ok"):
        return {"ok": False, "error": f"Claim failed: {claim_result.get('error', 'unknown')}"}
    await asyncio.sleep(5)
    balance_data = await rest_call(f"/cosmos/bank/v1beta1/balances/{cosmos}")
    if not balance_data:
        return {"ok": False, "error": "Could not fetch balance after claim"}
    available = 0
    for b in balance_data.get("balances", []):
        if b["denom"] == DENOM:
            available = int(b["amount"])
    gas_reserve = 10 ** DENOM_EXPONENT
    delegate_amount = available - gas_reserve
    if delegate_amount <= 0:
        return {"ok": True, "result": {"message": "Rewards claimed but insufficient balance to delegate after gas reserve"}}
    delegate_result = run_hyved_tx(["tx", "staking", "delegate", valoper, f"{delegate_amount}{DENOM}", "--from", "validator-operator"])
    if db_pool:
        try:
            await db_pool.execute(
                "INSERT INTO rewards_log (event, amount, tx_hash, details) VALUES ($1, $2, $3, $4)",
                "compound", to_display(str(delegate_amount)), claim_result.get("result", {}).get("txhash", ""),
                json.dumps({"type": "compound", "delegated": to_display(str(delegate_amount))})
            )
        except Exception:
            pass
    return {"ok": True, "result": {"claimed": claim_result.get("result"), "delegated": delegate_result.get("result"),
                                   "delegated_amount": to_display(str(delegate_amount))}}

@app.post("/api/tx/claim-shade")
async def claim_shade(req: TxRequest):
    if not _eth_account:
        return {"ok": False, "error": "VALIDATOR_PRIVATE_KEY not configured or eth-account not installed."}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # Get nonce
            nonce_r = await client.post(EVM_RPC_URL, json={
                "jsonrpc": "2.0", "method": "eth_getTransactionCount",
                "params": [_eth_account.address, "latest"], "id": 1,
            })
            nonce = int(nonce_r.json().get("result", "0x0"), 16)
            # Estimate gas
            gas_r = await client.post(EVM_RPC_URL, json={
                "jsonrpc": "2.0", "method": "eth_estimateGas",
                "params": [{"from": _eth_account.address, "to": SHADE_EMISSION, "data": "0x4e71d92d"}], "id": 2,
            })
            gas_result = gas_r.json()
            if "error" in gas_result:
                err_msg = gas_result["error"].get("message", "Gas estimation failed")
                return {"ok": False, "error": f"Contract reverted: {err_msg}. Claim interval may not have elapsed yet."}
            gas = int(gas_result.get("result", "0x30d40"), 16)
            gas = int(gas * 1.3)  # buffer
            # Get gas price
            gp_r = await client.post(EVM_RPC_URL, json={
                "jsonrpc": "2.0", "method": "eth_gasPrice", "params": [], "id": 3,
            })
            gas_price = int(gp_r.json().get("result", "0x2540be400"), 16)
            # Sign transaction
            tx = {
                "nonce": nonce, "to": SHADE_EMISSION, "value": 0,
                "gas": gas, "gasPrice": gas_price, "data": bytes.fromhex("4e71d92d"),
                "chainId": EVM_CHAIN_ID,
            }
            signed = _eth_account.sign_transaction(tx)
            raw_hex = "0x" + signed.raw_transaction.hex()
            # Broadcast
            send_r = await client.post(EVM_RPC_URL, json={
                "jsonrpc": "2.0", "method": "eth_sendRawTransaction",
                "params": [raw_hex], "id": 4,
            })
            result = send_r.json()
            if "error" in result:
                return {"ok": False, "error": result["error"].get("message", "EVM broadcast failed")}
            tx_hash = result.get("result", "")
            if db_pool:
                try:
                    await db_pool.execute(
                        "INSERT INTO rewards_log (event, tx_hash, details) VALUES ($1, $2, $3)",
                        "claim_shade", tx_hash, json.dumps({"type": "evm_shade_claim"})
                    )
                except Exception:
                    pass
            return {"ok": True, "result": {"tx_hash": tx_hash}}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/tx/status")
async def tx_key_status():
    """Check if the private key is configured for signing."""
    return {
        "key_configured": bool(VALIDATOR_PRIVATE_KEY),
        "evm_address": _eth_account.address if _eth_account else None,
    }


# ── Node Control ────────────────────────────────────────────────────────────
@app.post("/api/node/start")
async def start_node():
    if find_hyved_process():
        return {"ok": False, "error": "Node is already running"}
    if not HYVED_BIN.exists():
        return {"ok": False, "error": f"hyved not found at {HYVED_BIN}"}
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_fd = open(LOG_FILE, "a")
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = f"{HYVE_NODE_DIR / 'bin'}:{env.get('LD_LIBRARY_PATH', '')}"
    subprocess.Popen([str(HYVED_BIN), "start", "--home", str(HYVED_HOME), "--chain-id", CHAIN_ID],
                     stdout=log_fd, stderr=subprocess.STDOUT, start_new_session=True, env=env)
    return {"ok": True}

@app.post("/api/node/stop")
async def stop_node():
    proc = find_hyved_process()
    if not proc:
        return {"ok": False, "error": "Node is not running"}
    try:
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=15)
        return {"ok": True}
    except psutil.TimeoutExpired:
        proc.kill()
        return {"ok": True, "warning": "Forced kill after timeout"}

@app.post("/api/node/restart")
async def restart_node():
    proc = find_hyved_process()
    if proc:
        try:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=15)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        await asyncio.sleep(2)
    return await start_node()


# ── Local RPC Toggle ────────────────────────────────────────────────────────
_APP_TOML = HYVED_HOME / "config" / "app.toml"

def _read_rpc_config() -> dict:
    """Read enable flags from app.toml for each RPC section."""
    result = {"json_rpc": True, "api": True, "grpc": True}
    if not _APP_TOML.exists():
        return result
    content = _APP_TOML.read_text()
    section = ""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped[1:-1].strip()
        elif stripped.startswith("enable") and "=" in stripped:
            key, _, val = stripped.partition("=")
            key = key.strip()
            val = val.strip().lower()
            if key == "enable":
                enabled = val == "true"
                if section == "json-rpc":
                    result["json_rpc"] = enabled
                elif section == "api":
                    result["api"] = enabled
                elif section == "grpc":
                    result["grpc"] = enabled
    return result


def _write_rpc_config(json_rpc: bool | None, api: bool | None, grpc: bool | None):
    """Toggle enable flags in app.toml for RPC sections."""
    if not _APP_TOML.exists():
        raise FileNotFoundError("app.toml not found")
    content = _APP_TOML.read_text()
    lines = content.splitlines()
    section = ""
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped[1:-1].strip()
        if stripped.startswith("enable") and "=" in stripped:
            key, _, _ = stripped.partition("=")
            if key.strip() == "enable":
                if section == "json-rpc" and json_rpc is not None:
                    line = f"enable = {'true' if json_rpc else 'false'}"
                elif section == "api" and api is not None:
                    line = f"enable = {'true' if api else 'false'}"
                elif section == "grpc" and grpc is not None:
                    line = f"enable = {'true' if grpc else 'false'}"
        new_lines.append(line)
    _APP_TOML.write_text("\n".join(new_lines) + "\n")


@app.get("/api/rpc-config")
async def get_rpc_config():
    return _read_rpc_config()


class RpcConfigRequest(BaseModel):
    json_rpc: bool | None = None
    api: bool | None = None
    grpc: bool | None = None


@app.post("/api/rpc-config")
async def set_rpc_config(body: RpcConfigRequest):
    try:
        _write_rpc_config(body.json_rpc, body.api, body.grpc)
        return {"ok": True, "restart_required": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Notification Helpers ─────────────────────────────────────────────────────
_DISCORD_ALERT_CONFIG = {
    "critical": {
        "color": 0xFF0000,
        "emoji": "🚨",
        "title_prefix": "CRITICAL ALERT",
        "thumbnail": "https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif",
        "footer_icon": "https://cdn-icons-png.flaticon.com/512/564/564619.png",
    },
    "warning": {
        "color": 0xFFA500,
        "emoji": "⚠️",
        "title_prefix": "WARNING",
        "thumbnail": "https://media.giphy.com/media/3o7TKNdE84GCQV9LcA/giphy.gif",
        "footer_icon": "https://cdn-icons-png.flaticon.com/512/929/929490.png",
    },
    "info": {
        "color": 0x22D3EE,
        "emoji": "💡",
        "title_prefix": "INFO",
        "thumbnail": "https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif",
        "footer_icon": "https://cdn-icons-png.flaticon.com/512/1828/1828640.png",
    },
    "test": {
        "color": 0x8B5CF6,
        "emoji": "🧪",
        "title_prefix": "TEST",
        "thumbnail": "https://media.giphy.com/media/3oKIPnAiaMCJ8dR26c/giphy.gif",
        "footer_icon": "https://cdn-icons-png.flaticon.com/512/1828/1828640.png",
    },
}

_ALERT_TYPE_DETAILS = {
    "missed_blocks": {"icon": "🧱", "field_name": "Missed Blocks", "tip": "Check your node's signing process and connectivity."},
    "low_uptime": {"icon": "📉", "field_name": "Uptime", "tip": "Ensure your node is online and signing blocks consistently."},
    "jailed": {"icon": "⛓️", "field_name": "Jail Status", "tip": "Your validator has been jailed! Unjail ASAP to resume earning."},
    "low_balance": {"icon": "💸", "field_name": "Balance", "tip": "Top up your validator account to cover gas fees."},
    "node_down": {"icon": "💀", "field_name": "Node Status", "tip": "Node is unreachable — check the process and server health."},
    "syncing": {"icon": "🔄", "field_name": "Sync Status", "tip": "Node is catching up. It won't sign blocks until synced."},
    "stale_blocks": {"icon": "🕐", "field_name": "Block Staleness", "tip": "No new blocks — possible chain halt or node issue."},
    "active_proposals": {"icon": "🗳️", "field_name": "Governance", "tip": "Don't forget to vote! Participation matters."},
    "test": {"icon": "🧪", "field_name": "Test Alert", "tip": "This is a test — your webhook is working!"},
}


async def _send_discord_embed(alert: dict):
    cfg = _discord_config
    if not cfg.get("enabled") or not cfg.get("webhook_url"):
        return
    severity = alert.get("severity", "info")
    alert_type = alert.get("type", "test")
    acfg = _DISCORD_ALERT_CONFIG.get(severity, _DISCORD_ALERT_CONFIG["info"])
    details = _ALERT_TYPE_DETAILS.get(alert_type, {"icon": "🔔", "field_name": "Alert", "tip": "Check your dashboard for details."})

    embed = {
        "title": f"{acfg['emoji']} {acfg['title_prefix']} — {details['icon']} {details['field_name']}",
        "description": f"**{alert['message']}**",
        "color": acfg["color"],
        "thumbnail": {"url": acfg["thumbnail"]},
        "fields": [
            {"name": "📊 Value", "value": f"`{alert.get('value', 'N/A')}`", "inline": True},
            {"name": "🏷️ Type", "value": f"`{alert_type}`", "inline": True},
            {"name": "🔥 Severity", "value": f"`{severity.upper()}`", "inline": True},
            {"name": "💡 Tip", "value": f"_{details['tip']}_", "inline": False},
        ],
        "footer": {
            "text": f"Hyve Validator Dashboard • {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
            "icon_url": acfg["footer_icon"],
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    payload = {
        "username": "Hyve Validator 🛡️",
        "avatar_url": "https://cdn-icons-png.flaticon.com/512/2592/2592004.png",
        "embeds": [embed],
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(cfg["webhook_url"], json=payload)
    except Exception:
        pass


async def _send_notifications(alert: dict):
    await _send_discord_embed(alert)


async def _send_discord_raw(payload: dict):
    """Send a raw Discord webhook payload (for status/journal embeds)."""
    cfg = _discord_config
    if not cfg.get("enabled") or not cfg.get("webhook_url"):
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(cfg["webhook_url"], json=payload)
    except Exception:
        pass


async def _send_hourly_status():
    """Send a compact status embed every hour."""
    try:
        status, staking, signing, shade = await asyncio.gather(
            get_status(), get_staking(), get_signing(), get_shade(),
        )
        sync = status.get("sync", {})
        height = sync.get("latest_block_height", "?")
        peers = status.get("peers", {}).get("count", "?")
        uptime = signing.get("uptime_pct", 0) if isinstance(signing, dict) else 0
        missed = signing.get("missed_blocks", 0) if isinstance(signing, dict) else 0
        available = staking.get("available", 0)
        delegated = staking.get("delegated", 0)
        rewards = staking.get("pending_rewards", 0) + staking.get("pending_commission", 0)
        shade_bal = shade.get("balance", 0)
        shade_claimable = shade.get("pending_reward", 0)
        claimable_flag = shade.get("claimable", False)
        proc = status.get("process", {})
        mem = proc.get("memory_mb", 0)
        cpu = proc.get("cpu_percent", 0)
        catching_up = sync.get("catching_up", False)

        # Status indicator
        if catching_up:
            status_line = "🔄 **Syncing**"
            color = 0xFFA500
        elif uptime >= 99:
            status_line = "🟢 **Online & Healthy**"
            color = 0x3FB950
        elif uptime >= 95:
            status_line = "� **Online — Recovering**"
            color = 0x3FB950
        elif uptime >= 90:
            status_line = "🟡 **Online — Window Recovering**"
            color = 0xFFA500
        else:
            status_line = "🔴 **Degraded Performance**"
            color = 0xFF0000

        # If currently signing fine but uptime dragged down by old misses, note recovery
        window = signing.get("window", 100000) if isinstance(signing, dict) else 100000
        recovery_note = ""
        if 90 <= uptime < 99 and missed > 0 and not catching_up:
            signed = window - missed
            blocks_until_clean = missed  # roughly how many blocks until old misses fall off
            hours_est = blocks_until_clean * 3 / 3600  # ~3s per block
            recovery_note = f"\n📈 *Recovery: ~{hours_est:.0f}h until window clears ({missed:,} old misses rolling off)*"

        fields = [
            {"name": "📦 Block Height", "value": f"`{height:,}`" if isinstance(height, int) else f"`{height}`", "inline": True},
            {"name": "👥 Peers", "value": f"`{peers}`", "inline": True},
            {"name": "✅ Uptime", "value": f"`{uptime:.2f}%`", "inline": True},
            {"name": "🧱 Missed Blocks", "value": f"`{missed:,}`" if isinstance(missed, int) else f"`{missed}`", "inline": True},
            {"name": "💰 Available", "value": f"`{available:,.4f} HYVE`", "inline": True},
            {"name": "🔒 Delegated", "value": f"`{delegated:,.4f} HYVE`", "inline": True},
            {"name": "🎁 Pending Rewards", "value": f"`{rewards:,.4f} HYVE`", "inline": True},
            {"name": "🌿 SHADE Balance", "value": f"`{shade_bal:,.2f}`", "inline": True},
            {"name": "🌿 SHADE Claimable", "value": f"`{shade_claimable:,.2f}`" + (" ✅" if claimable_flag else " ⏳"), "inline": True},
            {"name": "🖥️ Resources", "value": f"CPU `{cpu:.1f}%` · RAM `{mem:.0f} MB`", "inline": False},
        ]

        embed = {
            "title": "⏰ Hourly Validator Status",
            "description": status_line + recovery_note,
            "color": color,
            "fields": fields,
            "footer": {
                "text": f"Hyve Validator Dashboard • {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
                "icon_url": "https://cdn-icons-png.flaticon.com/512/1828/1828640.png",
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        await _send_discord_raw({
            "username": "Hyve Validator 🛡️",
            "avatar_url": "https://cdn-icons-png.flaticon.com/512/2592/2592004.png",
            "embeds": [embed],
        })
    except Exception:
        pass


async def _send_daily_journal():
    """Send a comprehensive 12-hour journal embed."""
    try:
        status, staking, signing, shade, net_data = await asyncio.gather(
            get_status(), get_staking(), get_signing(), get_shade(),
            rest_call("/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=200"),
        )
        sync = status.get("sync", {})
        height = sync.get("latest_block_height", "?")
        uptime = signing.get("uptime_pct", 0) if isinstance(signing, dict) else 0
        missed = signing.get("missed_blocks", 0) if isinstance(signing, dict) else 0
        available = staking.get("available", 0)
        delegated = staking.get("delegated", 0)
        rewards = staking.get("pending_rewards", 0)
        commission = staking.get("pending_commission", 0)
        shade_bal = shade.get("balance", 0)
        shade_claimed = shade.get("total_claimed", 0)
        shade_alloc = shade.get("allocation", 0)
        shade_pct = shade.get("claim_pct", 0)

        # Rank calculation
        rank = "?"
        total_vals = 0
        if net_data and net_data.get("validators"):
            vals = sorted(net_data["validators"], key=lambda v: int(v.get("tokens", "0")), reverse=True)
            total_vals = len(vals)
            op = load_operator_info()
            valoper = op.get("valoperAddr", "")
            for i, v in enumerate(vals, 1):
                if v.get("operator_address") == valoper:
                    rank = i
                    break

        # DB stats for the last 12 hours
        blocks_12h = ""
        rewards_claimed_12h = ""
        if db_pool:
            try:
                row = await db_pool.fetchrow(
                    "SELECT MIN(height) as min_h, MAX(height) as max_h, COUNT(*) as samples "
                    "FROM metrics_history WHERE ts > NOW() - INTERVAL '12 hours'"
                )
                if row and row["min_h"] and row["max_h"]:
                    blocks_12h = f"`{row['max_h'] - row['min_h']:,}` blocks processed"
                claim_count = await db_pool.fetchval(
                    "SELECT COUNT(*) FROM rewards_log WHERE ts > NOW() - INTERVAL '12 hours'"
                )
                rewards_claimed_12h = f"`{claim_count}` claim transactions"
            except Exception:
                pass

        # Build journal
        now_str = datetime.now(timezone.utc).strftime("%A, %B %d %Y • %H:%M UTC")

        embed = {
            "title": "📓 Validator Daily Journal",
            "description": f"**{now_str}**\n━━━━━━━━━━━━━━━━━━━━━━━",
            "color": 0x8B5CF6,
            "thumbnail": {"url": "https://media.giphy.com/media/3oKIPnAiaMCJ8dR26c/giphy.gif"},
            "fields": [
                {"name": "━━━ 🏗️ CHAIN STATUS ━━━", "value": "\u200b", "inline": False},
                {"name": "📦 Block Height", "value": f"`{height:,}`" if isinstance(height, int) else f"`{height}`", "inline": True},
                {"name": "🏆 Validator Rank", "value": f"`#{rank}` of `{total_vals}`", "inline": True},
                {"name": "📊 12h Activity", "value": blocks_12h or "`No data`", "inline": True},

                {"name": "━━━ ✅ PERFORMANCE ━━━", "value": "\u200b", "inline": False},
                {"name": "🎯 Uptime", "value": f"`{uptime:.2f}%`" + (" 🏅" if uptime >= 99.9 else " ✅" if uptime >= 99 else " 📈 recovering"), "inline": True},
                {"name": "🧱 Missed Blocks", "value": f"`{missed:,}`" + (" 🎉" if missed == 0 else f" (rolling off ~{missed * 3 / 3600:.0f}h)" if missed > 100 else ""), "inline": True},
                {"name": "📋 Claims (12h)", "value": rewards_claimed_12h or "`0` claim transactions", "inline": True},

                {"name": "━━━ 💰 FINANCES ━━━", "value": "\u200b", "inline": False},
                {"name": "💵 Available", "value": f"`{available:,.4f} HYVE`", "inline": True},
                {"name": "🔒 Delegated", "value": f"`{delegated:,.4f} HYVE`", "inline": True},
                {"name": "🎁 Rewards", "value": f"`{rewards:,.4f} HYVE`", "inline": True},
                {"name": "💎 Commission", "value": f"`{commission:,.4f} HYVE`", "inline": True},
                {"name": "📈 Total Value", "value": f"`{available + delegated + rewards + commission:,.4f} HYVE`", "inline": True},
                {"name": "\u200b", "value": "\u200b", "inline": True},

                {"name": "━━━ 🌿 SHADE TOKEN ━━━", "value": "\u200b", "inline": False},
                {"name": "💼 Balance", "value": f"`{shade_bal:,.2f} SHADE`", "inline": True},
                {"name": "📊 Claimed", "value": f"`{shade_claimed:,.2f}` / `{shade_alloc:,.2f}` ({shade_pct}%)", "inline": True},
                {"name": "📋 Progress", "value": _make_progress_bar(shade_pct), "inline": False},

                {"name": "━━━ 🖥️ SERVER ━━━", "value": "\u200b", "inline": False},
                {"name": "💻 CPU", "value": f"`{status.get('process', {}).get('cpu_percent', 0):.1f}%`", "inline": True},
                {"name": "🧠 RAM", "value": f"`{status.get('process', {}).get('memory_mb', 0):.0f} MB`", "inline": True},
                {"name": "💾 Disk", "value": f"`{status.get('disk', {}).get('pct', 0):.1f}%`", "inline": True},
            ],
            "footer": {
                "text": "Hyve Validator Dashboard • 12-Hour Report",
                "icon_url": "https://cdn-icons-png.flaticon.com/512/2592/2592004.png",
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        await _send_discord_raw({
            "username": "Hyve Validator 🛡️",
            "avatar_url": "https://cdn-icons-png.flaticon.com/512/2592/2592004.png",
            "embeds": [embed],
        })
    except Exception:
        pass


def _make_progress_bar(pct: float) -> str:
    """Create a visual progress bar for Discord."""
    filled = int(pct / 5)
    empty = 20 - filled
    bar = "🟩" * filled + "⬛" * empty
    return f"{bar} `{pct:.1f}%`"


async def _periodic_discord_loop():
    """Background task: hourly status + 12-hour journal + rank tracking + auto-compound."""
    hourly_counter = 0
    await asyncio.sleep(60)  # Wait 1 min after startup before first send
    while True:
        try:
            hourly_counter += 1
            await _send_hourly_status()
            if hourly_counter % 12 == 0:
                await _send_daily_journal()
            # Record rank history
            await _record_rank_snapshot()
            # Auto-compound check
            await _check_auto_compound()
            # ── Hourly tracking ──
            await _record_network_snapshot()
            await _track_validator_set_changes()
            await _track_delegation_changes()
            await _detect_node_restart()
            await _record_peer_snapshot()
            await _record_block_time()
        except Exception:
            pass
        await asyncio.sleep(3600)  # 1 hour


async def _record_rank_snapshot():
    """Record current validator rank to DB for rank chart."""
    if not db_pool:
        return
    try:
        benchmarks = await get_benchmarks()
        ours = benchmarks.get("ours", {})
        if not ours:
            return
        delegators = await get_delegators()
        await db_pool.execute(
            "INSERT INTO rank_history (rank, voting_power, total_validators, delegator_count) VALUES ($1, $2, $3, $4)",
            ours.get("rank", 0), ours.get("stake", 0),
            benchmarks.get("network", {}).get("total_validators", 0),
            delegators.get("count", 0),
        )
    except Exception:
        pass


async def _autonomous_metrics_record():
    """Background task: record metrics every 2 minutes regardless of WS clients."""
    await asyncio.sleep(30)  # Stagger from other startup tasks
    while True:
        try:
            if db_pool:
                status, staking, signing, shade = await asyncio.gather(
                    get_status(), get_staking(), get_signing(), get_shade()
                )
                record = {
                    "height": (status or {}).get("sync", {}).get("latest_block_height", 0),
                    "peers": (status or {}).get("peers", {}).get("count", 0),
                    "rewards": (staking or {}).get("pending_rewards", 0),
                    "commission": (staking or {}).get("pending_commission", 0),
                    "delegated": (staking or {}).get("delegated", 0),
                    "available": (staking or {}).get("available", 0),
                    "memory_mb": (status or {}).get("process", {}).get("memory_mb", 0),
                    "cpu_pct": (status or {}).get("process", {}).get("cpu_percent", 0),
                    "uptime_pct": (signing or {}).get("uptime_pct", 0),
                    "shade_balance": (shade or {}).get("balance", 0),
                    "shade_pending": (shade or {}).get("pending_reward", 0),
                    "disk_pct": (status or {}).get("disk", {}).get("pct", 0),
                    "load_avg": os.getloadavg()[0],
                }
                await _db_record_metrics(record)
        except Exception:
            pass
        await asyncio.sleep(120)  # 2 minutes


async def _detect_node_restart():
    """Check if hyved PID changed and log restart."""
    global _last_hyved_pid
    if not db_pool:
        return
    try:
        import psutil
        current_pid = None
        for proc in psutil.process_iter(["pid", "name", "cmdline"]):
            try:
                if "hyved" in (proc.info.get("name") or "") or any("hyved" in (c or "") for c in (proc.info.get("cmdline") or [])):
                    current_pid = proc.info["pid"]
                    break
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        if current_pid and _last_hyved_pid and current_pid != _last_hyved_pid:
            await db_pool.execute(
                "INSERT INTO node_restarts (pid, prev_pid, reason) VALUES ($1, $2, $3)",
                current_pid, _last_hyved_pid, "pid_change_detected",
            )
        _last_hyved_pid = current_pid
    except Exception:
        pass


async def _record_peer_snapshot():
    """Record peer count and peer IDs."""
    if not db_pool:
        return
    try:
        net_info = await rpc_call("net_info")
        if not net_info:
            return
        peers = net_info.get("result", {}).get("peers", [])
        peer_ids = [p.get("node_info", {}).get("id", "") for p in peers if p.get("node_info", {}).get("id")]
        await db_pool.execute(
            "INSERT INTO peer_history (peer_count, peer_ids) VALUES ($1, $2)",
            len(peers), peer_ids,
        )
    except Exception:
        pass


async def _record_block_time():
    """Record average block time over the last ~50 blocks."""
    if not db_pool:
        return
    try:
        status_data = await rpc_call("status")
        if not status_data:
            return
        latest_height = int(status_data["result"]["sync_info"]["latest_block_height"])
        start_height = max(1, latest_height - 50)
        block_1, block_2 = await asyncio.gather(
            rpc_call(f"block?height={latest_height}"),
            rpc_call(f"block?height={start_height}"),
        )
        if block_1 and block_2:
            t1 = datetime.fromisoformat(block_1["result"]["block"]["header"]["time"].replace("Z", "+00:00"))
            t2 = datetime.fromisoformat(block_2["result"]["block"]["header"]["time"].replace("Z", "+00:00"))
            diff = (t1 - t2).total_seconds()
            blocks = latest_height - start_height
            if blocks > 0:
                avg_bt = round(diff / blocks, 3)
                await db_pool.execute(
                    "INSERT INTO block_time_history (avg_block_time, height_start, height_end) VALUES ($1, $2, $3)",
                    avg_bt, start_height, latest_height,
                )
    except Exception:
        pass


async def _record_network_snapshot():
    """Record network-wide metrics: supply, bonded ratio, inflation, etc."""
    if not db_pool:
        return
    try:
        net = await get_network()
        if not net:
            return
        await db_pool.execute(
            "INSERT INTO network_snapshots (total_supply, bonded_tokens, bonded_ratio, inflation, active_validators, avg_block_time, avg_commission) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            net.get("total_supply", 0), net.get("bonded_tokens", 0),
            net.get("bonded_ratio", 0), net.get("inflation", 0),
            net.get("active_validators", 0), net.get("avg_block_time", 0),
            net.get("avg_commission", 0),
        )
    except Exception:
        pass


async def _track_validator_set_changes():
    """Detect validators joining/leaving the active set."""
    global _last_known_valset
    if not db_pool:
        return
    try:
        vals_data = await rest_call("/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=150")
        if not vals_data:
            return
        current = {}
        for v in vals_data.get("validators", []):
            addr = v.get("operator_address", "")
            current[addr] = {
                "moniker": v.get("description", {}).get("moniker", ""),
                "tokens": to_display(v.get("tokens", "0")),
            }
        current_set = set(current.keys())
        if _last_known_valset:
            joined = current_set - _last_known_valset
            left = _last_known_valset - current_set
            for addr in joined:
                info = current.get(addr, {})
                rank = sorted(current.keys(), key=lambda a: current[a]["tokens"], reverse=True).index(addr) + 1
                await db_pool.execute(
                    "INSERT INTO validator_set_changes (event, moniker, valoper, tokens, rank) VALUES ($1,$2,$3,$4,$5)",
                    "joined", info.get("moniker", ""), addr, info.get("tokens", 0), rank,
                )
            for addr in left:
                await db_pool.execute(
                    "INSERT INTO validator_set_changes (event, moniker, valoper, tokens, rank) VALUES ($1,$2,$3,$4,$5)",
                    "left", "", addr, 0, 0,
                )
        _last_known_valset = current_set
    except Exception:
        pass


async def _track_delegation_changes():
    """Detect delegator changes (bond/unbond) for our validator."""
    global _last_known_delegators
    if not db_pool:
        return
    try:
        op = load_operator_info()
        valoper = op.get("valoperAddr", "")
        if not valoper:
            return
        data = await rest_call(f"/cosmos/staking/v1beta1/validators/{valoper}/delegations?pagination.limit=500")
        if not data:
            return
        current = {}
        for d in data.get("delegation_responses", []):
            addr = d.get("delegation", {}).get("delegator_address", "")
            amount = to_display(d.get("balance", {}).get("amount", "0"))
            current[addr] = amount
        if _last_known_delegators:
            all_addrs = set(list(current.keys()) + list(_last_known_delegators.keys()))
            for addr in all_addrs:
                old_amt = _last_known_delegators.get(addr, 0)
                new_amt = current.get(addr, 0)
                diff = new_amt - old_amt
                if abs(diff) < 0.01:
                    continue
                event = "delegate" if diff > 0 else "undelegate"
                await db_pool.execute(
                    "INSERT INTO delegation_events (event, delegator, amount, validator) VALUES ($1,$2,$3,$4)",
                    event, addr, abs(diff), valoper,
                )
        _last_known_delegators = current
    except Exception:
        pass


async def _record_alert_to_db(alert: dict):
    """Persist a fired alert to alert_history table."""
    if not db_pool:
        return
    try:
        await db_pool.execute(
            "INSERT INTO alert_history (alert_type, severity, message, value, notified) VALUES ($1,$2,$3,$4,$5)",
            alert.get("type", ""), alert.get("severity", ""),
            alert.get("message", ""), alert.get("value", 0), True,
        )
    except Exception:
        pass


async def _check_auto_compound():
    """Auto-compound if enabled and threshold met."""
    if not _auto_compound_config.get("enabled"):
        return
    try:
        staking = await get_staking()
        if not isinstance(staking, dict):
            return
        total_pending = (staking.get("pending_rewards", 0) or 0) + (staking.get("pending_commission", 0) or 0)
        threshold = _auto_compound_config.get("threshold", 10.0)
        if total_pending >= threshold:
            from pydantic import BaseModel as _BM
            class _FakeReq(_BM):
                password: str = ""
            result = await compound(_FakeReq())
            if result.get("ok") and db_pool:
                await db_pool.execute(
                    "INSERT INTO rewards_log (event, amount, tx_hash, details) VALUES ($1, $2, $3, $4)",
                    "auto_compound", total_pending, "",
                    json.dumps({"type": "auto_compound", "threshold": threshold}),
                )
    except Exception:
        pass


# ── Notifications Config ────────────────────────────────────────────────────
@app.get("/api/notifications/config")
async def get_notification_config():
    return {
        "discord": {"enabled": _discord_config.get("enabled", False),
                     "configured": bool(_discord_config.get("webhook_url"))},
    }

@app.post("/api/notifications/discord")
async def set_discord_config(req: DiscordConfigRequest):
    global _discord_config
    _discord_config = {"webhook_url": req.webhook_url, "enabled": req.enabled}
    await _db_save_config("discord", _discord_config)
    return {"ok": True}

@app.post("/api/notifications/test")
async def test_notifications():
    test_alert = {"type": "test", "severity": "info", "message": "🎉 Test notification from Hyve Dashboard — Your webhook is working perfectly!", "value": "✅ OK"}
    await _send_notifications(test_alert)
    return {"ok": True, "message": "Test notification sent"}


# ── Alert Config ─────────────────────────────────────────────────────────────
@app.get("/api/alert-config")
async def get_alert_config():
    return _alert_config

@app.post("/api/alert-config")
async def set_alert_config(req: AlertConfigRequest):
    global _alert_config
    _alert_config = {
        "missed_blocks_warn": req.missed_blocks_warn, "missed_blocks_crit": req.missed_blocks_crit,
        "uptime_warn": req.uptime_warn, "uptime_crit": req.uptime_crit,
        "low_balance": req.low_balance, "stale_blocks_secs": req.stale_blocks_secs,
    }
    await _db_save_config("alert_config", _alert_config)
    return {"ok": True, "config": _alert_config}


# ── Notes / Maintenance Journal ─────────────────────────────────────────────
@app.get("/api/notes")
async def get_notes():
    if not db_pool:
        return {"notes": []}
    try:
        rows = await db_pool.fetch(
            "SELECT id, ts, title, content, category, pinned FROM notes ORDER BY pinned DESC, ts DESC LIMIT 100"
        )
        return {"notes": [dict(r) | {"ts": r["ts"].isoformat()} for r in rows]}
    except Exception:
        return {"notes": []}

@app.post("/api/notes")
async def create_note(req: NoteRequest):
    if not db_pool:
        return {"ok": False, "error": "Database not available"}
    try:
        row = await db_pool.fetchrow(
            "INSERT INTO notes (title, content, category) VALUES ($1, $2, $3) RETURNING id, ts",
            req.title, req.content, req.category,
        )
        return {"ok": True, "id": row["id"], "ts": row["ts"].isoformat()}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: int):
    if not db_pool:
        return {"ok": False, "error": "Database not available"}
    try:
        await db_pool.execute("DELETE FROM notes WHERE id = $1", note_id)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.patch("/api/notes/{note_id}/pin")
async def toggle_pin(note_id: int):
    if not db_pool:
        return {"ok": False, "error": "Database not available"}
    try:
        await db_pool.execute("UPDATE notes SET pinned = NOT pinned WHERE id = $1", note_id)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Live Block Explorer ─────────────────────────────────────────────────────
@app.get("/api/blocks")
async def get_blocks():
    try:
        status = await rpc_call("status")
        if not status:
            return {"blocks": []}
        latest = int(status.get("result", {}).get("sync_info", {}).get("latest_block_height", "0"))
        if latest == 0:
            return {"blocks": []}
        min_height = max(1, latest - 19)
        data = await rpc_call(f"blockchain?minHeight={min_height}&maxHeight={latest}")
        if not data:
            return {"blocks": []}
        blocks = []
        for bm in data.get("result", {}).get("block_metas", []):
            header = bm.get("header", {})
            blocks.append({
                "height": int(header.get("height", 0)),
                "time": header.get("time", ""),
                "num_txs": int(bm.get("num_txs", 0)),
                "proposer": header.get("proposer_address", "")[:12],
                "block_size": int(bm.get("block_size", 0)),
                "hash": bm.get("block_id", {}).get("hash", "")[:16],
            })
        blocks.sort(key=lambda x: x["height"], reverse=True)
        return {"blocks": blocks, "latest_height": latest}
    except Exception:
        return {"blocks": []}


# ── Tax / Income Report ─────────────────────────────────────────────────────
@app.get("/api/tax-report")
async def get_tax_report(days: int = 30):
    if days < 1:
        days = 1
    if days > 365:
        days = 365
    if not db_pool:
        return {"ok": False, "error": "Database not available"}
    try:
        rows = await db_pool.fetch(
            "SELECT ts, event, amount, tx_hash, details FROM rewards_log WHERE ts > NOW() - make_interval(days => $1) ORDER BY ts DESC",
            days,
        )
        events = []
        total = 0.0
        for r in rows:
            amt = float(r["amount"] or 0)
            total += amt
            events.append({
                "ts": r["ts"].isoformat(), "event": r["event"],
                "amount": amt, "tx_hash": r["tx_hash"] or "",
                "details": json.loads(r["details"]) if r["details"] else {},
            })
        return {"ok": True, "days": days, "total": total, "events": events}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Peer Geolocation ────────────────────────────────────────────────────────
@app.get("/api/peer-geo")
async def get_peer_geo():
    try:
        net_info = await rpc_call("net_info")
        if not net_info:
            return {"peers": []}
        peers_raw = net_info.get("result", {}).get("peers", [])
        ips = []
        peer_map = {}
        for p in peers_raw:
            remote = p.get("remote_ip", "")
            if remote and not remote.startswith("127.") and not remote.startswith("10.") and not remote.startswith("192.168."):
                ips.append(remote)
                peer_map[remote] = {
                    "node_id": p.get("node_info", {}).get("id", "")[:12],
                    "moniker": p.get("node_info", {}).get("moniker", "unknown"),
                    "remote_ip": remote,
                }
        if not ips:
            return {"peers": []}
        # Batch lookup (ip-api.com supports batch for up to 100)
        peers = []
        async with httpx.AsyncClient(timeout=10.0) as client:
            batch = [{"query": ip} for ip in ips[:100]]
            r = await client.post("http://ip-api.com/batch?fields=query,country,city,lat,lon,isp", json=batch)
            if r.status_code == 200:
                for geo in r.json():
                    ip = geo.get("query", "")
                    info = peer_map.get(ip, {})
                    peers.append({
                        "ip": ip, "lat": geo.get("lat", 0), "lon": geo.get("lon", 0),
                        "country": geo.get("country", ""), "city": geo.get("city", ""),
                        "isp": geo.get("isp", ""), "moniker": info.get("moniker", ""),
                        "node_id": info.get("node_id", ""),
                    })
        return {"peers": peers}
    except Exception:
        return {"peers": []}


# ── API: Health Score ────────────────────────────────────────────────────────
@app.get("/api/health-score")
async def get_health_score():
    """Composite 0-100 health score combining uptime, peers, sync, resources, block lag."""
    scoring = {}
    try:
        status, signing = await asyncio.gather(get_status(), get_signing())
        # 1. Uptime (0-35 pts)
        uptime = signing.get("uptime_pct", 0) if isinstance(signing, dict) else 0
        scoring["uptime"] = {"value": uptime, "max": 35,
                             "score": min(35, round(uptime / 100 * 35, 1))}
        # 2. Peer count (0-15 pts)
        peers = status.get("peers", {}).get("count", 0) if isinstance(status, dict) else 0
        peer_score = min(15, round(peers / 10 * 15, 1)) if peers < 10 else 15
        scoring["peers"] = {"value": peers, "max": 15, "score": peer_score}
        # 3. Sync status (0-15 pts)
        sync_info = status.get("sync", {}) if isinstance(status, dict) else {}
        catching_up = sync_info.get("catching_up", True)
        block_time = sync_info.get("latest_block_time", "")
        block_age = 0
        if block_time:
            try:
                bt = datetime.fromisoformat(block_time.replace("Z", "+00:00"))
                block_age = (datetime.now(timezone.utc) - bt).total_seconds()
            except Exception:
                block_age = 999
        sync_score = 0 if catching_up else (15 if block_age < 10 else 10 if block_age < 30 else 5 if block_age < 60 else 0)
        scoring["sync"] = {"value": round(block_age, 1), "catching_up": catching_up, "max": 15, "score": sync_score}
        # 4. System resources (0-20 pts) - CPU, memory, disk
        disk_info = get_disk_info()
        disk_pct = disk_info.get("pct", 0)
        mem = psutil.virtual_memory()
        cpu = psutil.cpu_percent(interval=0.1)
        cpu_pts = 7 if cpu < 50 else 5 if cpu < 75 else 3 if cpu < 90 else 0
        mem_pts = 7 if mem.percent < 70 else 5 if mem.percent < 85 else 3 if mem.percent < 95 else 0
        disk_pts = 6 if disk_pct < 70 else 4 if disk_pct < 85 else 2 if disk_pct < 95 else 0
        scoring["resources"] = {"cpu_pct": round(cpu, 1), "mem_pct": round(mem.percent, 1),
                                "disk_pct": round(disk_pct, 1), "max": 20,
                                "score": cpu_pts + mem_pts + disk_pts}
        # 5. Process health (0-15 pts)
        proc = find_hyved_process()
        proc_score = 15 if proc else 0
        scoring["process"] = {"running": proc is not None, "max": 15, "score": proc_score}
        total = sum(s["score"] for s in scoring.values())
        grade = "A+" if total >= 95 else "A" if total >= 90 else "B" if total >= 80 else "C" if total >= 70 else "D" if total >= 60 else "F"
        return {"score": round(total, 1), "grade": grade, "breakdown": scoring}
    except Exception:
        return {"score": 0, "grade": "?", "breakdown": scoring}


# ── API: Uptime Heatmap ─────────────────────────────────────────────────────
@app.get("/api/uptime-heatmap")
async def get_uptime_heatmap():
    """Return daily uptime data for heatmap (last 90 days from metrics_history)."""
    if not db_pool:
        return {"days": []}
    try:
        rows = await db_pool.fetch("""
            SELECT date_trunc('day', ts) AS day,
                   AVG(uptime_pct) AS avg_uptime,
                   COUNT(*) AS samples
            FROM metrics_history
            WHERE ts > NOW() - INTERVAL '90 days'
            GROUP BY day ORDER BY day
        """)
        days = [{"date": r["day"].isoformat()[:10], "uptime": round(r["avg_uptime"], 2),
                 "samples": r["samples"]} for r in rows]
        return {"days": days}
    except Exception:
        return {"days": []}


# ── API: Rank History ────────────────────────────────────────────────────────
@app.get("/api/rank-history")
async def get_rank_history():
    """Return validator rank over time from rank_history table."""
    if not db_pool:
        return {"history": []}
    try:
        rows = await db_pool.fetch("""
            SELECT ts, rank, voting_power, total_validators, delegator_count
            FROM rank_history WHERE ts > NOW() - INTERVAL '30 days'
            ORDER BY ts
        """)
        return {"history": [{"ts": r["ts"].isoformat(), "rank": r["rank"],
                             "voting_power": r["voting_power"],
                             "total_validators": r["total_validators"],
                             "delegator_count": r["delegator_count"]} for r in rows]}
    except Exception:
        return {"history": []}


# ── API: Slash Risk ──────────────────────────────────────────────────────────
@app.get("/api/slash-risk")
async def get_slash_risk():
    """Show proximity to jail threshold with danger gauge."""
    signing = await get_signing()
    if not isinstance(signing, dict) or not signing.get("window"):
        return {}
    window = signing["window"]
    missed = signing["missed_blocks"]
    min_signed_pct = signing.get("min_signed_pct", 1.0)
    max_missable = int(window * (1 - min_signed_pct / 100))
    remaining_before_jail = max(max_missable - missed, 0)
    risk_pct = round(missed / max_missable * 100, 2) if max_missable > 0 else 0
    zone = "safe" if risk_pct < 50 else "caution" if risk_pct < 75 else "danger" if risk_pct < 95 else "critical"
    return {
        "missed": missed, "max_missable": max_missable, "remaining_before_jail": remaining_before_jail,
        "risk_pct": min(risk_pct, 100), "zone": zone, "window": window,
        "min_signed_pct": min_signed_pct,
        "slash_downtime_pct": signing.get("slash_downtime_pct", 0),
        "jail_duration": signing.get("jail_duration", ""),
    }


# ── API: Disk Forecast ──────────────────────────────────────────────────────
@app.get("/api/disk-forecast")
async def get_disk_forecast():
    """Chart disk growth and predict when disk fills up."""
    disk = get_disk_info()
    growth_per_day = 0
    forecast_days = None
    history = []
    if db_pool:
        try:
            rows = await db_pool.fetch("""
                SELECT date_trunc('day', ts) AS day, AVG(disk_pct) AS avg_pct
                FROM metrics_history
                WHERE ts > NOW() - INTERVAL '30 days'
                GROUP BY day ORDER BY day
            """)
            history = [{"date": r["day"].isoformat()[:10], "pct": round(r["avg_pct"], 2)} for r in rows]
            if len(history) >= 2:
                # Linear regression across all data points for robust forecast
                x_vals = [(datetime.fromisoformat(h["date"]) - datetime.fromisoformat(history[0]["date"])).days for h in history]
                y_vals = [h["pct"] for h in history]
                n = len(x_vals)
                sum_x = sum(x_vals)
                sum_y = sum(y_vals)
                sum_xy = sum(x * y for x, y in zip(x_vals, y_vals))
                sum_x2 = sum(x * x for x in x_vals)
                denom = n * sum_x2 - sum_x * sum_x
                if denom != 0:
                    growth_per_day = (n * sum_xy - sum_x * sum_y) / denom
                if growth_per_day > 0:
                    remaining_pct = 100 - disk.get("pct", 0)
                    forecast_days = round(remaining_pct / growth_per_day)
        except Exception:
            pass
    return {
        "current": disk,
        "growth_per_day_pct": round(growth_per_day, 4),
        "forecast_days": forecast_days,
        "history": history,
    }


# ── API: Auto-Compound Config ───────────────────────────────────────────────
@app.get("/api/auto-compound")
async def get_auto_compound_config():
    return _auto_compound_config

@app.post("/api/auto-compound")
async def set_auto_compound_config(req: Request):
    global _auto_compound_config
    data = await req.json()
    _auto_compound_config = {
        "enabled": bool(data.get("enabled", False)),
        "threshold": max(0.01, float(data.get("threshold", 10.0))),
        "interval_hours": max(1, int(data.get("interval_hours", 24))),
    }
    await _db_save_config("auto_compound", _auto_compound_config)
    return {"ok": True, "config": _auto_compound_config}


# ── API: Proposal Vote Tracker ──────────────────────────────────────────────
@app.get("/api/vote-tracker")
async def get_vote_tracker():
    """Show which proposals we voted on vs missed."""
    all_data = await rest_call("/cosmos/gov/v1/proposals?pagination.limit=50&pagination.reverse=true")
    if not all_data:
        return {"proposals": [], "voted": 0, "missed": 0, "participation_pct": 0}
    op = load_operator_info()
    cosmos_addr = op.get("cosmosAddr", "")
    proposals = (all_data or {}).get("proposals", [])
    voted = 0
    missed = 0
    results = []
    for p in proposals:
        prop_id = p.get("id", "0")
        status = p.get("status", "")
        title = p.get("title", "") or f"Proposal #{prop_id}"
        my_vote = ""
        is_finished = status in ("PROPOSAL_STATUS_PASSED", "PROPOSAL_STATUS_REJECTED", "PROPOSAL_STATUS_FAILED")
        if cosmos_addr:
            vote_data = await rest_call(f"/cosmos/gov/v1/proposals/{prop_id}/votes/{cosmos_addr}")
            if vote_data and "vote" in vote_data:
                options = vote_data["vote"].get("options", [])
                if options:
                    my_vote = options[0].get("option", "").replace("VOTE_OPTION_", "")
        if my_vote:
            voted += 1
        elif is_finished:
            missed += 1
        results.append({"id": prop_id, "title": title, "status": status.replace("PROPOSAL_STATUS_", ""),
                        "my_vote": my_vote, "voted": bool(my_vote)})
    total_finished = voted + missed
    participation = round(voted / total_finished * 100, 1) if total_finished > 0 else 100
    return {"proposals": results, "voted": voted, "missed": missed, "participation_pct": participation}


# ── API: Peer Quality ────────────────────────────────────────────────────────
@app.get("/api/peer-quality")
async def get_peer_quality():
    """Peer quality analysis: send/recv rates, direction, geographic distribution."""
    status_data = await rpc_call("net_info")
    if not status_data or "result" not in status_data:
        return {"peers": [], "summary": {}}
    peers_raw = status_data["result"].get("peers", [])
    peers = []
    total_send = 0
    total_recv = 0
    inbound = 0
    outbound = 0
    for p in peers_raw:
        info = p.get("node_info", {})
        ci = p.get("connection_status", {})
        send_rate = float(ci.get("SendMonitor", {}).get("AvgRate", 0) or 0)
        recv_rate = float(ci.get("RecvMonitor", {}).get("AvgRate", 0) or 0)
        is_outbound = p.get("is_outbound", False)
        if is_outbound:
            outbound += 1
        else:
            inbound += 1
        total_send += send_rate
        total_recv += recv_rate
        ip = p.get("remote_ip", "")
        dur_ns = int(ci.get("Duration", 0) or 0)
        peers.append({
            "moniker": info.get("moniker", ""),
            "node_id": info.get("id", ""),
            "ip": ip,
            "direction": "outbound" if is_outbound else "inbound",
            "send_rate": round(send_rate, 1),
            "recv_rate": round(recv_rate, 1),
            "duration_s": dur_ns // 1_000_000_000,
        })
    peers.sort(key=lambda x: x["send_rate"] + x["recv_rate"], reverse=True)
    return {
        "peers": peers,
        "summary": {
            "total": len(peers), "inbound": inbound, "outbound": outbound,
            "avg_send": round(total_send / len(peers), 1) if peers else 0,
            "avg_recv": round(total_recv / len(peers), 1) if peers else 0,
        },
    }


# ── API: Export Config ───────────────────────────────────────────────────────
@app.get("/api/export-config")
async def export_config():
    """Export all dashboard settings as JSON for backup."""
    export = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "alert_config": _alert_config,
        "discord_config": {k: v for k, v in _discord_config.items() if k != "webhook_url"},
        "auto_compound": _auto_compound_config,
    }
    if db_pool:
        try:
            notes = await db_pool.fetch("SELECT title, content, category, pinned FROM notes ORDER BY ts")
            export["notes"] = [dict(r) for r in notes]
        except Exception:
            pass
    return export

@app.post("/api/import-config")
async def import_config(req: Request):
    """Import dashboard settings from JSON backup."""
    global _alert_config, _auto_compound_config
    data = await req.json()
    if "alert_config" in data:
        _alert_config = data["alert_config"]
        await _db_save_config("alert_config", _alert_config)
    if "auto_compound" in data:
        _auto_compound_config = data["auto_compound"]
        await _db_save_config("auto_compound", _auto_compound_config)
    if "notes" in data and db_pool:
        for n in data["notes"]:
            try:
                await db_pool.execute(
                    "INSERT INTO notes (title, content, category, pinned) VALUES ($1, $2, $3, $4)",
                    n.get("title", ""), n.get("content", ""), n.get("category", "general"), n.get("pinned", False),
                )
            except Exception:
                pass
    return {"ok": True}


@app.get("/api/timeline")
async def get_timeline(req: Request):
    """Aggregated activity timeline from multiple data sources."""
    events = []
    if db_pool:
        # Rewards log
        try:
            rows = await db_pool.fetch(
                "SELECT ts, event, amount, tx_hash FROM rewards_log ORDER BY ts DESC LIMIT 15"
            )
            for row in rows:
                events.append({
                    "ts": row["ts"].isoformat() if row["ts"] else "",
                    "type": "reward",
                    "icon": "\U0001f381",
                    "title": (row["event"] or "").replace("_", " ").title(),
                    "detail": f"{float(row['amount'] or 0):.6f} HYVE",
                    "color": "green",
                })
        except Exception:
            pass
        # Notes
        try:
            rows = await db_pool.fetch(
                "SELECT ts, title, category FROM notes ORDER BY ts DESC LIMIT 10"
            )
            for row in rows:
                events.append({
                    "ts": row["ts"].isoformat() if row["ts"] else "",
                    "type": "note",
                    "icon": "\U0001f4dd",
                    "title": row["title"],
                    "detail": row["category"],
                    "color": "cyan",
                })
        except Exception:
            pass
        # Rank changes
        try:
            rows = await db_pool.fetch(
                "SELECT ts, rank, voting_power, delegator_count FROM rank_history ORDER BY ts DESC LIMIT 20"
            )
            prev_rank = None
            for row in rows:
                rank = row["rank"]
                if prev_rank is not None and rank != prev_rank:
                    direction = "up" if rank < prev_rank else "down"
                    events.append({
                        "ts": row["ts"].isoformat() if row["ts"] else "",
                        "type": "rank",
                        "icon": "\U0001f4c8" if direction == "up" else "\U0001f4c9",
                        "title": f"Rank {'improved' if direction == 'up' else 'dropped'} to #{rank}",
                        "detail": f"From #{prev_rank}",
                        "color": "green" if direction == "up" else "orange",
                    })
                prev_rank = rank
        except Exception:
            pass
    events.sort(key=lambda e: e.get("ts", ""), reverse=True)
    return {"events": events[:30]}


# ── API: Validator Comparison ────────────────────────────────────────────────
@app.get("/api/validator-compare")
async def get_validator_compare():
    """Side-by-side comparison of our validator vs all active validators."""
    op = load_operator_info()
    our_valoper = op.get("valoperAddr", "")
    vals_data = await rest_call("/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=100")
    if not vals_data:
        return {"validators": [], "our_rank": 0}
    vals = vals_data.get("validators", [])
    parsed = []
    for i, v in enumerate(sorted(vals, key=lambda x: int(x.get("tokens", "0")), reverse=True)):
        addr = v.get("operator_address", "")
        tokens = to_display(v.get("tokens", "0"))
        comm = float(v.get("commission", {}).get("commission_rates", {}).get("rate", "0")) * 100
        parsed.append({
            "rank": i + 1,
            "moniker": v.get("description", {}).get("moniker", addr[:12]),
            "operator_address": addr,
            "tokens": round(tokens, 2),
            "commission": round(comm, 2),
            "jailed": v.get("jailed", False),
            "is_ours": addr == our_valoper,
        })
    our_rank = next((v["rank"] for v in parsed if v["is_ours"]), 0)
    return {"validators": parsed[:20], "our_rank": our_rank, "total": len(parsed)}


# ── API: Earnings Calculator ─────────────────────────────────────────────────
@app.get("/api/earnings-calc")
async def get_earnings_calc():
    """Provide current APR/staking data for the earnings projector."""
    pool_data, inflation_data, params_data = await asyncio.gather(
        rest_call("/cosmos/staking/v1beta1/pool"),
        rest_call("/cosmos/mint/v1beta1/inflation"),
        rest_call("/cosmos/staking/v1beta1/params"),
    )
    bonded_tokens = 0
    if pool_data:
        bonded_tokens = to_display(pool_data.get("pool", {}).get("bonded_tokens", "0"))
    inflation = 0
    if inflation_data:
        inflation = float(inflation_data.get("inflation", "0"))
    total_supply = bonded_tokens  # approximate
    if bonded_tokens > 0 and inflation > 0:
        apr = inflation * (total_supply / bonded_tokens) if bonded_tokens else 0
    else:
        apr = 0
    return {
        "apr": round(apr * 100, 2),
        "inflation": round(inflation * 100, 4),
        "bonded_tokens": round(bonded_tokens, 2),
    }


# ── API: System Resource History ─────────────────────────────────────────────
@app.get("/api/resource-history")
async def get_resource_history():
    """CPU, memory, disk, load average, peer count trends from metrics_history."""
    if not db_pool:
        return {"data": []}
    try:
        rows = await db_pool.fetch(
            "SELECT ts, cpu_pct, memory_mb, disk_pct, load_avg, peers "
            "FROM metrics_history ORDER BY ts DESC LIMIT 720"
        )
        return {"data": [dict(r) for r in reversed(rows)]}
    except Exception:
        return {"data": []}


# ── API: Commission Income ───────────────────────────────────────────────────
@app.get("/api/commission-income")
async def get_commission_income():
    """Commission earned per day from metrics_history snapshots."""
    if not db_pool:
        return {"daily": [], "total": 0}
    try:
        rows = await db_pool.fetch("""
            SELECT DATE(ts) as day, MAX(commission) as max_comm, MIN(commission) as min_comm
            FROM metrics_history
            WHERE commission IS NOT NULL AND commission > 0
            GROUP BY DATE(ts)
            ORDER BY day DESC LIMIT 90
        """)
        daily = []
        total = 0
        for r in reversed(rows):
            earned = max(0, (r["max_comm"] or 0) - (r["min_comm"] or 0))
            daily.append({"day": r["day"].isoformat(), "earned": round(earned, 6)})
            total += earned
        return {"daily": daily, "total": round(total, 6)}
    except Exception:
        return {"daily": [], "total": 0}


# ── API: Consensus Participation ─────────────────────────────────────────────
@app.get("/api/consensus")
async def get_consensus():
    """Block proposal stats and consensus participation."""
    status = await rpc_call("status")
    if not status or "result" not in status:
        return {}
    hex_addr = status["result"].get("validator_info", {}).get("address", "")
    latest_height = int(status["result"]["sync_info"].get("latest_block_height", 0))
    proposed = 0
    checked = 0
    sample_size = min(100, latest_height)
    # Check recent blocks for our proposals
    try:
        for h in range(latest_height, max(0, latest_height - sample_size), -1):
            block = await rpc_call(f"block?height={h}")
            if not block or "result" not in block:
                continue
            checked += 1
            proposer = block["result"]["block"]["header"].get("proposer_address", "")
            if proposer.upper() == hex_addr.upper():
                proposed += 1
            if checked >= 20:
                break
    except Exception:
        pass
    vals_data = await rpc_call("validators")
    total_validators = 0
    our_vp = 0
    total_vp = 0
    if vals_data and "result" in vals_data:
        validators = vals_data["result"].get("validators", [])
        total_validators = int(vals_data["result"].get("total", len(validators)))
        for v in validators:
            vp = int(v.get("voting_power", 0))
            total_vp += vp
            if v.get("address", "").upper() == hex_addr.upper():
                our_vp = vp
    expected_pct = (our_vp / total_vp * 100) if total_vp > 0 else 0
    actual_pct = (proposed / checked * 100) if checked > 0 else 0
    return {
        "proposed_blocks": proposed,
        "checked_blocks": checked,
        "expected_proposal_pct": round(expected_pct, 4),
        "actual_proposal_pct": round(actual_pct, 4),
        "our_voting_power": our_vp,
        "total_voting_power": total_vp,
        "vp_share": round(our_vp / total_vp * 100, 4) if total_vp > 0 else 0,
        "total_validators": total_validators,
    }


# ── API: Whale Alerts ────────────────────────────────────────────────────────
@app.get("/api/whale-alerts")
async def get_whale_alerts():
    """Recent large delegation/undelegation events to our validator."""
    op = load_operator_info()
    valoper = op.get("valoperAddr", "")
    if not valoper:
        return {"events": []}
    results = await asyncio.gather(
        rest_call(f"/cosmos/tx/v1beta1/txs?events=delegate.validator%3D%27{valoper}%27&order_by=ORDER_BY_DESC&pagination.limit=20"),
        rest_call(f"/cosmos/tx/v1beta1/txs?events=unbond.validator%3D%27{valoper}%27&order_by=ORDER_BY_DESC&pagination.limit=20"),
    )
    events = []
    for idx, data in enumerate(results):
        if not data:
            continue
        event_type = "delegate" if idx == 0 else "undelegate"
        for tx in data.get("tx_responses", []):
            height = tx.get("height", "0")
            ts = tx.get("timestamp", "")
            txhash = tx.get("txhash", "")
            for log in tx.get("logs", [{}]):
                for ev in log.get("events", []):
                    if ev["type"] in ("delegate", "unbond"):
                        amount_raw = ""
                        delegator = ""
                        for attr in ev.get("attributes", []):
                            if attr["key"] == "amount":
                                amount_raw = attr["value"].replace(DENOM, "")
                            if attr["key"] in ("delegator", "sender"):
                                delegator = attr["value"]
                        if amount_raw:
                            amount = to_display(amount_raw)
                            events.append({
                                "type": event_type,
                                "amount": round(amount, 4),
                                "delegator": delegator,
                                "height": int(height),
                                "ts": ts,
                                "txhash": txhash,
                                "whale": amount >= 1000,
                            })
    events.sort(key=lambda e: e.get("height", 0), reverse=True)
    return {"events": events[:30]}


# ── API: Pinned Tabs ─────────────────────────────────────────────────────────
@app.get("/api/pinned-tabs")
async def get_pinned_tabs():
    cfg = await _db_load_config("pinned_tabs")
    return {"tabs": cfg if isinstance(cfg, list) else []}

@app.post("/api/pinned-tabs")
async def save_pinned_tabs(req: Request):
    body = await req.json()
    tabs = body.get("tabs", [])
    if not isinstance(tabs, list) or len(tabs) > 15:
        return JSONResponse({"error": "Invalid tabs"}, status_code=400)
    # Sanitize: only allow known tab names
    sanitized = [t for t in tabs if isinstance(t, str) and len(t) < 30]
    await _db_save_config("pinned_tabs", sanitized)
    return {"ok": True}


# ── API: Chain Upgrades ──────────────────────────────────────────────────────
def _get_binary_release_url():
    return os.environ.get("BINARY_RELEASE_URL", "").rstrip("/")

_upgrade_download_lock = asyncio.Lock()

@app.get("/api/upgrades")
async def get_upgrades():
    """Return current upgrade plan, binary status, and upgrade history."""
    release_url = _get_binary_release_url()
    bin_dir = HYVE_NODE_DIR / "bin"
    hyved = bin_dir / "hyved"
    hyved_upgrade = bin_dir / "hyved.upgrade"

    # Current upgrade plan from chain
    plan_data = await rest_call("/cosmos/upgrade/v1beta1/current_plan")
    current_plan = plan_data.get("plan") if plan_data else None

    # Current chain height
    height = 0
    status = await rpc_call("status")
    if status:
        height = int(status.get("result", {}).get("sync_info", {}).get("latest_block_height", "0"))

    # Local binary info
    local_sha256 = ""
    local_size = 0
    if hyved.exists():
        local_size = hyved.stat().st_size
        h = hashlib.sha256()
        with open(hyved, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        local_sha256 = h.hexdigest()

    # Upgrade binary info
    upgrade_sha256 = ""
    upgrade_size = 0
    upgrade_exists = hyved_upgrade.exists()
    if upgrade_exists:
        upgrade_size = hyved_upgrade.stat().st_size
        h = hashlib.sha256()
        with open(hyved_upgrade, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        upgrade_sha256 = h.hexdigest()

    # Remote binary metadata (HEAD request, no download)
    remote_size = 0
    remote_last_modified = ""
    remote_sha256 = ""
    if release_url:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.head(f"{release_url}/hyved")
                if r.status_code == 200:
                    remote_size = int(r.headers.get("content-length", "0"))
                    remote_last_modified = r.headers.get("last-modified", "")
        except Exception:
            pass

        # Remote SHA256 (if available on server)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{release_url}/hyved.sha256")
                if r.status_code == 200 and len(r.text.strip()) >= 64:
                    remote_sha256 = r.text.strip().split()[0][:64]
        except Exception:
            pass

    # Determine if a new binary is available
    new_binary_available = False
    if remote_size > 0 and local_size > 0:
        if upgrade_exists and upgrade_size == remote_size:
            new_binary_available = False  # already downloaded
        elif remote_size != local_size:
            new_binary_available = True
        elif remote_sha256 and remote_sha256 != local_sha256:
            new_binary_available = True

    # Past upgrade proposals from governance
    upgrade_history = []
    proposals = await rest_call("/cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_PASSED&pagination.limit=50")
    if proposals:
        for p in proposals.get("proposals", []):
            for msg in p.get("messages", []):
                if "MsgSoftwareUpgrade" in msg.get("@type", ""):
                    plan = msg.get("plan", {})
                    upgrade_history.append({
                        "proposal_id": p.get("id"),
                        "name": plan.get("name", ""),
                        "height": int(plan.get("height", "0")),
                        "info": (plan.get("info", "") or "")[:500],
                        "status": p.get("status", ""),
                        "submit_time": p.get("submit_time", ""),
                        "applied": int(plan.get("height", "0")) <= height,
                    })
    upgrade_history.sort(key=lambda u: u["height"], reverse=True)

    return {
        "current_plan": current_plan,
        "current_height": height,
        "local_binary": {
            "sha256": local_sha256,
            "size": local_size,
        },
        "upgrade_binary": {
            "exists": upgrade_exists,
            "sha256": upgrade_sha256,
            "size": upgrade_size,
        },
        "remote_binary": {
            "size": remote_size,
            "last_modified": remote_last_modified,
            "sha256": remote_sha256,
        },
        "new_binary_available": new_binary_available,
        "release_url_configured": bool(release_url),
        "upgrade_history": upgrade_history,
    }


@app.post("/api/upgrades/download")
async def download_upgrade_binary():
    """Download the latest hyved binary from the release server."""
    release_url = _get_binary_release_url()
    if not release_url:
        return JSONResponse({"error": "BINARY_RELEASE_URL not configured. Set it in your .env file."}, status_code=400)
    if _upgrade_download_lock.locked():
        return JSONResponse({"error": "Download already in progress"}, status_code=409)

    async with _upgrade_download_lock:
        bin_dir = HYVE_NODE_DIR / "bin"
        bin_dir.mkdir(parents=True, exist_ok=True)
        dest = bin_dir / "hyved.upgrade"
        tmp = bin_dir / "hyved.upgrade.tmp"

        try:
            h = hashlib.sha256()
            total = 0
            async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as client:
                async with client.stream("GET", f"{release_url}/hyved") as resp:
                    resp.raise_for_status()
                    expected = int(resp.headers.get("content-length", "0"))
                    with open(tmp, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=1 << 20):
                            f.write(chunk)
                            h.update(chunk)
                            total += len(chunk)

            if expected and total != expected:
                tmp.unlink(missing_ok=True)
                return JSONResponse({"error": f"Incomplete download: {total}/{expected}"}, status_code=500)

            sha256 = h.hexdigest()
            tmp.rename(dest)
            os.chmod(dest, 0o755)

            # Also download additional shared libs if configured
            extra_libs = os.environ.get("BINARY_EXTRA_LIBS", "").strip()
            if extra_libs:
                for lib_name in extra_libs.split(","):
                    lib_name = lib_name.strip()
                    if not lib_name:
                        continue
                    lib = bin_dir / lib_name
                    if not lib.exists():
                        try:
                            async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
                                r = await client.get(f"{release_url}/{lib_name}")
                                if r.status_code == 200:
                                    lib.write_bytes(r.content)
                        except Exception:
                            pass

            return {"ok": True, "sha256": sha256, "size": total}
        except httpx.HTTPStatusError as e:
            tmp.unlink(missing_ok=True)
            return JSONResponse({"error": f"Download failed: HTTP {e.response.status_code}"}, status_code=502)
        except Exception as e:
            tmp.unlink(missing_ok=True)
            return JSONResponse({"error": f"Download failed: {e}"}, status_code=500)


@app.post("/api/upgrades/apply")
async def apply_upgrade_binary():
    """Swap hyved.upgrade into hyved, backing up the current binary, and restart the node."""
    bin_dir = HYVE_NODE_DIR / "bin"
    hyved = bin_dir / "hyved"
    hyved_upgrade = bin_dir / "hyved.upgrade"
    hyved_backup = bin_dir / "hyved.previous"

    if not hyved_upgrade.exists():
        return JSONResponse({"error": "No upgrade binary found. Download first."}, status_code=400)

    # Stop the node first if running
    proc = find_hyved_process()
    if proc:
        try:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=15)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        await asyncio.sleep(2)

    try:
        # Backup current binary
        if hyved.exists():
            if hyved_backup.exists():
                hyved_backup.unlink()
            hyved.rename(hyved_backup)

        # Move upgrade binary into place
        hyved_upgrade.rename(hyved)
        os.chmod(hyved, 0o755)

        # Start the node with the new binary
        result = await start_node()
        return {"ok": True, "node_started": result.get("ok", False)}
    except Exception as e:
        # Attempt rollback
        if hyved_backup.exists() and not hyved.exists():
            hyved_backup.rename(hyved)
        return JSONResponse({"error": f"Apply failed: {e}"}, status_code=500)


@app.post("/api/upgrades/rollback")
async def rollback_binary():
    """Rollback to the previous hyved binary."""
    bin_dir = HYVE_NODE_DIR / "bin"
    hyved = bin_dir / "hyved"
    hyved_backup = bin_dir / "hyved.previous"

    if not hyved_backup.exists():
        return JSONResponse({"error": "No backup binary available"}, status_code=400)

    proc = find_hyved_process()
    if proc:
        try:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=15)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        await asyncio.sleep(2)

    try:
        current_sha = ""
        if hyved.exists():
            h = hashlib.sha256()
            with open(hyved, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            current_sha = h.hexdigest()
            hyved.unlink()

        hyved_backup.rename(hyved)
        os.chmod(hyved, 0o755)

        result = await start_node()
        return {"ok": True, "rolled_back_sha256": current_sha, "node_started": result.get("ok", False)}
    except Exception as e:
        return JSONResponse({"error": f"Rollback failed: {e}"}, status_code=500)


# ── Failover ─────────────────────────────────────────────────────────────────
async def _ssh_connect():
    """Create an SSH connection to the failover node."""
    if not asyncssh:
        raise RuntimeError("asyncssh not installed")
    cfg = _failover_config
    if not cfg.get("host"):
        raise ValueError("Failover host not configured")
    kw = {"host": cfg["host"], "port": cfg.get("port", 22), "username": cfg.get("username", "root"),
          "known_hosts": None}
    key_path = cfg.get("ssh_key_path", "")
    if key_path and Path(key_path).exists():
        kw["client_keys"] = [key_path]
    return await asyncssh.connect(**kw)

async def _ssh_run(cmd: str, timeout: int = 15) -> dict:
    """Run a command on the failover node via SSH."""
    try:
        async with await _ssh_connect() as conn:
            result = await asyncio.wait_for(conn.run(cmd), timeout=timeout)
            return {"ok": True, "stdout": result.stdout.strip(), "stderr": result.stderr.strip(),
                    "exit_status": result.exit_status}
    except Exception as e:
        return {"ok": False, "error": str(e)}

async def _check_remote_node_health() -> dict:
    """Check the health of the remote failover node via SSH + its local RPC."""
    cfg = _failover_config
    host = cfg.get("host", "")
    rpc_port = cfg.get("remote_rpc_port", 26657)
    result = {"reachable": False, "node_running": False, "syncing": None, "latest_height": 0, "peers": 0}
    # Check SSH connectivity
    ssh_result = await _ssh_run("echo ok")
    if not ssh_result.get("ok"):
        return result
    result["reachable"] = True
    # Check if hyved is running
    ps_result = await _ssh_run("pgrep -f 'hyved start' || true")
    if ps_result.get("ok") and ps_result.get("stdout", "").strip():
        result["node_running"] = True
    # Query remote RPC for sync status
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"http://{host}:{rpc_port}/status")
            if resp.status_code == 200:
                data = resp.json().get("result", {})
                sync_info = data.get("sync_info", {})
                result["syncing"] = sync_info.get("catching_up", True)
                result["latest_height"] = int(sync_info.get("latest_block_height", 0))
                net_resp = await client.get(f"http://{host}:{rpc_port}/net_info")
                if net_resp.status_code == 200:
                    result["peers"] = int(net_resp.json().get("result", {}).get("n_peers", 0))
    except Exception:
        pass
    return result

async def _check_primary_health() -> dict:
    """Check local primary node health."""
    result = {"node_running": False, "syncing": None, "latest_height": 0, "peers": 0}
    proc = find_hyved_process()
    result["node_running"] = proc is not None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{RPC_URL}/status")
            if resp.status_code == 200:
                data = resp.json().get("result", {})
                sync_info = data.get("sync_info", {})
                result["syncing"] = sync_info.get("catching_up", True)
                result["latest_height"] = int(sync_info.get("latest_block_height", 0))
                net_resp = await client.get(f"{RPC_URL}/net_info")
                if net_resp.status_code == 200:
                    result["peers"] = int(net_resp.json().get("result", {}).get("n_peers", 0))
    except Exception:
        pass
    return result

async def _confirm_local_node_stopped(max_wait: int = 20) -> bool:
    """Wait until the local hyved process is confirmed dead. Returns True if stopped."""
    for _ in range(max_wait):
        if not find_hyved_process():
            return True
        await asyncio.sleep(1)
    # Force kill as last resort
    proc = find_hyved_process()
    if proc:
        try:
            proc.kill()
            await asyncio.sleep(2)
        except Exception:
            pass
    return find_hyved_process() is None

async def _confirm_remote_node_stopped(max_wait: int = 20) -> bool:
    """Wait until the remote hyved process is confirmed dead. Returns True if stopped."""
    for _ in range(max_wait):
        ps = await _ssh_run("pgrep -f 'hyved start' || true")
        if ps.get("ok") and not ps.get("stdout", "").strip():
            return True
        await asyncio.sleep(1)
    # Force kill as last resort
    await _ssh_run("pkill -9 -f 'hyved start' || true")
    await asyncio.sleep(2)
    ps = await _ssh_run("pgrep -f 'hyved start' || true")
    return ps.get("ok") and not ps.get("stdout", "").strip()

async def _record_failover_event(event_type: str, source: str, target: str, details: str, success: bool = True):
    if db_pool:
        try:
            await db_pool.execute(
                "INSERT INTO failover_events (event_type, source_node, target_node, details, success) VALUES ($1,$2,$3,$4,$5)",
                event_type, source, target, details, success)
        except Exception:
            pass

@app.get("/api/failover/status")
async def failover_status():
    """Get current failover configuration and state."""
    cfg = {k: v for k, v in _failover_config.items()}
    if cfg.get("ssh_key_path"):
        cfg["ssh_key_path"] = "***configured***"
    return {"config": cfg, "state": dict(_failover_state), "asyncssh_available": asyncssh is not None}

@app.post("/api/failover/config")
async def failover_config_save(req: FailoverConfigRequest):
    """Save failover configuration."""
    global _failover_config
    _failover_config.update(req.model_dump())
    await _db_save_config("failover", _failover_config)
    return {"ok": True, "config": {k: v for k, v in _failover_config.items()}}

@app.post("/api/failover/test")
async def failover_test():
    """Test SSH connection and remote node health."""
    if not asyncssh:
        return JSONResponse({"error": "asyncssh not installed — pip install asyncssh"}, status_code=400)
    if not _failover_config.get("host"):
        return JSONResponse({"error": "Failover host not configured"}, status_code=400)
    ssh_test = await _ssh_run("uname -a")
    if not ssh_test.get("ok"):
        return {"ok": False, "ssh": False, "error": ssh_test.get("error", "Connection failed")}
    remote_health = await _check_remote_node_health()
    return {"ok": True, "ssh": True, "system_info": ssh_test.get("stdout", ""),
            "remote_health": remote_health}

@app.post("/api/failover/activate")
async def failover_activate():
    """Manually activate failover — stop primary, start failover node.
    SAFETY: Confirms primary is fully dead before starting failover.
    Will NOT start failover if primary cannot be confirmed stopped."""
    if not asyncssh:
        return JSONResponse({"error": "asyncssh not installed"}, status_code=400)
    if not _failover_config.get("host"):
        return JSONResponse({"error": "Failover not configured"}, status_code=400)
    if _failover_state["active_node"] == "failover":
        return JSONResponse({"error": "Failover is already active"}, status_code=400)

    # Step 1: Stop local primary node
    stop_result = {"ok": True}
    if find_hyved_process():
        stop_result = await stop_node()

    # Step 2: CONFIRM primary is fully dead — refuse to proceed if not
    if not await _confirm_local_node_stopped():
        await _record_failover_event("activate", "primary", "failover",
                                      "BLOCKED: Primary node could not be confirmed stopped — refusing to start failover to prevent double-signing", False)
        return JSONResponse({"error": "Primary node could not be stopped — aborting to prevent double-signing"}, status_code=500)

    # Step 3: Ensure remote is also not already running (stale process)
    remote_ps = await _ssh_run("pgrep -f 'hyved start' || true")
    if remote_ps.get("ok") and remote_ps.get("stdout", "").strip():
        await _ssh_run("pkill -f 'hyved start' || true")
        if not await _confirm_remote_node_stopped():
            await _record_failover_event("activate", "primary", "failover",
                                          "BLOCKED: Stale remote process could not be killed", False)
            return JSONResponse({"error": "Stale remote node process could not be stopped"}, status_code=500)

    # Step 4: Start remote failover node
    remote_path = _failover_config.get("remote_hyved_path", "hyved")
    remote_home = _failover_config.get("remote_hyved_home", "$HOME/.hyved")
    start_cmd = f"nohup {remote_path} start --home {remote_home} --chain-id {CHAIN_ID} > /tmp/hyved.log 2>&1 &"
    start_result = await _ssh_run(start_cmd, timeout=10)

    success = start_result.get("ok", False)
    _failover_state["active_node"] = "failover" if success else "primary"
    _failover_state["last_failover_event"] = datetime.now(timezone.utc).isoformat()
    await _record_failover_event("activate", "primary", "failover",
                                  f"Manual activation. Stop: {stop_result}, Start: {start_result}", success)
    return {"ok": success, "active_node": _failover_state["active_node"],
            "stop_result": stop_result, "start_result": start_result}

@app.post("/api/failover/deactivate")
async def failover_deactivate():
    """Deactivate failover — stop failover node, start primary.
    SAFETY: Confirms failover is fully dead before starting primary.
    Will NOT start primary if failover cannot be confirmed stopped."""
    if not asyncssh:
        return JSONResponse({"error": "asyncssh not installed"}, status_code=400)
    if _failover_state["active_node"] == "primary":
        return JSONResponse({"error": "Primary is already active"}, status_code=400)

    # Step 1: Stop remote failover node
    stop_cmd = "pkill -f 'hyved start' || true"
    stop_result = await _ssh_run(stop_cmd)

    # Step 2: CONFIRM remote is fully dead — refuse to start primary if not
    if not await _confirm_remote_node_stopped():
        await _record_failover_event("deactivate", "failover", "primary",
                                      "BLOCKED: Failover node could not be confirmed stopped — refusing to start primary to prevent double-signing", False)
        return JSONResponse({"error": "Failover node could not be stopped — aborting to prevent double-signing"}, status_code=500)

    # Step 3: Start local primary
    start_result = await start_node()

    success = start_result.get("ok", False)
    _failover_state["active_node"] = "primary" if success else "failover"
    _failover_state["last_failover_event"] = datetime.now(timezone.utc).isoformat()
    await _record_failover_event("deactivate", "failover", "primary",
                                  f"Manual deactivation. Stop: {stop_result}, Start: {start_result}", success)
    return {"ok": success, "active_node": _failover_state["active_node"],
            "stop_result": stop_result, "start_result": start_result}

@app.get("/api/failover/history")
async def failover_history():
    """Get failover event history."""
    if not db_pool:
        return {"events": []}
    try:
        rows = await db_pool.fetch("SELECT * FROM failover_events ORDER BY ts DESC LIMIT 100")
        return {"events": [dict(r) for r in rows]}
    except Exception:
        return {"events": []}

@app.get("/api/failover/health")
async def failover_health_check():
    """On-demand health check of both primary and failover nodes."""
    primary = await _check_primary_health()
    failover = {}
    if _failover_config.get("host") and asyncssh:
        failover = await _check_remote_node_health()
    return {"primary": primary, "failover": failover, "active_node": _failover_state["active_node"]}

@app.post("/api/failover/remote/start")
async def failover_remote_start():
    """Start the hyved process on the failover node.
    SAFETY: Blocks if primary node is currently running to prevent double-signing."""
    if not asyncssh:
        return JSONResponse({"error": "asyncssh not installed"}, status_code=400)
    # DOUBLE-SIGN GUARD: refuse to start remote if local primary is running
    if find_hyved_process():
        await _record_failover_event("remote_start", "dashboard", "failover",
                                      "BLOCKED: Primary node is running — refusing remote start to prevent double-signing", False)
        return JSONResponse({"error": "Primary node is running — stop it first to prevent double-signing"}, status_code=409)
    remote_path = _failover_config.get("remote_hyved_path", "hyved")
    remote_home = _failover_config.get("remote_hyved_home", "$HOME/.hyved")
    start_cmd = f"nohup {remote_path} start --home {remote_home} --chain-id {CHAIN_ID} > /tmp/hyved.log 2>&1 &"
    result = await _ssh_run(start_cmd, timeout=10)
    await _record_failover_event("remote_start", "dashboard", "failover", str(result), result.get("ok", False))
    return result

@app.post("/api/failover/remote/stop")
async def failover_remote_stop():
    """Stop the hyved process on the failover node."""
    if not asyncssh:
        return JSONResponse({"error": "asyncssh not installed"}, status_code=400)
    result = await _ssh_run("pkill -f 'hyved start' || true")
    await _record_failover_event("remote_stop", "dashboard", "failover", str(result), result.get("ok", False))
    return result

@app.post("/api/failover/remote/cmd")
async def failover_remote_command(request: Request):
    """Run an arbitrary read-only command on the failover node (limited to safe commands)."""
    if not asyncssh:
        return JSONResponse({"error": "asyncssh not installed"}, status_code=400)
    body = await request.json()
    cmd = body.get("cmd", "").strip()
    if not cmd:
        return JSONResponse({"error": "No command provided"}, status_code=400)
    ALLOWED_PREFIXES = ("uname", "uptime", "free", "df", "cat /proc/loadavg", "pgrep", "ps aux",
                        "systemctl status", "journalctl", "tail", "head", "wc", "du", "ls", "hostname")
    if not any(cmd.startswith(p) for p in ALLOWED_PREFIXES):
        return JSONResponse({"error": "Command not in allowlist"}, status_code=403)
    return await _ssh_run(cmd, timeout=15)


async def _failover_monitor_loop():
    """Background task that monitors primary node health and triggers auto-failover if configured."""
    while True:
        try:
            interval = _failover_config.get("health_check_interval", 30)
            await asyncio.sleep(interval)
            if not _failover_config.get("enabled") or not _failover_config.get("host"):
                continue
            if not asyncssh:
                continue

            primary = await _check_primary_health()
            _failover_state["primary_healthy"] = primary.get("node_running", False) and not primary.get("syncing", True)
            _failover_state["last_check"] = datetime.now(timezone.utc).isoformat()

            # Check failover node
            remote = await _check_remote_node_health()
            _failover_state["failover_available"] = remote.get("reachable", False)
            _failover_state["failover_healthy"] = remote.get("node_running", False) and not remote.get("syncing", True)

            # Auto-failover logic
            if _failover_config.get("auto_failover") and _failover_state["active_node"] == "primary":
                if not _failover_state["primary_healthy"]:
                    _failover_state["consecutive_failures"] += 1
                    max_fail = _failover_config.get("max_failures", 3)
                    if _failover_state["consecutive_failures"] >= max_fail and _failover_state["failover_available"]:
                        # SAFETY: Stop primary first and confirm it's dead
                        proc = find_hyved_process()
                        if proc:
                            try:
                                proc.send_signal(signal.SIGTERM)
                                proc.wait(timeout=15)
                            except Exception:
                                try:
                                    proc.kill()
                                except Exception:
                                    pass
                        if not await _confirm_local_node_stopped():
                            await _record_failover_event("auto_failover", "primary", "failover",
                                                         f"BLOCKED: Could not confirm primary stopped after {max_fail} failures — refusing auto-failover", False)
                            continue
                        # SAFETY: Kill any stale remote process
                        await _ssh_run("pkill -f 'hyved start' || true")
                        await _confirm_remote_node_stopped(max_wait=10)
                        # Now safe to start failover
                        _failover_state["active_node"] = "failover"
                        _failover_state["last_failover_event"] = datetime.now(timezone.utc).isoformat()
                        _failover_state["consecutive_failures"] = 0
                        remote_path = _failover_config.get("remote_hyved_path", "hyved")
                        remote_home = _failover_config.get("remote_hyved_home", "$HOME/.hyved")
                        start_cmd = f"nohup {remote_path} start --home {remote_home} --chain-id {CHAIN_ID} > /tmp/hyved.log 2>&1 &"
                        await _ssh_run(start_cmd, timeout=10)
                        await _record_failover_event("auto_failover", "primary", "failover",
                                                     f"Auto-failover after {max_fail} consecutive failures. Primary confirmed stopped.", True)
                else:
                    _failover_state["consecutive_failures"] = 0
        except Exception:
            pass


# ── WebSocket ────────────────────────────────────────────────────────────────
@app.websocket("/ws/live")
async def live_updates(ws: WebSocket):
    token = ws.cookies.get("session") or ws.query_params.get("token")
    if not token or token not in _sessions or _sessions[token]["expires"] < time.time():
        await ws.close(code=1008)
        return
    await ws.accept()
    counter = 0
    cached_signing, cached_shade = {}, {}
    try:
        while True:
            coros = [get_status(), get_staking()]
            if counter % 5 == 0:
                coros.extend([get_signing(), get_shade()])
            results = await asyncio.gather(*coros)
            status, staking = results[0], results[1]
            if len(results) > 2:
                cached_signing, cached_shade = results[2], results[3]
            await ws.send_json({"status": status, "staking": staking, "signing": cached_signing, "shade": cached_shade})
            counter += 1
            if counter >= 60:
                counter = 0
                record = {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "height": status.get("sync", {}).get("latest_block_height", 0),
                    "peers": status.get("peers", {}).get("count", 0),
                    "rewards": staking.get("pending_rewards", 0),
                    "commission": staking.get("pending_commission", 0),
                    "delegated": staking.get("delegated", 0),
                    "available": staking.get("available", 0),
                    "memory_mb": status.get("process", {}).get("memory_mb", 0),
                    "cpu_pct": status.get("process", {}).get("cpu_percent", 0),
                    "uptime_pct": cached_signing.get("uptime_pct", 0),
                    "shade_balance": cached_shade.get("balance", 0),
                    "shade_pending": cached_shade.get("pending_reward", 0),
                    "disk_pct": status.get("disk", {}).get("pct", 0),
                    "load_avg": os.getloadavg()[0],
                }
                if db_pool:
                    await _db_record_metrics(record)
                else:
                    history = load_history()
                    history.append(record)
                    save_history(history)
            await asyncio.sleep(2)
    except (WebSocketDisconnect, Exception):
        pass

@app.websocket("/ws/logs")
async def live_logs(ws: WebSocket):
    token = ws.cookies.get("session") or ws.query_params.get("token")
    if not token or token not in _sessions or _sessions[token]["expires"] < time.time():
        await ws.close(code=1008)
        return
    await ws.accept()
    last_size = 0
    try:
        while True:
            if LOG_FILE.exists():
                sz = LOG_FILE.stat().st_size
                if sz != last_size:
                    await ws.send_json({"lines": read_log_tail(100)})
                    last_size = sz
            await asyncio.sleep(1)
    except (WebSocketDisconnect, Exception):
        pass


# ── Startup / Shutdown ──────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    global db_pool
    _init_auth()
    _init_validator_key()
    if asyncpg:
        try:
            db_pool = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=5)
            await _db_ensure_tables()
            await _db_load_all_configs()
            if HISTORY_FILE.exists():
                old = load_history()
                if old:
                    for r in old:
                        await _db_record_metrics(r)
                    HISTORY_FILE.rename(HISTORY_FILE.with_suffix(".json.migrated"))
                    print(f"Migrated {len(old)} history records to PostgreSQL")
        except Exception as e:
            print(f"PostgreSQL unavailable ({e}), using JSON fallback")
            db_pool = None
    asyncio.create_task(_periodic_discord_loop())
    asyncio.create_task(_autonomous_metrics_record())
    asyncio.create_task(_failover_monitor_loop())

@app.on_event("shutdown")
async def shutdown():
    if db_pool:
        await db_pool.close()


# ── Login Page ──────────────────────────────────────────────────────────────
LOGIN_HTML = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Hyve Dashboard - Login</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%2306b6d4'/><text x='50' y='72' font-size='60' font-weight='900' text-anchor='middle' fill='%2306090f'>H</text></svg>">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#06090f;color:#e6edf3;font-family:'Inter',-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-box{background:#0d1117;border:1px solid #21262d;border-radius:16px;padding:40px;width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.5)}
.login-box h1{font-size:24px;text-align:center;margin-bottom:8px}
.login-box h1 span{color:#22d3ee}
.login-box p{text-align:center;color:#8b949e;font-size:13px;margin-bottom:24px}
.field{margin-bottom:16px}
.field label{display:block;font-size:12px;font-weight:600;color:#8b949e;margin-bottom:4px}
.field input{width:100%;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 14px;color:#e6edf3;font-size:14px}
.field input:focus{outline:none;border-color:#22d3ee;box-shadow:0 0 0 2px rgba(34,211,238,0.15)}
.btn{width:100%;background:linear-gradient(135deg,#06b6d4,#22d3ee);color:#06090f;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px}
.btn:hover{box-shadow:0 0 20px rgba(34,211,238,0.3)}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.error{background:rgba(248,81,73,0.1);border:1px solid rgba(248,81,73,0.3);border-radius:8px;padding:10px;color:#f85149;font-size:13px;text-align:center;margin-bottom:16px;display:none}
.logo{width:60px;height:60px;background:linear-gradient(135deg,#22d3ee,#a371f7);border-radius:16px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:28px;color:#06090f;margin:0 auto 20px;box-shadow:0 0 30px rgba(34,211,238,0.3)}
</style></head><body>
<div class="login-box">
<div class="logo">H</div>
<h1><span>Hyve</span> Validator</h1>
<p>Enter credentials to access the dashboard</p>
<div class="error" id="loginError"></div>
<div class="field"><label>Username</label><input type="text" id="loginUser" value="admin" autocomplete="username"></div>
<div class="field"><label>Password</label><input type="password" id="loginPass" autocomplete="current-password"></div>
<button class="btn" id="loginBtn" onclick="doLogin()">Sign In</button>
</div>
<script>
document.getElementById('loginPass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
async function doLogin(){
const user=document.getElementById('loginUser').value;
const pass=document.getElementById('loginPass').value;
const err=document.getElementById('loginError');
const btn=document.getElementById('loginBtn');
err.style.display='none';btn.disabled=true;btn.textContent='Signing in...';
try{
const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password:pass})});
const d=await r.json();
if(d.ok){window.location.href='/';}
else{err.textContent=d.error||'Login failed';err.style.display='';}
}catch(e){err.textContent='Connection error';err.style.display='';}
btn.disabled=false;btn.textContent='Sign In';
}
document.getElementById('loginPass').focus();
</script></body></html>"""


# ── Routes ──────────────────────────────────────────────────────────────────
@app.get("/favicon.ico")
async def favicon():
    return HTMLResponse(status_code=204)

@app.get("/login", response_class=HTMLResponse)
async def login_page():
    return HTMLResponse(LOGIN_HTML)

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    return HTMLResponse((DASHBOARD_DIR / "dashboard.html").read_text())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8420)
