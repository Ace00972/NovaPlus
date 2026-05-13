const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow
let splashWindow
let fileToOpen = null

// Catch file passed via command line (right-click > Open with)
const openFilePath = process.argv.find(arg =>
  /\.(mp4|mkv|avi|mov|wmv|mp3|flac|wav|ogg|m4a)$/i.test(arg)
)
if (openFilePath) fileToOpen = openFilePath

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  splashWindow.loadFile('splash.html')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'logo.png'),
    show: false,
    frame: false,
    backgroundColor: '#080b14',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.loadFile('index.html')

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow) { splashWindow.close(); splashWindow = null }
      mainWindow.show()
      if (fileToOpen) { mainWindow.webContents.send('open-file', fileToOpen); fileToOpen = null }
    }, 3000)
  })

  // Notify renderer of maximize state changes
  mainWindow.on('maximize', () => mainWindow.webContents.send('win-maximized'))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win-unmaximized'))
}

app.whenReady().then(() => {
  createSplash()
  createWindow()
})

// Handle file opened while app is already running
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (mainWindow) {
    mainWindow.webContents.send('open-file', filePath)
  } else {
    fileToOpen = filePath
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Helper to read files from folder
function readFolder(folder, exts) {
  return fs.readdirSync(folder)
    .filter(f => exts.includes(path.extname(f).toLowerCase()))
    .map(f => ({ name: f, path: path.join(folder, f) }))
}

// Open folder dialogs
ipcMain.on('open-folder', async (event) => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (!result.canceled) {
    const folder = result.filePaths[0]
    const files = readFolder(folder, ['.mp4', '.mkv', '.avi', '.mov', '.wmv'])
    event.reply('folder-selected', files, folder)
  }
})

ipcMain.on('load-folder', (event, folder) => {
  try {
    const files = readFolder(folder, ['.mp4', '.mkv', '.avi', '.mov', '.wmv'])
    event.reply('folder-loaded', files)
  } catch (e) {}
})

ipcMain.on('open-music-folder', async (event) => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (!result.canceled) {
    const folder = result.filePaths[0]
    const files = readFolder(folder, ['.mp3', '.flac', '.wav', '.ogg', '.m4a'])
    event.reply('music-folder-selected', files, folder)
  }
})

ipcMain.on('load-music-folder', (event, folder) => {
  try {
    const files = readFolder(folder, ['.mp3', '.flac', '.wav', '.ogg', '.m4a'])
    event.reply('music-folder-loaded', files)
  } catch (e) {}
})
// Window controls
ipcMain.on('win-minimize', () => mainWindow.minimize())
ipcMain.on('win-maximize', () => { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize() })
ipcMain.on('win-close', () => mainWindow.close())
// Subtitle file picker
ipcMain.on('open-subtitle', async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Subtitle Files', extensions: ['srt', 'sub', 'ass', 'ssa'] }]
  })
  if (!result.canceled) event.reply('subtitle-selected', result.filePaths[0])
})