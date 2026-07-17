import * as Content from "./data.js?v=20260718-1";
import { ActionInput } from "./input.js?v=20260718-1";
import { SeededRng } from "./rng.js?v=20260718-1";
import {
  TAU,
  angleBetween,
  angleDiff,
  clamp,
  circlesIntersect,
  dist,
  distSq,
  moveCircleWithSliding,
  normalizeVector,
  segmentVsExpandedAABB,
  sweptProjectileHit,
} from "./collision.js?v=20260718-1";
import { NavAgentState, NavGrid } from "./navigation.js?v=20260718-1";

const WORLD = Content.BASE_WORLD;
const FIXED_STEP = 1 / 60;
const PLAYER_RADIUS = 3.6;
const PLAYER_SPEED = 76;
const PLAYER_DASH_SPEED = 196;
const PLAYER_DASH_TIME = 0.145;
const ENTRY_GRACE = 0.62;
const COLORS = {
  player: "#f5e4bd",
  playerEdge: "#49321e",
  deflect: "#7ff6ef",
  danger: "#ff5d5a",
  gold: "#f4bd57",
  white: "#fff8df",
};

const vecFromAngle = (angle, length = 1) => ({
  x: Math.cos(angle) * length,
  y: Math.sin(angle) * length,
});

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (rate, dt) => 1 - Math.exp(-rate * dt);
const signOr = (value, fallback = 1) => (value === 0 ? fallback : Math.sign(value));
const degrees = (value) => value * Math.PI / 180;
const rectCenter = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

function distancePointSegment(point, a, b) {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const lengthSq = abX * abX + abY * abY || 1;
  const t = clamp(((point.x - a.x) * abX + (point.y - a.y) * abY) / lengthSq, 0, 1);
  const x = a.x + abX * t;
  const y = a.y + abY * t;
  return { distance: Math.hypot(point.x - x, point.y - y), x, y, t };
}

function stableClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function rangeFrom(rng, value, fallback = 0) {
  if (Array.isArray(value)) return rng.range(value[0], value[1]);
  return Number.isFinite(value) ? value : fallback;
}

function pointInCone(origin, angle, range, arc, target, extraRadius = 0) {
  if (distSq(origin, target) > (range + extraRadius) ** 2) return false;
  const targetAngle = angleBetween(origin, target);
  return Math.abs(angleDiff(targetAngle, angle)) <= degrees(arc) / 2;
}

function circleRectOverlap(circle, rect) {
  const x = clamp(circle.x, rect.x, rect.x + rect.w);
  const y = clamp(circle.y, rect.y, rect.y + rect.h);
  return (circle.x - x) ** 2 + (circle.y - y) ** 2 <= circle.r ** 2;
}

function audioCall(name, payload) {
  const audio = window.AbyssalAudio || window.abyssalAudio || window.audioEngine;
  try {
    if (typeof audio?.playSfx === "function") audio.playSfx(name, payload);
    else if (typeof audio?.sfx === "function") audio.sfx(name, payload);
    else if (typeof audio?.play === "function") audio.play(name, payload);
  } catch {
    // Audio must never interrupt combat simulation.
  }
}

function setMusic(biomeMode, intensity = 0, mode = null) {
  const audio = window.AbyssalAudio || window.abyssalAudio || window.audioEngine;
  try {
    const biome = /crystal|cathedral|glass/.test(biomeMode) ? "crystal"
      : /foundry|forge/.test(biomeMode) ? "foundry" : "moss";
    if (typeof audio?.setMusicState === "function") audio.setMusicState({ biome, intensity, ...(mode ? { mode } : {}) });
    else {
      audio?.setBiome?.(biome);
      if (mode) audio?.setMode?.(mode);
      audio?.setCombatIntensity?.(intensity);
    }
  } catch {
    // Audio is an optional presentation layer.
  }
}

function metaRank(meta, id) {
  return Number(meta?.upgrades?.[id]) || 0;
}

function hasTechnique(run, id) {
  return run.techniques.some((entry) => entry.id === id);
}

function cargoHasEffect(run, type) {
  return run.cargo
    .filter((cargo) => !cargo.sealed && (!cargo.ascentActivated || run.phase === "ascent"))
    .some((cargo) => cargo.effects?.some((effect) => effect.type === type));
}

function cargoEffects(run, type) {
  return run.cargo
    .filter((cargo) => !cargo.sealed && (!cargo.ascentActivated || run.phase === "ascent"))
    .flatMap((cargo) => cargo.effects || [])
    .filter((effect) => effect.type === type);
}

function burdenTier(weight, capacity = 100) {
  const ratio = clamp(weight / Math.max(1, capacity), 0, 2);
  if (ratio < 0.25) return { id: "agile", name: "AGILE", ratio, speed: 1, dashCooldown: 0.62, dashIFrames: 0.19 };
  if (ratio < 0.75) return { id: "laden", name: "LADEN", ratio, speed: 0.96, dashCooldown: 0.70, dashIFrames: 0.17 };
  return { id: "crushing", name: "CRUSHING", ratio, speed: 0.91, dashCooldown: 0.78, dashIFrames: 0.145 };
}

function playerMaxHp(meta) {
  const rank = metaRank(meta, "field_rations");
  return [100, 110, 120][rank] || 120;
}

function burdenCapacity(meta) {
  const rank = metaRank(meta, "reinforced_frame");
  return 100 + [0, 5, 10, 15][rank];
}

function unlockedDepth(meta) {
  if (meta?.bossSigils?.glass) return 15;
  if (meta?.bossSigils?.root) return 10;
  return 5;
}

function biomeForRoom(index) {
  return Content.BIOMES[Math.floor(clamp(index, 0, 14) / 5)] || Content.BIOMES[0];
}

function roomData(index) {
  const rooms = Content.ROOMS || [];
  return rooms[index] || {
    id: `room_${index + 1}`,
    name: `Abyss Chamber ${index + 1}`,
    biome: biomeForRoom(index).id,
    entry: { x: 160, y: 154 },
    exit: { x: 160, y: 25 },
    obstacles: [],
    hazards: [],
    descent: { waves: [] },
    ascent: { waves: [] },
  };
}

function enemyPoolFor(index, phase) {
  const biome = biomeForRoom(index).id;
  const entries = Object.values(Content.ENEMIES);
  if (phase === "ascent") {
    const general = entries.filter((enemy) => enemy.faction === "ascent" && !enemy.elite);
    return general.length ? general : entries;
  }
  const local = entries.filter((enemy) => enemy.faction === "descent" && enemy.biome === biome);
  return local.length ? local : entries.filter((enemy) => enemy.faction === "descent");
}

function phaseRoomSpec(room, phase) {
  const nested = room?.[phase] || room?.encounters?.[phase] || {};
  return {
    ...nested,
    waves: nested.waves || room?.[`${phase}Waves`] || [],
    budget: nested.budget ?? room?.[`${phase}Budget`],
  };
}

function normalizeWave(wave) {
  if (Array.isArray(wave)) return { groups: wave };
  if (!wave) return { groups: [] };
  return {
    ...wave,
    groups: wave.groups || wave.enemies || wave.spawns || [],
  };
}

function waveList(room, phase) {
  const spec = phaseRoomSpec(room, phase);
  if (Array.isArray(spec)) return spec.map(normalizeWave);
  const waves = spec.waves || spec.waveGroups || [];
  return waves.map(normalizeWave);
}

function normalizeObstacles(room, phase) {
  const shared = room.obstacles || room.geometry?.obstacles || [];
  const extra = phaseRoomSpec(room, phase).obstacles || [];
  return [...shared, ...extra].map((obstacle) => ({ ...obstacle }));
}

function normalizeHazards(room, phase) {
  const shared = room.hazards || [];
  const extra = phaseRoomSpec(room, phase).hazards || [];
  return [...shared, ...extra].map((hazard, index) => ({
    ...hazard,
    id: hazard.id || `${room.id}_hazard_${index}`,
    timer: Number(hazard.offset) || index * 0.37,
    activeDuration: typeof hazard.active === "number" ? hazard.active : null,
    active: false,
    hitTimer: 0,
    cooldownTimer: 0,
    disabledTimer: 0,
    hits: 0,
    alive: true,
    enemyHits: new Map(),
  }));
}

function spawnPointList(room, phase) {
  const spec = phaseRoomSpec(room, phase);
  const points = spec.spawnPoints || room.spawnPoints || [
    { x: 42, y: 38 }, { x: 278, y: 38 }, { x: 42, y: 132 }, { x: 278, y: 132 },
    { x: 160, y: 36 }, { x: 160, y: 134 },
  ];
  return points.map((point) => ({ x: point.x, y: point.y }));
}

function attackTimeline(attack) {
  const pattern = attack.pattern || "";
  let authoredActive = Number(attack.active) || 0.10;
  if (/thorn_lash/.test(pattern)) authoredActive = Math.max(authoredActive, ((attack.swipes || 3) - 1) * (attack.interval || 0.15) + 0.09);
  if (/aimed_burst|predictive_pair|clone_lances|mirrored_ricochet_pair|rivet_fan|seed_mortar|crucible_toss/.test(pattern)) {
    const count = attack.count || (pattern.includes("pair") ? 2 : 3);
    authoredActive = Math.max(authoredActive, (count - 1) * (attack.interval || 0.11) + 0.09);
  }
  if (/glass_step/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.repeats || 1) * (attack.repeatDelay || 0.32) + 0.10);
  if (/halo_burst/.test(pattern)) authoredActive = Math.max(authoredActive, ((attack.rings || 2) - 1) * (attack.ringDelay || 0.28) + 0.10);
  if (/root_wall_wave/.test(pattern)) authoredActive = Math.max(authoredActive, ((attack.waves || 2) - 1) * (attack.interval || 0.30) + 0.10);
  if (/hammer_combo_ring/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.strikes || 3) * (attack.interval || 0.30) + 0.10);
  if (/pounce_pair/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.repeatDelay || 0.16) + 0.13);
  if (/stepped_shield_bash/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.advanceBeats || 3) * 0.09);
  if (/sidestep_jab/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.sidesteps || 3) * (attack.sidestepTime || 0.12) + 0.06);
  if (/charge|leap|pounce|rush/.test(pattern)) authoredActive = Math.max(authoredActive, Math.min(0.85, (attack.range || 70) / (attack.speed || 130)));
  return {
    tell: Math.max(0.12, Number(attack.tell) || 0.24),
    active: Math.max(0.03, authoredActive),
    recovery: Math.max(0.15, Number(attack.recovery) || 0.42),
  };
}

function weaponTimelinePart(part, key, fallback) {
  if (!part) return fallback;
  if (Array.isArray(part.timeline)) {
    const sum = part.timeline.reduce((total, entry) => total + (Number(entry[key]) || 0), 0);
    if (sum > 0) return sum;
  }
  return Number(part[key]) || fallback;
}

export class ActionRuntime {
  constructor({ canvas, meta, ui, renderer, qa = {}, onMetaChanged = () => {} }) {
    this.canvas = canvas;
    this.input = new ActionInput(canvas, WORLD.w, WORLD.h);
    this.meta = meta;
    this.ui = ui;
    this.renderer = renderer;
    this.qa = qa;
    this.onMetaChanged = onMetaChanged;
    this.scene = "idle";
    this.run = null;
    this.encounter = null;
    this.time = 0;
    this.accumulator = 0;
    this.hitstop = 0;
    this.shake = 0;
    this.lastFrame = performance.now();
    this.hudTimer = 0;
    this.transitionTimer = 0;
    this.bot = {
      enabled: Boolean(qa.bot),
      god: Boolean(qa.god),
      elapsed: 0,
      decisions: 0,
      roomsVisited: new Set(),
      weaponsUsed: new Set(),
      rewardsPicked: [],
    };
    this.metrics = {
      frames: 0,
      roomsEntered: 0,
      roomsCleared: 0,
      enemiesDefeated: 0,
      bossesDefeated: 0,
      bossPhasesSeen: 0,
      attacksStarted: 0,
      projectilesSpawned: 0,
      nearMisses: 0,
      deflects: 0,
      damageEvents: 0,
      stuckEvents: 0,
      recoveries: 0,
      navSamples: 0,
      unreachableSamples: 0,
      maxEnemies: 0,
      maxProjectiles: 0,
    };
  }

  beginRun(weaponId = this.meta.selectedWeapon || "chainblade", startRoom = 0) {
    const safeWeapon = Content.WEAPONS[weaponId] ? weaponId : "chainblade";
    const maxHp = playerMaxHp(this.meta);
    const seed = this.qa.seed || `${Date.now()}:${this.meta.runs || 0}:${safeWeapon}`;
    const rng = new SeededRng(seed);
    this.run = {
      seed,
      rng,
      phase: "descent",
      roomIndex: clamp(startRoom, 0, 14),
      deepest: startRoom,
      maxDepth: unlockedDepth(this.meta),
      weaponId: safeWeapon,
      weaponState: {
        [safeWeapon]: {
          ammo: Content.WEAPONS[safeWeapon]?.resource?.capacity ?? Infinity,
          reload: 0,
          impactCharge: 0,
        },
      },
      techniques: [],
      cargo: [],
      cachedValue: 0,
      cachedWeight: 0,
      carriedValue: 0,
      carriedWeight: 0,
      balloonedValue: 0,
      balloonThreat: 0,
      roomsCleared: 0,
      bosses: [],
      pendingSigils: new Set(),
      pendingUnlocks: new Set(),
      hitCounter: 0,
      alternatingLast: null,
      alternatingStacks: 0,
      alternatingTimer: 0,
      rerolls: metaRank(this.meta, "basin_lens") * 3,
      player: {
        x: WORLD.w / 2,
        y: WORLD.h - 27,
        r: PLAYER_RADIUS,
        vx: 0,
        vy: 0,
        aim: -Math.PI / 2,
        lastMove: { x: 0, y: -1 },
        hp: maxHp,
        maxHp,
        invuln: ENTRY_GRACE,
        dashTime: 0,
        dashCooldown: 0,
        dashDir: { x: 0, y: -1 },
        dashSerial: 0,
        deflectTime: 0,
        deflectCooldown: 0,
        action: null,
        techniqueCooldown: 0,
        ammo: Content.WEAPONS[safeWeapon]?.resource?.capacity ?? Infinity,
        reload: 0,
        combo: 0,
        comboTimer: 0,
        drive: 0,
        driveIdle: 0,
        empowered: 0,
        lienWeight: 0,
        status: {},
        shotCounter: 0,
        relicCooldown: 0,
        quenchStored: 0,
        impactCharge: 0,
        empoweredCharges: 0,
        flywheelCooldown: 0,
      },
    };
    this.meta.runs = (this.meta.runs || 0) + 1;
    this.bot.weaponsUsed.add(safeWeapon);
    this.enterRoom(this.run.roomIndex, "descent");
    const forgeRank = metaRank(this.meta, "forge_slot");
    if (forgeRank > 0) {
      this.rewardContext = "starter";
      this.pendingRewards = this.makeRewardChoices(roomData(0)).slice(0, forgeRank + 1);
      this.scene = "reward";
      this.ui.renderReward?.(this.pendingRewards, {
        title: "CHOOSE YOUR OPENING TECHNIQUE",
        description: "The Surface forge installs one Technique before the cage drops.",
        canReroll: false,
      });
    }
  }

  enterRoom(index, phase = this.run.phase) {
    this.run.phase = phase;
    this.run.roomIndex = clamp(index, 0, 14);
    this.run.deepest = Math.max(this.run.deepest, this.run.roomIndex);
    const room = roomData(this.run.roomIndex);
    const biome = biomeForRoom(this.run.roomIndex);
    const obstacles = normalizeObstacles(room, phase);
    const bounds = room.bounds || WORLD.bounds;
    const player = this.run.player;
    const entry = phase === "descent"
      ? (room.entry || room.descentEntry || { x: 160, y: bounds.y + 16 })
      : (room.descentExit || room.ascentEntry || { x: 160, y: bounds.y + bounds.h - 16 });
    player.x = entry.x;
    // HUD lives outside the world canvas text layer but overlays its safe edge;
    // keep actors out of those top/bottom readability bands.
    player.y = clamp(entry.y, bounds.y + 23, bounds.y + bounds.h - 24);
    player.vx = 0;
    player.vy = 0;
    player.invuln = ENTRY_GRACE;
    player.action = null;
    const projectedRoom = { x: player.x, y: player.y, r: player.r };
    for (const obstacle of obstacles) {
      if (circleRectOverlap(projectedRoom, obstacle)) {
        player.x = bounds.x + bounds.w / 2;
        player.y = phase === "descent" ? bounds.y + bounds.h - 18 : bounds.y + 18;
        break;
      }
    }

    const nav = new NavGrid({ bounds, obstacles, cellSize: 8, clearance: 5.5 });
    const spawnPoints = spawnPointList(room, phase);
    const validation = nav.validateReachability(player, spawnPoints);
    if (!validation.valid) this.metrics.unreachableSamples += validation.unreachable.length;

    this.encounter = {
      room,
      biome,
      phase,
      bounds,
      obstacles,
      hazards: normalizeHazards(room, phase),
      nav,
      spawnPoints,
      waves: waveList(room, phase),
      waveIndex: -1,
      waveDelay: 0.35,
      enemies: [],
      projectiles: [],
      effects: [],
      particles: [],
      prisms: [],
      barriers: [],
      originalObstacles: stableClone(obstacles),
      time: 0,
      clear: false,
      clearTimer: 0,
      attackTokensUsed: 0,
      attackTokenCap: phase === "ascent" ? 4 : 3,
      attention: phase === "ascent" ? 20 : 0,
      hunterSpawned: false,
      roomDamage: 0,
      roomKills: 0,
      firstDriveHealUsed: false,
      bossPhase: -1,
      waveActive: false,
      cargoReinforcementsSpawned: false,
    };

    player.freeTechniqueCharges = cargoEffects(this.run, "first_technique_free_each_room")
      .reduce((sum, effect) => sum + (effect.charges || 1), 0);
    player.mirrorCooldown = Math.max(0, player.mirrorCooldown || 0);

    this.metrics.roomsEntered += 1;
    this.bot.roomsVisited.add(`${phase}:${index}`);
    setMusic(biome.musicMode, phase === "ascent" ? 0.65 : 0.25, phase === "ascent" ? "ascent" : "descent");
    this.ui.roomBanner?.(`${phase === "ascent" ? "ASCENT" : `DEPTH ${index + 1}`} · ${room.name || biome.name}`, "", 850);
    this.scene = "playing";
    this.ui.showHud?.(true);
    this.ui.hideScreen?.();
    this.spawnNextWave();
  }

  rebuildNavigation() {
    if (!this.encounter) return;
    const solids = [
      ...this.encounter.obstacles,
      ...this.encounter.barriers.filter((barrier) => barrier.solid),
    ];
    this.encounter.nav = new NavGrid({
      bounds: this.encounter.bounds,
      obstacles: solids,
      cellSize: 8,
      clearance: 5.5,
    });
  }

  collisionObstacles() {
    if (!this.encounter) return [];
    return [
      ...this.encounter.obstacles,
      ...this.encounter.barriers.filter((barrier) => barrier.solid),
    ];
  }

  spawnNextWave() {
    const encounter = this.encounter;
    encounter.waveIndex += 1;
    const wave = encounter.waves[encounter.waveIndex];
    if (!wave) {
      // Authored boss rooms may declare the boss separately from their wave list.
      const bossId = phaseRoomSpec(encounter.room, encounter.phase).boss
        || (encounter.phase === "descent" && [4, 9, 14].includes(this.run.roomIndex)
          ? encounter.biome.boss : null);
      if (bossId && !encounter.bossSpawned) {
        encounter.bossSpawned = true;
        this.spawnBoss(bossId);
      } else if (!encounter.enemies.some((enemy) => !enemy.dead)) {
        encounter.clear = true;
        encounter.clearTimer = 0.7;
      }
      return;
    }
    encounter.waveActive = true;
    const groups = wave.groups || [];
    if (groups.length === 0 && wave.boss) {
      this.spawnBoss(wave.boss);
      return;
    }
    groups.forEach((group, groupIndex) => {
      if (typeof group === "string") {
        this.spawnEnemy(group, encounter.spawnPoints[groupIndex % encounter.spawnPoints.length]);
        return;
      }
      if (group.boss) {
        this.spawnBoss(group.boss);
        return;
      }
      const enemyId = group.enemy || group.id || group.type;
      const count = Math.max(1, group.count || 1);
      for (let copy = 0; copy < count; copy += 1) {
        const declared = group.points?.[copy] || group.point || group.position;
        const base = declared || encounter.spawnPoints[(groupIndex + copy) % encounter.spawnPoints.length];
        this.spawnEnemy(enemyId, {
          x: base.x + this.run.rng.range(-3, 3),
          y: base.y + this.run.rng.range(-3, 3),
        }, group);
      }
    });
    if (this.run.phase === "ascent" && !encounter.cargoReinforcementsSpawned) {
      encounter.cargoReinforcementsSpawned = true;
      const extraBudget = cargoEffects(this.run, "ascent_threat_budget")
        .reduce((sum, effect) => sum + (effect.value || 0), this.run.balloonThreat || 0);
      if (extraBudget > 0) this.spawnBudgetEnemies(extraBudget);

      const captainSupport = cargoEffects(this.run, "captain_room_extra_elite")[0];
      if (captainSupport) {
        const elitePool = (captainSupport.enemyPool || [])
          .map((id) => Content.ENEMIES[id])
          .filter(Boolean);
        if (elitePool.length) {
          const support = this.run.rng.pick(elitePool);
          const point = this.run.rng.pick(encounter.spawnPoints);
          this.spawnEnemy(support.id, point, { elite: true, hpMultiplier: 1.18 });
        }
      }

      const counterfeitInterest = cargoEffects(this.run, "counterfeit_spawn_weight")
        .reduce((value, effect) => value * (effect.value || 1), 1);
      if (counterfeitInterest > 1 && this.run.rng.chance(Math.min(0.8, (counterfeitInterest - 1) * 1.6))) {
        this.spawnEnemy("counterfeit", this.run.rng.pick(encounter.spawnPoints));
      }
    }
    if (!encounter.enemies.some((enemy) => !enemy.dead)) {
      // Fallback keeps unfinished/custom data playable and dangerous.
      const budget = 2 + Math.floor(this.run.roomIndex / 3) + (this.run.phase === "ascent" ? 2 : 0);
      this.spawnBudgetEnemies(budget);
    }
    audioCall("enemyTell", { kind: "wave" });
  }

  spawnBudgetEnemies(budget, preferredPool = null) {
    const pool = preferredPool || enemyPoolFor(this.run.roomIndex, this.run.phase);
    let remaining = budget;
    let guard = 0;
    while (remaining > 0 && guard < 20 && pool.length) {
      guard += 1;
      const affordable = pool.filter((entry) => (entry.threatCost || 1) <= remaining);
      const def = this.run.rng.pick(affordable.length ? affordable : pool);
      const point = this.run.rng.pick(this.encounter.spawnPoints);
      this.spawnEnemy(def.id, { x: point.x + this.run.rng.range(-4, 4), y: point.y + this.run.rng.range(-4, 4) });
      remaining -= def.threatCost || 1;
    }
  }

  spawnEnemy(id, point, options = {}) {
    const def = Content.ENEMIES[id];
    if (!def || !point) return null;
    const projected = this.encounter.nav.projectToWalkable(point, 40) || point;
    const depthScale = (1 + this.run.roomIndex * 0.025 + (this.run.phase === "ascent" ? 0.16 : 0)) * (options.hpMultiplier || 1);
    const enemy = {
      uid: `${id}:${this.encounter.time.toFixed(3)}:${this.encounter.enemies.length}`,
      id,
      def,
      x: projected.x,
      y: projected.y,
      r: def.radius || 5,
      vx: 0,
      vy: 0,
      hp: (options.hp || def.hp || 30) * depthScale,
      maxHp: (options.hp || def.hp || 30) * depthScale,
      poise: def.poise || 30,
      maxPoise: def.poise || 30,
      state: "enter",
      stateTime: 0.22,
      cooldown: this.run.rng.range(0.10, 0.45),
      attack: null,
      aim: angleBetween(point, this.run.player),
      activeResolved: false,
      shotsFired: 0,
      tokenHeld: 0,
      flash: 0,
      stagger: 0,
      dead: false,
      boss: false,
      elite: Boolean(def.elite || options.elite),
      navState: new NavAgentState({ position: projected, stuckAfter: 0.82, minProgress: 2.1 }),
      lastPosition: { x: projected.x, y: projected.y },
      side: this.run.rng.chance() ? 1 : -1,
      buff: 1,
      mark: 0,
      hitBy: new Set(),
      noSplit: Boolean(options.noSplit),
      trailTimer: 0,
    };
    this.encounter.enemies.push(enemy);
    this.meta.bestiarySeen = Array.from(new Set([...(this.meta.bestiarySeen || []), id]));
    return enemy;
  }

  spawnBoss(id) {
    const def = Content.BOSSES[id];
    if (!def) return;
    const point = phaseRoomSpec(this.encounter.room, "descent").bossPoint
      || this.encounter.room.bossPoint
      || { x: WORLD.w / 2, y: 55 };
    const enemy = this.spawnEnemyFromBoss(def, point);
    this.encounter.boss = enemy;
    this.encounter.bossPhase = 0;
    this.metrics.bossPhasesSeen += 1;
    audioCall("bossRoar", { boss: id });
    setMusic(this.encounter.biome.musicMode, 1, "boss");
    this.ui.updateBoss?.({ visible: true, name: def.name, phase: "PHASE I", hp: 1 });
  }

  spawnEnemyFromBoss(def, point) {
    const projected = this.encounter.nav.projectToWalkable(point, 50) || point;
    const hpScale = 0.72 + this.run.roomIndex * 0.018;
    const enemy = {
      uid: `boss:${def.id}`,
      id: def.id,
      def,
      x: projected.x,
      y: projected.y,
      r: def.radius || 11,
      vx: 0,
      vy: 0,
      hp: def.hp * hpScale,
      maxHp: def.hp * hpScale,
      poise: def.poise,
      maxPoise: def.poise,
      state: "enter",
      stateTime: 0.85,
      cooldown: 0.3,
      attack: null,
      aim: angleBetween(point, this.run.player),
      activeResolved: false,
      shotsFired: 0,
      tokenHeld: 0,
      flash: 0,
      stagger: 0,
      dead: false,
      boss: true,
      elite: true,
      phase: 0,
      patternCursor: 0,
      sequenceQueue: [],
      phaseTriggers: new Set(),
      mirrors: [],
      exposed: 0,
      navState: new NavAgentState({ position: projected, stuckAfter: 0.95, minProgress: 2 }),
      lastPosition: { x: projected.x, y: projected.y },
      side: 1,
      buff: 1,
      mark: 0,
      hitBy: new Set(),
    };
    this.encounter.enemies.push(enemy);
    this.activateBossPhase(enemy);
    return enemy;
  }

  advance(realDt) {
    const timeScale = clamp(Number(this.qa.speed) || 1, 0.25, 8);
    const frameDt = Math.min(0.1, Math.max(0, realDt)) * timeScale;
    this.accumulator = Math.min(this.accumulator + frameDt, 0.35);
    while (this.accumulator >= FIXED_STEP) {
      this.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    this.render();
  }

  step(dt) {
    this.time += dt;
    this.metrics.frames += 1;
    this.input.tick(dt);
    if (!this.run || !this.encounter) {
      this.input.endStep();
      return;
    }

    if (this.bot.enabled) this.updateBot(dt);
    if (this.input.consume("pause") && this.scene === "playing") {
      this.pause();
      this.input.endStep();
      return;
    }
    if (this.input.consume("mute")) {
      const engine = window.AbyssalAudio || window.abyssalAudio || window.audioEngine;
      const muted = engine?.toggleMuted?.() ?? !this.meta.settings.muted;
      this.meta.settings.muted = muted;
      this.ui.setMuted?.(muted);
      this.onMetaChanged(this.meta);
    }
    if (this.scene !== "playing") {
      this.input.endStep();
      return;
    }

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.updateCosmetics(dt * 0.25);
      this.input.endStep();
      return;
    }

    const encounter = this.encounter;
    encounter.time += dt;
    this.hudTimer -= dt;
    this.shake = Math.max(0, this.shake - dt * 18);
    this.updatePlayer(dt);
    this.updateHazards(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateEffects(dt);
    this.updateEncounter(dt);
    this.updateCosmetics(dt);
    this.metrics.maxEnemies = Math.max(this.metrics.maxEnemies, encounter.enemies.filter((enemy) => !enemy.dead).length);
    this.metrics.maxProjectiles = Math.max(this.metrics.maxProjectiles, encounter.projectiles.length);
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.08;
      this.refreshHud();
    }
    this.input.endStep();
  }

  pause() {
    this.scene = "pause";
    this.input.resetHeld();
    this.ui.renderPause?.({
      room: this.encounter.room.name,
      phase: this.run.phase,
      weapon: Content.WEAPONS[this.run.weaponId]?.name,
    });
  }

  resume() {
    if (!this.run) return;
    this.scene = "playing";
    this.ui.hideScreen?.();
    this.canvas.focus({ preventScroll: true });
  }

  updatePlayer(dt) {
    const run = this.run;
    const player = run.player;
    const encounter = this.encounter;
    const weapon = Content.WEAPONS[run.weaponId];
    const moveX = (this.input.held("right") ? 1 : 0) - (this.input.held("left") ? 1 : 0);
    const moveY = (this.input.held("down") ? 1 : 0) - (this.input.held("up") ? 1 : 0);
    const move = normalizeVector(moveX, moveY, player.lastMove.x, player.lastMove.y);
    if (move.length > 0) player.lastMove = { x: move.x, y: move.y };
    if (this.input.pointer.active) player.aim = angleBetween(player, this.input.pointer);
    else if (move.length > 0) player.aim = Math.atan2(move.y, move.x);

    player.invuln = Math.max(0, player.invuln - dt);
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.deflectCooldown = Math.max(0, player.deflectCooldown - dt);
    player.deflectTime = Math.max(0, player.deflectTime - dt);
    player.techniqueCooldown = Math.max(
      0,
      player.techniqueCooldown - dt * (hasTechnique(run, "paid_in_full") && player.drive >= 75 ? 1.3 : 1),
    );
    player.comboTimer = Math.max(0, player.comboTimer - dt);
    if (player.comboTimer <= 0) player.combo = 0;
    run.alternatingTimer = Math.max(0, run.alternatingTimer - dt);
    if (run.alternatingTimer <= 0) run.alternatingStacks = 0;
    player.empowered = Math.max(0, player.empowered - dt);
    if (player.empowered <= 0) player.empoweredCharges = 0;
    player.relicCooldown = Math.max(0, player.relicCooldown - dt);
    player.mirrorCooldown = Math.max(0, (player.mirrorCooldown || 0) - dt);
    player.flywheelCooldown = Math.max(0, (player.flywheelCooldown || 0) - dt);
    Object.keys(player.status).forEach((key) => {
      player.status[key] -= dt;
      if (player.status[key] <= 0) delete player.status[key];
    });

    player.driveIdle += dt;
    if (player.driveIdle > 2) player.drive = Math.max(0, player.drive - dt * (run.phase === "ascent" ? 3 : 5));
    this.meta.statistics.peakDrive = Math.max(this.meta.statistics.peakDrive || 0, Math.round(player.drive));

    if (this.input.consume("deflect") && player.deflectCooldown <= 0) {
      const bonus = [0, 0.012, 0.024][metaRank(this.meta, "reflex_coil")] || 0;
      player.deflectTime = 0.105 + bonus;
      player.deflectCooldown = 0.24;
      player.action = null;
      audioCall("deflect", { x: player.x, y: player.y });
    }

    if (this.input.consume("interact")) this.interactWithRoom();

    const tier = burdenTier(run.phase === "ascent" ? run.carriedWeight + player.lienWeight : 0, burdenCapacity(this.meta));
    const dashMeta = [1, 0.94, 0.88][metaRank(this.meta, "dash_bearings")] || 0.88;
    if (this.input.consume("dodge") && player.dashCooldown <= 0) {
      const direction = move.length > 0 ? move : vecFromAngle(player.aim);
      player.dashDir = { x: direction.x, y: direction.y };
      player.dashSerial += 1;
      player.dashTime = PLAYER_DASH_TIME;
      const cargoDashCooldown = cargoEffects(run, "dash_cooldown_multiplier")
        .reduce((value, effect) => value * (effect.value || 1), 1);
      player.dashCooldown = tier.dashCooldown * dashMeta * cargoDashCooldown;
      player.invuln = tier.dashIFrames;
      player.action = null;
      player.reload = Math.max(0, player.reload);
      this.onDash(tier);
      audioCall("dash", { tier: tier.id });
    }

    if (this.input.consume("swap")) this.cycleWeapon();
    if (this.input.consume("reload")) this.beginReload();

    if (hasTechnique(run, "quench_capsule") && player.relicCooldown <= 0) {
      const nearbyBullets = encounter.projectiles.filter((projectile) => projectile.faction === "enemy" && distSq(projectile, player) <= 30 ** 2);
      if (nearbyBullets.length >= 4) {
        const cleared = this.clearHostileBullets(player, 30, false);
        player.quenchStored = Math.min(40, cleared * 2);
        player.relicCooldown = 14;
        this.spawnBurst(player.x, player.y, "#a9f8ff", 18);
        audioCall("explosion", { kind: "quench" });
      }
    }

    if (player.reload > 0) {
      player.reload -= dt;
      if (player.reload <= 0) {
        player.ammo = weapon.resource?.capacity ?? Infinity;
        audioCall("reload", { stage: "complete" });
      }
    }

    if (player.dashTime > 0) {
      player.dashTime -= dt;
      const speed = PLAYER_DASH_SPEED * (tier.id === "crushing" ? 0.93 : 1);
      this.movePlayer(player.dashDir.x * speed * dt, player.dashDir.y * speed * dt);
      if (tier.id === "crushing") this.resolveCrushingDash();
      this.spawnParticle(player.x, player.y, this.encounter.biome.accent, 0.16, -player.dashDir.x * 15, -player.dashDir.y * 15, 2);
      return;
    }

    if (player.action) this.updatePlayerAction(dt);
    const canAct = !player.action && player.reload <= 0 && player.deflectTime <= 0;
    if (canAct && (this.input.consume("secondary") || this.input.held("secondary"))) this.beginPlayerAction("technique");
    if (canAct && (this.input.consume("primary") || this.input.held("primary"))) this.beginPlayerAction("primary");

    let actionMoveScale = 1;
    if (player.action) actionMoveScale = player.action.type === "technique" ? 0.72 : 0.86;
    if (player.reload > 0) actionMoveScale *= 0.88;
    const driveSpeed = 1 + player.drive / 100 * 0.055;
    const statusSpeed = player.status.tethered ? 0.78 : player.status.slowed ? 0.68 : 1;
    const desiredSpeed = PLAYER_SPEED * tier.speed * (weapon.moveScale || 1) * actionMoveScale * driveSpeed * statusSpeed;
    const response = smooth(34, dt);
    player.vx = lerp(player.vx, move.x * desiredSpeed, response);
    player.vy = lerp(player.vy, move.y * desiredSpeed, response);
    if (move.length === 0) {
      const brake = smooth(42, dt);
      player.vx = lerp(player.vx, 0, brake);
      player.vy = lerp(player.vy, 0, brake);
    }
    this.movePlayer(player.vx * dt, player.vy * dt);
  }

  movePlayer(dx, dy) {
    const player = this.run.player;
    const result = moveCircleWithSliding(
      player,
      dx,
      dy,
      this.collisionObstacles(),
      this.encounter.bounds,
    );
    player.x = result.x;
    player.y = result.y;
    if (result.collided) {
      player.vx = result.slideX;
      player.vy = result.slideY;
    }
  }

  interactWithRoom() {
    const player = this.run.player;
    const nearbyHazard = this.encounter.hazards
      .filter((hazard) => hazard.rect && ["interactive_steam_vent", "boss_quench_valve"].includes(hazard.type))
      .map((hazard) => ({ hazard, distance: dist(player, rectCenter(hazard.rect)) }))
      .filter((entry) => entry.distance <= 24)
      .sort((a, b) => a.distance - b.distance)[0]?.hazard;
    if (nearbyHazard?.type === "interactive_steam_vent") {
      if (nearbyHazard.cooldownTimer > 0) {
        this.ui.toast?.("VENT LEVER IS RECHARGING");
        return;
      }
      nearbyHazard.timer = 0;
      nearbyHazard.cooldownTimer = nearbyHazard.switchCooldown || 4;
      for (const effect of this.encounter.effects) {
        if (effect.type === "hostile_zone" && dist(effect, rectCenter(nearbyHazard.rect)) < 72) effect.time = 0;
      }
      this.ui.toast?.("STEAM PURGE · SLAG QUENCHED");
      audioCall("steam", { interactive: true });
      return;
    }

    const switchObject = this.encounter.obstacles
      .filter((obstacle) => /interactive_switch|interactive_winch/.test(obstacle.material || ""))
      .map((obstacle) => ({ obstacle, distance: dist(player, rectCenter(obstacle)) }))
      .filter((entry) => entry.distance <= 24)
      .sort((a, b) => a.distance - b.distance)[0]?.obstacle;
    if (switchObject) {
      let changed = false;
      for (const hazard of this.encounter.hazards) {
        if (hazard.type === "moving_cover_cart" && (hazard.reverseSwitches || []).includes(switchObject.id)) {
          hazard.directionSign = (hazard.directionSign || 1) * -1;
          changed = true;
        }
        if (hazard.type === "rotating_arm" && (hazard.reversibleBy === switchObject.id || switchObject.material === "interactive_winch")) {
          hazard.direction = (hazard.direction || 1) * -1;
          changed = true;
        }
      }
      if (changed) {
        this.ui.toast?.("MECHANISM REVERSED");
        audioCall("mechanism", { reverse: true });
        return;
      }
    }
    this.ui.toast?.("NO MECHANISM IN REACH");
  }

  damageRoomObstacle(obstacle, damage, source = "ranged") {
    if (!obstacle || !Number.isFinite(obstacle.hp)) return false;
    obstacle.hp -= Math.max(1, damage);
    this.spawnBurst(rectCenter(obstacle).x, rectCenter(obstacle).y, this.encounter.biome.accent, 4);
    if (obstacle.hp > 0) return true;

    const center = rectCenter(obstacle);
    const barrierIndex = this.encounter.barriers.indexOf(obstacle);
    if (barrierIndex >= 0) {
      this.encounter.barriers.splice(barrierIndex, 1);
    } else {
      this.encounter.obstacles = this.encounter.obstacles.filter((entry) => entry !== obstacle);
    }
    this.rebuildNavigation();

    for (const hazard of this.encounter.hazards) {
      if (hazard.type === "obstacle_death_burst" && (!hazard.material || hazard.material === obstacle.material)) {
        this.encounter.effects.push({
          type: "neutral_burst",
          x: center.x,
          y: center.y,
          time: hazard.tell || 0.18,
          count: hazard.count || 6,
          speed: hazard.projectileSpeed || 62,
          damage: hazard.damage || 7,
          color: "#9ceeff",
        });
      }
      if (hazard.type === "enemy_chime_links" && (hazard.obstacleIds || []).includes(obstacle.id)) {
        for (const enemy of this.encounter.enemies) {
          if (enemy.dead) continue;
          enemy.state = "stunned";
          enemy.stateTime = hazard.chimeBreakStun || 0.65;
          this.releaseAttackToken(enemy);
        }
        if (this.run.phase === "ascent" && hazard.ascentWakeNextWave && this.encounter.waves[this.encounter.waveIndex + 1]) this.spawnNextWave();
        this.ui.toast?.("CHIME SHATTER · LINKS SILENCED");
      }
      if (hazard.type === "boss_prism_network" && (hazard.obstacleIds || []).includes(obstacle.id)) {
        this.encounter.prisms.push({ uid: `fixed-node:${obstacle.id}`, ...center, r: 4, life: 999, angle: Math.PI / 4, hostileReflector: true });
      }
    }
    audioCall("shatter", { material: obstacle.material, source });
    return true;
  }

  hitRoomHazard(hazard, source = "ranged") {
    if (!hazard) return false;
    if (hazard.type === "interactive_spore_pod") {
      if (!hazard.alive) return false;
      hazard.alive = false;
      hazard.disabledTimer = hazard.respawn || 8;
      const center = hazard.center;
      if (source === "melee") {
        for (const enemy of this.encounter.enemies) {
          if (enemy.dead || distSq(enemy, center) > (30 + enemy.r) ** 2) continue;
          enemy.state = "stunned";
          enemy.stateTime = 0.8;
          this.releaseAttackToken(enemy);
        }
        this.ui.toast?.("SPORE POD · STUN BURST");
      } else {
        this.encounter.effects.push({ type: "slow_zone", ...center, r: 19, slow: 0.38, time: 3, faction: "player", color: "#8fbf74" });
        this.ui.toast?.("SPORE POD · SLOW CLOUD");
      }
      this.spawnBurst(center.x, center.y, "#d5e884", 14);
      audioCall("spore", { source });
      return true;
    }
    if (hazard.type === "boss_quench_valve") {
      if (hazard.cooldownTimer > 0) return false;
      hazard.hits = (hazard.hits || 0) + 1;
      if (hazard.hits < (hazard.hitsRequired || 3)) {
        this.ui.toast?.(`QUENCH VALVE · ${hazard.hits}/${hazard.hitsRequired || 3}`);
        return true;
      }
      hazard.hits = 0;
      hazard.cooldownTimer = hazard.cooldown || 9;
      const boss = this.encounter.boss;
      if (boss && !boss.dead) {
        boss.state = "stunned";
        boss.stateTime = hazard.bossStun || 1.5;
        boss.corePlates = Math.max(0, (boss.corePlates || 0) - 1);
        this.releaseAttackToken(boss);
      }
      const heat = this.encounter.hazards.find((entry) => entry.type === "rotating_safe_grates");
      if (heat) heat.timer = 0;
      this.clearHostileBullets(rectCenter(hazard.rect), 42, false);
      this.ui.toast?.("QUENCH RELEASE · THE KING STAGGERS");
      audioCall("steam", { boss: true });
      return true;
    }
    return false;
  }

  strikeRoomObjects(action, damage, range, arc) {
    const player = this.run.player;
    for (const obstacle of this.collisionObstacles()) {
      if (!Number.isFinite(obstacle.hp)) continue;
      const center = rectCenter(obstacle);
      const radius = Math.hypot(obstacle.w, obstacle.h) * 0.5;
      if (pointInCone(player, action.angle, range, arc, { ...center, r: radius })) this.damageRoomObstacle(obstacle, damage, "melee");
    }
    for (const hazard of this.encounter.hazards) {
      if (!hazard.alive && hazard.type === "interactive_spore_pod") continue;
      const center = hazard.center || (hazard.rect ? rectCenter(hazard.rect) : null);
      if (!center || !["interactive_spore_pod", "boss_quench_valve"].includes(hazard.type)) continue;
      const radius = hazard.radius || (hazard.rect ? Math.hypot(hazard.rect.w, hazard.rect.h) * 0.5 : 4);
      if (pointInCone(player, action.angle, range, arc, { ...center, r: radius })) this.hitRoomHazard(hazard, "melee");
    }
  }

  cycleWeapon() {
    const unlocked = (this.meta.unlockedWeapons || ["chainblade"]).filter((id) => Content.WEAPONS[id]);
    if (unlocked.length < 2) return;
    const player = this.run.player;
    const current = Math.max(0, unlocked.indexOf(this.run.weaponId));
    this.run.weaponState[this.run.weaponId] = {
      ammo: player.ammo,
      reload: player.reload,
      impactCharge: player.impactCharge || 0,
    };
    this.run.weaponId = unlocked[(current + 1) % unlocked.length];
    this.meta.selectedWeapon = this.run.weaponId;
    const weapon = Content.WEAPONS[this.run.weaponId];
    const saved = this.run.weaponState[this.run.weaponId] || {
      ammo: weapon.resource?.capacity ?? Infinity,
      reload: 0,
      impactCharge: 0,
    };
    this.run.weaponState[this.run.weaponId] = saved;
    player.ammo = saved.ammo;
    player.reload = saved.reload;
    player.impactCharge = saved.impactCharge;
    player.action = null;
    this.bot.weaponsUsed.add(this.run.weaponId);
    audioCall("weaponSwap", { weapon: this.run.weaponId });
    this.ui.toast?.(`${weapon.name} readied`);
  }

  beginReload() {
    const player = this.run.player;
    const weapon = Content.WEAPONS[this.run.weaponId];
    if (weapon.resource?.type !== "magazine" || player.reload > 0 || player.ammo >= weapon.resource.capacity) return;
    player.reload = weapon.resource.reload || 0.9;
    player.action = null;
    audioCall("reload", { stage: "start" });
  }

  beginPlayerAction(type) {
    const run = this.run;
    const player = run.player;
    const weapon = Content.WEAPONS[run.weaponId];
    const part = type === "technique" ? weapon.technique : weapon.primary;
    if (!part) return;
    if (type === "technique" && player.techniqueCooldown > 0) return;
    if (type === "primary" && weapon.resource?.type === "magazine" && player.ammo <= 0) {
      audioCall("empty");
      this.beginReload();
      return;
    }

    let step = null;
    let startup;
    let active;
    let recovery;
    let payload = part;
    if (type === "primary" && part.pattern === "melee_combo") {
      step = player.comboTimer > 0 ? (player.combo % part.timeline.length) : 0;
      payload = part.timeline[step];
      startup = payload.startup;
      active = payload.active;
      recovery = payload.recovery;
      player.combo = step + 1;
      player.comboTimer = weapon.resource?.resetAfter || 0.5;
    } else {
      startup = weaponTimelinePart(part, "startup", type === "technique" ? 0.14 : 0.07);
      active = weaponTimelinePart(part, "active", 0.04);
      recovery = weaponTimelinePart(part, "recovery", type === "technique" ? 0.20 : 0.14);
    }

    const speedStacks = hasTechnique(run, "serrated_rhythm") ? run.alternatingStacks : 0;
    const cargoSpeed = cargoEffects(run, "attack_speed_multiplier").reduce((value, effect) => value * (effect.value || 1), 1);
    const speedScale = 1 / Math.max(0.6, (1 + speedStacks * 0.08) * cargoSpeed);
    player.action = {
      id: `${type}:${this.time}`,
      type,
      part,
      payload,
      step,
      phase: "startup",
      time: startup * speedScale,
      startup: startup * speedScale,
      active: active * speedScale,
      recovery: recovery * speedScale,
      resolved: false,
      hitIds: new Set(),
      angle: player.aim,
      charge: type === "technique" && weapon.resource?.type === "impact_charge" ? player.impactCharge || 0 : 0,
    };
    if (type === "primary" && weapon.resource?.type === "magazine") player.ammo -= 1;
    if (type === "technique") {
      if (weapon.resource?.type === "impact_charge") player.impactCharge = 0;
      const cargoCooldown = cargoEffects(run, "technique_cooldown_multiplier")
        .reduce((value, effect) => value * (effect.value || 1), 1);
      if (player.freeTechniqueCharges > 0) {
        player.freeTechniqueCharges -= 1;
        player.techniqueCooldown = 0;
        this.ui.toast?.("KING'S TITHE · TECHNIQUE REFRESHED");
      } else {
        player.techniqueCooldown = (part.cooldown || 4) * cargoCooldown;
      }
    }
    this.trackAlternating(type);
    this.metrics.attacksStarted += 1;
    audioCall(type === "technique" ? "attack" : (weapon.kind.includes("ranged") ? "shoot" : "melee"), { weapon: run.weaponId });
  }

  trackAlternating(type) {
    if (!hasTechnique(this.run, "serrated_rhythm")) return;
    if (this.run.alternatingLast && this.run.alternatingLast !== type) {
      this.run.alternatingStacks = Math.min(4, this.run.alternatingStacks + 1);
      this.run.alternatingTimer = 3;
    } else if (this.run.alternatingLast === type) {
      this.run.alternatingStacks = 0;
    }
    this.run.alternatingLast = type;
  }

  updatePlayerAction(dt) {
    const action = this.run.player.action;
    if (!action) return;
    action.time -= dt;
    if (action.time > 0) return;
    if (action.phase === "startup") {
      action.phase = "active";
      action.time = action.active;
      this.resolvePlayerAction(action);
      return;
    }
    if (action.phase === "active") {
      action.phase = "recovery";
      action.time = action.recovery;
      return;
    }
    this.run.player.action = null;
  }

  resolvePlayerAction(action) {
    const run = this.run;
    const player = run.player;
    const weapon = Content.WEAPONS[run.weaponId];
    const pattern = action.part.pattern;
    const damageScale = action.damageScale || 1;
    if (action.type === "primary") {
      if (pattern.includes("melee")) {
        this.playerMelee(action, (action.payload.damage || action.part.damage) * damageScale, (action.payload.poise || action.part.poise) * damageScale, action.payload.range || action.part.range, action.payload.arc || action.part.arc);
      } else {
        this.firePlayerProjectile({ ...action.part, damage: (action.part.damage || 18) * damageScale, poise: (action.part.poise || 10) * damageScale }, { kind: run.weaponId, angle: action.angle, primary: true });
      }
      return;
    }

    if (pattern === "hook_pull_or_grapple") {
      this.resolveHook(action, damageScale);
    } else if (pattern === "charged_pin_projectile") {
      this.firePlayerProjectile({ ...action.part, damage: (action.part.damage || 18) * damageScale, poise: (action.part.poise || 10) * damageScale }, { kind: "pin", angle: action.angle, mark: true });
    } else if (pattern === "charged_ground_cone") {
      const impact = clamp((action.charge || 0) / 100, 0, 1);
      this.playerMelee(
        action,
        action.part.damage * damageScale * (1 + impact * 1.35),
        action.part.poise * damageScale * (1 + impact * 0.75),
        action.part.range * (1 + impact * 0.22),
        action.part.arc,
        { heavy: true, clearBullets: 14 + impact * 18, reflectBullets: impact >= 0.99 },
      );
    } else if (pattern === "place_shot_splitter") {
      const distance = Math.min(action.part.placeRange || 70, dist(player, this.input.pointer));
      const offset = vecFromAngle(action.angle, distance);
      this.encounter.prisms.push({ uid: `prism:${this.time}`, x: player.x + offset.x, y: player.y + offset.y, r: 4, life: action.part.life || 6, angle: action.angle + Math.PI / 2 });
      audioCall("ricochet", { kind: "prism-place" });
    } else {
      this.playerMelee(action, (action.part.damage || 28) * damageScale, (action.part.poise || 24) * damageScale, action.part.range || 25, action.part.arc || 80);
    }

    if (hasTechnique(run, "echo_seal") && !action.echoed) {
      const echo = stableClone(action);
      echo.hitIds = new Set();
      echo.echoed = true;
      this.encounter.effects.push({ type: "action_echo", time: 0.32, action: echo, power: 0.5 });
      player.techniqueCooldown *= 1.15;
    }
  }

  playerMelee(action, damage = 20, poise = 15, range = 19, arc = 85, options = {}) {
    const player = this.run.player;
    const direction = vecFromAngle(action.angle, action.payload.moveStep || 0);
    if (action.payload.moveStep) this.movePlayer(direction.x, direction.y);
    let hitAny = false;
    for (const enemy of this.encounter.enemies) {
      if (enemy.dead || action.hitIds.has(enemy.uid)) continue;
      if (!pointInCone(player, action.angle, range, arc, enemy, enemy.r)) continue;
      action.hitIds.add(enemy.uid);
      hitAny = true;
      this.damageEnemy(enemy, this.modifyPlayerDamage(damage, { ...options, primary: action.type === "primary" }), poise, {
        source: "melee",
        heavy: options.heavy || this.run.weaponId === "maul",
        technique: action.type === "technique",
        angle: action.angle,
      });
    }
    for (const boss of this.encounter.enemies.filter((enemy) => enemy.boss && !enemy.dead)) {
      for (const mirror of boss.mirrors || []) {
        if (mirror.disabled > 0 || !pointInCone(player, action.angle, range, arc, mirror, mirror.r)) continue;
        mirror.disabled = 6;
        this.spawnBurst(mirror.x, mirror.y, boss.def.color, 12);
        audioCall("shatter", { mirror: true });
      }
    }
    this.strikeRoomObjects(action, damage, range, arc);
    for (const mine of this.encounter.effects) {
      if (mine.type !== "mine" || mine.faction !== "enemy") continue;
      if (!mine.redirectable && this.run.weaponId !== "maul") continue;
      if (!pointInCone(player, action.angle, range + mine.r, arc, mine, mine.r)) continue;
      mine.faction = "player";
      mine.armed = true;
      mine.time = Math.min(mine.time, 0.18);
      mine.damage *= 1.25;
      mine.color = COLORS.deflect;
      audioCall("perfect", { mine: true });
    }
    if (options.clearBullets) this.clearHostileBullets(player, options.clearBullets, Boolean(options.reflectBullets));
    const end = vecFromAngle(action.angle, range);
    this.encounter.effects.push({ type: "slash", x: player.x, y: player.y, x2: player.x + end.x, y2: player.y + end.y, angle: action.angle, arc, time: 0.09, color: hitAny ? COLORS.white : Content.WEAPONS[this.run.weaponId].color });
    if (hitAny) audioCall("hit", { weapon: this.run.weaponId });
  }

  modifyPlayerDamage(base, options = {}) {
    const run = this.run;
    const player = run.player;
    let multiplier = 1 + player.drive / 100 * 0.22;
    if (player.empowered > 0 && player.empoweredCharges > 0 && options.primary) {
      multiplier *= 1.35;
      player.empoweredCharges -= 1;
      if (player.empoweredCharges <= 0) player.empowered = 0;
    }
    if (hasTechnique(run, "weighted_edge") && run.phase === "ascent") multiplier *= 1 + Math.min(0.25, Math.floor(run.carriedWeight / 25) * 0.05);
    if (cargoHasEffect(run, "damage_above_drive") && player.drive >= 75) {
      multiplier *= cargoEffects(run, "damage_above_drive")[0].multiplier || 1.3;
    }
    if (options.heavy) {
      multiplier *= cargoEffects(run, "heavy_hit_damage_multiplier").reduce((value, effect) => value * (effect.value || 1), 1);
    }
    let result = base * multiplier;
    if (player.quenchStored > 0) {
      result += player.quenchStored;
      player.quenchStored = 0;
    }
    return result;
  }

  resolveHook(action, damageScale = 1) {
    const player = this.run.player;
    const range = action.part.range || 80;
    const candidates = this.encounter.enemies
      .filter((enemy) => !enemy.dead && pointInCone(player, action.angle, range, 20, enemy, enemy.r))
      .sort((a, b) => distSq(player, a) - distSq(player, b));
    const target = candidates[0];
    const end = target || { x: player.x + Math.cos(action.angle) * range, y: player.y + Math.sin(action.angle) * range };
    this.encounter.effects.push({ type: "chain", x: player.x, y: player.y, x2: end.x, y2: end.y, time: 0.18, color: "#e3d5b5" });
    if (!target) return;
    this.damageEnemy(target, this.modifyPlayerDamage((action.part.damage || 26) * damageScale), (action.part.poise || 20) * damageScale, { source: "technique", technique: true, angle: action.angle });
    const direction = normalizeVector(player.x - target.x, player.y - target.y);
    if (target.boss || target.r > 7) {
      this.movePlayer(-direction.x * (action.part.pullPlayerToHeavy || 30), -direction.y * (action.part.pullPlayerToHeavy || 30));
    } else {
      const moved = moveCircleWithSliding(target, direction.x * (action.part.pullEnemy || 28), direction.y * (action.part.pullEnemy || 28), this.collisionObstacles(), this.encounter.bounds);
      target.x = moved.x;
      target.y = moved.y;
    }
  }

  firePlayerProjectile(part, options = {}) {
    const player = this.run.player;
    const baseAngle = options.angle ?? player.aim;
    const split = hasTechnique(this.run, "prism_chamber") && (++player.shotCounter % 5 === 0);
    const angles = [baseAngle];
    if (split) angles.push(baseAngle - degrees(16), baseAngle + degrees(16));
    for (let index = 0; index < angles.length; index += 1) {
      const angle = angles[index] + degrees(this.run.rng.range(-(part.spread || 0), part.spread || 0));
      const velocity = vecFromAngle(angle, part.projectileSpeed || 135);
      this.spawnProjectile({
        x: player.x + Math.cos(angle) * 6,
        y: player.y + Math.sin(angle) * 6,
        vx: velocity.x,
        vy: velocity.y,
        r: part.projectileRadius || 1.3,
        damage: this.modifyPlayerDamage((part.damage || 18) * (index ? 0.6 : 1), { primary: Boolean(options.primary) }),
        poise: part.poise || 10,
        faction: "player",
        color: Content.WEAPONS[this.run.weaponId].color,
        life: (part.range || 170) / (part.projectileSpeed || 135),
        bounces: (part.reflections || 0) + cargoEffects(this.run, "all_projectiles_reflect").reduce((sum, effect) => sum + (effect.count || 0), 0),
        pierce: hasTechnique(this.run, "hollow_points") ? 1 : 0,
        kind: options.kind || "shot",
        mark: Boolean(options.mark),
        reflectedDamageMultiplier: part.reflectedDamageMultiplier || 1.2,
      });
    }
    audioCall(this.run.weaponId === "prism" ? "ricochet" : "shoot", { weapon: this.run.weaponId });
  }

  spawnProjectile(projectile) {
    this.encounter.projectiles.push({
      uid: `p:${this.time}:${this.encounter.projectiles.length}`,
      x: projectile.x,
      y: projectile.y,
      px: projectile.x,
      py: projectile.y,
      vx: projectile.vx,
      vy: projectile.vy,
      r: projectile.r || 1.5,
      damage: projectile.damage || 8,
      poise: projectile.poise || 4,
      faction: projectile.faction || "enemy",
      color: projectile.color || COLORS.danger,
      life: projectile.life || 3,
      bounces: projectile.bounces || 0,
      pierce: projectile.pierce || 0,
      kind: projectile.kind || "bolt",
      homing: projectile.homing || 0,
      turn: projectile.turn || 0,
      deflectable: projectile.deflectable !== false,
      nearMiss: false,
      hitIds: new Set(),
      mark: projectile.mark,
      reflectedDamageMultiplier: projectile.reflectedDamageMultiplier || 1.5,
      splitBy: projectile.splitBy instanceof Set ? new Set(projectile.splitBy) : new Set(),
      source: projectile.source || null,
      reflected: Boolean(projectile.reflected),
    });
    this.metrics.projectilesSpawned += 1;
  }

  onDash(tier) {
    const run = this.run;
    const player = run.player;
    if (hasTechnique(run, "razor_wake")) {
      const back = vecFromAngle(Math.atan2(player.dashDir.y, player.dashDir.x) + Math.PI, 12);
      this.encounter.effects.push({
        type: "damage_zone", x: player.x + back.x, y: player.y + back.y,
        r: 8, damage: 18, poise: 8, time: 0.35, faction: "player", hitIds: new Set(), color: "#d9eef0",
      });
    }
    if (hasTechnique(run, "slip_chamber")) {
      const weapon = Content.WEAPONS[run.weaponId];
      if (weapon.resource?.type === "magazine") {
        player.ammo = Math.min(weapon.resource.capacity, player.ammo + Math.ceil(weapon.resource.capacity * 0.25));
      } else {
        player.techniqueCooldown = Math.max(0, player.techniqueCooldown - 0.6);
      }
    }
    for (const effect of cargoEffects(run, "dash_slow_cloud")) {
      this.encounter.effects.push({ type: "slow_zone", x: player.x, y: player.y, r: effect.radius || 15, slow: effect.slow || 0.3, time: effect.life || 2, faction: "player", color: "#668f75" });
    }
    const mirror = cargoEffects(run, "post_dash_repeat_hit")[0];
    if (mirror && player.mirrorCooldown <= 0) {
      player.postDashEcho = mirror;
    }
    if (tier.id === "crushing") this.shake = Math.max(this.shake, 1.5);
  }

  resolveCrushingDash() {
    const player = this.run.player;
    for (const enemy of this.encounter.enemies) {
      if (enemy.dead || enemy.crushedDashSerial === player.dashSerial) continue;
      if (!circlesIntersect({ ...player, r: player.r + 2 }, enemy)) continue;
      enemy.crushedDashSerial = player.dashSerial;
      const cargoDamage = cargoEffects(this.run, "crushing_dash_damage")[0];
      this.damageEnemy(enemy, cargoDamage?.damage || 24, (cargoDamage?.poise || 35) + (hasTechnique(this.run, "weighted_edge") ? 20 : 0), { source: "dash", heavy: true, angle: Math.atan2(player.dashDir.y, player.dashDir.x) });
    }
  }

  updateEnemies(dt) {
    const encounter = this.encounter;
    encounter.nav.buildFlowField(this.run.player);
    encounter.attackTokensUsed = encounter.enemies.reduce((sum, enemy) => sum + (enemy.tokenHeld || 0), 0);
    for (const enemy of encounter.enemies) {
      if (enemy.dead) {
        enemy.stateTime -= dt;
        continue;
      }
      enemy.flash = Math.max(0, enemy.flash - dt);
      enemy.mark = Math.max(0, enemy.mark - dt);
      enemy.armorBroken = Math.max(0, (enemy.armorBroken || 0) - dt);
      enemy.recoveryBuffTime = Math.max(0, (enemy.recoveryBuffTime || 0) - dt);
      if (enemy.recoveryBuffTime <= 0) {
        enemy.buff = 1;
        enemy.recoveryBuff = 1;
      }
      if (enemy.burn) {
        enemy.burn.time -= dt;
        enemy.burn.tick -= dt;
        if (enemy.burn.tick <= 0) {
          enemy.burn.tick = 0.5;
          enemy.hp -= enemy.burn.damage;
          this.spawnParticle(enemy.x, enemy.y, "#ff9b4a", 0.24, this.run.rng.range(-4, 4), -8, 1.5);
          if (enemy.hp <= 0) this.killEnemy(enemy, { source: "burn" });
        }
        if (enemy.burn.time <= 0) enemy.burn = null;
      }
      if (enemy.dead) continue;
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      if (enemy.boss) {
        this.updateBossPhase(enemy);
        this.updateBossScript(enemy, dt);
      }

      if (enemy.state === "enter") {
        enemy.stateTime -= dt;
        if (enemy.stateTime <= 0) enemy.state = "move";
        continue;
      }
      if (enemy.state === "stunned") {
        enemy.stateTime -= dt;
        enemy.vx = lerp(enemy.vx, 0, smooth(18, dt));
        enemy.vy = lerp(enemy.vy, 0, smooth(18, dt));
        if (enemy.stateTime <= 0) {
          enemy.state = "move";
          enemy.poise = enemy.maxPoise;
          enemy.cooldown = 0.12;
        }
        continue;
      }
      if (enemy.state === "tell") {
        enemy.stateTime -= dt;
        if (enemy.stateTime <= 0) {
          enemy.state = "active";
          enemy.stateTime = enemy.attackTimeline.active;
          enemy.activeResolved = false;
          enemy.shotsFired = 0;
          this.beginEnemyActive(enemy);
        }
        continue;
      }
      if (enemy.state === "active") {
        this.updateEnemyActive(enemy, dt);
        enemy.stateTime -= dt;
        if (enemy.stateTime <= 0) {
          enemy.state = "recover";
          const cargoRecovery = cargoEffects(this.run, "enemy_recovery_multiplier").reduce((value, effect) => value * (effect.value || 1), 1);
          const chimeRecovery = this.encounter.hazards
            .filter((hazard) => hazard.type === "enemy_chime_links" && hazard.active)
            .reduce((value, hazard) => value * (hazard.linkedRecoveryMultiplier || 1), 1);
          enemy.stateTime = enemy.attackTimeline.recovery * cargoRecovery * chimeRecovery * (enemy.recoveryBuff || 1);
          this.releaseAttackToken(enemy);
        }
        continue;
      }
      if (enemy.state === "recover") {
        enemy.stateTime -= dt;
        if (enemy.stateTime <= 0) {
          enemy.state = "move";
          if (enemy.boss && enemy.exposeAfterRecovery) {
            enemy.exposed = Math.max(enemy.exposed || 0, enemy.exposeAfterRecovery.duration || 1.25);
            enemy.exposeAfterRecovery = null;
            this.ui.toast?.(`${enemy.def.name} EXPOSED`);
          }
          enemy.cooldown = rangeFrom(this.run.rng, enemy.attack?.cooldown, 0.75);
          enemy.attack = null;
        }
        continue;
      }

      this.updateEnemyMovement(enemy, dt);
      if (enemy.cooldown <= 0) this.tryEnemyAttack(enemy);
    }

    encounter.enemies = encounter.enemies.filter((enemy) => !enemy.dead || enemy.stateTime > 0);
  }

  updateEnemyMovement(enemy, dt) {
    const player = this.run.player;
    const def = enemy.def;
    const distance = dist(enemy, player);
    const toPlayer = normalizeVector(player.x - enemy.x, player.y - enemy.y);
    const targetFacing = Math.atan2(toPlayer.y, toPlayer.x);
    enemy.aim += clamp(angleDiff(targetFacing, enemy.aim), -3.4 * dt, 3.4 * dt);
    const hasLos = this.encounter.nav.hasLineOfSight(enemy, player, enemy.r * 0.25);
    let desired = hasLos ? toPlayer : this.encounter.nav.directionAt(enemy);
    if (!desired.reachable && !hasLos) {
      desired = { x: toPlayer.x, y: toPlayer.y };
      this.metrics.unreachableSamples += 1;
    }
    this.metrics.navSamples += 1;
    const preferred = def.preferredRange || 20;
    const brain = def.brain || "chase";
    const ranged = preferred > 30 || /kite|marksman|sniper|artillery|support|gunner|controller|channel/.test(brain);

    if (ranged && hasLos) {
      if (distance < preferred * 0.72) {
        desired = { x: -toPlayer.x, y: -toPlayer.y };
      } else if (distance < preferred * 1.12) {
        desired = { x: -toPlayer.y * enemy.side, y: toPlayer.x * enemy.side };
      }
    } else if (/flank|sidestep|hound|thief/.test(brain) && distance < preferred * 2.3) {
      const blend = 0.5;
      desired = normalizeVector(
        toPlayer.x + -toPlayer.y * enemy.side * blend,
        toPlayer.y + toPlayer.x * enemy.side * blend,
      );
    }

    const margin = enemy.r + 12;
    const bounds = this.encounter.bounds;
    const edgeX = enemy.x < bounds.x + margin ? 1 - (enemy.x - bounds.x) / margin
      : enemy.x > bounds.x + bounds.w - margin ? -1 + (bounds.x + bounds.w - enemy.x) / margin : 0;
    const edgeY = enemy.y < bounds.y + margin ? 1 - (enemy.y - bounds.y) / margin
      : enemy.y > bounds.y + bounds.h - margin ? -1 + (bounds.y + bounds.h - enemy.y) / margin : 0;
    desired = normalizeVector(desired.x + edgeX * 1.8, desired.y + edgeY * 1.8, toPlayer.x, toPlayer.y);

    const lookAhead = { x: enemy.x + desired.x * 15, y: enemy.y + desired.y * 15 };
    const projectedAhead = this.encounter.nav.projectToWalkable(lookAhead, 7);
    if (!projectedAhead || projectedAhead.projected) {
      const tangents = [
        { x: -toPlayer.y * enemy.side, y: toPlayer.x * enemy.side },
        { x: toPlayer.y * enemy.side, y: -toPlayer.x * enemy.side },
      ];
      const openTangent = tangents.find((tangent) => {
        const point = { x: enemy.x + tangent.x * 13, y: enemy.y + tangent.y * 13 };
        const projectedPoint = this.encounter.nav.projectToWalkable(point, 5);
        return projectedPoint && !projectedPoint.projected;
      });
      desired = openTangent || toPlayer;
      enemy.side *= -1;
    }

    // Keep formations fluid instead of allowing a single doorway pile-up.
    let separateX = 0;
    let separateY = 0;
    for (const other of this.encounter.enemies) {
      if (other === enemy || other.dead) continue;
      const minimum = enemy.r + other.r + 2;
      const d2 = distSq(enemy, other);
      if (d2 <= 0 || d2 >= minimum * minimum) continue;
      const d = Math.sqrt(d2);
      separateX += (enemy.x - other.x) / d * (1 - d / minimum);
      separateY += (enemy.y - other.y) / d * (1 - d / minimum);
    }
    desired = normalizeVector(desired.x + separateX * 0.8, desired.y + separateY * 0.8, desired.x, desired.y);
    const slow = this.slowAt(enemy);
    const speed = (def.speed || 35) * enemy.buff * slow * (enemy.boss ? (enemy.def.phases?.[enemy.phase]?.moveScale || 1) : 1);
    const response = smooth(enemy.boss ? 8 : 12, dt);
    enemy.vx = lerp(enemy.vx, desired.x * speed, response);
    enemy.vy = lerp(enemy.vy, desired.y * speed, response);
    const result = moveCircleWithSliding(enemy, enemy.vx * dt, enemy.vy * dt, this.collisionObstacles(), this.encounter.bounds);
    enemy.x = result.x;
    enemy.y = result.y;
    if (result.collided) {
      enemy.vx = result.slideX;
      enemy.vy = result.slideY;
    }

    const telemetry = enemy.navState.update(enemy, speed, dt);
    if (telemetry.stuck) {
      this.metrics.stuckEvents += 1;
      const projected = this.encounter.nav.projectToWalkable(enemy, 24);
      if (projected) {
        enemy.x = lerp(enemy.x, projected.x, 0.42);
        enemy.y = lerp(enemy.y, projected.y, 0.42);
      }
      enemy.side *= -1;
      enemy.vx += -desired.y * 28 * enemy.side;
      enemy.vy += desired.x * 28 * enemy.side;
      enemy.navState.markRecovered(enemy);
      this.metrics.recoveries += 1;
    }
    if (def.movementTrail) {
      enemy.trailTimer -= dt;
      if (enemy.trailTimer <= 0 && Math.hypot(enemy.vx, enemy.vy) > 12) {
        enemy.trailTimer = 0.32;
        this.encounter.effects.push({
          type: "hostile_zone", x: enemy.x, y: enemy.y,
          r: def.movementTrail.radius || 3.5,
          damage: def.movementTrail.damage || 5,
          time: def.movementTrail.life || 3,
          hitTimer: 0,
          color: "#f36f43",
        });
      }
    }
  }

  slowAt(entity) {
    let multiplier = 1;
    for (const effect of this.encounter.effects) {
      if (effect.type !== "slow_zone" || effect.time <= 0) continue;
      if (distSq(entity, effect) <= (effect.r + entity.r) ** 2) multiplier *= 1 - effect.slow;
    }
    return multiplier;
  }

  enemyAttackRange(attack) {
    if (/projectile|burst|orb|lance|ring|mortar|tether|beam|copy|channel|link|fan|halo|cage/.test(attack.pattern)) return attack.range || 110;
    if (/charge|leap|pounce|rush/.test(attack.pattern)) return attack.range || 75;
    return attack.range || 20;
  }

  tryEnemyAttack(enemy) {
    const attacks = enemy.boss ? this.bossPatternDeck(enemy) : (enemy.def.attacks || []);
    if (!attacks.length) return;
    const playerDistance = dist(enemy, this.run.player);
    const candidates = attacks.filter((attack) => {
      if (/reinforcement_channel/.test(attack.pattern) && (enemy.reinforcementWaves || 0) >= (attack.maxWaves || Infinity)) return false;
      if (enemy.boss) return true;
      const range = this.enemyAttackRange(attack);
      if (/blink|empower|link|channel|barrier/.test(attack.pattern)) return true;
      return playerDistance <= range * 1.1;
    });
    if (!candidates.length) return;
    const attack = enemy.boss
      ? this.run.rng.weighted(candidates, (entry) => entry.weight || 1)
      : this.run.rng.pick(candidates);
    const tokenCost = enemy.boss ? 3 : (attack.tokenCost || 1);
    if (!enemy.boss && this.encounter.attackTokensUsed + tokenCost > this.encounter.attackTokenCap) return;
    this.startEnemyAttack(enemy, attack, tokenCost);
  }

  startEnemyAttack(enemy, attack, tokenCost = 1) {
    const timeline = attackTimeline(attack);
    const player = this.run.player;
    const predict = attack.predict || 0;
    const target = {
      x: player.x + player.vx * predict,
      y: player.y + player.vy * predict,
    };
    enemy.attack = attack;
    enemy.attackTimeline = timeline;
    enemy.state = "tell";
    enemy.stateTime = timeline.tell;
    enemy.aim = angleBetween(enemy, target);
    enemy.lockedTarget = target;
    enemy.tokenHeld = tokenCost;
    enemy.activeResolved = false;
    enemy.shotsFired = 0;
    this.encounter.attackTokensUsed += tokenCost;
    audioCall("enemyTell", { enemy: enemy.id, attack: attack.pattern, urgency: 1 - timeline.tell });
  }

  releaseAttackToken(enemy) {
    if (!enemy.tokenHeld) return;
    this.encounter.attackTokensUsed = Math.max(0, this.encounter.attackTokensUsed - enemy.tokenHeld);
    enemy.tokenHeld = 0;
  }

  beginEnemyActive(enemy) {
    const pattern = enemy.attack.pattern;
    if (pattern === "root_burrow_rush") {
      const projected = this.encounter.nav.projectToWalkable(enemy.lockedTarget, 36);
      this.spawnBurst(enemy.x, enemy.y, enemy.def.color, 12);
      if (projected) {
        enemy.x = projected.x;
        enemy.y = projected.y;
      }
      const ringAttack = {
        ...enemy.attack,
        damage: enemy.attack.emergeDamage || enemy.attack.damage || 18,
        safeGaps: Math.max(1, Math.round((enemy.attack.safeGap || 60) / (360 / (enemy.attack.ringCount || 11)))),
      };
      this.enemyRing(enemy, ringAttack, enemy.attack.ringCount || 11, enemy.attack.ringSpeed || 58);
      if (dist(enemy, this.run.player) < enemy.r + this.run.player.r + 10) {
        this.damagePlayer(enemy.attack.emergeDamage || 18, { source: enemy, angle: enemy.aim, kind: "burrow" });
      }
      enemy.activeResolved = true;
      this.spawnBurst(enemy.x, enemy.y, enemy.def.color, 18);
      return;
    }
    if (/blink|glass_step/.test(pattern)) {
      const anchors = this.encounter.spawnPoints.filter((point) => dist(point, this.run.player) > 32);
      const point = this.run.rng.pick(anchors) || { x: enemy.x, y: enemy.y };
      const projected = this.encounter.nav.projectToWalkable(point, 30);
      if (projected) {
        this.spawnBurst(enemy.x, enemy.y, enemy.def.color, 8);
        enemy.x = projected.x;
        enemy.y = projected.y;
        this.spawnBurst(enemy.x, enemy.y, enemy.def.color, 8);
      }
      enemy.activeResolved = !/glass_step/.test(pattern);
    }
    if (/charge|leap|pounce|rush|shield_bash/.test(pattern)) {
      const velocity = vecFromAngle(enemy.aim, enemy.attack.speed || enemy.def.speed * 2.5);
      enemy.vx = velocity.x;
      enemy.vy = velocity.y;
    }
    enemy.activeBeat = 0;
    if (pattern === "steal_then_flee") enemy.vx = Math.cos(enemy.aim) * (enemy.attack.speed || 110);
  }

  updateEnemyActive(enemy, dt) {
    const attack = enemy.attack;
    const pattern = attack.pattern;
    const elapsed = enemy.attackTimeline.active - enemy.stateTime;

    if (pattern === "root_burrow_rush") return;

    if (/glass_step/.test(pattern)) {
      const repeats = attack.repeats || 1;
      const interval = attack.repeatDelay || 0.32;
      if (enemy.shotsFired < repeats && elapsed >= enemy.shotsFired * interval) {
        if (enemy.shotsFired > 0) {
          const anchors = this.encounter.spawnPoints.filter((point) => dist(point, this.run.player) > 28);
          const point = this.encounter.nav.projectToWalkable(this.run.rng.pick(anchors) || enemy, 30);
          if (point) {
            this.spawnBurst(enemy.x, enemy.y, enemy.def.color, 7);
            enemy.x = point.x;
            enemy.y = point.y;
          }
        }
        for (let index = 0; index < (attack.crossCount || 4); index += 1) {
          const angle = index / (attack.crossCount || 4) * TAU + (enemy.shotsFired % 2 ? Math.PI / 4 : 0);
          this.enemyAimedShot(enemy, attack, angle, { speed: attack.projectileSpeed || 86 });
        }
        enemy.shotsFired += 1;
      }
      return;
    }

    if (pattern === "king_hammer_rail" || pattern === "hammer_line_then_cross") {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        const length = 150;
        const a = { x: enemy.x, y: enemy.y };
        const b = { x: enemy.x + Math.cos(enemy.aim) * length, y: enemy.y + Math.sin(enemy.aim) * length };
        const width = (attack.lineWidth || 14) / 2;
        if (distancePointSegment(this.run.player, a, b).distance <= this.run.player.r + width) {
          this.damagePlayer(attack.lineDamage || attack.damage || 21, { source: enemy, angle: enemy.aim, kind: "hammer-rail" });
        }
        this.encounter.effects.push({ type: "strike_line", ...a, x2: b.x, y2: b.y, width: attack.lineWidth || 14, time: 0.18, color: enemy.def.color });
        for (const side of [-1, 1]) {
          this.enemyAimedShot(enemy, { ...attack, damage: attack.crossDamage || 17 }, enemy.aim + side * Math.PI / 2, { speed: attack.crossSpeed || 80, kind: "hammer_cross" });
        }
        this.shake = Math.max(this.shake, 3);
      }
      return;
    }

    if (/bellows_sweep/.test(pattern)) {
      const progress = clamp(elapsed / Math.max(0.01, enemy.attackTimeline.active), 0, 1);
      const sweep = degrees(attack.maxSweep || 90);
      const sweepAngle = enemy.aim - sweep / 2 + sweep * progress;
      if (!enemy.activeResolved && pointInCone(enemy, sweepAngle, attack.range || 58, attack.arc || 65, this.run.player, this.run.player.r)
        && this.encounter.nav.hasLineOfSight(enemy, this.run.player)) {
        enemy.activeResolved = true;
        this.damagePlayer(attack.damage || 19, { source: enemy, angle: sweepAngle, kind: "bellows" });
      }
      this.encounter.effects.push({ type: "slash", x: enemy.x, y: enemy.y, x2: enemy.x + Math.cos(sweepAngle) * (attack.range || 58), y2: enemy.y + Math.sin(sweepAngle) * (attack.range || 58), angle: sweepAngle, arc: attack.arc || 65, time: 0.04, color: enemy.def.color });
      return;
    }

    if (/sidestep_jab/.test(pattern)) {
      const steps = attack.sidesteps || 3;
      const interval = attack.sidestepTime || 0.12;
      if (enemy.activeBeat < steps && elapsed >= enemy.activeBeat * interval) {
        const side = enemy.activeBeat % 2 === 0 ? enemy.side : -enemy.side;
        const moved = moveCircleWithSliding(
          enemy,
          -Math.sin(enemy.aim) * side * 7,
          Math.cos(enemy.aim) * side * 7,
          this.collisionObstacles(),
          this.encounter.bounds,
        );
        enemy.x = moved.x;
        enemy.y = moved.y;
        enemy.activeBeat += 1;
      }
      if (enemy.activeBeat >= steps && !enemy.activeResolved && elapsed >= steps * interval) {
        enemy.activeResolved = true;
        enemy.aim = angleBetween(enemy, this.run.player);
        if (pointInCone(enemy, enemy.aim, attack.range || 15, 70, this.run.player, this.run.player.r)) {
          this.damagePlayer(attack.damage || 7, { source: enemy, angle: enemy.aim, kind: "jab" });
        }
        this.encounter.effects.push({ type: "slash", x: enemy.x, y: enemy.y, x2: enemy.x + Math.cos(enemy.aim) * 17, y2: enemy.y + Math.sin(enemy.aim) * 17, angle: enemy.aim, arc: 70, time: 0.09, color: enemy.def.color });
      }
      return;
    }

    if (/charge|leap|pounce|rush|shield_bash|steal_then_flee/.test(pattern)) {
      if (/pounce_pair/.test(pattern) && enemy.activeBeat === 0 && elapsed >= (attack.repeatDelay || 0.16)) {
        enemy.activeBeat = 1;
        enemy.activeResolved = false;
        enemy.aim = angleBetween(enemy, this.run.player);
        const velocity = vecFromAngle(enemy.aim, attack.speed || 112);
        enemy.vx = velocity.x;
        enemy.vy = velocity.y;
      }
      if (/stepped_shield_bash/.test(pattern)) {
        const beat = Math.min(attack.advanceBeats || 3, Math.floor(elapsed / 0.09) + 1);
        if (beat > enemy.activeBeat) {
          enemy.activeBeat = beat;
          enemy.aim = angleBetween(enemy, this.run.player);
          const velocity = vecFromAngle(enemy.aim, enemy.def.speed * (1.7 + beat * 0.18));
          enemy.vx = velocity.x;
          enemy.vy = velocity.y;
        }
      }
      const result = moveCircleWithSliding(enemy, enemy.vx * dt, enemy.vy * dt, this.collisionObstacles(), this.encounter.bounds);
      enemy.x = result.x;
      enemy.y = result.y;
      if (result.collided) {
        if (/king_quench_charge/.test(pattern) && enemy.corePlates > 0) {
          enemy.corePlates = Math.max(0, enemy.corePlates - (attack.plateBreak || 1));
          this.ui.toast?.(`WALL QUENCH · ${enemy.corePlates} CORE PLATES REMAIN`);
        }
        enemy.state = "stunned";
        enemy.stateTime = attack.wallStun || 0.55;
        enemy.poise = enemy.maxPoise;
        this.releaseAttackToken(enemy);
        this.spawnBurst(enemy.x, enemy.y, "#d9c59d", 7);
        audioCall("stagger", { enemy: enemy.id });
        return;
      }
      if (!enemy.activeResolved && circlesIntersect(enemy, this.run.player, 1)) {
        enemy.activeResolved = true;
        this.damagePlayer(attack.damage || 12, { source: enemy, angle: enemy.aim, kind: "melee" });
        if (pattern === "steal_then_flee" && this.run.cargo.length) {
          const stolen = [...this.run.cargo].sort((a, b) => b.weight - a.weight)[0];
          stolen.sealed = true;
          this.ui.toast?.(`${stolen.name} sealed — kill the Confiscator!`);
        }
      }
      return;
    }

    if (/melee_arc|sidestep_jab|sweeping_cone|shield_bash|hammer_line|hook_pull_slam|bellows_sweep/.test(pattern)) {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        const range = attack.range || (enemy.boss ? 38 : 18);
        const arc = attack.arc || (pattern.includes("sweep") ? 80 : 105);
        if (pointInCone(enemy, enemy.aim, range, arc, this.run.player, this.run.player.r)) {
          this.damagePlayer(attack.damage || attack.lineDamage || 14, { source: enemy, angle: enemy.aim, kind: "melee" });
        }
        this.encounter.effects.push({ type: "slash", x: enemy.x, y: enemy.y, x2: enemy.x + Math.cos(enemy.aim) * range, y2: enemy.y + Math.sin(enemy.aim) * range, angle: enemy.aim, arc, time: 0.11, color: enemy.def.color });
      }
      return;
    }

    if (/empower|haste_link/.test(pattern)) {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        const ally = this.encounter.enemies.filter((entry) => entry !== enemy && !entry.dead).sort((a, b) => distSq(enemy, a) - distSq(enemy, b))[0];
        if (ally) {
          ally.buff = 1.2;
          ally.recoveryBuff = attack.recoveryMultiplier || 0.8;
          ally.recoveryBuffTime = 4;
          this.encounter.effects.push({ type: "link", x: enemy.x, y: enemy.y, target: ally, time: 4, color: enemy.def.color });
        }
      }
      return;
    }

    if (/spawn_barrier|barrier_cross|prism_cage/.test(pattern)) {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        const center = this.run.player;
        if (/prism_cage/.test(pattern)) {
          const gap = this.run.rng.int(0, 3);
          const walls = [
            { x: center.x - 24, y: center.y - 20, w: 48, h: 4 },
            { x: center.x - 24, y: center.y + 16, w: 48, h: 4 },
            { x: center.x - 24, y: center.y - 16, w: 4, h: 32 },
            { x: center.x + 20, y: center.y - 16, w: 4, h: 32 },
          ];
          walls.forEach((wall, index) => {
            if (index === gap) return;
            this.encounter.barriers.push({ ...wall, id: `prism-cage:${this.time}:${index}`, life: attack.closeTime + 2 || 4, hp: attack.prismHp || 90, solid: true, reflect: true, color: enemy.def.color });
          });
          this.ui.toast?.("PRISM CAGE · THE FLICKERING SIDE IS OPEN");
        } else {
          const horizontal = this.run.rng.chance();
          this.encounter.barriers.push({
            x: center.x - (horizontal ? 22 : 3), y: center.y - (horizontal ? 3 : 22),
            w: horizontal ? 44 : 6, h: horizontal ? 6 : 44,
            id: `barrier:${this.time}`,
            life: attack.barrier?.life || attack.barrierLife || 5, hp: attack.barrier?.hp || attack.barrierHp || 45,
            solid: true, reflect: false, color: enemy.def.color,
          });
        }
        this.rebuildNavigation();
      }
      return;
    }

    if (/reinforcement_channel/.test(pattern)) {
      if (!enemy.activeResolved && elapsed > Math.min(0.7, enemy.attackTimeline.active * 0.75)) {
        enemy.activeResolved = true;
        enemy.reinforcementWaves = (enemy.reinforcementWaves || 0) + 1;
        this.spawnBudgetEnemies(attack.reinforcementBudget || 2, enemyPoolFor(this.run.roomIndex, this.run.phase).filter((entry) => !entry.elite));
      }
      return;
    }

    if (/temporary_weight_beam/.test(pattern)) {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        if (dist(enemy, this.run.player) < (attack.range || 78) && this.encounter.nav.hasLineOfSight(enemy, this.run.player)) {
          this.damagePlayer(attack.damage || 6, { source: enemy, angle: enemy.aim, kind: "beam" });
          this.run.player.lienWeight = Math.max(this.run.player.lienWeight, attack.lienWeight || 12);
          this.encounter.effects.push({ type: "beam", x: enemy.x, y: enemy.y, x2: this.run.player.x, y2: this.run.player.y, time: 0.18, color: "#f0d783" });
        }
      }
      return;
    }

    if (/tether_anchor|hook_pull/.test(pattern)) {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        this.enemyAimedShot(enemy, attack, enemy.aim, { kind: "tether", speed: attack.projectileSpeed || 95 });
      }
      return;
    }

    if (/lob_interactive_mine|seed_mortar|crucible_toss/.test(pattern)) {
      const count = attack.count || 1;
      if (enemy.shotsFired < count && elapsed >= enemy.shotsFired * 0.12) {
        const target = enemy.shotsFired === 0 ? enemy.lockedTarget : {
          x: this.run.player.x + this.run.rng.range(-20, 20),
          y: this.run.player.y + this.run.rng.range(-20, 20),
        };
        this.encounter.effects.push({
          type: "mine", x: target.x, y: target.y, r: attack.blastRadius || 17,
          time: attack.armTime || attack.flight || 0.7, fuse: attack.fuse || 1.2,
          damage: attack.damage || 12, faction: "enemy", color: enemy.def.color, armed: false,
          redirectable: Boolean(attack.redirectable || /crucible_toss/.test(pattern)),
          poolLife: attack.poolLife || 0,
          poolRadius: attack.poolRadius || attack.blastRadius || 15,
        });
        enemy.shotsFired += 1;
      }
      return;
    }

    if (/halo_burst/.test(pattern)) {
      const rings = attack.rings || 2;
      const interval = attack.ringDelay || 0.28;
      if (enemy.shotsFired < rings && elapsed >= enemy.shotsFired * interval) {
        const speeds = Array.isArray(attack.projectileSpeed) ? attack.projectileSpeed : [attack.projectileSpeed || 60];
        const ringAttack = { ...attack, safeGaps: Math.max(1, Math.round((attack.safeGap || 55) / (360 / (attack.countPerRing || 8)))) };
        const originalAim = enemy.aim;
        enemy.aim += enemy.shotsFired * degrees(attack.offsetSecondRing || 18);
        this.enemyRing(enemy, ringAttack, attack.countPerRing || 8, speeds[Math.min(enemy.shotsFired, speeds.length - 1)]);
        enemy.aim = originalAim;
        enemy.shotsFired += 1;
      }
      return;
    }

    if (/hammer_combo_ring/.test(pattern)) {
      const strikes = attack.strikes || 3;
      const interval = attack.interval || 0.30;
      if (enemy.shotsFired < strikes && elapsed >= enemy.shotsFired * interval) {
        const radius = 22 + enemy.shotsFired * 4;
        if (dist(enemy, this.run.player) <= radius + this.run.player.r) {
          this.damagePlayer(attack.damage || 22, { source: enemy, angle: enemy.aim, kind: "hammer-combo" });
        }
        this.encounter.effects.push({ type: "impact_ring", x: enemy.x, y: enemy.y, r: radius, time: 0.15, color: enemy.def.color });
        enemy.shotsFired += 1;
        if (enemy.shotsFired === strikes) this.enemyRing(enemy, attack, attack.finalRingCount || 14, attack.finalRingSpeed || 83);
      }
      return;
    }

    if (/offset_ring|magnetic_pull_burst/.test(pattern)) {
      if (/magnetic_pull/.test(pattern)) {
        const pull = normalizeVector(enemy.x - this.run.player.x, enemy.y - this.run.player.y);
        this.movePlayer(pull.x * (attack.pullSpeed || 17) * dt, pull.y * (attack.pullSpeed || 17) * dt);
      }
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        this.enemyRing(enemy, attack, attack.count || attack.burstCount || 10, attack.projectileSpeed || attack.burstSpeed || 72);
      }
      return;
    }

    if (/projectile_fan|rivet_fan/.test(pattern)) {
      const count = attack.count || 3;
      const interval = /rivet_fan/.test(pattern) ? (attack.interval || 0.08) : 0;
      if (interval > 0) {
        if (enemy.shotsFired < count && elapsed >= enemy.shotsFired * interval) {
          const spread = attack.spread || (attack.arc || 50) / Math.max(1, count - 1);
          const angle = enemy.aim + (enemy.shotsFired - (count - 1) / 2) * degrees(spread);
          this.enemyAimedShot(enemy, attack, angle);
          enemy.shotsFired += 1;
        }
      } else if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        this.enemyFan(enemy, attack, count, attack.spread || (attack.arc || 50) / Math.max(1, count - 1));
      }
      return;
    }

    if (/aimed_burst|predictive_pair|clone_lances|mirrored_ricochet_pair/.test(pattern)) {
      const count = attack.count || (pattern.includes("pair") ? 2 : 4);
      const interval = attack.interval || 0.11;
      if (enemy.shotsFired < count && elapsed >= enemy.shotsFired * interval) {
        const angle = enemy.aim + (enemy.shotsFired - (count - 1) / 2) * degrees(attack.spread || 3);
        this.enemyAimedShot(enemy, attack, angle, { bounces: pattern.includes("ricochet") ? (attack.reflections || 1) : 0 });
        if (/clone_lances/.test(pattern)) {
          for (const mirror of (enemy.mirrors || []).filter((entry) => entry.disabled <= 0)) {
            this.enemyAimedShot(enemy, attack, angleBetween(mirror, this.run.player), { origin: mirror, bounces: attack.reflections || 1 });
          }
        }
        enemy.shotsFired += 1;
      }
      return;
    }

    if (/root_wall_wave/.test(pattern)) {
      const waves = attack.waves || 2;
      if (enemy.shotsFired < waves && elapsed >= enemy.shotsFired * (attack.interval || 0.30)) {
        this.enemyFan(enemy, attack, 5, 12, { speed: attack.speed || attack.projectileSpeed || 63 });
        enemy.shotsFired += 1;
      }
      return;
    }

    if (/ricochet_lance|refraction_lance|slow_orb/.test(pattern)) {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        const count = attack.count || 1;
        const angles = attack.angles;
        if (Array.isArray(angles) && angles.length) {
          for (const offset of angles) this.enemyAimedShot(enemy, attack, enemy.aim + degrees(offset), { bounces: attack.reflections || 0, speed: attack.projectileSpeed || 100 });
        } else {
          this.enemyFan(enemy, attack, count, attack.spread || (count > 1 ? 10 : 0), { bounces: attack.reflections || (pattern.includes("ricochet") ? 1 : 0), speed: attack.projectileSpeed || 100 });
        }
      }
      return;
    }

    if (/thorn_lash/.test(pattern)) {
      const swipes = attack.swipes || 3;
      const interval = attack.interval || 0.15;
      if (enemy.shotsFired < swipes && elapsed >= enemy.shotsFired * interval) {
        const sweepAngle = enemy.aim + (enemy.shotsFired - 1) * degrees(24);
        if (pointInCone(enemy, sweepAngle, 36, attack.arc || 80, this.run.player, this.run.player.r)) {
          this.damagePlayer(attack.damage || 16, { source: enemy, angle: sweepAngle, kind: "melee" });
        }
        this.encounter.effects.push({ type: "slash", x: enemy.x, y: enemy.y, x2: enemy.x + Math.cos(sweepAngle) * 38, y2: enemy.y + Math.sin(sweepAngle) * 38, angle: sweepAngle, arc: attack.arc || 80, time: 0.09, color: enemy.def.color });
        enemy.shotsFired += 1;
        if (enemy.shotsFired === swipes && attack.finalProjectiles) {
          this.enemyFan(enemy, attack, attack.finalProjectiles, attack.spread || 12, { speed: attack.projectileSpeed || 74 });
        }
      }
      return;
    }

    if (/copy_last_player_action/.test(pattern)) {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        if (["repeater", "prism"].includes(this.run.weaponId)) this.enemyFan(enemy, attack, 3, 7);
        else if (pointInCone(enemy, enemy.aim, 28, 110, this.run.player, this.run.player.r)) this.damagePlayer(attack.damage || 13, { source: enemy, angle: enemy.aim, kind: "melee" });
      }
      return;
    }

    if (!enemy.activeResolved) {
      enemy.activeResolved = true;
      this.enemyAimedShot(enemy, attack, enemy.aim);
    }
  }

  enemyAimedShot(enemy, attack, angle, options = {}) {
    const speedMultiplier = cargoEffects(this.run, "enemy_projectile_speed_multiplier").reduce((value, effect) => value * (effect.value || 1), 1);
    const speed = (options.speed || attack.projectileSpeed || 88) * speedMultiplier;
    const velocity = vecFromAngle(angle, speed);
    const origin = options.origin || enemy;
    this.spawnProjectile({
      x: origin.x + Math.cos(angle) * ((origin.r || enemy.r) + 2),
      y: origin.y + Math.sin(angle) * ((origin.r || enemy.r) + 2),
      vx: velocity.x,
      vy: velocity.y,
      r: attack.projectileRadius || 1.6,
      damage: attack.damage || 10,
      faction: "enemy",
      color: enemy.def.color || this.encounter.biome.projectile,
      life: 3.2,
      bounces: options.bounces || 0,
      kind: options.kind || attack.pattern,
      homing: options.homing || 0,
      source: enemy,
    });
  }

  enemyFan(enemy, attack, count, spreadDegrees, options = {}) {
    const center = (count - 1) / 2;
    for (let index = 0; index < count; index += 1) {
      this.enemyAimedShot(enemy, attack, enemy.aim + degrees((index - center) * spreadDegrees), options);
    }
  }

  enemyRing(enemy, attack, count, speed) {
    const gap = this.run.rng.int(0, Math.max(0, count - 1));
    const safeGaps = attack.safeGaps || 0;
    for (let index = 0; index < count; index += 1) {
      if (safeGaps && Math.min((index - gap + count) % count, (gap - index + count) % count) < safeGaps) continue;
      const angle = index / count * TAU + enemy.aim * 0.15;
      this.enemyAimedShot(enemy, { ...attack, projectileSpeed: speed }, angle);
    }
  }

  bossPatternDeck(enemy) {
    const phase = enemy.def.phases?.[enemy.phase] || enemy.def.phases?.[0];
    if (!phase) return [];
    if (phase.sequenceDeck) {
      if (!enemy.sequenceQueue?.length) {
        enemy.sequenceQueue = [...(phase.sequenceDeck[enemy.patternCursor % phase.sequenceDeck.length] || [])];
        enemy.patternCursor += 1;
      }
      const key = enemy.sequenceQueue.shift();
      if (!enemy.sequenceQueue.length && phase.exposedAfterDeck) {
        enemy.exposeAfterRecovery = phase.exposedAfterDeck;
      }
      return [phase.patterns?.[key]].filter(Boolean);
    }
    if (phase.fixedSequence) {
      const key = phase.fixedSequence[enemy.patternCursor % phase.fixedSequence.length];
      enemy.patternCursor += 1;
      return [phase.patterns?.[key]].filter(Boolean);
    }
    if (phase.patternDeck) return phase.patternDeck;
    if (phase.patterns) return Object.values(phase.patterns);
    return [];
  }

  activateBossPhase(enemy) {
    const phase = enemy.def.phases?.[enemy.phase];
    if (!phase) return;
    enemy.patternCursor = 0;
    enemy.sequenceQueue = [];
    enemy.phaseTriggers = new Set();
    enemy.exposed = 0;
    const enter = phase.enter;
    if (!enter) return;

    if (enter.pattern === "grow_root_maze") {
      const slots = this.encounter.hazards.find((hazard) => hazard.type === "boss_barrier_slots")?.rects || [];
      for (const rect of slots.slice(0, enter.barrierCount || 3)) {
        this.encounter.barriers.push({
          ...rect,
          id: `root-maze:${rect.x}:${rect.y}`,
          life: enter.barrierLife || 12,
          hp: enter.barrierHp || 100,
          solid: true,
          reflect: false,
          color: enemy.def.color,
        });
      }
      this.rebuildNavigation();
    } else if (enter.pattern === "spawn_mirror_images") {
      const anchors = this.encounter.spawnPoints
        .filter((point) => dist(point, enemy) > 45)
        .slice(0, enter.count || 2);
      enemy.mirrors = anchors.map((point, index) => ({
        uid: `${enemy.uid}:mirror:${index}`,
        x: point.x,
        y: point.y,
        r: 5,
        hp: enter.cloneHp || 1,
        disabled: 0,
      }));
    } else if (enter.pattern === "shatter_prism_pillars") {
      const anchors = [
        { x: 82, y: 55 }, { x: 238, y: 55 }, { x: 82, y: 125 }, { x: 238, y: 125 },
      ];
      for (const point of anchors.slice(0, enter.ricochetNodes || 4)) {
        this.encounter.prisms.push({ uid: `saint-node:${point.x}:${point.y}`, ...point, r: 4, life: 999, angle: Math.PI / 4, hostileReflector: true });
      }
    } else if (enter.pattern === "equip_core_plates") {
      enemy.corePlates = enter.plates || 3;
      enemy.plateReduction = enter.reductionPerPlate || 0.2;
      this.ui.toast?.(`FURNACE ARMOR · ${enemy.corePlates} CORE PLATES`);
    }
  }

  updateBossScript(enemy, dt) {
    enemy.phaseLock = Math.max(0, (enemy.phaseLock || 0) - dt);
    enemy.exposed = Math.max(0, (enemy.exposed || 0) - dt);
    for (const mirror of enemy.mirrors || []) mirror.disabled = Math.max(0, (mirror.disabled || 0) - dt);
    const phase = enemy.def.phases?.[enemy.phase];
    if (!phase) return;
    const ratio = enemy.hp / enemy.maxHp;
    for (const summon of phase.summons || []) {
      const trigger = `summon:${summon.atHp}`;
      if (ratio > summon.atHp || enemy.phaseTriggers.has(trigger)) continue;
      enemy.phaseTriggers.add(trigger);
      for (let index = 0; index < (summon.count || 1); index += 1) {
        const point = summon.points?.[index] || this.run.rng.pick(this.encounter.spawnPoints);
        this.spawnEnemy(summon.enemy, point);
      }
      this.ui.toast?.(`${enemy.def.name} tears open the arena`);
    }
  }

  updateBossPhase(enemy) {
    if ((enemy.phaseLock || 0) > 0) return;
    const thresholds = enemy.def.phaseThresholds || [0.66, 0.33];
    const ratio = enemy.hp / enemy.maxHp;
    let targetPhase = 0;
    while (targetPhase < thresholds.length && ratio <= thresholds[targetPhase]) targetPhase += 1;
    const phase = Math.min(targetPhase, enemy.phase + 1);
    if (phase === enemy.phase) return;
    enemy.phase = phase;
    enemy.state = "enter";
    enemy.stateTime = enemy.def.phaseTransitionTime || 0.75;
    enemy.phaseLock = enemy.stateTime + 0.12;
    enemy.attack = null;
    this.releaseAttackToken(enemy);
    enemy.poise = enemy.maxPoise;
    this.activateBossPhase(enemy);
    this.encounter.projectiles = this.encounter.projectiles.filter((projectile) => projectile.faction === "player");
    this.metrics.bossPhasesSeen += 1;
    this.shake = 4;
    this.spawnBurst(enemy.x, enemy.y, enemy.def.color, 28);
    audioCall("bossPhase", { boss: enemy.id, phase: phase + 1 });
    const audio = window.AbyssalAudio || window.audioEngine;
    try { audio?.setBossPhase?.(phase + 1); } catch { /* optional */ }
    this.ui.roomBanner?.(`${enemy.def.name} · PHASE ${["I", "II", "III"][phase] || phase + 1}`, "", 760);
  }

  damageEnemy(enemy, amount, poise = 0, context = {}) {
    if (!enemy || enemy.dead || enemy.state === "enter") return false;
    let damage = Math.max(0, amount);
    if (enemy.exposed > 0) damage *= enemy.def.phases?.[enemy.phase]?.exposedAfterDeck?.damageTakenMultiplier || 1.25;
    if (enemy.corePlates > 0) {
      const reflectedRivet = context.reflected && /rivet/.test(context.projectile?.kind || "");
      const quenchImpact = context.source === "hazard" && context.heavy;
      if (reflectedRivet || quenchImpact) {
        enemy.corePlates = Math.max(0, enemy.corePlates - 1);
        this.ui.toast?.(`CORE PLATE BROKEN · ${enemy.corePlates} REMAIN`);
        this.spawnBurst(enemy.x, enemy.y, "#ffbf70", 18);
      } else {
        damage *= Math.max(0.35, 1 - enemy.corePlates * (enemy.plateReduction || 0.2));
      }
    }
    if (enemy.armorBroken > 0) damage *= 1.15;
    const armor = enemy.def.armor;
    const incomingFacing = (context.angle ?? angleBetween(this.run.player, enemy)) + Math.PI;
    const hitsArmor = armor && enemy.armorBroken <= 0
      && Math.abs(angleDiff(incomingFacing, enemy.aim)) <= degrees(armor.arc || 360) / 2;
    if (hitsArmor && context.source === "projectile") damage *= 1 - (armor.projectileReduction ?? armor.reduction ?? 0);
    if (hitsArmor && context.source === "melee") damage *= 1 - (armor.meleeReduction ?? armor.reduction ?? 0) * 0.55;
    if (enemy.mark > 0 && context.source !== "technique" && !context.noChain && hasTechnique(this.run, "chain_reaction")) {
      damage += 22;
      enemy.mark = 0;
      this.encounter.effects.push({ type: "blast", x: enemy.x, y: enemy.y, r: 15, time: 0.16, color: "#f5c75f" });
      for (const other of this.encounter.enemies) {
        if (other !== enemy && !other.dead && distSq(other, enemy) <= (15 + other.r) ** 2) {
          this.damageEnemy(other, 11, 4, { source: "chain_splash", noChain: true, angle: angleBetween(enemy, other) });
        }
      }
      audioCall("explosion", { kind: "mark" });
    }
    if (context.technique && hasTechnique(this.run, "chain_reaction")) enemy.mark = 4;

    const poiseMultiplier = (hasTechnique(this.run, "execution_order") ? 1.35 : 1)
      * cargoEffects(this.run, "primary_poise_multiplier").reduce((value, effect) => value * (effect.value || 1), 1);
    enemy.hp -= damage;
    enemy.poise -= poise * poiseMultiplier;
    const fracture = enemy.def.phases?.[enemy.phase]?.fracture;
    if (fracture && context.reflected && /lance/.test(context.projectile?.kind || "")) {
      enemy.fractureHits = (enemy.fractureHits || 0) + 1;
      enemy.poise -= fracture.poise || 60;
      if (enemy.fractureHits >= (fracture.required || 3)) {
        enemy.fractureHits = 0;
        enemy.state = "stunned";
        enemy.stateTime = fracture.stun || 2;
        this.releaseAttackToken(enemy);
        this.ui.toast?.("SAINT FRACTURED · REFLECTION ANSWERED");
      }
    }
    enemy.flash = 0.08;
    const knock = vecFromAngle(context.angle || angleBetween(this.run.player, enemy), context.heavy ? 5 : 2);
    if (!enemy.boss) {
      const moved = moveCircleWithSliding(enemy, knock.x, knock.y, this.collisionObstacles(), this.encounter.bounds);
      enemy.x = moved.x;
      enemy.y = moved.y;
    }
    this.onPlayerHitEnemy(enemy, damage, context);
    this.spawnBurst(enemy.x, enemy.y, context.source === "projectile" ? "#f4db9d" : COLORS.white, context.heavy ? 8 : 4);
    this.hitstop = Math.max(this.hitstop, context.heavy ? 0.052 : 0.025);
    this.shake = Math.max(this.shake, context.heavy ? 2.2 : 0.7);

    if (enemy.hp <= 0) {
      this.killEnemy(enemy, context);
      return true;
    }
    if (enemy.poise <= 0) {
      this.releaseAttackToken(enemy);
      enemy.state = "stunned";
      enemy.stateTime = Math.max(enemy.stateTime || 0, enemy.boss ? 0.65 : 0.85);
      enemy.poise = enemy.maxPoise;
      enemy.armorBroken = Math.max(enemy.armorBroken || 0, enemy.def.armor ? 2 : 0);
      audioCall("stagger", { enemy: enemy.id });
      this.addDrive(7);
    }
    return true;
  }

  onPlayerHitEnemy(enemy, damage, context) {
    const run = this.run;
    run.hitCounter += 1;
    this.addDrive(context.technique ? 5 : 3);
    const weapon = Content.WEAPONS[run.weaponId];
    if (weapon.resource?.type === "impact_charge" && context.source === "melee") {
      run.player.impactCharge = clamp(run.player.impactCharge + (weapon.resource.gainOnHit || 20), 0, weapon.resource.max || 100);
    }
    const mirror = run.player.postDashEcho;
    if (mirror && context.source !== "cargo_echo") {
      run.player.postDashEcho = null;
      run.player.mirrorCooldown = mirror.internalCooldown || 2;
      this.encounter.effects.push({
        type: "delayed_damage",
        target: enemy,
        damage: damage * (mirror.damageMultiplier || 0.45),
        poise: 8,
        time: mirror.delay || 0.25,
        color: "#d8c9ff",
      });
    }
    if (hasTechnique(run, "hot_rivets") && run.hitCounter % 8 === 0) {
      enemy.burn = { time: 2.5, tick: 0, damage: 18 / 5 };
    }
    if (hasTechnique(run, "hot_rivets") && context.source === "melee" && enemy.burn) {
      enemy.burn = null;
      this.encounter.effects.push({ type: "blast", x: enemy.x, y: enemy.y, r: 13, time: 0.14, color: "#ff9b4a" });
      for (const other of this.encounter.enemies) {
        if (other === enemy || other.dead || distSq(other, enemy) > (13 + other.r) ** 2) continue;
        this.damageEnemy(other, 10, 5, { source: "burn_burst", noChain: true, angle: angleBetween(enemy, other) });
      }
    }
    if (hasTechnique(run, "undertow_teeth") && context.technique && !enemy.boss) {
      enemy.armorBroken = 2;
      const pull = normalizeVector(run.player.x - enemy.x, run.player.y - enemy.y);
      const moved = moveCircleWithSliding(enemy, pull.x * 23, pull.y * 23, this.collisionObstacles(), this.encounter.bounds);
      enemy.x = moved.x;
      enemy.y = moved.y;
    }
    for (const effect of cargoEffects(run, "periodic_root_on_hit")) {
      if (run.hitCounter % (effect.every || 5) === 0 && !enemy.boss) {
        enemy.state = "stunned";
        enemy.stateTime = effect.duration || 0.45;
        this.releaseAttackToken(enemy);
      }
    }
    for (const effect of cargoEffects(run, "periodic_forced_vent")) {
      if (run.hitCounter % (effect.every || 8) === 0) {
        this.encounter.effects.push({ type: "damage_zone", x: this.run.player.x, y: this.run.player.y, r: effect.radius || 15, damage: effect.damage || 14, poise: 18, time: 0.12, faction: "player", hitIds: new Set(), color: "#f2a45b" });
      }
    }
    if (enemy.mark > 0) this.ui.announce?.("Marked target struck");
  }

  killEnemy(enemy, context = {}) {
    if (enemy.dead) return;
    enemy.dead = true;
    enemy.stateTime = enemy.boss ? 1.25 : 0.48;
    this.releaseAttackToken(enemy);
    this.metrics.enemiesDefeated += 1;
    this.encounter.roomKills += 1;
    this.addDrive(enemy.boss ? 30 : enemy.elite ? 18 : 11);
    this.spawnBurst(enemy.x, enemy.y, enemy.def.color, enemy.boss ? 42 : enemy.elite ? 16 : 9);
    audioCall(enemy.boss ? "explosion" : "enemyHit", { killed: true, enemy: enemy.id });

    if (this.run.phase === "descent" && !enemy.boss) {
      const value = Math.round(rangeFrom(this.run.rng, enemy.def.loot?.value, 10));
      const weight = Math.max(1, Math.round(rangeFrom(this.run.rng, enemy.def.loot?.weight, 2)));
      this.run.cachedValue += value;
      this.run.cachedWeight += weight;
      this.encounter.effects.push({ type: "loot", x: enemy.x, y: enemy.y, value, time: 0.7, color: COLORS.gold });
    }
    if (enemy.id === "confiscator") this.run.cargo.forEach((cargo) => { cargo.sealed = false; });
    if (enemy.id === "appraiser") this.run.player.lienWeight = 0;
    if (enemy.elite && hasTechnique(this.run, "execution_order")) {
      this.run.player.techniqueCooldown *= 0.5;
    }
    if (hasTechnique(this.run, "moss_trap") && !enemy.boss) {
      this.encounter.effects.push({ type: "mine", x: enemy.x, y: enemy.y, r: 14, time: 0.55, fuse: 8, damage: 24, faction: "player", color: "#86d985", armed: false });
    }
    const deathPattern = enemy.def.deathPattern;
    if (!enemy.noSplit && deathPattern?.pattern === "split_unless_crushed" && !["melee", "reflected", "dash"].includes(context.source)) {
      for (let index = 0; index < (deathPattern.count || 2); index += 1) {
        const child = this.spawnEnemy(enemy.id, {
          x: enemy.x + (index ? 5 : -5),
          y: enemy.y + this.run.rng.range(-3, 3),
        }, { hp: deathPattern.childHp || 10, noSplit: true });
        if (child) child.r *= deathPattern.childScale || 0.62;
      }
    }
    if (hasTechnique(this.run, "blood_ledger") && this.run.player.drive >= 99 && !this.encounter.firstDriveHealUsed) {
      this.encounter.firstDriveHealUsed = true;
      this.healPlayer(8);
    }
    if (enemy.boss) this.onBossKilled(enemy);
  }

  onBossKilled(enemy) {
    this.metrics.bossesDefeated += 1;
    this.meta.statistics.bossesDefeated = (this.meta.statistics.bossesDefeated || 0) + 1;
    const sigil = this.encounter.room.clearance?.sigil;
    if (sigil) this.run.pendingSigils.add(sigil);
    if (this.encounter.room.clearance?.shortcutUnlock != null) this.run.pendingUnlocks.add(this.encounter.room.clearance.shortcutUnlock);
    this.run.bosses.push(enemy.id);
    const healByRank = [12, 25, 35][metaRank(this.meta, "field_surgery")] || 35;
    this.healPlayer(healByRank);
    this.ui.updateBoss?.({ visible: false, hp: 0 });
    this.ui.roomBanner?.(`${enemy.def.name} BROKEN`);
    audioCall("roomClear", { boss: true });
  }

  damagePlayer(amount, context = {}) {
    const player = this.run.player;
    if (this.bot.god) return false;
    if (player.deflectTime > 0 && context.source) {
      const incoming = angleBetween(player, context.source);
      if (Math.abs(angleDiff(incoming, player.aim)) < degrees(105)) {
        this.deflectEnemy(context.source);
        return false;
      }
    }
    if (player.invuln > 0) return false;
    const damage = Math.max(1, amount);
    player.hp -= damage;
    player.invuln = 0.42;
    player.drive = Math.max(0, player.drive - 18);
    this.encounter.roomDamage += damage;
    this.metrics.damageEvents += 1;
    this.meta.statistics.damageTaken = (this.meta.statistics.damageTaken || 0) + damage;
    this.shake = Math.max(this.shake, 3.2);
    this.ui.damageFlash?.();
    audioCall("hurt", { amount: damage });
    if (context.angle != null) {
      const knock = vecFromAngle(context.angle + Math.PI, 8);
      this.movePlayer(knock.x, knock.y);
    }
    if (player.hp <= 0) this.finishRun(false, "The burden claimed another name.");
    return true;
  }

  deflectEnemy(enemy) {
    if (!enemy || enemy.dead) return;
    this.releaseAttackToken(enemy);
    enemy.state = "stunned";
    enemy.stateTime = enemy.boss ? 0.38 : 0.72;
    enemy.poise -= 26;
    this.run.player.empowered = hasTechnique(this.run, "counterstep") ? 1.5 : this.run.player.empowered;
    this.run.player.empoweredCharges = hasTechnique(this.run, "counterstep") ? 1 : this.run.player.empoweredCharges;
    if (hasTechnique(this.run, "counterstep")) this.run.player.dashCooldown = 0;
    const weapon = Content.WEAPONS[this.run.weaponId];
    if (weapon.resource?.type === "impact_charge") {
      this.run.player.impactCharge = clamp(this.run.player.impactCharge + (weapon.resource.gainOnDeflect || 35), 0, weapon.resource.max || 100);
    }
    this.metrics.deflects += 1;
    this.meta.statistics.deflects = (this.meta.statistics.deflects || 0) + 1;
    this.addDrive(10);
    this.spawnBurst(this.run.player.x, this.run.player.y, COLORS.deflect, 12);
    audioCall("perfect", { enemy: enemy.id });
    this.emitDeflectShards();
  }

  reflectProjectile(projectile) {
    const player = this.run.player;
    const speed = Math.hypot(projectile.vx, projectile.vy) * 1.18;
    const angle = player.aim;
    projectile.vx = Math.cos(angle) * speed;
    projectile.vy = Math.sin(angle) * speed;
    projectile.faction = "player";
    projectile.reflected = true;
    projectile.damage *= hasTechnique(this.run, "return_postage") ? 1.8 : projectile.reflectedDamageMultiplier;
    projectile.pierce += hasTechnique(this.run, "return_postage") ? 1 : 0;
    projectile.color = COLORS.deflect;
    projectile.nearMiss = true;
    this.metrics.deflects += 1;
    this.meta.statistics.deflects = (this.meta.statistics.deflects || 0) + 1;
    this.addDrive(9);
    const weapon = Content.WEAPONS[this.run.weaponId];
    if (weapon.resource?.type === "impact_charge") {
      player.impactCharge = clamp(player.impactCharge + (weapon.resource.gainOnDeflect || 35), 0, weapon.resource.max || 100);
    }
    this.spawnBurst(projectile.x, projectile.y, COLORS.deflect, 8);
    audioCall("deflect", { projectile: true });
    const splits = cargoEffects(this.run, "deflected_projectile_split")[0];
    if (splits) {
      for (const direction of [-1, 1]) {
        const splitAngle = angle + degrees((splits.angle || 14) * direction);
        this.spawnProjectile({ ...projectile, vx: Math.cos(splitAngle) * speed, vy: Math.sin(splitAngle) * speed, damage: projectile.damage * (splits.damageMultiplier || 0.55), faction: "player", life: projectile.life });
      }
    }
    this.emitDeflectShards();
  }

  emitDeflectShards() {
    const run = this.run;
    const pulse = cargoEffects(run, "periodic_deflect_pulse")[0];
    if (pulse) {
      run.player.deflectPulseCount = (run.player.deflectPulseCount || 0) + 1;
      if (run.player.deflectPulseCount % (pulse.every || 3) === 0) {
        this.encounter.effects.push({
          type: "damage_zone",
          x: run.player.x,
          y: run.player.y,
          r: pulse.radius || 22,
          damage: pulse.damage || 18,
          poise: pulse.poise || 24,
          time: 0.14,
          faction: "player",
          hitIds: new Set(),
          color: "#bdefff",
        });
        this.ui.toast?.("CHIME RELIQUARY · THIRD BELL");
      }
    }
    const tier = burdenTier(run.carriedWeight, burdenCapacity(this.meta));
    if (!hasTechnique(run, "flywheel_harness") || tier.id === "agile" || run.player.flywheelCooldown > 0) return;
    run.player.flywheelCooldown = 2;
    for (let index = 0; index < 6; index += 1) {
      const angle = index / 6 * TAU;
      const velocity = vecFromAngle(angle, 88);
      this.spawnProjectile({ x: run.player.x, y: run.player.y, vx: velocity.x, vy: velocity.y, r: 1.2, damage: 12, poise: 12, faction: "player", color: "#c9f8ff", life: 1.4, kind: "flywheel" });
    }
  }

  healPlayer(amount) {
    const player = this.run.player;
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + amount);
    if (player.hp > before) this.ui.toast?.(`+${Math.round(player.hp - before)} HP`);
  }

  addDrive(amount) {
    const bonus = cargoEffects(this.run, "drive_gain_multiplier").reduce((value, effect) => value * (effect.value || 1), 1);
    const player = this.run.player;
    player.drive = clamp(player.drive + amount * bonus, 0, 100);
    player.driveIdle = 0;
  }

  updateProjectiles(dt) {
    const player = this.run.player;
    const obstacles = this.collisionObstacles();
    for (const projectile of this.encounter.projectiles) {
      projectile.life -= dt;
      if (projectile.life <= 0) continue;
      projectile.px = projectile.x;
      projectile.py = projectile.y;
      if (projectile.homing && projectile.faction === "enemy") {
        const targetAngle = angleBetween(projectile, player);
        const current = Math.atan2(projectile.vy, projectile.vx);
        const next = current + clamp(angleDiff(targetAngle, current), -projectile.homing * dt, projectile.homing * dt);
        const speed = Math.hypot(projectile.vx, projectile.vy);
        projectile.vx = Math.cos(next) * speed;
        projectile.vy = Math.sin(next) * speed;
      }
      const next = { x: projectile.x + projectile.vx * dt, y: projectile.y + projectile.vy * dt };
      let obstacleHit = null;
      let obstacle = null;
      for (const candidate of obstacles) {
        const hit = segmentVsExpandedAABB(projectile, next, candidate, projectile.r);
        if (hit && (!obstacleHit || hit.t < obstacleHit.t)) {
          obstacleHit = hit;
          obstacle = candidate;
        }
      }
      if (obstacleHit) {
        const reflective = obstacle.reflect || /prism|glass/.test(obstacle.material || "");
        if (projectile.faction === "player" && Number.isFinite(obstacle.hp)) {
          this.damageRoomObstacle(obstacle, projectile.damage, "ranged");
        }
        if (projectile.bounces > 0 || reflective) {
          const dot = projectile.vx * obstacleHit.normalX + projectile.vy * obstacleHit.normalY;
          projectile.vx -= 2 * dot * obstacleHit.normalX;
          projectile.vy -= 2 * dot * obstacleHit.normalY;
          projectile.x = obstacleHit.x + obstacleHit.normalX * 0.5;
          projectile.y = obstacleHit.y + obstacleHit.normalY * 0.5;
          if (!reflective) projectile.bounces -= 1;
          if (projectile.faction === "player") projectile.damage *= projectile.reflectedDamageMultiplier || 1.15;
          audioCall("ricochet", { hostile: projectile.faction === "enemy" });
        } else {
          projectile.life = 0;
        }
        continue;
      }

      if (projectile.faction === "player") {
        let fixtureHit = false;
        for (const hazard of this.encounter.hazards) {
          if (!["interactive_spore_pod", "boss_quench_valve"].includes(hazard.type)) continue;
          if (hazard.type === "interactive_spore_pod" && !hazard.alive) continue;
          const rect = hazard.rect || {
            x: hazard.center.x - (hazard.radius || 4),
            y: hazard.center.y - (hazard.radius || 4),
            w: (hazard.radius || 4) * 2,
            h: (hazard.radius || 4) * 2,
          };
          if (!segmentVsExpandedAABB(projectile, next, rect, projectile.r)) continue;
          this.hitRoomHazard(hazard, "ranged");
          projectile.life = 0;
          fixtureHit = true;
          break;
        }
        if (fixtureHit) continue;
      }

      let roomBlock = false;
      for (const hazard of this.encounter.hazards) {
        if (hazard.type === "rhythm_piston" && hazard.active && hazard.blocksProjectilesDuringActive && hazard.rect) {
          roomBlock = Boolean(segmentVsExpandedAABB(projectile, next, hazard.rect, projectile.r));
        } else if (hazard.type === "moving_cover_cart" && hazard.blocksProjectiles && hazard.center) {
          roomBlock = distancePointSegment(hazard.center, projectile, next).distance <= (hazard.radius || 9) + projectile.r;
        } else if (hazard.type === "rotating_arm" && hazard.blocksProjectiles && hazard.renderLine) {
          const armWidth = (hazard.width || 5) * 0.5 + projectile.r;
          roomBlock = distancePointSegment(projectile, hazard.renderLine.a, hazard.renderLine.b).distance <= armWidth
            || distancePointSegment(next, hazard.renderLine.a, hazard.renderLine.b).distance <= armWidth;
        } else if (hazard.type === "soft_wall_growth" && hazard.runtimeRect) {
          roomBlock = Boolean(segmentVsExpandedAABB(projectile, next, hazard.runtimeRect, projectile.r));
        }
        if (roomBlock) break;
      }
      if (roomBlock) {
        projectile.life = 0;
        this.spawnBurst(projectile.x, projectile.y, "#d9c59d", 4);
        continue;
      }
      projectile.x = next.x;
      projectile.y = next.y;
      if (projectile.x < 4 || projectile.x > WORLD.w - 4 || projectile.y < 8 || projectile.y > WORLD.h - 4) {
        projectile.life = 0;
        continue;
      }

      let reflectedByNode = false;
      for (const prism of this.encounter.prisms) {
        if (!prism.hostileReflector || projectile.splitBy.has(prism.uid)) continue;
        const crossing = distancePointSegment(prism, { x: projectile.px, y: projectile.py }, projectile).distance;
        if (crossing > prism.r + projectile.r) continue;
        projectile.splitBy.add(prism.uid);
        const normal = normalizeVector(projectile.x - prism.x, projectile.y - prism.y, 1, 0);
        const dot = projectile.vx * normal.x + projectile.vy * normal.y;
        projectile.vx -= 2 * dot * normal.x;
        projectile.vy -= 2 * dot * normal.y;
        projectile.x = projectile.px;
        projectile.y = projectile.py;
        audioCall("ricochet", { node: true, hostile: projectile.faction === "enemy" });
        reflectedByNode = true;
        break;
      }
      if (reflectedByNode) continue;

      if (projectile.faction === "enemy") {
        const playerHit = sweptProjectileHit({ x: projectile.px, y: projectile.py }, projectile, projectile.r, player);
        if (playerHit) {
          if (player.deflectTime > 0 && projectile.deflectable) {
            projectile.x = playerHit.x;
            projectile.y = playerHit.y;
            this.reflectProjectile(projectile);
          } else {
            this.damagePlayer(projectile.damage, { source: projectile, angle: Math.atan2(projectile.vy, projectile.vx), kind: "projectile" });
            if (projectile.kind === "tether" && projectile.source && !projectile.source.dead) {
              const pull = normalizeVector(projectile.source.x - player.x, projectile.source.y - player.y);
              this.movePlayer(pull.x * 15, pull.y * 15);
              player.status.tethered = 1.2;
            }
            if (/slow_orb/.test(projectile.kind || "")) player.status.slowed = 1.6;
            projectile.life = 0;
          }
          continue;
        }
        const near = distancePointSegment(player, { x: projectile.px, y: projectile.py }, projectile).distance;
        if (!projectile.nearMiss && near < player.r + projectile.r + 4.5) {
          projectile.nearMiss = true;
          this.metrics.nearMisses += 1;
          this.addDrive(2);
        }
      } else {
        for (const boss of this.encounter.enemies.filter((enemy) => enemy.boss && !enemy.dead)) {
          for (const mirror of boss.mirrors || []) {
            if (mirror.disabled > 0 || projectile.hitIds.has(mirror.uid)) continue;
            const hit = sweptProjectileHit({ x: projectile.px, y: projectile.py }, projectile, projectile.r, mirror);
            if (!hit) continue;
            projectile.hitIds.add(mirror.uid);
            mirror.disabled = 6;
            projectile.life = 0;
            this.spawnBurst(mirror.x, mirror.y, boss.def.color, 12);
            audioCall("shatter", { mirror: true });
          }
        }
        if (projectile.life <= 0) continue;
        for (const prism of this.encounter.prisms) {
          if (projectile.life <= 0 || projectile.splitBy.has(prism.uid)) continue;
          const crossing = distancePointSegment(prism, { x: projectile.px, y: projectile.py }, projectile).distance;
          if (crossing > prism.r + projectile.r) continue;
          projectile.splitBy.add(prism.uid);
          const baseAngle = Math.atan2(projectile.vy, projectile.vx);
          const speed = Math.hypot(projectile.vx, projectile.vy);
          for (const side of [-1, 1]) {
            const angle = baseAngle + degrees(18 * side);
            this.spawnProjectile({
              ...projectile,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              damage: projectile.damage * 0.7,
              life: projectile.life,
              splitBy: projectile.splitBy,
            });
          }
          audioCall("ricochet", { splitter: true });
          break;
        }
        for (const enemy of this.encounter.enemies) {
          if (enemy.dead || projectile.hitIds.has(enemy.uid)) continue;
          const hit = sweptProjectileHit({ x: projectile.px, y: projectile.py }, projectile, projectile.r, enemy);
          if (!hit) continue;
          projectile.hitIds.add(enemy.uid);
          this.damageEnemy(enemy, projectile.damage, projectile.poise, {
            source: "projectile",
            technique: projectile.kind === "pin",
            reflected: Boolean(projectile.reflected),
            projectile,
            angle: Math.atan2(projectile.vy, projectile.vx),
          });
          if (projectile.mark) {
            enemy.mark = Math.max(enemy.mark, 5);
            if (!enemy.boss) {
              enemy.state = "stunned";
              enemy.stateTime = Math.max(enemy.stateTime || 0, 0.45);
              this.releaseAttackToken(enemy);
            }
          }
          if (projectile.pierce > 0) {
            projectile.pierce -= 1;
            if (hasTechnique(this.run, "hollow_points")) projectile.damage *= 1.25;
          } else {
            projectile.life = 0;
            break;
          }
        }
      }
    }
    this.encounter.projectiles = this.encounter.projectiles.filter((projectile) => projectile.life > 0);
  }

  updateHazards(dt) {
    const encounter = this.encounter;
    const player = this.run.player;
    for (const hazard of encounter.hazards) {
      hazard.timer += dt;
      hazard.hitTimer = Math.max(0, hazard.hitTimer - dt);
      hazard.cooldownTimer = Math.max(0, (hazard.cooldownTimer || 0) - dt);
      if (hazard.disabledTimer > 0) {
        hazard.disabledTimer = Math.max(0, hazard.disabledTimer - dt);
        if (hazard.disabledTimer <= 0) {
          hazard.alive = true;
          hazard.hits = 0;
        }
      }
      for (const [uid, cooldown] of hazard.enemyHits) {
        const nextCooldown = cooldown - dt;
        if (nextCooldown <= 0) hazard.enemyHits.delete(uid);
        else hazard.enemyHits.set(uid, nextCooldown);
      }
      const phase = Number(hazard.phase) || 0;
      const period = Math.max(0.5, hazard.period || hazard.reverseEvery || 5);
      const cycle = (hazard.timer + phase) % period;
      hazard.tellActive = false;
      hazard.active = false;

      if (hazard.type === "interactive_spore_pod") {
        hazard.active = hazard.alive;
        continue;
      }

      if (["timed_current", "reversing_conveyor"].includes(hazard.type)) {
        const activeDuration = hazard.activeDuration || (hazard.type === "reversing_conveyor" ? period : 1.4);
        hazard.active = hazard.type === "reversing_conveyor" || cycle < activeDuration;
        hazard.tellActive = !hazard.active && cycle > period - (hazard.tell || 0.45);
        const rect = hazard.runtimeRect || hazard.rect;
        if (rect && hazard.active) {
          const direction = hazard.direction || hazard.force || { x: 0, y: 0 };
          const force = typeof hazard.force === "number" ? hazard.force : Math.hypot(direction.x || 0, direction.y || 0);
          const normalized = normalizeVector(direction.x || 0, direction.y || 0);
          let sign = 1;
          if (hazard.type === "reversing_conveyor") sign = Math.floor((hazard.timer + phase) / period) % 2 ? -1 : 1;
          if (circleRectOverlap(player, rect)) this.movePlayer(normalized.x * force * sign * dt, normalized.y * force * sign * dt);
          for (const enemy of encounter.enemies) {
            if (enemy.dead || !circleRectOverlap(enemy, rect)) continue;
            const moved = moveCircleWithSliding(enemy, normalized.x * force * sign * dt, normalized.y * force * sign * dt, this.collisionObstacles(), encounter.bounds);
            enemy.x = moved.x;
            enemy.y = moved.y;
          }
        }
      } else if (["interactive_steam_vent", "rhythm_piston"].includes(hazard.type)) {
        const activeDuration = hazard.activeDuration || (hazard.type === "rhythm_piston" ? 0.45 : 0.8);
        hazard.active = cycle < activeDuration;
        hazard.tellActive = cycle > period - (hazard.tell || 0.45);
        const rect = hazard.rect;
        if (hazard.active && rect) {
          if (hazard.type === "interactive_steam_vent") {
            const direction = normalizeVector(hazard.direction?.x || 0, hazard.direction?.y || 0);
            const force = hazard.force || 38;
            const center = rectCenter(rect);
            const inSteamLane = distancePointSegment(player, center, {
              x: center.x + direction.x * 72,
              y: center.y + direction.y * 72,
            }).distance < player.r + Math.max(rect.w, rect.h) * 0.45;
            if (inSteamLane) this.movePlayer(direction.x * force * dt, direction.y * force * dt);
          }
          if (circleRectOverlap(player, rect) && hazard.hitTimer <= 0) {
            this.damagePlayer(hazard.damage || 10, { source: rectCenter(rect), angle: angleBetween(rectCenter(rect), player), kind: "hazard" });
            hazard.hitTimer = 0.45;
          }
          for (const enemy of encounter.enemies) {
            if (enemy.dead || !circleRectOverlap(enemy, rect) || hazard.enemyHits.has(enemy.uid)) continue;
            hazard.enemyHits.set(enemy.uid, 0.5);
            this.damageEnemy(enemy, (hazard.damage || 10) * 1.4, 25, { source: "hazard", heavy: true, angle: angleBetween(rectCenter(rect), enemy) });
          }
        }
      } else if (hazard.type === "rotating_arm") {
        const center = hazard.center;
        const angle = hazard.timer / (hazard.period || 5) * TAU * (hazard.direction || 1);
        const end = { x: center.x + Math.cos(angle) * hazard.length, y: center.y + Math.sin(angle) * hazard.length };
        hazard.renderLine = { a: center, b: end };
        if (distancePointSegment(player, center, end).distance < player.r + (hazard.width || 5) / 2 && hazard.hitTimer <= 0) {
          this.damagePlayer(hazard.damage || 10, { source: center, angle, kind: "hazard" });
          hazard.hitTimer = 0.55;
        }
        for (const enemy of encounter.enemies) {
          if (!enemy.dead && !hazard.enemyHits.has(enemy.uid) && distancePointSegment(enemy, center, end).distance < enemy.r + (hazard.width || 5) / 2) {
            hazard.enemyHits.set(enemy.uid, 0.5);
            this.damageEnemy(enemy, (hazard.damage || 10) * 0.75, 15, { source: "hazard", angle });
          }
        }
      } else if (hazard.type === "moving_cover_cart") {
        const path = hazard.path || [];
        if (path.length > 1) {
          const segmentLength = 70;
          const ascentSpeed = this.run.phase === "ascent" ? (hazard.ascentSpeedMultiplier || 1) : 1;
          const progress = hazard.timer * (hazard.speed || 40) * ascentSpeed * (hazard.directionSign || 1) / segmentLength;
          const wrappedProgress = ((progress % path.length) + path.length) % path.length;
          const index = Math.floor(wrappedProgress) % path.length;
          const nextIndex = (index + 1) % path.length;
          const t = wrappedProgress - Math.floor(wrappedProgress);
          hazard.center = { x: lerp(path[index].x, path[nextIndex].x, t), y: lerp(path[index].y, path[nextIndex].y, t) };
          if (circlesIntersect({ ...hazard.center, r: hazard.radius || 9 }, player) && hazard.hitTimer <= 0) {
            this.damagePlayer(hazard.damage || 16, { source: hazard.center, angle: angleBetween(hazard.center, player), kind: "hazard" });
            hazard.hitTimer = 0.55;
          }
          for (const enemy of encounter.enemies) {
            if (!enemy.dead && circlesIntersect({ ...hazard.center, r: hazard.radius || 9 }, enemy)) {
              enemy.state = "stunned";
              enemy.stateTime = hazard.wallStunEnemies || 0.8;
              this.releaseAttackToken(enemy);
            }
          }
        }
      } else if (["reflective_obstacles", "boss_prism_network"].includes(hazard.type)) {
        for (const id of hazard.obstacleIds || []) {
          const obstacle = encounter.obstacles.find((entry) => entry.id === id);
          if (obstacle) obstacle.reflect = true;
        }
      } else if (hazard.type === "rotating_reflectors") {
        const ids = hazard.obstacleIds || [];
        const gap = Math.floor(hazard.timer / Math.max(1, hazard.period || 7)) % Math.max(1, ids.length);
        ids.forEach((id, index) => {
          const obstacle = encounter.obstacles.find((entry) => entry.id === id);
          if (!obstacle) return;
          obstacle.reflect = this.run.phase !== "ascent" || index !== gap;
          obstacle.absorber = !obstacle.reflect;
        });
        hazard.active = true;
        hazard.safeIndex = gap;
      } else if (hazard.type === "ascent_obstacle_regrow") {
        if (this.run.phase !== "ascent" || hazard.regrown) continue;
        const delay = hazard.delay || 8;
        hazard.tellActive = hazard.timer >= delay - (hazard.tell || 0.55) && hazard.timer < delay;
        if (hazard.timer >= delay) {
          const originals = encounter.originalObstacles.filter((entry) => (hazard.obstacleIds || []).includes(entry.id));
          const missing = originals.filter((original) => !encounter.obstacles.some((entry) => entry.id === original.id));
          const blocked = missing.some((obstacle) => circleRectOverlap(player, obstacle));
          if (blocked) {
            hazard.timer = delay - 0.15;
          } else {
            encounter.obstacles.push(...stableClone(missing));
            hazard.regrown = true;
            if (missing.length) {
              this.rebuildNavigation();
              this.ui.toast?.("THE FRACTURE BRIDGE REGROWS");
              audioCall("shatter", { reverse: true });
            }
          }
        }
      } else if (hazard.type === "enemy_chime_links") {
        const living = (hazard.obstacleIds || []).filter((id) => encounter.obstacles.some((entry) => entry.id === id)).length;
        hazard.active = living > 0;
        hazard.linkedCount = living;
      } else if (hazard.type === "rotating_safe_grates") {
        const bossPhase = encounter.boss?.phase ?? -1;
        if (bossPhase + 1 < (hazard.inactiveUntilBossPhase || 3)) continue;
        const rects = hazard.rects || [];
        const step = hazard.step || 3;
        const safeIndex = Math.floor(hazard.timer / step) % Math.max(1, rects.length);
        const withinStep = hazard.timer % step;
        hazard.safeIndex = safeIndex;
        hazard.tellActive = withinStep > step - (hazard.tell || 0.55);
        hazard.active = withinStep < Math.min(0.65, step * 0.25);
        if (hazard.active && hazard.hitTimer <= 0) {
          rects.forEach((rect, index) => {
            if (index !== safeIndex && circleRectOverlap(player, rect)) {
              this.damagePlayer(hazard.damage || 8, { source: rectCenter(rect), angle: angleBetween(rectCenter(rect), player), kind: "heat-grate" });
              hazard.hitTimer = hazard.tick || 0.45;
            }
          });
        }
      } else if (hazard.type === "boss_quench_valve") {
        hazard.active = hazard.cooldownTimer <= 0;
        hazard.tellActive = hazard.hits > 0;
      } else if (hazard.type === "soft_wall_growth") {
        const inset = hazard.timer < (hazard.delay || 28) ? 0 : clamp((hazard.timer - (hazard.delay || 28)) / (hazard.growTime || 8), 0, 1) * (hazard.maxInset || 10);
        hazard.inset = inset;
        if (hazard.rect) {
          const growsFromRight = hazard.rect.x > encounter.bounds.x + encounter.bounds.w / 2;
          hazard.runtimeRect = growsFromRight
            ? { ...hazard.rect, x: hazard.rect.x - inset, w: hazard.rect.w + inset }
            : { ...hazard.rect, w: hazard.rect.w + inset };
        }
        if (inset > 0 && hazard.runtimeRect && circleRectOverlap(player, hazard.runtimeRect)) {
          const inward = hazard.rect.x > encounter.bounds.x + encounter.bounds.w / 2 ? -1 : 1;
          this.movePlayer(inward * inset * dt * 5, 0);
        }
        for (const enemy of encounter.enemies) {
          if (enemy.dead || !hazard.runtimeRect || !circleRectOverlap(enemy, hazard.runtimeRect)) continue;
          const inward = hazard.rect.x > encounter.bounds.x + encounter.bounds.w / 2 ? -1 : 1;
          enemy.x += inward * inset * dt * 5;
        }
      }
    }
  }

  updateEffects(dt) {
    const effects = this.encounter.effects;
    for (const effect of effects) {
      effect.time -= dt;
      if (effect.type === "action_echo" && effect.time <= 0 && !effect.resolved) {
        effect.resolved = true;
        const action = effect.action;
        action.damageScale = effect.power;
        this.resolvePlayerAction(action);
      } else if (effect.type === "damage_zone") {
        for (const enemy of this.encounter.enemies) {
          if (enemy.dead || effect.hitIds.has(enemy.uid) || distSq(effect, enemy) > (effect.r + enemy.r) ** 2) continue;
          effect.hitIds.add(enemy.uid);
          this.damageEnemy(enemy, effect.damage, effect.poise, { source: "hazard", angle: angleBetween(effect, enemy) });
        }
      } else if (effect.type === "delayed_damage" && effect.time <= 0 && !effect.resolved) {
        effect.resolved = true;
        if (effect.target && !effect.target.dead) {
          this.damageEnemy(effect.target, effect.damage, effect.poise || 0, {
            source: "cargo_echo",
            angle: angleBetween(this.run.player, effect.target),
          });
          this.spawnBurst(effect.target.x, effect.target.y, effect.color || "#d8c9ff", 8);
        }
      } else if (effect.type === "neutral_burst" && effect.time <= 0 && !effect.resolved) {
        effect.resolved = true;
        for (let index = 0; index < effect.count; index += 1) {
          const angle = index / effect.count * TAU;
          const velocity = vecFromAngle(angle, effect.speed);
          this.spawnProjectile({ x: effect.x, y: effect.y, vx: velocity.x, vy: velocity.y, r: 1.2, damage: effect.damage, faction: "enemy", color: effect.color, life: 2.2, kind: "crystal_shard" });
        }
        for (const enemy of this.encounter.enemies) {
          if (!enemy.dead && distSq(effect, enemy) < (12 + enemy.r) ** 2) this.damageEnemy(enemy, effect.damage, 18, { source: "hazard", angle: angleBetween(effect, enemy) });
        }
        effect.time = -1;
      } else if (effect.type === "hostile_zone") {
        effect.hitTimer = Math.max(0, (effect.hitTimer || 0) - dt);
        if (effect.hitTimer <= 0 && distSq(effect, this.run.player) <= (effect.r + this.run.player.r) ** 2) {
          this.damagePlayer(effect.damage, { source: effect, angle: angleBetween(effect, this.run.player), kind: "hazard" });
          effect.hitTimer = 0.5;
        }
      } else if (effect.type === "mine") {
        if (!effect.armed && effect.time <= 0) {
          effect.armed = true;
          effect.time = effect.fuse || 1;
        } else if (effect.armed && effect.time <= 0 && !effect.exploded) {
          effect.exploded = true;
          if (effect.faction === "enemy") {
            if (distSq(effect, this.run.player) <= (effect.r + this.run.player.r) ** 2) this.damagePlayer(effect.damage, { source: effect, angle: angleBetween(effect, this.run.player), kind: "mine" });
          } else {
            for (const enemy of this.encounter.enemies) {
              if (!enemy.dead && distSq(effect, enemy) <= (effect.r + enemy.r) ** 2) this.damageEnemy(enemy, effect.damage, 30, { source: "hazard", angle: angleBetween(effect, enemy) });
            }
          }
          this.spawnBurst(effect.x, effect.y, effect.color, 16);
          if (effect.poolLife > 0) {
            this.encounter.effects.push({
              type: effect.faction === "enemy" ? "hostile_zone" : "damage_zone",
              x: effect.x,
              y: effect.y,
              r: effect.poolRadius || effect.r,
              damage: Math.max(4, Math.round(effect.damage * 0.38)),
              poise: 4,
              time: effect.poolLife,
              hitTimer: 0,
              hitIds: new Set(),
              color: effect.color,
            });
          }
          audioCall("explosion", { faction: effect.faction });
          effect.time = -1;
        }
      } else if (effect.type === "link" && effect.target?.dead) {
        effect.time = 0;
      }
      if (effect.type === "link" && effect.time <= 0 && effect.target) effect.target.buff = 1;
    }
    this.encounter.effects = effects.filter((effect) => effect.time > -0.1);
    for (const barrier of this.encounter.barriers) barrier.life -= dt;
    const barrierCount = this.encounter.barriers.length;
    this.encounter.barriers = this.encounter.barriers.filter((barrier) => barrier.life > 0 && barrier.hp > 0);
    if (this.encounter.barriers.length !== barrierCount) this.rebuildNavigation();
    for (const prism of this.encounter.prisms) prism.life -= dt;
    this.encounter.prisms = this.encounter.prisms.filter((prism) => prism.life > 0);
  }

  clearHostileBullets(center, radius, reflect = false) {
    let cleared = 0;
    for (const projectile of this.encounter.projectiles) {
      if (projectile.faction !== "enemy" || distSq(projectile, center) > radius * radius) continue;
      if (reflect && projectile.deflectable) this.reflectProjectile(projectile);
      else projectile.life = 0;
      cleared += 1;
    }
    return cleared;
  }

  updateEncounter(dt) {
    const encounter = this.encounter;
    const living = encounter.enemies.filter((enemy) => !enemy.dead);

    // Attention punishes disengagement with a new tactical role, never raw damage scaling.
    const attacking = this.run.player.driveIdle < 0.7;
    const attentionMultiplier = cargoEffects(this.run, "attention_gain_multiplier").reduce((value, effect) => value * (effect.value || 1), hasTechnique(this.run, "cursed_dividend") ? 1.25 : 1);
    encounter.attention = clamp(encounter.attention + dt * (attacking ? -7 : (this.run.phase === "ascent" ? 9 : 6)) * attentionMultiplier, 0, 100);
    if (encounter.attention >= 100) {
      encounter.attention = 34;
      const pool = enemyPoolFor(this.run.roomIndex, this.run.phase).filter((enemy) => /hound|skitter|lancer|riveter|counterfeit|confiscator/.test(enemy.id));
      this.spawnBudgetEnemies(2 + Math.floor(this.run.roomIndex / 7), pool.length ? pool : null);
      this.ui.toast?.("THE ABYSS SENDS A HUNTER");
      audioCall("enemyTell", { hunter: true });
    }

    const nextWave = encounter.waves[encounter.waveIndex + 1];
    if (nextWave) {
      const condition = nextWave.startWhen || {};
      const threshold = condition.remainingAtMost ?? 0;
      const after = condition.after ?? nextWave.delay ?? 0.25;
      if ((living.length <= threshold || encounter.time >= after) && encounter.time >= 0.35) this.spawnNextWave();
    } else if (living.length === 0 && !encounter.clear) {
      encounter.clear = true;
      encounter.clearTimer = 0.72;
      audioCall("roomClear", { phase: this.run.phase });
    }

    if (encounter.boss && !encounter.boss.dead) {
      this.ui.updateBoss?.({
        visible: true,
        name: encounter.boss.def.name,
        phase: `PHASE ${["I", "II", "III"][encounter.boss.phase] || encounter.boss.phase + 1}`,
        hp: clamp(encounter.boss.hp / encounter.boss.maxHp, 0, 1),
      });
    }

    if (encounter.clear) {
      encounter.clearTimer -= dt;
      if (encounter.clearTimer <= 0) {
        encounter.clear = false;
        this.completeRoom();
      }
    }
  }

  completeRoom() {
    const run = this.run;
    const room = this.encounter.room;
    run.roomsCleared += 1;
    this.metrics.roomsCleared += 1;
    this.meta.statistics.roomsCleared = (this.meta.statistics.roomsCleared || 0) + 1;
    this.meta.deepestRoom = Math.max(this.meta.deepestRoom || 0, run.roomIndex + 1);
    if (run.phase === "ascent") {
      if (run.roomIndex <= 0) {
        this.finishRun(true);
      } else {
        this.scene = "transition";
        this.transitionTimer = 0.48;
        setTimeout(() => {
          if (this.run && this.scene === "transition") this.enterRoom(this.run.roomIndex - 1, "ascent");
        }, this.bot.enabled ? 20 : 420);
      }
      return;
    }

    this.scene = "reward";
    this.rewardContext = "room";
    const choices = this.makeRewardChoices(room);
    this.pendingRewards = choices;
    this.ui.renderReward?.(choices, {
      title: room.boss ? "Gate spoils" : room.reward === "cargo" ? "The basin catches something heavy" : "Choose a Technique",
      canReroll: run.rerolls > 0,
      rerolls: run.rerolls,
    });
  }

  makeRewardChoices(room = this.encounter.room) {
    const run = this.run;
    if (room.reward === "cargo" || room.reward === "boss_cargo") {
      let pool = Content.CARGO.filter((cargo) => cargo.biome === room.biome && !["boss", "legendary"].includes(cargo.rarity));
      if (room.boss) {
        const boss = Content.BOSSES[room.boss];
        const ids = new Set(boss?.rewardCargo || []);
        pool = Content.CARGO.filter((cargo) => ids.has(cargo.id));
      } else if (pool.length < 3) {
        const fallback = Content.CARGO.filter((cargo) => !["boss", "legendary"].includes(cargo.rarity) && !pool.some((entry) => entry.id === cargo.id));
        pool = [...pool, ...fallback];
      }
      const selected = run.rng.shuffle(pool).slice(0, 3);
      return selected.map((cargo) => ({
        id: cargo.id,
        type: "cargo",
        name: cargo.name,
        rarity: cargo.rarity,
        description: `${cargo.description} · ${Math.round(cargo.value * (hasTechnique(run, "cursed_dividend") && cargo.curse > 0 ? 1.4 : 1))}c · ${Math.max(1, cargo.weight - (cargo.bossSource && !run.cargo.some((entry) => entry.bossSource) ? [0, 8, 16][metaRank(this.meta, "relic_harness")] || 0 : 0))} weight`,
        value: Math.round(cargo.value * (hasTechnique(run, "cursed_dividend") && cargo.curse > 0 ? 1.4 : 1)),
        weight: Math.max(1, cargo.weight - (cargo.bossSource && !run.cargo.some((entry) => entry.bossSource) ? [0, 8, 16][metaRank(this.meta, "relic_harness")] || 0 : 0)),
        color: cargo.color,
      }));
    }
    const owned = new Set(run.techniques.map((entry) => entry.id));
    const unlocked = new Set(this.meta.unlockedTechniques || Content.DEFAULT_META_V2.unlockedTechniques);
    const compatible = Content.TECHNIQUES.filter((technique) =>
      !owned.has(technique.id)
      && (unlocked.has(technique.id) || technique.unlock?.type === "base_pool")
      && (technique.compatible.includes("all") || technique.compatible.includes(run.weaponId)));
    const selected = run.rng.shuffle(compatible.length >= 3 ? compatible : Content.TECHNIQUES.filter((entry) => !owned.has(entry.id))).slice(0, 3);
    return selected.map((technique) => ({
      id: technique.id,
      type: "technique",
      name: technique.name,
      rarity: technique.rarity,
      description: technique.description,
      tags: technique.tags,
    }));
  }

  chooseReward(id) {
    if (this.scene !== "reward") return;
    const choice = this.pendingRewards?.find((entry) => entry.id === id) || this.pendingRewards?.[0];
    if (!choice) return;
    if (choice.type === "cargo") {
      const cargo = stableClone(Content.CARGO.find((entry) => entry.id === choice.id));
      cargo.value = choice.value;
      cargo.weight = choice.weight;
      this.run.cargo.push(cargo);
      this.run.cachedValue += cargo.value;
      this.run.cachedWeight += cargo.weight;
      this.meta.discoveredCargo = Array.from(new Set([...(this.meta.discoveredCargo || []), cargo.id]));
      this.ui.toast?.(`${cargo.name} cached · ${cargo.weight} weight on ascent`);
    } else {
      const technique = stableClone(Content.TECHNIQUES.find((entry) => entry.id === choice.id));
      this.run.techniques.push(technique);
      this.ui.toast?.(`${technique.name} installed`);
    }
    this.bot.rewardsPicked.push(choice.id);
    audioCall("reward", { type: choice.type, rarity: choice.rarity });
    if (this.rewardContext === "starter") {
      this.rewardContext = null;
      this.scene = "playing";
      this.ui.hideScreen?.();
      this.canvas.focus({ preventScroll: true });
      return;
    }
    this.rewardContext = null;
    this.showBasin();
  }

  rerollReward() {
    if (this.scene !== "reward" || this.run.rerolls <= 0) return;
    this.run.rerolls -= 1;
    this.pendingRewards = this.makeRewardChoices();
    this.ui.renderReward?.(this.pendingRewards, { canReroll: this.run.rerolls > 0, rerolls: this.run.rerolls });
    audioCall("ui", { reroll: true });
  }

  showBasin() {
    this.scene = "basin";
    const atLimit = this.run.roomIndex + 1 >= this.run.maxDepth;
    const balloonAvailable = [4, 9, 14].includes(this.run.roomIndex) && this.run.cachedValue > 0;
    this.ui.renderBasin?.({
      depth: this.run.roomIndex + 1,
      cachedValue: this.run.cachedValue,
      cachedWeight: this.run.cachedWeight,
      carriedValue: this.run.carriedValue,
      maxDepth: this.run.maxDepth,
      atLimit,
      atDepthLimit: atLimit,
      canContinue: !atLimit && this.run.roomIndex < 14,
      canDescend: !atLimit && this.run.roomIndex < 14,
      balloonAvailable,
      canBalloon: balloonAvailable,
      retention: this.balloonRetention(),
      balloonRetention: this.balloonRetention(),
      cargo: this.run.cargo,
    });
  }

  continueDescent() {
    if (this.scene !== "basin") return;
    if (this.run.roomIndex + 1 >= this.run.maxDepth || this.run.roomIndex >= 14) {
      this.beginAscent();
      return;
    }
    this.enterRoom(this.run.roomIndex + 1, "descent");
  }

  beginAscent() {
    if (!this.run || !["basin", "reward"].includes(this.scene)) return;
    this.run.carriedValue += this.run.cachedValue;
    this.run.carriedWeight += this.run.cachedWeight;
    this.run.cachedValue = 0;
    this.run.cachedWeight = 0;
    const hpPenalty = cargoEffects({ ...this.run, phase: "ascent" }, "max_hp_flat").reduce((sum, effect) => sum + (effect.value || 0), 0);
    this.run.player.maxHp = Math.max(55, playerMaxHp(this.meta) + hpPenalty);
    this.run.player.hp = Math.min(this.run.player.hp, this.run.player.maxHp);
    this.enterRoom(this.run.roomIndex, "ascent");
    this.ui.roomBanner?.(`SHOULDER THE BURDEN · ${this.run.carriedWeight} WEIGHT`, "", 950);
    audioCall("basin", { weight: this.run.carriedWeight });
  }

  balloonRetention() {
    const rank = metaRank(this.meta, "reinforced_pulleys");
    let retention = [0.10, 0.20, 0.30, 0.40][rank] || 0.40;
    if (hasTechnique(this.run, "black_balloon")) retention += 0.25;
    return clamp(retention, 0.1, 0.75);
  }

  useBalloon() {
    if (this.scene !== "basin" || ![4, 9, 14].includes(this.run.roomIndex) || this.run.cachedValue <= 0) return;
    const cargo = [...this.run.cargo].sort((a, b) => b.value - a.value)[0];
    const sentGross = cargo ? cargo.value : Math.ceil(this.run.cachedValue * 0.5);
    const retained = Math.floor(sentGross * this.balloonRetention());
    this.run.cachedValue -= sentGross;
    if (cargo) {
      this.run.cachedWeight = Math.max(0, this.run.cachedWeight - cargo.weight);
      this.run.cargo = this.run.cargo.filter((entry) => entry !== cargo);
    } else {
      const sentWeightRatio = sentGross / Math.max(1, this.run.cachedValue + sentGross);
      this.run.cachedWeight = Math.max(0, Math.round(this.run.cachedWeight * (1 - sentWeightRatio)));
    }
    this.run.balloonedValue += retained;
    if (hasTechnique(this.run, "black_balloon")) this.run.balloonThreat += 1;
    const grit = Math.max(1, Math.floor(retained / 70));
    this.meta.grit += grit;
    this.meta.totalExtracted += retained;
    this.meta.statistics.cargoBallooned = (this.meta.statistics.cargoBallooned || 0) + retained;
    this.onMetaChanged(this.meta);
    this.ui.toast?.(`Ballooned ${cargo?.name || "loose cache"} · banked ${retained}c · +${grit} Grit`);
    audioCall("balloon", { retained });
    this.showBasin();
  }

  finishRun(success, message = "") {
    if (!this.run || this.scene === "runend") return;
    const run = this.run;
    this.scene = "runend";
    this.input.resetHeld();
    this.ui.showHud?.(false);
    let grit = 0;
    if (success) {
      grit = Math.max(2, Math.floor(run.carriedValue / 55) + Math.floor(run.roomsCleared / 4));
      this.meta.grit += grit;
      this.meta.totalExtracted += run.carriedValue;
      this.meta.successfulExtractions += 1;
      if (run.deepest >= 14) {
        this.meta.fullExtractions = (this.meta.fullExtractions || 0) + 1;
      }
      for (const sigil of run.pendingSigils) this.meta.bossSigils[sigil] = true;
      for (const shortcut of run.pendingUnlocks) this.meta.shortcuts[shortcut] = true;
      const roomClearance = this.meta.roomClearance || Array(15).fill(false);
      for (let index = 0; index <= run.deepest; index += 1) roomClearance[index] = true;
      this.meta.roomClearance = roomClearance;
      this.unlockProgressionPools();
      audioCall("extract", { value: run.carriedValue, grit });
      setMusic("moss", 0.15, "victory");
    } else {
      audioCall("death", { depth: run.roomIndex + 1 });
    }
    this.onMetaChanged(this.meta);
    this.ui.renderEnd?.({
      success,
      title: success ? "THE CAGE REACHES DAYLIGHT" : "THE ABYSS KEEPS ITS DUE",
      description: message || (success ? "Every coin made the climb. The next descent can go deeper." : "Ballooned value remains banked. Everything on your shoulders is gone."),
      extracted: success ? run.carriedValue : 0,
      extractedValue: success ? run.carriedValue : 0,
      value: success ? run.carriedValue : 0,
      grit,
      ballooned: run.balloonedValue,
      deepest: run.deepest + 1,
      rooms: run.roomsCleared,
      roomsCleared: run.roomsCleared,
      techniques: run.techniques.length,
      cargo: run.cargo.length,
      full: success && run.deepest >= 14,
      qaMetrics: this.bot.enabled ? {
        enemies: this.metrics.enemiesDefeated,
        bosses: this.metrics.bossesDefeated,
        phases: this.metrics.bossPhasesSeen,
        projectiles: this.metrics.projectilesSpawned,
        nearMisses: this.metrics.nearMisses,
        deflects: this.metrics.deflects,
        stuck: this.metrics.stuckEvents,
        recovered: this.metrics.recoveries,
        roomsVisited: this.bot.roomsVisited.size,
      } : null,
    });
  }

  unlockProgressionPools() {
    const meta = this.meta;
    const unlocked = new Set(meta.unlockedTechniques || []);
    for (const technique of Content.TECHNIQUES) {
      const unlock = technique.unlock || {};
      if (unlock.type === "boss_sigils" && (unlock.sigils || []).every((sigil) => meta.bossSigils[sigil])) unlocked.add(technique.id);
      if (unlock.type === "successful_extractions" && meta.successfulExtractions >= unlock.count) unlocked.add(technique.id);
      if (unlock.type === "survey_rooms" && meta.deepestRoom >= unlock.count) unlocked.add(technique.id);
      if (unlock.type === "meta_upgrade_rank" && metaRank(meta, unlock.id) >= (unlock.rank || 1)) unlocked.add(technique.id);
    }
    meta.unlockedTechniques = [...unlocked];
  }

  abandonRun() {
    this.finishRun(false, "You cut the rope and abandoned the burden.");
  }

  updateBot(dt) {
    const bot = this.bot;
    bot.elapsed += dt;
    bot.decisions += 1;
    if (!this.run || !this.encounter) return;
    if (this.scene === "reward") {
      this.chooseReward(this.pendingRewards?.[0]?.id);
      return;
    }
    if (this.scene === "basin") {
      if (this.run.roomIndex + 1 < this.run.maxDepth && this.run.roomIndex < 14) this.continueDescent();
      else this.beginAscent();
      return;
    }
    if (this.scene !== "playing") return;
    const player = this.run.player;
    const target = this.encounter.enemies
      .filter((enemy) => !enemy.dead)
      .sort((a, b) => distSq(player, a) - distSq(player, b))[0];
    const held = new Set(["primary"]);
    if (!target) {
      this.input.setVirtualHeld([]);
      return;
    }
    this.input.setVirtualAim(target.x, target.y);
    const distance = dist(player, target);
    const toTarget = normalizeVector(target.x - player.x, target.y - player.y);
    const ranged = ["repeater", "prism"].includes(this.run.weaponId);
    let move = { x: toTarget.x, y: toTarget.y };
    if (ranged && distance < 36) move = { x: -toTarget.x, y: -toTarget.y };
    else if (ranged && distance < 68) move = { x: -toTarget.y, y: toTarget.x };
    else if (!ranged && distance < 13) move = { x: -toTarget.y, y: toTarget.x };
    const danger = this.encounter.projectiles
      .filter((projectile) => projectile.faction === "enemy")
      .sort((a, b) => distSq(player, a) - distSq(player, b))[0];
    if (danger && dist(player, danger) < 17) {
      const velocity = normalizeVector(danger.vx, danger.vy);
      const side = signOr(toTarget.x * -velocity.y + toTarget.y * velocity.x);
      move = { x: -velocity.y * side, y: velocity.x * side };
      if (dist(player, danger) < 10 && player.deflectCooldown <= 0) this.input.press("deflect");
      else if (player.dashCooldown <= 0) this.input.press("dodge");
    } else if (target.state === "active" && distance < this.enemyAttackRange(target.attack || {}) + 7 && player.dashCooldown <= 0) {
      this.input.press("dodge");
    }
    if (move.x > 0.2) held.add("right");
    if (move.x < -0.2) held.add("left");
    if (move.y > 0.2) held.add("down");
    if (move.y < -0.2) held.add("up");
    if (player.techniqueCooldown <= 0 && distance < (ranged ? 95 : 35)) held.add("secondary");
    if (Content.WEAPONS[this.run.weaponId].resource?.type === "magazine" && player.ammo <= 2 && player.reload <= 0) this.input.press("reload");
    this.input.setVirtualHeld(held);
  }

  refreshHud() {
    if (!this.run || !this.encounter) return;
    const run = this.run;
    const player = run.player;
    const weapon = Content.WEAPONS[run.weaponId];
    const weight = run.phase === "ascent" ? run.carriedWeight + player.lienWeight : 0;
    const tier = burdenTier(weight, burdenCapacity(this.meta));
    const dashCharge = 1 - clamp(player.dashCooldown / tier.dashCooldown, 0, 1);
    const hunted = this.encounter.attention >= 72;
    const pressure = hunted ? this.encounter.attention : player.drive;
    this.ui.updateHud?.({
      player: { hp: player.hp, maxHp: player.maxHp, dashCharge },
      biome: this.encounter.biome,
      zoneName: this.encounter.biome.name,
      phase: run.phase,
      roomIndex: run.roomIndex,
      pressure,
      pressureMax: 100,
      pressureLabel: hunted ? `HUNTED ${Math.round(this.encounter.attention)}` : `DRIVE ${Math.round(player.drive)}`,
      weight,
      maxWeight: burdenCapacity(this.meta),
      weightTier: tier.name,
      carriedValue: run.phase === "descent" ? run.cachedValue : run.carriedValue,
      weapon: { id: run.weaponId, name: weapon.name },
      ammoText: weapon.resource?.type === "magazine"
        ? (player.reload > 0 ? "LOAD" : `${player.ammo}/${weapon.resource.capacity}`)
        : weapon.resource?.type === "impact_charge"
          ? `IMPACT ${Math.round(player.impactCharge || 0)}%`
          : player.techniqueCooldown > 0 ? `${player.techniqueCooldown.toFixed(1)}s` : "READY",
      techniques: run.techniques,
    });
  }

  updateCosmetics(dt) {
    if (!this.encounter) return;
    for (const particle of this.encounter.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.08, dt);
      particle.vy *= Math.pow(0.08, dt);
    }
    this.encounter.particles = this.encounter.particles.filter((particle) => particle.life > 0);
  }

  spawnParticle(x, y, color, life = 0.3, vx = 0, vy = 0, size = 1) {
    if (!this.encounter) return;
    this.encounter.particles.push({ x, y, color, life, maxLife: life, vx, vy, size });
  }

  spawnBurst(x, y, color, count = 8) {
    const visualRng = this.run?.rng || new SeededRng(1);
    for (let index = 0; index < count; index += 1) {
      const angle = visualRng.range(0, TAU);
      const speed = visualRng.range(12, count > 20 ? 62 : 38);
      this.spawnParticle(x, y, color, visualRng.range(0.15, 0.48), Math.cos(angle) * speed, Math.sin(angle) * speed, visualRng.chance(0.18) ? 2 : 1);
    }
  }

  render() {
    if (!this.renderer) return;
    const ctx = this.renderer.beginFrame(this.encounter?.biome?.shadow || "#06090d");
    if (!this.run || !this.encounter) return;
    const encounter = this.encounter;
    const run = this.run;
    const shakeStrength = (this.meta.settings?.reducedMotion ? 0 : this.shake) * (this.meta.settings?.screenShake ?? 1);
    const shakeX = shakeStrength > 0 ? Math.round(Math.sin(this.time * 173) * shakeStrength) : 0;
    const shakeY = shakeStrength > 0 ? Math.round(Math.cos(this.time * 149) * shakeStrength) : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    this.renderer.drawArena({ ...encounter.room, hazards: [] }, encounter.biome, run.phase, encounter.time);
    this.renderEntrances(ctx);
    this.renderDecor();
    this.renderHazards(ctx);
    this.renderEffects(ctx);
    for (const barrier of encounter.barriers) this.renderBarrier(ctx, barrier);
    for (const prism of encounter.prisms) this.renderPrism(ctx, prism);
    for (const projectile of encounter.projectiles) this.renderer.drawProjectile({ ...projectile, hostile: projectile.faction === "enemy", tail: projectile.kind.includes("lance") ? 7 : 4 });
    for (const enemy of encounter.enemies) this.renderEnemy(ctx, enemy);
    this.renderPlayer(ctx);
    this.renderer.drawParticles(encounter.particles);
    ctx.restore();
  }

  renderEntrances(ctx) {
    const room = this.encounter.room;
    const descent = room.descentExit || { x: 160, y: 164 };
    const ascent = room.ascentExit || room.entry || { x: 160, y: 18 };
    const active = this.run.phase === "descent" ? descent : ascent;
    ctx.fillStyle = this.encounter.clear ? COLORS.gold : this.encounter.biome.accent;
    ctx.globalAlpha = this.encounter.clear ? 1 : 0.34;
    ctx.fillRect(Math.round(active.x - 9), Math.round(active.y - 3), 18, 5);
    ctx.fillStyle = "#080b0d";
    ctx.fillRect(Math.round(active.x - 5), Math.round(active.y - 2), 10, 3);
    ctx.globalAlpha = 1;
  }

  renderDecor() {
    for (const decor of this.encounter.room.decor || []) {
      this.renderer.drawPixelEntity({
        sprite: decor.sprite,
        x: decor.x,
        y: decor.y,
        drawSize: 12 * (decor.scale || 1),
        alpha: 0.68,
        shadow: false,
        color: decor.tint,
      });
    }
  }

  renderHazards(ctx) {
    for (const hazard of this.encounter.hazards) {
      if (hazard.type === "interactive_spore_pod" && !hazard.alive) continue;
      const warning = hazard.tellActive ? COLORS.gold : hazard.active ? COLORS.danger : this.encounter.biome.accent;
      if (hazard.rect) {
        const rect = hazard.runtimeRect || hazard.rect;
        ctx.globalAlpha = hazard.active ? 0.52 : hazard.tellActive ? 0.34 : 0.12;
        ctx.fillStyle = warning;
        ctx.fillRect(Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h));
        ctx.globalAlpha = 1;
        ctx.fillStyle = warning;
        const march = Math.floor(this.time * 18) % 8;
        if (/current|conveyor/.test(hazard.type)) {
          for (let y = rect.y + march; y < rect.y + rect.h; y += 12) ctx.fillRect(Math.round(rect.x + rect.w / 2 - 1), Math.round(y), 3, 4);
        } else if (hazard.tellActive || hazard.active) {
          ctx.fillRect(Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), 1);
          ctx.fillRect(Math.round(rect.x), Math.round(rect.y + rect.h - 1), Math.round(rect.w), 1);
        }
      }
      if (hazard.center && hazard.radius) {
        ctx.fillStyle = "#080b0d";
        ctx.fillRect(Math.round(hazard.center.x - hazard.radius), Math.round(hazard.center.y - hazard.radius), Math.round(hazard.radius * 2), Math.round(hazard.radius * 2));
        ctx.fillStyle = warning;
        ctx.fillRect(Math.round(hazard.center.x - hazard.radius + 2), Math.round(hazard.center.y - hazard.radius + 2), Math.round(hazard.radius * 2 - 4), Math.round(hazard.radius * 2 - 4));
      }
      if (hazard.renderLine) {
        ctx.strokeStyle = warning;
        ctx.lineWidth = Math.max(2, hazard.width || 4);
        ctx.beginPath();
        ctx.moveTo(Math.round(hazard.renderLine.a.x), Math.round(hazard.renderLine.a.y));
        ctx.lineTo(Math.round(hazard.renderLine.b.x), Math.round(hazard.renderLine.b.y));
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (hazard.type === "rotating_safe_grates") {
        (hazard.rects || []).forEach((rect, index) => {
          ctx.globalAlpha = index === hazard.safeIndex ? 0.18 : hazard.active ? 0.62 : hazard.tellActive ? 0.34 : 0.12;
          ctx.fillStyle = index === hazard.safeIndex ? "#76e3b0" : warning;
          ctx.fillRect(Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h));
        });
        ctx.globalAlpha = 1;
      }
      if (hazard.type === "interactive_spore_pod" && hazard.center) {
        ctx.fillStyle = "#d5e884";
        ctx.fillRect(Math.round(hazard.center.x - 3), Math.round(hazard.center.y - 3), 7, 7);
        ctx.fillStyle = "#355534";
        ctx.fillRect(Math.round(hazard.center.x - 1), Math.round(hazard.center.y - 1), 3, 3);
      }
    }
  }

  renderEffects(ctx) {
    for (const effect of this.encounter.effects) {
      if (effect.type === "slash") {
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.round(effect.x), Math.round(effect.y));
        ctx.lineTo(Math.round(effect.x2), Math.round(effect.y2));
        ctx.stroke();
        ctx.lineWidth = 1;
      } else if (effect.type === "strike_line") {
        ctx.strokeStyle = effect.color;
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = Math.max(2, effect.width || 8);
        ctx.beginPath();
        ctx.moveTo(Math.round(effect.x), Math.round(effect.y));
        ctx.lineTo(Math.round(effect.x2), Math.round(effect.y2));
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
      } else if (["beam", "chain", "link"].includes(effect.type)) {
        const target = effect.target || { x: effect.x2, y: effect.y2 };
        ctx.strokeStyle = effect.color;
        ctx.globalAlpha = 0.8;
        ctx.setLineDash(effect.type === "chain" ? [3, 2] : []);
        ctx.beginPath();
        ctx.moveTo(Math.round(effect.x), Math.round(effect.y));
        ctx.lineTo(Math.round(target.x), Math.round(target.y));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      } else if (["mine", "damage_zone", "hostile_zone", "slow_zone", "blast", "impact_ring"].includes(effect.type)) {
        const pulse = Math.floor(this.time * 16) % 3;
        ctx.globalAlpha = effect.type === "slow_zone" ? 0.18 : effect.armed ? 0.46 : 0.25;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = pulse === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.arc(Math.round(effect.x), Math.round(effect.y), Math.max(2, Math.round(effect.r)), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
      } else if (effect.type === "loot") {
        ctx.fillStyle = effect.color;
        ctx.fillRect(Math.round(effect.x - 2), Math.round(effect.y - 4 - (0.7 - effect.time) * 8), 5, 4);
      }
    }
  }

  renderBarrier(ctx, barrier) {
    ctx.fillStyle = "#070a0d";
    ctx.fillRect(Math.round(barrier.x - 1), Math.round(barrier.y - 1), Math.round(barrier.w + 2), Math.round(barrier.h + 2));
    ctx.fillStyle = barrier.color;
    ctx.globalAlpha = 0.72;
    ctx.fillRect(Math.round(barrier.x), Math.round(barrier.y), Math.round(barrier.w), Math.round(barrier.h));
    ctx.globalAlpha = 1;
  }

  renderPrism(ctx, prism) {
    ctx.save();
    ctx.translate(Math.round(prism.x), Math.round(prism.y));
    ctx.rotate(prism.angle);
    ctx.fillStyle = "#e7feff";
    ctx.fillRect(-1, -6, 3, 12);
    ctx.fillStyle = "#5bd8e8";
    ctx.fillRect(0, -4, 1, 8);
    ctx.restore();
  }

  renderEnemy(ctx, enemy) {
    const size = enemy.boss ? Math.round(enemy.r * 2.25) : Math.max(11, Math.round(enemy.r * 2.2));
    this.renderer.drawPixelEntity({
      sprite: enemy.def.sprite,
      x: enemy.x,
      y: enemy.y,
      r: enemy.r,
      drawSize: size,
      facing: enemy.aim,
      color: enemy.def.color,
      shadowColor: enemy.def.shadowColor,
      hitFlash: enemy.flash > 0,
      alpha: enemy.dead ? clamp(enemy.stateTime / 0.48, 0, 1) : enemy.state === "enter" ? 0.66 : 1,
    });
    if (enemy.boss) {
      for (const mirror of enemy.mirrors || []) {
        if (mirror.disabled > 0) continue;
        this.renderer.drawPixelEntity({
          sprite: enemy.def.sprite,
          x: mirror.x,
          y: mirror.y,
          r: mirror.r,
          drawSize: Math.max(10, Math.round(size * 0.72)),
          facing: angleBetween(mirror, this.run.player),
          color: enemy.def.color,
          shadowColor: enemy.def.shadowColor,
          alpha: 0.62,
        });
      }
      if (enemy.corePlates > 0) {
        ctx.fillStyle = "#ffbf70";
        for (let index = 0; index < enemy.corePlates; index += 1) ctx.fillRect(Math.round(enemy.x - 5 + index * 5), Math.round(enemy.y - size / 2 - 6), 3, 2);
      }
      if (enemy.exposed > 0) {
        ctx.strokeStyle = "#fff2ad";
        ctx.strokeRect(Math.round(enemy.x - enemy.r - 2), Math.round(enemy.y - enemy.r - 2), Math.round(enemy.r * 2 + 4), Math.round(enemy.r * 2 + 4));
      }
    }
    if (enemy.state === "tell") {
      const urgency = 1 - clamp(enemy.stateTime / enemy.attackTimeline.tell, 0, 1);
      const length = /projectile|burst|lance|orb|fan|beam|charge/.test(enemy.attack.pattern) ? 18 + urgency * 16 : 9;
      ctx.strokeStyle = urgency > 0.62 ? "#ff8461" : COLORS.gold;
      ctx.globalAlpha = 0.45 + urgency * 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(enemy.x + Math.cos(enemy.aim) * (enemy.r + 2)), Math.round(enemy.y + Math.sin(enemy.aim) * (enemy.r + 2)));
      ctx.lineTo(Math.round(enemy.x + Math.cos(enemy.aim) * length), Math.round(enemy.y + Math.sin(enemy.aim) * length));
      ctx.stroke();
      ctx.fillStyle = urgency > 0.62 ? COLORS.danger : COLORS.gold;
      ctx.fillRect(Math.round(enemy.x - 2), Math.round(enemy.y - size / 2 - 4), 5, 2);
      ctx.globalAlpha = 1;
    }
    if (!enemy.boss && (enemy.hp < enemy.maxHp || enemy.elite)) {
      const width = enemy.elite ? 15 : 11;
      const y = Math.round(enemy.y - size / 2 - 3);
      ctx.fillStyle = "#170c0d";
      ctx.fillRect(Math.round(enemy.x - width / 2), y, width, 2);
      ctx.fillStyle = enemy.elite ? COLORS.gold : COLORS.danger;
      ctx.fillRect(Math.round(enemy.x - width / 2), y, Math.max(1, Math.round(width * clamp(enemy.hp / enemy.maxHp, 0, 1))), 1);
    }
    if (enemy.mark > 0) {
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(Math.round(enemy.x - 1), Math.round(enemy.y - size / 2 - 6), 3, 3);
    }
  }

  renderPlayer(ctx) {
    const player = this.run.player;
    const weapon = Content.WEAPONS[this.run.weaponId];
    if (this.run.phase === "ascent") {
      const count = clamp(Math.ceil(this.run.carriedWeight / 18), 1, 5);
      for (let index = count - 1; index >= 0; index -= 1) {
        const offset = vecFromAngle(player.aim + Math.PI, 5 + index * 3);
        ctx.fillStyle = index % 2 ? "#79552c" : COLORS.gold;
        ctx.fillRect(Math.round(player.x + offset.x - 2), Math.round(player.y + offset.y - 2), 5, 5);
        ctx.fillStyle = "#2b1a10";
        ctx.fillRect(Math.round(player.x + offset.x - 1), Math.round(player.y + offset.y - 1), 3, 1);
      }
    }
    this.renderer.drawPixelEntity({
      sprite: 92,
      x: player.x,
      y: player.y,
      r: player.r,
      drawSize: 14,
      facing: player.aim,
      color: COLORS.player,
      shadowColor: "#111419",
      invulnerableFlash: player.invuln > 0 && Math.floor(player.invuln * 30) % 2 === 0,
    });
    const tip = vecFromAngle(player.aim, 8);
    ctx.strokeStyle = weapon.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(Math.round(player.x + Math.cos(player.aim) * 3), Math.round(player.y + Math.sin(player.aim) * 3));
    ctx.lineTo(Math.round(player.x + tip.x), Math.round(player.y + tip.y));
    ctx.stroke();
    ctx.lineWidth = 1;
    if (player.deflectTime > 0) {
      ctx.strokeStyle = COLORS.deflect;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Math.round(player.x), Math.round(player.y), 9, player.aim - degrees(55), player.aim + degrees(55));
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    if (player.drive >= 75) {
      ctx.globalAlpha = 0.5 + Math.sin(this.time * 16) * 0.18;
      ctx.fillStyle = player.drive >= 99 ? "#fff2ae" : weapon.color;
      ctx.fillRect(Math.round(player.x - 1), Math.round(player.y - 10), 3, 2);
      ctx.globalAlpha = 1;
    }
  }

  snapshot() {
    return {
      scene: this.scene,
      phase: this.run?.phase || null,
      roomIndex: this.run?.roomIndex ?? null,
      roomName: this.encounter?.room?.name || null,
      hp: this.run?.player?.hp ?? null,
      weapon: this.run?.weaponId || null,
      techniques: this.run?.techniques?.map((entry) => entry.id) || [],
      cargo: this.run?.cargo?.map((entry) => entry.id) || [],
      cachedValue: this.run?.cachedValue || 0,
      carriedValue: this.run?.carriedValue || 0,
      carriedWeight: this.run?.carriedWeight || 0,
      enemies: this.encounter?.enemies?.filter((enemy) => !enemy.dead).length || 0,
      projectiles: this.encounter?.projectiles?.length || 0,
      bot: {
        enabled: this.bot.enabled,
        elapsed: this.bot.elapsed,
        decisions: this.bot.decisions,
        roomsVisited: [...this.bot.roomsVisited],
        weaponsUsed: [...this.bot.weaponsUsed],
        rewardsPicked: [...this.bot.rewardsPicked],
      },
      metrics: { ...this.metrics },
    };
  }
}
