# Hyve Validator Dashboard — What Users Need

Quick reference for what validators need from the team to use this dashboard.

---

## Required from Team (provide to validators)

| Item | Where it goes | Notes |
|------|--------------|-------|
| **Binary release URL** | `.env` → `BINARY_RELEASE_URL` | The URL of our binary distribution server. Without it the Upgrades tab can't download binaries — it still shows local binary info and upgrade history, just no download button. |
| **Extra library names** | `.env` → `BINARY_EXTRA_LIBS` | Comma-separated filenames of shared libraries that ship alongside `hyved`. Validators add these to `.env` so the dashboard downloads them automatically during upgrades. |

## Provided by the Validator (they already have these)

| Item | Where it goes | Notes |
|------|--------------|-------|
| **Validator private key** | `.env` → `VALIDATOR_PRIVATE_KEY` | 64-char hex, no `0x` prefix. Without it the dashboard runs read-only. |
| **Linux server** | — | Same machine running the Hyve node (`hyved`) |
| **Python 3.10+** | — | Comes with most distros |

## What's NOT Exposed in Source Code

- The binary release server URL
- Shared library filenames
- Any private keys or passwords

All of these live in `.env` which is gitignored. The source code only contains generic logic that reads from environment variables.

## Setup Flow (for validators)

```
1.  git clone <repo>
2.  cd hyve-node-app
3.  cp .env.example .env
4.  Edit .env:
      - Set VALIDATOR_PRIVATE_KEY
      - Set BINARY_RELEASE_URL       ← from team
      - Set BINARY_EXTRA_LIBS        ← from team
5.  ./setup.sh
6.  Open http://localhost:8420
```

## What the Upgrades Tab Does

- Shows pending chain upgrade proposals and countdown to upgrade height
- Displays local binary SHA256, staged upgrade binary, and remote binary status
- **Download**: Fetches the latest `hyved` binary + extra libs from the release server
- **Apply**: Stops node → backs up current binary → swaps in the new one → restarts
- **Rollback**: Restores the previous binary if something goes wrong

If `BINARY_RELEASE_URL` is not set, the tab shows "Not configured" and disables download — everything else (local info, upgrade history) still works.
