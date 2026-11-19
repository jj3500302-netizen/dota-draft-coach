// Daily hero-stats update: pulls the newest ranked matches from OpenDota into matches.jsonl,
// drops matches older than KEEP_DAYS, and keeps a log so the app can show what each update did.
const fs = require("fs");
const path = require("path");
const { DATA } = require("./paths");

const FILE = path.join(DATA, "matches.jsonl");
const LOG = path.join(DATA, "update-log.json");
const MIN_RANK = 50;          // Legend and above, same as collect.js
const MAX_CALLS = +process.env.DRAFTCOACH_UPDATE_CALLS || 400;        // up to ~40k matches per update, about 8 minutes
const KEEP_DAYS = 30;         // older matches are dropped so the stats follow the current patch
const EVERY_MS = 20 * 3600e3; // "daily", with some slack so a fixed daily play time still triggers it

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let log = { runs: [] };
try { log = JSON.parse(fs.readFileSync(LOG, "utf8")); } catch {}
let running = null;            // live progress of the current update
const listeners = new Set();
const emit = () => listeners.forEach((f) => { try { f(); } catch {} });

function scanFile() {
  let total = 0, newestId = 0, oldestT = Infinity, newestT = 0;
  if (fs.existsSync(FILE)) for (const line of fs.readFileSync(FILE, "utf8").split("\n")) {
    if (!line) continue;
    try { const m = JSON.parse(line); total++; newestId = Math.max(newestId, m.id); oldestT = Math.min(oldestT, m.t); newestT = Math.max(newestT, m.t); } catch {}
  }
  return { total, newestId, oldestT: total ? oldestT : null, newestT: total ? newestT : null };
}
let info = scanFile();

const lastOk = () => [...log.runs].reverse().find((r) => r.ok);
function state() {
  const ok = lastOk();
  return {
    running, total: info.total, oldestT: info.oldestT, newestT: info.newestT, keepDays: KEEP_DAYS,
    lastOk: ok ? ok.at : null, nextAt: ok ? ok.at + EVERY_MS : Date.now(),
    runs: log.runs.slice(-14),
  };
}

async function getJson(url) {
  for (let tries = 0; tries < 4; tries++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) { await sleep(60000); continue; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return { page: await res.json(), left: res.headers.get("x-rate-limit-remaining-day") };
    } catch (e) { if (tries === 3) throw e; await sleep(5000); }
  }
  throw new Error("rate limited");
}

// walk back from the newest public match until we reach what we already have
async function run(reason = "auto") {
  if (running) return;
  const started = Date.now();
  running = { started, calls: 0, added: 0, reason };
  emit();
  const entry = { at: started, reason, added: 0, removed: 0, ok: false };
  try {
    const known = info.newestId;
    let below = null, lines = [], reached = false;
    for (let i = 0; i < MAX_CALLS; i++) {
      const url = `https://api.opendota.com/api/publicMatches?min_rank=${MIN_RANK}` + (below ? `&less_than_match_id=${below}` : "");
      const { page, left } = await getJson(url);
      running.calls++;
      if (!page.length) break;
      for (const m of page) {
        if (m.match_id <= known) { reached = true; continue; }
        const ok = m.duration >= 900 && [22, 1, 2].includes(m.game_mode) &&
          m.radiant_team?.length === 5 && m.dire_team?.length === 5 &&
          m.radiant_team.every((h) => h > 0) && m.dire_team.every((h) => h > 0);
        if (ok) lines.push(JSON.stringify({ id: m.match_id, rw: m.radiant_win ? 1 : 0, r: m.radiant_team, d: m.dire_team, rank: m.avg_rank_tier, t: m.start_time }));
      }
      running.added = lines.length;
      emit();
      below = Math.min(...page.map((m) => m.match_id));
      const oldest = Math.min(...page.map((m) => m.start_time));
      if (reached || oldest < Date.now() / 1000 - KEEP_DAYS * 86400) break;
      if (left !== null && +left < 100) { entry.note = "daily-limit"; break; }
      await sleep(1100);
    }
    // keep the file in time order: old lines that are still recent enough, then the new ones (newest last)
    const cutoff = Date.now() / 1000 - KEEP_DAYS * 86400;
    const keep = [];
    if (fs.existsSync(FILE)) for (const line of fs.readFileSync(FILE, "utf8").split("\n")) {
      if (!line) continue;
      try { if (JSON.parse(line).t >= cutoff) keep.push(line); else entry.removed++; } catch {}
    }
    lines.reverse();
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", keep.concat(lines).join("\n") + "\n");
    fs.renameSync(FILE + ".tmp", FILE);
    entry.added = lines.length;
    entry.gap = !reached && !!known;   // more new matches than one update can fetch
    entry.ok = true;
  } catch (e) {
    entry.error = e.message;
  }
  info = scanFile();
  entry.total = info.total;
  entry.secs = Math.round((Date.now() - started) / 1000);
  log.runs.push(entry);
  log.runs = log.runs.slice(-60);
  try { fs.writeFileSync(LOG, JSON.stringify(log)); } catch {}
  running = null;
  emit();
  return entry;
}

// check every 10 minutes whether a day has passed; wait while the player is drafting or in a game
function schedule(isBusy = () => false) {
  const check = () => {
    if (running || isBusy()) return;
    const ok = lastOk(), failed = log.runs.at(-1);
    if (failed && !failed.ok && Date.now() - failed.at < 3600e3) return;   // retry failures hourly
    if (!ok || Date.now() - ok.at >= EVERY_MS) run("auto");
  };
  setTimeout(check, 60e3);
  setInterval(check, 600e3);
}

module.exports = { run, state, schedule, onChange: (f) => listeners.add(f) };
