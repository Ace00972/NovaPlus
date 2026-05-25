const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const { scanDirectory } = require('./src/scanner');

// ── DEBUG: Catch any unhandled error in the main process and log it.
// These will appear in the terminal where you ran `npm start`.
// Remove these once the freeze is diagnosed.
process.on('uncaughtException', (err) => {
    console.error('═══ MAIN PROCESS UNCAUGHT EXCEPTION ═══');
    console.error(err);
});
process.on('unhandledRejection', (reason) => {
    console.error('═══ MAIN PROCESS UNHANDLED REJECTION ═══');
    console.error(reason);
});

let mainWindow;
let pipWindow;

function registerMediaProtocol() {
    protocol.registerFileProtocol('nova-media', (request, callback) => {
        const url = request.url.replace('nova-media://', '');
        try { return callback(decodeURIComponent(url)); }
        catch (e) { console.error('nova-media protocol error:', e); }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 850,
        minWidth: 900, minHeight: 600,
        frame: false, transparent: true,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });
    mainWindow.loadFile('index.html');
    mainWindow.setMenuBarVisibility(false);

    // ── DEBUG: Opens DevTools for the renderer process automatically.
    // Remove once the freeze is diagnosed.
    mainWindow.webContents.openDevTools();

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        if (details.url.includes('omdbapi.com')) {
            delete headers['Origin'];
        } else {
            headers['Origin'] = 'https://www.emailjs.com';
        }
        callback({ requestHeaders: headers });
    });

    // ── DEBUG: Log every renderer process crash with full details.
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('═══ RENDERER PROCESS GONE ═══', details);
    });
    mainWindow.webContents.on('unresponsive', () => {
        console.error('═══ RENDERER BECAME UNRESPONSIVE ═══');
    });
    mainWindow.webContents.on('responsive', () => {
        console.log('── Renderer became responsive again');
    });

    mainWindow.on('minimize', () => {
        if (mainWindow) {
            mainWindow.webContents.send('main-window-minimized');
        }
    });
}

function createPip(trackInfo) {
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.webContents.send('pip-track', trackInfo);
        pipWindow.show();
        return;
    }

    pipWindow = new BrowserWindow({
        width: 300,
        height: 185,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    pipWindow.loadFile('pip.html');

    pipWindow.webContents.on('did-finish-load', () => {
        pipWindow.webContents.send('pip-track', trackInfo);
    });

    // ── DEBUG: Log PiP renderer crashes too
    pipWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('═══ PIP RENDERER PROCESS GONE ═══', details);
    });

    pipWindow.on('closed', () => {
        pipWindow = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pip-window-closed');
        }
    });
}

// Media & Dialog Handlers
ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('media:scan', async (event, dirPath) => {
    return await scanDirectory(dirPath);
});

// IPC Communication Channels
ipcMain.on('pip-open', (event, trackInfo) => {
    createPip(trackInfo);
});

ipcMain.on('pip-time', (event, data) => {
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.webContents.send('pip-time', data);
    }
});

ipcMain.on('pip-state', (event, playing) => {
    if (pipWindow && !pipWindow.isDestroyed()) {
        pipWindow.webContents.send('pip-state', playing);
    }
});

ipcMain.on('pip-cmd', (event, cmd) => {
    if (cmd === 'close') {
        if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
    } else if (cmd === 'expand') {
        if (mainWindow) {
            mainWindow.restore();
            mainWindow.focus();
            mainWindow.webContents.send('pip-expanded');
        }
        if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
    } else {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pip-cmd', cmd);
        }
    }
});

// Window Controls
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

app.whenReady().then(() => {
    registerMediaProtocol();
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});