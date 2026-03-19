const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow;
const downloads = new Map();

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    backgroundColor: '#dbe7f3',
    title: 'Safari for Windows',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
      spellcheck: true
    }
  });

  mainWindow.loadFile('index.html');

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function setupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const id = `dl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    const payload = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: item.getSavePath(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      startedAt: Date.now()
    };

    downloads.set(id, payload);
    sendToRenderer('downloads:created', payload);

    item.on('updated', () => {
      const update = downloads.get(id);
      if (!update) {
        return;
      }

      update.receivedBytes = item.getReceivedBytes();
      update.totalBytes = item.getTotalBytes();
      update.state = item.isPaused() ? 'paused' : 'progressing';
      update.savePath = item.getSavePath();
      sendToRenderer('downloads:updated', update);
    });

    item.once('done', (_doneEvent, state) => {
      const update = downloads.get(id);
      if (!update) {
        return;
      }

      update.receivedBytes = item.getReceivedBytes();
      update.totalBytes = item.getTotalBytes();
      update.state = state;
      update.completedAt = Date.now();
      update.savePath = item.getSavePath();
      sendToRenderer('downloads:done', update);
    });
  });
}

app.whenReady().then(() => {
  createWindow();
  setupDownloads();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('window:maximize-toggle', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('browser:open-external', async (_event, url) => {
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('downloads:list', () => Array.from(downloads.values()));

ipcMain.handle('downloads:show-in-folder', (_event, downloadId) => {
  const download = downloads.get(downloadId);
  if (!download || !download.savePath) {
    return { ok: false, message: 'Download path unavailable.' };
  }

  shell.showItemInFolder(download.savePath);
  return { ok: true };
});

ipcMain.handle('downloads:clear-finished', () => {
  for (const [id, item] of downloads.entries()) {
    if (item.state !== 'progressing' && item.state !== 'paused') {
      downloads.delete(id);
    }
  }

  return Array.from(downloads.values());
});

ipcMain.handle('storage:export-json', async (_event, defaultFileName, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Browser Data',
    defaultPath: defaultFileName,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (canceled || !filePath) {
    return { ok: false, canceled: true };
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('storage:import-json', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Browser Data',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });

  if (canceled || !filePaths || !filePaths[0]) {
    return { ok: false, canceled: true };
  }

  try {
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    return { ok: true, path: filePaths[0], data: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});
