const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { scanDirectory } = require('./src/scanner');

// ── Store IAP diagnostic log file ───────────────────────────────────────
// The installed .appx has no attached console, so main-process
// console.warn/error is invisible to us. This writes the same messages to
// a plain text file instead: %APPDATA%/novaplus/store-iap.log (path is
// logged to console too, for when you ARE running from a terminal).
// Safe to delete this whole block once IAP is confirmed working.
let iapLogPath = null;
function iapLog(...args) {
    const line = `[${new Date().toISOString()}] ${args.map(a => a instanceof Error ? a.stack : (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}\n`;
    console.log(line.trim());
    try {
        if (!iapLogPath) iapLogPath = path.join(app.getPath('userData'), 'store-iap.log');
        fs.appendFileSync(iapLogPath, line);
    } catch (e) { /* best-effort only */ }
}

// ── Microsoft Store IAP bridge (Four Seasons Pack + Anime Effects Pack) ─
// Windows.Services.Store is a WinRT API — Electron itself can't call it
// directly. The first attempt at this used a native Node addon
// (@nodert-win10-rs4/windows.services.store) to bridge it, but that
// package hadn't been updated in 5 years and wouldn't compile against a
// modern Electron/node-gyp/Visual Studio toolchain (missing Python, then
// an unrecognized VS version, then npm config incompatibilities — a
// cascade of dead ends). This version instead spawns a small separate
// C# console app (StoreHelper.exe, in /StoreHelper) that talks to
// Windows.Services.Store directly via Microsoft's actively-maintained
// CsWinRT projection — completely different toolchain (dotnet build),
// no node-gyp involved at all. It prints one line of JSON to stdout and
// exits; we just run it and parse that line.
//
// IMPORTANT: both calls key off the Store ID (e.g. "9NL9941Z13B3", shown
// on the add-on's Overview page in Partner Center) — NOT the "Product ID"
// string typed in when first creating the add-on.
const { execFile } = require('child_process');
const FOUR_SEASONS_STORE_ID = '9NL9941Z13B3'; // FourSeasonsPack add-on Store ID
const ANIME_PACK_STORE_ID = '9NJZVH1NG5L5'; // AnimeEffectsPack add-on Store ID

function getStoreHelperPath() {
    // Packaged app: StoreHelper.exe ships under resources/store-helper/
    // (see the "extraResources" entry in package.json's build config).
    // Unpackaged dev run: reads straight from the project's StoreHelper
    // publish output.
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'store-helper', 'StoreHelper.exe');
    }
    return path.join(__dirname, 'StoreHelper', 'bin', 'Release', 'net8.0-windows10.0.19041.0', 'win-x64', 'publish', 'StoreHelper.exe');
}

function runStoreHelper(args) {
    return new Promise((resolve) => {
        const exePath = getStoreHelperPath();
        execFile(exePath, args, { timeout: 30000 }, (err, stdout, stderr) => {
            // StoreHelper.exe exits with non-zero codes for legitimate,
            // non-error outcomes (user canceled, declined, etc.) while
            // still printing valid JSON to stdout. So: try to parse stdout
            // FIRST regardless of exit code, and only fall back to the
            // generic "unavailable" error if there's truly no usable JSON
            // (e.g. the exe crashed or couldn't be found at all).
            const line = (stdout || '').trim().split('\n')[0];
            try {
                const parsed = JSON.parse(line);
                iapLog('[Store IAP] StoreHelper.exe', args.join(' '), '->', parsed, err ? `(exit code present: ${err.code})` : '');
                resolve(parsed);
                return;
            } catch (e) {
                // fall through to error handling below
            }

            if (err) {
                iapLog('[Store IAP] StoreHelper.exe failed to run:', err, 'stderr:', stderr);
                resolve({ available: false, success: false, reason: 'store-helper-unavailable' });
                return;
            }

            iapLog('[Store IAP] Failed to parse StoreHelper.exe output:', line);
            resolve({ available: false, success: false, reason: 'store-helper-bad-output' });
        });
    });
}

function getOwnerHwndArg() {
    // Electron gives us the window handle as a Buffer; StoreHelper.exe
    // expects it as a plain decimal string it can parse back into a
    // native pointer via IntPtr in C#.
    try {
        if (!mainWindow) return null;
        const buf = mainWindow.getNativeWindowHandle();
        return buf.readBigUInt64LE(0).toString();
    } catch (e) {
        iapLog('[Store IAP] Could not read native window handle:', e);
        return null;
    }
}

ipcMain.handle('iap:checkSeasonsBundle', async () => {
    return await runStoreHelper(['checklicense', FOUR_SEASONS_STORE_ID]);
});

ipcMain.handle('iap:purchaseSeasonsBundle', async () => {
    const hwnd = getOwnerHwndArg();
    const args = ['purchase', FOUR_SEASONS_STORE_ID];
    if (hwnd) args.push(hwnd);
    return await runStoreHelper(args);
});

ipcMain.handle('iap:checkAnimeBundle', async () => {
    return await runStoreHelper(['checklicense', ANIME_PACK_STORE_ID]);
});

ipcMain.handle('iap:purchaseAnimeBundle', async () => {
    const hwnd = getOwnerHwndArg();
    const args = ['purchase', ANIME_PACK_STORE_ID];
    if (hwnd) args.push(hwnd);
    return await runStoreHelper(args);
});

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

ipcMain.handle('dialog:openFile', async (event, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: filters || [{ name: 'Images', extensions: ['jpg','jpeg','png','webp','gif'] }]
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