(() => {
  "use strict";

  const W = 960;
  const H = 540;
  const ROOM = { x: 82, y: 92, w: 796, h: 374 };
  const TAU = Math.PI * 2;
  const TILE_ROOT = "assets/vendor/tiny-dungeon/Tiles/";

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const rand = (a, b) => a + Math.random() * (b - a);
  const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const formatValue = (n) => `${Math.round(n).toLocaleString()}c`;
  const tilePath = (id) => `${TILE_ROOT}tile_${String(id).padStart(4, "0")}.png`;

  const SPRITES = {
    floorDark: 0,
    floorStone: 48,
    wall: 14,
    wallMoss: 28,
    wallCrystal: 40,
    gate: 67,
    basin: 82,
    player: 98,
    playerAlt: 96,
    shield: 102,
    sword: 103,
    swordHeavy: 105,
    rat: 120,
    shade: 121,
    brute: 110,
    guardian: 122,
    collector: 97,
    coin: 113,
    crystal: 101,
    idol: 108,
    hammer: 117,
    potion: 114,
    torch: 125,
    brazier: 29,
    crate: 63,
    gravestone: 65,
  };

  const FLOOR_DEFS = [
    {
      name: "THE MOSSY SHAFT",
      depth: "240 fathoms",
      accent: "#73d18b",
      glow: "#315f4b",
      floor: "#242d2b",
      wall: "#141c1c",
      spriteFloor: SPRITES.floorDark,
      spriteWall: SPRITES.wallMoss,
      guardian: "The Rootbound",
      enemies: ["rat", "rat", "shade"],
      obstacles: [
        { x: 245, y: 190, w: 72, h: 38 },
        { x: 641, y: 330, w: 72, h: 38 },
        { x: 438, y: 262, w: 84, h: 38 },
      ],
      relic: { id: "moss_idol", name: "Moss-Eyed Idol", kind: "idol", value: 115, weight: 24, curse: 0.12, lore: "+12% enemy aggression" },
    },
    {
      name: "THE CRYSTAL VEINS",
      depth: "510 fathoms",
      accent: "#6ee7ef",
      glow: "#325d73",
      floor: "#202837",
      wall: "#121827",
      spriteFloor: SPRITES.floorStone,
      spriteWall: SPRITES.wallCrystal,
      guardian: "The Glass Saint",
      enemies: ["shade", "shade", "brute"],
      obstacles: [
        { x: 178, y: 285, w: 96, h: 42 },
        { x: 686, y: 225, w: 96, h: 42 },
        { x: 425, y: 170, w: 110, h: 38 },
        { x: 425, y: 355, w: 110, h: 38 },
      ],
      relic: { id: "glass_heart", name: "Glass Heart", kind: "crystal", value: 220, weight: 34, curse: 0.08, lore: "+8% enemy aggression" },
    },
    {
      name: "THE SUNKEN FOUNDRY",
      depth: "900 fathoms",
      accent: "#f4a261",
      glow: "#7a3e2a",
      floor: "#302521",
      wall: "#1d1514",
      spriteFloor: SPRITES.floorDark,
      spriteWall: SPRITES.wall,
      guardian: "The Furnace King",
      enemies: ["brute", "brute", "shade", "rat"],
      obstacles: [
        { x: 212, y: 205, w: 76, h: 96 },
        { x: 672, y: 257, w: 76, h: 96 },
        { x: 408, y: 255, w: 144, h: 46 },
      ],
      relic: { id: "anvil_crown", name: "Anvil Crown", kind: "armament", value: 370, weight: 46, armament: 1, lore: "+8 strike damage" },
    },
  ];

  const ENEMY_DEFS = {
    rat: { sprite: SPRITES.rat, name: "Gutter Rat", r: 11, hp: 34, speed: 88, damage: 7, range: 32, windup: 0.62, recover: 0.58, poise: 36, value: 18, weight: 3 },
    shade: { sprite: SPRITES.shade, name: "Hollow Shade", r: 15, hp: 55, speed: 68, damage: 11, range: 40, windup: 0.78, recover: 0.76, poise: 48, value: 26, weight: 4 },
    brute: { sprite: SPRITES.brute, name: "Cinder Brute", r: 17, hp: 82, speed: 55, damage: 15, range: 48, windup: 0.94, recover: 0.88, poise: 68, value: 38, weight: 6 },
    guardian: { sprite: SPRITES.guardian, name: "Gate Guardian", r: 24, hp: 190, speed: 50, damage: 20, range: 58, windup: 1.08, recover: 0.88, poise: 108, value: 0, weight: 0 },
    collector: { sprite: SPRITES.collector, name: "Tax Collector", r: 20, hp: 170, speed: 61, damage: 18, range: 55, windup: 0.9, recover: 0.74, poise: 88, value: 0, weight: 0 },
  };

  const DEFAULT_META = {
    version: 1,
    grit: 0,
    totalExtracted: 0,
    deepest: 0,
    runs: 0,
    victories: 0,
    upgrades: { pulleys: 0, lungs: 0, reflex: 0, blacksmith: 0 },
    shortcuts: [true, false, false],
    muted: false,
  };

  class SaveStore {
    constructor(key = "abyssal-weight-save-v1") {
      this.key = key;
    }

    load() {
      try {
        const raw = JSON.parse(localStorage.getItem(this.key));
        if (!raw || raw.version !== 1) return structuredClone(DEFAULT_META);
        const meta = structuredClone(DEFAULT_META);
        Object.assign(meta, raw);
        meta.upgrades = { ...DEFAULT_META.upgrades, ...(raw.upgrades || {}) };
        meta.shortcuts = Array.isArray(raw.shortcuts) ? [true, !!raw.shortcuts[1], !!raw.shortcuts[2]] : [true, false, false];
        for (const key of Object.keys(meta.upgrades)) meta.upgrades[key] = clamp(Number(meta.upgrades[key]) || 0, 0, key === "blacksmith" ? 1 : 3);
        meta.grit = Math.max(0, Math.floor(Number(meta.grit) || 0));
        return meta;
      } catch (_) {
        return structuredClone(DEFAULT_META);
      }
    }

    save(meta) {
      try { localStorage.setItem(this.key, JSON.stringify(meta)); } catch (_) { /* private mode */ }
    }
  }

  class Input {
    constructor(canvas) {
      this.canvas = canvas;
      this.down = new Set();
      this.pressed = new Set();
      this.released = new Set();
      this.pointer = { x: W / 2, y: H / 2, active: false, left: false, right: false };
      this.actionBindings = {
        up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"],
        left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
        attack: ["KeyJ"], block: ["KeyK"], dodge: ["Space", "ShiftLeft", "ShiftRight"],
        interact: ["KeyE", "Enter"], pause: ["Escape", "KeyP"], mute: ["KeyM"],
      };
      this.bind();
    }

    bind() {
      addEventListener("keydown", (e) => {
        const tag = e.target?.tagName;
        if (["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(tag) && e.target !== this.canvas) return;
        if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
        if (!this.down.has(e.code)) this.pressed.add(e.code);
        this.down.add(e.code);
      });
      addEventListener("keyup", (e) => {
        this.down.delete(e.code);
        this.released.add(e.code);
      });
      addEventListener("blur", () => { this.down.clear(); this.pointer.left = false; this.pointer.right = false; });

      const mapPointer = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.x = (e.clientX - rect.left) * W / rect.width;
        this.pointer.y = (e.clientY - rect.top) * H / rect.height;
        this.pointer.active = true;
      };
      this.canvas.addEventListener("pointermove", mapPointer);
      this.canvas.addEventListener("pointerdown", (e) => {
        mapPointer(e);
        this.canvas.focus({ preventScroll: true });
        if (e.button === 0) { this.pointer.left = true; this.pressed.add("Mouse0"); }
        if (e.button === 2) { this.pointer.right = true; this.pressed.add("Mouse2"); }
        this.canvas.setPointerCapture?.(e.pointerId);
      });
      this.canvas.addEventListener("pointerup", (e) => {
        mapPointer(e);
        if (e.button === 0) { this.pointer.left = false; this.released.add("Mouse0"); }
        if (e.button === 2) { this.pointer.right = false; this.released.add("Mouse2"); }
      });
      this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

      document.querySelectorAll("[data-action]").forEach((button) => {
        const action = button.dataset.action;
        const code = `Touch:${action}`;
        const start = (e) => { e.preventDefault(); this.pointer.active = false; if (!this.down.has(code)) this.pressed.add(code); this.down.add(code); };
        const end = (e) => { e.preventDefault(); this.down.delete(code); this.released.add(code); };
        button.addEventListener("pointerdown", start);
        button.addEventListener("pointerup", end);
        button.addEventListener("pointercancel", end);
      });
    }

    held(action) {
      const codes = this.actionBindings[action] || [];
      if (codes.some((c) => this.down.has(c)) || this.down.has(`Touch:${action}`)) return true;
      if (action === "attack") return this.pointer.left;
      if (action === "block") return this.pointer.right;
      return false;
    }

    wasPressed(action) {
      const codes = this.actionBindings[action] || [];
      if (codes.some((c) => this.pressed.has(c)) || this.pressed.has(`Touch:${action}`)) return true;
      if (action === "attack") return this.pressed.has("Mouse0");
      if (action === "block") return this.pressed.has("Mouse2");
      return false;
    }

    endFrame() {
      this.pressed.clear();
      this.released.clear();
    }
  }

  class AssetBank {
    constructor() {
      this.images = new Map();
    }

    async load() {
      const ids = [...new Set(Object.values(SPRITES))];
      await Promise.all(ids.map((id) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { this.images.set(id, img); resolve(); };
        img.onerror = () => resolve();
        img.src = tilePath(id);
      })));
    }

    get(id) { return this.images.get(id); }
  }

  class Game {
    constructor() {
      this.canvas = document.getElementById("gameCanvas");
      this.ctx = this.canvas.getContext("2d");
      this.ctx.imageSmoothingEnabled = false;
      this.canvas.width = W;
      this.canvas.height = H;
      this.input = new Input(this.canvas);
      this.assets = new AssetBank();
      this.store = new SaveStore();
      this.meta = this.store.load();
      this.audio = new window.AudioEngine();
      this.audio.setMuted(this.meta.muted);
      this.scene = "loading";
      this.previousScene = "title";
      this.run = null;
      this.player = null;
      this.enemies = [];
      this.lootDrops = [];
      this.projectiles = [];
      this.particles = [];
      this.floaters = [];
      this.uiButtons = [];
      this.time = 0;
      this.last = performance.now();
      this.accumulator = 0;
      this.shake = 0;
      this.flash = { color: "#fff", alpha: 0 };
      this.toast = null;
      this.floorBanner = 0;
      this.roomClearTimer = -1;
      this.guardianPending = false;
      this.guardianSpawnTimer = 1.15;
      this.basinOpened = false;
      this.transition = { alpha: 1, dir: -1, callback: null };
      this.selectedRoute = 0;
      this.hoveredButton = null;
      this.clickConsumed = false;
      this.stats = { parries: 0, perfects: 0, executions: 0, damage: 0 };
      this.qa = new URLSearchParams(location.search).has("qa") && ["localhost", "127.0.0.1"].includes(location.hostname);
      this.reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
      this.bindUI();
    }

    async init() {
      await this.assets.load();
      const loading = document.getElementById("loadingScreen");
      loading?.classList.add("is-hidden");
      this.scene = "title";
      this.audio.setMode("hub");
      requestAnimationFrame((t) => this.frame(t));
    }

    bindUI() {
      const sound = document.getElementById("soundToggle");
      const updateSoundLabel = () => {
        if (!sound) return;
        const label = sound.querySelector(".utility-label");
        if (label) label.textContent = this.meta.muted ? "OFF" : "SOUND";
        sound.setAttribute("aria-pressed", String(!this.meta.muted));
      };
      sound?.addEventListener("click", () => {
        this.audio.unlock();
        this.meta.muted = this.audio.toggleMuted();
        this.store.save(this.meta);
        updateSoundLabel();
      });
      updateSoundLabel();
      const fullscreen = document.getElementById("fullscreenToggle");
      const updateFullscreen = () => fullscreen?.setAttribute("aria-pressed", String(!!document.fullscreenElement));
      fullscreen?.addEventListener("click", () => {
        const shell = document.querySelector(".page-shell");
        if (!document.fullscreenElement) shell?.requestFullscreen?.(); else document.exitFullscreen?.();
      });
      document.addEventListener("fullscreenchange", updateFullscreen);
      updateFullscreen();
      this.canvas.addEventListener("pointerdown", () => this.audio.unlock(), { once: true });
      addEventListener("keydown", () => this.audio.unlock(), { once: true });
    }

    announce(text) {
      const live = document.getElementById("ariaLive");
      if (live) live.textContent = text;
    }

    frame(now) {
      const raw = Math.min(0.1, (now - this.last) / 1000 || 0);
      this.last = now;
      this.accumulator += raw;
      const step = 1 / 60;
      let stepped = false;
      while (this.accumulator >= step) {
        this.update(step);
        if (!stepped) {
          this.input.endFrame();
          stepped = true;
        }
        this.accumulator -= step;
      }
      this.render();
      requestAnimationFrame((t) => this.frame(t));
    }

    update(dt) {
      this.time += dt;
      this.clickConsumed = false;
      this.handleSceneControls();
      this.shake = Math.max(0, this.shake - dt * 18);
      this.flash.alpha = Math.max(0, this.flash.alpha - dt * 2.8);
      if (this.toast) {
        this.toast.time -= dt;
        if (this.toast.time <= 0) this.toast = null;
      }
      if (this.floorBanner > 0) this.floorBanner -= dt;
      this.updateTransition(dt);

      if (this.input.wasPressed("mute")) {
        this.meta.muted = this.audio.toggleMuted();
        this.store.save(this.meta);
        const sound = document.getElementById("soundToggle");
        const label = sound?.querySelector(".utility-label");
        if (label) label.textContent = this.meta.muted ? "OFF" : "SOUND";
        sound?.setAttribute("aria-pressed", String(!this.meta.muted));
      }

      if (this.scene === "playing" && this.input.wasPressed("pause")) this.pause();
      else if (this.scene === "pause" && this.input.wasPressed("pause")) this.resume();

      if (this.scene === "playing" && this.transition.dir <= 0) this.updatePlaying(dt);
      else this.updateAmbient(dt);

      for (const p of this.particles) {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
      for (const f of this.floaters) { f.life -= dt; f.y -= 22 * dt; }
      this.floaters = this.floaters.filter((f) => f.life > 0);
    }

    updateAmbient(dt) {
      if (!this.reducedMotion && Math.random() < dt * 7) {
        this.particles.push({ x: rand(70, 890), y: rand(80, 500), vx: rand(-3, 3), vy: rand(-10, -3), life: rand(1.5, 4), max: 4, color: "#d9b26f", size: Math.random() < 0.7 ? 1 : 2, ambient: true });
      }
    }

    handleSceneControls() {
      if (this.qa) this.handleQAControls();
      if (this.input.pressed.has("Mouse0") && this.input.pointer.active) {
        const p = this.input.pointer;
        const button = [...this.uiButtons].reverse().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
        if (button && !button.disabled) {
          this.clickConsumed = true;
          this.audio.sfx("ui");
          button.action?.();
          return;
        }
      }
      if (this.scene === "title" && (this.input.wasPressed("interact") || this.input.wasPressed("attack"))) this.enterHub();
      else if (this.scene === "hub") {
        if (this.input.wasPressed("interact")) this.beginRun();
        else if (this.input.pressed.has("KeyR")) this.cycleRoute();
        else if (this.input.pressed.has("Digit1")) this.buyUpgrade("pulleys");
        else if (this.input.pressed.has("Digit2")) this.buyUpgrade("lungs");
        else if (this.input.pressed.has("Digit3")) this.buyUpgrade("reflex");
        else if (this.input.pressed.has("Digit4")) this.buyUpgrade("blacksmith");
      }
      else if (this.scene === "basin") {
        if (this.input.pressed.has("Digit1")) this.useBalloon();
        else if (this.input.pressed.has("Digit2")) this.descendDeeper();
        else if (this.input.pressed.has("Digit3") || this.input.wasPressed("interact")) this.shoulderBurden();
      }
      else if (this.scene === "runend" && this.input.wasPressed("interact")) this.enterHub();
      else if (this.scene === "pause") {
        if (this.input.pressed.has("KeyQ")) this.endRun(false, "YOU CUT THE ROPE");
        else if (this.input.wasPressed("interact")) this.resume();
      }
    }

    handleQAControls() {
      if (this.input.pressed.has("F8") && this.scene === "playing") {
        for (const enemy of [...this.enemies]) this.killEnemy(enemy);
        this.player.hp = this.player.maxHp;
        for (const drop of this.lootDrops) { drop.x = this.player.x; drop.y = this.player.y; drop.life = 1; }
      }
      if (this.input.pressed.has("F7") && this.scene === "playing") {
        for (const drop of [...this.lootDrops]) { this.collectLoot(drop.item); drop.collected = true; }
        this.lootDrops = [];
      }
      if (this.input.pressed.has("F9") && this.scene === "playing") {
        if (this.run.phase === "descent") {
          if (this.guardianPending && this.enemies.length === 0) this.guardianSpawnTimer = 0;
          else if (this.enemies.length === 0) this.openBasin();
        } else if (this.enemies.length === 0) this.climbUp();
      }
      if (this.input.pressed.has("F6") && this.scene === "basin") this.descendDeeper();
      if (this.input.pressed.has("F5") && this.scene === "basin") this.shoulderBurden();
    }

    enterHub() {
      if (this.scene === "hub" || this.transition.dir > 0) return;
      this.audio.unlock();
      this.transitionTo(() => {
        this.scene = "hub";
        this.audio.setMode("hub");
        this.announce(`Surface refuge. You have ${this.meta.grit} Grit. Press Enter to start, R to change route, or 1 through 4 for upgrades.`);
      });
    }

    beginRun() {
      if (this.transition.dir > 0) return;
      const start = clamp(this.selectedRoute, 0, 2);
      if (!this.meta.shortcuts[start]) this.selectedRoute = 0;
      this.transitionTo(() => {
        this.meta.runs += 1;
        this.store.save(this.meta);
        this.stats = { parries: 0, perfects: 0, executions: 0, damage: 0 };
        this.run = {
          phase: "descent",
          floor: this.selectedRoute,
          startFloor: this.selectedRoute,
          deepestFloor: this.selectedRoute,
          cachedLoot: [],
          satchel: [],
          carriedLoot: [],
          balloonedValue: 0,
          balloonedGrit: 0,
          balloonUsed: [false, false, false],
          cleared: [false, false, false],
          extractedValue: 0,
          startedAt: this.time,
          result: null,
        };
        this.player = this.makePlayer();
        this.input.pointer.active = false;
        this.scene = "playing";
        this.loadFloor(this.run.floor, "descent");
        this.audio.setMode("descent");
        this.announce(`Descending into ${FLOOR_DEFS[this.run.floor].name}.`);
      });
    }

    makePlayer() {
      const weapon = this.meta.upgrades.blacksmith > 0 ? "maul" : "sword";
      return {
        x: W / 2, y: ROOM.y + 58, vx: 0, vy: 0, r: 15,
        hp: 100, maxHp: 100, stamina: 100, maxStamina: 100,
        facing: Math.PI / 2, attackTime: 0, attackCooldown: 0, attackId: 0,
        dodgeTime: 0, invulnerable: 0, blockAge: 99, blocking: false,
        staminaDelay: 0, hurtTime: 0, counterTime: 0, guardBreak: 0, stepTimer: 0, weapon,
      };
    }

    loadFloor(index, phase) {
      this.run.floor = index;
      this.run.phase = phase;
      this.enemies = [];
      this.lootDrops = [];
      this.projectiles = [];
      this.roomClearTimer = -1;
      this.guardianPending = phase === "descent";
      this.guardianSpawnTimer = 1.15;
      this.basinOpened = false;
      const enteringFromTop = phase === "descent";
      this.player.x = W / 2;
      this.player.y = enteringFromTop ? ROOM.y + 56 : ROOM.y + ROOM.h - 52;
      this.player.vx = this.player.vy = 0;
      this.player.attackTime = this.player.attackCooldown = this.player.dodgeTime = 0;
      this.player.invulnerable = 2.65;
      this.floorBanner = 2.8;
      if (phase === "descent") this.spawnDescentEncounter(index);
      else this.spawnAscentEncounter(index);
      this.audio.setMode(phase);
    }

    spawnDescentEncounter(index) {
      const def = FLOOR_DEFS[index];
      const spots = [
        { x: 160, y: 160 }, { x: 800, y: 160 }, { x: 160, y: 400 },
        { x: 800, y: 400 }, { x: 480, y: 235 },
      ];
      def.enemies.forEach((type, i) => this.enemies.push(this.makeEnemy(type, spots[i % spots.length].x, spots[i % spots.length].y, index)));
      this.toastMessage(`${def.guardian} watches from below`, def.accent, 2.6);
    }

    spawnAscentEncounter(index) {
      const curse = this.getCurse();
      const collectorSpots = [{ x: 760, y: 250 }, { x: 480, y: 280 }, { x: 790, y: 205 }];
      const collector = this.makeEnemy("collector", collectorSpots[index].x, collectorSpots[index].y, index);
      collector.name = ["Tithe-Keeper Varn", "The Quartz Auditor", "Collector of Crowns"][index];
      collector.windup *= Math.max(0.7, 1 - curse * 0.4);
      collector.maxHp += index * 28;
      collector.hp = collector.maxHp;
      this.enemies.push(collector);
      if (index >= 1) this.enemies.push(this.makeEnemy(index === 1 ? "shade" : "brute", index === 1 ? 235 : 330, index === 1 ? 260 : 390, index, true));
      this.toastMessage(`THE TAX COLLECTOR · ${collector.name}`, "#e65d55", 2.8);
      this.audio.sfx("bossRoar");
    }

    makeEnemy(type, x, y, floor, ascentMinion = false) {
      const d = ENEMY_DEFS[type];
      const floorScale = 1 + floor * 0.16;
      return {
        type, name: d.name, sprite: d.sprite, x, y, vx: 0, vy: 0, r: d.r,
        hp: d.hp * floorScale, maxHp: d.hp * floorScale,
        speed: d.speed * (ascentMinion ? 1.08 : 1), damage: d.damage * floorScale,
        range: d.range, windup: d.windup, recover: d.recover,
        poise: d.poise, maxPoise: d.poise, value: d.value, weight: d.weight,
        state: "chase", timer: rand(0.15, 0.5), attackCooldown: rand(0.25, 0.9),
        targetAngle: 0, hitDone: false, stun: 0, stagger: 0, executable: false,
        flash: 0, dead: false, floor, phase: this.run?.phase || "descent",
        orbit: rand(0, TAU), specialCounter: rand(1.8, 3.5),
      };
    }

    getWeight() {
      if (!this.run || this.run.phase !== "ascent") return 0;
      return this.run.carriedLoot.reduce((sum, item) => sum + item.weight, 0);
    }

    getWeightRatio() { return Math.max(0, this.getWeight() / 100); }

    getWeightTier() {
      const w = this.getWeightRatio();
      if (w < 0.25) return { id: "LIGHT", color: "#70e1a1", speed: 1, regen: 1, dodgeCost: 22, iframes: 0.24 };
      if (w <= 0.75) return { id: "MID", color: "#e8c56a", speed: 0.9, regen: 0.78, dodgeCost: 30, iframes: 0.11 };
      return { id: "HEAVY", color: "#eb665c", speed: 0.72, regen: 0.48, dodgeCost: 38, iframes: 0 };
    }

    getCurse() {
      return (this.run?.carriedLoot || []).reduce((sum, item) => sum + (item.curse || 0), 0);
    }

    getArmamentBonus() {
      return (this.run?.carriedLoot || []).reduce((sum, item) => sum + (item.armament ? 8 : 0), 0);
    }

    updatePlaying(dt) {
      if (!this.run || !this.player) return;
      this.updatePlayer(dt);
      for (const enemy of this.enemies) this.updateEnemy(enemy, dt);
      this.separateEnemies();
      this.updateProjectiles(dt);
      this.updateLoot(dt);
      this.enemies = this.enemies.filter((e) => !e.dead);

      const livingThreats = this.enemies.filter((e) => !e.dead).length;
      this.audio.setCombatIntensity(clamp(livingThreats / 4, 0, 1));
      if (livingThreats === 0) {
        if (this.guardianPending && this.run.phase === "descent") {
          this.guardianSpawnTimer -= dt;
          if (this.guardianSpawnTimer <= 0) {
            this.guardianPending = false;
            const guardian = this.makeEnemy("guardian", 760, 390, this.run.floor);
            guardian.name = FLOOR_DEFS[this.run.floor].guardian;
            this.enemies.push(guardian);
            this.player.invulnerable = Math.max(this.player.invulnerable, 0.8);
            this.audio.setMode("boss");
            this.audio.sfx("bossRoar");
            this.toastMessage(`${guardian.name.toUpperCase()} · GATE GUARDIAN`, FLOOR_DEFS[this.run.floor].accent, 2.5);
          }
          return;
        }
        if (this.roomClearTimer < 0) {
          this.roomClearTimer = 0;
          this.audio.setMode(this.run.phase);
          this.toastMessage(this.run.phase === "descent" ? "BASIN UNSEALED" : "TITHE BROKEN · UPWARD GATE OPEN", "#f0cd72", 2.4);
          this.audio.sfx("basin");
        } else this.roomClearTimer += dt;
      }

      if (this.roomClearTimer >= 0.5) {
        const targetY = this.run.phase === "descent" ? ROOM.y + ROOM.h - 24 : ROOM.y + 24;
        const nearGate = Math.abs(this.player.y - targetY) < 62 && Math.abs(this.player.x - W / 2) < 88;
        if (nearGate && this.input.wasPressed("interact")) {
          if (this.run.phase === "descent") this.openBasin(); else this.climbUp();
        }
      }
    }

    updatePlayer(dt) {
      const p = this.player;
      const tier = this.getWeightTier();
      p.attackCooldown = Math.max(0, p.attackCooldown - dt);
      p.attackTime = Math.max(0, p.attackTime - dt);
      p.dodgeTime = Math.max(0, p.dodgeTime - dt);
      p.invulnerable = Math.max(0, p.invulnerable - dt);
      p.hurtTime = Math.max(0, p.hurtTime - dt);
      p.counterTime = Math.max(0, p.counterTime - dt);
      p.guardBreak = Math.max(0, p.guardBreak - dt);
      p.staminaDelay = Math.max(0, p.staminaDelay - dt);
      p.stepTimer = Math.max(-0.1, p.stepTimer - dt);

      let ax = (this.input.held("right") ? 1 : 0) - (this.input.held("left") ? 1 : 0);
      let ay = (this.input.held("down") ? 1 : 0) - (this.input.held("up") ? 1 : 0);
      const len = Math.hypot(ax, ay);
      if (len > 0) { ax /= len; ay /= len; }

      if (this.input.pointer.active && !this.input.down.has("Touch:attack")) {
        p.facing = Math.atan2(this.input.pointer.y - p.y, this.input.pointer.x - p.x);
      } else if (len > 0) p.facing = Math.atan2(ay, ax);

      const wasBlocking = p.blocking;
      p.blocking = this.input.held("block") && p.stamina > 1 && p.guardBreak <= 0 && p.dodgeTime <= 0 && p.attackTime <= 0;
      if (p.blocking && !wasBlocking) {
        p.blockAge = 0;
        this.audio.sfx("block", { volume: 0.34, pitch: 0.82 });
      } else if (p.blocking) {
        p.blockAge += dt;
        p.stamina = Math.max(0, p.stamina - dt * 5.5);
        p.staminaDelay = 0.25;
        if (p.stamina <= 1) {
          p.stamina = 0;
          p.blocking = false;
          p.guardBreak = 0.75;
          p.blockAge = 99;
          p.hurtTime = 0.25;
          this.audio.sfx("hurt", { volume: 0.42, pitch: 0.72 });
        }
      } else p.blockAge += dt;

      if (this.input.wasPressed("dodge") && p.dodgeTime <= 0 && p.stamina >= tier.dodgeCost && !p.blocking) {
        let dx = ax; let dy = ay;
        if (!len) { dx = Math.cos(p.facing); dy = Math.sin(p.facing); }
        p.vx = dx * (tier.id === "HEAVY" ? 285 : 390);
        p.vy = dy * (tier.id === "HEAVY" ? 285 : 390);
        p.dodgeTime = tier.id === "HEAVY" ? 0.22 : 0.19;
        p.invulnerable = Math.max(p.invulnerable, tier.iframes);
        p.stamina -= tier.dodgeCost;
        p.staminaDelay = 0.8;
        this.audio.sfx("dodge", { heavy: tier.id === "HEAVY" });
        this.spawnBurst(p.x, p.y, tier.color, 9, 85);
        if (tier.id === "HEAVY" && !this.run.heavyWarned) {
          this.run.heavyWarned = true;
          this.toastMessage("HEAVY LUNGE · NO I-FRAMES", "#eb665c", 3);
        }
      }

      if (!this.clickConsumed && this.input.wasPressed("attack") && p.attackCooldown <= 0 && p.dodgeTime <= 0 && !p.blocking) {
        this.playerAttack();
      }

      if (p.dodgeTime <= 0) {
        const speed = 172 * tier.speed * (p.blocking ? 0.42 : 1) * (p.attackTime > 0 ? 0.62 : 1);
        p.vx = lerp(p.vx, ax * speed, 1 - Math.pow(0.001, dt));
        p.vy = lerp(p.vy, ay * speed, 1 - Math.pow(0.001, dt));
      }
      this.moveEntity(p, p.vx * dt, p.vy * dt);

      if (len > 0 && p.dodgeTime <= 0 && !p.blocking && p.stepTimer <= 0) {
        this.audio.sfx("step", { heavy: tier.id === "HEAVY", volume: 0.58 });
        p.stepTimer = tier.id === "HEAVY" ? 0.44 : 0.31;
      }

      if (p.staminaDelay <= 0 && !p.blocking) {
        const lungs = this.run.phase === "ascent" ? 1 + this.meta.upgrades.lungs * 0.14 : 1;
        p.stamina = Math.min(p.maxStamina, p.stamina + 31 * tier.regen * lungs * dt);
      }
    }

    playerAttack() {
      const p = this.player;
      const heavyWeapon = p.weapon === "maul";
      const cost = heavyWeapon ? 14 : 9;
      if (p.stamina < cost) { this.toastMessage("TOO EXHAUSTED", "#e5a09b", 0.8); return; }
      p.stamina -= cost;
      p.staminaDelay = 0.62;
      p.attackTime = heavyWeapon ? 0.28 : 0.21;
      p.attackCooldown = heavyWeapon ? 0.48 : 0.32;
      p.attackId += 1;
      const range = (heavyWeapon ? 62 : 52) + this.getArmamentBonus() * 0.25;
      const damage = (heavyWeapon ? 30 : 22) + this.getArmamentBonus() + (p.counterTime > 0 ? 8 : 0);
      this.audio.sfx("attack", { heavy: heavyWeapon });
      let hit = false;
      let impactKind = "normal";
      for (const enemy of this.enemies) {
        if (enemy.dead || enemy.state === "dying") continue;
        const a = Math.atan2(enemy.y - p.y, enemy.x - p.x);
        if (dist(p, enemy) <= range + enemy.r && Math.abs(angleDiff(a, p.facing)) < 1.02) {
          hit = true;
          if (enemy.executable && enemy.stagger > 0 && dist(p, enemy) < 58 + enemy.r) {
            impactKind = "execution";
            this.executeEnemy(enemy);
          } else {
            const dealt = damage * (enemy.type === "collector" && enemy.state !== "stunned" ? 0.82 : 1);
            if (enemy.hp <= dealt && (enemy.type === "guardian" || enemy.type === "collector") && impactKind !== "execution") impactKind = "boss";
            this.damageEnemy(enemy, dealt, heavyWeapon ? 25 : 15, a);
          }
        }
      }
      if (hit && impactKind === "boss") this.audio.sfx("execute");
      else if (hit && impactKind !== "execution") this.audio.sfx("enemyHit", { heavy: heavyWeapon });
      this.spawnSlash(p.x, p.y, p.facing, range);
    }

    damageEnemy(enemy, damage, poiseDamage, angle) {
      enemy.hp -= damage;
      enemy.poise -= poiseDamage;
      enemy.flash = 0.13;
      enemy.vx += Math.cos(angle) * 65;
      enemy.vy += Math.sin(angle) * 65;
      this.floaters.push({ x: enemy.x, y: enemy.y - enemy.r, text: Math.round(damage), color: "#ffe0a3", life: 0.7, max: 0.7 });
      this.spawnBurst(enemy.x, enemy.y, "#e8b06e", 6, 75);
      if (enemy.hp <= 0) this.killEnemy(enemy);
      else if (enemy.poise <= 0) this.staggerEnemy(enemy);
    }

    staggerEnemy(enemy) {
      enemy.poise = enemy.maxPoise;
      enemy.state = "stunned";
      enemy.stagger = enemy.type === "guardian" || enemy.type === "collector" ? 1.45 : 2.2;
      enemy.executable = true;
      enemy.vx = enemy.vy = 0;
      this.audio.sfx("stagger");
      this.toastMessage("POISE BROKEN · STRIKE TO EXECUTE", "#f6d477", 1.5);
      this.spawnBurst(enemy.x, enemy.y, "#f6d477", 14, 120);
    }

    executeEnemy(enemy) {
      this.stats.executions += 1;
      enemy.hp -= enemy.type === "guardian" || enemy.type === "collector" ? 82 : 999;
      enemy.executable = false;
      enemy.stagger = 0;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 8);
      this.player.invulnerable = 0.32;
      this.audio.sfx("execute");
      this.shake = 12;
      this.flash = { color: "#f8d781", alpha: 0.34 };
      this.floaters.push({ x: enemy.x, y: enemy.y - 30, text: "EXECUTION", color: "#f8d781", life: 1.1, max: 1.1 });
      this.spawnBurst(enemy.x, enemy.y, "#f8d781", 26, 190);
      if (enemy.hp <= 0) this.killEnemy(enemy); else { enemy.state = "stunned"; enemy.stagger = 0.45; }
    }

    updateEnemy(e, dt) {
      if (e.dead) return;
      e.flash = Math.max(0, e.flash - dt);
      e.attackCooldown -= dt;
      e.specialCounter -= dt;
      e.orbit += dt;
      if (e.state === "stunned") {
        e.stagger -= dt;
        e.vx *= Math.pow(0.02, dt); e.vy *= Math.pow(0.02, dt);
        this.moveEntity(e, e.vx * dt, e.vy * dt);
        if (e.stagger <= 0) { e.state = "chase"; e.executable = false; e.attackCooldown = 0.55; }
        return;
      }

      const p = this.player;
      const d = dist(e, p);
      const toPlayer = Math.atan2(p.y - e.y, p.x - e.x);
      if (e.state === "chase") {
        const aggro = 1 + this.getCurse();
        const desired = toPlayer + Math.sin(e.orbit * 1.7) * (d > 120 ? 0.28 : 0.08);
        const speed = e.speed * aggro * (d < 70 ? 0.5 : 1);
        e.vx = lerp(e.vx, Math.cos(desired) * speed, 1 - Math.pow(0.012, dt));
        e.vy = lerp(e.vy, Math.sin(desired) * speed, 1 - Math.pow(0.012, dt));
        if (e.attackCooldown <= 0 && d < e.range + p.r + 8) this.startEnemyAttack(e, false);
        else if ((e.type === "guardian" || e.type === "collector") && e.specialCounter <= 0 && d < 310) this.startEnemyAttack(e, true);
      } else if (e.state === "windup") {
        e.vx *= Math.pow(0.006, dt); e.vy *= Math.pow(0.006, dt);
        e.timer -= dt;
        if (e.timer <= 0) {
          e.state = "strike";
          e.timer = e.special ? 0.18 : 0.14;
          e.hitDone = false;
          this.enemyStrike(e);
        }
      } else if (e.state === "strike") {
        e.timer -= dt;
        if (!e.special) {
          const lunge = e.type === "rat" ? 240 : e.type === "guardian" ? 205 : 150;
          this.moveEntity(e, Math.cos(e.targetAngle) * lunge * dt, Math.sin(e.targetAngle) * lunge * dt);
          if (!e.hitDone && dist(e, p) <= e.range + p.r) {
            e.hitDone = true;
            this.resolveEnemyHit(e, e.damage, e.targetAngle);
          }
        }
        if (e.timer <= 0) { e.state = "recover"; e.timer = e.recover; e.vx = e.vy = 0; }
      } else if (e.state === "recover") {
        e.timer -= dt;
        e.vx *= Math.pow(0.01, dt); e.vy *= Math.pow(0.01, dt);
        if (e.timer <= 0) { e.state = "chase"; e.attackCooldown = rand(0.35, 0.8); }
      }
      if (e.state === "chase") this.moveEntity(e, e.vx * dt, e.vy * dt);
    }

    startEnemyAttack(e, special) {
      e.state = "windup";
      e.special = special;
      e.targetAngle = Math.atan2(this.player.y - e.y, this.player.x - e.x);
      e.timer = e.windup * (special ? 1.18 : 1);
      e.hitDone = false;
      if (special) e.specialCounter = rand(3.7, 5.4);
      this.audio.sfx("ui", { pitch: special ? 0.58 : 0.78, volume: special ? 0.9 : 0.58 });
    }

    enemyStrike(e) {
      if (!e.special) {
        this.audio.sfx("attack", { heavy: e.type === "brute" || e.type === "guardian" || e.type === "collector", pitch: 0.72, volume: 0.58 });
        return;
      }
      const count = e.type === "collector" ? 3 : 7;
      const base = e.type === "collector" ? e.targetAngle : 0;
      for (let i = 0; i < count; i++) {
        const spread = e.type === "collector" ? (i - 1) * 0.23 : i * TAU / count;
        const a = base + spread;
        this.projectiles.push({ x: e.x, y: e.y, vx: Math.cos(a) * (e.type === "collector" ? 225 : 165), vy: Math.sin(a) * (e.type === "collector" ? 225 : 165), r: e.type === "collector" ? 6 : 7, damage: e.damage * 0.72, life: 3, color: FLOOR_DEFS[e.floor].accent, owner: e });
      }
      this.audio.sfx("attack", { heavy: true });
      this.shake = 5;
    }

    resolveEnemyHit(enemy, damage, attackAngle) {
      const p = this.player;
      if (p.invulnerable > 0) return;
      const facingEnemy = Math.abs(angleDiff(Math.atan2(enemy.y - p.y, enemy.x - p.x), p.facing)) < 1.18;
      if (p.attackTime > 0.055 && facingEnemy) {
        this.stats.parries += 1;
        enemy.state = "stunned";
        enemy.stagger = enemy.type === "guardian" || enemy.type === "collector" ? 1.2 : 1.8;
        enemy.executable = true;
        enemy.poise -= 78;
        p.invulnerable = 0.28;
        p.counterTime = 1.1;
        this.audio.sfx("parry");
        this.shake = 10;
        this.flash = { color: "#d8fbff", alpha: 0.3 };
        this.floaters.push({ x: p.x, y: p.y - 28, text: "PARRY", color: "#9ff4ff", life: 0.9, max: 0.9 });
        this.spawnBurst((p.x + enemy.x) / 2, (p.y + enemy.y) / 2, "#c5f8ff", 24, 180);
        if (enemy.poise <= 0) this.staggerEnemy(enemy);
        return;
      }
      if (p.blocking && facingEnemy) {
        const window = 0.12 + this.meta.upgrades.reflex * 0.026;
        if (p.blockAge <= window) {
          this.stats.perfects += 1;
          p.counterTime = 0.9;
          enemy.state = "stunned";
          enemy.stagger = 0.48;
          enemy.executable = false;
          enemy.poise -= 24;
          this.audio.sfx("perfect");
          this.shake = 6;
          this.floaters.push({ x: p.x, y: p.y - 26, text: "PERFECT", color: "#f4dc89", life: 0.85, max: 0.85 });
          this.spawnBurst((p.x + enemy.x) / 2, (p.y + enemy.y) / 2, "#f7df8e", 16, 125);
          return;
        }
        const chip = Math.max(1, damage * 0.16);
        const staminaHit = damage * 2.1;
        p.stamina -= staminaHit;
        this.damagePlayer(chip, attackAngle, true);
        this.audio.sfx("block");
        if (p.stamina <= 0) {
          p.stamina = 0; p.blocking = false; p.guardBreak = 0.9; p.blockAge = 99; p.hurtTime = 0.45;
          this.toastMessage("GUARD BROKEN", "#eb665c", 1.3);
        }
        return;
      }
      this.damagePlayer(damage, attackAngle, false);
    }

    damagePlayer(damage, angle, chip = false) {
      const p = this.player;
      if (!chip && p.invulnerable > 0) return;
      p.hp -= damage;
      p.hurtTime = chip ? 0.12 : 0.42;
      p.invulnerable = chip ? 0.08 : 0.62;
      p.staminaDelay = 0.7;
      p.vx += Math.cos(angle) * (chip ? 45 : 145);
      p.vy += Math.sin(angle) * (chip ? 45 : 145);
      this.stats.damage += damage;
      this.audio.sfx("hurt", { volume: chip ? 0.36 : 1, pitch: chip ? 1.14 : 1 });
      this.shake = chip ? 3 : 9;
      this.flash = { color: "#e33f49", alpha: chip ? 0.12 : 0.28 };
      this.floaters.push({ x: p.x, y: p.y - 28, text: `-${Math.ceil(damage)}`, color: "#ff7772", life: 0.8, max: 0.8 });
      this.spawnBurst(p.x, p.y, "#d95555", chip ? 4 : 12, chip ? 55 : 130);
      if (p.hp <= 0) this.endRun(false, "THE ABYSS KEPT ITS DUE");
    }

    updateProjectiles(dt) {
      for (const shot of this.projectiles) {
        shot.life -= dt;
        shot.x += shot.vx * dt;
        shot.y += shot.vy * dt;
        if (shot.x < ROOM.x || shot.x > ROOM.x + ROOM.w || shot.y < ROOM.y || shot.y > ROOM.y + ROOM.h) shot.life = 0;
        if (shot.life > 0 && dist(shot, this.player) < shot.r + this.player.r) {
          const beforeParries = this.stats.parries;
          this.resolveEnemyHit(shot.owner, shot.damage, Math.atan2(shot.vy, shot.vx));
          if (this.stats.parries > beforeParries) {
            this.spawnBurst(shot.x, shot.y, "#bff8ff", 12, 150);
          }
          shot.life = 0;
        }
      }
      this.projectiles = this.projectiles.filter((p) => p.life > 0);
    }

    updateLoot(dt) {
      for (const drop of this.lootDrops) {
        drop.bob += dt * 4;
        drop.life += dt;
        const d = dist(drop, this.player);
        if (d < 120 && drop.life > 0.18) {
          const pull = d < 42 ? 650 : 125;
          drop.x += (this.player.x - drop.x) / Math.max(1, d) * pull * dt;
          drop.y += (this.player.y - drop.y) / Math.max(1, d) * pull * dt;
        }
        if (d < this.player.r + 18) {
          drop.collected = true;
          this.collectLoot(drop.item);
        }
      }
      this.lootDrops = this.lootDrops.filter((d) => !d.collected);
    }

    collectLoot(item) {
      if (this.run.phase !== "descent") return;
      this.run.satchel.push(item);
      this.audio.sfx("coin", { pitch: item.kind === "crystal" ? 1.25 : 1 });
      this.floaters.push({ x: this.player.x, y: this.player.y - 26, text: `${item.name} · ${formatValue(item.value)}`, color: FLOOR_DEFS[this.run.floor].accent, life: 1.25, max: 1.25 });
      this.toastMessage(`${item.name} sent toward the basin`, FLOOR_DEFS[this.run.floor].accent, 1.5);
    }

    killEnemy(enemy) {
      if (enemy.dead) return;
      enemy.dead = true;
      enemy.state = "dying";
      this.shake = enemy.type === "guardian" || enemy.type === "collector" ? 12 : 5;
      this.spawnBurst(enemy.x, enemy.y, FLOOR_DEFS[enemy.floor].accent, enemy.r > 20 ? 30 : 14, enemy.r > 20 ? 200 : 110);
      if (this.run.phase === "descent") {
        if (enemy.type === "guardian") {
          const relic = { ...FLOOR_DEFS[enemy.floor].relic };
          this.dropLoot(relic, enemy.x, enemy.y);
          this.run.cleared[enemy.floor] = true;
          if (enemy.floor < 2 && !this.meta.shortcuts[enemy.floor + 1]) {
            this.meta.shortcuts[enemy.floor + 1] = true;
            this.store.save(this.meta);
            this.toastMessage(`SHORTCUT TO DEPTH ${enemy.floor + 2} UNLOCKED`, "#f4cf75", 3.2);
          }
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + 18);
        } else if (enemy.value > 0) {
          const names = enemy.type === "rat" ? ["Old Mint", "Bone Coin"] : enemy.type === "shade" ? ["Grave Pearl", "Lost Signet"] : ["Cinder Ingot", "Iron Tithe"];
          const item = { id: `${enemy.type}_${Math.random().toString(36).slice(2)}`, name: names[Math.floor(Math.random() * names.length)], kind: enemy.type === "brute" ? "armamentScrap" : "coin", value: Math.round(enemy.value * rand(0.9, 1.2)), weight: enemy.weight };
          this.dropLoot(item, enemy.x, enemy.y);
        }
      }
    }

    dropLoot(item, x, y) {
      this.lootDrops.push({ item, x, y, bob: rand(0, TAU), life: 0, collected: false });
      this.spawnBurst(x, y, "#f4d273", 8, 95);
    }

    lootSprite(item) {
      if (item.kind === "idol") return SPRITES.idol;
      if (item.kind === "crystal") return SPRITES.crystal;
      if (item.kind === "armament" || item.kind === "armamentScrap") return SPRITES.hammer;
      return SPRITES.coin;
    }

    separateEnemies() {
      for (let i = 0; i < this.enemies.length; i++) {
        for (let j = i + 1; j < this.enemies.length; j++) {
          const a = this.enemies[i], b = this.enemies[j];
          if (a.dead || b.dead) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const overlap = a.r + b.r + 5 - d;
          if (overlap > 0) {
            const nx = dx / d, ny = dy / d;
            a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
            b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
          }
        }
      }
    }

    moveEntity(entity, dx, dy) {
      entity.x += dx;
      this.resolveBoundsAndObstacles(entity, true);
      entity.y += dy;
      this.resolveBoundsAndObstacles(entity, false);
    }

    resolveBoundsAndObstacles(entity, xAxis) {
      entity.x = clamp(entity.x, ROOM.x + entity.r + 7, ROOM.x + ROOM.w - entity.r - 7);
      entity.y = clamp(entity.y, ROOM.y + entity.r + 7, ROOM.y + ROOM.h - entity.r - 7);
      const obstacles = FLOOR_DEFS[this.run.floor].obstacles;
      for (const o of obstacles) {
        const nearestX = clamp(entity.x, o.x, o.x + o.w);
        const nearestY = clamp(entity.y, o.y, o.y + o.h);
        const dx = entity.x - nearestX, dy = entity.y - nearestY;
        if (dx * dx + dy * dy < entity.r * entity.r) {
          if (xAxis) entity.x = entity.x < o.x + o.w / 2 ? o.x - entity.r : o.x + o.w + entity.r;
          else entity.y = entity.y < o.y + o.h / 2 ? o.y - entity.r : o.y + o.h + entity.r;
        }
      }
    }

    openBasin() {
      if (this.basinOpened || this.scene !== "playing") return;
      this.basinOpened = true;
      if (this.run.satchel.length) {
        this.run.cachedLoot.push(...this.run.satchel);
        this.run.satchel = [];
      }
      this.scene = "basin";
      this.audio.setMode("hub");
      this.audio.sfx("basin");
      this.announce(`Collection basin. Cached value ${formatValue(this.cachedValue())}. Press 1 for the loot balloon, 2 to descend deeper, or 3 to shoulder the burden.`);
    }

    cachedValue() { return (this.run?.cachedLoot || []).reduce((sum, item) => sum + item.value, 0); }
    carriedValue() { return (this.run?.carriedLoot || []).reduce((sum, item) => sum + item.value, 0); }

    useBalloon() {
      const f = this.run.floor;
      if (this.run.balloonUsed[f] || !this.run.cachedLoot.length) return;
      const target = [...this.run.cachedLoot].sort((a, b) => b.value - a.value)[0];
      const index = this.run.cachedLoot.indexOf(target);
      this.run.cachedLoot.splice(index, 1);
      const retention = 0.1 + this.meta.upgrades.pulleys * 0.05;
      const kept = Math.max(1, Math.round(target.value * retention));
      const grit = Math.max(1, Math.floor(kept / 25)) + this.meta.upgrades.pulleys;
      this.run.balloonUsed[f] = true;
      this.run.balloonedValue += kept;
      this.run.balloonedGrit += grit;
      this.meta.grit += grit;
      this.meta.totalExtracted += kept;
      this.store.save(this.meta);
      this.audio.sfx("balloon");
      this.toastMessage(`${target.name} rose safely · ${Math.round(retention * 100)}% kept · +${grit} Grit`, "#91e8ef", 3.5);
      this.announce(`Loot balloon sent ${target.name}. ${grit} Grit banked.`);
    }

    descendDeeper() {
      if (this.run.floor >= FLOOR_DEFS.length - 1) return;
      this.input.pointer.active = false;
      this.scene = "playing";
      this.transitionTo(() => {
        this.run.deepestFloor = Math.max(this.run.deepestFloor, this.run.floor + 1);
        this.meta.deepest = Math.max(this.meta.deepest, this.run.floor + 2);
        this.store.save(this.meta);
        this.loadFloor(this.run.floor + 1, "descent");
      });
    }

    shoulderBurden() {
      this.run.carriedLoot = this.run.cachedLoot.splice(0);
      this.run.phase = "ascent";
      const tier = this.getWeightTier();
      this.input.pointer.active = false;
      this.scene = "playing";
      this.audio.sfx("basin", { heavy: true });
      this.transitionTo(() => {
        this.loadFloor(this.run.floor, "ascent");
        this.toastMessage(`${Math.round(this.getWeightRatio() * 100)}% BURDEN · ${tier.id}`, tier.color, 3.2);
        this.announce(`Burden shouldered. Weight ${Math.round(this.getWeightRatio() * 100)} percent. Begin the ascent.`);
      });
    }

    climbUp() {
      if (this.transition.dir > 0) return;
      if (this.run.floor <= 0) {
        this.extract();
        return;
      }
      this.transitionTo(() => {
        this.loadFloor(this.run.floor - 1, "ascent");
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 10);
      });
    }

    extract() {
      if (this.transition.dir > 0) return;
      this.transitionTo(() => {
        const value = this.carriedValue();
        const grit = Math.max(1, Math.floor(value / 30) + this.run.deepestFloor * 2);
        this.run.extractedValue = value;
        this.meta.grit += grit;
        this.meta.totalExtracted += value;
        this.meta.victories += 1;
        this.store.save(this.meta);
        this.run.result = { success: true, title: "THE BURDEN IS YOURS", value, grit, lost: 0, time: this.time - this.run.startedAt };
        this.scene = "runend";
        this.audio.setMode("victory");
        this.audio.sfx("extract");
        this.flash = { color: "#f6d888", alpha: 0.55 };
        this.announce(`Extraction successful. ${formatValue(value)} recovered and ${grit} Grit earned.`);
      });
    }

    endRun(success, title) {
      if (!this.run || this.scene === "runend" || this.transition.dir > 0) return;
      this.transitionTo(() => {
        const lost = this.cachedValue() + this.carriedValue() + (this.run.satchel || []).reduce((s, i) => s + i.value, 0);
        this.run.result = { success, title, value: this.run.balloonedValue, grit: this.run.balloonedGrit, lost, time: this.time - this.run.startedAt };
        this.scene = "runend";
        this.audio.setMode("death");
        this.audio.sfx("death");
        this.announce(`Run lost. ${formatValue(lost)} left in the abyss. Ballooned Grit remains banked.`);
      });
    }

    buyUpgrade(key) {
      const level = this.meta.upgrades[key] || 0;
      const maxRank = key === "blacksmith" ? 1 : 3;
      if (level >= maxRank) return;
      const base = { pulleys: 3, lungs: 4, reflex: 5, blacksmith: 6 }[key];
      const cost = base + level * (key === "blacksmith" ? 5 : 3);
      if (this.meta.grit < cost) {
        this.audio.sfx("ui", { pitch: 0.52, volume: 0.9 });
        this.toastMessage(`NEED ${cost - this.meta.grit} MORE GRIT`, "#df7169", 1.8);
        return;
      }
      this.meta.grit -= cost;
      this.meta.upgrades[key] = level + 1;
      this.store.save(this.meta);
      this.audio.sfx("coin", { pitch: 0.8 + level * 0.12 });
      this.toastMessage(`${key.toUpperCase()} · RANK ${level + 1}`, "#f2d17d", 2);
    }

    cycleRoute() {
      let next = this.selectedRoute;
      for (let i = 0; i < 3; i++) {
        next = (next + 1) % 3;
        if (this.meta.shortcuts[next]) { this.selectedRoute = next; break; }
      }
      this.audio.sfx("ui");
    }

    spawnBurst(x, y, color, count = 8, speed = 80) {
      if (this.reducedMotion) return;
      for (let i = 0; i < count; i++) {
        const a = rand(0, TAU), s = rand(speed * 0.25, speed);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.28, 0.75), max: 0.75, color, size: Math.random() < 0.7 ? 2 : 3 });
      }
    }

    spawnSlash(x, y, angle, range) {
      if (this.reducedMotion) return;
      for (let i = -4; i <= 4; i++) {
        const a = angle + i * 0.12;
        this.particles.push({ x: x + Math.cos(a) * range * 0.68, y: y + Math.sin(a) * range * 0.68, vx: Math.cos(a) * 35, vy: Math.sin(a) * 35, life: 0.18, max: 0.18, color: i === 0 ? "#fff4ca" : "#e8b45f", size: 3 });
      }
    }

    render() {
      const c = this.ctx;
      document.getElementById("touchControls")?.classList.toggle("is-active", this.scene === "playing");
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, W, H);
      this.uiButtons = [];
      if (this.scene === "title" || this.scene === "loading") this.renderTitle();
      else if (this.scene === "hub") this.renderHub();
      else if (["playing", "basin", "pause"].includes(this.scene)) {
        this.renderWorld();
        if (this.scene === "basin") this.renderBasin();
        if (this.scene === "pause") this.renderPause();
      } else if (this.scene === "runend") this.renderRunEnd();

      this.renderToast();
      if (this.flash.alpha > 0) {
        c.save(); c.globalAlpha = this.flash.alpha; c.fillStyle = this.flash.color; c.fillRect(0, 0, W, H); c.restore();
      }
      if (this.transition.alpha > 0) {
        c.save(); c.globalAlpha = easeOut(this.transition.alpha); c.fillStyle = "#050708"; c.fillRect(0, 0, W, H); c.restore();
      }
      this.canvas.style.cursor = this.uiButtons.some((b) => !b.disabled && this.pointInButton(this.input.pointer, b)) ? "pointer" : (this.scene === "playing" ? "crosshair" : "default");
    }

    renderWorld() {
      const c = this.ctx;
      const def = FLOOR_DEFS[this.run.floor];
      const sx = !this.reducedMotion && this.shake ? rand(-this.shake, this.shake) : 0;
      const sy = !this.reducedMotion && this.shake ? rand(-this.shake, this.shake) : 0;
      c.fillStyle = "#070a0e"; c.fillRect(0, 0, W, H);
      this.drawAbyssBackdrop(def);
      c.save(); c.translate(Math.round(sx), Math.round(sy));
      this.drawRoom(def);
      this.drawGate("top", this.run.phase === "ascent" && this.roomClearTimer >= 0.5);
      this.drawGate("bottom", this.run.phase === "descent" && this.roomClearTimer >= 0.5);

      for (const drop of this.lootDrops) this.drawLootDrop(drop);
      for (const shot of this.projectiles) this.drawProjectile(shot);
      const sorted = [...this.enemies, this.player].sort((a, b) => a.y - b.y);
      for (const entity of sorted) {
        if (entity === this.player) this.drawPlayer(); else this.drawEnemy(entity);
      }
      for (const p of this.particles.filter((p) => !p.ambient)) this.drawParticle(p);
      for (const f of this.floaters) this.drawFloater(f);
      c.restore();

      this.drawHUD();
      this.drawContextPrompt();
      if (this.floorBanner > 0) this.drawFloorBanner();
    }

    drawAbyssBackdrop(def) {
      const c = this.ctx;
      const g = c.createRadialGradient(W / 2, H / 2, 70, W / 2, H / 2, 560);
      g.addColorStop(0, def.glow); g.addColorStop(0.55, "#0d1317"); g.addColorStop(1, "#05070a");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.globalAlpha = 0.18;
      for (let x = 18; x < W; x += 38) {
        c.fillStyle = x % 76 ? def.accent : "#9d7547";
        c.fillRect(x, 0, 2, H);
        for (let y = 18; y < H; y += 28) c.fillRect(x - 2, y, 6, 2);
      }
      c.globalAlpha = 1;
      for (const p of this.particles.filter((p) => p.ambient)) this.drawParticle(p);
    }

    drawRoom(def) {
      const c = this.ctx;
      c.fillStyle = "#080b0e"; c.fillRect(ROOM.x - 10, ROOM.y - 10, ROOM.w + 20, ROOM.h + 20);
      c.fillStyle = def.floor; c.fillRect(ROOM.x, ROOM.y, ROOM.w, ROOM.h);
      const tileSize = 32;
      const img = this.assets.get(def.spriteFloor);
      for (let y = ROOM.y; y < ROOM.y + ROOM.h; y += tileSize) {
        for (let x = ROOM.x; x < ROOM.x + ROOM.w; x += tileSize) {
          const checker = ((x / tileSize + y / tileSize) | 0) % 2;
          c.globalAlpha = checker ? 0.19 : 0.11;
          if (img) c.drawImage(img, Math.round(x), Math.round(y), tileSize, tileSize);
          c.fillStyle = checker ? "#111820" : "#1a2229";
          c.fillRect(x, y, tileSize, tileSize);
        }
      }
      c.globalAlpha = 1;
      c.strokeStyle = `${def.accent}22`; c.lineWidth = 1;
      for (let x = ROOM.x + 32; x < ROOM.x + ROOM.w; x += 64) { c.beginPath(); c.moveTo(x, ROOM.y); c.lineTo(x, ROOM.y + ROOM.h); c.stroke(); }
      for (let y = ROOM.y + 32; y < ROOM.y + ROOM.h; y += 64) { c.beginPath(); c.moveTo(ROOM.x, y); c.lineTo(ROOM.x + ROOM.w, y); c.stroke(); }

      const wallImg = this.assets.get(def.spriteWall);
      for (let x = ROOM.x - 16; x <= ROOM.x + ROOM.w; x += 32) {
        if (wallImg) {
          c.drawImage(wallImg, x, ROOM.y - 18, 32, 32);
          c.drawImage(wallImg, x, ROOM.y + ROOM.h - 14, 32, 32);
        }
      }
      c.fillStyle = def.wall;
      c.fillRect(ROOM.x - 12, ROOM.y, 12, ROOM.h);
      c.fillRect(ROOM.x + ROOM.w, ROOM.y, 12, ROOM.h);
      for (let y = ROOM.y; y < ROOM.y + ROOM.h; y += 32) {
        if (wallImg) { c.drawImage(wallImg, ROOM.x - 18, y, 32, 32); c.drawImage(wallImg, ROOM.x + ROOM.w - 14, y, 32, 32); }
      }

      for (const o of def.obstacles) this.drawObstacle(o, wallImg, def);
      this.drawFloorDecor(def);
    }

    drawObstacle(o, img, def) {
      const c = this.ctx;
      c.fillStyle = "#080b0d88"; c.fillRect(o.x + 7, o.y + 9, o.w, o.h);
      c.fillStyle = def.wall; c.fillRect(o.x, o.y, o.w, o.h);
      c.strokeStyle = `${def.accent}55`; c.lineWidth = 2; c.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
      if (img) {
        c.globalAlpha = 0.82;
        for (let y = o.y + 2; y < o.y + o.h - 8; y += 28) for (let x = o.x + 2; x < o.x + o.w - 8; x += 28) c.drawImage(img, x, y, 28, 28);
        c.globalAlpha = 1;
      }
    }

    drawFloorDecor(def) {
      const c = this.ctx;
      const floor = this.run.floor;
      if (floor === 0) {
        c.strokeStyle = "#315f4b"; c.lineWidth = 3;
        for (let i = 0; i < 7; i++) {
          const x = ROOM.x + 55 + i * 112;
          c.beginPath(); c.moveTo(x, ROOM.y + 3); c.quadraticCurveTo(x + 18, ROOM.y + 34, x - 5, ROOM.y + 55); c.stroke();
        }
      } else if (floor === 1) {
        c.fillStyle = "#62cedd55";
        [[140,150],[350,420],[770,135],[610,420]].forEach(([x,y]) => {
          c.beginPath(); c.moveTo(x,y); c.lineTo(x+8,y-22); c.lineTo(x+16,y); c.fill();
          c.fillStyle = "#c6f8ff99"; c.fillRect(x+8,y-17,2,10); c.fillStyle = "#62cedd55";
        });
      } else {
        c.fillStyle = "#f06a3b33";
        for (let i = 0; i < 6; i++) c.fillRect(ROOM.x + 52 + i * 135, ROOM.y + ROOM.h - 18, 70, 4);
        c.globalAlpha = 0.7 + Math.sin(this.time * 6) * 0.2;
        this.drawSprite(SPRITES.brazier, ROOM.x + 34, ROOM.y + 42, 40);
        this.drawSprite(SPRITES.brazier, ROOM.x + ROOM.w - 34, ROOM.y + 42, 40);
        c.globalAlpha = 1;
      }
    }

    drawGate(side, open) {
      const c = this.ctx;
      const y = side === "top" ? ROOM.y + 3 : ROOM.y + ROOM.h - 3;
      const x = W / 2;
      c.save();
      c.translate(x, y);
      c.fillStyle = open ? "#e8c66b33" : "#0b0e11";
      c.fillRect(-56, -13, 112, 26);
      c.strokeStyle = open ? "#edce75" : "#5a6268";
      c.lineWidth = 3; c.strokeRect(-56, -13, 112, 26);
      if (!open) {
        c.fillStyle = "#69727a";
        for (let i = -44; i <= 44; i += 14) c.fillRect(i, -12, 5, 24);
      } else {
        c.shadowBlur = 14; c.shadowColor = "#f4d77d"; c.fillStyle = "#f4d77d";
        c.fillRect(-40, side === "top" ? -8 : 5, 80, 3);
      }
      c.restore();
      if (open && side === "bottom" && this.run.phase === "descent") {
        this.drawSprite(SPRITES.basin, x, y - 22, 48);
      }
    }

    drawLootDrop(drop) {
      const y = drop.y + Math.sin(drop.bob) * 4;
      const c = this.ctx;
      c.save(); c.globalAlpha = 0.25; c.fillStyle = "#f5d276"; c.beginPath(); c.ellipse(drop.x, drop.y + 13, 16, 6, 0, 0, TAU); c.fill(); c.restore();
      this.drawSprite(this.lootSprite(drop.item), drop.x, y, drop.item.kind === "idol" ? 42 : 34);
      c.save(); c.globalAlpha = 0.4 + Math.sin(this.time * 6 + drop.bob) * 0.2; c.strokeStyle = "#ffe4a0"; c.strokeRect(Math.round(drop.x - 17), Math.round(y - 17), 34, 34); c.restore();
    }

    drawProjectile(shot) {
      const c = this.ctx;
      c.save(); c.translate(Math.round(shot.x), Math.round(shot.y)); c.rotate(this.time * 7);
      c.shadowBlur = 13; c.shadowColor = shot.color; c.fillStyle = shot.color;
      c.beginPath(); c.moveTo(0, -shot.r * 1.5); c.lineTo(shot.r, 0); c.lineTo(0, shot.r * 1.5); c.lineTo(-shot.r, 0); c.closePath(); c.fill();
      c.restore();
    }

    drawPlayer() {
      const p = this.player, c = this.ctx;
      const flip = Math.cos(p.facing) < 0;
      c.save();
      c.globalAlpha = p.invulnerable > 0 && Math.floor(this.time * 22) % 2 ? 0.45 : 1;
      c.fillStyle = "#0008"; c.beginPath(); c.ellipse(p.x, p.y + 15, 20, 7, 0, 0, TAU); c.fill();
      if (p.dodgeTime > 0) {
        c.globalAlpha *= 0.25; this.drawSprite(p.weapon === "maul" ? SPRITES.playerAlt : SPRITES.player, p.x - p.vx * 0.035, p.y - p.vy * 0.035, 48, flip); c.globalAlpha *= 4;
      }
      this.drawSprite(p.weapon === "maul" ? SPRITES.playerAlt : SPRITES.player, p.x, p.y, 48, flip);
      c.restore();

      c.save(); c.translate(p.x, p.y); c.rotate(p.facing);
      if (p.blocking) {
        c.shadowBlur = p.blockAge < 0.15 ? 12 : 0; c.shadowColor = "#f7dc8b";
        this.drawSprite(SPRITES.shield, 22, 0, 30, false);
        c.strokeStyle = p.blockAge < 0.15 ? "#f8e3a1" : "#aebac2"; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 30, -0.6, 0.6); c.stroke();
      } else {
        const swing = p.attackTime > 0 ? Math.sin((1 - p.attackTime / (p.weapon === "maul" ? 0.28 : 0.21)) * Math.PI) * 0.95 - 0.45 : -0.15;
        c.rotate(swing);
        this.drawSprite(p.weapon === "maul" ? SPRITES.swordHeavy : SPRITES.sword, 22, 0, p.weapon === "maul" ? 38 : 32, false);
      }
      c.restore();
    }

    drawEnemy(e) {
      const c = this.ctx;
      if (e.state === "windup") this.drawEnemyTelegraph(e);
      c.save();
      c.fillStyle = "#0009"; c.beginPath(); c.ellipse(e.x, e.y + e.r * 0.85, e.r * 1.15, e.r * 0.38, 0, 0, TAU); c.fill();
      if (e.flash > 0) { c.shadowBlur = 18; c.shadowColor = "#fff3c4"; }
      const size = e.type === "guardian" ? 68 : e.type === "collector" ? 58 : e.r > 16 ? 48 : 42;
      this.drawSprite(e.sprite, e.x, e.y, size, e.x > this.player.x);
      if (e.executable) {
        c.strokeStyle = "#f7d476"; c.lineWidth = 3; c.globalAlpha = 0.6 + Math.sin(this.time * 10) * 0.35;
        c.beginPath(); c.arc(e.x, e.y, e.r + 11, 0, TAU); c.stroke();
        c.fillStyle = "#f7d476"; c.fillRect(e.x - 2, e.y - e.r - 20, 4, 9);
      }
      c.restore();
      if (!["guardian", "collector"].includes(e.type) && (e.hp < e.maxHp || e.state === "windup")) {
        this.drawBar(e.x - 18, e.y - e.r - 12, 36, 4, e.hp / e.maxHp, "#cf5d59", "#17191d");
      }
    }

    drawEnemyTelegraph(e) {
      const c = this.ctx;
      const total = e.windup * (e.special ? 1.18 : 1);
      const t = clamp(1 - e.timer / total, 0, 1);
      const color = t > 0.72 ? "#fff0b2" : e.special ? FLOOR_DEFS[e.floor].accent : "#ed6b5e";
      c.save(); c.globalAlpha = 0.3 + t * 0.6; c.strokeStyle = color; c.lineWidth = 2 + t * 3;
      c.beginPath(); c.arc(e.x, e.y, e.range + 10 + t * 5, -Math.PI / 2, -Math.PI / 2 + TAU * t); c.stroke();
      c.translate(e.x, e.y);
      if (e.special && e.type === "guardian") {
        c.fillStyle = `${color}18`; c.beginPath(); c.arc(0, 0, 185, 0, TAU); c.fill();
        c.strokeStyle = color; c.lineWidth = 2;
        for (let i = 0; i < 7; i++) {
          const a = i * TAU / 7;
          c.beginPath(); c.moveTo(Math.cos(a) * 22, Math.sin(a) * 22); c.lineTo(Math.cos(a) * 178, Math.sin(a) * 178); c.stroke();
        }
      } else {
        c.rotate(e.targetAngle);
        c.fillStyle = `${color}22`; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, e.special ? 210 : e.range + 18, -0.26, 0.26); c.closePath(); c.fill();
        c.strokeStyle = color; c.lineWidth = 2; c.beginPath(); c.moveTo(10, 0); c.lineTo(e.special ? 185 : e.range + 12, 0); c.stroke();
      }
      c.restore();
    }

    drawSprite(id, x, y, size = 32, flip = false) {
      const img = this.assets.get(id), c = this.ctx;
      if (!img) { c.fillStyle = "#d7bd79"; c.fillRect(Math.round(x - size / 4), Math.round(y - size / 4), size / 2, size / 2); return; }
      c.save(); c.translate(Math.round(x), Math.round(y)); if (flip) c.scale(-1, 1);
      c.drawImage(img, Math.round(-size / 2), Math.round(-size / 2), Math.round(size), Math.round(size)); c.restore();
    }

    drawParticle(p) {
      const c = this.ctx;
      c.save(); c.globalAlpha = clamp(p.life / (p.max || 1), 0, 1); c.fillStyle = p.color; c.fillRect(Math.round(p.x), Math.round(p.y), p.size || 2, p.size || 2); c.restore();
    }

    drawFloater(f) {
      const c = this.ctx; c.save(); c.globalAlpha = clamp(f.life / f.max, 0, 1); this.pixelText(String(f.text), f.x, f.y, 12, f.color, "center", true); c.restore();
    }

    drawHUD() {
      const c = this.ctx, p = this.player, def = FLOOR_DEFS[this.run.floor], tier = this.getWeightTier();
      c.fillStyle = "#080b0ed9"; c.fillRect(0, 0, W, 74);
      c.fillStyle = "#0d1115e8"; c.fillRect(0, 474, W, 66);
      c.strokeStyle = "#3c4248"; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 73); c.lineTo(W, 73); c.stroke();
      c.beginPath(); c.moveTo(0, 474); c.lineTo(W, 474); c.stroke();

      this.drawSprite(p.weapon === "maul" ? SPRITES.playerAlt : SPRITES.player, 42, 37, 50);
      this.pixelText("VITAL", 73, 17, 9, "#88949b");
      this.drawBar(73, 25, 190, 14, p.hp / p.maxHp, "#bd4c4b", "#241719", true);
      this.pixelText(`${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`, 168, 36, 9, "#fff0dc", "center");
      this.pixelText("IRON", 73, 49, 9, "#88949b");
      this.drawBar(112, 45, 151, 8, p.stamina / p.maxStamina, "#52bcae", "#14221f", true);

      this.pixelText(this.run.phase === "descent" ? "↓ DESCENT" : "↑ ASCENT", W / 2, 20, 12, this.run.phase === "descent" ? "#7fd6d2" : "#f0a15c", "center", true);
      this.pixelText(def.name, W / 2, 39, 15, "#f3dfb2", "center", true);
      this.pixelText(def.depth, W / 2, 57, 9, "#7c8a92", "center");

      this.pixelText("LOOT WEIGHT", 690, 17, 9, "#89949a");
      this.drawWeightBar(690, 26, 224, 14);
      this.pixelText(`${Math.round(this.getWeightRatio() * 100)}%`, 690, 58, 12, tier.color, "left", true);
      this.pixelText(tier.id, 914, 58, 12, tier.color, "right", true);
      if (this.run.phase === "descent") {
        const pending = this.cachedValue() + this.run.satchel.reduce((s, i) => s + i.value, 0);
        this.pixelText(`${formatValue(pending)} CACHED BELOW`, 802, 58, 9, "#c6ad72", "center");
      }

      this.drawDepthMeter();
      const hints = this.run.phase === "descent"
        ? [["WASD", "MOVE"], ["SPACE", "DODGE"], ["RMB / K", "BLOCK"], ["LMB / J", "STRIKE · CLASH PARRY"]]
        : [["WASD", "MOVE"], ["SPACE", tier.id === "HEAVY" ? "HEAVY LUNGE" : "DODGE"], ["TAP BLOCK", "PERFECT"], ["STRIKE AT IMPACT", "PARRY"]];
      let x = 93;
      for (const [key, label] of hints) {
        this.pixelText(key, x, 498, 10, "#f0d89b", "left", true);
        this.pixelText(label, x, 518, 8, "#7f8a91");
        x += key.length > 11 ? 230 : 198;
      }

      const boss = this.enemies.find((e) => e.type === "guardian" || e.type === "collector");
      if (boss) {
        const name = boss.type === "guardian" ? FLOOR_DEFS[this.run.floor].guardian : boss.name;
        this.pixelText(name.toUpperCase(), W / 2, 84, 10, def.accent, "center", true);
        this.drawBar(310, 87, 340, 7, boss.hp / boss.maxHp, boss.type === "collector" ? "#cf5352" : def.accent, "#16181c", true);
      }
    }

    drawWeightBar(x, y, w, h) {
      const c = this.ctx, ratio = this.getWeightRatio(), tier = this.getWeightTier();
      c.fillStyle = "#171b20"; c.fillRect(x, y, w, h);
      c.fillStyle = "#70e1a144"; c.fillRect(x + 2, y + 2, (w - 4) * 0.25, h - 4);
      c.fillStyle = "#e8c56a33"; c.fillRect(x + 2 + (w - 4) * 0.25, y + 2, (w - 4) * 0.5, h - 4);
      c.fillStyle = "#eb665c33"; c.fillRect(x + 2 + (w - 4) * 0.75, y + 2, (w - 4) * 0.25, h - 4);
      c.fillStyle = tier.color; c.fillRect(x + 2, y + 2, (w - 4) * clamp(ratio, 0, 1), h - 4);
      c.strokeStyle = "#596168"; c.lineWidth = 2; c.strokeRect(x, y, w, h);
      c.fillStyle = "#d8e1e4"; c.fillRect(x + (w - 4) * 0.25, y - 2, 2, h + 4); c.fillRect(x + (w - 4) * 0.75, y - 2, 2, h + 4);
    }

    drawDepthMeter() {
      const c = this.ctx, x = 38;
      c.strokeStyle = "#4e5960"; c.lineWidth = 2; c.beginPath(); c.moveTo(x, 120); c.lineTo(x, 440); c.stroke();
      this.pixelText("SURFACE", x, 104, 7, "#8d989e", "center");
      for (let i = 0; i < 3; i++) {
        const y = 160 + i * 120;
        const active = i === this.run.floor;
        c.fillStyle = active ? FLOOR_DEFS[i].accent : this.run.cleared[i] ? "#69767d" : "#22282d";
        c.fillRect(x - (active ? 7 : 5), y - (active ? 7 : 5), active ? 14 : 10, active ? 14 : 10);
        if (active) { c.strokeStyle = FLOOR_DEFS[i].accent; c.strokeRect(x - 11, y - 11, 22, 22); }
        this.pixelText(String(i + 1), x, y + 3, 7, active ? "#071012" : "#c1c8ca", "center", true);
      }
    }

    drawContextPrompt() {
      if (this.roomClearTimer < 0.5) return;
      const descent = this.run.phase === "descent";
      const targetY = descent ? ROOM.y + ROOM.h - 24 : ROOM.y + 24;
      const near = Math.abs(this.player.y - targetY) < 68 && Math.abs(this.player.x - W / 2) < 95;
      if (!near) return;
      const text = descent ? "E  OPEN COLLECTION BASIN" : this.run.floor === 0 ? "E  BREAK THE SURFACE" : "E  CLIMB TO THE FLOOR ABOVE";
      const width = descent ? 260 : 290;
      this.panel(W / 2 - width / 2, descent ? 412 : 103, width, 30, 0.96, "#dabb6b");
      this.pixelText(text, W / 2, descent ? 431 : 122, 10, "#f7e6b8", "center", true);
    }

    drawFloorBanner() {
      const c = this.ctx, def = FLOOR_DEFS[this.run.floor];
      const t = clamp(this.floorBanner / 2.8, 0, 1);
      const alpha = Math.min(1, (1 - t) * 4, t * 3);
      c.save(); c.globalAlpha = alpha;
      c.fillStyle = "#07090bd9"; c.fillRect(250, 196, 460, 108);
      c.strokeStyle = def.accent; c.lineWidth = 2; c.strokeRect(254, 200, 452, 100);
      this.pixelText(this.run.phase === "descent" ? `DEPTH ${this.run.floor + 1}` : `RETURN · DEPTH ${this.run.floor + 1}`, W / 2, 224, 10, def.accent, "center", true);
      this.pixelText(def.name, W / 2, 256, 22, "#f2dfb5", "center", true);
      this.pixelText(this.run.phase === "descent" ? def.depth : "THE WAY BACK HAS CHANGED", W / 2, 280, 9, "#8d989f", "center");
      c.restore();
    }

    renderTitle() {
      const c = this.ctx;
      c.fillStyle = "#05080b"; c.fillRect(0, 0, W, H);
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#14232a"); g.addColorStop(0.38, "#0b1116"); g.addColorStop(1, "#020304");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = "#223b3d"; c.beginPath(); c.moveTo(0, 70); c.lineTo(170, 104); c.lineTo(265, 70); c.lineTo(360, 112); c.lineTo(475, 67); c.lineTo(610, 113); c.lineTo(760, 72); c.lineTo(W, 104); c.lineTo(W, 0); c.lineTo(0, 0); c.fill();
      c.fillStyle = "#0b0e12"; c.beginPath(); c.moveTo(0, 320); c.lineTo(120, 276); c.lineTo(200, 325); c.lineTo(315, 240); c.lineTo(445, 310); c.lineTo(565, 226); c.lineTo(690, 310); c.lineTo(835, 250); c.lineTo(W, 330); c.lineTo(W, H); c.lineTo(0, H); c.fill();
      c.globalAlpha = 0.3;
      for (let x = 70; x < W; x += 135) { c.strokeStyle = "#7c684a"; c.lineWidth = 3; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + Math.sin(x) * 8, 245 + (x % 90)); c.stroke(); }
      c.globalAlpha = 1;
      this.drawSprite(SPRITES.guardian, 785, 395, 138, true);
      this.drawSprite(SPRITES.player, 190, 402, 90);
      c.save(); c.translate(213, 389); c.rotate(-0.2); this.drawSprite(SPRITES.sword, 0, 0, 56); c.restore();

      this.pixelText("ABYSSAL", W / 2, 122, 54, "#e9d6a5", "center", true);
      this.pixelText("WEIGHT", W / 2, 174, 58, "#d1a85c", "center", true);
      c.fillStyle = "#d1a85c"; c.fillRect(325, 191, 310, 3);
      this.pixelText("THE DESCENT IS ONLY HALF THE JOURNEY", W / 2, 218, 12, "#7fa8a5", "center", true);

      this.drawButton(354, 272, 252, 58, "BEGIN DESCENT", "ENTER / CLICK", () => this.enterHub(), { accent: "#d1a85c" });
      this.pixelText("CLAIM WHAT CALLS TO YOU. CARRY WHAT YOU DARE.", W / 2, 361, 10, "#879196", "center");
      this.pixelText("WASD MOVE   ·   LMB STRIKE / PARRY   ·   RMB BLOCK   ·   SPACE DODGE", W / 2, 500, 10, "#5d6a70", "center");
      this.pixelText("A VERTICAL EXTRACTION ROGUE-LITE", 28, 28, 9, "#6d7d82");
      this.pixelText("v1.0 · THE GREAT CYCLE", W - 28, 28, 9, "#6d7d82", "right");
    }

    renderHub() {
      const c = this.ctx;
      c.fillStyle = "#0b1013"; c.fillRect(0, 0, W, H);
      const sky = c.createLinearGradient(0, 0, 0, 230); sky.addColorStop(0, "#263f46"); sky.addColorStop(1, "#10181b");
      c.fillStyle = sky; c.fillRect(0, 0, W, 230);
      c.fillStyle = "#0a0d0f"; c.beginPath(); c.moveTo(0, 180); c.lineTo(90, 132); c.lineTo(176, 170); c.lineTo(260, 116); c.lineTo(345, 177); c.lineTo(465, 105); c.lineTo(585, 175); c.lineTo(705, 123); c.lineTo(815, 181); c.lineTo(W, 120); c.lineTo(W, 270); c.lineTo(0, 270); c.fill();
      c.fillStyle = "#1b1714"; c.fillRect(0, 220, W, H - 220);
      for (let x = 0; x < W; x += 32) this.drawSprite(SPRITES.floorStone, x + 16, 236, 34);
      c.fillStyle = "#091013"; c.beginPath(); c.ellipse(138, 300, 105, 145, 0, 0, TAU); c.fill();
      c.strokeStyle = "#657078"; c.lineWidth = 8; c.beginPath(); c.ellipse(138, 300, 105, 145, 0, 0, TAU); c.stroke();
      this.drawSprite(SPRITES.basin, 138, 335, 92);
      this.drawSprite(SPRITES.player, 126, 392, 66);

      this.pixelText("THE SURFACE", 300, 41, 12, "#79aba8", "left", true);
      this.pixelText("A moment of air between debts.", 300, 64, 10, "#77858b");
      this.panel(742, 25, 188, 54, 0.94, "#d0aa5e");
      this.pixelText("GRIT", 762, 47, 9, "#8f989d");
      this.pixelText(String(this.meta.grit), 910, 61, 26, "#f0ce76", "right", true);

      this.panel(290, 92, 640, 126, 0.95, "#658f8d");
      this.pixelText("LOWER THE CAGE", 318, 119, 18, "#f0ddb0", "left", true);
      this.pixelText("Descend light. Cache every prize. Choose your turning point.", 318, 146, 10, "#89989e");
      const route = FLOOR_DEFS[this.selectedRoute];
      const routeCount = this.meta.shortcuts.filter(Boolean).length;
      this.pixelText(`ROUTE · ${route.name}`, 318, 178, 11, route.accent, "left", true);
      this.drawButton(715, 112, 190, 44, "START RUN", "ENTER", () => this.beginRun(), { accent: "#d0aa5e" });
      this.drawButton(715, 165, 190, 32, "CHANGE ROUTE", `R · ${routeCount} UNLOCKED`, () => this.cycleRoute(), { accent: "#628f8b", small: true, disabled: routeCount < 2 });

      this.pixelText("SURFACE WORKS", 290, 250, 12, "#c5a866", "left", true);
      const upgrades = [
        ["pulleys", "REINFORCED PULLEYS", "Balloon keeps +5% per rank", SPRITES.basin],
        ["lungs", "BELLOWS LUNGS", "Faster stamina under burden", SPRITES.potion],
        ["reflex", "REFLEX TRAINING", "+26ms Perfect Block window", SPRITES.shield],
        ["blacksmith", "BLACKSMITH'S DEBT", "Unlock the crushing starter maul", SPRITES.hammer],
      ];
      upgrades.forEach((u, i) => {
        const col = i % 2, row = Math.floor(i / 2), x = 290 + col * 325, y = 269 + row * 105;
        this.drawUpgradeCard(x, y, 305, 88, ...u);
      });
      this.panel(290, 486, 640, 35, 0.8, "#3c4d53");
      this.pixelText("EXTRACTED", 310, 508, 8, "#758289"); this.pixelText(formatValue(this.meta.totalExtracted), 390, 508, 10, "#d5ba78", "left", true);
      this.pixelText("RUNS", 550, 508, 8, "#758289"); this.pixelText(String(this.meta.runs), 594, 508, 10, "#d5ba78", "left", true);
      this.pixelText("SURVIVED", 720, 508, 8, "#758289"); this.pixelText(String(this.meta.victories), 798, 508, 10, "#d5ba78", "left", true);
    }

    drawUpgradeCard(x, y, w, h, key, name, desc, sprite) {
      const level = this.meta.upgrades[key], maxRank = key === "blacksmith" ? 1 : 3, maxed = level >= maxRank;
      const base = { pulleys: 3, lungs: 4, reflex: 5, blacksmith: 6 }[key];
      const cost = base + level * (key === "blacksmith" ? 5 : 3);
      this.panel(x, y, w, h, 0.9, maxed ? "#5f816e" : "#4d555b");
      this.drawSprite(sprite, x + 36, y + 42, 46);
      this.pixelText(name, x + 70, y + 23, 10, "#ead8aa", "left", true);
      this.pixelText(desc, x + 70, y + 44, 8, "#839097");
      for (let i = 0; i < maxRank; i++) { this.ctx.fillStyle = i < level ? "#d3af5d" : "#2d3439"; this.ctx.fillRect(x + 70 + i * 18, y + 59, 12, 6); }
      const hotkey = { pulleys: 1, lungs: 2, reflex: 3, blacksmith: 4 }[key];
      this.drawButton(x + 196, y + 56, 96, 24, maxed ? "MASTERED" : `${hotkey} · ${cost} GRIT`, "", () => this.buyUpgrade(key), { accent: maxed ? "#52705f" : "#a8884a", small: true, disabled: maxed });
    }

    renderBasin() {
      const c = this.ctx, def = FLOOR_DEFS[this.run.floor];
      c.save(); c.fillStyle = "#030506cc"; c.fillRect(0, 0, W, H); c.restore();
      this.panel(92, 58, 776, 424, 0.98, def.accent);
      this.drawSprite(SPRITES.basin, 147, 111, 72);
      this.pixelText("COLLECTION BASIN", 198, 91, 11, def.accent, "left", true);
      this.pixelText("THE PIVOT", 198, 124, 27, "#f0ddb1", "left", true);
      this.pixelText("Everything you sent downward waits here. Nothing is yours until it sees daylight.", 198, 149, 9, "#89969c");
      c.fillStyle = "#323940"; c.fillRect(118, 170, 724, 2);

      const value = this.cachedValue();
      const weight = this.run.cachedLoot.reduce((s, i) => s + i.weight, 0);
      const projected = weight < 25 ? { id: "LIGHT", color: "#70e1a1" } : weight <= 75 ? { id: "MID", color: "#e8c56a" } : { id: "HEAVY", color: "#eb665c" };
      this.pixelText("CACHED VALUE", 126, 200, 8, "#7f8b91"); this.pixelText(formatValue(value), 126, 232, 23, "#f1ce76", "left", true);
      this.pixelText("BURDEN", 345, 200, 8, "#7f8b91"); this.pixelText(`${weight}% · ${projected.id}`, 345, 232, 18, projected.color, "left", true);
      this.pixelText("RELICS", 600, 200, 8, "#7f8b91"); this.pixelText(String(this.run.cachedLoot.length), 600, 232, 20, "#e8ddb9", "left", true);

      const items = [...this.run.cachedLoot].sort((a, b) => b.value - a.value).slice(0, 4);
      items.forEach((item, i) => {
        const x = 126 + i * 176;
        this.panel(x, 255, 158, 72, 0.75, item.curse ? "#5bc19a" : item.armament ? "#d58852" : "#4a555c");
        this.drawSprite(this.lootSprite(item), x + 27, 290, 38);
        this.pixelText(item.name.toUpperCase().slice(0, 17), x + 52, 279, 8, "#e8d9b4", "left", true);
        this.pixelText(`${formatValue(item.value)} · ${item.weight}%`, x + 52, 298, 8, "#a9b1b3");
        if (item.lore) this.pixelText(item.lore.toUpperCase().slice(0, 21), x + 10, 318, 7, item.curse ? "#72d7aa" : "#d99b6b");
      });
      if (this.run.cachedLoot.length > 4) this.pixelText(`+ ${this.run.cachedLoot.length - 4} MORE`, 815, 319, 7, "#7d8a90", "right");

      const retention = 10 + this.meta.upgrades.pulleys * 5;
      const balloonDisabled = this.run.balloonUsed[this.run.floor] || !this.run.cachedLoot.length;
      this.drawButton(126, 347, 220, 42, balloonDisabled ? "BALLOON SPENT" : "1 · LOOT BALLOON", balloonDisabled ? "ONE USE PER DEPTH" : `SEND PRICIEST · KEEP ${retention}%`, () => this.useBalloon(), { accent: "#5cbcc6", small: true, disabled: balloonDisabled });
      this.pixelText("The air tax is brutal. Survival is not.", 126, 405, 8, "#738188");

      const deepest = this.run.floor >= FLOOR_DEFS.length - 1;
      this.drawButton(375, 347, 215, 82, deepest ? "NO DEEPER PATH" : "2 · DESCEND DEEPER", deepest ? "THE ABYSS ENDS HERE" : `TO DEPTH ${this.run.floor + 2} · STAY LIGHT`, () => this.descendDeeper(), { accent: def.accent, disabled: deepest });
      this.drawButton(610, 347, 218, 82, "3 · SHOULDER BURDEN", `${weight}% WEIGHT · BEGIN ASCENT`, () => this.shoulderBurden(), { accent: projected.color, danger: projected.id === "HEAVY" });
      this.pixelText(deepest ? "There is only one direction left." : "Greed buys value. Weight collects interest.", W / 2, 460, 9, "#8d999e", "center");
    }

    renderPause() {
      const c = this.ctx;
      c.fillStyle = "#030506d9"; c.fillRect(0, 0, W, H);
      this.panel(270, 105, 420, 330, 0.98, "#bd9b59");
      this.pixelText("THE CAGE HOLDS", W / 2, 155, 24, "#efdcad", "center", true);
      this.pixelText("PAUSED", W / 2, 183, 11, "#8a969c", "center", true);
      const rows = [["WASD / ARROWS", "MOVE"], ["LMB / J", "STRIKE · PARRY ON CLASH"], ["RMB / K", "GUARD · TAP FOR PERFECT"], ["SPACE / SHIFT", "DODGE · HEAVY LUNGE"], ["E", "INTERACT"]];
      rows.forEach(([key, label], i) => { this.pixelText(key, 320, 230 + i * 30, 9, "#d8bd7c", "left", true); this.pixelText(label, 460, 230 + i * 30, 9, "#8c989e"); });
      this.drawButton(320, 375, 150, 38, "RESUME", "ESC", () => this.resume(), { accent: "#ba9854" });
      this.drawButton(490, 375, 150, 38, "ABANDON", "Q · LOSE CARRIED LOOT", () => this.endRun(false, "YOU CUT THE ROPE"), { accent: "#a34f4f", danger: true });
    }

    renderRunEnd() {
      const c = this.ctx, r = this.run?.result;
      c.fillStyle = r?.success ? "#101a18" : "#110b0d"; c.fillRect(0, 0, W, H);
      const g = c.createRadialGradient(W / 2, 190, 40, W / 2, 260, 500);
      g.addColorStop(0, r?.success ? "#345649" : "#51262a"); g.addColorStop(1, "#050708"); c.fillStyle = g; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) { c.strokeStyle = r?.success ? "#d2b66844" : "#85414844"; c.lineWidth = 3; c.beginPath(); c.moveTo(110 + i * 150, 0); c.lineTo(80 + i * 150, 150 + (i % 2) * 40); c.stroke(); }
      if (r?.success) {
        this.drawSprite(SPRITES.player, W / 2, 135, 100);
        this.drawSprite(SPRITES.coin, W / 2 - 62, 148, 48);
        this.drawSprite(SPRITES.crystal, W / 2 + 62, 148, 48);
      } else this.drawSprite(SPRITES.guardian, W / 2, 140, 126);
      this.pixelText(r?.success ? "EXTRACTION COMPLETE" : "RUN ENDED", W / 2, 224, 11, r?.success ? "#75c5a3" : "#c76565", "center", true);
      this.pixelText(r?.title || "THE CYCLE ENDS", W / 2, 263, 28, "#f0ddb0", "center", true);
      this.panel(200, 292, 560, 96, 0.9, r?.success ? "#77a88c" : "#97525a");
      const cells = r?.success
        ? [["EXTRACTED", formatValue(r.value)], ["GRIT EARNED", `+${r.grit}`], ["TIME", this.formatTime(r.time)]]
        : [["LEFT BELOW", formatValue(r.lost)], ["BALLOONED", `${formatValue(r.value)} · +${r.grit}G`], ["TIME", this.formatTime(r.time)]];
      cells.forEach(([label, value], i) => {
        const x = 280 + i * 200;
        this.pixelText(label, x, 323, 8, "#849096", "center");
        this.pixelText(value, x, 357, 18, i === 1 && r?.success ? "#f0ce75" : "#e7d8b4", "center", true);
      });
      this.pixelText(`${this.stats.parries} PARRIES   ·   ${this.stats.perfects} PERFECT BLOCKS   ·   ${this.stats.executions} EXECUTIONS`, W / 2, 414, 9, "#77858b", "center");
      this.drawButton(365, 444, 230, 52, "RETURN TO SURFACE", "ENTER", () => this.enterHub(), { accent: r?.success ? "#c8a95e" : "#9a5658" });
    }

    renderToast() {
      if (!this.toast || ["title", "basin", "runend"].includes(this.scene)) return;
      const t = this.toast, c = this.ctx;
      const alpha = Math.min(1, t.time * 4, (t.max - t.time) * 6);
      c.save(); c.globalAlpha = alpha;
      const width = clamp(t.text.length * 8 + 42, 210, 570);
      c.fillStyle = "#090c0fe8"; c.fillRect(W / 2 - width / 2, 92, width, 34);
      c.strokeStyle = t.color; c.lineWidth = 2; c.strokeRect(W / 2 - width / 2 + 2, 94, width - 4, 30);
      this.pixelText(t.text, W / 2, 114, 10, t.color, "center", true);
      c.restore();
    }

    panel(x, y, w, h, alpha = 0.92, accent = "#68727a") {
      const c = this.ctx; c.save(); c.globalAlpha = alpha;
      c.fillStyle = "#0d1115"; c.fillRect(x, y, w, h);
      c.fillStyle = "#171d21"; c.fillRect(x + 5, y + 5, w - 10, h - 10);
      c.strokeStyle = "#050708"; c.lineWidth = 5; c.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
      c.strokeStyle = accent; c.lineWidth = 2; c.strokeRect(x + 6, y + 6, w - 12, h - 12);
      c.fillStyle = accent; c.fillRect(x + 6, y + 6, 18, 3); c.fillRect(x + w - 24, y + h - 9, 18, 3);
      c.restore();
    }

    drawButton(x, y, w, h, label, sublabel, action, options = {}) {
      const c = this.ctx;
      const b = { x, y, w, h, action, disabled: !!options.disabled };
      this.uiButtons.push(b);
      const hover = !b.disabled && this.pointInButton(this.input.pointer, b);
      const accent = options.accent || "#b08f51";
      c.save();
      c.globalAlpha = b.disabled ? 0.42 : 1;
      c.fillStyle = hover ? "#242b2e" : options.danger ? "#211417" : "#11171a"; c.fillRect(x, y, w, h);
      c.fillStyle = hover ? accent : `${accent}bb`; c.fillRect(x, y, 5, h); c.fillRect(x + w - 5, y, 5, h);
      c.strokeStyle = hover ? "#f0ddb0" : accent; c.lineWidth = hover ? 3 : 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
      this.pixelText(label, x + w / 2, y + (sublabel ? h * 0.42 : h * 0.58), options.small ? 9 : 12, b.disabled ? "#7a8285" : "#f0dfb5", "center", true);
      if (sublabel) this.pixelText(sublabel, x + w / 2, y + h * 0.73, options.small ? 7 : 8, hover ? "#d8c892" : "#77868b", "center");
      c.restore();
    }

    pointInButton(p, b) { return p.active && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; }

    drawBar(x, y, w, h, ratio, color, back = "#14171a", border = false) {
      const c = this.ctx;
      c.fillStyle = back; c.fillRect(x, y, w, h);
      c.fillStyle = color; c.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * clamp(ratio, 0, 1)), h - 4);
      c.fillStyle = "#ffffff22"; c.fillRect(x + 3, y + 3, Math.max(0, (w - 6) * clamp(ratio, 0, 1)), 2);
      if (border) { c.strokeStyle = "#566066"; c.lineWidth = 2; c.strokeRect(x, y, w, h); }
    }

    pixelText(text, x, y, size = 10, color = "#fff", align = "left", bold = false) {
      const c = this.ctx;
      c.save(); c.font = `${bold ? "700" : "600"} ${size}px "Courier New", monospace`; c.textAlign = align; c.textBaseline = "alphabetic";
      c.fillStyle = "#000a"; c.fillText(text, Math.round(x + 1), Math.round(y + 1));
      c.fillStyle = color; c.fillText(text, Math.round(x), Math.round(y)); c.restore();
    }

    formatTime(seconds) {
      const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
      return `${m}:${String(s).padStart(2, "0")}`;
    }

    updateTransition(dt) {
      const tr = this.transition;
      if (tr.dir > 0) {
        tr.alpha += dt * 3.6;
        if (tr.alpha >= 1) {
          tr.alpha = 1;
          const cb = tr.callback; tr.callback = null; tr.dir = -1;
          cb?.();
        }
      } else if (tr.alpha > 0) tr.alpha = Math.max(0, tr.alpha - dt * 2.4);
    }

    transitionTo(callback) {
      if (this.transition.dir > 0) return;
      this.transition.dir = 1;
      this.transition.callback = callback;
    }

    pause() { this.previousScene = this.scene; this.scene = "pause"; }
    resume() { this.scene = "playing"; }

    toastMessage(text, color = "#e8d7a7", duration = 2.2) {
      this.toast = { text, color, time: duration, max: duration };
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const game = new Game();
    window.__ABYSSAL_GAME__ = game;
    game.init();
  });
})();
