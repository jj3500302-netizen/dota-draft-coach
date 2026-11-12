// OpenDota client: one request at a time with a gap (free limit is 60/min), plus a disk cache.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BASE = "https://api.opendota.com/api";
const DIR = path.join(__dirname, "data", "od-cache");
const GAP_MS = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chain = Promise.resolve(), lastAt = 0, used = 0;
function turn() {
  const p = chain.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now(); used++;
  });
  chain = p.catch(() => {});
  return p;
}

const fileFor = (url) => path.join(DIR, crypto.createHash("md5").update(url).digest("hex") + ".json");
function readCache(url) {
  try {
    const f = fileFor(url);
    return { at: fs.statSync(f).mtimeMs, data: JSON.parse(fs.readFileSync(f, "utf8")) };
  } catch { return null; }
}
function writeCache(url, data) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(fileFor(url), JSON.stringify(data)); } catch {}
}

// ttl: how old a cached answer may be (ms). keep(data): true if a cached answer never needs refreshing.
async function get(url, { ttl = 3600e3, keep = null } = {}) {
  const c = readCache(url);
  if (c && (Date.now() - c.at < ttl || (keep && keep(c.data)))) return c.data;
  for (let attempt = 0; attempt < 3; attempt++) {
    await turn();
    let r;
    try { r = await fetch(BASE + url); } catch (e) { if (c) return c.data; throw e; }
    if (r.status === 429 || r.status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`OpenDota ${r.status} ${url}`);
    const data = await r.json();
    writeCache(url, data);
    return data;
  }
  if (c) return c.data;
  throw new Error(`OpenDota busy: ${url}`);
}

async function post(url) {
  await turn();
  try { const r = await fetch(BASE + url, { method: "POST" }); return r.ok ? await r.json() : null; } catch { return null; }
}

module.exports = { get, post, usedToday: () => used };
