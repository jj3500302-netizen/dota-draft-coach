// Draft Coach server.
// - Receives Dota 2 GSI on :3007 to know when hero selection is on, which side and which slot we are.
// - During hero selection, grabs the top of the screen, reads picks + role labels, and pushes
//   the draft and pick advice to the page at http://127.0.0.1:3007/ (Server-Sent Events).
// Run: node server.js            (capture only during hero selection)
//      node server.js --always   (capture all the time, for testing)
//      node server.js --file samples/draft2.png   (read one image instead of the screen)
// Or open the desktop app: npm start
const http = require("http");
const fs = require("fs");
const path = require("path");
const { captureTopStrip } = require("./capture");
const { readDraft, loadRefs } = require("./matcher");
const advisor = require("./advisor");
const { counterItems } = require("./items");
const timings = require("./assets/timings.json");
const insights = require("./insights");

const PORT = +process.env.DRAFTCOACH_PORT || 3007;   // Dota's GSI config posts to 3007; another port is only for testing
const TOKEN = "draftcoach-local";
const INTERVAL_MS = 700;
const args = process.argv.slice(1);
const ALWAYS = args.includes("--always");
const FILE = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;

const DRAFT_STATES = new Set(["DOTA_GAMERULES_STATE_HERO_SELECTION", "DOTA_GAMERULES_STATE_STRATEGY_TIME"]);
const noRoles = () => ({ radiant: [null, null, null, null, null], dire: [null, null, null, null, null] });
const GAME_STATES = new Set(["DOTA_GAMERULES_STATE_PRE_GAME", "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"]);
let gsi = { state: null, team: null, teamSlot: null, matchid: null };
let game = null;         // live numbers during the match (clock, gpm, xpm, items...)
let history = [];        // one sample every 30s of game clock: {t, gpm, xpm, lh}
let bench = null;        // OpenDota end-of-game benchmarks for our hero
let manual = { rosh: null, torm: null };   // Roshan / Tormentor kill times the player marked (game clock)
let adviceCache = null;  // draft advice only changes when the draft or the stats change
let lastGameCast = 0;
let current = null;      // last confirmed draft
let pending = null;      // candidate draft waiting for a second identical read
let roles = noRoles();   // role labels seen under each slot this match (1-5)
const clients = new Set();

const summary = (d) => JSON.stringify([d.radiant, d.dire].map((t) => t.map((s) => (s.state === "picked" ? s.key : "-"))));

// advice for both sides and every position; the page picks the one that applies
function payload() {
  let advice = adviceCache;
  if (current && !advice) {
    const ids = (t) => t.filter((s) => s.state === "picked").map((s) => s.id);
    const R = ids(current.radiant), D = ids(current.dire);
    advice = { radiant: {}, dire: {} };
    for (let pos = 0; pos <= 5; pos++) {
      const pool = insights.getPool();
      advice.radiant[pos] = advisor.advise({ allies: R, enemies: D, pos, pool });
      advice.dire[pos] = advisor.advise({ allies: D, enemies: R, pos, pool });
    }
    adviceCache = advice;
  }
  let live = null;
  if (game && GAME_STATES.has(gsi.state)) {
    const foe = gsi.team === "radiant" ? "dire" : gsi.team === "dire" ? "radiant" : null;
    const enemies = current && foe ? current[foe].filter((s) => s.state === "picked").map((s) => ({ key: s.key, name: s.hero })) : [];
    live = { ...game, history, bench, mine: insights.baselineAt(game.heroId, game.clock), enemiesKnown: enemies.length, items: counterItems(enemies, game.owned) };
  }
  return JSON.stringify({ gsi, draft: current, roles, advice, game: live, timings, manual, me: insights.state(), capturing: ALWAYS || !!FILE || DRAFT_STATES.has(gsi.state) });
}

function broadcast() {
  const msg = `data: ${payload()}\n\n`;
  for (const res of clients) res.write(msg);
}

// new hero pool / baseline / report from OpenDota: re-send to the page
insights.onChange((what) => { if (what === "pool") adviceCache = null; broadcast(); });

function logDraft(d) {
  const fmt = (t) => t.map((s) => (s.state === "picked" ? s.hero : "·")).join(", ");
  console.log(`[${new Date().toLocaleTimeString()}] Radiant: ${fmt(d.radiant)}`);
  console.log(`${" ".repeat(13)}Dire:    ${fmt(d.dire)}${gsi.team ? `   (we are ${gsi.team})` : ""}`);
}

// percentile tables for our hero (end-of-game numbers from OpenDota), cached on disk
async function loadBench(heroId) {
  const file = path.join(__dirname, "data", `bench-${heroId}.json`);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < 7 * 864e5) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const r = await fetch(`https://api.opendota.com/api/benchmarks?hero_id=${heroId}`);
  if (!r.ok) throw new Error("benchmarks " + r.status);
  const j = (await r.json()).result;
  const out = { heroId, gpm: j.gold_per_min, xpm: j.xp_per_min, lhm: j.last_hits_per_min };
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(out)); } catch {}
  return out;
}

function readGame(data) {
  const p = data.player || {}, h = data.hero || {}, m = data.map || {};
  const owned = Object.entries(data.items || {}).filter(([slot, it]) => !slot.startsWith("neutral") && it && it.name && it.name !== "empty").map(([, it]) => it.name);
  const hero = h.id ? advisor.byId.get(h.id) : null;
  game = {
    clock: m.clock_time ?? 0, paused: !!m.paused, daytime: m.daytime !== false,
    heroId: h.id || 0, heroKey: hero ? hero.key : null, heroName: hero ? hero.name : null, level: h.level || 0,
    gpm: p.gpm || 0, xpm: p.xpm || 0, gold: p.gold || 0, netWorth: p.net_worth ?? null,
    lh: p.last_hits || 0, dn: p.denies || 0, k: p.kills || 0, d: p.deaths || 0, a: p.assists || 0,
    owned, hasItems: !!data.items,
  };
  const t = Math.floor(game.clock / 30) * 30;
  if (game.clock > 0 && (!history.length || history[history.length - 1].t < t)) history.push({ t, gpm: game.gpm, xpm: game.xpm, lh: game.lh });
  if (game.heroId) insights.baseline(game.heroId);
  if (game.heroId && (!bench || bench.heroId !== game.heroId)) {
    bench = { heroId: game.heroId };   // placeholder so we only ask once
    loadBench(game.heroId).then((b) => { bench = b; broadcast(); }).catch((e) => console.error("benchmarks:", e.message));
  }
}

let busy = false;
async function tick() {
  const active = ALWAYS || FILE || DRAFT_STATES.has(gsi.state);
  if (!active || busy) return;
  busy = true;
  try {
    const img = FILE ? fs.readFileSync(FILE) : await captureTopStrip();
    const d = await readDraft(img);
    let changed = false;
    for (const side of ["radiant", "dire"]) {
      d.roles[side].forEach((p, i) => { if (p && roles[side][i] !== p) { roles[side][i] = p; changed = true; } });
    }
    const sig = summary(d);
    // only accept a pick change after two identical reads (pick animations cause flicker)
    if (current && sig === summary(current)) pending = null;
    else if (pending && sig === pending.sig) { current = d; adviceCache = null; pending = null; logDraft(d); changed = true; }
    else pending = { sig };
    if (changed) broadcast();
  } catch (e) {
    console.error("capture error:", e.message);
  } finally {
    busy = false;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.end("ok");
      try {
        const data = JSON.parse(body);
        if (req.url === "/manual") {   // from the app's own page
          for (const k of ["rosh", "torm"]) if (k in data) manual[k] = typeof data[k] === "number" ? data[k] : null;
          return broadcast();
        }
        if (data?.auth?.token !== TOKEN) return;
        const state = data.map?.game_state ?? null;
        const team = data.player?.team_name ?? gsi.team;
        const teamSlot = data.player?.team_slot ?? gsi.teamSlot;
        const matchid = data.map?.matchid ?? null;
        if (matchid && matchid !== gsi.matchid) { current = null; adviceCache = null; pending = null; roles = noRoles(); game = null; history = []; bench = null; manual = { rosh: null, torm: null }; } // new game
        if (state !== gsi.state) console.log(`GSI: ${state ?? "menu"}`);
        const changed = state !== gsi.state || team !== gsi.team || teamSlot !== gsi.teamSlot || matchid !== gsi.matchid;
        gsi = { state, team, teamSlot, matchid };
        if (data.player && data.player.accountid) insights.setMe(data.player.accountid);
        // match over: build the report once OpenDota has it
        const ended = state === "DOTA_GAMERULES_STATE_POST_GAME" || (!state && GAME_STATES.has(gsi.state));
        if (ended && (matchid || gsi.matchid)) insights.queueReport(matchid || gsi.matchid);
        const live = GAME_STATES.has(state);
        if (live) readGame(data); else if (!state) game = null;
        // in a match, push the live numbers at most once a second
        if (changed || (live && Date.now() - lastGameCast > 950)) { lastGameCast = Date.now(); broadcast(); }
      } catch {}
    });
    return;
  }
  if (req.url.startsWith("/api/")) return api(req, res);
  if (req.url === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    clients.add(res);
    res.write(`data: ${payload()}\n\n`);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.url.startsWith("/heroes/") || req.url.startsWith("/items/")) {
    const f = path.join(__dirname, "assets", req.url.split("/")[1], path.basename(req.url));
    if (fs.existsSync(f)) {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=86400" });
      fs.createReadStream(f).pipe(res);
      return;
    }
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  fs.createReadStream(path.join(__dirname, "public", req.url === "/hud" ? "hud.html" : "index.html")).pipe(res);
});

// data for the report and players pages
async function api(req, res) {
  const send = (code, v) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(v)); };
  const u = new URL(req.url, "http://x"), parts = u.pathname.split("/").filter(Boolean);
  try {
    if (parts[1] === "matches") return send(200, await insights.myMatches());
    if (parts[1] === "report" && /^\d+$/.test(parts[2] || "")) return send(200, await insights.report(parts[2]));
    if (parts[1] === "players") return send(200, insights.metList());
    if (parts[1] === "player" && /^\d+$/.test(parts[2] || "")) return send(200, await insights.player(parts[2]));
    send(404, { error: "not found" });
  } catch (e) { send(500, { error: e.message }); }
}

const ready = new Promise((resolve) => {
  server.on("error", (e) => {
    // another copy is already running: the app window can just use that one
    if (e.code === "EADDRINUSE") { console.log(`Port ${PORT} already in use - using the running server`); resolve(false); }
    else throw e;
  });
  server.listen(PORT, "127.0.0.1", async () => {
    console.log(`Hero stats: ${advisor.build().total} matches`);
    // pick up new matches from collect.js every 10 minutes
    setInterval(() => {
      const n = advisor.build().total;
      adviceCache = null;
      if (current) broadcast();
      console.log(`Hero stats reloaded: ${n} matches`);
    }, 600000);
    console.log("Loading hero images...");
    await loadRefs().then((r) => readDraft(Buffer.alloc(0), { refs: r }).catch(() => {}));
    console.log(`Draft Coach ready: http://127.0.0.1:${PORT}/`);
    console.log(ALWAYS || FILE ? "Mode: always capturing" : "Mode: waiting for hero selection (via GSI)");
    setInterval(tick, INTERVAL_MS);
    resolve(true);
  });
});

module.exports = { ready, PORT };
