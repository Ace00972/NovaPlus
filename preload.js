const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    
    // File System
    selectFolder: () => ipcRenderer.invoke('dialog:openDirectory'),
    scanMedia: (path) => ipcRenderer.invoke('media:scan', path),
    
    // Helpers
    toMediaUrl: (filePath) => `nova-media://${filePath}`
});
