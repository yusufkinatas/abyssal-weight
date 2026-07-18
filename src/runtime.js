import * as Content from "./data.js?v=20260718-6";
import { ActionInput } from "./input.js?v=20260718-6";
import { SeededRng } from "./rng.js?v=20260718-6";
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
} from "./collision.js?v=20260718-6";
import { NavAgentState, NavGrid } from "./navigation.js?v=20260718-6";

const WORLD = Content.BASE_WORLD;
const FIXED_STEP = 1 / 60;
const PLAYER_RADIUS = 3.6;
const PLAYER_SPEED = 76;
const PLAYER_DASH_SPEED = 200;
const PLAYER_DASH_TIME = 0.14;
const PLAYER_SPRITE = 100;
const ENTRY_GRACE = 0.92;
const DEFLECT_HALF_ARC = 80;
const PLAYER_VIEWPORT_TOP = 28;
const PLAYER_VIEWPORT_BOTTOM = 156;
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

/**
 * A shared facing contract for melee parries and projectile reflections.
 * Projectile positions overlap the player at collision time, so their incoming
 * velocity is used to recover the direction they came from.
 */
export function isWithinDeflectCone(player, source, halfArcDegrees = DEFLECT_HALF_ARC) {
  if (!player || !source) return false;
  const projectileLike = source.faction === "enemy"
    || String(source.uid || "").startsWith("p:")
    || distSq(player, source) < 0.0001;
  const sourceAngle = projectileLike
    && Number.isFinite(source.vx) && Number.isFinite(source.vy)
    && Math.hypot(source.vx, source.vy) > 0.001
    ? Math.atan2(source.vy, source.vx) + Math.PI
    : angleBetween(player, source);
  return Math.abs(angleDiff(sourceAngle, player.aim || 0)) <= degrees(halfArcDegrees);
}

function circleRectOverlap(circle, rect) {
  const x = clamp(circle.x, rect.x, rect.x + rect.w);
  const y = clamp(circle.y, rect.y, rect.y + rect.h);
  return (circle.x - x) ** 2 + (circle.y - y) ** 2 <= circle.r ** 2;
}

function playerViewportBounds(bounds) {
  const top = Math.max(bounds.y, PLAYER_VIEWPORT_TOP);
  const bottom = Math.min(bounds.y + bounds.h, PLAYER_VIEWPORT_BOTTOM);
  return { x: bounds.x, y: top, w: bounds.w, h: Math.max(1, bottom - top) };
}

function audioCall(name, payload) {
  const audio = window.AbyssalAudio || window.abyssalAudio || window.audioEngine;
  try {
    const options = payload && typeof payload === "object" ? { ...payload } : {};
    const x = Number(options.x);
    delete options.x;
    if (Number.isFinite(x) && typeof audio?.playAt === "function") audio.playAt(name, x, WORLD.w / 2, WORLD.w, options);
    else if (typeof audio?.playSfx === "function") audio.playSfx(name, options);
    else if (typeof audio?.sfx === "function") audio.sfx(name, options);
    else if (typeof audio?.play === "function") audio.play(name, options);
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
  if (ratio < 0.25) return { id: "agile", name: "AGILE", ratio, speed: 1, dashCooldown: 0.50, dashIFrames: 0.18 };
  if (ratio < 0.75) return { id: "laden", name: "LADEN", ratio, speed: 0.97, dashCooldown: 0.58, dashIFrames: 0.16 };
  return { id: "crushing", name: "CRUSHING", ratio, speed: 0.93, dashCooldown: 0.68, dashIFrames: 0.145 };
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
    timer: Number.isFinite(Number(hazard.offset))
      ? Number(hazard.offset)
      : Number.isFinite(Number(hazard.phase)) ? 0 : index * 0.37,
    activeDuration: typeof hazard.active === "number" ? hazard.active : null,
    active: false,
    hitTimer: 0,
    cooldownTimer: 0,
    disabledTimer: 0,
    travelled: 0,
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

function enemySpawnMaterializeTime(def) {
  if (def?.elite) return 0.68;
  return 0.48;
}

function attackTimeline(attack) {
  const pattern = attack.pattern || "";
  let authoredActive = Number(attack.active) || 0.10;
  if (/thorn_lash/.test(pattern)) authoredActive = Math.max(authoredActive, ((attack.swipes || 3) - 1) * (attack.interval || 0.15) + 0.09);
  if (/aimed_burst|predictive_pair|clone_lances|mirrored_ricochet_pair|rivet_fan|seed_mortar|crucible_toss/.test(pattern)) {
    const count = attack.count || attack.lanes || (pattern.includes("pair") ? 2 : 3);
    authoredActive = Math.max(authoredActive, (count - 1) * (attack.interval || 0.11) + 0.09);
  }
  if (/glass_step/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.repeats || 1) * (attack.repeatDelay || 0.32) + 0.10);
  if (/halo_burst/.test(pattern)) authoredActive = Math.max(authoredActive, ((attack.rings || 2) - 1) * (attack.ringDelay || 0.28) + 0.10);
  if (/root_wall_wave/.test(pattern)) authoredActive = Math.max(authoredActive, ((attack.waves || 2) - 1) * (attack.interval || 0.30) + 0.10);
  if (/hammer_combo_ring/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.strikes || 3) * (attack.interval || 0.30) + 0.10);
  if (/king_hammer_rail|hammer_line_then_cross/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.crossDelay || 0.20) + 0.09);
  if (/pounce_pair/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.repeatDelay || 0.16) + 0.13);
  if (/stepped_shield_bash/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.advanceBeats || 3) * 0.09);
  if (/sidestep_jab/.test(pattern)) authoredActive = Math.max(authoredActive, (attack.sidesteps || 3) * (attack.sidestepTime || 0.12) + 0.06);
  if (/charge|leap|pounce|rush/.test(pattern)) authoredActive = Math.max(authoredActive, Math.min(0.85, (attack.range || 70) / (attack.speed || 130)));
  const heavyTell = /mortar|barrier|cage|beam|hammer|bellows|charge|slam|ring|fan/.test(pattern);
  return {
    tell: Math.max(heavyTell ? 0.28 : 0.22, Number(attack.tell) || 0.26),
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
    this.impactFlash = 0;
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
        deflectPerfectTime: 0,
        deflectSuccess: 0,
        deflectCooldown: 0,
        action: null,
        actionQueue: null,
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
        recoil: 0,
        hurtTime: 0,
        stepTimer: 0,
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
    player.actionQueue = null;
    player.dashTime = 0;
    player.deflectTime = 0;
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
      waveDelay: 0.55,
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
      attackTokenCap: phase === "ascent" ? 3 : this.run.roomIndex < 4 ? 2 : 3,
      attention: phase === "ascent" ? 20 : 0,
      hunterSpawned: false,
      hunterCooldown: 0,
      lastMaterializeTime: -Infinity,
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
    // The room gets a short readable settle beat before silhouettes materialize.
    // updateEncounter owns the first spawn so authored wave.delay is honored.
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
      this.spawnBoss(wave.boss, wave.point || wave.position || wave.points?.[0]);
      return;
    }
    groups.forEach((group, groupIndex) => {
      if (typeof group === "string") {
        this.spawnEnemy(group, encounter.spawnPoints[groupIndex % encounter.spawnPoints.length]);
        return;
      }
      if (group.boss) {
        this.spawnBoss(group.boss, group.point || group.position || group.points?.[0]);
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
    let spawned = 0;
    while (remaining > 0 && guard < 20 && pool.length) {
      guard += 1;
      const affordable = pool.filter((entry) => (entry.threatCost || 1) <= remaining);
      if (!affordable.length) break;
      const def = this.run.rng.pick(affordable);
      const point = this.run.rng.pick(this.encounter.spawnPoints);
      this.spawnEnemy(def.id, { x: point.x + this.run.rng.range(-4, 4), y: point.y + this.run.rng.range(-4, 4) });
      spawned += 1;
      remaining -= def.threatCost || 1;
    }
    return spawned;
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
      stateTime: enemySpawnMaterializeTime(def),
      cooldown: this.run.rng.range(0.52, 0.78),
      attack: null,
      aim: angleBetween(point, this.run.player),
      activeResolved: false,
      shotsFired: 0,
      tokenHeld: 0,
      flash: 0,
      hitReaction: 0,
      hitAngle: 0,
      hitKick: 0,
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
    this.encounter.lastMaterializeTime = this.encounter.time;
    this.meta.bestiarySeen = Array.from(new Set([...(this.meta.bestiarySeen || []), id]));
    return enemy;
  }

  spawnBoss(id, authoredPoint = null) {
    const def = Content.BOSSES[id];
    if (!def) return;
    const point = authoredPoint
      || phaseRoomSpec(this.encounter.room, "descent").bossPoint
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
    this.encounter.lastMaterializeTime = this.encounter.time;
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
    if (!this.run || !this.encounter) {
      this.input.tick(dt);
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
      this.input.clearBuffered?.();
      this.input.endStep();
      return;
    }

    if (this.hitstop > 0) {
      this.hitstop -= 1;
      this.updateCosmetics(dt * 0.25);
      this.input.endStep();
      return;
    }

    this.input.tick(dt);
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

  addHitstop(frames = 1, flash = 0) {
    this.hitstop = Math.max(this.hitstop, Math.max(0, Math.ceil(frames)));
    this.impactFlash = Math.max(this.impactFlash, flash);
  }

  queuePlayerAction(type, seconds = 0.16) {
    const player = this.run.player;
    player.actionQueue = { type, time: seconds, weaponId: this.run.weaponId };
  }

  canCancelPlayerAction(utility) {
    const action = this.run.player.action;
    if (!action) return true;
    // Resource costs commit at action start. Cancels therefore unlock only
    // once the attack has reached its active beat, never during startup.
    if (action.phase === "startup") return false;
    const cancels = action.part?.cancels || action.payload?.cancels || {};
    const startedAt = Number.isFinite(action.startedAt) ? action.startedAt : this.time;
    const elapsed = Math.max(0, this.time - startedAt);
    if (utility === "dodge") {
      return Boolean(cancels.dashAfterActive)
        || (Number.isFinite(cancels.dashAfter) && elapsed >= cancels.dashAfter);
    }
    if (utility === "deflect") {
      return Boolean(cancels.deflectAfterActive)
        || (Number.isFinite(cancels.deflectAfter) && elapsed >= cancels.deflectAfter);
    }
    return false;
  }

  updatePlayer(dt) {
    const run = this.run;
    const player = run.player;
    const encounter = this.encounter;
    let weapon = Content.WEAPONS[run.weaponId];
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
    player.deflectPerfectTime = Math.max(0, (player.deflectPerfectTime || 0) - dt);
    player.deflectSuccess = Math.max(0, (player.deflectSuccess || 0) - dt);
    player.recoil = Math.max(0, (player.recoil || 0) - dt * 8);
    player.hurtTime = Math.max(0, (player.hurtTime || 0) - dt);
    player.stepTimer = Math.max(0, (player.stepTimer || 0) - dt);
    if (player.actionQueue) {
      player.actionQueue.time -= dt;
      if (player.actionQueue.time <= 0) player.actionQueue = null;
    }
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

    let utilityCommitted = false;
    if (player.deflectCooldown <= 0 && this.canCancelPlayerAction("deflect") && this.input.consume("deflect")) {
      const bonus = [0, 0.012, 0.024][metaRank(this.meta, "reflex_coil")] || 0;
      player.deflectTime = 0.13 + bonus;
      player.deflectPerfectTime = 0.07 + bonus;
      player.deflectCooldown = 0.30;
      player.action = null;
      player.actionQueue = null;
      this.input.consume("dodge");
      utilityCommitted = true;
      this.encounter.effects.push({ type: "deflect_arc", x: player.x, y: player.y, angle: player.aim, r: 11, time: 0.13, maxTime: 0.13, color: COLORS.deflect });
      audioCall("parry", { x: player.x, volume: 0.55 });
    }

    if (this.input.consume("interact")) this.interactWithRoom();

    const tier = burdenTier(run.phase === "ascent" ? run.carriedWeight + player.lienWeight : 0, burdenCapacity(this.meta));
    const dashMeta = [1, 0.94, 0.88][metaRank(this.meta, "dash_bearings")] || 0.88;
    if (!utilityCommitted && player.deflectTime <= 0 && player.dashCooldown <= 0
      && this.canCancelPlayerAction("dodge") && this.input.consume("dodge")) {
      const direction = move.length > 0 ? move : vecFromAngle(player.aim);
      player.dashDir = { x: direction.x, y: direction.y };
      player.dashSerial += 1;
      player.dashTime = PLAYER_DASH_TIME;
      const cargoDashCooldown = cargoEffects(run, "dash_cooldown_multiplier")
        .reduce((value, effect) => value * (effect.value || 1), 1);
      player.dashCooldown = tier.dashCooldown * dashMeta * cargoDashCooldown;
      player.invuln = tier.dashIFrames;
      player.action = null;
      player.actionQueue = null;
      this.input.consume("deflect");
      player.dashGhostTimer = 0;
      player.reload = Math.max(0, player.reload);
      this.onDash(tier);
      audioCall("dash", { tier: tier.id, x: player.x, heavy: tier.id === "crushing" });
    }

    if (!player.action && this.input.consume("swap")) {
      this.cycleWeapon();
      weapon = Content.WEAPONS[run.weaponId];
    }
    if (!player.action && this.input.consume("reload")) this.beginReload();

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
        player.reload = 0;
        player.ammo = weapon.resource?.capacity ?? Infinity;
        audioCall("reload", { stage: "complete" });
      }
    }

    if (player.dashTime > 0) {
      player.dashTime -= dt;
      const speed = PLAYER_DASH_SPEED * (tier.id === "crushing" ? 0.93 : 1);
      this.movePlayer(player.dashDir.x * speed * dt, player.dashDir.y * speed * dt);
      if (tier.id === "crushing") this.resolveCrushingDash();
      player.dashGhostTimer = Math.max(0, (player.dashGhostTimer || 0) - dt);
      if (player.dashGhostTimer <= 0) {
        player.dashGhostTimer = 0.035;
        this.encounter.effects.push({
          type: "player_afterimage", x: player.x, y: player.y, angle: player.aim,
          time: 0.13, maxTime: 0.13, color: weapon.color,
        });
      }
      this.spawnParticle(player.x, player.y, this.encounter.biome.accent, 0.16, -player.dashDir.x * 15, -player.dashDir.y * 15, 2);
      return;
    }

    if (player.action && !player.actionQueue) {
      if (player.techniqueCooldown <= 0 && this.input.buffered?.("secondary")) {
        this.input.consume("secondary");
        this.queuePlayerAction("technique", 0.18);
      } else if (this.input.buffered?.("primary")) {
        this.input.consume("primary");
        this.queuePlayerAction("primary", weapon.resource?.queueWindow || weapon.primary?.buffer || 0.16);
      }
    }
    if (player.action) this.updatePlayerAction(dt);
    let canAct = !player.action && player.reload <= 0 && player.deflectTime <= 0 && player.hurtTime <= 0;
    if (canAct && player.actionQueue) {
      const queued = player.actionQueue;
      if (queued.weaponId !== run.weaponId) player.actionQueue = null;
      else if (this.beginPlayerAction(queued.type)) player.actionQueue = null;
      canAct = !player.action && player.reload <= 0 && player.deflectTime <= 0;
    }
    // One committed intent per frame. Technique wins ties, but primary remains
    // buffered instead of overwriting an action that just spent its cooldown.
    if (canAct && player.techniqueCooldown <= 0 && (this.input.consume("secondary") || this.input.held("secondary"))) {
      this.beginPlayerAction("technique");
    }
    if (!player.action && canAct && (this.input.consume("primary") || this.input.held("primary"))) {
      this.beginPlayerAction("primary");
    }

    let actionMoveScale = 1;
    if (player.action) {
      const primaryScales = { chainblade: 0.96, repeater: 1, maul: 0.80, prism: 0.93 };
      const techniqueScales = { chainblade: 0.86, repeater: 0.90, maul: 0.68, prism: 0.88 };
      actionMoveScale = player.action.type === "technique"
        ? techniqueScales[run.weaponId] || 0.84
        : primaryScales[run.weaponId] || 0.92;
    }
    if (player.reload > 0) actionMoveScale *= 0.94;
    if (player.hurtTime > 0) actionMoveScale *= 0.55;
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
    if (move.length > 0 && Math.hypot(player.vx, player.vy) > 34 && player.stepTimer <= 0) {
      player.stepTimer = tier.id === "crushing" ? 0.22 : 0.17;
      audioCall("step", { x: player.x, heavy: tier.id === "crushing", volume: 0.55 });
    }
  }

  movePlayer(dx, dy) {
    const player = this.run.player;
    const result = moveCircleWithSliding(
      player,
      dx,
      dy,
      this.collisionObstacles(),
      playerViewportBounds(this.encounter.bounds),
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
      if (heat) {
        heat.timer = 0;
        heat.hitTimer = 0;
        heat.safeIndex = 0;
        heat.tellActive = true;
        heat.active = false;
      }
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
      if (pointInCone(player, action.angle, range, arc, center, radius)) this.damageRoomObstacle(obstacle, damage, "melee");
    }
    for (const hazard of this.encounter.hazards) {
      if (!hazard.alive && hazard.type === "interactive_spore_pod") continue;
      const center = hazard.center || (hazard.rect ? rectCenter(hazard.rect) : null);
      if (!center || !["interactive_spore_pod", "boss_quench_valve"].includes(hazard.type)) continue;
      const radius = hazard.radius || (hazard.rect ? Math.hypot(hazard.rect.w, hazard.rect.h) * 0.5 : 4);
      if (pointInCone(player, action.angle, range, arc, center, radius)) this.hitRoomHazard(hazard, "melee");
    }
  }

  cycleWeapon() {
    const unlocked = (this.meta.unlockedWeapons || ["chainblade"]).filter((id) => Content.WEAPONS[id]);
    if (unlocked.length < 2) return;
    const player = this.run.player;
    if (player.action) return;
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
    const savedAmmo = Number(saved.ammo);
    player.ammo = weapon.resource?.type === "magazine"
      ? clamp(Number.isFinite(savedAmmo) ? savedAmmo : weapon.resource.capacity, 0, weapon.resource.capacity)
      : (saved.ammo ?? Infinity);
    player.reload = Math.max(0, Number(saved.reload) || 0);
    player.impactCharge = Math.max(0, Number(saved.impactCharge) || 0);
    player.action = null;
    player.actionQueue = null;
    this.bot.weaponsUsed.add(this.run.weaponId);
    audioCall("weaponSwap", { weapon: this.run.weaponId });
    this.ui.toast?.(`${weapon.name} readied`);
  }

  beginReload() {
    const player = this.run.player;
    const weapon = Content.WEAPONS[this.run.weaponId];
    if (player.action || weapon.resource?.type !== "magazine" || player.reload > 0 || player.ammo >= weapon.resource.capacity) return;
    player.reload = weapon.resource.reload || 0.9;
    player.action = null;
    audioCall("reload", { stage: "start" });
  }

  beginPlayerAction(type) {
    const run = this.run;
    const player = run.player;
    const weapon = Content.WEAPONS[run.weaponId];
    const part = type === "technique" ? weapon.technique : weapon.primary;
    if (!part) return false;
    if (type === "technique" && player.techniqueCooldown > 0) return false;
    if (type === "primary" && weapon.resource?.type === "magazine" && player.ammo <= 0) {
      audioCall("empty");
      this.beginReload();
      return false;
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
      startedAt: this.time,
      totalDuration: (startup + active + recovery) * speedScale,
      hitConfirmed: false,
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
    player.driveIdle = 0;
    player.invuln = Math.min(player.invuln, 0.12);
    return true;
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
    if (action.phase === "startup") {
      const tracking = this.run.weaponId === "maul" ? 8 : 18;
      action.angle += clamp(angleDiff(this.run.player.aim, action.angle), -tracking * dt, tracking * dt);
    }
    action.time -= dt;
    let guard = 0;
    while (this.run.player.action === action && action.time <= 0 && guard < 4) {
      guard += 1;
      const overflow = action.time;
      if (action.phase === "startup") {
        action.phase = "active";
        action.time = action.active + overflow;
        this.resolvePlayerAction(action);
      } else if (action.phase === "active") {
        action.phase = "recovery";
        action.time = action.recovery + overflow;
      } else {
        this.run.player.action = null;
      }
    }
  }

  resolvePlayerAction(action) {
    const run = this.run;
    const player = run.player;
    const weapon = Content.WEAPONS[run.weaponId];
    const pattern = action.part.pattern;
    const damageScale = action.damageScale || 1;
    const variant = { chainblade: 0, repeater: 1, maul: 2, prism: 3 }[run.weaponId] || 0;
    const rangedRelease = !pattern.includes("melee") && ["automatic_projectile", "ricochet_projectile", "charged_pin_projectile"].includes(pattern);
    if (pattern !== "place_shot_splitter") {
      audioCall(rangedRelease ? "shoot" : "melee", {
        weapon: run.weaponId,
        variant,
        heavy: run.weaponId === "maul" || action.type === "technique",
        x: player.x,
      });
    }
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
      const desired = { x: player.x + offset.x, y: player.y + offset.y };
      const placed = this.encounter.nav.projectToWalkable(desired, 18) || desired;
      this.encounter.prisms.push({ uid: `prism:${this.time}`, x: placed.x, y: placed.y, r: 4, life: action.part.life || 6, angle: action.angle + Math.PI / 2 });
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
      if (enemy.dead || enemy.state === "enter" || action.hitIds.has(enemy.uid)) continue;
      if (!pointInCone(player, action.angle, range, arc, enemy, enemy.r)) continue;
      action.hitIds.add(enemy.uid);
      hitAny = true;
      action.hitConfirmed = true;
      this.damageEnemy(enemy, this.modifyPlayerDamage(damage, { ...options, primary: action.type === "primary" }), poise, {
        source: "melee",
        heavy: options.heavy || this.run.weaponId === "maul",
        technique: action.type === "technique",
        comboStep: action.step,
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
    this.encounter.effects.push({
      type: "slash", x: player.x, y: player.y, x2: player.x + end.x, y2: player.y + end.y,
      angle: action.angle, arc, r: range, time: 0.12, maxTime: 0.12,
      color: hitAny ? COLORS.white : Content.WEAPONS[this.run.weaponId].color,
      heavy: options.heavy || this.run.weaponId === "maul",
    });
    if (hitAny) audioCall("hit", { weapon: this.run.weaponId, x: player.x, heavy: options.heavy || this.run.weaponId === "maul" });
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
      .filter((enemy) => !enemy.dead && enemy.state !== "enter"
        && pointInCone(player, action.angle, range, 20, enemy, enemy.r)
        && this.encounter.nav.hasLineOfSight(player, enemy, 1.5))
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
    player.recoil = this.run.weaponId === "prism" ? 1 : 0.65;
    this.shake = Math.max(this.shake, this.run.weaponId === "prism" ? 0.65 : 0.35);
    const muzzle = vecFromAngle(baseAngle, 8);
    this.encounter.effects.push({
      type: "muzzle", x: player.x + muzzle.x, y: player.y + muzzle.y,
      angle: baseAngle, time: 0.055, maxTime: 0.055,
      color: Content.WEAPONS[this.run.weaponId].color,
    });
    for (let index = 0; index < 3; index += 1) {
      const sparkAngle = baseAngle + Math.PI + this.run.rng.range(-0.55, 0.55);
      const speed = this.run.rng.range(18, 36);
      this.spawnParticle(player.x + muzzle.x, player.y + muzzle.y, COLORS.white, 0.09, Math.cos(sparkAngle) * speed, Math.sin(sparkAngle) * speed, 1);
    }
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
      pullDistance: projectile.pullDistance,
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
      if (enemy.dead || enemy.state === "enter" || enemy.crushedDashSerial === player.dashSerial) continue;
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
      enemy.hitReaction = Math.max(0, (enemy.hitReaction || 0) - dt);
      enemy.hitKick = Math.max(0, (enemy.hitKick || 0) - dt * 18);
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
        if (enemy.stateTime <= 0) {
          enemy.state = "move";
          enemy.cooldown = Math.max(enemy.cooldown, enemy.boss ? 0.38 : 0.48);
          this.spawnBurst(enemy.x, enemy.y, enemy.def.color, enemy.boss ? 14 : 5);
        }
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

    const personalSpace = enemy.r + player.r + (ranged ? 5 : 2.5);
    if (distance < personalSpace) {
      const pressure = clamp((personalSpace - distance) / Math.max(1, personalSpace), 0, 1);
      desired = normalizeVector(
        desired.x - toPlayer.x * (1.4 + pressure * 2.2) + -toPlayer.y * enemy.side * 0.45,
        desired.y - toPlayer.y * (1.4 + pressure * 2.2) + toPlayer.x * enemy.side * 0.45,
        -toPlayer.x,
        -toPlayer.y,
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
      const railPattern = /king_hammer_rail|hammer_line_then_cross/.test(attack.pattern || "");
      const range = railPattern ? (attack.range || 150) : this.enemyAttackRange(attack);
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
    if (/copy_last_player_action/.test(attack.pattern || "")) {
      timeline.tell = Math.max(timeline.tell, attack.replayDelay || 0);
    }
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
    enemy.telegraphTargets = null;
    enemy.cageGap = null;
    enemy.cageCenter = null;
    enemy.stepAnchors = null;
    enemy.ringGaps = null;
    enemy.mirrorAims = null;
    enemy.barrierRects = null;
    enemy.burrowCenter = null;
    enemy.copiedWeaponId = null;
    enemy.sidestepPath = null;
    enemy.jabOrigin = null;
    if (/lob_interactive_mine|seed_mortar|crucible_toss/.test(attack.pattern || "")) {
      enemy.telegraphTargets = Array.from({ length: attack.count || 1 }, (_, index) => index === 0
        ? { ...target }
        : {
            x: target.x + this.run.rng.range(-20, 20),
            y: target.y + this.run.rng.range(-20, 20),
          });
    }
    if (/prism_cage/.test(attack.pattern || "")) {
      enemy.cageGap = this.run.rng.int(0, 3);
      enemy.cageCenter = this.encounter.nav.projectToWalkable(target, 24) || { ...target };
    }
    if (/glass_step/.test(attack.pattern || "")) {
      const anchors = this.encounter.spawnPoints.filter((point) => dist(point, player) > 32);
      const count = Math.max(1, attack.repeats || 1);
      const shuffled = this.run.rng.shuffle(anchors.length ? anchors : this.encounter.spawnPoints);
      enemy.stepAnchors = Array.from({ length: count }, (_, index) => {
        const point = shuffled[index % shuffled.length];
        return this.encounter.nav.projectToWalkable(point, 30) || { ...point };
      });
    }
    if (/halo_burst/.test(attack.pattern || "")) {
      enemy.ringGaps = Array.from({ length: attack.rings || 2 }, () => this.run.rng.int(0, Math.max(0, (attack.countPerRing || 8) - 1)));
    } else if (/root_burrow_rush/.test(attack.pattern || "")) {
      enemy.ringGaps = [this.run.rng.int(0, Math.max(0, (attack.ringCount || 11) - 1))];
      enemy.burrowCenter = this.encounter.nav.projectToWalkable(target, 36) || { ...target };
    } else if (/hammer_combo_ring/.test(attack.pattern || "")) {
      enemy.ringGaps = [this.run.rng.int(0, Math.max(0, (attack.finalRingCount || 14) - 1))];
    }
    if (/clone_lances/.test(attack.pattern || "")) {
      enemy.mirrorAims = (enemy.mirrors || []).map((mirror) => angleBetween(mirror, target));
    }
    if (/spawn_barrier|barrier_cross/.test(attack.pattern || "")) {
      const center = this.encounter.nav.projectToWalkable(target, 24) || { ...target };
      const horizontal = this.run.rng.chance();
      const barrier = attack.barrier || {};
      const longSide = barrier.w || 44;
      const shortSide = barrier.h || 6;
      const w = horizontal ? longSide : shortSide;
      const h = horizontal ? shortSide : longSide;
      enemy.barrierRects = [{ x: center.x - w / 2, y: center.y - h / 2, w, h }];
    }
    if (/copy_last_player_action/.test(attack.pattern || "")) {
      enemy.copiedWeaponId = this.run.weaponId;
    }
    if (/sidestep_jab/.test(attack.pattern || "")) {
      const anchors = [];
      let cursor = { x: enemy.x, y: enemy.y, r: enemy.r };
      for (let index = 0; index < (attack.sidesteps || 3); index += 1) {
        const side = index % 2 === 0 ? enemy.side : -enemy.side;
        const moved = moveCircleWithSliding(
          cursor,
          -Math.sin(enemy.aim) * side * 7,
          Math.cos(enemy.aim) * side * 7,
          this.collisionObstacles(),
          this.encounter.bounds,
        );
        cursor = { x: moved.x, y: moved.y, r: enemy.r };
        anchors.push({ x: moved.x, y: moved.y });
      }
      enemy.sidestepPath = anchors;
      enemy.jabOrigin = anchors.at(-1) || { x: enemy.x, y: enemy.y };
    }
    enemy.tokenHeld = tokenCost;
    enemy.activeResolved = false;
    enemy.crossFired = false;
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
      const projected = enemy.burrowCenter || enemy.lockedTarget;
      this.spawnBurst(enemy.x, enemy.y, enemy.def.color, 12);
      if (projected) {
        enemy.x = projected.x;
        enemy.y = projected.y;
      }
      const ringAttack = {
        ...enemy.attack,
        damage: enemy.attack.emergeDamage || enemy.attack.damage || 18,
        projectileRange: 72,
        safeGaps: Math.max(1, Math.round((enemy.attack.safeGap || 60) / (360 / (enemy.attack.ringCount || 11)))),
        safeGapIndex: enemy.ringGaps?.[0],
      };
      this.enemyRing(enemy, ringAttack, enemy.attack.ringCount || 11, enemy.attack.ringSpeed || 58);
      if (dist(enemy, this.run.player) < enemy.r + this.run.player.r + 10) {
        this.damagePlayer(enemy.attack.emergeDamage || 18, { source: enemy, angle: angleBetween(enemy, this.run.player), kind: "burrow" });
      }
      enemy.activeResolved = true;
      this.spawnBurst(enemy.x, enemy.y, enemy.def.color, 18);
      return;
    }
    if (/blink|glass_step/.test(pattern)) {
      const anchors = this.encounter.spawnPoints.filter((point) => dist(point, this.run.player) > 32);
      const point = enemy.stepAnchors?.[0] || this.run.rng.pick(anchors) || { x: enemy.x, y: enemy.y };
      if (point) {
        this.spawnBurst(enemy.x, enemy.y, enemy.def.color, 8);
        enemy.x = point.x;
        enemy.y = point.y;
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
    if (pattern === "steal_then_flee") {
      const velocity = vecFromAngle(enemy.aim, enemy.attack.speed || 110);
      enemy.vx = velocity.x;
      enemy.vy = velocity.y;
    }
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
          const point = enemy.stepAnchors?.[enemy.shotsFired] || this.run.rng.pick(anchors) || enemy;
          if (point) {
            this.spawnBurst(enemy.x, enemy.y, enemy.def.color, 7);
            enemy.x = point.x;
            enemy.y = point.y;
          }
        }
        for (let index = 0; index < (attack.crossCount || 4); index += 1) {
          const angle = index / (attack.crossCount || 4) * TAU + (enemy.shotsFired % 2 ? Math.PI / 4 : 0);
          this.enemyAimedShot(enemy, attack, angle, { speed: attack.projectileSpeed || 86, maxDistance: 76 });
        }
        enemy.shotsFired += 1;
      }
      return;
    }

    if (pattern === "king_hammer_rail" || pattern === "hammer_line_then_cross") {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        const length = attack.range || 150;
        const a = { x: enemy.x, y: enemy.y };
        const b = { x: enemy.x + Math.cos(enemy.aim) * length, y: enemy.y + Math.sin(enemy.aim) * length };
        const width = (attack.lineWidth || 14) / 2;
        if (distancePointSegment(this.run.player, a, b).distance <= this.run.player.r + width) {
          this.damagePlayer(attack.lineDamage || attack.damage || 21, { source: enemy, angle: enemy.aim, kind: "hammer-rail" });
        }
        this.encounter.effects.push({ type: "strike_line", ...a, x2: b.x, y2: b.y, width: attack.lineWidth || 14, time: 0.18, color: enemy.def.color });
        this.shake = Math.max(this.shake, 3);
      }
      if (!enemy.crossFired && elapsed >= (attack.crossDelay || 0.20)) {
        enemy.crossFired = true;
        for (const side of [-1, 1]) {
          this.enemyAimedShot(enemy, { ...attack, damage: attack.crossDamage || 17 }, enemy.aim + side * Math.PI / 2, {
            speed: attack.crossSpeed || 80,
            kind: "hammer_cross",
            maxDistance: attack.crossRange || 105,
          });
        }
      }
      return;
    }

    if (/bellows_sweep|sweeping_cone/.test(pattern)) {
      const progress = clamp(elapsed / Math.max(0.01, enemy.attackTimeline.active), 0, 1);
      const sweep = degrees(attack.maxSweep || attack.sweep || 90);
      const sweepAngle = enemy.aim - sweep / 2 + sweep * progress;
      if (!enemy.activeResolved && pointInCone(enemy, sweepAngle, attack.range || 58, attack.arc || 65, this.run.player, this.run.player.r)
        && (!attack.blockedByObstacles || this.encounter.nav.hasLineOfSight(enemy, this.run.player))) {
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
        const anchor = enemy.sidestepPath?.[enemy.activeBeat];
        if (anchor) {
          enemy.x = anchor.x;
          enemy.y = anchor.y;
        }
        enemy.activeBeat += 1;
      }
      if (enemy.activeBeat >= steps && !enemy.activeResolved && elapsed >= steps * interval) {
        enemy.activeResolved = true;
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
        const velocity = vecFromAngle(enemy.aim, attack.speed || 112);
        enemy.vx = velocity.x;
        enemy.vy = velocity.y;
      }
      if (/stepped_shield_bash/.test(pattern)) {
        const beat = Math.min(attack.advanceBeats || 3, Math.floor(elapsed / 0.09) + 1);
        if (beat > enemy.activeBeat) {
          enemy.activeBeat = beat;
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
        const landed = this.damagePlayer(attack.damage || 12, { source: enemy, angle: enemy.aim, kind: "melee" });
        if (landed && pattern === "steal_then_flee" && this.run.cargo.length) {
          const stolen = [...this.run.cargo].sort((a, b) => b.weight - a.weight)[0];
          stolen.sealed = true;
          this.ui.toast?.(`${stolen.name} sealed — kill the Confiscator!`);
        }
      }
      return;
    }

    if (/melee_arc|sidestep_jab|sweeping_cone|shield_bash|hammer_line|bellows_sweep/.test(pattern)) {
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
      if (!enemy.activeResolved && elapsed >= enemy.attackTimeline.active * 0.72) {
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
        if (/prism_cage/.test(pattern)) {
          const center = enemy.cageCenter || enemy.lockedTarget;
          const gap = Number.isInteger(enemy.cageGap) ? enemy.cageGap : this.run.rng.int(0, 3);
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
          const walls = enemy.barrierRects || [];
          walls.forEach((wall, index) => this.encounter.barriers.push({
            ...wall,
            id: `barrier:${this.time}:${index}`,
            life: attack.barrier?.life || attack.barrierLife || 5,
            hp: attack.barrier?.hp || attack.barrierHp || 45,
            slow: attack.barrier?.slow || 0,
            solid: true,
            reflect: false,
            color: enemy.def.color,
          }));
        }
        this.rebuildNavigation();
      }
      return;
    }

    if (/reinforcement_channel/.test(pattern)) {
      if (!enemy.activeResolved && elapsed > Math.min(0.7, enemy.attackTimeline.active * 0.75)) {
        enemy.activeResolved = true;
        enemy.reinforcementWaves = (enemy.reinforcementWaves || 0) + 1;
        const reinforcementPool = enemyPoolFor(this.run.roomIndex, this.run.phase)
          .filter((entry) => entry.id !== enemy.id && !entry.elite
            && !(entry.attacks || []).some((candidate) => /reinforcement_channel/.test(candidate.pattern || "")));
        this.spawnBudgetEnemies(attack.reinforcementBudget || 2, reinforcementPool);
      }
      return;
    }

    if (/temporary_weight_beam/.test(pattern)) {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        const beamRange = attack.range || 78;
        const beamEnd = {
          x: enemy.x + Math.cos(enemy.aim) * beamRange,
          y: enemy.y + Math.sin(enemy.aim) * beamRange,
        };
        const inBeam = distancePointSegment(this.run.player, enemy, beamEnd).distance
          <= this.run.player.r + (attack.lineWidth || 5) / 2;
        if (inBeam && this.encounter.nav.hasLineOfSight(enemy, this.run.player)) {
          const landed = this.damagePlayer(attack.damage || 6, { source: enemy, angle: enemy.aim, kind: "beam" });
          if (landed) this.run.player.lienWeight = Math.max(this.run.player.lienWeight, attack.lienWeight || 12);
        }
        this.encounter.effects.push({ type: "beam", x: enemy.x, y: enemy.y, x2: beamEnd.x, y2: beamEnd.y, time: 0.18, color: "#f0d783" });
      }
      return;
    }

    if (/tether_anchor|hook_pull/.test(pattern)) {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        this.enemyAimedShot(enemy, attack, enemy.aim, {
          kind: "tether",
          speed: attack.projectileSpeed || 95,
          maxDistance: attack.range || attack.tetherRange || 76,
          pullDistance: attack.pullDistance || 15,
        });
      }
      return;
    }

    if (/lob_interactive_mine|seed_mortar|crucible_toss/.test(pattern)) {
      const count = attack.count || 1;
      if (enemy.shotsFired < count && elapsed >= enemy.shotsFired * 0.12) {
        const target = enemy.telegraphTargets?.[enemy.shotsFired] || enemy.lockedTarget;
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
        const ringAttack = {
          ...attack,
          projectileRange: 82,
          safeGaps: Math.max(1, Math.round((attack.safeGap || 55) / (360 / (attack.countPerRing || 8)))),
          angleOffset: enemy.aim * 0.15 + degrees(enemy.shotsFired * (attack.offsetSecondRing || 18)),
        };
        ringAttack.safeGapIndex = enemy.ringGaps?.[enemy.shotsFired];
        const originalAim = enemy.aim;
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
          this.damagePlayer(attack.damage || 22, { source: enemy, angle: angleBetween(enemy, this.run.player), kind: "hammer-combo" });
        }
        this.encounter.effects.push({ type: "impact_ring", x: enemy.x, y: enemy.y, r: radius, time: 0.15, color: enemy.def.color });
        enemy.shotsFired += 1;
        if (enemy.shotsFired === strikes) {
          this.enemyRing(enemy, { ...attack, projectileRange: 78, safeGapIndex: enemy.ringGaps?.[0] }, attack.finalRingCount || 14, attack.finalRingSpeed || 83);
        }
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
      const count = attack.count || attack.lanes || (pattern.includes("pair") ? 2 : 4);
      const interval = attack.interval || 0.11;
      if (enemy.shotsFired < count && elapsed >= enemy.shotsFired * interval) {
        const angle = enemy.aim + (enemy.shotsFired - (count - 1) / 2) * degrees(attack.spread || 3);
        this.enemyAimedShot(enemy, attack, angle, { bounces: pattern.includes("ricochet") ? (attack.reflections || 1) : 0 });
        if (/clone_lances/.test(pattern)) {
          for (const [mirrorIndex, mirror] of (enemy.mirrors || []).entries()) {
            if (mirror.disabled > 0) continue;
            this.enemyAimedShot(enemy, attack, enemy.mirrorAims?.[mirrorIndex] ?? angleBetween(mirror, this.run.player), { origin: mirror, bounces: attack.reflections || 1 });
          }
        }
        enemy.shotsFired += 1;
      }
      return;
    }

    if (/root_wall_wave/.test(pattern)) {
      const waves = attack.waves || 2;
      if (enemy.shotsFired < waves && elapsed >= enemy.shotsFired * (attack.interval || 0.30)) {
        this.enemyFan(enemy, attack, 5, 12, { speed: attack.speed || attack.projectileSpeed || 63, maxDistance: 112 });
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
          this.enemyFan(enemy, attack, attack.finalProjectiles, attack.spread || 12, { speed: attack.projectileSpeed || 74, maxDistance: 88 });
        }
      }
      return;
    }

    if (/copy_last_player_action/.test(pattern)) {
      if (!enemy.activeResolved) {
        enemy.activeResolved = true;
        if (["repeater", "prism"].includes(enemy.copiedWeaponId)) this.enemyFan(enemy, attack, 3, 7);
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
    const travelDistance = options.maxDistance ?? attack.projectileRange ?? this.enemyAttackRange(attack);
    const muzzleDistance = (origin.r || enemy.r) + 2;
    this.spawnProjectile({
      x: origin.x + Math.cos(angle) * muzzleDistance,
      y: origin.y + Math.sin(angle) * muzzleDistance,
      vx: velocity.x,
      vy: velocity.y,
      r: attack.projectileRadius || 1.6,
      damage: attack.damage || 10,
      faction: "enemy",
      color: enemy.def.color || this.encounter.biome.projectile,
      life: Math.max(0.02, (travelDistance - muzzleDistance) / speed),
      bounces: options.bounces || 0,
      kind: options.kind || attack.pattern,
      homing: options.homing || 0,
      source: enemy,
      pullDistance: options.pullDistance,
    });
  }

  enemyFan(enemy, attack, count, spreadDegrees, options = {}) {
    const center = (count - 1) / 2;
    for (let index = 0; index < count; index += 1) {
      this.enemyAimedShot(enemy, attack, enemy.aim + degrees((index - center) * spreadDegrees), options);
    }
  }

  enemyRing(enemy, attack, count, speed) {
    const gap = Number.isInteger(attack.safeGapIndex)
      ? attack.safeGapIndex % Math.max(1, count)
      : this.run.rng.int(0, Math.max(0, count - 1));
    const safeGaps = attack.safeGaps || 0;
    for (let index = 0; index < count; index += 1) {
      if (safeGaps && Math.min((index - gap + count) % count, (gap - index + count) % count) < safeGaps) continue;
      const angle = index / count * TAU + (Number.isFinite(attack.angleOffset) ? attack.angleOffset : enemy.aim * 0.15);
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
    if (enemy.id === "furnace_king" && enemy.phase >= 2) {
      const heat = this.encounter.hazards.find((hazard) => hazard.type === "rotating_safe_grates");
      if (heat) {
        heat.timer = 0;
        heat.hitTimer = 0;
        heat.safeIndex = 0;
        heat.tellActive = true;
        heat.active = false;
      }
    }
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
    const impactAngle = context.angle ?? angleBetween(this.run.player, enemy);
    enemy.flash = context.heavy ? 0.11 : 0.085;
    enemy.hitReaction = context.heavy ? 0.13 : 0.09;
    enemy.hitAngle = impactAngle;
    enemy.hitKick = context.heavy ? 2.8 : context.source === "projectile" ? 1.2 : 1.8;
    const knockDistance = context.heavy ? 8 : context.source === "projectile" ? 2.5 : 4;
    const knock = vecFromAngle(impactAngle, knockDistance);
    if (!enemy.boss) {
      const moved = moveCircleWithSliding(enemy, knock.x, knock.y, this.collisionObstacles(), this.encounter.bounds);
      enemy.x = moved.x;
      enemy.y = moved.y;
    }
    this.onPlayerHitEnemy(enemy, damage, context);
    this.spawnImpact(enemy.x, enemy.y, impactAngle, context.source === "projectile" ? "#f4db9d" : COLORS.white, context.heavy ? 10 : 6, Boolean(context.heavy));
    const hitstopFrames = context.heavy ? 4 : context.comboStep === 2 ? 3 : context.source === "projectile" ? 1 : 2;
    this.addHitstop(hitstopFrames, context.heavy ? 0.15 : 0.055);
    this.shake = Math.max(this.shake, context.heavy ? 2.6 : context.source === "projectile" ? 0.45 : 0.9);
    audioCall(hitsArmor && damage <= 1 ? "block" : "enemyHit", {
      x: enemy.x,
      heavy: Boolean(context.heavy),
      variant: { chainblade: 0, repeater: 1, maul: 2, prism: 3 }[this.run.weaponId] || 0,
    });

    if (enemy.hp <= 0) {
      this.addHitstop(enemy.boss || enemy.elite ? 5 : hitstopFrames + 1, enemy.boss ? 0.32 : 0.18);
      this.killEnemy(enemy, context);
      return true;
    }
    if (enemy.poise <= 0) {
      const interruptedPattern = enemy.attack?.pattern || "";
      const interruptPause = /reinforcement_channel|interruptible_empower/.test(interruptedPattern)
        ? (enemy.attack?.interruptPause || 1.4)
        : 0;
      this.releaseAttackToken(enemy);
      enemy.state = "stunned";
      enemy.stateTime = Math.max(enemy.stateTime || 0, interruptPause || (enemy.boss ? 0.65 : 0.85));
      enemy.poise = enemy.maxPoise;
      enemy.armorBroken = Math.max(enemy.armorBroken || 0, enemy.def.armor ? 2 : 0);
      this.addHitstop(enemy.boss || enemy.elite ? 5 : 4, 0.22);
      this.shake = Math.max(this.shake, enemy.boss ? 3.2 : 2.2);
      this.encounter.effects.push({ type: "impact_ring", x: enemy.x, y: enemy.y, r: enemy.r + 8, time: 0.18, maxTime: 0.18, color: COLORS.gold });
      audioCall("stagger", { enemy: enemy.id, x: enemy.x, heavy: true });
      if (interruptPause) this.ui.toast?.(`${enemy.def.name} CHANNEL BROKEN`);
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
    this.encounter.effects.push({
      type: "impact_ring", x: enemy.x, y: enemy.y,
      r: enemy.boss ? enemy.r + 18 : enemy.r + (enemy.elite ? 11 : 7),
      time: enemy.boss ? 0.36 : 0.20, maxTime: enemy.boss ? 0.36 : 0.20,
      color: enemy.def.color,
    });
    audioCall(enemy.boss ? "explosion" : "execute", { killed: true, enemy: enemy.id, x: enemy.x, heavy: enemy.elite });

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
    if (!enemy.noSplit && deathPattern?.pattern === "split_unless_crushed"
      && !context.reflected && !["melee", "reflected", "dash"].includes(context.source)) {
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

  applyPlayerKnockback(context = {}, distance = 8) {
    const player = this.run.player;
    const angle = Number.isFinite(context.angle)
      ? context.angle
      : context.source
        ? angleBetween(context.source, player)
        : player.aim + Math.PI;
    const knock = vecFromAngle(angle, distance);
    this.movePlayer(knock.x, knock.y);
  }

  damagePlayer(amount, context = {}) {
    const player = this.run.player;
    // The killing blow is the end of the exchange. Hostile projectiles and room
    // hazards may still animate during the clear beat, but they cannot steal the
    // victory after the boss has already fallen.
    const finalWaveDefeated = this.encounter?.enemies?.length > 0
      && !this.encounter.waves?.[this.encounter.waveIndex + 1]
      && this.encounter.enemies.every((enemy) => enemy.dead);
    if (this.encounter?.clear || this.encounter?.boss?.dead || finalWaveDefeated) return false;
    if (this.bot.god) return false;
    if (context.kind !== "projectile" && context.source?.def && player.deflectTime > 0
      && isWithinDeflectCone(player, context.source)) {
      this.deflectEnemy(context.source);
      return false;
    }
    if (player.invuln > 0) return false;
    const damage = Math.max(1, amount);
    player.hp -= damage;
    player.invuln = 0.42;
    player.hurtTime = 0.10;
    player.hurtAngle = Number.isFinite(context.angle)
      ? context.angle
      : context.source ? angleBetween(context.source, player) : player.aim + Math.PI;
    player.action = null;
    player.actionQueue = null;
    player.drive = Math.max(0, player.drive - 18);
    this.encounter.roomDamage += damage;
    this.metrics.damageEvents += 1;
    this.meta.statistics.damageTaken = (this.meta.statistics.damageTaken || 0) + damage;
    this.shake = Math.max(this.shake, 3.2);
    this.addHitstop(2, 0.24);
    this.ui.damageFlash?.();
    audioCall("hurt", { amount: damage, x: player.x });
    this.applyPlayerKnockback(context, 8);
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
    this.run.player.deflectSuccess = 0.16;
    this.addHitstop(3, 0.28);
    this.shake = Math.max(this.shake, 2.2);
    this.spawnImpact(this.run.player.x, this.run.player.y, this.run.player.aim, COLORS.deflect, 14, true);
    this.encounter.effects.push({ type: "impact_ring", x: this.run.player.x, y: this.run.player.y, r: 15, time: 0.18, maxTime: 0.18, color: COLORS.deflect });
    audioCall("perfect", { enemy: enemy.id, x: this.run.player.x, heavy: true });
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
    player.deflectSuccess = 0.16;
    this.addHitstop(3, 0.26);
    this.shake = Math.max(this.shake, 2);
    this.spawnImpact(projectile.x, projectile.y, angle, COLORS.deflect, 10, true);
    this.encounter.effects.push({ type: "impact_ring", x: projectile.x, y: projectile.y, r: 13, time: 0.16, maxTime: 0.16, color: COLORS.deflect });
    audioCall("deflect", { projectile: true, x: projectile.x, heavy: true });
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
          if (player.deflectTime > 0 && projectile.deflectable && isWithinDeflectCone(player, projectile)) {
            projectile.x = playerHit.x;
            projectile.y = playerHit.y;
            this.reflectProjectile(projectile);
          } else {
            const landed = this.damagePlayer(projectile.damage, { source: projectile, angle: Math.atan2(projectile.vy, projectile.vx), kind: "projectile" });
            if (landed && projectile.kind === "tether" && projectile.source && !projectile.source.dead) {
              const pull = normalizeVector(projectile.source.x - player.x, projectile.source.y - player.y);
              const pullDistance = projectile.pullDistance || 15;
              this.movePlayer(pull.x * pullDistance, pull.y * pullDistance);
              player.status.tethered = 1.2;
            }
            if (landed && /slow_orb/.test(projectile.kind || "")) player.status.slowed = 1.6;
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
          if (enemy.dead || enemy.state === "enter" || projectile.hitIds.has(enemy.uid)) continue;
          const hit = sweptProjectileHit({ x: projectile.px, y: projectile.py }, projectile, projectile.r, enemy);
          if (!hit) continue;
          const landed = this.damageEnemy(enemy, projectile.damage, projectile.poise, {
            source: "projectile",
            technique: projectile.kind === "pin",
            reflected: Boolean(projectile.reflected),
            projectile,
            angle: Math.atan2(projectile.vy, projectile.vx),
          });
          if (!landed) continue;
          projectile.hitIds.add(enemy.uid);
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
          const ascentSpeed = this.run.phase === "ascent" ? (hazard.ascentSpeedMultiplier || 1) : 1;
          const lengths = path.map((point, index) => dist(point, path[(index + 1) % path.length]));
          const totalLength = lengths.reduce((sum, length) => sum + length, 0);
          hazard.travelled += (hazard.speed || 40) * ascentSpeed * (hazard.directionSign || 1) * dt;
          let wrappedDistance = ((hazard.travelled % totalLength) + totalLength) % totalLength;
          let index = 0;
          while (index < lengths.length - 1 && wrappedDistance > lengths[index]) {
            wrappedDistance -= lengths[index];
            index += 1;
          }
          const nextIndex = (index + 1) % path.length;
          const t = lengths[index] > 0 ? wrappedDistance / lengths[index] : 0;
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
        const tellDuration = hazard.tell || 0.55;
        const activeDuration = Math.min(0.65, step * 0.25);
        hazard.safeIndex = safeIndex;
        hazard.tellActive = withinStep < tellDuration;
        hazard.active = withinStep >= tellDuration && withinStep < tellDuration + activeDuration;
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
          if (enemy.dead || enemy.state === "enter" || effect.hitIds.has(enemy.uid) || distSq(effect, enemy) > (effect.r + enemy.r) ** 2) continue;
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
    let living = encounter.enemies.filter((enemy) => !enemy.dead);
    const bossAlive = Boolean(encounter.boss && !encounter.boss.dead);
    encounter.hunterCooldown = Math.max(0, (encounter.hunterCooldown || 0) - dt);

    // Attention punishes disengagement with a new tactical role, never raw damage scaling.
    const attacking = this.run.player.driveIdle < 0.7;
    const attentionMultiplier = cargoEffects(this.run, "attention_gain_multiplier").reduce((value, effect) => value * (effect.value || 1), hasTechnique(this.run, "cursed_dividend") ? 1.25 : 1);
    if (!bossAlive && encounter.time >= 4 && living.length > 0) {
      encounter.attention = clamp(encounter.attention + dt * (attacking ? -7 : (this.run.phase === "ascent" ? 9 : 6)) * attentionMultiplier, 0, 100);
    }

    const nextWave = encounter.waves[encounter.waveIndex + 1];
    const batchGapReady = encounter.time - (encounter.lastMaterializeTime ?? -Infinity) >= 0.75;
    let spawnedBatch = false;
    if (nextWave) {
      const condition = nextWave.startWhen || {};
      const threshold = condition.remainingAtMost ?? 0;
      const firstWave = encounter.waveIndex < 0;
      const after = firstWave
        ? Math.max(encounter.waveDelay || 0.55, nextWave.delay || 0)
        : condition.after ?? nextWave.delay ?? 0.25;
      const noMaterializingEnemies = living.every((enemy) => enemy.state !== "enter");
      const timeoutReady = encounter.time >= after && living.length <= threshold + 2 && noMaterializingEnemies;
      const ready = firstWave
        ? encounter.time >= after
        : (living.length <= threshold || timeoutReady) && encounter.time >= 0.35;
      if (ready && batchGapReady) {
        this.spawnNextWave();
        spawnedBatch = true;
      }
    }

    if (!spawnedBatch && !nextWave && !bossAlive && encounter.attention >= 100 && encounter.hunterCooldown <= 0
      && !encounter.hunterSpawned && batchGapReady && living.every((enemy) => enemy.state !== "enter")) {
      encounter.attention = 34;
      encounter.hunterCooldown = 25;
      encounter.hunterSpawned = true;
      const pool = enemyPoolFor(this.run.roomIndex, this.run.phase).filter((enemy) => /hound|skitter|lancer|riveter|counterfeit|confiscator/.test(enemy.id));
      const spawned = this.spawnBudgetEnemies(2 + Math.floor(this.run.roomIndex / 7), pool.length ? pool : null);
      if (spawned > 0) {
        this.ui.toast?.("THE ABYSS SENDS A HUNTER");
        audioCall("enemyTell", { hunter: true });
      }
    }

    living = encounter.enemies.filter((enemy) => !enemy.dead);
    const unspawnedWave = encounter.waves[encounter.waveIndex + 1];
    if (!unspawnedWave && living.length === 0 && !encounter.clear) {
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
      .filter((enemy) => !enemy.dead && enemy.state !== "enter")
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
    const visibleCombatants = [player, ...this.encounter.enemies.filter((enemy) => !enemy.dead && enemy.state !== "enter")];
    this.ui.updateHud?.({
      player: { hp: player.hp, maxHp: player.maxHp, dashCharge, x: player.x, y: player.y },
      combatNearTop: visibleCombatants.some((combatant) => combatant.y < 34),
      combatNearBottom: visibleCombatants.some((combatant) => combatant.y > 146),
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
    this.impactFlash = Math.max(0, this.impactFlash - dt * 5.5);
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

  spawnImpact(x, y, angle, color, count = 8, heavy = false) {
    const visualRng = this.run?.rng || new SeededRng(1);
    for (let index = 0; index < count; index += 1) {
      const side = visualRng.chance() ? Math.PI / 2 : -Math.PI / 2;
      const sparkAngle = angle + side + visualRng.range(-0.72, 0.72);
      const speed = visualRng.range(heavy ? 28 : 18, heavy ? 76 : 48);
      this.spawnParticle(
        x, y, color, visualRng.range(heavy ? 0.18 : 0.12, heavy ? 0.42 : 0.28),
        Math.cos(sparkAngle) * speed, Math.sin(sparkAngle) * speed,
        visualRng.chance(heavy ? 0.38 : 0.16) ? 2 : 1,
      );
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
    this.renderEnemyTelegraphs(ctx);
    this.renderEffects(ctx);
    for (const barrier of encounter.barriers) this.renderBarrier(ctx, barrier);
    for (const prism of encounter.prisms) this.renderPrism(ctx, prism);
    for (const projectile of encounter.projectiles) this.renderer.drawProjectile({ ...projectile, hostile: projectile.faction === "enemy", tail: projectile.kind.includes("lance") ? 7 : 4 });
    for (const enemy of encounter.enemies) this.renderEnemy(ctx, enemy);
    this.renderPlayer(ctx);
    this.renderer.drawParticles(encounter.particles);
    ctx.restore();
    if (this.impactFlash > 0) {
      ctx.globalAlpha = Math.min(0.12, this.impactFlash * 0.32);
      ctx.fillStyle = COLORS.white;
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
      ctx.globalAlpha = 1;
    }
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

  renderEnemyTelegraphs(ctx) {
    const player = this.run.player;
    for (const enemy of this.encounter.enemies) {
      if (enemy.dead) continue;
      if (enemy.state === "enter") {
        const total = enemy.boss ? 0.85 : enemySpawnMaterializeTime(enemy.def);
        const progress = 1 - clamp(enemy.stateTime / total, 0, 1);
        const radius = enemy.r + 8 - progress * 3;
        ctx.globalAlpha = 0.18 + progress * 0.38;
        ctx.strokeStyle = enemy.boss ? COLORS.danger : enemy.def.color;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(Math.round(enemy.x), Math.round(enemy.y), Math.round(radius), 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = enemy.def.color;
        const cross = Math.max(2, Math.round(4 - progress * 2));
        ctx.fillRect(Math.round(enemy.x - cross), Math.round(enemy.y), cross * 2 + 1, 1);
        ctx.fillRect(Math.round(enemy.x), Math.round(enemy.y - cross), 1, cross * 2 + 1);
        ctx.globalAlpha = 1;
        continue;
      }
      if (enemy.state !== "tell" || !enemy.attack || !enemy.attackTimeline) continue;

      const attack = enemy.attack;
      const pattern = attack.pattern || "";
      const railPattern = /king_hammer_rail|hammer_line_then_cross/.test(pattern);
      const progress = 1 - clamp(enemy.stateTime / Math.max(0.001, enemy.attackTimeline.tell), 0, 1);
      const hot = progress >= 0.68;
      const returnable = /mine|crucible|spore|rivet/.test(pattern);
      const color = returnable ? COLORS.deflect : hot ? COLORS.danger : COLORS.gold;
      const range = /pounce_pair/.test(pattern)
        ? Math.max(attack.range || 0, (attack.speed || enemy.def.speed * 2.5) * enemy.attackTimeline.active)
        : railPattern ? (attack.range || 150) : this.enemyAttackRange(attack);
      const target = enemy.lockedTarget || {
        x: enemy.x + Math.cos(enemy.aim) * range,
        y: enemy.y + Math.sin(enemy.aim) * range,
      };
      const end = {
        x: enemy.x + Math.cos(enemy.aim) * range,
        y: enemy.y + Math.sin(enemy.aim) * range,
      };
      const pulse = 0.55 + (Math.floor(this.time * (hot ? 24 : 12)) % 2) * 0.25;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = (0.22 + progress * 0.28) * pulse;

      if (/root_burrow_rush/.test(pattern)) {
        const center = enemy.burrowCenter || enemy.lockedTarget || target;
        const count = attack.ringCount || 11;
        const safeGaps = Math.max(1, Math.round((attack.safeGap || 60) / (360 / count)));
        const gap = enemy.ringGaps?.[0] ?? 0;
        ctx.beginPath();
        ctx.arc(Math.round(center.x), Math.round(center.y), Math.round(enemy.r + player.r + 10), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.76;
        ctx.stroke();
        for (let index = 0; index < count; index += 1) {
          if (Math.min((index - gap + count) % count, (gap - index + count) % count) < safeGaps) continue;
          const angle = index / count * TAU + enemy.aim * 0.15;
          ctx.beginPath();
          ctx.moveTo(Math.round(center.x + Math.cos(angle) * 12), Math.round(center.y + Math.sin(angle) * 12));
          ctx.lineTo(Math.round(center.x + Math.cos(angle) * 72), Math.round(center.y + Math.sin(angle) * 72));
          ctx.stroke();
        }
      } else if (/glass_step/.test(pattern)) {
        const crossCount = attack.crossCount || 4;
        for (const [stepIndex, anchor] of (enemy.stepAnchors || [target]).entries()) {
          ctx.beginPath();
          ctx.arc(Math.round(anchor.x), Math.round(anchor.y), 7, 0, TAU);
          ctx.stroke();
          for (let index = 0; index < crossCount; index += 1) {
            const angle = index / crossCount * TAU + (stepIndex % 2 ? Math.PI / 4 : 0);
            ctx.beginPath();
            ctx.moveTo(Math.round(anchor.x), Math.round(anchor.y));
            ctx.lineTo(Math.round(anchor.x + Math.cos(angle) * 76), Math.round(anchor.y + Math.sin(angle) * 76));
            ctx.stroke();
          }
        }
      } else if (/prism_cage/.test(pattern)) {
        const center = enemy.cageCenter || target;
        const walls = [
          { x: center.x - 24, y: center.y - 20, w: 48, h: 4 },
          { x: center.x - 24, y: center.y + 16, w: 48, h: 4 },
          { x: center.x - 24, y: center.y - 16, w: 4, h: 32 },
          { x: center.x + 20, y: center.y - 16, w: 4, h: 32 },
        ];
        walls.forEach((wall, index) => {
          if (index === enemy.cageGap) return;
          ctx.fillRect(Math.round(wall.x), Math.round(wall.y), Math.round(wall.w), Math.round(wall.h));
        });
        ctx.globalAlpha = 0.9;
        const gapWall = walls[enemy.cageGap ?? 0];
        ctx.strokeRect(Math.round(gapWall.x), Math.round(gapWall.y), Math.round(gapWall.w), Math.round(gapWall.h));
      } else if (/spawn_barrier|barrier_cross/.test(pattern)) {
        for (const wall of enemy.barrierRects || []) {
          ctx.globalAlpha = 0.2 + progress * 0.34;
          ctx.fillRect(Math.round(wall.x), Math.round(wall.y), Math.round(wall.w), Math.round(wall.h));
          ctx.globalAlpha = 0.82;
          ctx.strokeRect(Math.round(wall.x), Math.round(wall.y), Math.round(wall.w), Math.round(wall.h));
        }
      } else if (/thorn_lash/.test(pattern)) {
        const lashRange = 36;
        const lashArc = degrees((attack.arc || 80) + 48);
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
        ctx.arc(Math.round(enemy.x), Math.round(enemy.y), lashRange, enemy.aim - lashArc / 2, enemy.aim + lashArc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.76;
        ctx.stroke();
        const projectileCount = attack.finalProjectiles || 0;
        const projectileCenter = (projectileCount - 1) / 2;
        for (let index = 0; index < projectileCount; index += 1) {
          const angle = enemy.aim + degrees((index - projectileCenter) * (attack.spread || 12));
          ctx.beginPath();
          ctx.moveTo(Math.round(enemy.x + Math.cos(angle) * lashRange), Math.round(enemy.y + Math.sin(angle) * lashRange));
          ctx.lineTo(Math.round(enemy.x + Math.cos(angle) * 88), Math.round(enemy.y + Math.sin(angle) * 88));
          ctx.stroke();
        }
      } else if (/root_wall_wave/.test(pattern)) {
        const waveRange = 112;
        const waveArc = degrees(48);
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
        ctx.arc(Math.round(enemy.x), Math.round(enemy.y), waveRange, enemy.aim - waveArc / 2, enemy.aim + waveArc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.76;
        ctx.stroke();
      } else if (/halo_burst/.test(pattern)) {
        const count = attack.countPerRing || 8;
        const safeGaps = Math.max(1, Math.round((attack.safeGap || 55) / (360 / count)));
        for (let ring = 0; ring < (attack.rings || 2); ring += 1) {
          const gap = enemy.ringGaps?.[ring] ?? 0;
          const offset = degrees((attack.offsetSecondRing || 18) * ring) + enemy.aim * 0.15;
          for (let index = 0; index < count; index += 1) {
            if (Math.min((index - gap + count) % count, (gap - index + count) % count) < safeGaps) continue;
            const angle = index / count * TAU + offset;
            ctx.beginPath();
            ctx.moveTo(Math.round(enemy.x + Math.cos(angle) * (enemy.r + 3)), Math.round(enemy.y + Math.sin(angle) * (enemy.r + 3)));
            ctx.lineTo(Math.round(enemy.x + Math.cos(angle) * 82), Math.round(enemy.y + Math.sin(angle) * 82));
            ctx.stroke();
          }
        }
      } else if (/copy_last_player_action/.test(pattern)) {
        if (["repeater", "prism"].includes(enemy.copiedWeaponId)) {
          for (let index = 0; index < 3; index += 1) {
            const angle = enemy.aim + degrees((index - 1) * 7);
            ctx.beginPath();
            ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
            ctx.lineTo(Math.round(enemy.x + Math.cos(angle) * range), Math.round(enemy.y + Math.sin(angle) * range));
            ctx.stroke();
          }
        } else {
          const arc = degrees(110);
          ctx.beginPath();
          ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
          ctx.arc(Math.round(enemy.x), Math.round(enemy.y), 28, enemy.aim - arc / 2, enemy.aim + arc / 2);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.76;
          ctx.stroke();
        }
      } else if (/aimed_burst|predictive_pair/.test(pattern)) {
        const count = attack.count || (pattern.includes("pair") ? 2 : 4);
        for (let index = 0; index < count; index += 1) {
          const angle = enemy.aim + degrees((index - (count - 1) / 2) * (attack.spread || 3));
          ctx.beginPath();
          ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
          ctx.lineTo(Math.round(enemy.x + Math.cos(angle) * range), Math.round(enemy.y + Math.sin(angle) * range));
          ctx.stroke();
        }
      } else if (/refraction_lance|clone_lances|mirrored_ricochet_pair/.test(pattern)) {
        const count = attack.count || attack.lanes || (pattern.includes("pair") ? 2 : 3);
        const offsets = Array.isArray(attack.angles)
          ? attack.angles
          : Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * (attack.spread || 3));
        for (const offset of offsets) {
          const angle = enemy.aim + degrees(offset);
          ctx.beginPath();
          ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
          ctx.lineTo(Math.round(enemy.x + Math.cos(angle) * range), Math.round(enemy.y + Math.sin(angle) * range));
          ctx.stroke();
        }
        if (/clone_lances/.test(pattern)) {
          for (const [mirrorIndex, mirror] of (enemy.mirrors || []).entries()) {
            if (mirror.disabled > 0) continue;
            const angle = enemy.mirrorAims?.[mirrorIndex] ?? angleBetween(mirror, target);
            ctx.beginPath();
            ctx.moveTo(Math.round(mirror.x), Math.round(mirror.y));
            ctx.lineTo(Math.round(mirror.x + Math.cos(angle) * range), Math.round(mirror.y + Math.sin(angle) * range));
            ctx.stroke();
          }
        }
      } else if (railPattern) {
        const sideRange = attack.crossRange || 105;
        const sideX = -Math.sin(enemy.aim) * sideRange;
        const sideY = Math.cos(enemy.aim) * sideRange;
        ctx.lineWidth = Math.max(4, Math.round(attack.lineWidth || 14));
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
        ctx.lineTo(Math.round(end.x), Math.round(end.y));
        ctx.stroke();
        ctx.globalAlpha = 0.76;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x - sideX), Math.round(enemy.y - sideY));
        ctx.lineTo(Math.round(enemy.x + sideX), Math.round(enemy.y + sideY));
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (/hammer_combo_ring/.test(pattern)) {
        ctx.globalAlpha = 0.28 + progress * 0.34;
        ctx.lineWidth = hot ? 2 : 1;
        for (let strike = 0; strike < (attack.strikes || 3); strike += 1) {
          ctx.beginPath();
          ctx.arc(Math.round(enemy.x), Math.round(enemy.y), 22 + strike * 4, 0, TAU);
          ctx.stroke();
        }
        const count = attack.finalRingCount || 14;
        const gap = enemy.ringGaps?.[0] ?? 0;
        const safeGaps = attack.safeGaps || 0;
        for (let index = 0; index < count; index += 1) {
          if (safeGaps && Math.min((index - gap + count) % count, (gap - index + count) % count) < safeGaps) continue;
          const angle = index / count * TAU + enemy.aim * 0.15;
          ctx.beginPath();
          ctx.moveTo(Math.round(enemy.x + Math.cos(angle) * 32), Math.round(enemy.y + Math.sin(angle) * 32));
          ctx.lineTo(Math.round(enemy.x + Math.cos(angle) * 78), Math.round(enemy.y + Math.sin(angle) * 78));
          ctx.stroke();
        }
      } else if (/bellows_sweep|sweeping_cone/.test(pattern)) {
        const sweepCoverage = degrees((attack.arc || 65) + (attack.maxSweep || attack.sweep || 90));
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
        ctx.arc(Math.round(enemy.x), Math.round(enemy.y), Math.round(range), enemy.aim - sweepCoverage / 2, enemy.aim + sweepCoverage / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.75;
        ctx.stroke();
      } else if (/offset_ring|magnetic_pull_burst/.test(pattern)) {
        ctx.globalAlpha = 0.24 + progress * 0.34;
        ctx.lineWidth = hot ? 2 : 1;
        ctx.beginPath();
        ctx.arc(Math.round(enemy.x), Math.round(enemy.y), Math.round(range), 0, TAU);
        ctx.stroke();
        const spokes = attack.count || attack.burstCount || 10;
        for (let spoke = 0; spoke < spokes; spoke += 1) {
          const angle = spoke / spokes * TAU + enemy.aim * 0.15;
          ctx.beginPath();
          ctx.moveTo(Math.round(enemy.x + Math.cos(angle) * (enemy.r + 3)), Math.round(enemy.y + Math.sin(angle) * (enemy.r + 3)));
          ctx.lineTo(Math.round(enemy.x + Math.cos(angle) * Math.min(range, 34)), Math.round(enemy.y + Math.sin(angle) * Math.min(range, 34)));
          ctx.stroke();
        }
      } else if (/rivet_fan|projectile_fan/.test(pattern)) {
        const fanArc = degrees(attack.arc || (attack.spread || 10) * Math.max(1, (attack.count || 3) - 1));
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
        ctx.arc(Math.round(enemy.x), Math.round(enemy.y), Math.round(range), enemy.aim - fanArc / 2, enemy.aim + fanArc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.78;
        ctx.stroke();
      } else if (/sidestep_jab/.test(pattern)) {
        ctx.globalAlpha = 0.58;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
        for (const anchor of enemy.sidestepPath || []) ctx.lineTo(Math.round(anchor.x), Math.round(anchor.y));
        ctx.stroke();
        ctx.setLineDash([]);
        const origin = enemy.jabOrigin || enemy;
        const jabArc = degrees(70);
        ctx.globalAlpha = 0.22 + progress * 0.36;
        ctx.beginPath();
        ctx.moveTo(Math.round(origin.x), Math.round(origin.y));
        ctx.arc(Math.round(origin.x), Math.round(origin.y), Math.round(attack.range || 15), enemy.aim - jabArc / 2, enemy.aim + jabArc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.78;
        ctx.stroke();
      } else if (/charge|leap|pounce|rush|shield_bash|steal_then_flee/.test(pattern)) {
        ctx.lineWidth = Math.max(3, Math.round(enemy.r * 2 + player.r * 1.5));
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
        ctx.lineTo(Math.round(end.x), Math.round(end.y));
        ctx.stroke();
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
        ctx.lineTo(Math.round(end.x), Math.round(end.y));
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (/melee|jab|sweep|bash/.test(pattern)) {
        const arc = degrees(attack.arc || (pattern.includes("sweep") ? 90 : 105));
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
        ctx.arc(Math.round(enemy.x), Math.round(enemy.y), Math.round(range), enemy.aim - arc / 2, enemy.aim + arc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.72;
        ctx.beginPath();
        ctx.arc(Math.round(enemy.x), Math.round(enemy.y), Math.round(range), enemy.aim - arc / 2, enemy.aim + arc / 2);
        ctx.stroke();
      } else if (/mortar|pod|crucible_toss|lob_interactive_mine|cage/.test(pattern)) {
        const radius = attack.blastRadius || attack.poolRadius || attack.radius || (pattern.includes("cage") ? 24 : 17);
        for (const warningTarget of enemy.telegraphTargets || [target]) {
          ctx.beginPath();
          ctx.arc(Math.round(warningTarget.x), Math.round(warningTarget.y), Math.round(radius), 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 0.8;
          ctx.stroke();
        }
      } else if (/cage|ring|halo|burst/.test(pattern) && attack.blastRadius) {
        const radius = attack.blastRadius || attack.radius || (pattern.includes("cage") ? 24 : 16);
        ctx.beginPath();
        ctx.arc(Math.round(target.x), Math.round(target.y), Math.round(radius), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.stroke();
      } else if (/empower|link|barrier|channel|blink/.test(pattern)) {
        ctx.globalAlpha = 0.34 + progress * 0.3;
        ctx.beginPath();
        ctx.arc(Math.round(enemy.x), Math.round(enemy.y), Math.round(enemy.r + 5 + progress * 3), 0, TAU);
        ctx.stroke();
      } else {
        ctx.lineWidth = /beam|lance/.test(pattern) ? Math.max(2, Math.round(attack.lineWidth || (pattern.includes("beam") ? 5 : 3))) : 1;
        ctx.setLineDash(hot ? [] : [4, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(enemy.x), Math.round(enemy.y));
        ctx.lineTo(Math.round(end.x), Math.round(end.y));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      }

      if (hot && !/empower|link|barrier|channel|hammer_combo|magnetic|offset_ring|copy_last_player_action|aimed_burst|predictive_pair|sidestep_jab|fan|bellows|sweeping_cone|crucible_toss|mortar|glass_step|thorn_lash|root_wall_wave|halo_burst|refraction_lance|clone_lances/.test(pattern)) {
        ctx.globalAlpha = 0.9;
        ctx.fillRect(Math.round(target.x - 3), Math.round(target.y), 7, 1);
        ctx.fillRect(Math.round(target.x), Math.round(target.y - 3), 1, 7);
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
    }
  }

  renderEffects(ctx) {
    for (const effect of this.encounter.effects) {
      if (effect.type === "player_afterimage") {
        const alpha = clamp(effect.time / Math.max(0.001, effect.maxTime || 0.13), 0, 1) * 0.42;
        this.renderer.drawPixelEntity({
          sprite: PLAYER_SPRITE,
          x: effect.x,
          y: effect.y,
          drawSize: 15,
          facing: effect.angle,
          alpha,
          shadow: false,
          scaleX: 1.16,
          scaleY: 0.82,
        });
      } else if (effect.type === "slash") {
        const maxTime = effect.maxTime || 0.12;
        const progress = 1 - clamp(effect.time / maxTime, 0, 1);
        const radius = effect.r || Math.hypot(effect.x2 - effect.x, effect.y2 - effect.y);
        const arc = degrees(effect.arc || 85);
        const start = effect.angle - arc * 0.58;
        const end = start + arc * (0.42 + progress * 0.72);
        ctx.strokeStyle = effect.color;
        for (let trail = 0; trail < 3; trail += 1) {
          ctx.globalAlpha = clamp(effect.time / maxTime, 0, 1) * (0.82 - trail * 0.22);
          ctx.lineWidth = effect.heavy && trail === 0 ? 3 : trail === 0 ? 2 : 1;
          ctx.beginPath();
          ctx.arc(Math.round(effect.x), Math.round(effect.y), Math.max(4, Math.round(radius - trail * 3)), start, end - trail * 0.08);
          ctx.stroke();
        }
        const tip = vecFromAngle(end, radius);
        ctx.globalAlpha = clamp(effect.time / maxTime, 0, 1);
        ctx.fillStyle = COLORS.white;
        ctx.fillRect(Math.round(effect.x + tip.x - 1), Math.round(effect.y + tip.y - 1), effect.heavy ? 3 : 2, effect.heavy ? 3 : 2);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
      } else if (effect.type === "muzzle") {
        const alpha = clamp(effect.time / Math.max(0.001, effect.maxTime || 0.055), 0, 1);
        const length = 4 + alpha * 3;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = COLORS.white;
        ctx.save();
        ctx.translate(Math.round(effect.x), Math.round(effect.y));
        ctx.rotate(effect.angle || 0);
        ctx.fillRect(0, -1, Math.round(length), 3);
        ctx.fillStyle = effect.color;
        ctx.fillRect(1, -3, 2, 7);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (effect.type === "deflect_arc") {
        const alpha = clamp(effect.time / Math.max(0.001, effect.maxTime || 0.13), 0, 1);
        ctx.globalAlpha = 0.35 + alpha * 0.5;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = alpha > 0.65 ? 2 : 1;
        ctx.beginPath();
        ctx.arc(Math.round(effect.x), Math.round(effect.y), effect.r || 11, effect.angle - degrees(DEFLECT_HALF_ARC), effect.angle + degrees(DEFLECT_HALF_ARC));
        ctx.stroke();
        ctx.globalAlpha = 1;
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
      } else if (effect.type === "impact_ring") {
        const maxTime = effect.maxTime || 0.18;
        const progress = 1 - clamp(effect.time / maxTime, 0, 1);
        ctx.globalAlpha = (1 - progress) * 0.8;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = progress < 0.5 ? 2 : 1;
        ctx.beginPath();
        ctx.arc(Math.round(effect.x), Math.round(effect.y), Math.max(2, Math.round((effect.r || 12) * (0.2 + progress * 0.8))), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
      } else if (["mine", "damage_zone", "hostile_zone", "slow_zone", "blast"].includes(effect.type)) {
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
    const reaction = clamp((enemy.hitReaction || 0) / (enemy.boss ? 0.13 : 0.10), 0, 1);
    const tellPulse = enemy.state === "tell" ? 1 + Math.sin(this.time * 28) * 0.025 : 1;
    const offsetX = Math.cos(enemy.hitAngle || 0) * (enemy.hitKick || 0);
    const offsetY = Math.sin(enemy.hitAngle || 0) * (enemy.hitKick || 0);
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
      offsetX,
      offsetY,
      rotation: reaction * 0.10 * signOr(Math.cos(enemy.hitAngle || 0)),
      scaleX: tellPulse * (1 + reaction * 0.15),
      scaleY: tellPulse * (1 - reaction * 0.14),
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
      ctx.fillStyle = urgency > 0.62 ? COLORS.danger : COLORS.gold;
      const tellWidth = Math.max(3, Math.round(3 + urgency * 5));
      ctx.fillRect(Math.round(enemy.x - tellWidth / 2), Math.round(enemy.y - size / 2 - 5), tellWidth, urgency > 0.68 ? 2 : 1);
    } else if (enemy.state === "recover") {
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = COLORS.white;
      ctx.fillRect(Math.round(enemy.x - 2), Math.round(enemy.y - size / 2 - 5), 5, 1);
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

  renderPlayerCargo(ctx, player, offsetX = 0, offsetY = 0) {
    if (this.run.phase !== "ascent" || this.run.carriedWeight <= 0) return;
    const count = clamp(Math.ceil(this.run.carriedWeight / 32), 1, 3);
    const back = player.aim + Math.PI;
    const sideX = -Math.sin(back);
    const sideY = Math.cos(back);
    const baseX = player.x + offsetX + Math.cos(back) * 5;
    const baseY = player.y + offsetY + Math.sin(back) * 5;
    ctx.strokeStyle = "#c49a55";
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.moveTo(Math.round(player.x + offsetX), Math.round(player.y + offsetY));
    ctx.lineTo(Math.round(baseX + Math.cos(back) * (count - 1) * 3), Math.round(baseY + Math.sin(back) * (count - 1) * 3));
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (let index = count - 1; index >= 0; index -= 1) {
      const stagger = (index % 2 ? 1 : -1) * Math.min(2, index);
      const x = Math.round(baseX + Math.cos(back) * index * 3 + sideX * stagger);
      const y = Math.round(baseY + Math.sin(back) * index * 3 + sideY * stagger);
      ctx.fillStyle = "#1d1511";
      ctx.fillRect(x - 2, y - 3, 5, 7);
      ctx.fillStyle = index === 0 ? "#b17a3c" : index === 1 ? "#d0a04f" : "#76502d";
      ctx.fillRect(x - 1, y - 2, 3, 5);
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(x, y - 3, 1, 1);
    }
  }

  renderPlayerWeapon(ctx, player, weapon, bodyX, bodyY, action) {
    const melee = /melee|hook|ground_cone/.test(action?.part?.pattern || "") || ["chainblade", "maul"].includes(this.run.weaponId);
    const side = action?.step % 2 === 1 ? -1 : 1;
    let angle = action?.angle ?? player.aim;
    let recoil = player.recoil || 0;
    if (action) {
      const duration = Math.max(0.001, action[action.phase] || 0.1);
      const progress = 1 - clamp(action.time / duration, 0, 1);
      if (melee) {
        if (action.phase === "startup") angle += side * lerp(0.18, -0.82, progress);
        else if (action.phase === "active") angle += side * lerp(-0.82, 0.72, progress);
        else angle += side * lerp(0.72, 0.16, progress);
      } else if (action.phase === "active" || action.phase === "recovery") {
        recoil = Math.max(recoil, (1 - progress) * 1.2);
      }
    }

    ctx.save();
    ctx.translate(
      Math.round(bodyX + Math.cos(angle) * (2 - recoil * 1.5)),
      Math.round(bodyY + Math.sin(angle) * (2 - recoil * 1.5)),
    );
    ctx.rotate(angle);
    if (this.run.weaponId === "chainblade") {
      ctx.fillStyle = "#171b20";
      ctx.fillRect(1, -2, 13, 4);
      ctx.fillStyle = weapon.color;
      ctx.fillRect(2, -1, 11, 2);
      ctx.fillStyle = "#f7f2dc";
      ctx.fillRect(4, -1, 8, 1);
      ctx.fillStyle = "#b88948";
      for (let tooth = 5; tooth < 13; tooth += 3) ctx.fillRect(tooth, 1, 1, 2);
    } else if (this.run.weaponId === "repeater") {
      ctx.fillStyle = "#171b20";
      ctx.fillRect(1, -3, 11, 6);
      ctx.fillRect(4, 2, 3, 4);
      ctx.fillStyle = weapon.color;
      ctx.fillRect(2, -2, 8, 4);
      ctx.fillStyle = "#f8dd9a";
      ctx.fillRect(5, -1, 7, 1);
      ctx.fillStyle = "#6f472b";
      ctx.fillRect(5, 2, 2, 3);
    } else if (this.run.weaponId === "maul") {
      ctx.fillStyle = "#171b20";
      ctx.fillRect(0, -2, 12, 4);
      ctx.fillRect(9, -5, 7, 10);
      ctx.fillStyle = "#8b6338";
      ctx.fillRect(1, -1, 10, 2);
      ctx.fillStyle = weapon.color;
      ctx.fillRect(10, -4, 5, 8);
      ctx.fillStyle = "#fff1b7";
      ctx.fillRect(11, -3, 1, 6);
    } else {
      ctx.fillStyle = "#111923";
      ctx.fillRect(-2, -2, 14, 5);
      ctx.fillRect(1, 2, 3, 4);
      ctx.fillRect(10, -1, 4, 2);
      ctx.fillStyle = weapon.color;
      ctx.fillRect(0, -1, 11, 3);
      ctx.fillRect(6, -2, 3, 5);
      ctx.fillStyle = "#e8ffff";
      ctx.fillRect(7, -1, 2, 3);
      ctx.fillRect(10, 0, 4, 1);
      ctx.fillStyle = "#6f472b";
      ctx.fillRect(1, 2, 2, 3);
      ctx.fillStyle = "#35475a";
      ctx.fillRect(-2, -1, 3, 3);
    }
    ctx.fillStyle = "#e7c49d";
    ctx.fillRect(1, -1, 2, 2);
    ctx.restore();
  }

  renderPlayer(ctx) {
    const player = this.run.player;
    const weapon = Content.WEAPONS[this.run.weaponId];
    const speed = Math.hypot(player.vx, player.vy);
    const moving = speed > 18 && player.dashTime <= 0;
    const bob = moving ? (Math.floor(this.time * 14) % 2 ? 0 : -1) : 0;
    const action = player.action;
    let offsetX = -Math.cos(player.aim) * (player.recoil || 0) * 1.5;
    let offsetY = bob - Math.sin(player.aim) * (player.recoil || 0) * 1.5;
    let rotation = clamp(player.vx / PLAYER_SPEED, -1, 1) * 0.045;
    let scaleX = 1;
    let scaleY = 1;
    if (action) {
      const duration = Math.max(0.001, action[action.phase] || 0.1);
      const progress = 1 - clamp(action.time / duration, 0, 1);
      if (action.phase === "startup") {
        offsetX -= Math.cos(action.angle) * progress;
        offsetY -= Math.sin(action.angle) * progress;
        scaleY = 1 + progress * 0.04;
      } else if (action.phase === "active") {
        offsetX += Math.cos(action.angle) * 2;
        offsetY += Math.sin(action.angle) * 2;
        scaleX = 1.09;
        scaleY = 0.91;
      } else {
        offsetX += Math.cos(action.angle) * (1 - progress) * 1.5;
        offsetY += Math.sin(action.angle) * (1 - progress) * 1.5;
      }
    }
    if (player.hurtTime > 0) {
      const hurt = clamp(player.hurtTime / 0.10, 0, 1);
      offsetX += Math.cos(player.hurtAngle || 0) * hurt * 2;
      offsetY += Math.sin(player.hurtAngle || 0) * hurt * 2;
      rotation += signOr(Math.cos(player.hurtAngle || 0)) * hurt * 0.12;
      scaleX = 1.12;
      scaleY = 0.88;
    }

    this.renderPlayerCargo(ctx, player, offsetX, offsetY);
    this.renderer.drawPixelEntity({
      sprite: PLAYER_SPRITE,
      x: player.x,
      y: player.y,
      r: player.r,
      drawSize: 15,
      facing: player.aim,
      color: COLORS.player,
      shadowColor: "#111419",
      offsetX,
      offsetY,
      rotation,
      scaleX,
      scaleY,
      invulnerableFlash: player.invuln > 0 && Math.floor(player.invuln * 30) % 2 === 0,
    });
    const bodyX = player.x + offsetX;
    const bodyY = player.y + offsetY;
    this.renderPlayerWeapon(ctx, player, weapon, bodyX, bodyY, action);
    if (player.deflectTime > 0) {
      ctx.strokeStyle = COLORS.deflect;
      ctx.globalAlpha = player.deflectPerfectTime > 0 ? 1 : 0.62;
      ctx.lineWidth = player.deflectPerfectTime > 0 ? 2 : 1;
      ctx.beginPath();
      ctx.arc(Math.round(bodyX), Math.round(bodyY), player.deflectSuccess > 0 ? 12 : 10, player.aim - degrees(DEFLECT_HALF_ARC), player.aim + degrees(DEFLECT_HALF_ARC));
      ctx.stroke();
      ctx.globalAlpha = 1;
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
