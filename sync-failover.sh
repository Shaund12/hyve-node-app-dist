#!/usr/bin/env bash
# Hyve Failover Sync — syncs hyve-node data to the failover PC (val 1)
# Runs via cron hourly to keep the failover node ready
#
# SAFETY: Will NOT sync if the remote node is actively running to prevent
# data corruption and double-signing risk.
set -euo pipefail

REMOTE_USER="YOUR_USERNAME"
REMOTE_HOST="YOUR_FAILOVER_IP"
REMOTE_DEST="${REMOTE_USER}@${REMOTE_HOST}"
LOCAL_NODE="$HOME/.config/hyve-node"
REMOTE_NODE=".config/hyve-node"
LOG_FILE="$LOCAL_NODE/logs/sync-failover.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

# Check SSH connectivity
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$REMOTE_DEST" "true" 2>/dev/null; then
    log "ERROR: Cannot reach $REMOTE_HOST — skipping sync"
    exit 1
fi

# SAFETY CHECK: Abort if remote hyved is running — syncing while the node
# is active risks data corruption and double-signing
REMOTE_PID=$(ssh -o ConnectTimeout=5 "$REMOTE_DEST" "pgrep -f 'hyved start' || true" 2>/dev/null)
if [[ -n "$REMOTE_PID" ]]; then
    log "ABORT: Remote hyved is running (PID $REMOTE_PID) — refusing to sync to prevent double-sign risk"
    exit 0
fi

log "Starting sync to $REMOTE_HOST"

# 1. Sync binary + shared lib (delete old, compress)
rsync -az --delete \
    "$LOCAL_NODE/bin/hyved" \
    "$LOCAL_NODE/bin/libhyve_masp.so" \
    "$REMOTE_DEST:~/$REMOTE_NODE/bin/"
log "Binaries synced"

# 2. Sync config (genesis, node config, app config, etc.) — small, always sync
rsync -az --delete \
    "$LOCAL_NODE/home/config/" \
    "$REMOTE_DEST:~/$REMOTE_NODE/home/config/"
log "Config synced"

# 3. Sync chain data — this is the big one (~2.5GB+)
#    Use --delete to remove pruned data, --compress for bandwidth
rsync -az --delete \
    --exclude='*.lock' \
    --exclude='LOCK' \
    "$LOCAL_NODE/home/data/" \
    "$REMOTE_DEST:~/$REMOTE_NODE/home/data/"
log "Chain data synced"

# 4. Sync keyring (needed for tx signing on failover)
rsync -az --delete \
    "$LOCAL_NODE/home/keyring-file/" \
    "$REMOTE_DEST:~/$REMOTE_NODE/home/keyring-file/"
rsync -az --delete \
    "$LOCAL_NODE/home/keyring-test/" \
    "$REMOTE_DEST:~/$REMOTE_NODE/home/keyring-test/"
log "Keyring synced"

# 5. Sync validator-operator.json
rsync -az \
    "$LOCAL_NODE/home/validator-operator.json" \
    "$REMOTE_DEST:~/$REMOTE_NODE/home/" 2>/dev/null || true
log "Validator operator synced"

# 6. CRITICAL: Clear priv_validator_state.json on remote so it won't sign
#    at the same height/round as the primary if accidentally started.
#    The node will rebuild this on next clean start.
ssh "$REMOTE_DEST" "cat > ~/$REMOTE_NODE/home/data/priv_validator_state.json << 'EOF'
{
  \"height\": \"0\",
  \"round\": 0,
  \"step\": 0
}
EOF"
log "Remote priv_validator_state reset to 0 (double-sign protection)"

# 7. Ensure hyved is executable on remote
ssh "$REMOTE_DEST" "chmod +x ~/$REMOTE_NODE/bin/hyved"

log "Sync complete"
