# Hyve Validator Dashboard — Mobile App

A React Native mobile client for the Hyve Validator Dashboard. Connects remotely to your running dashboard server — no validator node runs on the phone.

## What It Does

The mobile app provides full access to every dashboard feature over your network:

- **Overview** — Live node status, health score, alerts, staking summary
- **Staking** — Balances, claim/compound rewards, delegator list, governance voting
- **Analytics** — Commission income, earnings calculator, validator rank history, tax reports
- **Network** — Peer list, recent blocks, whale alerts
- **SHADE Token** — Balance, claim, emission stats
- **Operations** — Node start/stop/restart, live logs, chain upgrades, RPC metrics
- **Settings** — Alert thresholds, Discord notifications, auto-compound, password management

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | >= 20.x | `node --version` |
| npm | >= 10.x | Comes with Node.js |
| Java JDK | 17 | `sudo apt install openjdk-17-jdk-headless` (Linux) or install from [Adoptium](https://adoptium.net/) |
| Android SDK | 36 | Via Android Studio or command-line tools |
| Xcode | 15+ | **Mac only** — required for iOS builds |

## Quick Start (Android)

### 1. Install Dependencies

```bash
cd hyve-mobile
npm install
```

### 2. Set Up Android SDK

**Option A: Android Studio (recommended for beginners)**
1. Install [Android Studio](https://developer.android.com/studio)
2. Open Android Studio → SDK Manager → install Android SDK 36 and Build Tools 36.0.0
3. Note the SDK path (usually `~/Android/Sdk`)

**Option B: Command-line only**
```bash
# Download command-line tools
mkdir -p ~/Android/Sdk
cd /tmp
curl -sL -o cmdline-tools.zip \
  "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
unzip -qo cmdline-tools.zip
mkdir -p ~/Android/Sdk/cmdline-tools
mv cmdline-tools ~/Android/Sdk/cmdline-tools/latest

# Set environment
export ANDROID_HOME=~/Android/Sdk
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

# Accept licenses and install SDK components
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

### 3. Configure SDK Path

Create `android/local.properties`:
```
sdk.dir=/path/to/your/Android/Sdk
```

### 4. Build Debug APK

```bash
cd android
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64  # adjust for your system
./gradlew assembleDebug
```

The APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

### 5. Build Release APK (Signed)

First, generate a signing keystore (one-time):
```bash
keytool -genkeypair -v \
  -keystore android/app/hyve-release.keystore \
  -alias hyve-key \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass YOUR_PASSWORD -keypass YOUR_PASSWORD \
  -dname "CN=Your Name, O=Your Org, C=US"
```

Then update `android/app/build.gradle` — in the `signingConfigs` section, add a `release` block:
```groovy
signingConfigs {
    // ... debug config ...
    release {
        storeFile file('hyve-release.keystore')
        storePassword 'YOUR_PASSWORD'
        keyAlias 'hyve-key'
        keyPassword 'YOUR_PASSWORD'
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
        shrinkResources false
        proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
    }
}
```

Build the release APK:
```bash
cd android
./gradlew assembleRelease
```

The signed APK will be at: `android/app/build/outputs/apk/release/app-release.apk` (~60 MB)

### 6. Install on Your Phone

1. Transfer the APK to your Android device (USB, email, cloud storage, ADB, etc.)
2. On the phone, open the APK file
3. Allow "Install from unknown sources" when prompted
4. Open the app

**Via ADB (if device is connected via USB):**
```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

## Quick Start (iOS)

> **Requires a Mac with Xcode 15+.** iOS builds cannot be done on Linux or Windows.

### 1. Install Dependencies

```bash
cd hyve-mobile
npm install
cd ios && pod install && cd ..
```

### 2. Build and Run

**Via Xcode:**
1. Open `ios/HyveMobile.xcworkspace` in Xcode
2. Select your target device or simulator
3. Press Cmd+R to build and run

**Via command line:**
```bash
npx react-native run-ios
```

### 3. Distribute to a Physical iPhone

For installing on a real iPhone you need either:
- **TestFlight** — Requires an Apple Developer account ($99/year). Archive the build in Xcode, upload to App Store Connect, distribute via TestFlight.
- **Ad Hoc** — Register specific device UDIDs in your Apple Developer account, create a provisioning profile, archive and export as Ad Hoc IPA.

## Connecting to Your Dashboard

When you first open the app:

1. **Enter your dashboard server URL**
   - Local network: `http://192.168.x.x:8420`
   - With HTTPS: `https://validator.yourdomain.com`
2. **Log in** with your dashboard admin credentials

### Secure Remote Access (Recommended)

For accessing your dashboard from anywhere, set up HTTPS with a reverse proxy:

**Nginx + Let's Encrypt:**
```nginx
server {
    server_name validator.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8420;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8420;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
    }

    listen 80;
}
```

Then run:
```bash
sudo certbot --nginx -d validator.yourdomain.com
```

**Alternative: Tailscale (zero-config VPN)**
1. Install Tailscale on your server and phone
2. Access via Tailscale IP — encrypted, no ports exposed to the internet

## Project Structure

```
hyve-mobile/
├── App.tsx                    # Root: auth gate + drawer/tab navigation
├── src/
│   ├── api/client.ts          # API client, auth, WebSocket
│   ├── context/AuthContext.tsx # Auth state machine
│   ├── hooks/useApi.ts        # Polling data hook
│   ├── components/            # Card, MetricCard, Badge, Button, Layout
│   ├── utils/                 # Theme colors, formatting helpers
│   └── screens/
│       ├── ConnectScreen.tsx   # Server URL input
│       ├── LoginScreen.tsx     # Auth login
│       ├── OverviewScreen.tsx  # Dashboard home (WebSocket live)
│       ├── staking/            # Balances, Signing, Delegators, Governance
│       ├── analytics/          # Rewards, Earnings, Compare, Timeline, Uptime, Tax, Rank
│       ├── network/            # Network overview, Whale Alerts
│       ├── tokens/             # SHADE token
│       ├── operations/         # Node Control, Logs, Upgrades, Tx History, Notes, RPC
│       └── config/             # Settings, Alerts
├── android/                   # Android native project
├── ios/                       # iOS native project
└── package.json
```

## Security Notes

- The app stores your session cookie in device-local encrypted storage
- The server URL is stored locally on device — not transmitted anywhere
- All authentication goes through the same cookie-based auth as the web dashboard
- **Always use HTTPS** when accessing over the internet
- The keystore file (`hyve-release.keystore`) is your signing identity — back it up securely and never commit it to git
