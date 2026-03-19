const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const wrapped = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('electronAPI', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximizeToggle: () => ipcRenderer.send('window:maximize-toggle'),
    close: () => ipcRenderer.send('window:close')
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version')
  },
  browser: {
    openExternal: (url) => ipcRenderer.invoke('browser:open-external', url)
  },
  downloads: {
    list: () => ipcRenderer.invoke('downloads:list'),
    showInFolder: (downloadId) => ipcRenderer.invoke('downloads:show-in-folder', downloadId),
    clearFinished: () => ipcRenderer.invoke('downloads:clear-finished'),
    onCreated: (callback) => subscribe('downloads:created', callback),
    onUpdated: (callback) => subscribe('downloads:updated', callback),
    onDone: (callback) => subscribe('downloads:done', callback)
  },
  storage: {
    exportJson: (defaultFileName, data) => ipcRenderer.invoke('storage:export-json', defaultFileName, data),
    importJson: () => ipcRenderer.invoke('storage:import-json')
  }
});
