// Puts the Game State Integration config into Dota 2's cfg folder if it is not there yet,
// so the app works without a manual setup step. Returns "installed" | "present" | "notfound" | "failed".
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const NAME = "gamestate_integration_draftcoach.cfg";

function steamLibraries() {
  const libs = [];
  for (const [key, val] of [["HKCU\\Software\\Valve\\Steam", "SteamPath"], ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"]]) {
    try {
      const out = execSync(`reg query "${key}" /v ${val}`, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      const m = out.match(/REG_SZ\s+(.+)/);
      if (m) libs.push(path.normalize(m[1].trim()));
    } catch {}
  }
  libs.push("C:\\Program Files (x86)\\Steam");
  for (const l of [...libs]) {   // games installed in another Steam library
    try {
      const vdf = fs.readFileSync(path.join(l, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const m of vdf.matchAll(/"path"\s+"(.+?)"/g)) libs.push(path.normalize(m[1].replace(/\\\\/g, "\\")));
    } catch {}
  }
  return [...new Set(libs)];
}

function installGsi() {
  try {
    const src = fs.readFileSync(path.join(__dirname, NAME), "utf8");
    const cfg = steamLibraries().map((l) => path.join(l, "steamapps", "common", "dota 2 beta", "game", "dota", "cfg")).find((p) => fs.existsSync(p));
    if (!cfg) return "notfound";
    const dir = path.join(cfg, "gamestate_integration"), dest = path.join(dir, NAME);
    try { if (fs.readFileSync(dest, "utf8") === src) return "present"; } catch {}
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, src);
    return "installed";
  } catch (e) {
    console.error("GSI install:", e.message);
    return "failed";
  }
}

module.exports = { installGsi };
