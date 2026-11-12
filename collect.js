// Collects recent public matches (Legend+ by default) from OpenDota for hero statistics.
// Run: node collect.js [calls=1500] [min_rank=50]
// Free OpenDota limits: 60 calls/minute, ~3000/day. Each call = up to 100 matches.
// Resumes where it left off; appends to data/matches.jsonl
const fs = require("fs");
const path = require("path");

const CALLS = +process.argv[2] || 1500;
const MIN_RANK = +process.argv[3] || 50;
const DIR = path.join(__dirname, "data");
const FILE = path.join(DIR, "matches.jsonl");
const STATE = path.join(DIR, "collect-state.json");
fs.mkdirSync(DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let state = { lowest: null, highestSeen: null };
try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {}

(async () => {
  // start a few hours back so matches are finished and parsed
  if (!state.lowest) {
    const latest = (await (await fetch("https://api.opendota.com/api/publicMatches")).json())[0].match_id;
    state.lowest = latest - 300000;
  }
  let saved = 0;
  for (let i = 0; i < CALLS; i++) {
    const url = `https://api.opendota.com/api/publicMatches?min_rank=${MIN_RANK}&less_than_match_id=${state.lowest}`;
    let res;
    try { res = await fetch(url); } catch (e) { console.log("network error, retrying", e.message); await sleep(5000); i--; continue; }
    if (res.status === 429) { console.log("rate limited, waiting 60s"); await sleep(60000); i--; continue; }
    if (!res.ok) { console.log("HTTP", res.status); await sleep(5000); continue; }
    const page = await res.json();
    if (!page.length) break;
    const lines = [];
    for (const m of page) {
      const ok = m.duration >= 900 && [22, 1, 2].includes(m.game_mode) &&
        m.radiant_team?.length === 5 && m.dire_team?.length === 5 &&
        m.radiant_team.every((h) => h > 0) && m.dire_team.every((h) => h > 0);
      if (ok) lines.push(JSON.stringify({ id: m.match_id, rw: m.radiant_win ? 1 : 0, r: m.radiant_team, d: m.dire_team, rank: m.avg_rank_tier, t: m.start_time }));
    }
    if (lines.length) fs.appendFileSync(FILE, lines.join("\n") + "\n");
    saved += lines.length;
    state.lowest = Math.min(...page.map((m) => m.match_id));
    fs.writeFileSync(STATE, JSON.stringify(state));
    const left = res.headers.get("x-rate-limit-remaining-day");
    if (i % 25 === 0) console.log(`call ${i + 1}/${CALLS}  saved ${saved}  oldest ${new Date(page.at(-1).start_time * 1000).toISOString()}  day-left ${left}`);
    if (left !== null && +left < 50) { console.log("daily limit nearly used, stopping"); break; }
    await sleep(1100);
  }
  console.log("done, saved", saved);
})();
