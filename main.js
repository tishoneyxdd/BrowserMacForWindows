const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true, // Ensure this is true
      enableRemoteModule: false,
      webviewTag: true,
    },
  });

  win.loadFile('index.html');
  // Uncomment this line to open DevTools for debugging
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

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

// Handle window control actions
ipcMain.on('window-close', () => {
  console.log("Window close received");
  win.close();
});

ipcMain.on('window-minimize', () => {
  console.log("Window minimize received");
  win.minimize();
});

ipcMain.on('window-toggle-maximize', () => {
  console.log("Window maximize/restore received");
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});