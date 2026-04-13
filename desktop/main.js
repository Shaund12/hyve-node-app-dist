const { app, BrowserWindow, ipcMain, Tray, Menu, shell, nativeImage, globalShortcut, dialog } = require('electron');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const net = require('net');

// ── Paths ───────────────────────────────────────────────────────────────────
const DASHBOARD_PORT = 8420;
const RUNTIME_DIR = path.join(os.homedir(), '.local', 'share', 'hyve-dashboard');
const DEFAULT_NODE_DIR = path.join(os.homedir(), '.config', 'hyve-node');
const SETUP_MARKER = path.join(RUNTIME_DIR, '.setup-complete');

function getBundleDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bundle');
  }
  // Dev mode: files are in parent directory
  return path.join(__dirname, '..');
}

// ── State ───────────────────────────────────────────────────────────────────
let mainWindow = null;
let setupWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;

// ── Helpers ─────────────────────────────────────────────────────────────────
function isSetupDone() {
  return fs.existsSync(SETUP_MARKER) &&
         fs.existsSync(path.join(RUNTIME_DIR, 'venv')) &&
         fs.existsSync(path.join(RUNTIME_DIR, '.env'));
}

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.mkdirSync(path.join(RUNTIME_DIR, 'data'), { recursive: true });
  const bundle = getBundleDir();
  const files = ['server.py', 'dashboard.html', 'requirements.txt', '.env.example',
                 'run.sh', 'hyve-node.service', 'hyve-dashboard.service',
                 '_hyve_config.cpython-312-x86_64-linux-gnu.so'];
  for (const f of files) {
    const src = path.join(bundle, f);
    const dst = path.join(RUNTIME_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  }
  try { fs.chmodSync(path.join(RUNTIME_DIR, 'run.sh'), '755'); } catch {}
}

function checkPort(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(2000);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, '127.0.0.1');
  });
}

function runCommand(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 60000, maxBuffer: 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) reject({ code: err.code, stdout, stderr, message: err.message });
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// ── Backend Management ──────────────────────────────────────────────────────
async function startBackend() {
  // First check if systemd service is running
  try {
    const { stdout } = await runCommand('systemctl is-active hyve-dashboard 2>/dev/null');
    if (stdout === 'active') return true;
  } catch {}

  // Check if something is already on the port
  if (await checkPort(DASHBOARD_PORT)) return true;

  // Start the Python backend directly
  const venvPython = path.join(RUNTIME_DIR, 'venv', 'bin', 'python3');
  if (!fs.existsSync(venvPython)) return false;

  backendProcess = spawn(venvPython, [
    '-m', 'uvicorn', 'server:app',
    '--host', '127.0.0.1',
    '--port', String(DASHBOARD_PORT),
    '--log-level', 'warning'
  ], {
    cwd: RUNTIME_DIR,
    env: { ...process.env, PATH: `${path.join(RUNTIME_DIR, 'venv', 'bin')}:${process.env.PATH}` },
    stdio: 'ignore',
    detached: false
  });

  backendProcess.on('exit', (code) => {
    backendProcess = null;
    if (!isQuitting && mainWindow) {
      mainWindow.webContents.send('backend-stopped', code);
    }
  });

  // Wait for it to come up
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await checkPort(DASHBOARD_PORT)) return true;
  }
  return false;
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// ── Windows ─────────────────────────────────────────────────────────────────
function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 920,
    height: 720,
    resizable: true,
    title: 'Hyve Validator Dashboard — Setup',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setupWindow.loadFile(path.join(__dirname, 'setup.html'));
  setupWindow.on('closed', () => { setupWindow = null; });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Hyve Validator Dashboard',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Build application menu
  const menuTemplate = [
    {
      label: 'Dashboard',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Restart Backend', click: restartBackendAndReload },
        { label: 'Re-run Setup', click: reopenSetup },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit(); } }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: 'F12', role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Dashboard URL', click: () => { shell.openExternal(`http://127.0.0.1:${DASHBOARD_PORT}`); } },
        { label: 'Check Backend Status', click: async () => {
          const up = await checkPort(DASHBOARD_PORT);
          dialog.showMessageBox(mainWindow, {
            type: up ? 'info' : 'warning',
            title: 'Backend Status',
            message: up ? 'Backend is running on port ' + DASHBOARD_PORT : 'Backend is NOT responding on port ' + DASHBOARD_PORT,
            buttons: up ? ['OK'] : ['OK', 'Restart Backend'],
          }).then(r => { if (r.response === 1) restartBackendAndReload(); });
        }}
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  mainWindow.loadURL(`http://127.0.0.1:${DASHBOARD_PORT}`);

  // Handle load failures (backend not ready, crashed, etc.)
  mainWindow.webContents.on('did-fail-load', async (event, errorCode, errorDescription) => {
    // Show a friendly error page with retry
    mainWindow.webContents.loadURL('data:text/html,' + encodeURIComponent(`
      <!DOCTYPE html><html><head><style>
        body{background:#0d1117;color:#e6edf3;font-family:-apple-system,sans-serif;
             display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column}
        h2{color:#f85149;margin-bottom:8px}
        p{color:#8b949e;max-width:500px;text-align:center;line-height:1.6}
        button{margin-top:20px;padding:10px 28px;background:#58a6ff;color:#000;border:none;
               border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}
        button:hover{opacity:0.9}
        code{background:#21262d;padding:2px 6px;border-radius:4px;font-size:13px}
      </style></head><body>
        <h2>Dashboard Unavailable</h2>
        <p>The backend server is not responding on port ${DASHBOARD_PORT}.<br>
           Error: ${errorDescription || 'Connection refused'}</p>
        <p style="font-size:13px">Check that the service is running:<br>
           <code>sudo systemctl status hyve-dashboard</code><br><br>
           Or restart it:<br>
           <code>sudo systemctl restart hyve-dashboard</code></p>
        <button onclick="location.href='http://127.0.0.1:${DASHBOARD_PORT}'">Retry Connection</button>
      </body></html>
    `));
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

async function restartBackendAndReload() {
  stopBackend();
  await new Promise(r => setTimeout(r, 1000));
  const ok = await startBackend();
  if (mainWindow) {
    if (ok) mainWindow.webContents.reload();
    else dialog.showErrorBox('Backend Error', 'Failed to restart the backend. Check service logs:\nsudo journalctl -u hyve-dashboard -f');
  }
}

function reopenSetup() {
  if (mainWindow) {
    // Must destroy directly — close() is prevented by the hide-on-close handler
    mainWindow.destroy();
    mainWindow = null;
  }
  // Remove setup marker so wizard shows
  try { fs.unlinkSync(SETUP_MARKER); } catch {}
  createSetupWindow();
}

// ── Tray ────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const fallbackPath = path.join(__dirname, 'assets', 'icon.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else if (fs.existsSync(fallbackPath)) {
    icon = nativeImage.createFromPath(fallbackPath).resize({ width: 22, height: 22 });
  } else {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Hyve Validator Dashboard');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: showDashboard },
    { type: 'separator' },
    { label: 'Restart Backend', click: restartBackendAndReload },
    { label: 'Re-run Setup', click: reopenSetup },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', showDashboard);
}

async function showDashboard() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  // Ensure runtime files are up-to-date before starting
  if (isSetupDone()) ensureRuntimeDir();
  const ok = await startBackend();
  if (ok) {
    createMainWindow();
  }
}

// ── IPC Handlers (for setup wizard) ─────────────────────────────────────────
function registerIPC() {

  ipcMain.handle('get-defaults', () => ({
    runtimeDir: RUNTIME_DIR,
    nodeDir: DEFAULT_NODE_DIR,
    user: os.userInfo().username,
    home: os.homedir()
  }));

  ipcMain.handle('check-system', async () => {
    const results = {};

    // Python
    try {
      const { stdout } = await runCommand('python3 --version');
      const ver = stdout.replace('Python ', '');
      const [maj, min] = ver.split('.').map(Number);
      results.python = { ok: maj >= 3 && min >= 10, version: ver };
    } catch {
      results.python = { ok: false, version: null };
    }

    // python3-venv
    try {
      await runCommand('python3 -c "import venv"');
      results.venv = { ok: true };
    } catch {
      results.venv = { ok: false };
    }

    // curl
    try {
      await runCommand('which curl');
      results.curl = { ok: true };
    } catch {
      results.curl = { ok: false };
    }

    // PostgreSQL
    try {
      const { stdout } = await runCommand('psql --version');
      results.postgres = { ok: true, version: stdout };
    } catch {
      results.postgres = { ok: false, version: null };
    }

    return results;
  });

  ipcMain.handle('install-system-deps', async (event, { missing }) => {
    // Install missing system packages via pkexec (graphical auth)
    const results = [];
    const send = (msg) => {
      results.push(msg);
      if (setupWindow) setupWindow.webContents.send('install-log', msg);
    };

    try {
      const pkgs = (missing || []).filter(p => ['python3', 'python3-venv', 'curl'].includes(p));
      if (pkgs.length === 0) return { ok: true, results: ['Nothing to install'] };

      send(`Installing system packages: ${pkgs.join(', ')}...`);

      const script = `#!/bin/bash\nset -e\napt-get update -qq\napt-get install -y ${pkgs.join(' ')}\n`;
      const scriptPath = '/tmp/hyve-install-sys-deps.sh';
      fs.writeFileSync(scriptPath, script, { mode: 0o755 });

      try {
        await runCommand(`pkexec "${scriptPath}"`, { timeout: 120000 });
      } catch {
        await runCommand(`sudo "${scriptPath}"`, { timeout: 120000 });
      }

      try { fs.unlinkSync(scriptPath); } catch {}

      send('  ✓ System packages installed');
      return { ok: true, results };
    } catch (e) {
      send(`  ✗ Failed: ${e.message || e.stderr || 'Unknown error'}`);
      return { ok: false, results, error: e.message || e.stderr };
    }
  });

  ipcMain.handle('check-node', async (_, nodeDir) => {
    const results = { dir: nodeDir };

    results.dirExists = fs.existsSync(nodeDir);
    results.binaryExists = fs.existsSync(path.join(nodeDir, 'bin', 'hyved'));
    results.configExists = fs.existsSync(path.join(nodeDir, 'home', 'config'));
    results.dataExists = fs.existsSync(path.join(nodeDir, 'home', 'data'));

    // Check if hyved running
    try {
      await runCommand('pgrep -x hyved');
      results.running = true;
    } catch {
      results.running = false;
    }

    // Check sync status
    if (results.running) {
      try {
        const { stdout } = await runCommand(
          `curl -s --connect-timeout 3 http://127.0.0.1:26657/status`
        );
        const d = JSON.parse(stdout);
        const sync = d.result.sync_info;
        results.synced = !sync.catching_up && sync.catching_up !== 'true';
        results.height = sync.latest_block_height;
      } catch {
        results.synced = null;
        results.height = null;
      }
    }

    return results;
  });

  ipcMain.handle('install-deps', async (event) => {
    ensureRuntimeDir();
    const steps = [];
    const send = (msg) => {
      steps.push(msg);
      if (setupWindow) setupWindow.webContents.send('install-log', msg);
    };

    try {
      // Create venv
      send('Creating Python virtual environment...');
      await runCommand(`python3 -m venv "${path.join(RUNTIME_DIR, 'venv')}"`, { timeout: 120000 });
      send('  ✓ Virtual environment created');

      // Upgrade pip
      send('Updating pip...');
      const pip = path.join(RUNTIME_DIR, 'venv', 'bin', 'pip');
      await runCommand(`"${pip}" install --upgrade pip -q`, { timeout: 120000 });
      send('  ✓ pip updated');

      // Install requirements
      send('Installing core dependencies...');
      await runCommand(`"${pip}" install -r "${path.join(RUNTIME_DIR, 'requirements.txt')}" -q`, { timeout: 300000 });
      send('  ✓ Core dependencies installed');

      // Optional: asyncpg
      send('Installing PostgreSQL driver (asyncpg)...');
      try {
        await runCommand(`"${pip}" install asyncpg -q`, { timeout: 120000 });
        send('  ✓ asyncpg installed');
      } catch { send('  ⚠ asyncpg skipped (optional)'); }

      // Optional: eth-account
      send('Installing EVM signing (eth-account)...');
      try {
        await runCommand(`"${pip}" install eth-account -q`, { timeout: 120000 });
        send('  ✓ eth-account installed');
      } catch { send('  ⚠ eth-account skipped (optional)'); }

      // Optional: rlp
      send('Installing RLP decoder...');
      try {
        await runCommand(`"${pip}" install rlp -q`, { timeout: 120000 });
        send('  ✓ rlp installed');
      } catch { send('  ⚠ rlp skipped (optional)'); }

      send('');
      send('✓ All dependencies installed');
      return { ok: true, steps };
    } catch (e) {
      send(`✗ Error: ${e.message || e.stderr || 'Unknown error'}`);
      return { ok: false, steps, error: e.message || e.stderr };
    }
  });

  ipcMain.handle('save-config', async (_, { privateKey, nodeDir }) => {
    ensureRuntimeDir();
    const envFile = path.join(RUNTIME_DIR, '.env');
    const exampleFile = path.join(RUNTIME_DIR, '.env.example');

    // Copy example if .env doesn't exist
    if (!fs.existsSync(envFile) && fs.existsSync(exampleFile)) {
      fs.copyFileSync(exampleFile, envFile);
    } else if (!fs.existsSync(envFile)) {
      fs.writeFileSync(envFile, '');
    }

    let content = fs.readFileSync(envFile, 'utf8');

    // Set private key
    const keyVal = privateKey || 'your_64_character_hex_private_key_here';
    if (content.match(/^VALIDATOR_PRIVATE_KEY=/m)) {
      content = content.replace(/^VALIDATOR_PRIVATE_KEY=.*/m, `VALIDATOR_PRIVATE_KEY=${keyVal}`);
    } else {
      content += `\nVALIDATOR_PRIVATE_KEY=${keyVal}\n`;
    }

    // Set node dir if non-default
    if (nodeDir && nodeDir !== DEFAULT_NODE_DIR) {
      if (content.match(/^HYVE_NODE_DIR=/m)) {
        content = content.replace(/^HYVE_NODE_DIR=.*/m, `HYVE_NODE_DIR=${nodeDir}`);
      } else if (content.match(/^#\s*HYVE_NODE_DIR=/m)) {
        content = content.replace(/^#\s*HYVE_NODE_DIR=.*/m, `HYVE_NODE_DIR=${nodeDir}`);
      } else {
        content += `HYVE_NODE_DIR=${nodeDir}\n`;
      }
    }

    fs.writeFileSync(envFile, content, { mode: 0o600 });
    return { ok: true };
  });

  ipcMain.handle('setup-database', async () => {
    const results = [];
    const send = (msg) => {
      results.push(msg);
      if (setupWindow) setupWindow.webContents.send('install-log', msg);
    };

    try {
      // Write a DB setup script — run with pkexec/sudo for postgres user access
      const dbScript = `#!/bin/bash
set -e
# Check if user exists
if sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='hyvedash'" 2>/dev/null | grep -q 1; then
  echo "USER_EXISTS"
else
  sudo -u postgres psql -c "CREATE USER hyvedash WITH PASSWORD 'hyvedash_local_2024';" 2>/dev/null
  echo "USER_CREATED"
fi
# Check if database exists
if sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='hyvedash'" 2>/dev/null | grep -q 1; then
  echo "DB_EXISTS"
else
  sudo -u postgres psql -c "CREATE DATABASE hyvedash OWNER hyvedash;" 2>/dev/null
  echo "DB_CREATED"
fi
`;
      const scriptPath = '/tmp/hyve-setup-db.sh';
      fs.writeFileSync(scriptPath, dbScript, { mode: 0o755 });

      send('Setting up PostgreSQL database...');
      let stdout;
      try {
        ({ stdout } = await runCommand(`pkexec "${scriptPath}"`, { timeout: 60000 }));
      } catch {
        ({ stdout } = await runCommand(`sudo "${scriptPath}"`, { timeout: 60000 }));
      }

      if (stdout.includes('USER_EXISTS')) send('  ✓ User already exists');
      else if (stdout.includes('USER_CREATED')) send('  ✓ User created');
      if (stdout.includes('DB_EXISTS')) send('  ✓ Database already exists');
      else if (stdout.includes('DB_CREATED')) send('  ✓ Database created');

      try { fs.unlinkSync(scriptPath); } catch {}

      return { ok: true, results };
    } catch (e) {
      send('  ⚠ Database setup failed — dashboard will use JSON storage');
      return { ok: false, results, error: e.message };
    }
  });

  ipcMain.handle('install-services', async (_, { nodeDir }) => {
    const user = os.userInfo().username;
    const home = os.homedir();
    const actualNodeDir = nodeDir || DEFAULT_NODE_DIR;
    const results = [];
    const send = (msg) => {
      results.push(msg);
      if (setupWindow) setupWindow.webContents.send('install-log', msg);
    };

    try {
      // Ensure logs directory exists for the node service
      const logsDir = path.join(actualNodeDir, 'logs');
      try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}

      // Generate service files
      send('Generating service files...');

      // IMPORTANT: Do path-specific replacements BEFORE username replacement
      // otherwise YOUR_USERNAME is already gone and path regexes won't match
      const nodeService = fs.readFileSync(path.join(RUNTIME_DIR, 'hyve-node.service'), 'utf8')
        .replace(/\/home\/YOUR_USERNAME\/\.config\/hyve-node/g, actualNodeDir)
        .replace(/YOUR_USERNAME/g, user);
      fs.writeFileSync('/tmp/hyve-node.service.tmp', nodeService);

      const dashService = fs.readFileSync(path.join(RUNTIME_DIR, 'hyve-dashboard.service'), 'utf8')
        .replace(/\/home\/YOUR_USERNAME\/hyve-node-app/g, RUNTIME_DIR)
        .replace(/YOUR_USERNAME/g, user);
      fs.writeFileSync('/tmp/hyve-dashboard.service.tmp', dashService);

      send('  ✓ Service files generated');

      // Install (requires elevated privileges)
      // Use pkexec for graphical auth dialog, fall back to sudo (cached credentials)
      send('Installing services (authentication required)...');
      
      // Write a single install script so the user only has to authenticate once
      const installScript = `#!/bin/bash
set -e
cp /tmp/hyve-node.service.tmp /etc/systemd/system/hyve-node.service
cp /tmp/hyve-dashboard.service.tmp /etc/systemd/system/hyve-dashboard.service
chmod 644 /etc/systemd/system/hyve-node.service /etc/systemd/system/hyve-dashboard.service
systemctl daemon-reload
systemctl enable hyve-node.service 2>/dev/null || true
systemctl enable hyve-dashboard.service 2>/dev/null || true
`;
      const scriptPath = '/tmp/hyve-install-services.sh';
      fs.writeFileSync(scriptPath, installScript, { mode: 0o755 });

      try {
        // Try pkexec first (graphical password dialog)
        await runCommand(`pkexec "${scriptPath}"`, { timeout: 120000 });
      } catch {
        // Fall back to sudo (works if credentials are cached)
        await runCommand(`sudo "${scriptPath}"`, { timeout: 120000 });
      }
      send('  ✓ Services installed and enabled');

      // Clean up
      try {
        fs.unlinkSync('/tmp/hyve-node.service.tmp');
        fs.unlinkSync('/tmp/hyve-dashboard.service.tmp');
        fs.unlinkSync('/tmp/hyve-install-services.sh');
      } catch {}

      return { ok: true, results };
    } catch (e) {
      return { ok: false, results, error: e.message || e.stderr };
    }
  });

  ipcMain.handle('start-services', async () => {
    const results = [];
    const send = (msg) => {
      results.push(msg);
      if (setupWindow) setupWindow.webContents.send('install-log', msg);
    };

    try {
      // Start node if not running
      try {
        await runCommand('pgrep -x hyved');
        send('  ✓ Node already running');
      } catch {
        send('Starting hyve-node...');
        try {
          await runCommand('pkexec systemctl start hyve-node.service', { timeout: 30000 });
        } catch {
          await runCommand('sudo systemctl start hyve-node.service', { timeout: 30000 });
        }
        send('  ✓ Node started — waiting for initialization...');
        await new Promise(r => setTimeout(r, 8000));
      }

      // Start dashboard
      send('Starting hyve-dashboard...');
      try {
        await runCommand('pkexec systemctl start hyve-dashboard.service', { timeout: 30000 });
      } catch {
        await runCommand('sudo systemctl start hyve-dashboard.service', { timeout: 30000 });
      }
      send('  ✓ Dashboard started');

      await new Promise(r => setTimeout(r, 3000));

      // Check if accessible
      const up = await checkPort(DASHBOARD_PORT);
      if (up) send('  ✓ Dashboard is accessible on port ' + DASHBOARD_PORT);
      else send('  ⚠ Dashboard started but not responding yet (may need a moment)');

      // Get admin password
      let password = null;
      try {
        const { stdout } = await runCommand(
          `sudo journalctl -u hyve-dashboard --no-pager -n 100 2>/dev/null | grep -oP 'Admin password: \\K.+' | tail -1`
        );
        if (stdout) password = stdout.trim();
      } catch {}
      // Also try without sudo (works if user has journal read access)
      if (!password) {
        try {
          const { stdout } = await runCommand(
            `journalctl -u hyve-dashboard --no-pager -n 100 2>/dev/null | grep -oP 'Admin password: \\K.+' | tail -1`
          );
          if (stdout) password = stdout.trim();
        } catch {}
      }
      // Last resort: check the auth file directly
      if (!password) {
        try {
          const authPath = path.join(RUNTIME_DIR, '.auth.json');
          if (fs.existsSync(authPath)) {
            send('  ℹ Auth file found — password was printed to service log on first start');
          }
        } catch {}
      }

      return { ok: true, results, password };
    } catch (e) {
      return { ok: false, results, error: e.message || e.stderr };
    }
  });

  ipcMain.handle('mark-setup-complete', () => {
    fs.writeFileSync(SETUP_MARKER, new Date().toISOString());
    return { ok: true };
  });

  ipcMain.handle('open-dashboard', async () => {
    if (setupWindow) {
      setupWindow.close();
      setupWindow = null;
    }
    const ok = await startBackend();
    if (ok) createMainWindow();
    return { ok };
  });

  ipcMain.handle('open-external', (_, url) => {
    // Allow localhost and https URLs (for block explorers, docs, etc.)
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });
}

// ── App Lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  registerIPC();
  createTray();

  if (isSetupDone()) {
    showDashboard();
  } else {
    createSetupWindow();
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray on Linux — don't quit when windows close
  if (isQuitting) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
});

app.on('activate', () => {
  if (!mainWindow && !setupWindow) {
    if (isSetupDone()) showDashboard();
    else createSetupWindow();
  }
});
