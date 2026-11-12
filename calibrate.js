// Finds how hero images sit inside top-bar slots, using labelled sample screenshots.
// Writes assets/slot-map.json. Run: node calibrate.js
const sharp = require("sharp");
const fs = require("fs");
const { loadRefs, toVec, dot, ROI, RADIANT_X, DIRE_X } = require("./matcher");

const LABELS = [
  { file: "samples/draft2.png", side: "radiant", slot: 2, key: "phantom_assassin" },
  { file: "samples/draft2.png", side: "radiant", slot: 3, key: "ogre_magi" },
  { file: "samples/draft2.png", side: "radiant", slot: 4, key: "venomancer" },
  { file: "samples/draft2.png", side: "dire", slot: 0, key: "queenofpain" },
  { file: "samples/draft2.png", side: "dire", slot: 1, key: "weaver" },
  { file: "samples/draft2.png", side: "dire", slot: 2, key: "drow_ranger" },
  { file: "samples/draft2.png", side: "dire", slot: 4, key: "magnataur" },
];

(async () => {
  const slots = [];
  for (const l of LABELS) {
    const x = (l.side === "radiant" ? RADIANT_X : DIRE_X)[l.slot];
    const v = await toVec(l.file, { left: x + ROI.x, top: ROI.y, width: ROI.w, height: ROI.h });
    slots.push({ ...l, v });
  }
  let best = null;
  const grid = (lo, hi, st) => { const a = []; for (let i = lo; i <= hi; i += st) a.push(i); return a; };
  const tryMap = async (map) => {
    let refs;
    try { refs = await loadRefs(map); } catch { return; } // map pushes ROI outside the image
    let total = 0;
    for (const s of slots) {
      let right = 0, other = -2;
      for (const r of refs) { const d = dot(s.v, r.vec); if (r.key === s.key) right = d; else other = Math.max(other, d); }
      total += right - other;
    }
    const m = total / slots.length;
    if (!best || m > best.m) { best = { m, map }; console.log("better", m.toFixed(3), JSON.stringify(map)); }
  };
  for (const refW of grid(112, 152, 8)) for (const ox of grid(-24, 4, 7)) for (const oy of grid(-24, 4, 7))
    await tryMap({ refW, ox, oy });
  const c = best.map; // refine around the best
  for (const refW of grid(c.refW - 6, c.refW + 6, 2)) for (const ox of grid(c.ox - 4, c.ox + 4, 2)) for (const oy of grid(c.oy - 4, c.oy + 4, 2))
    await tryMap({ refW, ox, oy });
  fs.writeFileSync("assets/slot-map.json", JSON.stringify(best.map));
  console.log("saved", best);
})();
