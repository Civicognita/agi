const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("screensaver", {
  quit: () => ipcRenderer.send("quit"),
  gatewayUrl: "http://localhost:3100",
  wsUrl: "ws://localhost:3100/ws",
});
