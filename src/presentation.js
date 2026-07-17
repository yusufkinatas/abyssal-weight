const WORLD_WIDTH = 320;
const WORLD_HEIGHT = 180;
const TILE_SIZE = 16;
const TILE_COLUMNS = 12;
const DEFAULT_TILE_SHEET = 'assets/vendor/tiny-dungeon/Tilemap/tilemap_packed.png';
const DEFAULT_ENVIRONMENT_SHEET = 'assets/vendor/roguelike-rpg/Spritesheet/roguelikeSheet_transparent.png';
const ENVIRONMENT_COLUMNS = 57;
const ENVIRONMENT_STRIDE = 17;
const SAVE_KEY_V2 = 'abyssal-weight-save-v2';
const SAVE_KEY_V1 = 'abyssal-weight-save-v1';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, fallback = 0) => Math.floor(finite(value, fallback));
const clone = (value) => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const DEFAULT_META = Object.freeze({
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
});

function safeStorage(candidate) {
  if (candidate) return candidate;
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}

function uniqueStrings(value, fallback = []) {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.length > 0))];
}

function fixedBooleanArray(value, length, firstAlwaysTrue = false) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) => firstAlwaysTrue && index === 0 ? true : Boolean(source[index]));
}

function normalizeMeta(raw, suppliedDefaults = DEFAULT_META) {
  const defaults = clone(suppliedDefaults || DEFAULT_META);
  const source = raw && typeof raw === 'object' ? raw : {};
  const meta = {
    ...defaults,
    ...source,
    version: 2,
    upgrades: { ...(defaults.upgrades || {}), ...(source.upgrades || {}) },
    bossSigils: { ...(defaults.bossSigils || {}), ...(source.bossSigils || {}) },
    settings: { ...(defaults.settings || {}), ...(source.settings || {}) },
    statistics: { ...(defaults.statistics || {}), ...(source.statistics || {}) },
  };

  meta.grit = Math.max(0, integer(meta.grit));
  meta.totalExtracted = Math.max(0, integer(meta.totalExtracted));
  meta.deepestRoom = clamp(integer(meta.deepestRoom), 0, 15);
  meta.runs = Math.max(0, integer(meta.runs));
  meta.successfulExtractions = Math.max(0, integer(meta.successfulExtractions));
  meta.fullExtractions = Math.max(0, integer(meta.fullExtractions));
  meta.unlockedWeapons = uniqueStrings(meta.unlockedWeapons, ['chainblade']);
  if (!meta.unlockedWeapons.includes('chainblade')) meta.unlockedWeapons.unshift('chainblade');
  meta.selectedWeapon = meta.unlockedWeapons.includes(meta.selectedWeapon) ? meta.selectedWeapon : meta.unlockedWeapons[0];
  meta.unlockedTechniques = uniqueStrings(meta.unlockedTechniques, defaults.unlockedTechniques || []);
  meta.discoveredCargo = uniqueStrings(meta.discoveredCargo);
  meta.bestiarySeen = uniqueStrings(meta.bestiarySeen);
  meta.shortcuts = fixedBooleanArray(meta.shortcuts, 3, true);
  meta.roomClearance = fixedBooleanArray(meta.roomClearance, 15, true);
  meta.surveyGritClaimed = fixedBooleanArray(meta.surveyGritClaimed, 15);

  for (const key of Object.keys(meta.upgrades)) meta.upgrades[key] = clamp(integer(meta.upgrades[key]), 0, 9);
  for (const key of Object.keys(meta.bossSigils)) meta.bossSigils[key] = Boolean(meta.bossSigils[key]);
  meta.settings.muted = Boolean(meta.settings.muted);
  meta.settings.reducedMotion = Boolean(meta.settings.reducedMotion);
  meta.settings.screenShake = clamp(finite(meta.settings.screenShake, 1), 0, 1);
  meta.settings.highContrastProjectiles = Boolean(meta.settings.highContrastProjectiles);
  for (const key of Object.keys(meta.statistics)) meta.statistics[key] = Math.max(0, finite(meta.statistics[key]));
  return meta;
}

function migrateLegacy(legacy, suppliedDefaults = DEFAULT_META) {
  const meta = normalizeMeta(null, suppliedDefaults);
  if (!legacy || typeof legacy !== 'object') return meta;

  const oldUpgrades = legacy.upgrades && typeof legacy.upgrades === 'object' ? legacy.upgrades : {};
  const oldDeepest = clamp(integer(legacy.deepest), 0, 3);
  const oldVictories = Math.max(0, integer(legacy.victories));
  const oldShortcuts = Array.isArray(legacy.shortcuts) ? legacy.shortcuts : [true, false, false];

  meta.grit = Math.max(0, integer(legacy.grit));
  meta.totalExtracted = Math.max(0, integer(legacy.totalExtracted));
  meta.runs = Math.max(0, integer(legacy.runs));
  meta.successfulExtractions = oldVictories;
  meta.fullExtractions = oldVictories;
  meta.deepestRoom = oldVictories > 0 || oldDeepest >= 3 ? 15 : oldDeepest * 5;
  meta.shortcuts = [true, Boolean(oldShortcuts[1] || oldDeepest >= 2), Boolean(oldShortcuts[2] || oldDeepest >= 3 || oldVictories > 0)];
  meta.bossSigils = {
    root: Boolean(meta.shortcuts[1] || oldUpgrades.blacksmith),
    glass: Boolean(meta.shortcuts[2]),
    forge: oldVictories > 0,
  };
  meta.roomClearance = Array.from({ length: 15 }, (_, index) => index === 0 || index < meta.deepestRoom);
  meta.settings.muted = Boolean(legacy.muted);
  meta.upgrades.reinforced_pulleys = clamp(integer(oldUpgrades.pulleys), 0, 3);
  meta.upgrades.reinforced_frame = clamp(integer(oldUpgrades.lungs), 0, 3);
  meta.upgrades.dash_bearings = clamp(integer(oldUpgrades.lungs), 0, 2);
  meta.upgrades.reflex_coil = clamp(integer(oldUpgrades.reflex), 0, 2);

  if (oldUpgrades.blacksmith) {
    meta.upgrades.license_maul = 1;
    meta.unlockedWeapons.push('maul');
    meta.selectedWeapon = 'maul';
  }

  // A completed legacy run represented mastery of all three old biomes.
  if (oldVictories > 0 || oldDeepest >= 3) {
    meta.upgrades.license_repeater = 1;
    meta.upgrades.license_maul = 1;
    meta.upgrades.license_prism = 1;
    meta.unlockedWeapons = ['chainblade', 'repeater', 'maul', 'prism'];
  }
  return normalizeMeta(meta, suppliedDefaults);
}

// Persistent meta-progression with a non-destructive v1 to v2 migration.
export class SaveStore {
  constructor(options = {}) {
    if (typeof options === 'string') options = { key: options };
    this.key = options.key || SAVE_KEY_V2;
    this.legacyKey = options.legacyKey || SAVE_KEY_V1;
    this.backupKey = options.backupKey || `${this.legacyKey}-backup`;
    this.storage = safeStorage(options.storage);
    this.defaults = normalizeMeta(options.defaults || DEFAULT_META, options.defaults || DEFAULT_META);
    this.current = clone(this.defaults);
  }

  load() {
    if (!this.storage) {
      this.current = clone(this.defaults);
      return clone(this.current);
    }

    try {
      const savedText = this.storage.getItem(this.key);
      const saved = savedText ? JSON.parse(savedText) : null;
      if (saved && Number(saved.version) === 2) {
        this.current = normalizeMeta(saved, this.defaults);
        return clone(this.current);
      }
    } catch (_) {
      // Corrupt storage falls through to legacy migration or defaults.
    }

    try {
      const legacyText = this.storage.getItem(this.legacyKey);
      const legacy = legacyText ? JSON.parse(legacyText) : null;
      if (legacy && Number(legacy.version) === 1) {
        if (!this.storage.getItem(this.backupKey)) this.storage.setItem(this.backupKey, legacyText);
        this.current = migrateLegacy(legacy, this.defaults);
        this.save(this.current);
        return clone(this.current);
      }
    } catch (_) {
      // The old key is deliberately left untouched if it cannot be recovered.
    }

    this.current = clone(this.defaults);
    return clone(this.current);
  }

  save(meta = this.current) {
    this.current = normalizeMeta(meta, this.defaults);
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.current));
    } catch (_) {
      // Private browsing and quota errors must never interrupt a run.
    }
    return clone(this.current);
  }

  reset() {
    try {
      this.storage?.removeItem(this.key);
      this.storage?.removeItem(this.legacyKey);
      this.storage?.removeItem(this.backupKey);
    } catch (_) {
      // In-memory defaults still make reset useful without writable storage.
    }
    this.current = clone(this.defaults);
    return this.save(this.current);
  }

  static get defaults() {
    return clone(DEFAULT_META);
  }
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load pixel tiles: ${source}`));
    image.src = source;
  });
}

// A 320 by 180 logical renderer backed by an integer number of device pixels.
export class PixelRenderer {
  constructor(canvasOrOptions, maybeOptions = {}) {
    const isCanvas = globalThis.HTMLCanvasElement && canvasOrOptions instanceof globalThis.HTMLCanvasElement;
    const options = isCanvas ? { ...maybeOptions, canvas: canvasOrOptions } : (canvasOrOptions || {});
    this.canvas = options.canvas || document.getElementById('gameCanvas');
    this.stage = options.stage || document.getElementById('gameStage');
    if (!this.canvas || !this.stage) throw new Error('PixelRenderer requires #gameCanvas and #gameStage.');

    this.width = WORLD_WIDTH;
    this.height = WORLD_HEIGHT;
    this.scale = 1;
    this.dpr = Math.max(1, globalThis.devicePixelRatio || 1);
    this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!this.ctx) throw new Error('Canvas 2D rendering is unavailable.');

    this.tileSheetSource = options.tileSheet || DEFAULT_TILE_SHEET;
    this.environmentSheetSource = options.environmentSheet || DEFAULT_ENVIRONMENT_SHEET;
    this.tileSheet = null;
    this.environmentSheet = null;
    this.assetsReady = false;
    this._resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this._boundResize = () => this.resize();
    this._resizeObserver?.observe(this.stage);
    globalThis.addEventListener?.('resize', this._boundResize, { passive: true });
    this.resize(true);
  }

  async loadAssets() {
    if (this.assetsReady) return this;
    [this.tileSheet, this.environmentSheet] = await Promise.all([
      loadImage(this.tileSheetSource),
      loadImage(this.environmentSheetSource),
    ]);
    this.assetsReady = true;
    return this;
  }

  resize(force = false) {
    const rect = this.stage.getBoundingClientRect();
    const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
    const availableWidth = Math.max(1, rect.width * dpr);
    const availableHeight = Math.max(1, rect.height * dpr);
    const scale = Math.max(1, Math.floor(Math.min(availableWidth / this.width, availableHeight / this.height)));
    const cssWidth = this.width * scale / dpr;
    const cssHeight = this.height * scale / dpr;
    const cssLeft = Math.round((rect.width - cssWidth) * 0.5 * dpr) / dpr;
    const cssTop = Math.round((rect.height - cssHeight) * 0.5 * dpr) / dpr;
    const layoutKey = `${scale}:${dpr}:${cssWidth}:${cssHeight}:${cssLeft}:${cssTop}`;
    if (!force && layoutKey === this._layoutKey) return false;

    this.scale = scale;
    this.dpr = dpr;
    this._layoutKey = layoutKey;
    this.canvas.width = this.width * scale;
    this.canvas.height = this.height * scale;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.style.left = `${cssLeft}px`;
    this.canvas.style.top = `${cssTop}px`;
    this.canvas.style.right = 'auto';
    this.canvas.style.bottom = 'auto';
    this.canvas.style.transform = 'none';
    this.canvas.style.imageRendering = 'pixelated';
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return true;
  }

  beginFrame(color = '#06090d') {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    return this.ctx;
  }

  drawTile(index, x, y, size = TILE_SIZE, flip = false) {
    if (!this.tileSheet || !this.assetsReady) return false;
    const tile = clamp(integer(index), 0, TILE_COLUMNS * 11 - 1);
    const sx = (tile % TILE_COLUMNS) * TILE_SIZE;
    const sy = Math.floor(tile / TILE_COLUMNS) * TILE_SIZE;
    const dx = Math.round(x);
    const dy = Math.round(y);
    const drawSize = Math.max(1, Math.round(size));
    const flipX = flip === true || flip === 'x' || flip?.x;
    const flipY = flip === 'y' || flip?.y;

    this.ctx.save();
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.translate(dx + (flipX ? drawSize : 0), dy + (flipY ? drawSize : 0));
    this.ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    this.ctx.drawImage(this.tileSheet, sx, sy, TILE_SIZE, TILE_SIZE, 0, 0, drawSize, drawSize);
    this.ctx.restore();
    return true;
  }

  drawEnvironmentTile(index, x, y, size = TILE_SIZE, alpha = 1) {
    if (!this.environmentSheet || !this.assetsReady) return false;
    const tile = clamp(integer(index), 0, ENVIRONMENT_COLUMNS * 31 - 1);
    const sx = (tile % ENVIRONMENT_COLUMNS) * ENVIRONMENT_STRIDE;
    const sy = Math.floor(tile / ENVIRONMENT_COLUMNS) * ENVIRONMENT_STRIDE;
    const drawSize = Math.max(1, Math.round(size));
    this.ctx.save();
    this.ctx.globalAlpha *= clamp(finite(alpha, 1), 0, 1);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(
      this.environmentSheet,
      sx,
      sy,
      TILE_SIZE,
      TILE_SIZE,
      Math.round(x),
      Math.round(y),
      drawSize,
      drawSize,
    );
    this.ctx.restore();
    return true;
  }

  drawShadow(x, y, width = 10, height = 4, color = 'rgba(0, 0, 0, 0.55)') {
    const cx = Math.round(x);
    const cy = Math.round(y);
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    this.ctx.fillStyle = color || 'rgba(0, 0, 0, 0.55)';
    this.ctx.fillRect(cx - Math.floor(w * 0.32), cy - Math.floor(h / 2), Math.max(2, Math.floor(w * 0.64)), h);
    if (h > 2) this.ctx.fillRect(cx - Math.floor(w / 2), cy - Math.floor(h / 2) + 1, w, h - 2);
  }

  drawPixelEntity(entityOrTile, x, y, options = {}) {
    const entity = typeof entityOrTile === 'object' && entityOrTile !== null
      ? entityOrTile
      : { ...options, sprite: entityOrTile, x, y };
    const cx = Math.round(entity.x ?? x ?? 0);
    const cy = Math.round(entity.y ?? y ?? 0);
    const radius = finite(entity.radius ?? entity.r, 6);
    const size = Math.max(6, Math.round(entity.drawSize ?? entity.size ?? radius * 2.35));
    const sprite = entity.sprite ?? entity.tile ?? entity.tileIndex;
    const facing = finite(entity.facing ?? entity.angle, 0);
    const flip = entity.flip ?? (Math.cos(facing) < 0);
    const alpha = clamp(finite(entity.alpha, 1), 0, 1);
    const color = entity.flashColor || entity.color || '#f4ead4';

    if (entity.shadow !== false) {
      this.drawShadow(cx, cy + Math.floor(size * 0.37), size * 0.72, Math.max(2, size * 0.22), entity.shadowColor);
    }

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    const drawn = Number.isFinite(Number(sprite))
      ? this.drawTile(sprite, cx - Math.floor(size / 2), cy - Math.floor(size / 2), size, flip)
      : false;
    if (!drawn) {
      const body = Math.max(4, Math.round(size * 0.64));
      this.ctx.fillStyle = color;
      this.ctx.fillRect(cx - Math.floor(body / 2), cy - Math.floor(body / 2), body, body);
      this.ctx.fillStyle = entity.detailColor || '#172026';
      this.ctx.fillRect(cx + (flip ? -Math.floor(body / 2) : Math.floor(body / 2) - 2), cy - 1, 2, 2);
    }

    if (entity.hitFlash || entity.invulnerableFlash) {
      this.ctx.globalAlpha = entity.hitFlash ? 0.78 : 0.45;
      this.ctx.fillStyle = entity.hitFlashColor || '#ffffff';
      this.ctx.fillRect(cx - Math.floor(size * 0.28), cy - Math.floor(size * 0.34), Math.max(2, Math.floor(size * 0.56)), 2);
      this.ctx.fillRect(cx - 1, cy - Math.floor(size * 0.35), 2, Math.max(3, Math.floor(size * 0.7)));
    }
    this.ctx.restore();
  }

  drawProjectile(projectile, y, radius, color) {
    const shot = typeof projectile === 'object' && projectile !== null
      ? projectile
      : { x: projectile, y, radius, color };
    const x = Math.round(shot.x || 0);
    const cy = Math.round(shot.y || 0);
    const r = Math.max(1, Math.round(shot.radius ?? shot.r ?? 2));
    const hostile = shot.hostile ?? shot.faction === 'enemy';
    const fill = shot.color || (hostile ? '#ff625e' : '#ffd98a');
    const core = shot.coreColor || '#fff4d6';

    this.ctx.fillStyle = shot.outlineColor || '#101419';
    this.ctx.fillRect(x - r - 1, cy - r, r * 2 + 3, r * 2 + 1);
    this.ctx.fillRect(x - r, cy - r - 1, r * 2 + 1, r * 2 + 3);
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x - r, cy - r, r * 2 + 1, r * 2 + 1);
    this.ctx.fillStyle = core;
    this.ctx.fillRect(x, cy, Math.max(1, r), Math.max(1, r));

    if (shot.tail || shot.vx || shot.vy) {
      const vx = finite(shot.vx, Math.cos(finite(shot.angle)));
      const vy = finite(shot.vy, Math.sin(finite(shot.angle)));
      const length = Math.max(2, Math.round(shot.tail ?? 4));
      const magnitude = Math.hypot(vx, vy) || 1;
      this.ctx.fillStyle = fill;
      for (let step = 2; step <= length; step += 2) {
        this.ctx.globalAlpha = 1 - step / (length + 2);
        this.ctx.fillRect(Math.round(x - vx / magnitude * step), Math.round(cy - vy / magnitude * step), 1, 1);
      }
      this.ctx.globalAlpha = 1;
    }
  }

  drawArena(room = {}, biome = {}, phase = 'descent', time = 0) {
    const ctx = this.ctx;
    const bounds = room.bounds || room.arena?.bounds || { x: 8, y: 12, w: 304, h: 160 };
    const floorColor = biome.floor || room.floor || '#24302f';
    const wallColor = biome.wall || room.wall || '#101919';
    const shadowColor = biome.shadow || '#081011';
    const accent = biome.accent || '#72d68c';
    const floorTile = biome.floorSprite ?? room.floorSprite ?? 0;
    const wallTile = biome.wallSprite ?? room.wallSprite ?? 14;
    const biomeId = String(biome.id || biome.hazardFamily || '').toLowerCase();

    ctx.fillStyle = shadowColor;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = floorColor;
    ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);

    if (this.assetsReady) {
      ctx.globalAlpha = 0.18;
      for (let tileY = bounds.y; tileY < bounds.y + bounds.h; tileY += TILE_SIZE) {
        for (let tileX = bounds.x; tileX < bounds.x + bounds.w; tileX += TILE_SIZE) {
          this.drawTile(floorTile, tileX, tileY, TILE_SIZE, false);
        }
      }
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = wallColor;
    ctx.fillRect(bounds.x, bounds.y, bounds.w, 7);
    ctx.fillRect(bounds.x, bounds.y + bounds.h - 7, bounds.w, 7);
    ctx.fillRect(bounds.x, bounds.y, 7, bounds.h);
    ctx.fillRect(bounds.x + bounds.w - 7, bounds.y, 7, bounds.h);

    if (this.assetsReady) {
      for (let tileX = bounds.x; tileX < bounds.x + bounds.w; tileX += TILE_SIZE) {
        this.drawTile(wallTile, tileX, bounds.y - 4, TILE_SIZE, false);
        this.drawTile(wallTile, tileX, bounds.y + bounds.h - 12, TILE_SIZE, false);
      }
    }

    if (biomeId.includes('moss')) {
      ctx.fillStyle = biome.ambient || '#375b43';
      for (let index = 0; index < 13; index += 1) {
        const patchX = bounds.x + 13 + (index * 47) % Math.max(20, bounds.w - 26);
        const patchY = bounds.y + 14 + (index * 31) % Math.max(20, bounds.h - 28);
        ctx.fillRect(patchX, patchY, 7 + index % 3, 3);
        ctx.fillRect(patchX + 2, patchY - 2, 3, 7);
      }
    } else if (biomeId.includes('crystal') || biomeId.includes('glass') || biomeId.includes('refract')) {
      ctx.fillStyle = biome.ambient || '#315d7a';
      for (let index = 0; index < 10; index += 1) {
        const crystalX = bounds.x + 18 + (index * 61) % Math.max(20, bounds.w - 36);
        const crystalY = bounds.y + 18 + (index * 37) % Math.max(20, bounds.h - 36);
        ctx.fillRect(crystalX, crystalY, 2, 10);
        ctx.fillRect(crystalX - 2, crystalY + 3, 6, 4);
        ctx.fillStyle = accent;
        ctx.fillRect(crystalX, crystalY, 1, 3);
        ctx.fillStyle = biome.ambient || '#315d7a';
      }
    } else if (biomeId.includes('foundry') || biomeId.includes('machine')) {
      ctx.fillStyle = biome.ambient || '#7a3e2a';
      for (let grateX = bounds.x + 16; grateX < bounds.x + bounds.w - 16; grateX += 32) {
        ctx.fillRect(grateX, bounds.y + 16, 14, 3);
        ctx.fillRect(grateX, bounds.y + bounds.h - 19, 14, 3);
      }
      const pulse = Math.floor(time * 4) % 3;
      ctx.fillStyle = pulse === 0 ? accent : '#7a3e2a';
      ctx.fillRect(bounds.x + 12, bounds.y + 12, 3, 3);
      ctx.fillRect(bounds.x + bounds.w - 15, bounds.y + bounds.h - 15, 3, 3);
    }

    const obstacles = room.obstacles || room.layout?.obstacles || [];
    for (const obstacle of obstacles) {
      const obstacleX = Math.round(obstacle.x);
      const obstacleY = Math.round(obstacle.y);
      const obstacleWidth = Math.max(2, Math.round(obstacle.w ?? obstacle.width ?? (obstacle.r || 5) * 2));
      const obstacleHeight = Math.max(2, Math.round(obstacle.h ?? obstacle.height ?? (obstacle.r || 5) * 2));
      ctx.fillStyle = obstacle.shadowColor || shadowColor;
      ctx.fillRect(obstacleX + 2, obstacleY + 3, obstacleWidth, obstacleHeight);
      ctx.fillStyle = obstacle.color || wallColor;
      ctx.fillRect(obstacleX, obstacleY, obstacleWidth, obstacleHeight);
      ctx.fillStyle = obstacle.edgeColor || accent;
      ctx.fillRect(obstacleX, obstacleY, obstacleWidth, 2);
      ctx.globalAlpha = 0.36;
      ctx.fillStyle = '#000000';
      for (let line = obstacleY + 6; line < obstacleY + obstacleHeight; line += 8) {
        ctx.fillRect(obstacleX + 2, line, Math.max(1, obstacleWidth - 4), 1);
      }
      ctx.globalAlpha = 1;
    }

    const hazards = room.hazards || room.layout?.hazards || [];
    for (const hazard of hazards) {
      const hazardX = Math.round(hazard.x || 0);
      const hazardY = Math.round(hazard.y || 0);
      const hazardWidth = Math.max(3, Math.round(hazard.w ?? hazard.width ?? (hazard.radius || 7) * 2));
      const hazardHeight = Math.max(3, Math.round(hazard.h ?? hazard.height ?? (hazard.radius || 7) * 2));
      ctx.fillStyle = hazard.color || accent;
      ctx.globalAlpha = hazard.active === false ? 0.24 : 0.58;
      ctx.fillRect(hazardX, hazardY, hazardWidth, hazardHeight);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hazard.warningColor || '#ffd98a';
      if (hazard.warning || hazard.telegraph) {
        ctx.fillRect(hazardX, hazardY, hazardWidth, 2);
        ctx.fillRect(hazardX, hazardY + hazardHeight - 2, hazardWidth, 2);
      }
    }

    if (phase === 'ascent') {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#ff625e';
      const march = Math.floor(time * 10) % 16;
      for (let markX = bounds.x - 16 + march; markX < bounds.x + bounds.w; markX += 32) {
        ctx.fillRect(markX, bounds.y + 8, 12, 2);
        ctx.fillRect(markX + 8, bounds.y + bounds.h - 10, 12, 2);
      }
      ctx.globalAlpha = 1;
    }

    if (this.environmentSheet && this.assetsReady) {
      const accentTiles = biomeId.includes('moss')
        ? [342, 343, 399, 400]
        : biomeId.includes('crystal') || biomeId.includes('glass')
          ? [1365, 1366, 1422, 1423]
          : [1282, 1283, 1339, 1340];
      const accentPositions = [
        { x: bounds.x + 10, y: bounds.y + 10 },
        { x: bounds.x + bounds.w - 22, y: bounds.y + 10 },
        { x: bounds.x + 10, y: bounds.y + bounds.h - 22 },
        { x: bounds.x + bounds.w - 22, y: bounds.y + bounds.h - 22 },
      ];
      accentPositions.forEach((position, index) => {
        this.drawEnvironmentTile(accentTiles[index], position.x, position.y, 12, phase === 'ascent' ? 0.62 : 0.82);
      });
    }
  }

  drawParticles(particles = []) {
    for (const particle of particles) {
      const alpha = particle.maxLife
        ? clamp(particle.life / particle.maxLife, 0, 1)
        : clamp(finite(particle.alpha, 1), 0, 1);
      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = particle.color || '#f4ead4';
      const size = Math.max(1, Math.round(particle.size || 1));
      this.ctx.fillRect(Math.round(particle.x), Math.round(particle.y), size, size);
    }
    this.ctx.globalAlpha = 1;
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / rect.width * this.width, 0, this.width),
      y: clamp((clientY - rect.top) / rect.height * this.height, 0, this.height),
    };
  }

  destroy() {
    this._resizeObserver?.disconnect();
    globalThis.removeEventListener?.('resize', this._boundResize);
  }
}

const DOM_IDS = [
  'gameStage', 'gameCanvas', 'hudLayer', 'screenLayer', 'screenPanel',
  'hudHealthFill', 'hudHealthText', 'hudStaminaFill', 'hudZone', 'hudRoom',
  'hudDirection', 'hudRouteNodes', 'hudPressureFill', 'hudPressureLabel',
  'hudWeightFill', 'hudWeightText', 'hudLoot', 'hudWeaponName', 'hudWeaponAmmo',
  'hudBoons', 'bossHud', 'bossName', 'bossPhase', 'bossHealthFill', 'toastLayer',
  'roomBanner', 'damageVignette', 'loadingScreen', 'touchControls', 'soundToggle',
  'fullscreenToggle', 'ariaLive',
];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function displayName(value) {
  return String(value || 'Unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatNumber(value) {
  return Math.max(0, integer(value)).toLocaleString();
}

function formatCurrency(value) {
  return `${formatNumber(value)}c`;
}

function ratio(value, max = 1) {
  const number = finite(value);
  const ceiling = Math.max(0.0001, finite(max, 1));
  if (ceiling === 1 && number > 1) return clamp(number / 100, 0, 1);
  return clamp(number / ceiling, 0, 1);
}

function autoPercentRatio(value, explicitMax) {
  const number = finite(value);
  if (explicitMax !== undefined && explicitMax !== null) return ratio(number, explicitMax);
  return clamp(number > 1 ? number / 100 : number, 0, 1);
}

function percentWidth(value) {
  return `${Math.round(clamp(value, 0, 1) * 1000) / 10}%`;
}

function commandButton(label, command, options = {}) {
  const classes = escapeHtml(options.className || '');
  const disabled = options.disabled ? ' disabled' : '';
  const data = Object.entries(options.data || {})
    .map(([key, value]) => ` data-${escapeHtml(key)}="${escapeHtml(value)}"`)
    .join('');
  return `<button class="${classes}" type="button" data-command="${escapeHtml(command)}"${data}${disabled}>${escapeHtml(label)}</button>`;
}

// DOM-based menus and HUD. All readable text stays out of the canvas.
export class UiShell {
  constructor(options = {}) {
    this.root = options.root || document;
    this.elements = {};
    for (const id of DOM_IDS) {
      const element = this.root.getElementById(id);
      if (!element) throw new Error(`UiShell requires #${id}.`);
      this.elements[id] = element;
    }
    this.e = this.elements;
    this.onCommand = typeof options.onCommand === 'function' ? options.onCommand : () => {};
    this._toastTimer = 0;
    this._bannerTimer = 0;
    this._damageTimer = 0;
    this._loadingTimer = 0;
    this._boonSignature = '';
    this._boundCommand = (event) => this._delegateCommand(event);
    this._boundSound = (event) => this._emitCommand('toggle-sound', {}, event);
    this._boundFullscreen = (event) => this._emitCommand('toggle-fullscreen', {}, event);
    this.e.screenPanel.addEventListener('click', this._boundCommand);
    this.e.soundToggle.addEventListener('click', this._boundSound);
    this.e.fullscreenToggle.addEventListener('click', this._boundFullscreen);
  }

  setCommandHandler(callback) {
    this.onCommand = typeof callback === 'function' ? callback : () => {};
  }

  get(id) {
    return this.elements[id] || null;
  }

  _delegateCommand(event) {
    const target = event.target.closest('[data-command]');
    if (!target || !this.e.screenPanel.contains(target) || target.disabled) return;
    const detail = { ...target.dataset };
    delete detail.command;
    this._emitCommand(target.dataset.command, detail, event);
  }

  _emitCommand(command, detail, event) {
    if (command) this.onCommand(command, detail || {}, event);
  }

  _showScreen(markup) {
    this.e.screenPanel.innerHTML = markup;
    this.e.screenLayer.classList.remove('is-hidden');
    requestAnimationFrame(() => {
      this.e.screenPanel.focus({ preventScroll: true });
      this.e.screenPanel.scrollTop = 0;
    });
  }

  showHud() {
    this.e.hudLayer.classList.remove('is-hidden');
  }

  hideHud() {
    this.e.hudLayer.classList.add('is-hidden');
    this.updateBoss(null);
  }

  showScreen(markup = '') {
    this._showScreen(markup);
  }

  hideScreen() {
    this.e.screenLayer.classList.add('is-hidden');
    this.e.screenPanel.replaceChildren();
  }

  showLoading(copy = 'The deep is rearranging itself.') {
    globalThis.clearTimeout(this._loadingTimer);
    const copyNode = this.e.loadingScreen.querySelector('.loading-copy');
    if (copyNode) copyNode.textContent = copy;
    this.e.loadingScreen.hidden = false;
    this.e.loadingScreen.classList.remove('is-hidden');
  }

  hideLoading() {
    this.e.loadingScreen.classList.add('is-hidden');
    this._loadingTimer = globalThis.setTimeout(() => {
      this.e.loadingScreen.hidden = true;
    }, 140);
  }

  renderTitle(meta = {}) {
    this.hideHud();
    const extractions = meta.successfulExtractions ?? meta.victories ?? 0;
    this._showScreen(`
      <p class="screen-kicker">ACTION EXTRACTION ROGUE-LITE</p>
      <h1 class="screen-title">ABYSSAL<br>WEIGHT</h1>
      <p class="screen-description">Descend fast. Build a vicious loadout. Then shoulder every treasure and fight fifteen rooms back to daylight.</p>
      <div class="screen-grid" aria-label="Career record">
        <article class="screen-card"><span class="screen-label">GRIT</span><strong>${formatNumber(meta.grit)}</strong><p>Permanent power banked at the Surface.</p></article>
        <article class="screen-card"><span class="screen-label">DEEPEST ROOM</span><strong>${formatNumber(meta.deepestRoom ?? meta.deepest)}</strong><p>Of fifteen rooms mapped below.</p></article>
        <article class="screen-card"><span class="screen-label">EXTRACTIONS</span><strong>${formatNumber(extractions)}</strong><p>Burden carried all the way home.</p></article>
      </div>
      <div class="screen-actions">
        ${commandButton('ENTER THE SURFACE', 'enter-hub')}
        ${commandButton('CONTROLS', 'open-controls', { className: 'secondary' })}
      </div>
    `);
  }

  renderHub(meta = {}, metaUpgrades = {}) {
    this.hideHud();
    const upgrades = Array.isArray(metaUpgrades) ? metaUpgrades : Object.values(metaUpgrades || {});
    const unlockedWeapons = uniqueStrings(meta.unlockedWeapons, ['chainblade']);
    const selectedWeapon = meta.selectedWeapon || unlockedWeapons[0];
    const upgradeCards = upgrades.map((upgrade) => {
      const rank = integer(meta.upgrades?.[upgrade.id]);
      const maxRank = Math.max(1, integer(upgrade.maxRank, upgrade.costs?.length || 1));
      const maxed = rank >= maxRank;
      const cost = maxed ? null : integer(upgrade.costs?.[rank] ?? upgrade.cost ?? 0);
      const locked = Boolean(upgrade.locked || upgrade.available === false);
      const disabled = maxed || locked || finite(meta.grit) < cost;
      const reason = maxed ? 'MAXIMUM RANK' : locked ? (upgrade.lockReason || 'LOCKED') : `${cost} GRIT`;
      return `
        <article class="upgrade-card">
          <span class="screen-label">${escapeHtml(displayName(upgrade.category || 'upgrade'))} · ${rank}/${maxRank}</span>
          <strong>${escapeHtml(upgrade.name || displayName(upgrade.id))}</strong>
          <p>${escapeHtml(upgrade.description || upgrade.summary || 'Permanent expedition equipment.')}</p>
          ${commandButton(reason, 'buy-upgrade', { disabled, data: { id: upgrade.id } })}
        </article>`;
    }).join('');

    const weaponButtons = unlockedWeapons.map((weapon) => commandButton(
      `${displayName(weapon)}${weapon === selectedWeapon ? ' · EQUIPPED' : ''}`,
      'select-weapon',
      { className: weapon === selectedWeapon ? '' : 'secondary', data: { id: weapon } },
    )).join('');

    this._showScreen(`
      <p class="screen-kicker">THE SURFACE · ${formatNumber(meta.grit)} GRIT AVAILABLE</p>
      <h2>PREPARE THE NEXT DROP</h2>
      <p>Permanent upgrades determine how deep you can reliably survive. Every successful ascent expands the arsenal.</p>
      <div class="screen-actions" aria-label="Unlocked weapons">${weaponButtons}</div>
      ${upgradeCards ? `<div class="upgrade-grid" aria-label="Permanent upgrades">${upgradeCards}</div>` : ''}
      <div class="screen-actions">
        ${commandButton('DESCEND', 'start-run')}
        ${commandButton('TITLE', 'back-title', { className: 'secondary' })}
      </div>
    `);
  }

  renderReward(choices = [], options = {}) {
    const cards = choices.map((choice, index) => `
      <article class="reward-card">
        <span class="screen-label">${escapeHtml(displayName(choice.rarity || choice.kind || 'technique'))}</span>
        <strong>${escapeHtml(choice.name || displayName(choice.id))}</strong>
        <p>${escapeHtml(choice.description || choice.summary || 'Alter the rules of this expedition.')}</p>
        ${commandButton('TAKE IT', 'choose-reward', { data: { id: choice.id ?? index, index } })}
      </article>`).join('');
    this._showScreen(`
      <p class="screen-kicker">ROOM SECURED · CHOOSE ONE</p>
      <h2>${escapeHtml(options.title || 'FORGE THE RUN')}</h2>
      <p>${escapeHtml(options.description || 'Each reward changes a decision, not merely a number.')}</p>
      <div class="reward-grid">${cards || '<p>No rewards were offered.</p>'}</div>
      ${options.canReroll || choices.some((choice) => choice.rerollable)
        ? `<div class="screen-actions">${commandButton(`REROLL · ${formatNumber(options.rerolls ?? 1)} LEFT`, 'reroll-reward', { className: 'secondary' })}</div>`
        : ''}
    `);
  }

  renderBasin(run = {}) {
    const suppliedRoom = run.roomNumber ?? run.depth;
    const room = clamp(integer(suppliedRoom ?? run.roomIndex) + (suppliedRoom === undefined ? 1 : 0), 1, 15);
    const maxDepth = finite(run.maxDepth, 15);
    const atLimit = Boolean(run.atDepthLimit || run.canDescend === false || room >= maxDepth);
    const cachedValue = run.cachedValue ?? run.lootValue ?? run.stagedValue ?? 0;
    const cachedWeight = run.cachedWeight ?? run.lootWeight ?? run.stagedWeight ?? 0;
    const retention = Math.round(clamp(finite(run.balloonRetention, 0.1), 0, 1) * 100);
    this._showScreen(`
      <p class="screen-kicker">COLLECTION BASIN · ROOM ${room} / 15</p>
      <h2>HOW GREEDY ARE YOU?</h2>
      <p>Your descent cache is weightless until you shoulder it. Deeper rooms offer stronger techniques and more valuable cargo.</p>
      <div class="screen-grid">
        <article class="screen-card"><span class="screen-label">CACHE VALUE</span><strong>${formatCurrency(cachedValue)}</strong><p>Bank 100% only by reaching the Surface.</p></article>
        <article class="screen-card"><span class="screen-label">CACHE WEIGHT</span><strong>${formatNumber(cachedWeight)}</strong><p>The ascent changes as burden tiers rise.</p></article>
        <article class="screen-card"><span class="screen-label">BALLOON RATE</span><strong>${retention}%</strong><p>Safe, immediate, and painfully expensive.</p></article>
      </div>
      <div class="screen-actions">
        ${commandButton(atLimit ? 'DEPTH LIMIT REACHED' : 'DESCEND DEEPER', 'continue-descent', { disabled: atLimit })}
        ${commandButton('SHOULDER THE BURDEN', 'begin-ascent')}
        ${commandButton('SEND A BALLOON', 'use-balloon', { className: 'secondary', disabled: run.canBalloon === false })}
      </div>
    `);
  }

  renderPause() {
    this._showScreen(`
      <p class="screen-kicker">EXPEDITION PAUSED</p>
      <h2>CATCH YOUR BREATH</h2>
      <p>WASD moves · mouse/J attacks · K uses technique · Shift deflects · Space dashes · R reloads.</p>
      <div class="screen-actions">
        ${commandButton('RESUME', 'resume-run')}
        ${commandButton('TOGGLE SOUND', 'toggle-sound', { className: 'secondary' })}
        ${commandButton('ABANDON RUN', 'abandon-run', { className: 'danger' })}
      </div>
    `);
  }

  renderEnd(summary = {}) {
    const success = Boolean(summary.success);
    const qa = summary.qaMetrics;
    this.hideHud();
    this._showScreen(`
      <p class="screen-kicker">${success ? 'EXTRACTION COMPLETE' : 'EXPEDITION LOST'}</p>
      <h2>${escapeHtml(summary.title || (success ? 'THE BURDEN IS YOURS' : 'THE ABYSS COLLECTS'))}</h2>
      <p>${escapeHtml(summary.description || (success ? 'Everything on your shoulders is now permanent wealth.' : 'Only ballooned cargo escaped the dark.'))}</p>
      <div class="screen-grid">
        <article class="screen-card"><span class="screen-label">VALUE KEPT</span><strong>${formatCurrency(summary.value ?? summary.extractedValue)}</strong><p>${formatCurrency(summary.lost || 0)} left below.</p></article>
        <article class="screen-card"><span class="screen-label">GRIT EARNED</span><strong>+${formatNumber(summary.grit)}</strong><p>Spend it before the next descent.</p></article>
        <article class="screen-card"><span class="screen-label">ROOMS CLEARED</span><strong>${formatNumber(summary.roomsCleared)}</strong><p>Across descent and ascent.</p></article>
      </div>
      ${qa ? `<p class="screen-label">QA PILOT · ${formatNumber(qa.roomsVisited)} ROUTE STATES · ${formatNumber(qa.enemies)} ENEMIES · ${formatNumber(qa.bosses)} BOSSES · ${formatNumber(qa.phases)} PHASES · ${formatNumber(qa.projectiles)} PROJECTILES · ${formatNumber(Math.max(0, (qa.stuck || 0) - (qa.recovered || 0)))} UNRESOLVED NAV STALLS · ${formatNumber(qa.recovered)} FLOW ADJUSTMENTS</p>` : ''}
      <div class="screen-actions">
        ${commandButton('RETURN TO SURFACE', 'return-hub')}
        ${commandButton('DROP AGAIN', 'retry-run', { className: 'secondary' })}
      </div>
    `);
  }

  updateHud(model = {}) {
    const player = model.player || model;
    const hp = finite(player.hp ?? model.health, 0);
    const maxHp = Math.max(1, finite(player.maxHp ?? model.maxHealth, 100));
    const stamina = player.stamina ?? player.dashCharge ?? model.stamina ?? model.dashCharge ?? 1;
    const maxStamina = player.maxStamina ?? model.maxStamina ?? 1;
    const biome = model.biome || {};
    const phase = String(model.phase || model.direction || 'descent').toLowerCase();
    const roomIndex = clamp(integer(model.roomIndex ?? model.room, 0), 0, 14);
    const currentRoom = model.roomNumber ?? roomIndex + 1;
    const pressure = model.pressure ?? model.attention ?? model.drive ?? 0;
    const weight = model.weightPercent ?? model.burdenPercent ?? model.weight ?? 0;
    const explicitWeightMax = model.weightPercent !== undefined || model.burdenPercent !== undefined
      ? undefined
      : model.maxWeight;
    const weightRatio = autoPercentRatio(weight, explicitWeightMax);
    const weightTier = model.weightTier || model.burdenTier || (weightRatio >= 0.75 ? 'CRUSHING' : weightRatio >= 0.25 ? 'LADEN' : 'AGILE');
    const weapon = model.weapon || {};

    this.e.hudHealthFill.style.width = percentWidth(ratio(hp, maxHp));
    this.e.hudHealthText.textContent = `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
    this.e.hudStaminaFill.style.width = percentWidth(ratio(stamina, maxStamina));
    this.e.hudZone.textContent = String(model.zoneName || biome.name || model.zone || 'THE MOSSWOUND SHAFT').toUpperCase();
    this.e.hudRoom.textContent = `ROOM ${currentRoom} / 15`;
    this.e.hudDirection.textContent = phase === 'ascent' ? 'ASCENT' : 'DESCENT';
    this.e.hudDirection.classList.toggle('direction-ascent', phase === 'ascent');
    this.e.hudDirection.classList.toggle('direction-descent', phase !== 'ascent');
    const pressureRatio = autoPercentRatio(pressure, model.pressureMax ?? model.attentionMax ?? model.driveMax);
    this.e.hudPressureFill.style.width = percentWidth(pressureRatio);
    this.e.hudPressureLabel.textContent = model.pressureLabel || model.driveLabel || `${Math.round(pressureRatio * 100)}%`;
    this.e.hudWeightFill.style.width = percentWidth(weightRatio);
    this.e.hudWeightText.textContent = `${Math.round(weightRatio * 100)}% · ${String(weightTier).toUpperCase()}`;
    this.e.hudLoot.textContent = formatCurrency(model.carriedValue ?? model.loot ?? model.carriedLoot ?? 0);
    this.e.hudWeaponName.textContent = String(weapon.name || model.weaponName || displayName(weapon.id || 'chainblade')).toUpperCase();
    this.e.hudWeaponAmmo.textContent = String(model.ammoText ?? weapon.ammoText ?? weapon.ammo ?? '∞');

    const nodes = [...this.e.hudRouteNodes.children];
    while (nodes.length < 15) {
      const node = document.createElement('span');
      node.className = 'route-node';
      this.e.hudRouteNodes.append(node);
      nodes.push(node);
    }
    const clearedRooms = model.clearedRooms instanceof Set ? model.clearedRooms : new Set(model.clearedRooms || []);
    for (let index = 0; index < 15; index += 1) {
      const node = nodes[index];
      const clearedByPosition = phase === 'ascent' ? index > roomIndex : index < roomIndex;
      node.classList.toggle('is-current', index === roomIndex);
      node.classList.toggle('is-cleared', clearedRooms.has(index) || clearedByPosition);
      node.classList.toggle('is-gate', index === 4 || index === 9 || index === 14);
    }

    const boons = model.boons || model.techniques || [];
    const signature = boons.map((boon) => typeof boon === 'string' ? boon : `${boon.id}:${boon.stacks || 1}`).join('|');
    if (signature !== this._boonSignature) {
      this._boonSignature = signature;
      this.e.hudBoons.replaceChildren(...boons.slice(0, 8).map((boon) => {
        const data = typeof boon === 'string' ? { id: boon, name: displayName(boon) } : boon;
        const element = document.createElement('span');
        element.className = 'boon-icon';
        element.title = data.description ? `${data.name}: ${data.description}` : (data.name || displayName(data.id));
        element.textContent = data.glyph || String(data.name || data.id || '?').slice(0, 2).toUpperCase();
        element.setAttribute('aria-label', element.title);
        return element;
      }));
    }
    this.showHud();
  }

  updateBoss(model) {
    if (!model || model.visible === false) {
      this.e.bossHud.classList.add('is-hidden');
      return;
    }
    const hp = model.hp ?? model.health ?? 0;
    const maxHp = model.maxHp ?? model.maxHealth ?? 1;
    this.e.bossName.textContent = String(model.name || 'ABYSSAL GUARDIAN').toUpperCase();
    this.e.bossPhase.textContent = String(model.phaseLabel || model.phase || 'PHASE I').toUpperCase();
    this.e.bossHealthFill.style.width = percentWidth(ratio(hp, maxHp));
    this.e.bossHud.classList.remove('is-hidden');
  }

  toast(message, options = {}) {
    if (typeof options === 'number') options = { duration: options };
    globalThis.clearTimeout(this._toastTimer);
    this.e.toastLayer.textContent = String(message || '');
    this.e.toastLayer.dataset.tone = options.tone || 'neutral';
    if (options.announce !== false) this.announce(message);
    this._toastTimer = globalThis.setTimeout(() => {
      this.e.toastLayer.textContent = '';
      delete this.e.toastLayer.dataset.tone;
    }, Math.max(400, finite(options.duration, 2200)));
  }

  roomBanner(title, subtitle = '', duration = 1800) {
    globalThis.clearTimeout(this._bannerTimer);
    this.e.roomBanner.textContent = subtitle ? `${title} · ${subtitle}` : String(title || '');
    this.e.roomBanner.classList.remove('is-hidden');
    this.announce(subtitle ? `${title}. ${subtitle}` : title);
    this._bannerTimer = globalThis.setTimeout(() => {
      this.e.roomBanner.classList.add('is-hidden');
    }, Math.max(400, duration));
  }

  damageFlash(duration = 150) {
    globalThis.clearTimeout(this._damageTimer);
    this.e.damageVignette.classList.add('is-active');
    this._damageTimer = globalThis.setTimeout(() => {
      this.e.damageVignette.classList.remove('is-active');
    }, Math.max(60, duration));
  }

  announce(message) {
    this.e.ariaLive.textContent = '';
    requestAnimationFrame(() => {
      this.e.ariaLive.textContent = String(message || '');
    });
  }

  setMuted(muted) {
    this.e.soundToggle.setAttribute('aria-pressed', String(!muted));
    const label = this.e.soundToggle.querySelector('.utility-label');
    if (label) label.textContent = muted ? 'MUTED' : 'SOUND';
  }

  setFullscreen(active) {
    this.e.fullscreenToggle.setAttribute('aria-pressed', String(Boolean(active)));
  }

  destroy() {
    this.e.screenPanel.removeEventListener('click', this._boundCommand);
    this.e.soundToggle.removeEventListener('click', this._boundSound);
    this.e.fullscreenToggle.removeEventListener('click', this._boundFullscreen);
    globalThis.clearTimeout(this._toastTimer);
    globalThis.clearTimeout(this._bannerTimer);
    globalThis.clearTimeout(this._damageTimer);
    globalThis.clearTimeout(this._loadingTimer);
  }
}

export const PRESENTATION_DEFAULTS = Object.freeze({
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  tileSize: TILE_SIZE,
  saveKey: SAVE_KEY_V2,
  legacySaveKey: SAVE_KEY_V1,
});
