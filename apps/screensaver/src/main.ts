import { app, BrowserWindow, screen, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Disable GPU hardware acceleration to prevent AMDGPU trap int3 crashes
// on Mini PCs with AMD iGPUs. Software rendering is fine for a screensaver.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let startX = 0;
let startY = 0;
let mouseCheckInterval: ReturnType<typeof setInterval> | null = null;

function createWindow() {
  const win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Exit on keyboard input
  win.webContents.on("before-input-event", () => {
    app.quit();
  });

  // IPC quit from renderer (click)
  ipcMain.on("quit", () => {
    app.quit();
  });

  // Record initial cursor position
  const cursor = screen.getCursorScreenPoint();
  startX = cursor.x;
  startY = cursor.y;

  // Poll cursor — quit if moved more than 5px
  mouseCheckInterval = setInterval(() => {
    const pos = screen.getCursorScreenPoint();
    const dx = pos.x - startX;
    const dy = pos.y - startY;
    if (Math.sqrt(dx * dx + dy * dy) > 5) {
      app.quit();
    }
  }, 100);
}

app.whenReady().then(createWindow);

app.on("will-quit", () => {
  if (mouseCheckInterval) clearInterval(mouseCheckInterval);
});

app.on("window-all-closed", () => {
  app.quit();
});
