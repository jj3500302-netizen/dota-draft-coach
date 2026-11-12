const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  setPin: (on) => ipcRenderer.send("pin", on),
  setOpacity: (v) => ipcRenderer.send("opacity", v),
  setMode: (mode) => ipcRenderer.send("mode", mode),
  copy: (text) => ipcRenderer.send("copy", text),
  gsiSetup: () => ipcRenderer.invoke("gsi-setup"),
  hudLive: (on) => ipcRenderer.send("hud-live", on),
  hudMouse: (inside) => ipcRenderer.send("hud-mouse", inside),
  hudToggleMain: () => ipcRenderer.send("hud-toggle-main"),
  minimize: () => ipcRenderer.send("minimize"),
  close: () => ipcRenderer.send("close"),
});
