// Test helper: pretends to be Dota and posts a fake match to the server.
// Run: node sim-game.js [port=3017] [clock=345] [team=dire]
const port = +process.argv[2] || 3017, start = +process.argv[3] || 345, team = process.argv[4] || "dire";
const post = (body) => fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: JSON.stringify({ auth: { token: "draftcoach-local" }, ...body }) });
const base = (state, clock) => ({
  map: { matchid: "sim-1", game_state: state, clock_time: clock, daytime: Math.floor(Math.max(0, clock) / 300) % 2 === 0, paused: false },
  player: { team_name: team, team_slot: 2, gpm: 380 + Math.round(clock / 6), xpm: 420 + Math.round(clock / 5), gold: 912, kills: 2, deaths: 1, assists: 4, last_hits: Math.round(clock / 9), denies: 6 },
  hero: { id: 1, level: 7 },
  items: { slot0: { name: "item_power_treads" }, slot1: { name: "item_bfury" }, slot2: { name: "empty" }, neutral0: { name: "item_safety_bubble" } },
});
(async () => {
  await post(base("DOTA_GAMERULES_STATE_HERO_SELECTION", -60));
  await new Promise((r) => setTimeout(r, 4000));   // let the server read the draft
  for (let c = start - 120; c < start; c += 30) await post(base("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", c));
  for (let c = start; ; c++) { await post(base("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", c)); await new Promise((r) => setTimeout(r, 1000)); }
})();
