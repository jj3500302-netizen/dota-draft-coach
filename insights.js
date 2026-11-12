// Everything about *you* and the people you play with, from OpenDota:
// - your hero pool (draft), your own GPM/XPM on a hero (in game)
// - after-match reports, the players you have met, their hero pool and playstyle
const fs = require("fs");
const path = require("path");
const od = require("./od");
const advisor = require("./advisor");

const DATA = path.join(__dirname, "data");
const REPORTS = path.join(DATA, "reports");
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch { return d; } };
const save = (f, v) => { try { fs.mkdirSync(path.dirname(path.join(DATA, f)), { recursive: true }); fs.writeFileSync(path.join(DATA, f), JSON.stringify(v)); } catch {} };
const H = 3600e3, DAY = 24 * H;
const heroOf = (id) => advisor.byId.get(id) || { key: null, name: "?" };
const sideOf = (slot) => (slot < 128 ? "radiant" : "dire");
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

let me = load("me.json", { accountId: null });
let pool = null;           // heroId -> {games, win}
let onChange = () => {};   // server sets this to re-send data to the page

function setMe(accountId) {
  const id = +accountId || null;
  if (!id || id === me.accountId) return;
  me = { accountId: id };
  save("me.json", me);
  pool = null;
  refreshPool();
  seedPeers();
}

// ---------- 1. your hero pool ----------
async function refreshPool(force = false) {
  if (!me.accountId) return null;
  try {
    const h = await od.get(`/players/${me.accountId}/heroes`, { ttl: force ? 0 : 6 * H });
    pool = {};
    for (const x of h || []) if (x.games) pool[x.hero_id] = { games: x.games, win: x.win };
    onChange("pool");
  } catch (e) { console.error("hero pool:", e.message); }
  return pool;
}

// ---------- 2. your own GPM/XPM on a hero ----------
const baselines = new Map();
const MY_FIELDS = ["gold_per_min", "xp_per_min", "last_hits", "denies", "kills", "deaths", "assists", "hero_damage", "tower_damage", "duration", "version", "start_time"];
const myHeroMatches = (heroId) => od.get(`/players/${me.accountId}/matches?hero_id=${heroId}&limit=20&${MY_FIELDS.map((f) => "project=" + f).join("&")}`, { ttl: 3 * H });
const isParsed = (m) => m && m.version != null;
const getMatch = (id) => od.get(`/matches/${id}`, { ttl: 90e3, keep: isParsed });

async function baseline(heroId) {
  if (!me.accountId || !heroId) return null;
  const k = me.accountId + ":" + heroId;
  if (baselines.has(k)) return baselines.get(k);
  baselines.set(k, null);
  try {
    const ms = (await myHeroMatches(heroId)) || [];
    const per = (f) => avg(ms.map((m) => m[f]).filter((v) => v != null));
    const b = { heroId, n: ms.length, gpm: per("gold_per_min"), xpm: per("xp_per_min"), lh: per("last_hits"), deaths: per("deaths"),
      heroDmgMin: avg(ms.filter((m) => m.duration).map((m) => m.hero_damage / (m.duration / 60))), curve: null, items: null };
    // minute-by-minute numbers need replay-parsed games
    const parsed = ms.filter(isParsed).slice(0, 6);
    if (parsed.length >= 2) {
      const curves = [], firsts = {};
      for (const m of parsed) {
        const full = await getMatch(m.match_id);
        const p = full && full.players.find((x) => x.account_id === me.accountId);
        if (!p || !p.gold_t) continue;
        curves.push(p);
        for (const it of firstBuys(p)) (firsts[it.key] = firsts[it.key] || []).push(it.time);
      }
      if (curves.length >= 2) {
        const len = Math.max(...curves.map((p) => p.gold_t.length));
        const at = (arr, m) => avg(curves.map((p) => p[arr] && p[arr][m]).filter((v) => v != null));
        b.curve = { n: curves.length, gpm: [], xpm: [], lh: [] };
        for (let m = 1; m < len; m++) { b.curve.gpm[m] = at("gold_t", m) / m; b.curve.xpm[m] = at("xp_t", m) / m; b.curve.lh[m] = at("lh_t", m); }
        b.items = Object.fromEntries(Object.entries(firsts).filter(([, t]) => t.length >= 2).map(([k2, t]) => [k2, avg(t)]));
      }
    }
    baselines.set(k, b);
    onChange("baseline");
    return b;
  } catch (e) { console.error("baseline:", e.message); baselines.delete(k); return null; }
}
function baselineAt(heroId, clock) {
  const b = me.accountId && baselines.get(me.accountId + ":" + heroId);
  if (!b || !b.n) return null;
  const m = Math.floor(clock / 60);
  if (b.curve && m >= 1 && b.curve.gpm[m] != null) return { kind: "minute", n: b.curve.n, gpm: Math.round(b.curve.gpm[m]), xpm: Math.round(b.curve.xpm[m]), lh: Math.round(b.curve.lh[m]) };
  return { kind: "game", n: b.n, gpm: Math.round(b.gpm), xpm: Math.round(b.xpm) };
}

// ---------- items (names, costs) ----------
let ITEMS = null;
async function items() {
  if (!ITEMS) {
    const c = await od.get("/constants/items", { ttl: 7 * DAY });
    ITEMS = { byKey: c || {}, byId: {} };
    for (const [key, v] of Object.entries(ITEMS.byKey)) ITEMS.byId[v.id] = key;
  }
  return ITEMS;
}
const SKIP_ITEMS = /^(tpscroll|ward_|dust|smoke|clarity|flask|tango|enchanted_mango|faerie_fire|blood_grenade|recipe_|tome|famango|cheese|aegis|refresher_shard|branches|gauntlets|slippers|mantle|circlet|magic_stick|wind_lace|boots|ring_of_protection|quelling_blade|sobi_mask|orb_of_venom|blight_stone|crown|belt_of_strength|band_of_elvenskin|robe|blades_of_attack|chainmail|gloves|cloak|staff_of_wizardry|ogre_axe|blade_of_alacrity|point_booster|broadsword|claymore|javelin|mithril_hammer|platemail|talisman|hyperstone|ultimate_orb|demon_edge|eagle|reaver|mystic_staff|relic|energy_booster|vitality_booster|void_stone|ring_of_regen|ring_of_health|lifesteal|ghost|shadow_amulet|fluffy_hat|cornucopia)/;
function firstBuys(p) {
  const seen = new Set(), out = [];
  for (const b of p.purchase_log || []) {
    const key = b.key;
    if (seen.has(key) || SKIP_ITEMS.test(key) || b.time < 0) continue;
    const c = ITEMS && ITEMS.byKey[key];
    if (ITEMS && (!c || (c.cost || 0) < 1000)) continue;
    seen.add(key); out.push({ key, time: b.time });
  }
  return out;
}

// ---------- 3. after-match report ----------
const requested = new Set(load("parse-requested.json", []));
const reportJobs = new Map();   // matchId -> {status, since}
let latest = load("latest-report.json", null);

function queueReport(matchId) {
  const id = String(matchId);
  if (!/^\d+$/.test(id) || reportJobs.has(id)) return;
  reportJobs.set(id, { status: "waiting", since: Date.now() });
  latest = { matchId: id, at: Date.now() };
  save("latest-report.json", latest);
  onChange("report");
  pollReport(id);
}
async function pollReport(id) {
  const job = reportJobs.get(id);
  // OpenDota gets the match a few minutes after it ends; the replay takes a few more
  while (Date.now() - job.since < 75 * 60e3) {
    try {
      const r = await report(id);
      job.status = r.status;
      onChange("report");
      if (r.status === "full") break;
    } catch (e) { console.error("report:", e.message); }
    await new Promise((res) => setTimeout(res, job.status === "waiting" ? 60e3 : 120e3));
  }
  if (job.status !== "full") { job.status = job.status === "waiting" ? "missing" : "basic-only"; onChange("report"); }
  refreshPool(true);
}

async function report(matchId) {
  const id = String(matchId);
  const done = load(`reports/${id}.json`, null);
  if (done && done.status === "full") return done;
  if (!me.accountId) return { matchId: id, status: "noaccount" };
  const m = await getMatch(id);
  if (!m || !m.players) return { matchId: id, status: "waiting" };
  const meP = m.players.find((p) => p.account_id === me.accountId);
  if (!meP) return { matchId: id, status: "notyours" };
  if (!isParsed(m) && !requested.has(id)) {
    requested.add(id); save("parse-requested.json", [...requested].slice(-300));
    await od.post(`/request/${id}`);
  }
  await items();
  const parsed = isParsed(m);
  const side = sideOf(meP.player_slot), won = !!meP.win;
  const hero = heroOf(meP.hero_id);
  const base = await baseline(meP.hero_id);
  const mins = m.duration / 60;
  const bm = meP.benchmarks || {};
  const pct = (k) => (bm[k] && bm[k].pct != null ? Math.round(bm[k].pct * 100) : null);
  const stats = [
    { k: "gpm", v: meP.gold_per_min, mine: base && base.gpm, pct: pct("gold_per_min") },
    { k: "xpm", v: meP.xp_per_min, mine: base && base.xpm, pct: pct("xp_per_min") },
    { k: "lh", v: meP.last_hits, mine: base && base.lh, pct: pct("last_hits_per_min") },
    { k: "heroDmg", v: Math.round(meP.hero_damage / mins), mine: base && base.heroDmgMin, pct: pct("hero_damage_per_min"), perMin: true },
    { k: "towerDmg", v: meP.tower_damage, pct: pct("tower_damage") },
    { k: "deaths", v: meP.deaths, mine: base && base.deaths, lowerBetter: true },
  ].map((s) => ({ ...s, mine: s.mine != null ? Math.round(s.mine) : null }));

  const finalItems = [0, 1, 2, 3, 4, 5].map((i) => ITEMS.byId[meP["item_" + i]]).filter(Boolean);
  const notes = [];
  const r = {
    matchId: id, status: parsed ? "full" : "basic", start: m.start_time, duration: m.duration, won, side,
    hero: { id: hero.id, key: hero.key, name: hero.name }, kda: [meP.kills, meP.deaths, meP.assists], netWorth: meP.net_worth,
    lh: meP.last_hits, dn: meP.denies, level: meP.level, stats, finalItems, notes, baseN: base ? base.n : 0,
    score: [m.radiant_score, m.dire_score],
  };

  // notes that only need the basic data
  const gp = pct("gold_per_min");
  if (base && base.n >= 3 && base.gpm) {
    const d = meP.gold_per_min - base.gpm;
    if (Math.abs(d) >= 40) notes.push({ t: d > 0 ? "gpmUp" : "gpmDown", v: Math.round(Math.abs(d)), n: base.n });
  }
  if (gp != null && (gp >= 80 || gp <= 25)) notes.push({ t: gp >= 80 ? "topFarm" : "lowFarm", v: gp });
  if (base && base.deaths != null && meP.deaths - base.deaths >= 3) notes.push({ t: "moreDeaths", v: meP.deaths, mine: Math.round(base.deaths) });

  if (parsed) {
    const at10 = (arr) => (arr && arr.length > 10 ? arr[10] : null);
    r.lane = { lh10: at10(meP.lh_t), dn10: at10(meP.dn_t), gold10: at10(meP.gold_t), eff: meP.lane_efficiency_pct ?? null, role: meP.lane_role ?? null };
    // who you laned against: enemies in the same lane
    const opp = m.players.filter((p) => sideOf(p.player_slot) !== side && p.lane === meP.lane && p.lane != null);
    if (opp.length && r.lane.gold10 != null) {
      r.lane.oppGold10 = Math.round(avg(opp.map((p) => at10(p.gold_t)).filter((v) => v != null)));
      r.lane.opp = opp.map((p) => heroOf(p.hero_id).name);
      const d = r.lane.gold10 - r.lane.oppGold10;
      notes.push({ t: d >= 400 ? "laneWon" : d <= -400 ? "laneLost" : "laneEven", v: Math.abs(d), opp: r.lane.opp.join(", ") });
    }
    if (base && base.curve && base.curve.lh[10] != null && r.lane.lh10 != null) {
      const d = r.lane.lh10 - base.curve.lh[10];
      if (Math.abs(d) >= 8) notes.push({ t: d > 0 ? "lhUp" : "lhDown", v: r.lane.lh10, mine: Math.round(base.curve.lh[10]) });
    }
    // deaths: when, and to whom
    const deaths = [];
    const myKey = "npc_dota_hero_" + hero.key;
    for (const p of m.players) if (sideOf(p.player_slot) !== side) for (const k of p.kills_log || []) if (k.key === myKey) deaths.push({ time: k.time, by: heroOf(p.hero_id).name });
    deaths.sort((a, b) => a.time - b.time);
    r.deaths = deaths;
    const early = deaths.filter((d) => d.time < 600).length;
    if (early >= 3) notes.push({ t: "earlyDeaths", v: early });
    const killers = {};
    for (const d of deaths) killers[d.by] = (killers[d.by] || 0) + 1;
    const top = Object.entries(killers).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 3) notes.push({ t: "killedBy", hero: top[0], v: top[1] });
    // item timings, against your usual timing on this hero
    r.items = firstBuys(meP).slice(0, 8).map((it) => ({ ...it, name: (ITEMS.byKey[it.key] || {}).dname || it.key, usual: base && base.items && base.items[it.key] != null ? Math.round(base.items[it.key]) : null }));
    for (const it of r.items) if (it.usual != null && Math.abs(it.time - it.usual) >= 150) { notes.push({ t: it.time > it.usual ? "itemLate" : "itemEarly", item: it.name, time: it.time, usual: it.usual }); break; }
    // team gold lead over time (from your side)
    if (m.radiant_gold_adv) r.goldAdv = m.radiant_gold_adv.map((v) => (side === "radiant" ? v : -v));
    if (meP.obs_placed != null) r.wards = { obs: meP.obs_placed, sen: meP.sen_placed };
    if (meP.stuns != null) r.stuns = Math.round(meP.stuns);
  }

  // the other nine
  r.players = m.players.filter((p) => p !== meP).map((p) => ({
    accountId: p.account_id || null, name: p.personaname || null, rank: p.rank_tier || null,
    hero: heroOf(p.hero_id).key, heroName: heroOf(p.hero_id).name, team: sideOf(p.player_slot) === side ? "ally" : "enemy",
    kda: [p.kills, p.deaths, p.assists], gpm: p.gold_per_min, party: p.party_id != null && p.party_id === meP.party_id && meP.party_size > 1,
  }));
  recordMet(r);
  save(`reports/${id}.json`, r);
  return r;
}

// ---------- 4. players you have met ----------
let met = load("players.json", {});   // accountId -> {name, last, games: {matchId: {with, won, hero, t}}}
function recordMet(r) {
  for (const p of r.players) {
    if (!p.accountId) continue;
    const e = (met[p.accountId] = met[p.accountId] || { name: p.name, last: 0, games: {} });
    if (p.name) e.name = p.name;
    e.last = Math.max(e.last, r.start);
    e.games[r.matchId] = { with: p.team === "ally", won: r.won, hero: p.hero, t: r.start };
  }
  save("players.json", met);
}
async function seedPeers() {
  if (!me.accountId) return;
  try {
    const peers = (await od.get(`/players/${me.accountId}/peers`, { ttl: 12 * H })) || [];
    for (const p of peers) {
      const e = (met[p.account_id] = met[p.account_id] || { name: p.personaname, last: 0, games: {} });
      e.name = e.name || p.personaname;
      e.last = Math.max(e.last, p.last_played || 0);
      e.peer = { with: p.with_games, withWin: p.with_win, against: p.against_games, againstWin: p.against_win };
    }
    save("players.json", met);
  } catch (e) { console.error("peers:", e.message); }
}
function metList() {
  return Object.entries(met).map(([id, e]) => {
    const g = Object.values(e.games);
    const w = e.peer ? e.peer.with : g.filter((x) => x.with).length;
    const a = Math.max(e.peer ? e.peer.against : 0, g.filter((x) => !x.with).length);
    return { accountId: +id, name: e.name, last: e.last, with: w, against: a };
  }).sort((x, y) => y.last - x.last);
}

const posName = { 1: "safe", 2: "mid", 3: "off", 4: "jungle" };
async function player(accountId) {
  const id = +accountId;
  if (!id) return null;
  const [profile, heroes30, recent] = await Promise.all([
    od.get(`/players/${id}`, { ttl: 6 * H }),
    od.get(`/players/${id}/heroes?date=30`, { ttl: 6 * H }),
    od.get(`/players/${id}/recentMatches`, { ttl: 2 * H }),
  ]);
  const out = { accountId: id, name: profile && profile.profile ? profile.profile.personaname : (met[id] && met[id].name) || null,
    avatar: profile && profile.profile ? profile.profile.avatarmedium : null, rank: profile ? profile.rank_tier : null,
    private: !recent || !recent.length };
  out.pool30 = (heroes30 || []).filter((h) => h.games).sort((a, b) => b.games - a.games).slice(0, 8)
    .map((h) => ({ key: heroOf(h.hero_id).key, name: heroOf(h.hero_id).name, games: h.games, win: h.win }));
  out.games30 = (heroes30 || []).reduce((t, h) => t + h.games, 0);
  if (recent && recent.length) out.style = playstyle(recent);

  // you and this player
  if (me.accountId && id !== me.accountId) {
    const together = (await od.get(`/players/${me.accountId}/matches?included_account_id=${id}&project=start_time&project=hero_id`, { ttl: 2 * H })) || [];
    const myWins = together.filter((m) => (m.player_slot < 128) === m.radiant_win).length;
    const e = met[id] || {};
    const local = Object.values(e.games || {});
    let w = e.peer ? e.peer.with : local.filter((g) => g.with).length;
    let ww = e.peer ? e.peer.withWin : local.filter((g) => g.with && g.won).length;
    w = Math.min(w, together.length); ww = Math.min(ww, myWins);
    out.you = { total: together.length, with: w, withWin: ww, against: together.length - w, againstWin: myWins - ww,
      last: together[0] ? together[0].start_time : null };
  }
  return out;
}
function playstyle(ms) {
  const n = ms.length, mean = (f) => avg(ms.map(f));
  const k = mean((m) => m.kills), d = mean((m) => m.deaths), a = mean((m) => m.assists), gpm = mean((m) => m.gold_per_min);
  const wins = ms.filter((m) => (m.player_slot < 128) === m.radiant_win).length;
  const lanes = {};
  for (const m of ms) if (m.lane_role) lanes[m.lane_role] = (lanes[m.lane_role] || 0) + 1;
  const lane = Object.entries(lanes).sort((x, y) => y[1] - x[1])[0];
  const roam = ms.filter((m) => m.is_roaming).length;
  const support = gpm < 400;
  let role = support ? (roam / n >= 0.3 ? "roamer" : "support") : lane ? { 1: "carry", 2: "mid", 3: "offlane", 4: "jungle" }[lane[0]] : "core";
  const tags = [];
  if (k >= 9 || (k + a) / Math.max(1, d) >= 4.5) tags.push("aggressive");
  if (d >= 8) tags.push("diesALot");
  else if (d <= 4 && n >= 5) tags.push("careful");
  if (a >= 16) tags.push("teamfighter");
  if (!support && gpm >= 620) tags.push("farmer");
  const heroCount = {};
  for (const m of ms) heroCount[m.hero_id] = (heroCount[m.hero_id] || 0) + 1;
  const topHero = Object.entries(heroCount).sort((x, y) => y[1] - x[1])[0];
  if (topHero && topHero[1] / n >= 0.4) tags.push("oneTrick");
  if (Object.keys(heroCount).length >= 14) tags.push("widePool");
  const party = ms.filter((m) => m.party_size > 1).length;
  if (party / n >= 0.6) tags.push("party");
  const streak = ms.slice(0, 5).map((m) => ((m.player_slot < 128) === m.radiant_win ? "W" : "L")).join("");
  return { n, wins, k: +k.toFixed(1), d: +d.toFixed(1), a: +a.toFixed(1), gpm: Math.round(gpm), role, tags, streak,
    topHero: topHero ? { key: heroOf(+topHero[0]).key, name: heroOf(+topHero[0]).name, n: topHero[1] } : null };
}

async function myMatches() {
  if (!me.accountId) return [];
  const ms = (await od.get(`/players/${me.accountId}/matches?limit=15&project=hero_id&project=start_time&project=duration&project=kills&project=deaths&project=assists`, { ttl: 5 * 60e3 })) || [];
  return ms.map((m) => ({ matchId: String(m.match_id), hero: heroOf(m.hero_id).key, heroName: heroOf(m.hero_id).name, start: m.start_time, duration: m.duration,
    won: (m.player_slot < 128) === m.radiant_win, kda: [m.kills, m.deaths, m.assists] }));
}

function state() {
  const jobs = {};
  for (const [id, j] of reportJobs) jobs[id] = j.status;
  return { accountId: me.accountId, poolLoaded: !!pool, latest, jobs };
}

if (me.accountId) { refreshPool(); seedPeers(); }
module.exports = { setMe, getPool: () => pool, baseline, baselineAt, queueReport, report, player, metList, myMatches, state, onChange: (f) => (onChange = f) };
