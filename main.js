// Desktop app window (Electron). Starts the Draft Coach server in-process and shows its page.
const { app, BrowserWindow, ipcMain, screen, clipboard } = require("electron");
const path = require("path");

if (!app.requestSingleInstanceLock()) app.quit();
else {
  let win = null, hud = null, compact = false, fullBounds = null, hiddenForGame = false;
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  // Compact mode starts in the empty strip at the right edge of Dota's hero-selection screen
  // (right of the hero details panel: about 196px wide on a 1920px-wide screen).
  // Once the user moves or resizes the compact window, that placement is remembered instead.
  const fs = require("fs");
  const placeFile = path.join(app.getPath("userData"), "compact-bounds.json");
  let savedCompact = null;
  try { savedCompact = JSON.parse(fs.readFileSync(placeFile, "utf8")); } catch {}
  const rememberCompact = () => {
    if (!compact || !win || win.isMinimized()) return;
    savedCompact = win.getBounds();
    try { fs.writeFileSync(placeFile, JSON.stringify(savedCompact)); } catch {}
  };
  const onScreen = (r) => screen.getAllDisplays().some((d) =>
    r.x < d.bounds.x + d.bounds.width - 40 && r.x + r.width > d.bounds.x + 40 && r.y >= d.bounds.y - 10 && r.y < d.bounds.y + d.bounds.height - 40);
  const compactBounds = () => {
    if (savedCompact && onScreen(savedCompact)) return savedCompact;
    const b = screen.getPrimaryDisplay().bounds, k = b.width / 1920;
    const width = Math.floor(196 * k), y = b.y + Math.round(178 * k);
    return { x: b.x + b.width - width - 1, y, width, height: b.y + b.height - y - Math.round(8 * k) };
  };

  app.whenReady().then(async () => {
    const gsiSetup = require("./gsi-install").installGsi();   // first run: tell Dota to report to this app
    const { ready, PORT } = require("./server");
    await ready;
    ipcMain.handle("gsi-setup", () => gsiSetup);
    const area = screen.getPrimaryDisplay().workArea;
    const width = 440, top = 150;
    win = new BrowserWindow({
      width, height: Math.min(900, area.height - top), minWidth: 170, minHeight: 300,
      x: area.x + area.width - width, y: area.y + top,
      backgroundColor: "#05050f", title: "Draft Coach",
      frame: false, alwaysOnTop: true, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, "preload.js") },
    });
    win.setAlwaysOnTop(true, "screen-saver"); // stay above a borderless-windowed game
    // keep this window out of screen captures, so it can never hide the draft bar from the reader
    win.setContentProtection(true);
    win.loadURL(`http://127.0.0.1:${PORT}/`);

    // In a match: a tiny see-through window with the live numbers and the pop-up alerts.
    // It is click-through except over its strip, and never takes focus away from the game.
    const hudFile = path.join(app.getPath("userData"), "hud-pos.json");
    const pb = screen.getPrimaryDisplay().bounds, hk = pb.width / 1920;
    let hudPos = { x: pb.x + pb.width - 330, y: pb.y + Math.round(70 * hk) };
    try { const p = JSON.parse(fs.readFileSync(hudFile, "utf8")); if (onScreen({ ...p, width: 320, height: 180 })) hudPos = p; } catch {}
    hud = new BrowserWindow({
      width: 320, height: 180, x: hudPos.x, y: hudPos.y, show: false,
      frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true, focusable: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, "preload.js"), backgroundThrottling: false },
    });
    hud.setAlwaysOnTop(true, "screen-saver");
    hud.setIgnoreMouseEvents(true, { forward: true });
    hud.loadURL(`http://127.0.0.1:${PORT}/hud`);
    hud.on("moved", () => { const b = hud.getBounds(); try { fs.writeFileSync(hudFile, JSON.stringify({ x: b.x, y: b.y })); } catch {} });
    ipcMain.on("hud-live", (_e, on) => {
      if (on) { hud.showInactive(); if (win.isVisible()) { win.hide(); hiddenForGame = true; } }
      else { hud.hide(); if (hiddenForGame) { win.show(); hiddenForGame = false; } }
    });
    ipcMain.on("hud-mouse", (_e, inside) => hud.setIgnoreMouseEvents(!inside, { forward: true }));
    ipcMain.on("hud-toggle-main", () => { hiddenForGame = false; if (win.isVisible()) win.hide(); else win.showInactive(); });
    win.on("closed", () => app.quit());

    ipcMain.on("pin", (_e, on) => win.setAlwaysOnTop(!!on, "screen-saver"));
    ipcMain.on("opacity", (_e, v) => { const o = Math.min(1, Math.max(0.3, +v || 1)); win.setOpacity(o); hud.setOpacity(o); });
    ipcMain.on("mode", (_e, mode) => {
      const want = mode === "compact";
      if (want === compact) return;
      if (want) { fullBounds = win.getBounds(); win.setBounds(compactBounds()); compact = true; }
      else { rememberCompact(); compact = false; if (fullBounds) win.setBounds(fullBounds); }
    });
    win.on("moved", rememberCompact);
    win.on("resized", rememberCompact);
    win.on("close", rememberCompact);
    ipcMain.on("copy", (_e, text) => clipboard.writeText(String(text).slice(0, 100)));
    ipcMain.on("minimize", () => win.minimize());
    ipcMain.on("close", () => win.close());
  });
  app.on("window-all-closed", () => app.quit());
}
