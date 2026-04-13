const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hyve', {
  getDefaults:      ()          => ipcRenderer.invoke('get-defaults'),
  checkSystem:      ()          => ipcRenderer.invoke('check-system'),
  installSystemDeps:(opts)      => ipcRenderer.invoke('install-system-deps', opts),
  checkNode:        (dir)       => ipcRenderer.invoke('check-node', dir),
  installDeps:      ()          => ipcRenderer.invoke('install-deps'),
  saveConfig:       (cfg)       => ipcRenderer.invoke('save-config', cfg),
  setupDatabase:    ()          => ipcRenderer.invoke('setup-database'),
  installServices:  (cfg)       => ipcRenderer.invoke('install-services', cfg),
  startServices:    ()          => ipcRenderer.invoke('start-services'),
  markSetupComplete:()          => ipcRenderer.invoke('mark-setup-complete'),
  openDashboard:    ()          => ipcRenderer.invoke('open-dashboard'),
  openExternal:     (url)       => ipcRenderer.invoke('open-external', url),
  onInstallLog:     (cb)        => ipcRenderer.on('install-log', (_, msg) => cb(msg)),
});
