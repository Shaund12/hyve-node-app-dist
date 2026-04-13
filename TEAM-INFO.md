# Hyve Validator Dashboard — What Users Need

Quick reference for what validators need from the team to use this dashboard.

---

## Required from Team (provide to validators)

| Item | Where it goes | Notes |
|------|--------------|-------|
| **AppImage or .deb** | Distributed to validators | Contains everything needed — binary URLs and extra libraries are compiled into the app and not user-visible. |

## Provided by the Validator (they already have these)

| Item | Where it goes | Notes |
|------|--------------|-------|
| **Validator private key** | `.env` → `VALIDATOR_PRIVATE_KEY` | 64-char hex, no `0x` prefix. Without it the dashboard runs read-only. |
| **Linux server** | — | Same machine running the Hyve node (`hyved`) |
| **Python 3.10+** | — | Comes with most distros (auto-installed by setup wizard) |

## What's NOT Exposed in Source Code

- The binary release server URL — compiled into `_hyve_config.so` (Cython, XOR-encoded)
- Shared library filenames — compiled into `_hyve_config.so`
- Any private keys or passwords

The `.so` binary cannot be read with `strings` or text editors. The URL is XOR-decoded at runtime only.

## Setup Flow (for validators)

```
1.  Download the AppImage
2.  chmod +x *.AppImage && ./Hyve*.AppImage
3.  Follow the setup wizard
4.  Open http://localhost:8420
```

## What the Upgrades Tab Does

- Shows pending chain upgrade proposals and countdown to upgrade height
- Displays local binary SHA256, staged upgrade binary, and remote binary status
- **Download**: Fetches the latest `hyved` binary + extra libs from the release server
- **Apply**: Stops node → backs up current binary → swaps in the new one → restarts
- **Rollback**: Restores the previous binary if something goes wrong
