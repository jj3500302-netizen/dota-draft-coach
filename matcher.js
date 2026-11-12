// Reads the 10 hero slots on the Dota 2 draft top bar from a screenshot.
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// Slot layout at 1920x1080 (scaled for other 16:9 resolutions)
const BASE_W = 1920;
const SLOT_W = 116, SLOT_H = 72;
const RADIANT_X = [210, 334, 458, 582, 706];
const DIRE_X = [1100, 1224, 1348, 1472, 1596];
// Compared region inside a slot: hero art above the rank label
const ROI = { x: 12, y: 8, w: 84, h: 36 };
const CMP_W = 42, CMP_H = 18; // downscaled comparison size

// How the reference 256x144 hero image sits inside a slot (set by calibrate.js)
let MAP = { refW: 124, ox: -4, oy: -4 };
try { MAP = JSON.parse(fs.readFileSync(path.join(__dirname, "assets", "slot-map.json"), "utf8")); } catch {}

const heroesMeta = require("./assets/heroes.json");
let refs = null;

async function toVec(input, region, grey = false) {
  let p = sharp(input).extract(region).resize(CMP_W, CMP_H, { fit: "fill" });
  if (grey) p = p.greyscale();
  const { data } = await p
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return normalize(Float32Array.from(data));
}

function normalize(v) {
  let m = 0; for (const x of v) m += x; m /= v.length;
  let s = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; s += v[i] * v[i]; }
  s = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Build a reference vector: render the hero image the way it sits in the slot, then cut the ROI
async function refVec(file, map = MAP, grey = false) {
  const refH = Math.round((map.refW * 144) / 256);
  const scaled = await sharp(file).resize(map.refW, refH).png().toBuffer();
  const left = ROI.x - map.ox, top = ROI.y - map.oy;
  return toVec(scaled, { left, top, width: ROI.w, height: ROI.h }, grey);
}

async function loadRefs(map = MAP) {
  const out = [];
  for (const h of Object.values(heroesMeta)) {
    const key = h.name.replace("npc_dota_hero_", "");
    const file = path.join(__dirname, "assets", "heroes", key + ".png");
    out.push({ id: h.id, key, name: h.localized_name, vec: await refVec(file, map), grey: await refVec(file, map, true) });
  }
  return out;
}

async function slotStats(img, scale, x) {
  const region = {
    left: Math.round((x + ROI.x) * scale), top: Math.round(ROI.y * scale),
    width: Math.round(ROI.w * scale), height: Math.round(ROI.h * scale),
  };
  const { data } = await sharp(img).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sat = 0, lum = 0, n = data.length / 3;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    sat += Math.max(r, g, b) - Math.min(r, g, b); lum += (r + g + b) / 3;
  }
  return { region, sat: sat / n, lum: lum / n };
}

// Role icons shown under our team's slots in ranked role queue (sword, crossed swords, shield, hands).
// Only the icon is matched, sliding along the label row, so it works for any game language.
const ROLE_Y = 104, ROLE_H = 22;
const ICON = { w: 13, h: 14, y: 4, x: { 1: 22, 2: 26, 3: 21, 4: 20, 5: 10 } }; // where each icon sits in assets/roles/posN.png
let roleRefs = null;
async function greyRow(input, region) {
  const { data } = await sharp(input).extract(region).greyscale().resize(SLOT_W, ROLE_H, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return data;
}
// normalised patch (zero mean, unit length); null when the patch is flat (no icon there)
function patchAt(row, x, y) {
  const v = new Float32Array(ICON.w * ICON.h);
  let m = 0, k = 0;
  for (let j = 0; j < ICON.h; j++) for (let i = 0; i < ICON.w; i++) { const p = row[(y + j) * SLOT_W + x + i]; v[k++] = p; m += p; }
  m /= v.length;
  let s = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; s += v[i] * v[i]; }
  if (s / v.length < 150) return null;
  s = Math.sqrt(s); for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
}
async function loadRoleRefs() {
  const out = [];
  for (let pos = 1; pos <= 5; pos++) {
    const f = path.join(__dirname, "assets", "roles", `pos${pos}.png`);
    if (!fs.existsSync(f)) continue;
    const row = await greyRow(f, { left: 0, top: 0, width: SLOT_W, height: ROLE_H });
    out.push({ pos, vec: patchAt(row, ICON.x[pos], ICON.y) });
  }
  return out;
}
async function readRoles(png, scale, xs, debug) {
  if (!roleRefs) roleRefs = await loadRoleRefs();
  const res = [];
  for (const x of xs) {
    const region = { left: Math.round(x * scale), top: Math.round(ROLE_Y * scale), width: Math.round(SLOT_W * scale), height: Math.round(ROLE_H * scale) };
    const row = await greyRow(png, region);
    const best = roleRefs.map((r) => ({ pos: r.pos, s: 0 }));
    for (let y = ICON.y - 2; y <= ICON.y + 2; y++) for (let px = 0; px <= SLOT_W - ICON.w; px++) {
      const v = patchAt(row, px, y);
      if (!v) continue;
      roleRefs.forEach((r, i) => { const s = dot(v, r.vec); if (s > best[i].s) best[i].s = s; });
    }
    best.sort((a, b) => b.s - a.s);
    if (debug) debug.push(best.map((b) => b.pos + ":" + b.s.toFixed(2)).join(" "));
    res.push(best.length > 1 && best[0].s > 0.8 && best[0].s - best[1].s > 0.08 ? best[0].pos : null);
  }
  return res;
}

// Returns { radiant: [slot x5], dire: [slot x5], roles: { radiant: [pos|null x5], dire: [...] } }, slot = { state, hero, score, margin }
// state: "picked" | "hovering" (greyed preview) | "empty"
async function readDraft(input, opts = {}) {
  const dbg = opts.debugRoles;
  if (!refs || opts.refs) refs = opts.refs || (await loadRefs());
  const img = sharp(input);
  const meta = await img.metadata();
  const scale = meta.width / BASE_W;
  const png = await img.png().toBuffer();
  const read = async (xs) => {
    const res = [];
    for (const x of xs) {
      const st = await slotStats(png, scale, x);
      // greyed-out slots (a teammate hovering a hero) only match in greyscale
      const grey = st.sat < 26;
      const v = await toVec(png, st.region, grey);
      let best = null, second = -2;
      for (const r of refs) {
        const s = dot(v, grey ? r.grey : r.vec);
        if (!best || s > best.score) { if (best) second = Math.max(second, best.score); best = { ...r, score: s }; }
        else if (s > second) second = s;
      }
      const margin = best.score - second;
      let state = "picked";
      if (best.score < 0.7 || margin < 0.08) state = "empty";
      else if (grey) state = "hovering";
      res.push({ state, hero: state === "empty" ? null : best.name, key: best.key, id: best.id,
        score: +best.score.toFixed(3), margin: +margin.toFixed(3), sat: Math.round(st.sat) });
    }
    return res;
  };
  const hasRoles = meta.height >= Math.round((ROLE_Y + ROLE_H) * scale);
  const none = [null, null, null, null, null];
  return {
    radiant: await read(RADIANT_X), dire: await read(DIRE_X),
    roles: { radiant: hasRoles ? await readRoles(png, scale, RADIANT_X, dbg) : none, dire: hasRoles ? await readRoles(png, scale, DIRE_X, dbg) : none },
  };
}

module.exports = { readDraft, loadRefs, refVec, toVec, dot, ROI, RADIANT_X, DIRE_X };
