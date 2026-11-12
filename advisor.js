// Draft advisor: hero stats from collected matches + pick recommendations.
const fs = require("fs");
const path = require("path");
const heroesMeta = require("./assets/heroes.json");

const MATCHES = path.join(__dirname, "data", "matches.jsonl");
const SHRINK = 60; // games of "prior" pulling a pair toward its expected winrate

const heroes = Object.values(heroesMeta).map((h) => ({
  id: h.id, key: h.name.replace("npc_dota_hero_", ""), name: h.localized_name, roles: h.roles || [], attack: h.attack_type, attr: h.primary_attr,
}));
const byId = new Map(heroes.map((h) => [h.id, h]));
const byKey = new Map(heroes.map((h) => [h.key, h]));
const N = Math.max(...heroes.map((h) => h.id)) + 1;

// Which positions each hero is played in (from recent pro matches)
let POS = {};
try { POS = JSON.parse(fs.readFileSync(path.join(__dirname, "assets", "positions.json"), "utf8")); } catch {}
function posShare(h, pos) {
  const p = POS[h.id];
  if (p && p.total >= 8) return (p[pos] || 0) / p.total;
  // no data: guess from OpenDota role tags
  const r = h.roles;
  const ok = pos === 1 ? r.includes("Carry") : pos === 2 ? r.includes("Carry") || r.includes("Nuker")
    : pos === 3 ? r.includes("Durable") || r.includes("Initiator") : r.includes("Support");
  return ok ? 0.5 : 0;
}
const POS_MIN_SHARE = 0.25;

const logit = (p) => Math.log(p / (1 - p));
const sigm = (x) => 1 / (1 + Math.exp(-x));

let S = null;
function build() {
  const games = new Float64Array(N), wins = new Float64Array(N);
  const vsG = new Float64Array(N * N), vsW = new Float64Array(N * N);
  const wG = new Float64Array(N * N), wW = new Float64Array(N * N);
  let total = 0, oldest = Infinity, newest = 0;
  if (fs.existsSync(MATCHES)) {
    for (const line of fs.readFileSync(MATCHES, "utf8").split("\n")) {
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      total++; oldest = Math.min(oldest, m.t); newest = Math.max(newest, m.t);
      for (const [team, enemy, won] of [[m.r, m.d, m.rw], [m.d, m.r, 1 - m.rw]]) {
        for (const a of team) {
          games[a]++; wins[a] += won;
          for (const b of enemy) { vsG[a * N + b]++; vsW[a * N + b] += won; }
          for (const b of team) if (b !== a) { wG[a * N + b]++; wW[a * N + b] += won; }
        }
      }
    }
  }
  const wr = new Float64Array(N);
  for (let i = 0; i < N; i++) wr[i] = (wins[i] + 25) / (games[i] + 50); // shrink to 50%
  // advantage of a vs b, synergy of a with b: observed minus expected, shrunk toward 0
  const vs = new Float64Array(N * N), syn = new Float64Array(N * N);
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    const i = a * N + b;
    if (vsG[i]) {
      const exp = sigm(logit(wr[a]) - logit(wr[b]));
      vs[i] = (vsW[i] - exp * vsG[i]) / (vsG[i] + SHRINK);
    }
    if (wG[i]) {
      const exp = sigm(logit(wr[a]) + logit(wr[b]));
      syn[i] = (wW[i] - exp * wG[i]) / (wG[i] + SHRINK);
    }
  }
  S = { total, oldest, newest, games, wr, vs, syn, vsG, wG };
  return S;
}
const stats = () => S || build();




// allies/enemies/unavailable: arrays of hero ids
// pos: 1-5 = the position we will play (only heroes played there are suggested); 0/undefined = any
function advise({ allies = [], enemies = [], unavailable = [], pos = 0 }, top = 8) {
  const s = stats();
  const taken = new Set([...allies, ...enemies, ...unavailable]);
  const roleCount = {};
  for (const a of allies) for (const r of byId.get(a)?.roles || []) roleCount[r] = (roleCount[r] || 0) + 1;
  const missing = [["Initiator", 2], ["Disabler", 2], ["Durable", 3], ["Pusher", 3]]
    .filter(([r, need]) => allies.length >= need && !roleCount[r]).map(([r]) => r);
  const isCore = (h) => h.roles.includes("Carry") && !h.roles.includes("Support");
  const cores = allies.filter((a) => isCore(byId.get(a))).length;

  const rows = [];
  for (const h of heroes) {
    if (taken.has(h.id) || !s.games[h.id]) continue;
    const share = pos ? posShare(h, pos) : null;
    if (pos && share < POS_MIN_SHARE) continue;
    const counters = enemies.map((e) => ({ id: e, v: s.vs[h.id * N + e] }));
    const synergies = allies.map((a) => ({ id: a, v: s.syn[h.id * N + a] }));
    const base = s.wr[h.id] - 0.5;
    const roleBonus = missing.filter((r) => h.roles.includes(r));
    const tooManyCores = !pos && cores >= 2 && isCore(h);
    const score = counters.reduce((t, c) => t + c.v, 0) + synergies.reduce((t, c) => t + c.v, 0) + base * 0.5 +
      roleBonus.length * 0.004 - (tooManyCores ? 0.012 : 0);
    const reasons = [];
    for (const c of [...counters].sort((x, y) => y.v - x.v)) if (c.v >= 0.01) reasons.push({ t: "counter", hero: byId.get(c.id).name, v: c.v });
    for (const c of [...synergies].sort((x, y) => y.v - x.v)) if (c.v >= 0.01) reasons.push({ t: "synergy", hero: byId.get(c.id).name, v: c.v });
    for (const r of roleBonus) reasons.push({ t: "need", role: r });
    const warnings = counters.filter((c) => c.v <= -0.015).sort((x, y) => x.v - y.v).map((c) => ({ t: "weak", hero: byId.get(c.id).name, v: c.v }));
    if (tooManyCores) warnings.push({ t: "cores", n: cores });
    rows.push({ posShare: share, id: h.id, key: h.key, name: h.name, score, winrate: s.wr[h.id], games: s.games[h.id], reasons: reasons.slice(0, 3), warnings: warnings.slice(0, 2) });
  }
  rows.sort((a, b) => b.score - a.score);
  const avoid = rows.filter((r) => r.warnings.length).slice(-top).reverse();

  // rough draft balance from all cross-team pairs
  let edge = 0;
  for (const a of allies) {
    for (const e of enemies) edge += s.vs[a * N + e];
    edge += (s.wr[a] - 0.5);
  }
  for (const e of enemies) edge -= (s.wr[e] - 0.5);
  const synSum = (team) => { let t = 0; for (const a of team) for (const b of team) if (a < b) t += s.syn[a * N + b]; return t; };
  edge += synSum(allies) - synSum(enemies);

  return {
    pos,
    sample: { matches: s.total, from: s.oldest, to: s.newest },
    missingRoles: missing,
    draftEdge: allies.length && enemies.length ? edge : null,
    recommend: rows.slice(0, top).map(({ score, ...r }) => ({ ...r, score: +(score * 100).toFixed(2) })),
    avoid: avoid.map(({ score, ...r }) => ({ ...r, score: +(score * 100).toFixed(2) })),
  };
}

module.exports = { advise, build, stats, byId, byKey, heroes };
