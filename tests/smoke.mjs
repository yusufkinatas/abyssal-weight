#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASE_WORLD,
  BIOMES,
  BOSSES,
  CARGO,
  ENEMIES,
  META_UPGRADES,
  ROOMS,
  TECHNIQUES,
  WEAPONS,
} from "../src/data.js";
import { SeededRng, hashSeed } from "../src/rng.js";
import {
  circleAABBPenetration,
  isCircleValid,
  isPointValid,
  moveCircleWithSliding,
  sweptProjectileHit,
} from "../src/collision.js";
import { NavGrid } from "../src/navigation.js";
import { ActionInput } from "../src/input.js";
import * as RuntimeCombat from "../src/runtime.js";
import { AbyssalWeightGame } from "../src/game.js";

const { ActionRuntime } = RuntimeCombat;

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tests = [];
const metrics = {
  rooms: ROOMS.length,
  routes: 0,
  spawnPoints: 0,
  enemies: Object.keys(ENEMIES).length,
  bosses: Object.keys(BOSSES).length,
  weapons: Object.keys(WEAPONS).length,
  techniques: TECHNIQUES.length,
  cargo: CARGO.length,
  metaUpgrades: Object.keys(META_UPGRADES).length,
};

function test(name, run) {
  tests.push({ name, run });
}

function assert(condition, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message = "Values differ") {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function deepEqual(actual, expected, message = "Values differ") {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: expected ${right}, received ${left}`);
}

function uniqueIds(collection, label) {
  const ids = collection.map((entry) => entry?.id);
  assert(ids.every((id) => typeof id === "string" && id.length > 0), `${label} contains a missing id`);
  equal(new Set(ids).size, ids.length, `${label} ids must be unique`);
}

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function javascriptFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "assets", "tests", "node_modules"].includes(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(absolute));
    else if (entry.isFile() && [".js", ".mjs"].includes(extname(entry.name))) files.push(absolute);
  }
  return files;
}

function entityForGroup(group, context) {
  const references = Number(Boolean(group.enemy)) + Number(Boolean(group.boss));
  equal(references, 1, `${context} must reference exactly one enemy or boss`);
  if (group.enemy) {
    assert(ENEMIES[group.enemy], `${context} references unknown enemy ${group.enemy}`);
    return ENEMIES[group.enemy];
  }
  assert(BOSSES[group.boss], `${context} references unknown boss ${group.boss}`);
  return BOSSES[group.boss];
}

function collectReferenceErrors(value, path = "data", errors = []) {
  if (!value || typeof value !== "object") return errors;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectReferenceErrors(entry, `${path}[${index}]`, errors));
    return errors;
  }
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (key === "enemy" && typeof entry === "string" && !ENEMIES[entry]) {
      errors.push(`${entryPath} -> ${entry}`);
    }
    if (key === "boss" && typeof entry === "string" && !BOSSES[entry]) {
      errors.push(`${entryPath} -> ${entry}`);
    }
    if (key === "enemyPool" && Array.isArray(entry)) {
      entry.forEach((id) => {
        if (!ENEMIES[id]) errors.push(`${entryPath} -> ${id}`);
      });
    }
    collectReferenceErrors(entry, entryPath, errors);
  }
  return errors;
}

test("content has three five-room biomes and the complete 15-depth route", () => {
  equal(ROOMS.length, 15, "The run must contain exactly 15 authored rooms");
  equal(BIOMES.length, 3, "The run must contain exactly three biomes");
  uniqueIds(ROOMS, "Rooms");
  uniqueIds(BIOMES, "Biomes");
  deepEqual(ROOMS.map((room) => room.index), Array.from({ length: 15 }, (_, index) => index), "Room indices");
  deepEqual(ROOMS.map((room) => room.depth), Array.from({ length: 15 }, (_, index) => index + 1), "Room depths");

  for (const biome of BIOMES) {
    equal(biome.rooms.length, 5, `${biome.id} must own five rooms`);
    const authored = ROOMS.filter((room) => room.biome === biome.id).map((room) => room.index);
    deepEqual(authored, biome.rooms, `${biome.id} room mapping`);
    assert(BOSSES[biome.boss], `${biome.id} references unknown boss ${biome.boss}`);
  }

  const bossRooms = ROOMS.filter((room) => room.boss).map((room) => room.index);
  deepEqual(bossRooms, [4, 9, 14], "Boss rooms must close each five-room biome");
});

test("all 30 descent/ascent wave routes are populated and references resolve", () => {
  const routes = [];
  const referencedEnemies = new Set();
  const referencedBosses = new Set();

  for (const room of ROOMS) {
    for (const phase of ["descent", "ascent"]) {
      const waves = room[`${phase}Waves`];
      const routeName = `${room.id}:${phase}`;
      routes.push(routeName);
      assert(Array.isArray(waves) && waves.length > 0, `${routeName} needs at least one wave`);
      for (const [waveIndex, wave] of waves.entries()) {
        assert(Array.isArray(wave.groups) && wave.groups.length > 0, `${routeName} wave ${waveIndex} needs groups`);
        for (const [groupIndex, group] of wave.groups.entries()) {
          const context = `${routeName} wave ${waveIndex} group ${groupIndex}`;
          entityForGroup(group, context);
          const count = Number(group.count);
          assert(Number.isInteger(count) && count > 0, `${context} needs a positive integer count`);
          assert(Array.isArray(group.points), `${context} needs authored spawn points`);
          equal(group.points.length, count, `${context} count must match its spawn points`);
          metrics.spawnPoints += group.points.length;
          if (group.enemy) referencedEnemies.add(group.enemy);
          if (group.boss) referencedBosses.add(group.boss);
        }
      }
    }
  }

  metrics.routes = routes.length;
  equal(routes.length, 30, "Fifteen rooms need both descent and ascent routes");
  equal(new Set(routes).size, 30, "Phase route ids must be unique");
  equal(referencedBosses.size, 3, "All three bosses must appear in encounter waves");
  assert(referencedEnemies.size >= 18, `Encounter routes use too little enemy variety (${referencedEnemies.size})`);

  const errors = collectReferenceErrors({ ROOMS, BOSSES, CARGO });
  equal(errors.length, 0, `Unresolved enemy/boss references: ${errors.join(", ")}`);
});

test("enemy and boss combat definitions are actionable", () => {
  uniqueIds(Object.values(ENEMIES), "Enemies");
  uniqueIds(Object.values(BOSSES), "Bosses");
  equal(Object.keys(BOSSES).length, 3, "Each biome needs one boss");

  for (const enemy of Object.values(ENEMIES)) {
    assert(["descent", "ascent"].includes(enemy.faction), `${enemy.id} has invalid faction ${enemy.faction}`);
    assert(enemy.hp > 0 && enemy.speed >= 0 && enemy.radius > 0, `${enemy.id} has invalid core stats`);
    assert(Array.isArray(enemy.attacks) && enemy.attacks.length > 0, `${enemy.id} needs an attack deck`);
    for (const attack of enemy.attacks) {
      assert(attack.pattern && attack.tell >= 0 && attack.recovery >= 0, `${enemy.id}.${attack.id} has an invalid timeline`);
    }
  }

  for (const boss of Object.values(BOSSES)) {
    assert(boss.hp >= 800, `${boss.id} should have boss-scale health`);
    equal(boss.phases?.length, 3, `${boss.id} must have three mechanical phases`);
  }
});

test("boss phases resolve their authored sequence decks in deterministic order", () => {
  const runtime = Object.create(ActionRuntime.prototype);
  const sequencedBosses = new Set();

  for (const boss of Object.values(BOSSES)) {
    equal(boss.phaseThresholds?.length, boss.phases.length - 1, `${boss.id} needs one threshold between each phase`);
    assert(boss.phaseThresholds.every((threshold, index, values) =>
      threshold > 0 && threshold < 1 && (index === 0 || threshold < values[index - 1])),
    `${boss.id} phase thresholds must descend from full health`);

    boss.phases.forEach((phase, phaseIndex) => {
      assert(phase.hpFrom > phase.hpTo, `${boss.id}.${phase.id} must cover a positive health interval`);
      if (phaseIndex > 0) {
        equal(phase.hpFrom, boss.phases[phaseIndex - 1].hpTo, `${boss.id} phases must meet without a health gap`);
      }

      const sequenceGroups = phase.sequenceDeck || (phase.fixedSequence ? [phase.fixedSequence] : []);
      if (!sequenceGroups.length) return;
      sequencedBosses.add(boss.id);
      assert(phase.patterns && Object.keys(phase.patterns).length > 0, `${boss.id}.${phase.id} needs a pattern lookup for its sequence`);
      for (const sequence of sequenceGroups) {
        assert(Array.isArray(sequence) && sequence.length > 1, `${boss.id}.${phase.id} sequences need multiple attacks`);
        for (const key of sequence) {
          assert(phase.patterns[key]?.pattern, `${boss.id}.${phase.id} sequence key ${key} does not resolve to an attack`);
        }
      }

      const enemy = {
        def: boss,
        phase: phaseIndex,
        patternCursor: 0,
        sequenceQueue: [],
        exposed: 0,
      };
      if (phase.sequenceDeck) {
        for (const [sequenceIndex, sequence] of phase.sequenceDeck.entries()) {
          for (const key of sequence) {
            const deck = runtime.bossPatternDeck(enemy);
            equal(deck.length, 1, `${boss.id}.${phase.id} sequence step must yield one attack`);
            equal(deck[0], phase.patterns[key], `${boss.id}.${phase.id} sequence ${sequenceIndex} advanced out of order`);
          }
        }
        if (phase.exposedAfterDeck) {
          equal(enemy.exposeAfterRecovery, phase.exposedAfterDeck,
            `${boss.id}.${phase.id} must schedule its punish window after the completed sequence recovers`);
        }
      } else {
        const expected = [...phase.fixedSequence, ...phase.fixedSequence];
        const actual = expected.map(() => runtime.bossPatternDeck(enemy)[0]);
        deepEqual(actual, expected.map((key) => phase.patterns[key]), `${boss.id}.${phase.id} fixed sequence must loop in order`);
      }
    });
  }

  equal(sequencedBosses.size, Object.keys(BOSSES).length, "Every boss needs at least one ordered late-fight sequence");
});

test("four weapons expose mechanically distinct primary, resource, and technique loops", () => {
  const weapons = Object.values(WEAPONS);
  uniqueIds(weapons, "Weapons");
  equal(weapons.length, 4, "The armory must contain exactly four distinct weapons");

  const signatures = weapons.map((weapon) => [
    weapon.kind,
    weapon.resource?.type,
    weapon.primary?.pattern,
    weapon.technique?.pattern,
  ].join("|"));
  equal(new Set(signatures).size, 4, "Every weapon needs a distinct mechanical signature");
  equal(new Set(weapons.map((weapon) => weapon.primary?.pattern)).size, 4, "Primary patterns must be distinct");
  equal(new Set(weapons.map((weapon) => weapon.technique?.pattern)).size, 4, "Technique patterns must be distinct");
  equal(weapons.filter((weapon) => weapon.starter).length, 1, "Exactly one weapon should be the baseline starter");
  assert(weapons.some((weapon) => weapon.kind.includes("melee")), "The armory needs melee play");
  assert(weapons.some((weapon) => weapon.kind.includes("ranged")), "The armory needs ranged play");

  for (const weapon of weapons) {
    assert(weapon.primary?.timeline?.length > 0, `${weapon.id} primary needs an action timeline`);
    assert(weapon.technique?.timeline?.length > 0, `${weapon.id} technique needs an action timeline`);
  }
});

test("run and meta progression pools retain full-game breadth", () => {
  uniqueIds(TECHNIQUES, "Techniques");
  uniqueIds(CARGO, "Cargo");
  uniqueIds(Object.values(META_UPGRADES), "Meta upgrades");
  assert(TECHNIQUES.length >= 20, `Expected at least 20 Techniques, found ${TECHNIQUES.length}`);
  assert(CARGO.length >= 12, `Expected at least 12 cargo relics, found ${CARGO.length}`);
  assert(Object.keys(META_UPGRADES).length >= 12, `Expected at least 12 meta upgrades, found ${Object.keys(META_UPGRADES).length}`);
  assert(new Set(TECHNIQUES.flatMap((technique) => technique.tags || [])).size >= 10, "Techniques need broad mechanical tags");
  assert(CARGO.some((cargo) => cargo.rarity === "boss"), "Boss cargo rewards are missing");
  assert(Object.values(META_UPGRADES).some((upgrade) => upgrade.effects?.some((effect) => effect.type === "unlock_weapon")), "Meta progression must unlock weapons");
});

test("authored hazards retain at least 16 distinct mechanics with runtime handlers", () => {
  const runtimeSource = read("src/runtime.js");
  const hazards = ROOMS.flatMap((room) => [
    ...(room.hazards || []),
    ...(room.descent?.hazards || []),
    ...(room.ascent?.hazards || []),
  ].map((hazard) => ({ ...hazard, room: room.id, biome: room.biome })));
  const types = new Set(hazards.map((hazard) => hazard.type));

  assert(hazards.every((hazard) => typeof hazard.type === "string" && hazard.type.length > 0), "Every authored hazard needs a type");
  assert(types.size >= 16, `Expected at least 16 distinct hazard mechanics, found ${types.size}`);
  for (const biome of BIOMES) {
    const biomeTypes = new Set(hazards.filter((hazard) => hazard.biome === biome.id).map((hazard) => hazard.type));
    assert(biomeTypes.size >= 4, `${biome.id} needs at least four distinct room mechanics, found ${biomeTypes.size}`);
  }

  for (const type of types) {
    const handlerReference = new RegExp(`["']${escapeRegex(type)}["']`);
    assert(handlerReference.test(runtimeSource), `Hazard type ${type} is authored but never handled by ActionRuntime`);
  }

  const spatiallyUndefined = hazards.filter((hazard) =>
    !hazard.rect && !hazard.center && !hazard.path && !hazard.rects && !hazard.obstacleIds && !hazard.material);
  equal(spatiallyUndefined.length, 0, `Hazards need an authored spatial target: ${spatiallyUndefined.map((hazard) => `${hazard.room}:${hazard.type}`).join(", ")}`);
});

test("every cargo effect is queried by gameplay runtime and respects ascent activation", () => {
  const runtimeSource = read("src/runtime.js");
  const effectTypes = new Set(CARGO.flatMap((cargo) => cargo.effects || []).map((effect) => effect.type));
  assert(effectTypes.size >= 20, `Cargo pool has too few mechanical effect types (${effectTypes.size})`);

  for (const cargo of CARGO) {
    assert(Array.isArray(cargo.effects) && cargo.effects.length > 0, `${cargo.id} needs at least one gameplay effect`);
    assert(cargo.effects.every((effect) => typeof effect.type === "string" && effect.type.length > 0), `${cargo.id} contains an invalid effect`);
  }
  for (const type of effectTypes) {
    const runtimeQuery = new RegExp(`(?:cargoEffects|cargoHasEffect)\\s*\\([^\\n;]*["']${escapeRegex(type)}["']`);
    assert(runtimeQuery.test(runtimeSource), `Cargo effect ${type} is defined but never queried by gameplay runtime`);
  }

  assert(/!cargo\.sealed/.test(runtimeSource), "Sealed cargo must not grant its gameplay effects");
  assert(/!cargo\.ascentActivated\s*\|\|\s*run\.phase\s*===\s*["']ascent["']/.test(runtimeSource),
    "Ascent-activated cargo must remain dormant during descent");
});

test("King's Tithe is available in the Furnace King reward draft", () => {
  const tithe = CARGO.find((cargo) => cargo.id === "kings_tithe");
  const king = BOSSES.furnace_king;
  const forge = ROOMS.find((room) => room.boss === king.id);
  assert(tithe, "King's Tithe cargo is missing");
  equal(tithe.rarity, "legendary", "King's Tithe must remain a legendary boss prize");
  assert(king.rewardCargo?.includes(tithe.id), "Furnace King rewardCargo must include King's Tithe");
  equal(forge?.reward, "boss_cargo", "The Furnace King room must open a boss cargo draft");

  const runtime = Object.create(ActionRuntime.prototype);
  runtime.run = {
    rng: new SeededRng("tithe-reward-smoke"),
    cargo: [],
    techniques: [],
  };
  runtime.meta = { upgrades: {} };
  const draft = runtime.makeRewardChoices(forge);
  assert(draft.some((choice) => choice.id === tithe.id), "The live Furnace King draft must offer King's Tithe");
  deepEqual(
    [...new Set(draft.map((choice) => choice.id))].sort(),
    [...new Set(king.rewardCargo)].sort(),
    "Boss draft must resolve the king's authored cargo pool",
  );
});

test("room geometry is connected and every authored spawn has a legal NavGrid route", () => {
  const failures = [];
  const bounds = BASE_WORLD.bounds;

  for (const room of ROOMS) {
    for (const obstacle of room.obstacles) {
      if (!(obstacle.w > 0 && obstacle.h > 0)) failures.push(`${room.id}:${obstacle.id} has invalid dimensions`);
      if (obstacle.x < bounds.x || obstacle.y < bounds.y
        || obstacle.x + obstacle.w > bounds.x + bounds.w
        || obstacle.y + obstacle.h > bounds.y + bounds.h) {
        failures.push(`${room.id}:${obstacle.id} leaves world bounds`);
      }
    }

    for (const [name, point] of [["entry", room.entry], ["descentExit", room.descentExit], ["ascentExit", room.ascentExit]]) {
      if (!isPointValid(point, bounds, room.obstacles)) failures.push(`${room.id}:${name} is blocked`);
    }

    const nav = new NavGrid({ bounds, obstacles: room.obstacles, cellSize: 2, clearance: 0 });
    const connectivity = nav.validateConnectivity();
    if (!connectivity.valid) failures.push(`${room.id} has ${connectivity.disconnected.length} disconnected navigation cells`);

    for (const phase of ["descent", "ascent"]) {
      const origin = phase === "descent" ? room.entry : room.descentExit;
      const exit = phase === "descent" ? room.descentExit : room.ascentExit;
      const routePoints = [exit];
      const spawnEntries = [];
      for (const wave of room[`${phase}Waves`]) {
        for (const group of wave.groups) {
          const entity = entityForGroup(group, `${room.id}:${phase}`);
          for (const point of group.points) {
            routePoints.push(point);
            spawnEntries.push({ point, entity });
          }
        }
      }

      const validation = nav.validateReachability(origin, routePoints);
      if (!validation.valid) {
        const points = validation.unreachable.map((entry) => entry.point || entry);
        failures.push(`${room.id}:${phase} has unreachable points ${JSON.stringify(points)}`);
      }

      for (const { point, entity } of spawnEntries) {
        const spawnCircle = { x: point.x, y: point.y, r: entity.radius };
        if (!isCircleValid(spawnCircle, bounds, room.obstacles)) {
          failures.push(`${room.id}:${phase} ${entity.id} spawn ${JSON.stringify(point)} overlaps geometry at radius ${entity.radius}`);
        }
      }
    }
  }

  equal(failures.length, 0, `Geometry validation failed:\n- ${failures.join("\n- ")}`);
});

test("seeded RNG is deterministic, restorable, and isolated", () => {
  equal(hashSeed({ b: 2, a: 1 }), hashSeed({ a: 1, b: 2 }), "Object seed hashing must be key-order stable");
  const first = new SeededRng("abyssal-smoke-seed");
  const second = new SeededRng("abyssal-smoke-seed");
  const sequenceA = Array.from({ length: 32 }, () => first.next());
  const sequenceB = Array.from({ length: 32 }, () => second.next());
  deepEqual(sequenceA, sequenceB, "Equal seeds must reproduce equal streams");
  assert(sequenceA.every((value) => value >= 0 && value < 1), "RNG values must remain in [0, 1)");

  const different = new SeededRng("another-seed");
  assert(sequenceA.some((value) => value !== different.next()), "Different seeds should not produce the same stream");

  const restorable = new SeededRng(42);
  Array.from({ length: 7 }, () => restorable.next());
  const checkpoint = restorable.state;
  const expectedTail = Array.from({ length: 12 }, () => restorable.next());
  restorable.restore(checkpoint);
  deepEqual(Array.from({ length: 12 }, () => restorable.next()), expectedTail, "Restoring state must reproduce the tail");

  const source = [1, 2, 3, 4, 5, 6];
  const shuffledA = new SeededRng("shuffle").shuffle(source);
  const shuffledB = new SeededRng("shuffle").shuffle(source);
  deepEqual(shuffledA, shuffledB, "Seeded shuffles must be deterministic");
  deepEqual(source, [1, 2, 3, 4, 5, 6], "Default shuffle must not mutate its input");
});

test("circle collision preserves tangential motion while blocking penetration", () => {
  const wall = { x: 50, y: 20, w: 10, h: 60 };
  const moved = moveCircleWithSliding(
    { x: 40, y: 30, r: 5 },
    20,
    20,
    [wall],
    { x: 0, y: 0, w: 100, h: 100 },
  );
  assert(moved.collided, "Diagonal motion should collide with the wall");
  assert(moved.x <= 45 + 1e-7, `Circle crossed the wall face (x=${moved.x})`);
  assert(moved.y >= 49.9, `Tangential motion was lost (y=${moved.y})`);
  assert(!circleAABBPenetration(moved, wall), "Sliding result must not penetrate the wall");
  assert(moved.normals.some((normal) => normal.x < -0.99), "Expected an outward wall normal");

  const swept = sweptProjectileHit(
    { x: 10, y: 50 },
    { x: 90, y: 50 },
    1,
    { x: 55, y: 50, r: 4 },
  );
  assert(swept && swept.t > 0 && swept.t < 1, "Fast projectiles need swept collision hits");
});

test("same-frame technique intent wins without primary overwriting the action", () => {
  const buffered = new Set(["secondary", "primary"]);
  const actionStarts = [];
  const runtime = Object.create(ActionRuntime.prototype);
  runtime.time = 1;
  runtime.meta = {
    upgrades: {},
    statistics: { peakDrive: 0 },
  };
  runtime.run = {
    phase: "descent",
    weaponId: "chainblade",
    techniques: [],
    cargo: [],
    carriedWeight: 0,
    alternatingStacks: 0,
    alternatingTimer: 0,
    player: {
      x: 160,
      y: 90,
      r: 3.6,
      vx: 0,
      vy: 0,
      aim: 0,
      lastMove: { x: 1, y: 0 },
      invuln: 0,
      dashCooldown: 0,
      deflectCooldown: 0,
      deflectTime: 0,
      techniqueCooldown: 0,
      combo: 0,
      comboTimer: 0,
      drive: 0,
      driveIdle: 0,
      empowered: 0,
      empoweredCharges: 0,
      hurtTime: 0,
      lienWeight: 0,
      status: {},
      ammo: Infinity,
      reload: 0,
      dashTime: 0,
      relicCooldown: 0,
      mirrorCooldown: 0,
      flywheelCooldown: 0,
      impactCharge: 0,
      action: null,
    },
  };
  runtime.encounter = {
    biome: BIOMES[0],
    bounds: BASE_WORLD.bounds,
    hazards: [],
    obstacles: [],
    barriers: [],
    effects: [],
    enemies: [],
    projectiles: [],
  };
  runtime.input = {
    pointer: { active: false, x: 160, y: 90 },
    consume(action) {
      if (!buffered.has(action)) return false;
      buffered.delete(action);
      return true;
    },
    held: () => false,
  };
  runtime.movePlayer = () => {};
  runtime.beginPlayerAction = (type) => {
    actionStarts.push(type);
    runtime.run.player.action = { type };
  };

  runtime.updatePlayer(1 / 60);

  deepEqual(actionStarts, ["technique"], "Primary intent must not replace a technique started in the same simulation step");
  const queuedPrimary = runtime.run.player.actionQueue?.type === "primary";
  assert(buffered.has("primary") || queuedPrimary,
    "Lower-priority primary intent should remain buffered or queued for the next legal action window");
});

test("hitstop freezes simulation without consuming buffered combat input", () => {
  const input = {
    remaining: 0.05,
    tickCalls: 0,
    endCalls: 0,
    tick(dt) {
      this.tickCalls += 1;
      this.remaining = Math.max(0, this.remaining - dt);
    },
    consume: () => false,
    endStep() {
      this.endCalls += 1;
    },
  };
  const runtime = Object.create(ActionRuntime.prototype);
  runtime.time = 0;
  runtime.metrics = { frames: 0 };
  runtime.input = input;
  runtime.run = {};
  runtime.encounter = { particles: [] };
  runtime.bot = { enabled: false };
  runtime.scene = "playing";
  runtime.hitstop = 3;

  runtime.step(1 / 60);
  runtime.step(1 / 60);
  runtime.step(1 / 60);

  equal(input.remaining, 0.05, "Buffered input lifetime must not elapse while combat simulation is frozen");
  equal(input.tickCalls, 0, "ActionInput.tick must run only on a non-hitstop simulation step");
  equal(input.endCalls, 3, "Hitstop steps must still close transient raw-input bookkeeping");
  equal(runtime.hitstop, 0, "An authored three-frame hitstop must freeze exactly three fixed steps");
});

test("combat cancels unlock after the active beat and utility inputs are not banked across focus loss", () => {
  const runtime = Object.create(ActionRuntime.prototype);
  runtime.time = 10;
  runtime.run = {
    player: {
      action: {
        phase: "startup",
        startedAt: 9.8,
        part: { cancels: { dashAfterActive: true, deflectAfter: 0.08 } },
      },
    },
  };
  assert(!runtime.canCancelPlayerAction("dodge"), "Dodge must not skip an attack startup that already committed resources");
  assert(!runtime.canCancelPlayerAction("deflect"), "Deflect must not skip an attack startup that already committed resources");
  runtime.run.player.action.phase = "active";
  assert(runtime.canCancelPlayerAction("dodge"), "An authored dash-after-active cancel must unlock on the active beat");
  assert(runtime.canCancelPlayerAction("deflect"), "An elapsed authored deflect cancel must unlock after startup");

  const input = Object.create(ActionInput.prototype);
  input.downCodes = new Set(["KeyJ"]);
  input.virtualHeld = new Set(["primary"]);
  input.buffers = new Map([["primary", 0.16]]);
  input.pointer = { left: true, right: false };
  input.resetHeld();
  equal(input.buffers.size, 0, "Focus loss and scene boundaries must discard phantom combat inputs");
});

test("enemy tells lock the same geometry their attacks resolve", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const runtime = Object.create(ActionRuntime.prototype);
    runtime.time = 4;
    runtime.ui = {};
    runtime.run = {
      weaponId: "repeater",
      phase: "ascent",
      roomIndex: 10,
      cargo: [],
      player: { x: 20, y: 20, r: 3.6, vx: 0, vy: 0 },
      rng: {
        pick: (entries) => entries[0],
        weighted: (entries) => entries[0],
        chance: () => true,
        int: () => 0,
        range: () => 0,
        shuffle: (entries) => [...entries],
      },
    };
    runtime.encounter = {
      attackTokensUsed: 0,
      attackTokenCap: 6,
      barriers: [],
      obstacles: [],
      effects: [],
      enemies: [],
      bounds: BASE_WORLD.bounds,
      spawnPoints: [{ x: 50, y: 50 }],
      nav: {
        projectToWalkable: (point) => ({ ...point }),
        hasLineOfSight: () => true,
      },
    };
    runtime.rebuildNavigation = () => {};
    runtime.collisionObstacles = () => [];

    const skitter = {
      id: "mire_skitter",
      def: ENEMIES.mire_skitter,
      boss: false,
      x: 10,
      y: 20,
      r: ENEMIES.mire_skitter.radius,
      vx: 0,
      vy: 0,
    };
    runtime.tryEnemyAttack(skitter);
    equal(skitter.state, "tell", "Ordinary enemy attack selection must enter a tell without throwing");
    assert(skitter.attackTimeline.active >= skitter.attack.repeatDelay,
      "A paired pounce tell must account for the whole swept active window");

    const confiscator = {
      def: { speed: 30 },
      attack: { pattern: "steal_then_flee", speed: 110 },
      aim: Math.PI / 2,
      vx: 77,
      vy: -99,
    };
    runtime.beginEnemyActive(confiscator);
    assert(Math.abs(confiscator.vx) < 1e-8 && confiscator.vy > 109,
      "A charge tell must initialize both velocity axes instead of inheriting stale steering");

    const copyAttack = ENEMIES.counterfeit.attacks[0];
    const counterfeit = { id: "counterfeit", def: ENEMIES.counterfeit, x: 0, y: 20, r: 5.6 };
    runtime.startEnemyAttack(counterfeit, copyAttack, 2);
    equal(counterfeit.copiedWeaponId, "repeater", "Copied geometry must lock the player's weapon at tell start");
    assert(counterfeit.attackTimeline.tell >= copyAttack.replayDelay,
      "The authored replay delay must remain part of the readable tell");
    runtime.run.weaponId = "chainblade";
    let copiedFan = 0;
    runtime.enemyFan = (_enemy, _attack, count) => { copiedFan = count; };
    runtime.updateEnemyActive(counterfeit, 1 / 60);
    equal(copiedFan, 3, "Swapping during a copied ranged tell must not silently turn it into a melee cone");

    const wallAttack = ENEMIES.root_notary.attacks.find((attack) => attack.pattern === "barrier_cross");
    const notary = { id: "root_notary", def: ENEMIES.root_notary, x: 5, y: 5, r: 7 };
    runtime.run.player.x = 32;
    runtime.run.player.y = 42;
    runtime.startEnemyAttack(notary, wallAttack, 2);
    const warnedWall = { ...notary.barrierRects[0] };
    runtime.run.player.x = 200;
    runtime.run.player.y = 130;
    runtime.updateEnemyActive(notary, 1 / 60);
    deepEqual(
      { x: runtime.encounter.barriers[0].x, y: runtime.encounter.barriers[0].y, w: runtime.encounter.barriers[0].w, h: runtime.encounter.barriers[0].h },
      warnedWall,
      "A solid barrier must resolve exactly where its tell was drawn",
    );

    runtime.spawnBurst = () => {};
    runtime.encounter.spawnPoints = [{ x: 64, y: 48 }, { x: 220, y: 120 }];
    runtime.encounter.nav.projectToWalkable = (point) => ({ x: point.x + 2, y: point.y + 3 });
    const stepAttack = BOSSES.glass_saint.phases[1].patternDeck.find((attack) => /glass_step/.test(attack.pattern));
    const saint = { id: "glass_saint", def: BOSSES.glass_saint, boss: true, x: 120, y: 80, r: 9 };
    runtime.startEnemyAttack(saint, stepAttack, 3);
    const warnedStep = { ...saint.stepAnchors[0] };
    runtime.encounter.nav.projectToWalkable = () => ({ x: 999, y: 999 });
    runtime.beginEnemyActive(saint);
    deepEqual({ x: saint.x, y: saint.y }, warnedStep,
      "Glass Step must teleport to its preprojected warning anchor even if navigation changes during the tell");

    const jabAttack = ENEMIES.shardling.attacks[0];
    const shardling = {
      id: "shardling",
      def: ENEMIES.shardling,
      x: 100,
      y: 80,
      r: ENEMIES.shardling.radius,
      side: 1,
    };
    runtime.startEnemyAttack(shardling, jabAttack, 1);
    const warnedJab = { ...shardling.jabOrigin };
    runtime.beginEnemyActive(shardling);
    for (const elapsed of [0, jabAttack.sidestepTime, jabAttack.sidestepTime * 2]) {
      shardling.stateTime = shardling.attackTimeline.active - elapsed;
      runtime.updateEnemyActive(shardling, 1 / 60);
    }
    deepEqual({ x: shardling.x, y: shardling.y }, warnedJab,
      "Sidestep Jab must finish at the origin of the cone shown during its tell");

    runtime.metrics = { projectilesSpawned: 0 };
    runtime.encounter.projectiles = [];
    const fanAttack = ENEMIES.mire_spitter.attacks[0];
    ActionRuntime.prototype.enemyAimedShot.call(runtime, {
      def: ENEMIES.mire_spitter,
      x: 0,
      y: 0,
      r: ENEMIES.mire_spitter.radius,
    }, fanAttack, 0);
    const warnedProjectile = runtime.encounter.projectiles[0];
    assert(Math.abs(
      warnedProjectile.life * fanAttack.projectileSpeed + ENEMIES.mire_spitter.radius + 2 - fanAttack.range,
    ) < 1e-8,
      "A hostile projectile must expire at the range its tell advertised");

    const hookAttack = ENEMIES.root_notary.attacks.find((attack) => attack.pattern === "hook_pull_slam");
    const hooker = {
      id: "root_notary",
      def: ENEMIES.root_notary,
      attack: hookAttack,
      attackTimeline: { active: hookAttack.active },
      stateTime: hookAttack.active,
      activeResolved: false,
      aim: 0,
      x: 0,
      y: 0,
      r: 7,
    };
    let hookOptions = null;
    runtime.enemyAimedShot = (_enemy, _attack, _angle, options) => { hookOptions = options; };
    runtime.updateEnemyActive(hooker, 1 / 60);
    equal(hookOptions?.kind, "tether", "The Notary hook must resolve as its telegraphed projectile, not a giant melee cone");
    equal(hookOptions?.maxDistance, hookAttack.range, "The hook projectile must stop at its telegraphed range");
    equal(hookOptions?.pullDistance, hookAttack.pullDistance, "A landed hook must preserve its authored pull distance");

    runtime.encounter.projectiles = [];
    runtime.spawnProjectile({ x: 0, y: 0, vx: 1, vy: 0, pullDistance: hookAttack.pullDistance });
    equal(runtime.encounter.projectiles[0].pullDistance, hookAttack.pullDistance,
      "Projectile storage must not discard the hook's authored pull distance before collision");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("player knockback always travels away from the incoming source", () => {
  equal(typeof ActionRuntime.prototype.applyPlayerKnockback, "function", "ActionRuntime must expose applyPlayerKnockback for a single direction contract");
  const runtime = Object.create(ActionRuntime.prototype);
  runtime.run = { player: { x: 40, y: 50 } };
  const movements = [];
  runtime.movePlayer = (dx, dy) => movements.push({ dx, dy });

  runtime.applyPlayerKnockback({ source: { x: 10, y: 50 }, angle: 0 }, 8);
  runtime.applyPlayerKnockback({ source: { x: 40, y: 20 } }, 6);

  assert(movements[0].dx > 0 && Math.abs(movements[0].dy) < 1e-9,
    `A hit arriving left-to-right must push right, received ${JSON.stringify(movements[0])}`);
  assert(movements[1].dy > 0 && Math.abs(movements[1].dx) < 1e-9,
    `A source above the player must push down, received ${JSON.stringify(movements[1])}`);
});

test("the victory beat cannot be stolen by lingering hostile damage", () => {
  const runtime = Object.create(ActionRuntime.prototype);
  runtime.bot = { god: false };
  runtime.run = { player: { hp: 20 } };
  runtime.encounter = { clear: false, boss: { dead: true } };

  equal(runtime.damagePlayer(999, { kind: "hazard" }), false,
    "Boss death must immediately close the damage exchange");
  equal(runtime.run.player.hp, 20, "A lingering boss hazard must not damage the player after the killing blow");

  runtime.encounter = { clear: true, boss: null };
  equal(runtime.damagePlayer(999, { kind: "projectile" }), false,
    "Projectiles must become harmless during the room-clear beat");
  equal(runtime.run.player.hp, 20, "A room-clear projectile must not steal the completed encounter");

  runtime.encounter = {
    clear: false,
    boss: null,
    waves: [{ groups: [] }],
    waveIndex: 0,
    enemies: [{ dead: true }],
  };
  equal(runtime.damagePlayer(999, { kind: "hazard" }), false,
    "The last normal enemy's killing frame must close the exchange before updateEncounter runs");
  equal(runtime.run.player.hp, 20, "A same-step hazard must not steal a cleared normal room");
});

test("player movement stays inside the combat-readable viewport", () => {
  const runtime = Object.create(ActionRuntime.prototype);
  runtime.run = { player: { x: 160, y: 90, r: 3.6, vx: 0, vy: 0 } };
  runtime.encounter = { bounds: { x: 8, y: 12, w: 304, h: 160 } };
  runtime.collisionObstacles = () => [];

  runtime.movePlayer(0, -200);
  assert(runtime.run.player.y >= 31.59,
    `The delver must remain below the top HUD, received y=${runtime.run.player.y}`);
  runtime.movePlayer(0, 300);
  assert(runtime.run.player.y <= 152.41,
    `The delver must remain above the loadout HUD, received y=${runtime.run.player.y}`);
});

test("melee and projectile deflects share one visible front-cone contract", () => {
  const isWithinDeflectCone = RuntimeCombat.isWithinDeflectCone;
  equal(typeof isWithinDeflectCone, "function", "runtime.js must export isWithinDeflectCone");
  const player = { x: 100, y: 100, aim: 0 };
  const sourceAt = (degrees, distance = 20) => ({
    x: player.x + Math.cos(degrees * Math.PI / 180) * distance,
    y: player.y + Math.sin(degrees * Math.PI / 180) * distance,
  });

  assert(isWithinDeflectCone(player, sourceAt(0)), "A source directly in front must be deflectable");
  assert(isWithinDeflectCone(player, sourceAt(79)), "The authored 80-degree half-arc must include its visible inner edge");
  assert(!isWithinDeflectCone(player, sourceAt(81)), "Sources just outside the 80-degree half-arc must not deflect");
  assert(!isWithinDeflectCone(player, sourceAt(180)), "Rear attacks must not pass a front-facing deflect");
  assert(isWithinDeflectCone(player, { ...player, vx: -100, vy: 0 }),
    "An overlapping projectile traveling in from the front must use its incoming velocity");
  assert(!isWithinDeflectCone(player, { ...player, vx: 100, vy: 0 }),
    "An overlapping projectile traveling in from behind must not reflect through the front cone");
  assert(isWithinDeflectCone(player, { x: 120, y: 100, vx: -100, vy: 0 }),
    "A moving melee source must use its position, rather than accidentally inheriting projectile semantics");

  const runtimeSource = read("src/runtime.js");
  const sharedConeCalls = [...runtimeSource.matchAll(/\bisWithinDeflectCone\s*\(/g)].length;
  assert(sharedConeCalls >= 3,
    "The shared deflect helper must be used by both melee damage and projectile collision (definition + two call sites)");
});

test("the player renderer never regresses to the chest mimic tile", () => {
  const runtimeSource = read("src/runtime.js");
  const renderPlayerSource = runtimeSource.match(/\n  renderPlayer\(ctx\) \{([\s\S]*?)\n  snapshot\(\)/)?.[1] || "";
  assert(renderPlayerSource.length > 0, "Unable to locate ActionRuntime.renderPlayer");
  assert(!/\bsprite\s*:\s*92\b/.test(renderPlayerSource), "Tile 92 is the open chest mimic and must never represent the player");
  assert(/\bsprite\s*:\s*PLAYER_SPRITE\b/.test(renderPlayerSource), "Player rendering must use the named humanoid PLAYER_SPRITE contract");
});

test("DOM and renderer sources enforce crisp, readable presentation", () => {
  const html = read("index.html");
  const css = read("styles.css");
  const presentation = read("src/presentation.js");
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  equal(new Set(ids).size, ids.length, "HTML ids must be unique");

  const requiredIds = [
    "gameStage", "gameCanvas", "gameInstructions", "hudLayer", "screenLayer", "screenPanel",
    "hudHealthFill", "hudHealthText", "hudStaminaFill", "hudZone", "hudRoom",
    "hudDirection", "hudRouteNodes", "hudPressureFill", "hudPressureLabel",
    "hudWeightFill", "hudWeightText", "hudLoot", "hudWeaponName", "hudWeaponAmmo",
    "hudBoons", "bossHud", "bossName", "bossPhase", "bossHealthFill", "toastLayer",
    "roomBanner", "damageVignette", "loadingScreen", "touchControls", "soundToggle",
    "fullscreenToggle", "ariaLive",
  ];
  for (const id of requiredIds) assert(ids.includes(id), `index.html is missing #${id}`);

  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
  assert(scripts.some((tag) => /\btype=["']module["']/i.test(tag) && /\bsrc=["']game\.js(?:\?[^"']*)?["']/i.test(tag)), "game.js must load as a versioned ES module");

  const sources = javascriptFiles(ROOT).map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const canvasText = sources.filter(({ source }) => /\.(?:fillText|strokeText)\s*\(/.test(source));
  equal(canvasText.length, 0, `Readable UI text must stay in the DOM; canvas text calls found in ${canvasText.map(({ path }) => path).join(", ")}`);
  const blurSources = sources.filter(({ source }) => /\bshadowBlur\b/.test(source));
  equal(blurSources.length, 0, `Canvas shadowBlur is forbidden; found in ${blurSources.map(({ path }) => path).join(", ")}`);
  const canvasFilters = sources.filter(({ source }) => /(?:\bctx\b|\bcontext\b|this\.ctx)\.filter\s*=/.test(source));
  equal(canvasFilters.length, 0, `Canvas filter effects are forbidden; found in ${canvasFilters.map(({ path }) => path).join(", ")}`);
  assert(!/(?:^|[;{]\s*)(?:-webkit-)?(?:backdrop-)?filter\s*:/im.test(css), "CSS filter and backdrop-filter effects are forbidden");
  assert(!/(?:^|[;{]\s*)text-shadow\s*:/im.test(css), "Text shadows are forbidden because they reduce small-text clarity");
  assert(!/\bblur\s*\(/i.test(css), "CSS blur functions are forbidden");
  assert(!/imageSmoothingEnabled\s*=\s*true/.test(presentation), "PixelRenderer must never re-enable image smoothing");
  assert(/image-rendering\s*:\s*pixelated/i.test(css), "Canvas CSS must request pixelated rendering");
  assert(/imageSmoothingEnabled\s*=\s*false/.test(presentation), "PixelRenderer must disable canvas smoothing");
  assert(/Math\.floor\s*\(\s*Math\.min\s*\(/.test(presentation), "PixelRenderer must choose an integer presentation scale");
  assert(/setTransform\s*\(\s*scale\s*,\s*0\s*,\s*0\s*,\s*scale\s*,\s*0\s*,\s*0\s*\)/.test(presentation),
    "PixelRenderer must render through the integer scale transform");
});

test("room interaction is a defined, safe runtime action", () => {
  equal(typeof ActionRuntime.prototype.interactWithRoom, "function", "ActionRuntime input calls an undefined interactWithRoom action");
  const messages = [];
  const runtime = Object.create(ActionRuntime.prototype);
  runtime.run = { player: { x: 160, y: 90 } };
  runtime.encounter = { hazards: [], obstacles: [], effects: [] };
  runtime.ui = { toast: (message) => messages.push(message) };
  runtime.interactWithRoom();
  deepEqual(messages, ["NO MECHANISM IN REACH"], "Empty-room interaction should fail safely with player feedback");
});

test("the Surface shop exposes persistent Grit and unlock-all testing cheats", () => {
  const game = Object.create(AbyssalWeightGame.prototype);
  let savedGrit = null;
  let refreshed = false;
  let toast = "";
  game.meta = { grit: 7 };
  game.store = { save: (meta) => { savedGrit = meta.grit; } };
  game.ui = { toast: (message) => { toast = message; } };
  game.showHub = () => { refreshed = true; };

  game.grantTestGrit();

  equal(game.meta.grit, 1006, "Testing grant must add exactly 999 Grit");
  equal(savedGrit, 1006, "Testing grant must persist immediately");
  assert(refreshed, "Testing grant must refresh the Surface shop");
  assert(/\+999 Grit/.test(toast), "Testing grant should confirm the added currency");

  game.meta = { grit: 0, upgrades: {}, unlockedWeapons: ["chainblade"], selectedWeapon: "chainblade" };
  savedGrit = null;
  refreshed = false;
  game.unlockAllUpgradesForTesting();

  for (const upgrade of Object.values(META_UPGRADES)) {
    equal(game.meta.upgrades[upgrade.id], upgrade.maxRank, `${upgrade.id} must be maxed by the testing cheat`);
    for (const effect of upgrade.effects || []) {
      if (effect.type === "unlock_weapon") {
        assert(game.meta.unlockedWeapons.includes(effect.id), `${effect.id} must unlock with all upgrades`);
      }
    }
  }
  equal(savedGrit, 0, "Unlock-all must persist without altering Grit");
  assert(refreshed, "Unlock-all must refresh the Surface shop");
  assert(/all permanent upgrades unlocked/i.test(toast), "Unlock-all should confirm completion");
});

let passed = 0;
const failures = [];

for (const entry of tests) {
  try {
    await entry.run();
    passed += 1;
    console.log(`✓ ${entry.name}`);
  } catch (error) {
    failures.push({ name: entry.name, error });
    console.error(`✗ ${entry.name}`);
    console.error(`  ${String(error?.message || error).replaceAll("\n", "\n  ")}`);
  }
}

console.log("");
console.log(`Abyssal Weight smoke suite: ${passed}/${tests.length} checks passed`);
console.log(`Content: ${metrics.rooms} rooms · ${metrics.routes} phase routes · ${metrics.spawnPoints} spawns · ${metrics.enemies} enemies · ${metrics.bosses} bosses`);
console.log(`Progression: ${metrics.weapons} weapons · ${metrics.techniques} Techniques · ${metrics.cargo} cargo · ${metrics.metaUpgrades} meta upgrades`);

if (failures.length > 0) process.exitCode = 1;
