// Dota 2 GSI test logger: records what Dota sends, especially during the draft.
// Run: node gsi-logger.js   (listens on http://127.0.0.1:3007)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3007;
const TOKEN = "draftcoach-local";
const LOG = path.join(__dirname, "gsi-log.jsonl");

let last = "";
let count = 0;

http
  .createServer((req, res) => {
    if (req.method !== "POST") { res.end("GSI logger running"); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.end("ok");
      let data;
      try { data = JSON.parse(body); } catch { return; }
      if (data?.auth?.token !== TOKEN) return;
      delete data.auth;
      // ignore the clock-only changes so the log stays small
      const sig = JSON.stringify({ ...data, provider: undefined, map: data.map && { ...data.map, clock_time: 0, game_time: 0 } });
      if (sig === last) return;
      last = sig;
      count++;
      fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...data }) + "\n");
      const state = data.map?.game_state ?? "(no map)";
      const keys = Object.keys(data).join(",");
      console.log(`#${count} ${new Date().toLocaleTimeString()} state=${state} keys=[${keys}]`);
      if (data.draft) console.log("  draft:", JSON.stringify(data.draft).slice(0, 400));
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`GSI logger on http://127.0.0.1:${PORT} -> ${LOG}`));
