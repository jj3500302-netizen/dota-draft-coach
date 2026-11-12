// Fast screen capture on Windows: one long-lived PowerShell process grabs the top strip
// of the primary screen (where the draft bar is) on request and returns it as PNG.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const OUT = path.join(os.tmpdir(), "draftcoach-capture.png");
const SCRIPT = path.join(os.tmpdir(), "draftcoach-capture.ps1");
const PS = `
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][W.U]::SetProcessDPIAware()
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$h = [int][Math]::Ceiling($b.Width / 1920 * 132)
$bmp = New-Object System.Drawing.Bitmap $b.Width, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
while (($line = [Console]::In.ReadLine()) -ne $null) {
  try {
    $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
    $bmp.Save('${OUT.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
    [Console]::Out.WriteLine('ok')
  } catch { [Console]::Out.WriteLine('err ' + $_.Exception.Message) }
}
`;

let proc = null, waiting = [], buf = "";
function start() {
  fs.writeFileSync(SCRIPT, PS);
  proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  proc.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line !== "ok" && !line.startsWith("err")) continue;
      const w = waiting.shift();
      if (!w) continue;
      if (line === "ok") w.resolve(fs.readFileSync(OUT)); else w.reject(new Error(line));
    }
  });
  proc.on("exit", () => { proc = null; for (const w of waiting.splice(0)) w.reject(new Error("capture process exited")); });
}

function captureTopStrip() {
  if (!proc) start();
  return new Promise((resolve, reject) => { waiting.push({ resolve, reject }); proc.stdin.write("cap\n"); });
}

function stop() { if (proc) proc.stdin.end(); }

module.exports = { captureTopStrip, stop };
