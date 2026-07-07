const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    minimize:     () => ipcRenderer.send('window-minimize'),
    maximize:     () => ipcRenderer.send('window-maximize'),
    close:        () => ipcRenderer.send('window-close'),
    selectFolder: () => ipcRenderer.invoke('dialog:openDirectory'),
    selectFile:   (filters) => ipcRenderer.invoke('dialog:openFile', filters),
    scanMedia:    (p) => ipcRenderer.invoke('media:scan', p),
    toMediaUrl:   (p) => `nova-media://${p}`,

    // Microsoft Store IAP — Four Seasons Pack
    checkSeasonsBundleOwned: () => ipcRenderer.invoke('iap:checkSeasonsBundle'),
    purchaseSeasonsBundle:   () => ipcRenderer.invoke('iap:purchaseSeasonsBundle'),

    // Resolves a drag-and-dropped File object to its real filesystem path.
    // Required in Electron builds with contextIsolation: true where
    // file.path is no longer populated in the renderer process.
    getPathForFile: (file) => {
        try {
            if (webUtils && typeof webUtils.getPathForFile === 'function') {
                return webUtils.getPathForFile(file);
            }
        } catch(e) {}
        // Fallback for older Electron versions that still populate file.path
        return file.path || null;
    },

    // PiP Actions (renderer/pip -> main)
    pipOpen:   (info) => ipcRenderer.send('pip-open', info),
    pipTime:   (data) => ipcRenderer.send('pip-time', data),
    pipState:  (playing) => ipcRenderer.send('pip-state', playing),
    pipCmd:    (cmd)  => ipcRenderer.send('pip-cmd', cmd),

    // Listeners: main -> main window
    onPipCmd:               (cb) => ipcRenderer.on('pip-cmd',               (e, cmd)     => cb(cmd)),
    onPipClosed:            (cb) => ipcRenderer.on('pip-window-closed',     ()           => cb()),
    onMainWindowMinimized:  (cb) => ipcRenderer.on('main-window-minimized', ()           => cb()),
    onPipExpanded:          (cb) => ipcRenderer.on('pip-expanded',          ()           => cb()),

    // Listeners: main -> pip window
    onPipTrack: (cb) => ipcRenderer.on('pip-track', (e, track)   => cb(track)),
    onPipTime:  (cb) => ipcRenderer.on('pip-time',  (e, data)    => cb(data)),
    onPipState: (cb) => ipcRenderer.on('pip-state', (e, playing) => cb(playing)),
});