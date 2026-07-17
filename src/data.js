/**
 * Abyssal Weight v2 content contract.
 *
 * Field conventions:
 * - World coordinates use the 320 x 180 logical canvas. Rectangles are { x, y, w, h }.
 * - Room index and depth are zero- and one-based respectively. Boss rooms are 4, 9, and 14.
 * - Wave group enemy keys reference ENEMIES; boss keys reference BOSSES. Every point is a legal spawn.
 * - Timings are seconds, movement/projectile speeds are logical pixels per second, angles are degrees.
 * - Damage and HP use the 100-HP player scale. Range/radius/distance values are logical pixels.
 * - Pattern, brain, trigger, and effect type strings are stable dispatch IDs for the runtime.
 * - All exports contain JSON-serializable data only; no behavior functions are stored here.
 */

export const BASE_WORLD = {
  w: 320,
  h: 180,
  bounds: { x: 8, y: 12, w: 304, h: 160 },
};

export const BIOMES = [
  {
    id: 'mosswound',
    index: 0,
    name: 'The Mosswound Shaft',
    shortName: 'Mosswound',
    depthLabel: '0–300 fathoms',
    rooms: [0, 1, 2, 3, 4],
    boss: 'rootbound',
    shortcutRoom: 0,
    accent: '#73d18b',
    shadow: '#13221d',
    floor: '#24342d',
    wall: '#102019',
    projectile: '#a5f0a8',
    ambient: '#375b43',
    floorSprite: 0,
    wallSprite: 28,
    musicMode: 'mosswound',
    hazardFamily: 'living_moss',
    descentThreat: [4, 6, 8, 10, 0],
    ascentThreat: [26, 24, 23, 22, 20],
  },
  {
    id: 'crystal',
    index: 1,
    name: 'The Glass Cathedral',
    shortName: 'Cathedral',
    depthLabel: '300–650 fathoms',
    rooms: [5, 6, 7, 8, 9],
    boss: 'glass_saint',
    shortcutRoom: 5,
    accent: '#62e4ee',
    shadow: '#10182c',
    floor: '#1d2940',
    wall: '#0d1428',
    projectile: '#a9f8ff',
    ambient: '#315d7a',
    floorSprite: 48,
    wallSprite: 40,
    musicMode: 'cathedral',
    hazardFamily: 'refraction',
    descentThreat: [9, 11, 13, 15, 0],
    ascentThreat: [23, 22, 21, 20, 18],
  },
  {
    id: 'foundry',
    index: 2,
    name: 'The Sunken Foundry',
    shortName: 'Foundry',
    depthLabel: '650–900 fathoms',
    rooms: [10, 11, 12, 13, 14],
    boss: 'furnace_king',
    shortcutRoom: 10,
    accent: '#f0a05c',
    shadow: '#28120f',
    floor: '#36251f',
    wall: '#1d1110',
    projectile: '#ffc078',
    ambient: '#7a3e2a',
    floorSprite: 14,
    wallSprite: 14,
    musicMode: 'foundry',
    hazardFamily: 'machinery',
    descentThreat: [14, 16, 18, 20, 0],
    ascentThreat: [21, 20, 18, 18, 16],
  },
];

export const ENEMIES = {
  mire_skitter: {
    id: 'mire_skitter', name: 'Mire Skitter', faction: 'descent', biome: 'mosswound',
    sprite: 120, color: '#84d17f', shadowColor: '#244529', radius: 4.2,
    hp: 28, poise: 24, speed: 58, preferredRange: 13, brain: 'flank_melee', threatCost: 1,
    attacks: [
      { id: 'double_pounce', pattern: 'pounce_pair', tell: 0.20, active: 0.10, recovery: 0.48, cooldown: [0.65, 0.95], range: 15, damage: 8, tokenCost: 1, speed: 112, repeatDelay: 0.16, predict: 0.18, wallStun: 0.65 },
    ],
    loot: { value: [8, 12], weight: [1, 2] },
  },
  mire_spitter: {
    id: 'mire_spitter', name: 'Mire Spitter', faction: 'descent', biome: 'mosswound',
    sprite: 121, color: '#75c89c', shadowColor: '#1f4033', radius: 5,
    hp: 42, poise: 32, speed: 35, preferredRange: 62, brain: 'kite_volley', threatCost: 2,
    attacks: [
      { id: 'mire_fan', pattern: 'projectile_fan', tell: 0.22, active: 0.04, recovery: 0.44, cooldown: [1.05, 1.35], range: 90, damage: 9, tokenCost: 1, projectileSpeed: 78, projectileRadius: 1.8, count: 3, spread: 11, aimLock: 0.62 },
    ],
    brainParams: { relocateAfterAttacks: 2, minRange: 52, maxRange: 74 },
    loot: { value: [12, 18], weight: [2, 3] },
  },
  rootkeeper: {
    id: 'rootkeeper', name: 'Rootkeeper', faction: 'descent', biome: 'mosswound',
    sprite: 122, color: '#4da667', shadowColor: '#16331f', radius: 6,
    hp: 70, poise: 54, speed: 25, preferredRange: 38, brain: 'lane_controller', threatCost: 3,
    attacks: [
      { id: 'raise_vines', pattern: 'spawn_barrier', tell: 0.38, active: 0.08, recovery: 0.52, cooldown: [3.2, 4.1], range: 72, damage: 0, tokenCost: 2, barrier: { w: 40, h: 8, hp: 55, life: 7, slow: 0.35 } },
      { id: 'root_swipe', pattern: 'melee_arc', tell: 0.28, active: 0.12, recovery: 0.62, cooldown: [0.9, 1.3], range: 16, damage: 12, tokenCost: 1, arc: 95 },
    ],
    loot: { value: [20, 28], weight: [3, 5] },
  },
  bellcap: {
    id: 'bellcap', name: 'Bellcap', faction: 'descent', biome: 'mosswound',
    sprite: 119, color: '#bdcf72', shadowColor: '#414823', radius: 5,
    hp: 36, poise: 26, speed: 10, preferredRange: 58, brain: 'stationary_artillery', threatCost: 2,
    attacks: [
      { id: 'spore_pod', pattern: 'lob_interactive_mine', tell: 0.34, active: 0.06, recovery: 0.55, cooldown: [1.45, 1.9], range: 86, damage: 10, tokenCost: 1, flight: 0.72, armTime: 1.2, fuse: 2.4, blastRadius: 18, redirectable: true, enemyStun: 0.8 },
    ],
    loot: { value: [14, 21], weight: [2, 4] },
  },
  shardling: {
    id: 'shardling', name: 'Shardling', faction: 'descent', biome: 'crystal',
    sprite: 123, color: '#75e8ef', shadowColor: '#21485b', radius: 4,
    hp: 32, poise: 22, speed: 50, preferredRange: 16, brain: 'sidestep_melee', threatCost: 1,
    attacks: [
      { id: 'shard_jab', pattern: 'sidestep_jab', tell: 0.18, active: 0.08, recovery: 0.38, cooldown: [0.55, 0.85], range: 14, damage: 7, tokenCost: 1, sidesteps: 3, sidestepTime: 0.12 },
    ],
    deathPattern: { pattern: 'split_unless_crushed', count: 2, childHp: 10, childScale: 0.62, preventedBy: ['melee', 'reflected'] },
    loot: { value: [12, 17], weight: [1, 3] },
  },
  glass_adept: {
    id: 'glass_adept', name: 'Glass Adept', faction: 'descent', biome: 'crystal',
    sprite: 96, color: '#78bde8', shadowColor: '#24355e', radius: 5,
    hp: 52, poise: 36, speed: 38, preferredRange: 57, brain: 'blink_marksman', threatCost: 2,
    attacks: [
      { id: 'echo_bolts', pattern: 'predictive_pair', tell: 0.24, active: 0.16, recovery: 0.34, cooldown: [0.85, 1.15], range: 96, damage: 10, tokenCost: 1, projectileSpeed: 103, projectileRadius: 1.5, count: 2, interval: 0.12, predict: 0.20 },
      { id: 'prism_blink', pattern: 'blink_to_anchor', tell: 0.30, active: 0.02, recovery: 0.28, cooldown: [2.2, 3.0], range: 0, damage: 0, tokenCost: 0, minPlayerDistance: 37 },
    ],
    loot: { value: [18, 26], weight: [2, 4] },
  },
  prism_lancer: {
    id: 'prism_lancer', name: 'Prism Lancer', faction: 'descent', biome: 'crystal',
    sprite: 97, color: '#82f5ff', shadowColor: '#21566c', radius: 6,
    hp: 78, poise: 58, speed: 30, preferredRange: 68, brain: 'ricochet_sniper', threatCost: 3,
    attacks: [
      { id: 'refraction_lance', pattern: 'ricochet_lance', tell: 0.36, active: 0.05, recovery: 0.75, cooldown: [1.45, 1.9], range: 120, damage: 15, tokenCost: 2, projectileSpeed: 125, projectileRadius: 1.3, reflections: 1, aimLock: 0.61, exposedTime: 0.75 },
    ],
    loot: { value: [26, 36], weight: [4, 6] },
  },
  resonator: {
    id: 'resonator', name: 'Resonator', faction: 'descent', biome: 'crystal',
    sprite: 108, color: '#a588ed', shadowColor: '#35285b', radius: 5.6,
    hp: 66, poise: 48, speed: 28, preferredRange: 48, brain: 'support_pulse', threatCost: 3,
    attacks: [
      { id: 'resonant_ring', pattern: 'offset_ring', tell: 0.42, active: 0.05, recovery: 0.58, cooldown: [1.8, 2.4], range: 96, damage: 11, tokenCost: 2, projectileSpeed: 65, projectileRadius: 1.6, count: 8 },
      { id: 'tune_ally', pattern: 'ally_haste_link', tell: 0.36, active: 0.08, recovery: 0.45, cooldown: [3.4, 4.5], range: 70, damage: 0, tokenCost: 1, recoveryMultiplier: 0.8, linkBreakStun: 0.45 },
    ],
    loot: { value: [24, 34], weight: [3, 5] },
  },
  riveter: {
    id: 'riveter', name: 'Riveter', faction: 'descent', biome: 'foundry',
    sprite: 110, color: '#e59a56', shadowColor: '#542d1d', radius: 5.4,
    hp: 58, poise: 42, speed: 33, preferredRange: 62, brain: 'burst_gunner', threatCost: 2,
    attacks: [
      { id: 'rivet_burst', pattern: 'aimed_burst', tell: 0.22, active: 0.45, recovery: 1.05, cooldown: [0.7, 1.0], range: 105, damage: 8, tokenCost: 1, projectileSpeed: 110, projectileRadius: 1.4, count: 5, interval: 0.09, aimTracking: 0.08, armorDuringRecovery: 0 },
    ],
    loot: { value: [24, 35], weight: [3, 5] },
  },
  slag_crawler: {
    id: 'slag_crawler', name: 'Slag Crawler', faction: 'descent', biome: 'foundry',
    sprite: 118, color: '#ef6e48', shadowColor: '#592116', radius: 4.8,
    hp: 48, poise: 32, speed: 45, preferredRange: 15, brain: 'trail_hunter', threatCost: 2,
    attacks: [
      { id: 'slag_leap', pattern: 'fixed_leap', tell: 0.25, active: 0.14, recovery: 0.46, cooldown: [0.8, 1.2], range: 18, damage: 10, tokenCost: 1, speed: 105, aimLock: 0.55 },
    ],
    movementTrail: { pattern: 'hot_trail', radius: 3.5, damage: 5, tick: 0.45, life: 3, quenchedEffect: 'slow_field' },
    loot: { value: [20, 31], weight: [3, 5] },
  },
  furnace_brute: {
    id: 'furnace_brute', name: 'Furnace Brute', faction: 'descent', biome: 'foundry',
    sprite: 117, color: '#dc7044', shadowColor: '#4d1d14', radius: 7,
    hp: 115, poise: 82, speed: 28, preferredRange: 24, brain: 'armored_charger', threatCost: 4,
    armor: { arc: 150, reduction: 0.6, brokenDuration: 2.0 },
    attacks: [
      { id: 'furnace_charge', pattern: 'wall_stun_charge', tell: 0.32, active: 0.70, recovery: 0.58, cooldown: [1.8, 2.5], range: 92, damage: 20, tokenCost: 2, speed: 137, turnAfterRelease: 0, wallStun: 1.2 },
      { id: 'backhand', pattern: 'melee_arc', tell: 0.27, active: 0.12, recovery: 0.55, cooldown: [0.9, 1.3], range: 18, damage: 14, tokenCost: 1, arc: 120 },
    ],
    loot: { value: [36, 50], weight: [5, 8] },
  },
  bellows_priest: {
    id: 'bellows_priest', name: 'Bellows Priest', faction: 'descent', biome: 'foundry',
    sprite: 125, color: '#f2b65c', shadowColor: '#5d3518', radius: 5.8,
    hp: 74, poise: 50, speed: 30, preferredRange: 48, brain: 'channel_support', threatCost: 3,
    attacks: [
      { id: 'stoke_ally', pattern: 'interruptible_empower', tell: 0.28, active: 0.75, recovery: 0.42, cooldown: [3.0, 4.0], range: 75, damage: 0, tokenCost: 2, attackSpeedBonus: 0.18, moveSpeedBonus: 0.12, duration: 5 },
      { id: 'bellows_sweep', pattern: 'sweeping_cone', tell: 0.30, active: 0.90, recovery: 0.62, cooldown: [1.7, 2.2], range: 43, damage: 12, tokenCost: 2, arc: 65, sweep: 65, blockedByObstacles: true },
    ],
    loot: { value: [30, 43], weight: [4, 7] },
  },
  bailiff: {
    id: 'bailiff', name: 'Burden Bailiff', faction: 'ascent', biome: 'all',
    sprite: 102, color: '#d6b565', shadowColor: '#4b3920', radius: 6.2,
    hp: 90, poise: 68, speed: 37, preferredRange: 17, brain: 'shield_advance', threatCost: 3,
    armor: { arc: 150, projectileReduction: 1, meleeReduction: 0.5, terrainStun: 0.9 },
    attacks: [
      { id: 'shield_bash', pattern: 'stepped_shield_bash', tell: 0.26, active: 0.13, recovery: 0.64, cooldown: [0.95, 1.35], range: 17, damage: 14, tokenCost: 2, advanceBeats: 3, knockback: 20 },
    ],
    loot: { value: [28, 40], weight: [0, 0] },
  },
  chain_clerk: {
    id: 'chain_clerk', name: 'Chain Clerk', faction: 'ascent', biome: 'all',
    sprite: 97, color: '#d7c4a0', shadowColor: '#4a4034', radius: 5.4,
    hp: 68, poise: 44, speed: 35, preferredRange: 58, brain: 'tether_controller', threatCost: 3,
    attacks: [
      { id: 'file_lien', pattern: 'tether_anchor', tell: 0.30, active: 0.07, recovery: 0.48, cooldown: [2.5, 3.2], range: 82, damage: 8, tokenCost: 2, projectileSpeed: 96, tetherRange: 60, reelSpeed: 13, chainHits: 3, lineBreakTime: 0.35 },
    ],
    loot: { value: [24, 35], weight: [0, 0] },
  },
  confiscator: {
    id: 'confiscator', name: 'Confiscator', faction: 'ascent', biome: 'all',
    sprite: 120, color: '#e5c86d', shadowColor: '#55451b', radius: 4.6,
    hp: 56, poise: 30, speed: 58, preferredRange: 14, brain: 'cargo_thief', threatCost: 2,
    attacks: [
      { id: 'seal_cargo', pattern: 'steal_then_flee', tell: 0.20, active: 0.11, recovery: 0.18, cooldown: [2.1, 2.8], range: 14, damage: 4, tokenCost: 1, speed: 118, targetRule: 'heaviest_active_cargo', escapeRule: 'nearest_ascent_gate', escapeResult: 'room_coffer' },
    ],
    loot: { value: [20, 30], weight: [0, 0] },
  },
  toll_hound: {
    id: 'toll_hound', name: 'Toll Hound', faction: 'ascent', biome: 'all',
    sprite: 120, color: '#d87652', shadowColor: '#50251b', radius: 4.4,
    hp: 46, poise: 30, speed: 62, preferredRange: 20, brain: 'predictive_charger', threatCost: 2,
    attacks: [
      { id: 'collecting_charge', pattern: 'wall_stun_charge', tell: 0.22, active: 0.48, recovery: 0.36, cooldown: [0.72, 1.05], range: 68, damage: 15, tokenCost: 1, speed: 132, predict: 0.35, turnAfterRelease: 0, wallStun: 1.1 },
    ],
    loot: { value: [19, 28], weight: [0, 0] },
  },
  appraiser: {
    id: 'appraiser', name: 'Abyss Appraiser', faction: 'ascent', biome: 'all',
    sprite: 121, color: '#f0d783', shadowColor: '#59491f', radius: 5.4,
    hp: 72, poise: 45, speed: 33, preferredRange: 55, brain: 'burden_debuffer', threatCost: 3,
    attacks: [
      { id: 'appraise_burden', pattern: 'temporary_weight_beam', tell: 0.35, active: 0.20, recovery: 0.65, cooldown: [2.7, 3.5], range: 78, damage: 6, tokenCost: 2, lienWeight: 12, maxLiens: 1, removedOnSourceDeath: true },
    ],
    loot: { value: [28, 41], weight: [0, 0] },
  },
  counterfeit: {
    id: 'counterfeit', name: 'Counterfeit', faction: 'ascent', biome: 'all',
    sprite: 98, color: '#cc8f71', shadowColor: '#4e2d28', radius: 5.6,
    hp: 76, poise: 50, speed: 42, preferredRange: 46, brain: 'copy_player_action', threatCost: 3,
    attacks: [
      { id: 'counterfeit_action', pattern: 'copy_last_player_action', tell: 0.32, active: 0.12, recovery: 0.58, cooldown: [1.5, 2.0], range: 84, damage: 13, tokenCost: 2, replayDelay: 0.55, mappings: { chainblade: 'hostile_melee_arc', repeater: 'hostile_burst', maul: 'hostile_shock_cone', prism: 'hostile_ricochet' } },
    ],
    loot: { value: [32, 46], weight: [0, 0] },
  },
  writ_bearer: {
    id: 'writ_bearer', name: 'Writ Bearer', faction: 'ascent', biome: 'all',
    sprite: 108, color: '#b9a58b', shadowColor: '#42382f', radius: 5.5,
    hp: 62, poise: 40, speed: 30, preferredRange: 64, brain: 'reinforcement_channel', threatCost: 3,
    attacks: [
      { id: 'open_seal', pattern: 'reinforcement_channel', tell: 0.60, active: 10.0, recovery: 0.40, cooldown: [3.0, 3.0], range: 0, damage: 0, tokenCost: 2, interruptPause: 3, maxWaves: 2, reinforcementBudget: 3 },
      { id: 'wax_shot', pattern: 'slow_orb', tell: 0.27, active: 0.05, recovery: 0.45, cooldown: [1.2, 1.6], range: 90, damage: 7, tokenCost: 1, projectileSpeed: 52, projectileRadius: 2.1 },
    ],
    loot: { value: [30, 44], weight: [0, 0] },
  },
  root_notary: {
    id: 'root_notary', name: 'Root Notary Varn', faction: 'ascent', biome: 'mosswound', elite: true,
    sprite: 122, color: '#d0ba68', shadowColor: '#3c3b1e', radius: 7,
    hp: 360, poise: 120, speed: 38, preferredRange: 34, brain: 'collector_captain_root', threatCost: 8,
    attacks: [
      { id: 'notary_hook', pattern: 'hook_pull_slam', tell: 0.27, active: 0.25, recovery: 0.62, cooldown: [1.1, 1.5], range: 76, damage: 17, tokenCost: 2, projectileSpeed: 118, pullDistance: 32 },
      { id: 'ledger_wall', pattern: 'barrier_cross', tell: 0.40, active: 0.08, recovery: 0.72, cooldown: [3.0, 4.0], range: 70, damage: 0, tokenCost: 2, barrierHp: 65, barrierLife: 6 },
    ],
    loot: { value: [85, 105], weight: [0, 0] },
  },
  quartz_auditor: {
    id: 'quartz_auditor', name: 'The Quartz Auditor', faction: 'ascent', biome: 'crystal', elite: true,
    sprite: 97, color: '#e4defd', shadowColor: '#3e365e', radius: 7,
    hp: 440, poise: 135, speed: 36, preferredRange: 58, brain: 'collector_captain_mirror', threatCost: 9,
    attacks: [
      { id: 'audit_lance', pattern: 'mirrored_ricochet_pair', tell: 0.30, active: 0.09, recovery: 0.62, cooldown: [1.0, 1.4], range: 110, damage: 17, tokenCost: 2, projectileSpeed: 115, reflections: 2 },
      { id: 'mirror_contract', pattern: 'copy_last_player_action', tell: 0.38, active: 0.12, recovery: 0.70, cooldown: [2.8, 3.6], range: 95, damage: 16, tokenCost: 2, replayDelay: 0.48 },
    ],
    loot: { value: [110, 135], weight: [0, 0] },
  },
  crown_collector: {
    id: 'crown_collector', name: 'Collector of Crowns', faction: 'ascent', biome: 'foundry', elite: true,
    sprite: 110, color: '#f4c06a', shadowColor: '#5b341d', radius: 7.5,
    hp: 520, poise: 150, speed: 34, preferredRange: 28, brain: 'collector_captain_forge', threatCost: 10,
    attacks: [
      { id: 'crown_magnet', pattern: 'magnetic_pull_burst', tell: 0.34, active: 0.75, recovery: 0.55, cooldown: [2.2, 2.9], range: 82, damage: 8, tokenCost: 2, pullSpeed: 17, burstCount: 6, burstSpeed: 73 },
      { id: 'royal_hammer', pattern: 'hammer_line_then_cross', tell: 0.30, active: 0.28, recovery: 0.68, cooldown: [1.0, 1.5], range: 48, damage: 20, tokenCost: 2, lineWidth: 14, crossDelay: 0.20 },
    ],
    loot: { value: [135, 165], weight: [0, 0] },
  },
};

export const BOSSES = {
  rootbound: {
    id: 'rootbound', name: 'The Rootbound', title: 'Gate-Heart of the Mosswound', biome: 'mosswound',
    sprite: 122, color: '#72cf75', shadowColor: '#17331c', hp: 900, poise: 210,
    radius: 12, speed: 26, contactDamage: 10, rewardCargo: ['rootbound_arm', 'moss_eyed_idol'],
    phaseThresholds: [0.70, 0.35], phaseTransitionTime: 0.8,
    phases: [
      {
        id: 'rootbound_heart', hpFrom: 1, hpTo: 0.70, moveScale: 1,
        patternDeck: [
          { pattern: 'root_thorn_lash', weight: 4, cooldown: [0.75, 1.05], tell: 0.32, swipes: 3, interval: 0.16, arc: 75, damage: 16, finalProjectiles: 5, projectileSpeed: 70, spread: 13 },
          { pattern: 'root_seed_mortar', weight: 3, cooldown: [1.0, 1.4], tell: 0.40, count: 3, flight: 0.75, podLife: 6, blastRadius: 20, damage: 14, meleeDetonationStun: 0.8 },
          { pattern: 'root_burrow_rush', weight: 2, cooldown: [1.2, 1.6], tell: 0.28, vanish: 0.55, predict: 0.25, emergeDamage: 18, ringCount: 11, ringSpeed: 58, safeGap: 70 },
        ],
      },
      {
        id: 'rootbound_maze', hpFrom: 0.70, hpTo: 0.35, moveScale: 1.08,
        enter: { pattern: 'grow_root_maze', barrierCount: 3, barrierHp: 100, barrierLife: 12, rearrangeEvery: 12 },
        summons: [
          { atHp: 0.65, enemy: 'mire_skitter', count: 2, points: [{ x: 49, y: 137 }, { x: 271, y: 137 }] },
          { atHp: 0.50, enemy: 'mire_skitter', count: 2, points: [{ x: 49, y: 42 }, { x: 271, y: 42 }] },
        ],
        patternDeck: [
          { pattern: 'root_thorn_lash', weight: 3, cooldown: [0.68, 0.95], tell: 0.29, swipes: 3, interval: 0.15, arc: 82, damage: 17, finalProjectiles: 5, projectileSpeed: 74, spread: 12 },
          { pattern: 'root_wall_wave', weight: 3, cooldown: [1.0, 1.35], tell: 0.36, waves: 2, interval: 0.30, speed: 63, damage: 16, followsBarriers: true },
          { pattern: 'root_seed_mortar', weight: 2, cooldown: [1.1, 1.45], tell: 0.36, count: 4, flight: 0.68, podLife: 5, blastRadius: 19, damage: 15, meleeDetonationStun: 0.7 },
        ],
      },
      {
        id: 'rootbound_uprooted', hpFrom: 0.35, hpTo: 0, moveScale: 1.25,
        exposedAfterDeck: { duration: 1.25, damageTakenMultiplier: 1.25 },
        sequenceDeck: [
          ['root_thorn_lash_fast', 'root_burrow_rush_fast'],
          ['root_seed_mortar_fast', 'root_thorn_lash_fast'],
        ],
        patterns: {
          root_thorn_lash_fast: { pattern: 'root_thorn_lash', tell: 0.25, swipes: 3, interval: 0.13, arc: 85, damage: 18, finalProjectiles: 7, projectileSpeed: 78, spread: 10 },
          root_burrow_rush_fast: { pattern: 'root_burrow_rush', tell: 0.23, vanish: 0.46, predict: 0.30, emergeDamage: 20, ringCount: 13, ringSpeed: 66, safeGap: 60 },
          root_seed_mortar_fast: { pattern: 'root_seed_mortar', tell: 0.31, count: 4, flight: 0.62, podLife: 4.5, blastRadius: 18, damage: 16 },
        },
      },
    ],
  },
  glass_saint: {
    id: 'glass_saint', name: 'The Glass Saint', title: 'Martyr of Refraction', biome: 'crystal',
    sprite: 97, color: '#8aeef5', shadowColor: '#1c3d59', hp: 1300, poise: 260,
    radius: 11, speed: 32, contactDamage: 12, rewardCargo: ['glass_heart', 'saints_prism'],
    phaseThresholds: [0.70, 0.32], phaseTransitionTime: 0.75,
    phases: [
      {
        id: 'saint_whole', hpFrom: 1, hpTo: 0.70, moveScale: 1,
        patternDeck: [
          { pattern: 'saint_refraction_lance', weight: 4, cooldown: [0.75, 1.0], tell: 0.36, count: 3, angles: [-12, 0, 12], projectileSpeed: 93, reflections: 1, damage: 17, aimLock: 0.61 },
          { pattern: 'saint_glass_step', weight: 3, cooldown: [0.9, 1.2], tell: 0.22, teleportDelay: 0.18, crossCount: 4, projectileSpeed: 82, damage: 16, safeAxes: 'diagonal' },
          { pattern: 'saint_halo_burst', weight: 2, cooldown: [1.2, 1.6], tell: 0.45, rings: 2, countPerRing: 8, ringDelay: 0.28, projectileSpeed: [55, 66], damage: 14, safeGap: 70, offsetSecondRing: 22.5 },
        ],
      },
      {
        id: 'saint_mirrored', hpFrom: 0.70, hpTo: 0.32, moveScale: 1.08,
        enter: { pattern: 'spawn_mirror_images', count: 2, cloneHp: 1, cloneDisableTime: 6, trueTell: 'opaque_shadow' },
        patternDeck: [
          { pattern: 'saint_clone_lances', weight: 4, cooldown: [0.78, 1.08], tell: 0.32, lanes: 3, projectileSpeed: 97, reflections: 1, damage: 17 },
          { pattern: 'saint_prism_cage', weight: 3, cooldown: [1.4, 1.8], tell: 0.42, closeTime: 1.2, prismHp: 90, beamDamage: 19, dashableSideTell: 'flicker' },
          { pattern: 'saint_glass_step', weight: 3, cooldown: [0.82, 1.1], tell: 0.20, teleportDelay: 0.16, repeats: 2, crossCount: 4, projectileSpeed: 87, damage: 17, safeAxes: 'diagonal' },
        ],
      },
      {
        id: 'saint_shattered', hpFrom: 0.32, hpTo: 0, moveScale: 1.15,
        enter: { pattern: 'shatter_prism_pillars', ricochetNodes: 4 },
        fixedSequence: ['saint_five_lance', 'saint_double_step', 'saint_offset_halo'],
        fracture: { source: 'deflected_lance', poise: 60, required: 3, stun: 2 },
        patterns: {
          saint_five_lance: { pattern: 'saint_refraction_lance', tell: 0.29, count: 5, spread: 10, projectileSpeed: 104, reflections: 1, damage: 18 },
          saint_double_step: { pattern: 'saint_glass_step', tell: 0.18, repeats: 2, repeatDelay: 0.42, crossCount: 4, projectileSpeed: 92, damage: 18 },
          saint_offset_halo: { pattern: 'saint_halo_burst', tell: 0.36, rings: 2, countPerRing: 12, ringDelay: 0.24, projectileSpeed: [60, 72], damage: 15, safeGap: 48, offsetSecondRing: 15 },
        },
      },
    ],
  },
  furnace_king: {
    id: 'furnace_king', name: 'The Furnace King', title: 'Sovereign of the Last Forge', biome: 'foundry',
    sprite: 110, color: '#f19a4e', shadowColor: '#572214', hp: 1800, poise: 330,
    radius: 13, speed: 29, contactDamage: 14, rewardCargo: ['furnace_crown', 'anvil_core', 'kings_tithe'],
    phaseThresholds: [0.68, 0.30], phaseTransitionTime: 0.85,
    phases: [
      {
        id: 'king_enthroned', hpFrom: 1, hpTo: 0.68, moveScale: 1,
        patternDeck: [
          { pattern: 'king_hammer_rail', weight: 4, cooldown: [0.78, 1.05], tell: 0.34, lineWidth: 15, lineDamage: 21, crossDelay: 0.22, crossDamage: 17, crossSpeed: 78 },
          { pattern: 'king_bellows_sweep', weight: 3, cooldown: [1.0, 1.35], tell: 0.28, active: 1.1, range: 58, arc: 65, maxSweep: 90, damage: 19, blockedByObstacles: true },
          { pattern: 'king_crucible_toss', weight: 3, cooldown: [1.15, 1.5], tell: 0.36, count: 3, flight: 0.65, poolLife: 5, poolRadius: 15, damage: 16, returnableBy: ['deflect', 'maul'] },
        ],
      },
      {
        id: 'king_unarmored', hpFrom: 0.68, hpTo: 0.30, moveScale: 1.12,
        enter: { pattern: 'equip_core_plates', plates: 3, reductionPerPlate: 0.2, breakSources: ['reflected_rivet', 'quench_wall_stun'] },
        patternDeck: [
          { pattern: 'king_quench_charge', weight: 4, cooldown: [0.85, 1.15], tell: 0.30, speed: 140, damage: 23, turnAfterRelease: 0, wallStun: 1.2, plateBreak: 1 },
          { pattern: 'king_rivet_fan', weight: 4, cooldown: [0.72, 0.95], tell: 0.24, count: 7, interval: 0.08, arc: 72, projectileSpeed: 112, damage: 12, reflectable: true },
          { pattern: 'king_hammer_rail', weight: 2, cooldown: [0.72, 0.95], tell: 0.30, lineWidth: 16, lineDamage: 22, crossDelay: 0.20, crossDamage: 18, crossSpeed: 84 },
        ],
      },
      {
        id: 'king_overload', hpFrom: 0.30, hpTo: 0, moveScale: 1.20,
        arenaCycle: { pattern: 'rotating_safe_grates', period: 12, step: 3, safeGrates: 4, tell: 0.55, damage: 8, tick: 0.45 },
        fixedSequence: ['king_hammer_triple', 'king_rivet_fan_fast', 'king_bellows_sweep_fast'],
        counterplay: { pattern: 'quench_valve_stun', hitsRequired: 3, stun: 1.5, resetsArenaCycle: true },
        patterns: {
          king_hammer_triple: { pattern: 'hammer_combo_ring', tell: 0.22, strikes: 3, interval: 0.30, damage: 22, finalRingCount: 14, finalRingSpeed: 83, safeGaps: 2 },
          king_rivet_fan_fast: { pattern: 'king_rivet_fan', tell: 0.20, count: 9, interval: 0.065, arc: 90, projectileSpeed: 118, damage: 13 },
          king_bellows_sweep_fast: { pattern: 'king_bellows_sweep', tell: 0.24, active: 1.0, range: 62, arc: 70, maxSweep: 110, damage: 20, blockedByObstacles: true },
        },
      },
    ],
  },
};

export const WEAPONS = {
  chainblade: {
    id: 'chainblade', name: 'Undertow Chainblade', kind: 'melee', starter: true,
    description: 'A mobile three-beat cutter with a hook that turns enemies and anchors into movement tools.',
    sprite: 103, color: '#dfe7d5', moveScale: 1, aimMode: 'free',
    resource: { type: 'combo', steps: 3, resetAfter: 0.50, queueWindow: 0.12 },
    primary: {
      input: 'primary', pattern: 'melee_combo', buffer: 0.10,
      timeline: [
        { step: 1, startup: 0.06, active: 0.07, recovery: 0.03, damage: 17, poise: 14, range: 19, arc: 80, moveStep: 2 },
        { step: 2, startup: 0.06, active: 0.07, recovery: 0.03, damage: 17, poise: 14, range: 19, arc: 80, moveStep: 2 },
        { step: 3, startup: 0.09, active: 0.09, recovery: 0.07, damage: 30, poise: 28, range: 21, arc: 95, moveStep: 6 },
      ],
      cancels: { dashAfterActive: true, deflectAfter: 0.08 },
    },
    technique: {
      id: 'undertow_hook', pattern: 'hook_pull_or_grapple', cooldown: 3.8,
      timeline: [{ startup: 0.12 }, { active: 0.12 }, { recovery: 0.18 }],
      damage: 26, poise: 20, range: 83, projectileSpeed: 150,
      pullEnemy: 33, pullPlayerToHeavy: 38, anchorTags: ['heavy', 'wall_anchor', 'boss'],
    },
    unlock: { type: 'starter' },
  },
  repeater: {
    id: 'repeater', name: 'Rivet Repeater', kind: 'ranged', starter: false,
    description: 'A mobile automatic sidearm with a pinning stake for creating burst windows.',
    sprite: 113, color: '#e9b26e', moveScale: 1, aimMode: 'free',
    resource: { type: 'magazine', capacity: 12, reload: 0.85, reserve: 'infinite', reloadContinuesThroughDash: true },
    primary: {
      input: 'primary', pattern: 'automatic_projectile', buffer: 0.10,
      timeline: [{ startup: 0.035 }, { active: 0.015 }, { recovery: 0.11 }],
      damage: 11, poise: 7, projectileSpeed: 120, projectileRadius: 1.2, range: 150, interval: 0.16,
      spread: 2.5, cancels: { dashAfterActive: true, deflectAfter: 0.06 },
    },
    technique: {
      id: 'pinning_bolt', pattern: 'charged_pin_projectile', cooldown: 4.5,
      timeline: [{ startup: 0.25 }, { active: 0.02 }, { recovery: 0.20 }],
      damage: 34, poise: 30, projectileSpeed: 153, projectileRadius: 1.8, range: 180,
      smallEnemyPin: 0.8, eliteMark: { shots: 3, bonusDamage: 6, duration: 5 },
    },
    unlock: { type: 'meta_upgrade', id: 'license_repeater' },
  },
  maul: {
    id: 'maul', name: 'Bell Maul', kind: 'heavy_melee', starter: false,
    description: 'A moving armor-breaker whose charged aftershock erases bullets and opens executions.',
    sprite: 105, color: '#f2c87e', moveScale: 0.76, aimMode: 'free',
    resource: { type: 'impact_charge', max: 100, gainOnHit: 20, gainOnDeflect: 35, passiveDecay: 0 },
    primary: {
      input: 'primary', pattern: 'heavy_melee_arc', buffer: 0.10,
      timeline: [{ startup: 0.18 }, { active: 0.10 }, { recovery: 0.18 }],
      damage: 42, poise: 55, range: 22, arc: 105, moveStep: 8,
      cancels: { dashAfter: 0.18, deflectAfterActive: true },
    },
    technique: {
      id: 'bell_aftershock', pattern: 'charged_ground_cone', cooldown: 5.2,
      timeline: [{ minCharge: 0.16, maxCharge: 0.60 }, { active: 0.10 }, { recovery: 0.24 }],
      damage: 30, poise: 75, range: 40, arc: 78, moveScaleDuringCharge: 0.60,
      fullCharge: { clearBulletRadius: 18, returnableTags: ['crucible_blob'] },
    },
    unlock: { type: 'meta_upgrade_and_sigils', id: 'license_maul', sigils: ['root'] },
  },
  prism: {
    id: 'prism', name: 'Prism Rifle', kind: 'precision_ranged', starter: false,
    description: 'A deliberate ricochet rifle that constructs temporary geometry for split shots.',
    sprite: 101, color: '#8cecf5', moveScale: 0.92, aimMode: 'free',
    resource: { type: 'magazine', capacity: 6, reload: 1.0, reserve: 'infinite', reloadContinuesThroughDash: true },
    primary: {
      input: 'primary', pattern: 'ricochet_projectile', buffer: 0.10,
      timeline: [{ startup: 0.08 }, { active: 0.02 }, { recovery: 0.24 }],
      damage: 26, poise: 18, projectileSpeed: 173, projectileRadius: 1.25, range: 210,
      reflections: 1, reflectedDamageMultiplier: 1.25,
      cancels: { dashAfterActive: true, deflectAfter: 0.10 },
    },
    technique: {
      id: 'place_prism', pattern: 'place_shot_splitter', cooldown: 8,
      timeline: [{ startup: 0.14 }, { active: 0.03 }, { recovery: 0.16 }],
      placeRange: 73, life: 6, hp: 60, splitCount: 2, splitDamageMultiplier: 0.70, splitAngle: 18,
    },
    unlock: { type: 'meta_upgrade_and_sigils', id: 'license_prism', sigils: ['glass'] },
  },
};

export const TECHNIQUES = [
  {
    id: 'razor_wake', name: 'Razor Wake', rarity: 'common', tags: ['dash', 'damage'], compatible: ['all'],
    trigger: 'on_dash', effect: { type: 'damage_trail', length: 24, width: 5, damage: 18, life: 0.35, hitsPerEnemyPerDash: 1 },
    description: 'Dashes leave a cutting wake that damages each enemy once.', unlock: { type: 'base_pool' },
  },
  {
    id: 'slip_chamber', name: 'Slip Chamber', rarity: 'common', tags: ['dash', 'resource'], compatible: ['all'],
    trigger: 'on_dash', effect: { type: 'weapon_resource_restore', magazineFraction: 0.25, meleeTechniqueCooldown: -0.6 },
    description: 'Dashing reloads firearms or advances a melee technique cooldown.', unlock: { type: 'base_pool' },
  },
  {
    id: 'counterstep', name: 'Counterstep', rarity: 'uncommon', tags: ['deflect', 'burst'], compatible: ['all'],
    trigger: 'on_melee_deflect', effect: { type: 'refresh_dash_and_empower', primaryDamageMultiplier: 1.35, duration: 1.5 },
    description: 'Melee deflects refresh dash and empower the next primary.', unlock: { type: 'base_pool' },
  },
  {
    id: 'return_postage', name: 'Return Postage', rarity: 'uncommon', tags: ['deflect', 'projectile'], compatible: ['all'],
    trigger: 'on_projectile_deflect', effect: { type: 'modify_reflected_projectile', damageMultiplier: 1.8, pierce: 1, speedMultiplier: 1.15 },
    description: 'Reflected projectiles hit much harder and pierce once.', unlock: { type: 'base_pool' },
  },
  {
    id: 'chain_reaction', name: 'Chain Reaction', rarity: 'common', tags: ['technique', 'combo'], compatible: ['all'],
    trigger: 'on_technique_hit', effect: { type: 'mark_for_primary_detonation', duration: 4, damage: 22, radius: 15 },
    description: 'Technique hits mark targets; a primary detonates the mark.', unlock: { type: 'base_pool' },
  },
  {
    id: 'serrated_rhythm', name: 'Serrated Rhythm', rarity: 'uncommon', tags: ['combo', 'speed'], compatible: ['all'],
    trigger: 'on_alternating_primary_technique', effect: { type: 'stack_attack_speed', perStack: 0.08, maxStacks: 4, duration: 3, resetOnRepeat: true },
    description: 'Alternating primary and technique builds attack speed.', unlock: { type: 'base_pool' },
  },
  {
    id: 'undertow_teeth', name: 'Undertow Teeth', rarity: 'common', tags: ['technique', 'control'], compatible: ['all'],
    trigger: 'on_technique_hit', effect: { type: 'pull_and_armor_break', pull: 23, armorReduction: 0.15, duration: 2, excludes: ['boss'] },
    description: 'Techniques pull light enemies and briefly crack armor.', unlock: { type: 'base_pool' },
  },
  {
    id: 'hollow_points', name: 'Hollow Points', rarity: 'uncommon', tags: ['ranged', 'pierce'], compatible: ['repeater', 'prism'],
    trigger: 'on_projectile_hit', effect: { type: 'pierce_gain_damage', pierce: 1, postPierceDamageMultiplier: 1.25 },
    description: 'Shots pierce once and gain damage after passing through a target.', unlock: { type: 'base_pool' },
  },
  {
    id: 'prism_chamber', name: 'Prism Chamber', rarity: 'rare', tags: ['ranged', 'multishot'], compatible: ['repeater', 'prism'],
    trigger: 'on_projectile_fired', effect: { type: 'periodic_split_shot', every: 5, copies: 2, angles: [-16, 16], damageMultiplier: 0.6 },
    description: 'Every fifth projectile splits into two angled copies.', unlock: { type: 'survey_rooms', count: 4 },
  },
  {
    id: 'hot_rivets', name: 'Hot Rivets', rarity: 'uncommon', tags: ['hit_chain', 'burn'], compatible: ['all'],
    trigger: 'on_hit_counter', effect: { type: 'periodic_burn', every: 8, burnDamage: 18, burnDuration: 2.5, meleeBurstDamage: 10, meleeBurstRadius: 13 },
    description: 'Every eighth hit burns; melee hits burst burning targets.', unlock: { type: 'base_pool' },
  },
  {
    id: 'moss_trap', name: 'Moss Trap', rarity: 'common', tags: ['kill', 'trap'], compatible: ['all'],
    trigger: 'on_enemy_kill', effect: { type: 'spawn_enemy_only_mine', armTime: 0.55, damage: 24, radius: 14, life: 8 },
    description: 'Kills plant a thorn mine for the next enemy.', unlock: { type: 'boss_sigils', sigils: ['root'] },
  },
  {
    id: 'blood_ledger', name: 'Blood Ledger', rarity: 'rare', tags: ['drive', 'sustain'], compatible: ['all'],
    trigger: 'on_kill_at_drive', condition: { driveAtLeast: 100 }, effect: { type: 'heal', amount: 8, perRoomCap: 1 },
    description: 'The first kill at maximum Drive each room heals 8 HP.', unlock: { type: 'successful_extractions', count: 2 },
  },
  {
    id: 'paid_in_full', name: 'Paid in Full', rarity: 'uncommon', tags: ['drive', 'technique'], compatible: ['all'],
    trigger: 'while_drive_above', condition: { driveAtLeast: 75 }, effect: { type: 'technique_cooldown_rate', multiplier: 1.3 },
    description: 'High Drive accelerates weapon techniques.', unlock: { type: 'base_pool' },
  },
  {
    id: 'weighted_edge', name: 'Weighted Edge', rarity: 'uncommon', tags: ['burden', 'damage'], compatible: ['all'],
    trigger: 'on_burden_changed', effect: { type: 'damage_per_weight', step: 25, damagePerStep: 0.05, maxBonus: 0.25, crushingDashPoiseBonus: 20 },
    description: 'Cargo weight increases damage and strengthens the Crushing shoulder.', unlock: { type: 'boss_sigils', sigils: ['root'] },
  },
  {
    id: 'flywheel_harness', name: 'Flywheel Harness', rarity: 'rare', tags: ['burden', 'deflect'], compatible: ['all'],
    trigger: 'on_deflect', condition: { minimumBurdenTier: 'laden' }, effect: { type: 'radial_shards', count: 6, damage: 12, speed: 88, internalCooldown: 2 },
    description: 'Deflecting while burdened fires a shard halo.', unlock: { type: 'boss_sigils', sigils: ['glass'] },
  },
  {
    id: 'black_balloon', name: 'Black Balloon', rarity: 'rare', tags: ['economy', 'risk'], compatible: ['all'],
    trigger: 'on_balloon', effect: { type: 'balloon_tradeoff', retentionBonus: 0.25, ascentThreatBudget: 1 },
    description: 'Balloons retain far more value, but Collectors reinforce the ascent.', unlock: { type: 'meta_upgrade_rank', id: 'reinforced_pulleys', rank: 1 },
  },
  {
    id: 'cursed_dividend', name: 'Cursed Dividend', rarity: 'rare', tags: ['economy', 'curse'], compatible: ['all'],
    trigger: 'on_cargo_offer', effect: { type: 'curse_tradeoff', valueMultiplier: 1.4, beneficialCurseMultiplier: 2, attentionGainMultiplier: 1.25 },
    description: 'Cursed cargo is richer and stronger, while the Abyss notices faster.', unlock: { type: 'survey_rooms', count: 8 },
  },
  {
    id: 'quench_capsule', name: 'Quench Capsule', rarity: 'rare', tags: ['active', 'projectile'], compatible: ['all'],
    trigger: 'active_relic', effect: { type: 'bullet_clear_charge', cooldown: 14, radius: 30, damagePerBullet: 2, maxStoredDamage: 40 },
    description: 'Clear nearby bullets and store their force in the next hit.', unlock: { type: 'boss_sigils', sigils: ['forge'] },
  },
  {
    id: 'echo_seal', name: 'Echo Seal', rarity: 'rare', tags: ['technique', 'echo'], compatible: ['all'],
    trigger: 'on_technique_resolved', effect: { type: 'repeat_technique', delay: 0.32, powerMultiplier: 0.5, baseCooldownMultiplier: 1.15 },
    description: 'Techniques echo at half power but recharge more slowly.', unlock: { type: 'boss_sigils', sigils: ['glass'] },
  },
  {
    id: 'execution_order', name: 'Execution Order', rarity: 'uncommon', tags: ['poise', 'elite'], compatible: ['all'],
    trigger: 'passive', effect: { type: 'poise_and_elite_refund', poiseMultiplier: 1.35, eliteTechniqueRefund: 0.5 },
    description: 'Break poise faster; elite kills refund technique cooldown.', unlock: { type: 'successful_extractions', count: 1 },
  },
];

export const CARGO = [
  {
    id: 'moss_eyed_idol', name: 'Moss-Eyed Idol', biome: 'mosswound', rarity: 'uncommon',
    sprite: 108, color: '#8ed584', value: 120, weight: 16, curse: 0.08, ascentActivated: true,
    effects: [
      { type: 'drive_gain_multiplier', value: 1.20 },
      { type: 'enemy_recovery_multiplier', value: 0.92 },
    ],
    description: 'Drive rises faster, but enemies recover sooner.',
  },
  {
    id: 'hunter_bell', name: 'Hunter Bell', biome: 'mosswound', rarity: 'common',
    sprite: 125, color: '#d2cc72', value: 105, weight: 12, curse: 0.05, ascentActivated: true,
    effects: [
      { type: 'deflected_projectile_split', copies: 2, angle: 14, damageMultiplier: 0.55 },
      { type: 'ascent_threat_budget', value: 1 },
    ],
    description: 'Deflected shots fork, and the bell calls one more Collector into each budget.',
  },
  {
    id: 'spore_censer', name: 'Spore Censer', biome: 'mosswound', rarity: 'uncommon',
    sprite: 114, color: '#b2cf78', value: 145, weight: 18, curse: 0, ascentActivated: true,
    effects: [
      { type: 'dash_slow_cloud', radius: 15, slow: 0.30, life: 2.2, internalCooldown: 1.5 },
    ],
    description: 'Dashes leave a brief cloud that slows enemies, never the carrier.',
  },
  {
    id: 'rootbound_arm', name: 'Rootbound Arm', biome: 'mosswound', rarity: 'boss',
    sprite: 117, color: '#63b56e', value: 210, weight: 26, curse: 0.08, ascentActivated: true, bossSource: 'rootbound',
    effects: [
      { type: 'primary_poise_multiplier', value: 1.25 },
      { type: 'periodic_root_on_hit', every: 5, duration: 0.45, excludes: ['boss'] },
      { type: 'attention_gain_multiplier', value: 1.08 },
    ],
    description: 'Primary blows break poise and periodically root prey; the Abyss notices faster.',
  },
  {
    id: 'glass_heart', name: 'Glass Heart', biome: 'crystal', rarity: 'boss',
    sprite: 101, color: '#7debf2', value: 320, weight: 24, curse: 0.10, ascentActivated: true, bossSource: 'glass_saint',
    effects: [
      { type: 'technique_cooldown_multiplier', value: 0.80 },
      { type: 'max_hp_flat', value: -10 },
    ],
    description: 'Techniques recharge rapidly, but the carrier becomes fragile.',
  },
  {
    id: 'saints_prism', name: "Saint's Prism", biome: 'crystal', rarity: 'boss',
    sprite: 101, color: '#b4f8ff', value: 350, weight: 30, curse: 0.07, ascentActivated: true, bossSource: 'glass_saint',
    effects: [
      { type: 'all_projectiles_reflect', count: 1, reflectedDamageMultiplier: 1.15 },
      { type: 'enemy_projectile_speed_multiplier', value: 1.06 },
    ],
    description: 'All player shots gain a reflection; hostile fire travels slightly faster.',
  },
  {
    id: 'chime_reliquary', name: 'Chime Reliquary', biome: 'crystal', rarity: 'uncommon',
    sprite: 82, color: '#a9dfea', value: 220, weight: 15, curse: 0, ascentActivated: true,
    effects: [
      { type: 'periodic_deflect_pulse', every: 3, radius: 22, damage: 18, poise: 24 },
    ],
    description: 'Every third deflect rings a damaging, poise-breaking pulse.',
  },
  {
    id: 'mirror_ledger', name: 'Mirror Ledger', biome: 'crystal', rarity: 'rare',
    sprite: 113, color: '#d8c9ff', value: 275, weight: 19, curse: 0.06, ascentActivated: true,
    effects: [
      { type: 'post_dash_repeat_hit', delay: 0.25, damageMultiplier: 0.45, internalCooldown: 2.0 },
      { type: 'counterfeit_spawn_weight', value: 1.25 },
    ],
    description: 'The first hit after a dash echoes, but Counterfeits take greater interest.',
  },
  {
    id: 'boiler_lung', name: 'Boiler Lung', biome: 'foundry', rarity: 'uncommon',
    sprite: 114, color: '#efa657', value: 310, weight: 22, curse: 0.06, ascentActivated: true,
    effects: [
      { type: 'attack_speed_multiplier', value: 1.18 },
      { type: 'periodic_forced_vent', every: 8, radius: 15, damage: 14, selfLock: 0.12 },
    ],
    description: 'Attack faster and periodically vent a close shockwave.',
  },
  {
    id: 'anvil_core', name: 'Anvil Core', biome: 'foundry', rarity: 'boss',
    sprite: 117, color: '#f2b468', value: 560, weight: 40, curse: 0, ascentActivated: true, bossSource: 'furnace_king',
    effects: [
      { type: 'heavy_hit_damage_multiplier', value: 1.45 },
      { type: 'crushing_dash_damage', damage: 40, poise: 65 },
    ],
    description: 'Heavy hits become devastating and the Crushing shoulder becomes a weapon.',
  },
  {
    id: 'furnace_crown', name: 'Furnace Crown', biome: 'foundry', rarity: 'boss',
    sprite: 108, color: '#ffb45e', value: 620, weight: 40, curse: 0.09, ascentActivated: true, bossSource: 'furnace_king',
    effects: [
      { type: 'damage_above_drive', drive: 75, multiplier: 1.30 },
      { type: 'dash_cooldown_multiplier', value: 1.15 },
    ],
    description: 'High Drive becomes ferocious, while dashes recover more slowly.',
  },
  {
    id: 'kings_tithe', name: "King's Tithe", biome: 'foundry', rarity: 'legendary',
    sprite: 108, color: '#ffd06a', value: 800, weight: 46, curse: 0.14, ascentActivated: true,
    effects: [
      { type: 'first_technique_free_each_room', charges: 1 },
      { type: 'captain_room_extra_elite', enemyPool: ['bailiff', 'counterfeit', 'chain_clerk'] },
    ],
    description: 'The first technique in every room refreshes instantly; captains gain elite support.',
  },
];

export const META_UPGRADES = {
  license_repeater: {
    id: 'license_repeater', name: 'Repeater License', category: 'armory', maxRank: 1, costs: [8],
    prerequisites: [], effects: [{ type: 'unlock_weapon', id: 'repeater' }],
  },
  license_maul: {
    id: 'license_maul', name: 'Bell Maul License', category: 'armory', maxRank: 1, costs: [16],
    prerequisites: [{ type: 'boss_sigils', sigils: ['root'] }], effects: [{ type: 'unlock_weapon', id: 'maul' }],
  },
  license_prism: {
    id: 'license_prism', name: 'Prism Rifle License', category: 'armory', maxRank: 1, costs: [28],
    prerequisites: [{ type: 'boss_sigils', sigils: ['glass'] }], effects: [{ type: 'unlock_weapon', id: 'prism' }],
  },
  field_rations: {
    id: 'field_rations', name: 'Field Rations', category: 'survival', maxRank: 2, costs: [8, 24],
    prerequisites: [], effects: [{ type: 'max_hp_by_rank', values: [110, 120] }],
  },
  reinforced_frame: {
    id: 'reinforced_frame', name: 'Reinforced Frame', category: 'burden', maxRank: 3, costs: [6, 18, 36],
    prerequisites: [], effects: [{ type: 'burden_threshold_bonus_by_rank', values: [5, 10, 15] }],
  },
  dash_bearings: {
    id: 'dash_bearings', name: 'Dash Bearings', category: 'mobility', maxRank: 2, costs: [10, 28],
    prerequisites: [], effects: [{ type: 'dash_cooldown_multiplier_by_rank', values: [0.94, 0.88] }],
  },
  reflex_coil: {
    id: 'reflex_coil', name: 'Reflex Coil', category: 'defense', maxRank: 2, costs: [12, 32],
    prerequisites: [], effects: [{ type: 'deflect_window_bonus_by_rank', values: [0.012, 0.024] }],
  },
  basin_lens: {
    id: 'basin_lens', name: 'Basin Lens', category: 'build', maxRank: 2, costs: [8, 22],
    prerequisites: [], effects: [{ type: 'reward_rerolls_per_biome_by_rank', values: [1, 2] }],
  },
  forge_slot: {
    id: 'forge_slot', name: 'Forge Slot', category: 'build', maxRank: 2, costs: [18, 45],
    prerequisites: [{ type: 'successful_extractions', count: 1 }], effects: [{ type: 'starter_technique_choice_count_by_rank', values: [2, 3] }],
  },
  reinforced_pulleys: {
    id: 'reinforced_pulleys', name: 'Reinforced Pulleys', category: 'economy', maxRank: 3, costs: [6, 16, 34],
    prerequisites: [], effects: [{ type: 'balloon_retention_by_rank', values: [0.20, 0.30, 0.40] }],
  },
  relic_harness: {
    id: 'relic_harness', name: 'Relic Harness', category: 'burden', maxRank: 2, costs: [20, 42],
    prerequisites: [{ type: 'boss_sigils', sigils: ['root'] }], effects: [{ type: 'first_boss_cargo_weight_reduction_by_rank', values: [8, 16] }],
  },
  field_surgery: {
    id: 'field_surgery', name: 'Field Surgery', category: 'survival', maxRank: 2, costs: [12, 30],
    prerequisites: [], effects: [{ type: 'boss_clear_heal_by_rank', values: [25, 35] }],
  },
};

export const DEFAULT_META_V2 = {
  version: 2,
  grit: 0,
  totalExtracted: 0,
  deepestRoom: 0,
  runs: 0,
  successfulExtractions: 0,
  fullExtractions: 0,
  selectedWeapon: 'chainblade',
  unlockedWeapons: ['chainblade'],
  unlockedTechniques: [
    'razor_wake', 'slip_chamber', 'counterstep', 'return_postage', 'chain_reaction',
    'serrated_rhythm', 'undertow_teeth', 'hollow_points', 'hot_rivets', 'paid_in_full',
  ],
  discoveredCargo: [],
  upgrades: {
    license_repeater: 0,
    license_maul: 0,
    license_prism: 0,
    field_rations: 0,
    reinforced_frame: 0,
    dash_bearings: 0,
    reflex_coil: 0,
    basin_lens: 0,
    forge_slot: 0,
    reinforced_pulleys: 0,
    relic_harness: 0,
    field_surgery: 0,
  },
  bossSigils: { root: false, glass: false, forge: false },
  shortcuts: [true, false, false],
  roomClearance: [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  surveyGritClaimed: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  bestiarySeen: [],
  settings: { muted: false, reducedMotion: false, screenShake: 1, highContrastProjectiles: false },
  statistics: {
    roomsCleared: 0,
    bossesDefeated: 0,
    damageTaken: 0,
    deflects: 0,
    peakDrive: 0,
    cargoBallooned: 0,
  },
};

const MOSS_ROOMS = [
  {
    id: 'moss_mouth', index: 0, depth: 1, biome: 'mosswound', name: 'The Mouth', subtitle: 'The green dark learns your name.',
    boss: false, reward: 'technique', floorTile: 0, wallTile: 28,
    clearance: { requiresRoom: null, unlocksRoom: 1, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'north_shelf', x: 52, y: 47, w: 50, h: 10, material: 'root_stone' },
      { id: 'south_shelf', x: 218, y: 119, w: 50, h: 10, material: 'root_stone' },
      { id: 'west_stump', x: 48, y: 119, w: 24, h: 13, material: 'root' },
      { id: 'east_stump', x: 248, y: 47, w: 24, h: 13, material: 'root' },
    ],
    hazards: [
      { id: 'closing_roots_left', type: 'soft_wall_growth', rect: { x: 14, y: 34, w: 26, h: 126 }, delay: 28, growTime: 8, maxInset: 10, damage: 0 },
      { id: 'closing_roots_right', type: 'soft_wall_growth', rect: { x: 280, y: 34, w: 26, h: 126 }, delay: 28, growTime: 8, maxInset: 10, damage: 0 },
    ],
    decor: [
      { sprite: 125, x: 25, y: 28, scale: 1, tint: '#7acb82' },
      { sprite: 65, x: 291, y: 145, scale: 1, tint: '#5a8d69' },
      { sprite: 63, x: 36, y: 151, scale: 1, tint: '#586b4f' },
      { sprite: 29, x: 287, y: 29, scale: 1, tint: '#5fc97c' },
    ],
    descentBudget: 4,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'mire_skitter', count: 2, points: [{ x: 45, y: 142 }, { x: 275, y: 142 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'mire_skitter', count: 1, points: [{ x: 268, y: 84 }] }, { enemy: 'mire_spitter', count: 1, points: [{ x: 50, y: 82 }] }] },
    ],
    ascentBudget: 26,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'writ_bearer', count: 1, points: [{ x: 160, y: 45 }] }, { enemy: 'bailiff', count: 2, points: [{ x: 83, y: 84 }, { x: 237, y: 84 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'toll_hound', count: 2, points: [{ x: 45, y: 42 }, { x: 275, y: 42 }] }, { enemy: 'confiscator', count: 1, points: [{ x: 64, y: 96 }] }, { enemy: 'appraiser', count: 1, points: [{ x: 256, y: 96 }] }, { enemy: 'counterfeit', count: 1, elite: true, points: [{ x: 160, y: 74 }] }] },
    ],
  },
  {
    id: 'flooded_sluice', index: 1, depth: 2, biome: 'mosswound', name: 'Flooded Sluice', subtitle: 'The current chooses a side.',
    boss: false, reward: 'cargo', floorTile: 0, wallTile: 28,
    clearance: { requiresRoom: 0, unlocksRoom: 2, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'sluice_nw', x: 38, y: 44, w: 51, h: 14, material: 'wet_stone' },
      { id: 'sluice_se', x: 231, y: 112, w: 51, h: 14, material: 'wet_stone' },
      { id: 'gate_west', x: 76, y: 91, w: 18, h: 12, material: 'wood' },
      { id: 'gate_east', x: 226, y: 69, w: 18, h: 12, material: 'wood' },
    ],
    hazards: [
      { id: 'west_current', type: 'timed_current', rect: { x: 108, y: 24, w: 20, h: 140 }, period: 6, tell: 0.45, active: 1.4, force: { x: 0, y: 38 }, damage: 0, affects: 'all' },
      { id: 'east_current', type: 'timed_current', rect: { x: 192, y: 24, w: 20, h: 140 }, period: 6, phase: 3, tell: 0.45, active: 1.4, force: { x: 0, y: -38 }, damage: 0, affects: 'all' },
    ],
    decor: [
      { sprite: 82, x: 108, y: 28, scale: 1, tint: '#4c9b78' },
      { sprite: 82, x: 212, y: 150, scale: 1, tint: '#4c9b78' },
      { sprite: 63, x: 22, y: 92, scale: 1, tint: '#4b6a58' },
      { sprite: 63, x: 298, y: 83, scale: 1, tint: '#4b6a58' },
    ],
    descentBudget: 6,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'mire_skitter', count: 2, points: [{ x: 55, y: 140 }, { x: 270, y: 140 }] }, { enemy: 'bellcap', count: 1, points: [{ x: 260, y: 42 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'mire_spitter', count: 2, points: [{ x: 48, y: 72 }, { x: 272, y: 96 }] }, { enemy: 'rootkeeper', count: 1, points: [{ x: 160, y: 82 }] }] },
    ],
    ascentBudget: 24,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'chain_clerk', count: 2, points: [{ x: 50, y: 34 }, { x: 270, y: 43 }] }, { enemy: 'bailiff', count: 1, points: [{ x: 160, y: 70 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'counterfeit', count: 1, points: [{ x: 160, y: 50 }] }, { enemy: 'toll_hound', count: 2, points: [{ x: 52, y: 100 }, { x: 268, y: 100 }] }] },
    ],
  },
  {
    id: 'spore_nursery', index: 2, depth: 3, biome: 'mosswound', name: 'Spore Nursery', subtitle: 'Every bulb is a weapon for someone.',
    boss: false, reward: 'technique', floorTile: 0, wallTile: 28,
    clearance: { requiresRoom: 1, unlocksRoom: 3, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'planter_nw', x: 64, y: 48, w: 22, h: 18, material: 'planter' },
      { id: 'planter_ne', x: 234, y: 48, w: 22, h: 18, material: 'planter' },
      { id: 'planter_sw', x: 64, y: 114, w: 22, h: 18, material: 'planter' },
      { id: 'planter_se', x: 234, y: 114, w: 22, h: 18, material: 'planter' },
    ],
    hazards: [
      { id: 'pod_nw', type: 'interactive_spore_pod', center: { x: 97, y: 72 }, radius: 5, hp: 1, meleeEffect: 'enemy_stun', rangedEffect: 'slow_cloud', respawn: 8 },
      { id: 'pod_ne', type: 'interactive_spore_pod', center: { x: 223, y: 72 }, radius: 5, hp: 1, meleeEffect: 'enemy_stun', rangedEffect: 'slow_cloud', respawn: 8 },
      { id: 'pod_sw', type: 'interactive_spore_pod', center: { x: 97, y: 108 }, radius: 5, hp: 1, meleeEffect: 'enemy_stun', rangedEffect: 'slow_cloud', respawn: 8 },
      { id: 'pod_se', type: 'interactive_spore_pod', center: { x: 223, y: 108 }, radius: 5, hp: 1, meleeEffect: 'enemy_stun', rangedEffect: 'slow_cloud', respawn: 8 },
    ],
    decor: [
      { sprite: 114, x: 45, y: 32, scale: 1, tint: '#91b761' },
      { sprite: 114, x: 275, y: 32, scale: 1, tint: '#91b761' },
      { sprite: 125, x: 38, y: 147, scale: 1, tint: '#6cab70' },
      { sprite: 125, x: 282, y: 147, scale: 1, tint: '#6cab70' },
    ],
    descentBudget: 8,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'rootkeeper', count: 1, points: [{ x: 160, y: 115 }] }, { enemy: 'mire_skitter', count: 2, points: [{ x: 44, y: 140 }, { x: 276, y: 140 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'bellcap', count: 2, points: [{ x: 48, y: 40 }, { x: 272, y: 40 }] }, { enemy: 'mire_spitter', count: 1, points: [{ x: 160, y: 60 }] }, { enemy: 'mire_skitter', count: 1, points: [{ x: 160, y: 134 }] }] },
    ],
    ascentBudget: 23,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'confiscator', count: 2, points: [{ x: 92, y: 76 }, { x: 228, y: 76 }] }, { enemy: 'appraiser', count: 1, points: [{ x: 160, y: 45 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'toll_hound', count: 2, points: [{ x: 46, y: 54 }, { x: 274, y: 54 }] }, { enemy: 'counterfeit', count: 1, points: [{ x: 160, y: 105 }] }] },
    ],
  },
  {
    id: 'hanging_mill', index: 3, depth: 4, biome: 'mosswound', name: 'Hanging Mill', subtitle: 'The chain still remembers its work.',
    boss: false, reward: 'cargo', floorTile: 0, wallTile: 28,
    clearance: { requiresRoom: 2, unlocksRoom: 4, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'mill_hub', x: 152, y: 82, w: 16, h: 16, material: 'ironwood' },
      { id: 'mill_pillar_w', x: 70, y: 76, w: 18, h: 30, material: 'root_stone' },
      { id: 'mill_pillar_e', x: 232, y: 76, w: 18, h: 30, material: 'root_stone' },
      { id: 'winch', x: 150, y: 138, w: 20, h: 10, material: 'interactive_winch' },
    ],
    hazards: [
      { id: 'mill_arm', type: 'rotating_arm', center: { x: 160, y: 90 }, length: 74, width: 5, period: 5.2, direction: 1, damage: 10, knockback: 15, blocksProjectiles: true, reverseSwitch: 'winch', switchCooldown: 5 },
    ],
    decor: [
      { sprite: 63, x: 30, y: 38, scale: 1, tint: '#697356' },
      { sprite: 63, x: 290, y: 38, scale: 1, tint: '#697356' },
      { sprite: 82, x: 34, y: 143, scale: 1, tint: '#5d7057' },
      { sprite: 82, x: 286, y: 143, scale: 1, tint: '#5d7057' },
    ],
    descentBudget: 10,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'rootkeeper', count: 1, elite: true, hpMultiplier: 1.6, points: [{ x: 160, y: 118 }] }, { enemy: 'mire_spitter', count: 2, points: [{ x: 45, y: 45 }, { x: 275, y: 45 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'mire_skitter', count: 2, points: [{ x: 48, y: 136 }, { x: 272, y: 136 }] }, { enemy: 'bellcap', count: 1, points: [{ x: 160, y: 48 }] }] },
    ],
    ascentBudget: 22,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'bailiff', count: 2, points: [{ x: 104, y: 62 }, { x: 216, y: 62 }] }, { enemy: 'writ_bearer', count: 1, points: [{ x: 160, y: 42 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'toll_hound', count: 1, points: [{ x: 160, y: 115 }] }, { enemy: 'confiscator', count: 1, points: [{ x: 45, y: 80 }] }] },
    ],
  },
  {
    id: 'rootbound_gate', index: 4, depth: 5, biome: 'mosswound', name: 'Heartroot Gate', subtitle: 'A forest learned to kneel here.',
    boss: 'rootbound', reward: 'boss_cargo', floorTile: 0, wallTile: 28,
    clearance: { requiresRoom: 3, unlocksRoom: 5, basin: true, shortcutUnlock: 1, sigil: 'root' },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'root_pillar_nw', x: 61, y: 48, w: 23, h: 18, material: 'root_stone' },
      { id: 'root_pillar_ne', x: 236, y: 48, w: 23, h: 18, material: 'root_stone' },
      { id: 'root_pillar_sw', x: 61, y: 116, w: 23, h: 18, material: 'root_stone' },
      { id: 'root_pillar_se', x: 236, y: 116, w: 23, h: 18, material: 'root_stone' },
    ],
    hazards: [
      { id: 'root_maze_slots', type: 'boss_barrier_slots', rects: [{ x: 104, y: 54, w: 8, h: 54 }, { x: 208, y: 72, w: 8, h: 54 }, { x: 126, y: 88, w: 68, h: 8 }], inactiveUntilPattern: 'grow_root_maze' },
    ],
    decor: [
      { sprite: 65, x: 31, y: 36, scale: 1, tint: '#668066' },
      { sprite: 65, x: 289, y: 36, scale: 1, tint: '#668066' },
      { sprite: 29, x: 32, y: 145, scale: 1, tint: '#61b66d' },
      { sprite: 29, x: 288, y: 145, scale: 1, tint: '#61b66d' },
    ],
    descentBudget: 0,
    descentWaves: [
      { delay: 0.65, groups: [{ boss: 'rootbound', count: 1, points: [{ x: 160, y: 108 }] }] },
    ],
    ascentBudget: 20,
    ascentWaves: [
      { delay: 0.55, groups: [{ enemy: 'root_notary', count: 1, points: [{ x: 160, y: 70 }] }, { enemy: 'chain_clerk', count: 2, points: [{ x: 55, y: 58 }, { x: 265, y: 58 }] }] },
    ],
  },
];

const CRYSTAL_ROOMS = [
  {
    id: 'prism_gallery', index: 5, depth: 6, biome: 'crystal', name: 'Prism Gallery', subtitle: 'Every angle has a second intention.',
    boss: false, reward: 'technique', floorTile: 48, wallTile: 40,
    clearance: { requiresRoom: 4, unlocksRoom: 6, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'prism_nw', x: 79, y: 43, w: 12, h: 31, material: 'prism', reflect: true },
      { id: 'prism_center', x: 154, y: 80, w: 12, h: 24, material: 'prism', reflect: true },
      { id: 'prism_se', x: 229, y: 108, w: 12, h: 31, material: 'prism', reflect: true },
      { id: 'gallery_plinth', x: 244, y: 48, w: 28, h: 10, material: 'glass_stone' },
    ],
    hazards: [
      { id: 'gallery_refraction', type: 'reflective_obstacles', obstacleIds: ['prism_nw', 'prism_center', 'prism_se'], reflections: 1, affects: ['player_projectile', 'enemy_projectile'] },
    ],
    decor: [
      { sprite: 101, x: 36, y: 36, scale: 1, tint: '#78dce8' },
      { sprite: 101, x: 284, y: 144, scale: 1, tint: '#78dce8' },
      { sprite: 125, x: 288, y: 35, scale: 1, tint: '#569bbd' },
      { sprite: 125, x: 32, y: 145, scale: 1, tint: '#569bbd' },
    ],
    descentBudget: 9,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'shardling', count: 3, points: [{ x: 45, y: 138 }, { x: 160, y: 132 }, { x: 275, y: 138 }] }, { enemy: 'glass_adept', count: 1, points: [{ x: 260, y: 40 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'glass_adept', count: 2, points: [{ x: 48, y: 48 }, { x: 272, y: 82 }] }, { enemy: 'prism_lancer', count: 1, points: [{ x: 160, y: 48 }] }] },
    ],
    ascentBudget: 23,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'counterfeit', count: 2, points: [{ x: 55, y: 55 }, { x: 265, y: 72 }] }, { enemy: 'confiscator', count: 2, points: [{ x: 92, y: 105 }, { x: 210, y: 130 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'bailiff', count: 1, points: [{ x: 160, y: 65 }] }, { enemy: 'appraiser', count: 1, points: [{ x: 275, y: 90 }] }] },
    ],
  },
  {
    id: 'fracture_bridge', index: 6, depth: 7, biome: 'crystal', name: 'Fracture Bridge', subtitle: 'Break the room before it breaks the route.',
    boss: false, reward: 'cargo', floorTile: 48, wallTile: 40,
    clearance: { requiresRoom: 5, unlocksRoom: 7, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'bridge_nw', x: 34, y: 57, w: 96, h: 8, material: 'breakable_crystal', hp: 55 },
      { id: 'bridge_ne', x: 190, y: 57, w: 96, h: 8, material: 'breakable_crystal', hp: 55 },
      { id: 'bridge_sw', x: 72, y: 116, w: 88, h: 8, material: 'breakable_crystal', hp: 55 },
      { id: 'bridge_se', x: 210, y: 116, w: 76, h: 8, material: 'breakable_crystal', hp: 55 },
    ],
    hazards: [
      { id: 'neutral_shatter', type: 'obstacle_death_burst', material: 'breakable_crystal', tell: 0.18, count: 6, projectileSpeed: 62, damage: 7, affects: 'all', safeRadius: 7 },
      { id: 'ascent_regrowth', type: 'ascent_obstacle_regrow', obstacleIds: ['bridge_nw', 'bridge_ne', 'bridge_sw', 'bridge_se'], delay: 8, regrowOnce: true, tell: 0.55 },
    ],
    decor: [
      { sprite: 101, x: 32, y: 90, scale: 1, tint: '#5fc9dd' },
      { sprite: 101, x: 288, y: 90, scale: 1, tint: '#5fc9dd' },
      { sprite: 65, x: 42, y: 145, scale: 1, tint: '#526d89' },
      { sprite: 65, x: 278, y: 35, scale: 1, tint: '#526d89' },
    ],
    descentBudget: 11,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'resonator', count: 1, points: [{ x: 160, y: 88 }] }, { enemy: 'shardling', count: 3, points: [{ x: 45, y: 138 }, { x: 275, y: 138 }, { x: 245, y: 82 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'prism_lancer', count: 1, points: [{ x: 160, y: 42 }] }, { enemy: 'glass_adept', count: 2, points: [{ x: 48, y: 82 }, { x: 272, y: 82 }] }] },
    ],
    ascentBudget: 22,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'toll_hound', count: 3, points: [{ x: 48, y: 46 }, { x: 160, y: 72 }, { x: 272, y: 46 }] }, { enemy: 'chain_clerk', count: 1, points: [{ x: 52, y: 96 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'appraiser', count: 1, points: [{ x: 268, y: 98 }] }, { enemy: 'counterfeit', count: 1, points: [{ x: 160, y: 48 }] }] },
    ],
  },
  {
    id: 'echo_chapel', index: 7, depth: 8, biome: 'crystal', name: 'Echo Chapel', subtitle: 'Silence is another target.',
    boss: false, reward: 'technique', floorTile: 48, wallTile: 40,
    clearance: { requiresRoom: 6, unlocksRoom: 8, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'chime_nw', x: 67, y: 50, w: 14, h: 14, material: 'chime', hp: 45 },
      { id: 'chime_ne', x: 239, y: 50, w: 14, h: 14, material: 'chime', hp: 45 },
      { id: 'chime_sw', x: 67, y: 116, w: 14, h: 14, material: 'chime', hp: 45 },
      { id: 'chime_se', x: 239, y: 116, w: 14, h: 14, material: 'chime', hp: 45 },
    ],
    hazards: [
      { id: 'echo_links', type: 'enemy_chime_links', obstacleIds: ['chime_nw', 'chime_ne', 'chime_sw', 'chime_se'], linkedRecoveryMultiplier: 0.82, chimeBreakStun: 0.65, ascentWakeNextWave: true },
    ],
    decor: [
      { sprite: 82, x: 42, y: 34, scale: 1, tint: '#8597c7' },
      { sprite: 82, x: 278, y: 34, scale: 1, tint: '#8597c7' },
      { sprite: 29, x: 44, y: 147, scale: 1, tint: '#5687a9' },
      { sprite: 29, x: 276, y: 147, scale: 1, tint: '#5687a9' },
    ],
    descentBudget: 13,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'resonator', count: 2, points: [{ x: 112, y: 83 }, { x: 208, y: 83 }] }, { enemy: 'glass_adept', count: 2, points: [{ x: 45, y: 140 }, { x: 275, y: 140 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'prism_lancer', count: 1, points: [{ x: 160, y: 44 }] }, { enemy: 'resonator', count: 1, points: [{ x: 270, y: 94 }] }, { enemy: 'shardling', count: 2, points: [{ x: 54, y: 84 }, { x: 160, y: 126 }] }] },
    ],
    ascentBudget: 21,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'writ_bearer', count: 1, points: [{ x: 160, y: 46 }] }, { enemy: 'bailiff', count: 2, points: [{ x: 105, y: 85 }, { x: 215, y: 85 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'confiscator', count: 1, points: [{ x: 45, y: 92 }] }, { enemy: 'appraiser', count: 1, points: [{ x: 275, y: 92 }] }, { enemy: 'toll_hound', count: 1, points: [{ x: 160, y: 75 }] }] },
    ],
  },
  {
    id: 'kaleidoscope', index: 8, depth: 9, biome: 'crystal', name: 'Kaleidoscope', subtitle: 'A room that refuses one perspective.',
    boss: false, reward: 'cargo', floorTile: 48, wallTile: 40,
    clearance: { requiresRoom: 7, unlocksRoom: 9, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'rotor_nw', x: 84, y: 54, w: 14, h: 14, material: 'prism_rotor' },
      { id: 'rotor_ne', x: 222, y: 54, w: 14, h: 14, material: 'prism_rotor' },
      { id: 'rotor_sw', x: 84, y: 112, w: 14, h: 14, material: 'prism_rotor' },
      { id: 'rotor_se', x: 222, y: 112, w: 14, h: 14, material: 'prism_rotor' },
      { id: 'center_dais', x: 148, y: 84, w: 24, h: 12, material: 'glass_stone' },
    ],
    hazards: [
      { id: 'rotating_prisms', type: 'rotating_reflectors', obstacleIds: ['rotor_nw', 'rotor_ne', 'rotor_sw', 'rotor_se'], period: 7, reflections: 1, ascentMode: 'narrow_absorb_gap' },
    ],
    decor: [
      { sprite: 101, x: 30, y: 32, scale: 1, tint: '#76dced' },
      { sprite: 101, x: 290, y: 32, scale: 1, tint: '#76dced' },
      { sprite: 101, x: 30, y: 148, scale: 1, tint: '#76dced' },
      { sprite: 101, x: 290, y: 148, scale: 1, tint: '#76dced' },
    ],
    descentBudget: 15,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'prism_lancer', count: 1, elite: true, hpMultiplier: 1.6, points: [{ x: 160, y: 120 }] }, { enemy: 'glass_adept', count: 2, points: [{ x: 45, y: 44 }, { x: 275, y: 44 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'resonator', count: 1, points: [{ x: 160, y: 44 }] }, { enemy: 'shardling', count: 4, points: [{ x: 42, y: 92 }, { x: 278, y: 92 }, { x: 115, y: 137 }, { x: 205, y: 137 }] }] },
    ],
    ascentBudget: 20,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'chain_clerk', count: 2, points: [{ x: 52, y: 56 }, { x: 268, y: 56 }] }, { enemy: 'counterfeit', count: 2, points: [{ x: 110, y: 108 }, { x: 210, y: 108 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'appraiser', count: 1, points: [{ x: 160, y: 50 }] }, { enemy: 'confiscator', count: 1, points: [{ x: 275, y: 96 }] }] },
    ],
  },
  {
    id: 'saints_sanctum', index: 9, depth: 10, biome: 'crystal', name: "Saint's Sanctum", subtitle: 'The faithful reflection waits.',
    boss: 'glass_saint', reward: 'boss_cargo', floorTile: 48, wallTile: 40,
    clearance: { requiresRoom: 8, unlocksRoom: 10, basin: true, shortcutUnlock: 2, sigil: 'glass' },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'saint_prism_w', x: 74, y: 68, w: 13, h: 42, material: 'boss_prism', hp: 90, reflect: true },
      { id: 'saint_prism_n', x: 153, y: 40, w: 14, h: 28, material: 'boss_prism', hp: 90, reflect: true },
      { id: 'saint_prism_e', x: 233, y: 92, w: 13, h: 42, material: 'boss_prism', hp: 90, reflect: true },
    ],
    hazards: [
      { id: 'sanctum_refraction', type: 'boss_prism_network', obstacleIds: ['saint_prism_w', 'saint_prism_n', 'saint_prism_e'], reflections: 1, onDestroy: 'fixed_ricochet_node' },
    ],
    decor: [
      { sprite: 29, x: 30, y: 34, scale: 1, tint: '#75d6e5' },
      { sprite: 29, x: 290, y: 34, scale: 1, tint: '#75d6e5' },
      { sprite: 82, x: 31, y: 147, scale: 1, tint: '#7889af' },
      { sprite: 82, x: 289, y: 147, scale: 1, tint: '#7889af' },
    ],
    descentBudget: 0,
    descentWaves: [
      { delay: 0.65, groups: [{ boss: 'glass_saint', count: 1, points: [{ x: 160, y: 106 }] }] },
    ],
    ascentBudget: 18,
    ascentWaves: [
      { delay: 0.55, groups: [{ enemy: 'quartz_auditor', count: 1, points: [{ x: 160, y: 80 }] }, { enemy: 'counterfeit', count: 2, points: [{ x: 53, y: 58 }, { x: 267, y: 58 }] }] },
    ],
  },
];

const FOUNDRY_ROOMS = [
  {
    id: 'conveyor_cruciform', index: 10, depth: 11, biome: 'foundry', name: 'Conveyor Cruciform', subtitle: 'The floor delivers everyone eventually.',
    boss: false, reward: 'technique', floorTile: 14, wallTile: 14,
    clearance: { requiresRoom: 9, unlocksRoom: 11, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'foundry_block_nw', x: 35, y: 35, w: 75, h: 38, material: 'forge_stone' },
      { id: 'foundry_block_ne', x: 210, y: 35, w: 75, h: 38, material: 'forge_stone' },
      { id: 'foundry_block_sw', x: 35, y: 108, w: 75, h: 38, material: 'forge_stone' },
      { id: 'foundry_block_se', x: 210, y: 108, w: 75, h: 38, material: 'forge_stone' },
    ],
    hazards: [
      { id: 'vertical_belt', type: 'reversing_conveyor', rect: { x: 136, y: 23, w: 48, h: 140 }, direction: { x: 0, y: 1 }, force: 23, reverseEvery: 8, affects: 'all' },
      { id: 'horizontal_belt', type: 'reversing_conveyor', rect: { x: 19, y: 78, w: 282, h: 25 }, direction: { x: 1, y: 0 }, force: 23, reverseEvery: 8, phase: 4, affects: 'all' },
    ],
    decor: [
      { sprite: 29, x: 20, y: 24, scale: 1, tint: '#e28145' },
      { sprite: 29, x: 300, y: 24, scale: 1, tint: '#e28145' },
      { sprite: 63, x: 21, y: 156, scale: 1, tint: '#79503d' },
      { sprite: 63, x: 299, y: 156, scale: 1, tint: '#79503d' },
    ],
    descentBudget: 14,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'riveter', count: 2, points: [{ x: 45, y: 88 }, { x: 275, y: 88 }] }, { enemy: 'slag_crawler', count: 1, points: [{ x: 160, y: 130 }] }, { enemy: 'furnace_brute', count: 1, points: [{ x: 160, y: 52 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'bellows_priest', count: 1, points: [{ x: 160, y: 90 }] }, { enemy: 'slag_crawler', count: 2, points: [{ x: 120, y: 45 }, { x: 200, y: 135 }] }] },
    ],
    ascentBudget: 21,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'writ_bearer', count: 1, points: [{ x: 160, y: 48 }] }, { enemy: 'toll_hound', count: 2, points: [{ x: 122, y: 88 }, { x: 198, y: 88 }] }, { enemy: 'appraiser', count: 1, points: [{ x: 275, y: 88 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'bailiff', count: 1, points: [{ x: 160, y: 112 }] }, { enemy: 'confiscator', count: 1, points: [{ x: 45, y: 88 }] }] },
    ],
  },
  {
    id: 'quenchworks', index: 11, depth: 12, biome: 'foundry', name: 'Quenchworks', subtitle: 'Steam can save you or erase you.',
    boss: false, reward: 'cargo', floorTile: 14, wallTile: 14,
    clearance: { requiresRoom: 10, unlocksRoom: 12, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'boiler_nw', x: 46, y: 45, w: 42, h: 28, material: 'boiler' },
      { id: 'boiler_se', x: 232, y: 108, w: 42, h: 28, material: 'boiler' },
      { id: 'pipe_ne', x: 235, y: 49, w: 25, h: 11, material: 'pipe' },
      { id: 'pipe_sw', x: 60, y: 122, w: 25, h: 11, material: 'pipe' },
    ],
    hazards: [
      { id: 'vent_w', type: 'interactive_steam_vent', rect: { x: 96, y: 49, w: 16, h: 28 }, direction: { x: 1, y: 0 }, tell: 0.35, active: 0.8, period: 5.5, force: 38, damage: 8, switchCooldown: 4, quenches: ['hot_trail', 'slag_pool'] },
      { id: 'vent_e', type: 'interactive_steam_vent', rect: { x: 208, y: 104, w: 16, h: 28 }, direction: { x: -1, y: 0 }, tell: 0.35, active: 0.8, period: 5.5, phase: 2.75, force: 38, damage: 8, switchCooldown: 4, quenches: ['hot_trail', 'slag_pool'] },
    ],
    decor: [
      { sprite: 29, x: 28, y: 31, scale: 1, tint: '#ed8c4b' },
      { sprite: 29, x: 292, y: 149, scale: 1, tint: '#ed8c4b' },
      { sprite: 82, x: 288, y: 31, scale: 1, tint: '#7d6656' },
      { sprite: 82, x: 32, y: 149, scale: 1, tint: '#7d6656' },
    ],
    descentBudget: 16,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'bellows_priest', count: 1, points: [{ x: 160, y: 58 }] }, { enemy: 'riveter', count: 2, points: [{ x: 48, y: 137 }, { x: 284, y: 144 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'furnace_brute', count: 1, points: [{ x: 160, y: 118 }] }, { enemy: 'slag_crawler', count: 2, points: [{ x: 43, y: 88 }, { x: 277, y: 88 }] }, { enemy: 'riveter', count: 1, points: [{ x: 160, y: 42 }] }] },
    ],
    ascentBudget: 20,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'bailiff', count: 2, points: [{ x: 110, y: 78 }, { x: 210, y: 102 }] }, { enemy: 'counterfeit', count: 1, points: [{ x: 160, y: 48 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'confiscator', count: 1, points: [{ x: 45, y: 92 }] }, { enemy: 'appraiser', count: 1, points: [{ x: 275, y: 92 }] }] },
    ],
  },
  {
    id: 'piston_choir', index: 12, depth: 13, biome: 'foundry', name: 'Piston Choir', subtitle: 'The beat is merciless, not secret.',
    boss: false, reward: 'technique', floorTile: 14, wallTile: 14,
    clearance: { requiresRoom: 11, unlocksRoom: 13, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'choir_rail_w', x: 50, y: 82, w: 56, h: 8, material: 'iron_rail' },
      { id: 'choir_rail_e', x: 214, y: 92, w: 56, h: 8, material: 'iron_rail' },
      { id: 'choir_console_n', x: 145, y: 43, w: 30, h: 11, material: 'console' },
      { id: 'choir_console_s', x: 145, y: 128, w: 30, h: 11, material: 'console' },
    ],
    hazards: [
      { id: 'piston_w', type: 'rhythm_piston', rect: { x: 68, y: 41, w: 34, h: 31 }, period: 2.4, phase: 0, tell: 0.50, damage: 18, affects: 'all', blocksProjectilesDuringActive: true },
      { id: 'piston_center', type: 'rhythm_piston', rect: { x: 143, y: 75, w: 34, h: 31 }, period: 2.4, phase: 0.8, tell: 0.50, damage: 18, affects: 'all', blocksProjectilesDuringActive: true },
      { id: 'piston_e', type: 'rhythm_piston', rect: { x: 218, y: 108, w: 34, h: 31 }, period: 2.4, phase: 1.6, tell: 0.50, damage: 18, affects: 'all', blocksProjectilesDuringActive: true },
    ],
    decor: [
      { sprite: 117, x: 28, y: 31, scale: 1, tint: '#9e6140' },
      { sprite: 117, x: 292, y: 31, scale: 1, tint: '#9e6140' },
      { sprite: 63, x: 30, y: 150, scale: 1, tint: '#765040' },
      { sprite: 63, x: 290, y: 150, scale: 1, tint: '#765040' },
    ],
    descentBudget: 18,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'furnace_brute', count: 1, points: [{ x: 160, y: 112 }] }, { enemy: 'slag_crawler', count: 2, points: [{ x: 44, y: 138 }, { x: 276, y: 138 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'bellows_priest', count: 1, points: [{ x: 160, y: 60 }] }, { enemy: 'riveter', count: 3, points: [{ x: 45, y: 45 }, { x: 275, y: 45 }, { x: 275, y: 115 }] }, { enemy: 'slag_crawler', count: 1, points: [{ x: 45, y: 115 }] }] },
    ],
    ascentBudget: 18,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'chain_clerk', count: 2, points: [{ x: 48, y: 45 }, { x: 272, y: 45 }] }, { enemy: 'appraiser', count: 1, points: [{ x: 160, y: 62 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'riveter', count: 1, points: [{ x: 270, y: 112 }] }, { enemy: 'toll_hound', count: 2, points: [{ x: 55, y: 110 }, { x: 160, y: 112 }] }] },
    ],
  },
  {
    id: 'crucible_rail', index: 13, depth: 14, biome: 'foundry', name: 'Crucible Rail', subtitle: 'Change the track or become the cargo.',
    boss: false, reward: 'cargo', floorTile: 14, wallTile: 14,
    clearance: { requiresRoom: 12, unlocksRoom: 14, basin: true, shortcutUnlock: null, sigil: null },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'rail_switch_w', x: 43, y: 82, w: 18, h: 14, material: 'interactive_switch' },
      { id: 'rail_switch_e', x: 259, y: 82, w: 18, h: 14, material: 'interactive_switch' },
      { id: 'rail_bumper_n', x: 145, y: 39, w: 30, h: 10, material: 'iron' },
      { id: 'rail_bumper_s', x: 145, y: 133, w: 30, h: 10, material: 'iron' },
    ],
    hazards: [
      { id: 'crucible_cart', type: 'moving_cover_cart', path: [{ x: 82, y: 54 }, { x: 238, y: 54 }, { x: 238, y: 126 }, { x: 82, y: 126 }], speed: 42, radius: 9, damage: 16, wallStunEnemies: 0.8, blocksProjectiles: true, reverseSwitches: ['rail_switch_w', 'rail_switch_e'], ascentSpeedMultiplier: 1.25 },
    ],
    decor: [
      { sprite: 117, x: 29, y: 31, scale: 1, tint: '#d17a43' },
      { sprite: 117, x: 291, y: 31, scale: 1, tint: '#d17a43' },
      { sprite: 29, x: 30, y: 149, scale: 1, tint: '#f08a45' },
      { sprite: 29, x: 290, y: 149, scale: 1, tint: '#f08a45' },
    ],
    descentBudget: 20,
    descentWaves: [
      { delay: 0.35, groups: [{ enemy: 'furnace_brute', count: 1, elite: true, hpMultiplier: 1.55, points: [{ x: 160, y: 112 }] }, { enemy: 'bellows_priest', count: 1, points: [{ x: 160, y: 62 }] }, { enemy: 'riveter', count: 2, points: [{ x: 45, y: 45 }, { x: 275, y: 45 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'slag_crawler', count: 2, points: [{ x: 48, y: 135 }, { x: 272, y: 135 }] }, { enemy: 'riveter', count: 1, points: [{ x: 160, y: 58 }] }] },
    ],
    ascentBudget: 18,
    ascentWaves: [
      { delay: 0.35, groups: [{ enemy: 'toll_hound', count: 2, points: [{ x: 48, y: 50 }, { x: 272, y: 50 }] }, { enemy: 'confiscator', count: 2, points: [{ x: 100, y: 105 }, { x: 220, y: 105 }] }, { enemy: 'writ_bearer', count: 1, points: [{ x: 160, y: 62 }] }] },
      { startWhen: { remainingAtMost: 1, after: 11 }, groups: [{ enemy: 'bailiff', count: 1, points: [{ x: 160, y: 112 }] }] },
    ],
  },
  {
    id: 'last_forge', index: 14, depth: 15, biome: 'foundry', name: 'The Last Forge', subtitle: 'The crown is heavier than the king.',
    boss: 'furnace_king', reward: 'boss_cargo', floorTile: 14, wallTile: 14,
    clearance: { requiresRoom: 13, unlocksRoom: null, basin: true, shortcutUnlock: null, sigil: 'forge' },
    entry: { x: 160, y: 20 }, descentExit: { x: 160, y: 164 }, ascentExit: { x: 160, y: 18 },
    obstacles: [
      { id: 'anvil_nw', x: 56, y: 48, w: 23, h: 17, material: 'anvil' },
      { id: 'anvil_ne', x: 241, y: 48, w: 23, h: 17, material: 'anvil' },
      { id: 'anvil_sw', x: 56, y: 118, w: 23, h: 17, material: 'anvil' },
      { id: 'anvil_se', x: 241, y: 118, w: 23, h: 17, material: 'anvil' },
    ],
    hazards: [
      { id: 'quench_valve_w', type: 'boss_quench_valve', rect: { x: 24, y: 80, w: 14, h: 20 }, hitsRequired: 3, cooldown: 9, bossStun: 1.5, resetsHeat: true },
      { id: 'quench_valve_e', type: 'boss_quench_valve', rect: { x: 282, y: 80, w: 14, h: 20 }, hitsRequired: 3, cooldown: 9, bossStun: 1.5, resetsHeat: true },
      { id: 'heat_grates', type: 'rotating_safe_grates', rects: [{ x: 92, y: 69, w: 34, h: 24 }, { x: 194, y: 69, w: 34, h: 24 }, { x: 92, y: 111, w: 34, h: 24 }, { x: 194, y: 111, w: 34, h: 24 }], inactiveUntilBossPhase: 3, period: 12, step: 3, tell: 0.55, damage: 8 },
    ],
    decor: [
      { sprite: 29, x: 28, y: 29, scale: 1, tint: '#ff9b4f' },
      { sprite: 29, x: 292, y: 29, scale: 1, tint: '#ff9b4f' },
      { sprite: 117, x: 28, y: 151, scale: 1, tint: '#9d5840' },
      { sprite: 117, x: 292, y: 151, scale: 1, tint: '#9d5840' },
    ],
    descentBudget: 0,
    descentWaves: [
      { delay: 0.70, groups: [{ boss: 'furnace_king', count: 1, points: [{ x: 160, y: 106 }] }] },
    ],
    ascentBudget: 16,
    ascentWaves: [
      { delay: 0.60, groups: [{ enemy: 'crown_collector', count: 1, points: [{ x: 160, y: 70 }] }, { enemy: 'bailiff', count: 2, points: [{ x: 90, y: 85 }, { x: 230, y: 85 }] }] },
    ],
  },
];

export const ROOMS = [...MOSS_ROOMS, ...CRYSTAL_ROOMS, ...FOUNDRY_ROOMS];
