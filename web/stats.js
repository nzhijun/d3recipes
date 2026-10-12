// Copyright 2026 FNG. Use, modification and redistribution are permitted under the conditions in LICENSE:
// credit the source, and visibly link to the site or repository if you use its outputs in a user-facing application.
// Display names for the game's internal stat families ("stems", see data.rs stem_of).  [name, kind]: kind "pct" = stored as a fraction.
export const STATS = {
  ArcaneD: ["Arcane Damage (weapon)", ""], ArcanePowerOnCrit: ["Arcane Power on Critical Hit", ""], ArcaneResist: ["Arcane Resistance", ""],
  Bleed: ["Chance to Bleed", "pct"], BleedPercent: ["Bleed Damage", "pct"], Block: ["Chance to Block", "pct"],
  CCReduction: ["Crowd Control Reduction", "pct"], ColdD: ["Cold Damage (weapon)", ""], ColdResist: ["Cold Resistance", ""],
  CooldownReduction: ["Cooldown Reduction", "pct"], CriticalChance: ["Critical Hit Chance", "pct"], CriticalD: ["Critical Hit Damage", "pct"],
  CrushingBlow: ["Chance for Crushing Blow", "pct"], DR: ["Armor (bonus)", ""], DamReductionVsElite: ["Damage Reduction from Elites", "pct"],
  Damage: ["Damage", "pct"], DamageBonusArcane: ["Arcane Damage", "pct"], DamageBonusCold: ["Cold Damage", "pct"],
  DamageBonusFire: ["Fire Damage", "pct"], DamageBonusHoly: ["Holy Damage", "pct"], DamageBonusLightning: ["Lightning Damage", "pct"],
  DamageBonusPhysical: ["Physical Damage", "pct"], DamageBonusPoison: ["Poison Damage", "pct"], DamageVsElite: ["Damage Against Elites", "pct"],
  DamageVsMonsterTypeBeast: ["Damage Against Beasts", "pct"], DamageVsMonsterTypeUndead: ["Damage Against Undead", "pct"],
  DefenseMelee: ["Melee Damage Reduction", "pct"], DefenseMissile: ["Ranged Damage Reduction", "pct"], Dex: ["Dexterity", ""], DexInt: ["Dexterity and Intelligence", ""],
  DexVit: ["Dexterity and Vitality", ""], Experience: ["Bonus Experience per Kill", ""], FireD: ["Fire Damage (weapon)", ""], FireResist: ["Fire Resistance", ""],
  Gold: ["Gold Find", "pct"], GoldPickUpRadius: ["Gold Pickup Radius", ""], Haste: ["Attack Speed", "pct"], HatredRegen: ["Hatred Regeneration", ""],
  HealthGlobeBonus: ["Health Globe Healing Bonus", ""], HealthGlobeChance: ["Chance to Drop Health Globe", "pct"], HitBlind: ["Chance to Blind on Hit", "pct"],
  HitChill: ["Chance to Chill on Hit", "pct"], HitFear: ["Chance to Fear on Hit", "pct"], HitFreeze: ["Chance to Freeze on Hit", "pct"],
  HitImmobilize: ["Chance to Immobilize on Hit", "pct"], HitKnockback: ["Chance to Knockback on Hit", "pct"], HitLife: ["Life per Hit", ""],
  HitMana: ["Mana per Hit", ""], HitSlow: ["Chance to Slow on Hit", "pct"], HitStun: ["Chance to Stun on Hit", "pct"], HolyD: ["Holy Damage (weapon)", ""],
  Indestructible: ["Indestructible", ""], Int: ["Intelligence", ""], IntVit: ["Intelligence and Vitality", ""], KillLife: ["Life after Each Kill", ""],
  KillMana: ["Mana after Each Kill", ""], Life: ["Maximum Life", "pct"], LifeS: ["Life per Second", ""], LightningD: ["Lightning Damage (weapon)", ""],
  LightningResist: ["Lightning Resistance", ""], MF: ["Magic Find", "pct"], ManaRegen: ["Mana Regeneration", ""], MaxArcanePower: ["Maximum Arcane Power", ""],
  MaxDiscipline: ["Maximum Discipline", ""], MaxEssence: ["Maximum Essence", ""], MaxFury: ["Maximum Fury", ""], MaxMana: ["Maximum Mana", ""],
  MaxSpirit: ["Maximum Spirit", ""], MaxWrath: ["Maximum Wrath", ""], MinMaxDam: ["Damage Range", ""], PhysicalResist: ["Physical Resistance", ""],
  PoisonD: ["Poison Damage (weapon)", ""], PoisonResist: ["Poison Resistance", ""], REQ: ["Level Requirement Reduction", ""], Regen: ["Life Regeneration", ""],
  ResistAll: ["All Resistance", ""], ResistFreeze: ["Freeze Duration Reduction", "pct"], ResistRoot: ["Immobilize Duration Reduction", "pct"],
  ResistStun: ["Stun Duration Reduction", "pct"], ResistStunRootFreeze: ["Stun/Immobilize/Freeze Duration Reduction", "pct"],
  ResourceCostReduction: ["Resource Cost Reduction", "pct"], Run: ["Movement Speed", "pct"], SpiritHeals: ["Life per Spirit Spent", ""],
  SpiritRegen: ["Spirit Regeneration", ""], SplashDamage: ["Area Damage", "pct"], Str: ["Strength", ""], StrDex: ["Strength and Dexterity", ""],
  StrInt: ["Strength and Intelligence", ""], StrVit: ["Strength and Vitality", ""], Thorns: ["Thorns", ""], Vit: ["Vitality", ""],
  WrathHeals: ["Life per Wrath Spent", ""], WrathRegen: ["Wrath Regeneration", ""], FuryHeals: ["Life per Fury Spent", ""], Sockets: ["Socket", ""],
  "item power": ["Legendary power", ""],
};

// stems that are noise for a player
export const HIDDEN = /^(BindOnEquip|Khalim_|SoulHarvester_|Inferior |Superior |Dex 14_|Int 14_|Str 14_|Vit 14_|FurySetPoint)/;

const camel = (s) => s.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
const CLASS_TAG = { DemonHunter: "Demon Hunter", WitchDoctor: "Witch Doctor" };

const HALCYON = { Barbarian: "Wrath of the Berserker", Crusader: "Akarat's Champion", DemonHunter: "Vengeance", Monk: "Epiphany",
  Necromancer: "Land of the Dead", WitchDoctor: "Big Bad Voodoo", Wizard: "Archon" };
// a weapon's on-hit crowd-control chance (WeaponHitFear1h, WeaponHitStun2h ...) reads like the same chance on other items (HitFear, HitStun)
const alias = (stem) => {
  const m = /^Weapon ?Hit ?([A-Za-z]+?)[12]h$/.exec(stem);
  return m && STATS["Hit" + m[1]] ? "Hit" + m[1] : stem;
};

export function statName(stem) {
  const i18nKey = "stat_" + stem;
  if (typeof window !== "undefined" && window.t && window.t(i18nKey) !== i18nKey) return window.t(i18nKey);
  if (STATS[alias(stem)]) return STATS[alias(stem)][0];
  // Halcyon's Ascent's power, one per class ("x1_deadmau5_amulet_Wizard"): enemies are mesmerized when the hero uses that class's big cooldown
  let m = /^(?:x1_)?deadmau5_amulet_(\w+)$/.exec(stem);
  if (m && HALCYON[m[1]]) return `Mesmerize on ${HALCYON[m[1]]} (Halcyon's Ascent)`;
  m = /^Skill_(\w+?)_(.+)$/.exec(stem);
  if (m) return camel(m[2]) + " damage";
  m = /^Ethereal_(\w+?)_(.+)$/.exec(stem);
  if (m) return camel(m[2]) + " (" + (CLASS_TAG[m[1]] || camel(m[1])) + " passive)";
  return camel(stem);
}

export function isPct(stem) {
  if (STATS[alias(stem)]) return STATS[alias(stem)][1] === "pct";
  return /^Skill_/.test(stem);
}

// The game shows these life stats cut down to their first 11 significant bits (a multiple of 2^(e-10) for a value in [2^e, 2^(e+1))): a
// multiple of 2 from 2,048, of 4 from 4,096, of 8 from 8,192, of 16 from 16,384, of 32 from 32,768. Seen in game, model -> screen: Life per Hit
// 27,348 -> 27,344, 21,967 -> 21,952, 17,997 -> 17,984, 8,813 -> 8,808, 8,796 -> 8,792; Life Regeneration 5,267 -> 5,264, 7,427 -> 7,424, and
// 4,888 stays 4,888; Life after Each Kill 17,385 -> 17,376 and 11,590 -> 11,584 (LEDGER V34, V112, V116, V122, V160). A plain "multiple of 16"
// misses the three values under 16,384. Life per Fury Spent (2,435 -> 2,434) is one observation. Not every big stat does it: Thorns 6,543 and a
// weapon's 2,325 damage show exact. Only stats seen to do it are listed.
const CUT_TO_11_BITS = new Set(["HitLife", "Regen", "KillLife", "FuryHeals"]);

export function cutTo11Bits(v) {
  if (!(v >= 2048)) return v;
  const step = 2 ** (Math.floor(Math.log2(v)) - 10);
  return Math.floor(v / step) * step;
}

export function fmtValue(stem, v) {
  if (stem === "Sockets" || stem === "Indestructible") return "";
  if (Number.isNaN(v)) return "?";
  if (isPct(stem)) return (Math.round(v * 1000) / 10).toString() + "%";
  if (CUT_TO_11_BITS.has(stem)) v = cutTo11Bits(v);
  return Math.round(v).toLocaleString("en-US");
}

export const CLASS_NAMES = { DemonHunter: "Demon Hunter", WitchDoctor: "Witch Doctor" };

export const SLOT_NAMES = {
  Helm: "Helm", Shoulders: "Shoulders", Bracers: "Bracers", Gloves: "Gloves", Boots: "Boots", Legs: "Pants", Belt: "Belt", Chest: "Chest Armor",
  Cloak: "Cloak", Amulet: "Amulet", Ring: "Ring", Quiver: "Quiver", Mojo: "Mojo", Orb: "Source", Shield: "Shield", CrusaderShield: "Crusader Shield",
  VoodooMask: "Voodoo Mask", WizardHat: "Wizard Hat", SpiritStone_Monk: "Spirit Stone", Sword: "Sword (1H)", Sword2H: "Sword (2H)", Axe: "Axe (1H)",
  Axe2H: "Axe (2H)", Mace: "Mace (1H)", Mace2H: "Mace (2H)", Dagger: "Dagger", Spear: "Spear", Polearm: "Polearm", Staff: "Staff", Wand: "Wand",
  Bow: "Bow", Crossbow: "Crossbow", HandXbow: "Hand Crossbow", Scythe1H: "Scythe (1H)", Scythe2H: "Scythe (2H)", Flail1H: "Flail (1H)",
  Flail2H: "Flail (2H)", MightyWeapon1H: "Mighty Weapon (1H)", MightyWeapon2H: "Mighty Weapon (2H)", CeremonialDagger: "Ceremonial Knife", FistWeapon: "Fist Weapon", MightyBelt: "Mighty Belt", Phylactery: "Phylactery", Daibo: "Daibo",
  TemplarRelic: "Templar Relic", EnchantressFocus: "Enchantress Focus", ScoundrelToken: "Scoundrel Token",
};

export const RECIPES = {
  H: { "Death's Breath": 25, "Reusable Parts": 50, "Arcane Dust": 50, "Veiled Crystal": 50 },
  R: { "Khanduran Rune": 5, "Caldeum Nightshade": 5, "Arreat War Tapestry": 5, "Corrupted Angel Flesh": 5, "Westmarch Holy Water": 5, "Forgotten Soul": 50 },
  P: { "Primordial Ashes": 100 },
  S: { "Angelic Crucible": 1 },
  C: { "Forgotten Soul": 10, "Death's Breath": 10 },
};

export function materials(hit) {
  const t = {};
  const add = (k, n) => { for (const [m, c] of Object.entries(RECIPES[k])) t[m] = (t[m] || 0) + c * n; };
  add("H", hit.hope);
  for (const [op, n] of hit.route) add(op, n);
  return t;
}

// Short community names for the result headlines ("Dex, Vit, CHC"); anything not listed falls back to statName.
const ABBR = {
  Dex: "Dex", Str: "Str", Int: "Int", Vit: "Vit", CriticalChance: "CHC", CriticalD: "CHD", CooldownReduction: "CDR", Haste: "IAS",
  ResourceCostReduction: "RCR", SplashDamage: "Area Dmg", DamageVsElite: "Elite Dmg", DamReductionVsElite: "Elite Dmg Red.", Life: "Life %",
  ResistAll: "All Res", Run: "Move Speed", Damage: "% Dam", MinMaxDam: "Damage Range", DefenseMelee: "Melee Red.", DefenseMissile: "Ranged Red.", Block: "Block",
  DexInt: "Dex+Int", DexVit: "Dex+Vit", IntVit: "Int+Vit", StrDex: "Str+Dex", StrInt: "Str+Int", StrVit: "Str+Vit", Sockets: "Socket",
  Thorns: "Thorns", Gold: "Gold Find", MF: "Magic Find",
};
export const statAbbr = (stem) => ABBR[stem] || ABBR[alias(stem)] || statName(stem);

// Secondary (blue-tooltip) affixes: only shown in a result's headline when the player asked for one.
const SECONDARY = new Set([
  "Gold", "MF", "GoldPickUpRadius", "HealthGlobeBonus", "HealthGlobeChance", "Thorns", "Experience", "REQ", "Indestructible", "HitLife", "HitMana",
  "KillLife", "KillMana", "LifeS", "Regen", "ManaRegen", "HatredRegen", "SpiritRegen", "WrathRegen", "ArcanePowerOnCrit", "SpiritHeals", "WrathHeals", "FuryHeals",
  "HitBlind", "HitChill", "HitFear", "HitFreeze", "HitImmobilize", "HitKnockback", "HitSlow", "HitStun", "Bleed",
]);
// every "on hit" crowd-control chance (HitFear, HitStun2h ...) and every single-element resistance is secondary too
export const isSecondary = (stem) => SECONDARY.has(stem) || /^(Weapon ?)?Hit/.test(stem) || (/Resist$/.test(stem) && stem !== "ResistAll");

// Weapon damage lines come as two rolls: the minimum, then the spread added on top (range = min .. min + spread).
export const RANGE_STEMS = new Set(["MinMaxDam", "ArcaneD", "ColdD", "FireD", "HolyD", "LightningD", "PoisonD", "PhysicalD"]);
export const WEAPON_SLOTS = new Set(["Sword", "Sword2H", "Axe", "Axe2H", "Mace", "Mace2H", "Dagger", "Spear", "Polearm", "Staff", "Wand", "Bow", "Crossbow",
  "HandXbow", "Scythe1H", "Scythe2H", "Flail1H", "Flail2H", "MightyWeapon1H", "MightyWeapon2H", "CeremonialDagger", "FistWeapon", "Daibo"]);

// Crafting-material icons: drop PNGs named `file` into web/icons/ and they replace the coloured placeholder tile automatically.
// Materials the recipes always use in equal numbers; shown as one wide icon with a single count.
export const MATERIAL_GROUPS = [
  { file: "fan-common.webp", names: ["Reusable Parts", "Arcane Dust", "Veiled Crystal"] },
  { file: "fan-legendary.webp", names: ["Khanduran Rune", "Caldeum Nightshade", "Arreat War Tapestry", "Corrupted Angel Flesh", "Westmarch Holy Water"] },
];

export const MATERIAL_ICONS = {
  "Death's Breath": { file: "deaths-breath.webp", abbr: "DB", color: "#6b3fa0" },
  "Reusable Parts": { file: "reusable-parts.webp", abbr: "RP", color: "#8a6d3b" },
  "Arcane Dust": { file: "arcane-dust.webp", abbr: "AD", color: "#3f6fb5" },
  "Veiled Crystal": { file: "veiled-crystal.webp", abbr: "VC", color: "#a04a86" },
  "Forgotten Soul": { file: "forgotten-soul.webp", abbr: "FS", color: "#3a8f8a" },
  "Khanduran Rune": { file: "khanduran-rune.webp", abbr: "KR", color: "#b5533c" },
  "Caldeum Nightshade": { file: "caldeum-nightshade.webp", abbr: "CN", color: "#4f8a3c" },
  "Arreat War Tapestry": { file: "arreat-war-tapestry.webp", abbr: "AT", color: "#9a7b2f" },
  "Corrupted Angel Flesh": { file: "corrupted-angel-flesh.webp", abbr: "CA", color: "#b05a6a" },
  "Westmarch Holy Water": { file: "westmarch-holy-water.webp", abbr: "HW", color: "#3f86a8" },
  "Primordial Ashes": { file: "primordial-ashes.webp", abbr: "PA", color: "#c2562b" },
  "Angelic Crucible": { file: "angelic-crucible.webp", abbr: "AC", color: "#c9b471" },
};

export function itemName(name) {
  if (!name) return name;
  if (typeof window !== "undefined") {
    const lookup = window.tZh || window.t;
    if (typeof lookup === "function") {
      const translated = lookup(name);
      if (translated !== name) return translated;
    }
  }
  return name;
}