const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const { scanDirectory } = require('./src/scanner');

// ── Microsoft Store IAP bridge (Four Seasons Pack) ──────────────────────
// Windows.Services.Store is a WinRT API — Electron can't call it directly
// from renderer JS, so we load it here in the main process via NodeRT
// (a native Node addon that exposes WinRT namespaces) and relay results to
// the renderer over IPC. This ONLY works when the app is running with a
// package identity (i.e. installed as the .appx via the Microsoft Store
// or sideloaded) — it will not work when running unpackaged with
// `npm start`. Falls back gracefully to "unavailable" in that case.
//
// Install with:  npm install @nodert-win10-rs4/windows.services.store
// Then rebuild native modules for Electron's ABI: npx electron-rebuild
// IMPORTANT: RequestPurchaseAsync() and the add-on license lookup both key
// off the Store ID (e.g. "9NL9941Z13B3", shown on the add-on's Overview page
// in Partner Center) — NOT the "Product ID" string you typed in when first
// creating the add-on. That Product ID is a separate, less commonly used
// identifier (InAppOfferToken) that only matters if you're searching a large
// catalog of add-ons by hand. Get the Store ID from:
// Partner Center → NovaPlus → Add-ons → [your add-on] → Overview → "Store ID"
const FOUR_SEASONS_STORE_ID = '9NL9941Z13B3'; // FourSeasonsPack add-on Store ID
const ANIME_PACK_STORE_ID = '9NJZVH1NG5L5'; // fill in once that add-on is created

let StoreContext = null;
try {
    ({ StoreContext } = require('@nodert-win10-rs4/windows.services.store'));
} catch (e) {
    console.warn('[Store IAP] Windows.Services.Store bindings not available (expected when running unpackaged).');
}

let storeContextInstance = null;

function getStoreContext() {
    if (!StoreContext) return null;
    if (storeContextInstance) return storeContextInstance;
    try {
        storeContextInstance = StoreContext.getDefault();
        // Desktop Bridge / Win32 apps (which is what an Electron .appx is) must
        // tell StoreContext which window owns its modal purchase dialogs, via
        // IInitializeWithWindow — otherwise RequestPurchaseAsync can silently
        // return "NotPurchased" with no dialog and no error at all.
        // This call depends on the installed NodeRT package actually exposing
        // this COM interop method — verify against your installed version;
        // if it's missing, the purchase call may need a small native addon
        // instead. See: https://aka.ms/storecontext-for-desktop
        if (mainWindow && typeof storeContextInstance.initializeWithWindow === 'function') {
            const hwndBuffer = mainWindow.getNativeWindowHandle();
            storeContextInstance.initializeWithWindow(hwndBuffer);
        } else {
            console.warn('[Store IAP] Could not set owner window on StoreContext — purchase dialog may not appear. See aka.ms/storecontext-for-desktop.');
        }
    } catch (e) {
        console.error('[Store IAP] Failed to get StoreContext:', e);
        storeContextInstance = null;
    }
    return storeContextInstance;
}

ipcMain.handle('iap:checkSeasonsBundle', async () => {
    const context = getStoreContext();
    if (!context) return { available: false, owned: false };
    try {
        const license = await new Promise((resolve, reject) => {
            context.getAppLicenseAsync((err, result) => err ? reject(err) : resolve(result));
        });
        const addOnLicense = license.addOnLicenses.lookup(FOUR_SEASONS_STORE_ID);
        return { available: true, owned: !!(addOnLicense && addOnLicense.isActive) };
    } catch (e) {
        console.error('[Store IAP] License check failed:', e);
        return { available: true, owned: false, error: String(e) };
    }
});

ipcMain.handle('iap:purchaseSeasonsBundle', async () => {
    const context = getStoreContext();
    if (!context) return { success: false, reason: 'store-unavailable' };
    try {
        const result = await new Promise((resolve, reject) => {
            context.requestPurchaseAsync(FOUR_SEASONS_STORE_ID, (err, res) => err ? reject(err) : resolve(res));
        });
        // StorePurchaseStatus: 0 Succeeded, 1 AlreadyPurchased, 2 NotPurchased, 3 NetworkError, 4 ServerError
        const success = result.status === 0 || result.status === 1;
        return { success, status: result.status };
    } catch (e) {
        console.error('[Store IAP] Purchase request failed:', e);
        return { success: false, error: String(e) };
    }
});

ipcMain.handle('iap:checkAnimeBundle', async () => {
    const context = getStoreContext();
    if (!context) return { available: false, owned: false };
    try {
        const license = await new Promise((resolve, reject) => {
            context.getAppLicenseAsync((err, result) => err ? reject(err) : resolve(result));
        });
        const addOnLicense = license.addOnLicenses.lookup(ANIME_PACK_STORE_ID);
        return { available: true, owned: !!(addOnLicense && addOnLicense.isActive) };
    } catch (e) {
        console.error('[Store IAP] License check failed:', e);
        return { available: true, owned: false, error: String(e) };
    }
});

ipcMain.handle('iap:purchaseAnimeBundle', async () => {
    const context = getStoreContext();
    if (!context) return { success: false, reason: 'store-unavailable' };
    try {
        const result = await new Promise((resolve, reject) => {
            context.requestPurchaseAsync(ANIME_PACK_STORE_ID, (err, res) => err ? reject(err) : resolve(res));
        });
        const success = result.status === 0 || result.status === 1;
        return { success, status: result.status };
    } catch (e) {
        console.error('[Store IAP] Purchase request failed:', e);
        return { success: false, error: String(e) };
    }
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