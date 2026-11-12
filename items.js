// Counter-item suggestions: hand-written rules, not statistics.
// Each enemy hero has traits; each trait maps to the items that answer it.
const TRAITS = {
  evasion: "phantom_assassin windrunner brewmaster arc_warden riki broodmother keeper_of_the_light troll_warlord",
  passive: "bristleback phantom_assassin spectre huskar tidehunter dragon_knight mars enchantress centaur monkey_king",
  heal: "huskar alchemist necrolyte morphling life_stealer dazzle oracle omniknight wisp chen undying abaddon witch_doctor bloodseeker dragon_knight legion_commander slark treant warlock pudge skeleton_king enchantress juggernaut phoenix",
  invis: "riki bounty_hunter clinkz weaver nyx_assassin templar_assassin mirana invoker sand_king slark treant",
  swarm: "phantom_lancer naga_siren terrorblade chaos_knight meepo broodmother furion enigma lycan beastmaster chen visage lone_druid arc_warden venomancer undying",
  magic: "lina lion zuus skywrath_mage tinker invoker leshrac queenofpain pugna obsidian_destroyer storm_spirit puck necrolyte ancient_apparition death_prophet techies snapfire muerta lich crystal_maiden jakiro witch_doctor grimstroke dark_willow",
  target: "doom_bringer legion_commander bane lion shadow_shaman batrider beastmaster spirit_breaker vengefulspirit pudge primal_beast",
  silence: "silencer skywrath_mage death_prophet drow_ranger puck disruptor night_stalker bloodseeker riki doom_bringer earth_spirit",
  physical: "phantom_assassin sven ursa juggernaut troll_warlord drow_ranger sniper templar_assassin slark life_stealer skeleton_king chaos_knight terrorblade luna medusa faceless_void monkey_king lycan clinkz weaver legion_commander huskar muerta kez marci antimage phantom_lancer naga_siren morphling gyrocopter razor bloodseeker riki tiny alchemist lone_druid windrunner dawnbreaker",
  slippery: "antimage queenofpain storm_spirit ember_spirit puck weaver morphling void_spirit slark faceless_void mirana pangolier phantom_lancer earth_spirit tinker furion clinkz",
  mana: "medusa storm_spirit skeleton_king shredder leshrac tinker",
  buffs: "omniknight ogre_magi necrolyte pugna windrunner dark_seer oracle legion_commander lich treant",
  jump: "axe legion_commander centaur slardar sand_king earthshaker tidehunter magnataur mars spirit_breaker batrider primal_beast enigma tusk nyx_assassin pudge",
};

// who: "core" (pos 1-3), "sup" (pos 4-5) or "any"; w = how strong the answer is
const RULES = {
  evasion: [["item_monkey_king_bar", "core", 3]],
  passive: [["item_silver_edge", "core", 3]],
  heal: [["item_spirit_vessel", "sup", 3], ["item_shivas_guard", "core", 2], ["item_skadi", "core", 2]],
  invis: [["item_dust", "any", 3], ["item_gem", "any", 2]],
  swarm: [["item_mjollnir", "core", 2], ["item_shivas_guard", "core", 2], ["item_crimson_guard", "any", 2]],
  magic: [["item_black_king_bar", "core", 3], ["item_pipe", "any", 2], ["item_glimmer_cape", "sup", 2]],
  target: [["item_sphere", "core", 2], ["item_lotus_orb", "any", 2]],
  silence: [["item_cyclone", "any", 2], ["item_manta", "core", 2], ["item_black_king_bar", "core", 1]],
  physical: [["item_ghost", "sup", 2], ["item_heavens_halberd", "any", 2], ["item_shivas_guard", "core", 1]],
  slippery: [["item_orchid", "core", 2], ["item_sheepstick", "any", 2]],
  mana: [["item_diffusal_blade", "core", 2]],
  buffs: [["item_nullifier", "core", 2]],
  jump: [["item_force_staff", "sup", 2]],
};

const NAMES = {
  item_monkey_king_bar: "Monkey King Bar", item_silver_edge: "Silver Edge", item_spirit_vessel: "Spirit Vessel",
  item_shivas_guard: "Shiva's Guard", item_skadi: "Eye of Skadi", item_dust: "Dust of Appearance", item_gem: "Gem of True Sight",
  item_mjollnir: "Mjollnir", item_crimson_guard: "Crimson Guard", item_black_king_bar: "Black King Bar", item_pipe: "Pipe of Insight",
  item_glimmer_cape: "Glimmer Cape", item_sphere: "Linken's Sphere", item_lotus_orb: "Lotus Orb", item_cyclone: "Eul's Scepter",
  item_manta: "Manta Style", item_ghost: "Ghost Scepter", item_heavens_halberd: "Heaven's Halberd", item_orchid: "Orchid Malevolence",
  item_sheepstick: "Scythe of Vyse", item_diffusal_blade: "Diffusal Blade", item_nullifier: "Nullifier", item_force_staff: "Force Staff",
};
// owning any of these counts as already having the item
const UPGRADES = {
  item_orchid: ["item_bloodthorn"], item_cyclone: ["item_wind_waker"], item_ghost: ["item_ethereal_blade"],
  item_diffusal_blade: ["item_disperser"], item_force_staff: ["item_hurricane_pike"], item_glimmer_cape: [],
  item_dust: ["item_gem"], item_spirit_vessel: [],
};

const heroTraits = new Map();
for (const [trait, list] of Object.entries(TRAITS))
  for (const key of list.split(" ")) { if (!heroTraits.has(key)) heroTraits.set(key, []); heroTraits.get(key).push(trait); }

// enemies: [{key, name}], owned: ["item_x", ...]  ->  [{item, name, who, score, reasons:[{trait, heroes:[name]}]}]
function counterItems(enemies, owned = []) {
  const have = new Set(owned);
  const out = new Map();
  for (const trait of Object.keys(TRAITS)) {
    const heroes = enemies.filter((e) => (heroTraits.get(e.key) || []).includes(trait)).map((e) => e.name);
    if (!heroes.length) continue;
    for (const [item, who, w] of RULES[trait]) {
      if (have.has(item) || (UPGRADES[item] || []).some((u) => have.has(u))) continue;
      if (!out.has(item)) out.set(item, { item, key: item.replace("item_", ""), name: NAMES[item], who, score: 0, reasons: [] });
      const row = out.get(item);
      row.score += w * heroes.length;
      row.reasons.push({ trait, heroes });
    }
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}

module.exports = { counterItems, NAMES, TRAITS };
