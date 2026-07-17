import {
  DEFAULT_META_V2,
  META_UPGRADES,
  WEAPONS,
} from "./data.js?v=20260718-1";
import { PixelRenderer, SaveStore, UiShell } from "./presentation.js?v=20260718-1";
import { ActionRuntime } from "./runtime.js?v=20260718-1";

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function qaOptions() {
  const params = new URLSearchParams(location.search);
  return {
    bot: params.get("bot") === "1",
    god: params.get("god") === "1",
    full: params.get("full") === "1",
    speed: Number(params.get("speed")) || 1,
    seed: params.get("seed") || null,
    room: Math.max(0, Math.min(14, Number(params.get("room")) || 0)),
    phase: params.get("phase") === "ascent" ? "ascent" : "descent",
  };
}

function prerequisiteStatus(meta, requirement) {
  if (!requirement) return { available: true, reason: "" };
  if (requirement.type === "boss_sigils") {
    const missing = (requirement.sigils || []).filter((sigil) => !meta.bossSigils?.[sigil]);
    return missing.length
      ? { available: false, reason: `Defeat and extract the ${missing.join(" + ")} sigil` }
      : { available: true, reason: "" };
  }
  if (requirement.type === "successful_extractions") {
    const count = Number(requirement.count) || 1;
    return meta.successfulExtractions >= count
      ? { available: true, reason: "" }
      : { available: false, reason: `Requires ${count} successful extraction${count === 1 ? "" : "s"}` };
  }
  return { available: true, reason: "" };
}

const UPGRADE_COPY = {
  license_repeater: "Unlock the Rivet Repeater: mobile automatic fire and a pinning bolt.",
  license_maul: "Unlock the Bell Maul: crushing poise damage and a bullet-clearing aftershock.",
  license_prism: "Unlock the Prism Rifle: precision ricochets and temporary shot splitters.",
  field_rations: "Increase maximum health. Deeper rooms are balanced around this preparation.",
  reinforced_frame: "Raise burden thresholds so more treasure stays Agile or Laden.",
  dash_bearings: "Shorten dash recovery in every burden tier.",
  reflex_coil: "Widen the universal melee and projectile deflect window slightly.",
  basin_lens: "Gain a reward reroll in every biome.",
  forge_slot: "Begin future expeditions with a wider Technique draft.",
  reinforced_pulleys: "Improve Loot Balloon retention from the brutal base air tax.",
  relic_harness: "Reduce the weight of the first boss relic you carry home.",
  field_surgery: "Restore more health after defeating a Gate Guardian.",
};

function audio() {
  return window.audioEngine || window.AbyssalAudio || null;
}

export class AbyssalWeightGame {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.stage = document.getElementById("gameStage");
    this.store = new SaveStore({ defaults: DEFAULT_META_V2 });
    this.meta = this.store.load();
    this.qa = qaOptions();
    this.renderer = null;
    this.ui = null;
    this.runtime = null;
    this.lastFrame = performance.now();
    this.snapshotTimer = 0;
    this.running = true;
    this.unlockHandler = () => audio()?.unlock?.();
  }

  async init() {
    this.repairUnlocks();
    this.ui = new UiShell({ onCommand: (command, detail) => this.handleCommand(command, detail) });
    this.ui.showLoading("Forging thirty encounters and three hostile ecosystems.");
    this.renderer = new PixelRenderer({ canvas: this.canvas, stage: this.stage });
    try {
      await this.renderer.loadAssets();
    } catch (error) {
      console.warn("Pixel tiles could not be loaded; geometric pixel fallback remains active.", error);
    }

    if (window.AudioEngine) {
      window.audioEngine = new window.AudioEngine({ muted: this.meta.settings.muted, mode: "hub", biome: "moss" });
    }
    this.ui.setMuted(this.meta.settings.muted);
    addEventListener("pointerdown", this.unlockHandler, { passive: true });
    addEventListener("keydown", this.unlockHandler, { passive: true });

    const runtimeMeta = this.qa.bot && this.qa.full ? this.makeFullQaMeta() : this.meta;
    this.runtime = new ActionRuntime({
      canvas: this.canvas,
      meta: runtimeMeta,
      ui: this.ui,
      renderer: this.renderer,
      qa: this.qa,
      onMetaChanged: (nextMeta) => {
        if (!(this.qa.bot && this.qa.full)) {
          this.meta = nextMeta;
          this.store.save(this.meta);
        }
      },
    });

    this.ui.hideLoading();
    if (this.qa.bot) {
      this.runtime.beginRun(runtimeMeta.selectedWeapon || "chainblade", this.qa.room);
      if (this.qa.phase === "ascent") {
        this.runtime.run.carriedValue = 1800 + this.qa.room * 220;
        this.runtime.run.carriedWeight = 82 + this.qa.room * 3;
        this.runtime.enterRoom(this.qa.room, "ascent");
      }
    } else {
      this.showTitle();
    }
    this.lastFrame = performance.now();
    requestAnimationFrame((now) => this.loop(now));
  }

  makeFullQaMeta() {
    const meta = clone(this.meta);
    meta.bossSigils = { root: true, glass: true, forge: true };
    meta.shortcuts = [true, true, true];
    meta.unlockedWeapons = Object.keys(WEAPONS);
    meta.unlockedTechniques = [...new Set([...meta.unlockedTechniques, ...DEFAULT_META_V2.unlockedTechniques])];
    meta.selectedWeapon = "repeater";
    meta.upgrades.field_rations = 2;
    meta.upgrades.dash_bearings = 2;
    meta.upgrades.reinforced_frame = 2;
    meta.upgrades.reflex_coil = 1;
    meta.upgrades.basin_lens = 2;
    return meta;
  }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.runtime.advance(dt);
    this.snapshotTimer -= dt;
    if (this.snapshotTimer <= 0) {
      this.snapshotTimer = 0.25;
      window.__AW_QA_SNAPSHOT__ = this.runtime.snapshot();
      window.__AW_QA_SNAPSHOT__.canvas = {
        backingWidth: this.canvas.width,
        backingHeight: this.canvas.height,
        cssWidth: this.canvas.getBoundingClientRect().width,
        cssHeight: this.canvas.getBoundingClientRect().height,
        integerScale: this.renderer.scale,
        smoothing: this.renderer.ctx.imageSmoothingEnabled,
      };
    }
    requestAnimationFrame((next) => this.loop(next));
  }

  showTitle() {
    audio()?.setMusicState?.({ mode: "hub", biome: "moss", intensity: 0.05 });
    this.ui.renderTitle(this.meta);
  }

  showHub() {
    audio()?.setMusicState?.({ mode: "hub", biome: "moss", intensity: 0.1 });
    this.ui.renderHub(this.meta, this.upgradeViewModels());
  }

  upgradeViewModels() {
    return Object.values(META_UPGRADES).map((upgrade) => {
      const requirements = upgrade.prerequisites || [];
      const blocked = requirements.map((entry) => prerequisiteStatus(this.meta, entry)).find((entry) => !entry.available);
      return {
        ...upgrade,
        description: UPGRADE_COPY[upgrade.id] || "Permanent expedition equipment.",
        available: !blocked,
        locked: Boolean(blocked),
        lockReason: blocked?.reason || "",
      };
    });
  }

  repairUnlocks() {
    const unlocked = new Set(this.meta.unlockedWeapons || ["chainblade"]);
    unlocked.add("chainblade");
    for (const upgrade of Object.values(META_UPGRADES)) {
      if ((this.meta.upgrades?.[upgrade.id] || 0) <= 0) continue;
      for (const effect of upgrade.effects || []) {
        if (effect.type === "unlock_weapon") unlocked.add(effect.id);
      }
    }
    this.meta.unlockedWeapons = [...unlocked].filter((id) => WEAPONS[id]);
    if (!this.meta.unlockedWeapons.includes(this.meta.selectedWeapon)) this.meta.selectedWeapon = this.meta.unlockedWeapons[0];
    this.store.save(this.meta);
  }

  buyUpgrade(id) {
    const upgrade = META_UPGRADES[id];
    if (!upgrade) return;
    const rank = this.meta.upgrades[id] || 0;
    if (rank >= upgrade.maxRank) return;
    const blocked = (upgrade.prerequisites || []).map((entry) => prerequisiteStatus(this.meta, entry)).find((entry) => !entry.available);
    if (blocked) {
      this.ui.toast(blocked.reason, { tone: "danger" });
      return;
    }
    const cost = upgrade.costs[rank];
    if (this.meta.grit < cost) {
      this.ui.toast(`Need ${cost - this.meta.grit} more Grit`, { tone: "danger" });
      return;
    }
    this.meta.grit -= cost;
    this.meta.upgrades[id] = rank + 1;
    for (const effect of upgrade.effects || []) {
      if (effect.type === "unlock_weapon" && !this.meta.unlockedWeapons.includes(effect.id)) this.meta.unlockedWeapons.push(effect.id);
    }
    this.store.save(this.meta);
    audio()?.play?.("reward", { permanent: true });
    this.ui.toast(`${upgrade.name} · rank ${rank + 1}`);
    this.showHub();
  }

  addTestGrit() {
    this.meta.grit = Math.max(0, Number(this.meta.grit) || 0) + 10;
    this.store.save(this.meta);
    this.ui.toast("Testing grant · +10 Grit");
    this.showHub();
  }

  selectWeapon(id) {
    if (!this.meta.unlockedWeapons.includes(id) || !WEAPONS[id]) return;
    this.meta.selectedWeapon = id;
    this.store.save(this.meta);
    audio()?.play?.("weaponSwap", { weapon: id });
    this.showHub();
  }

  startRun() {
    audio()?.unlock?.();
    this.runtime.meta = this.meta;
    this.runtime.beginRun(this.meta.selectedWeapon || "chainblade", 0);
    this.stage.querySelector("#touchControls")?.classList.add("is-active");
  }

  showControls() {
    this.ui.showScreen(`
      <p class="screen-kicker">FIELD MANUAL</p>
      <h2>MOVE LIKE YOU MEAN IT</h2>
      <p>Combat is cancel-driven and fast. Enemy tells are compact; watch bodies, weapons, and projectile lanes.</p>
      <div class="screen-grid">
        <article class="screen-card"><span class="screen-label">MOVE + AIM</span><strong>WASD · MOUSE</strong><p>Movement accelerates immediately. Aim is independent from travel.</p></article>
        <article class="screen-card"><span class="screen-label">ATTACK</span><strong>CLICK / J · K</strong><p>Primary attacks build pressure. K uses your weapon's distinct Technique.</p></article>
        <article class="screen-card"><span class="screen-label">SURVIVE</span><strong>SPACE · SHIFT</strong><p>Dash through danger. Shift deflects bullets and interrupts melee at impact.</p></article>
      </div>
      <p><strong>R</strong> reloads firearms. <strong>Q</strong> swaps unlocked weapons. <strong>Esc</strong> pauses. Keep attacking to build Drive; retreat too long and the Abyss dispatches a Hunter.</p>
      <div class="screen-actions"><button type="button" data-command="back-title">BACK</button></div>
    `);
  }

  toggleSound() {
    const engine = audio();
    const muted = engine?.toggleMuted?.() ?? !this.meta.settings.muted;
    this.meta.settings.muted = muted;
    this.store.save(this.meta);
    this.ui.setMuted(muted);
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await this.stage.requestFullscreen();
      else await document.exitFullscreen();
      this.ui.setFullscreen(Boolean(document.fullscreenElement));
    } catch {
      this.ui.toast("Fullscreen is unavailable in this browser.");
    }
  }

  handleCommand(command, detail = {}) {
    audio()?.unlock?.();
    audio()?.play?.("ui");
    switch (command) {
      case "enter-hub": this.showHub(); break;
      case "open-controls": this.showControls(); break;
      case "back-title": this.showTitle(); break;
      case "add-test-grit": this.addTestGrit(); break;
      case "buy-upgrade": this.buyUpgrade(detail.id); break;
      case "select-weapon": this.selectWeapon(detail.id); break;
      case "start-run": this.startRun(); break;
      case "choose-reward": this.runtime.chooseReward(detail.id); break;
      case "reroll-reward": this.runtime.rerollReward(); break;
      case "continue-descent": this.runtime.continueDescent(); break;
      case "begin-ascent": this.runtime.beginAscent(); break;
      case "use-balloon": this.runtime.useBalloon(); break;
      case "resume-run": this.runtime.resume(); break;
      case "abandon-run": this.runtime.abandonRun(); break;
      case "return-hub":
        this.stage.querySelector("#touchControls")?.classList.remove("is-active");
        this.showHub();
        break;
      case "retry-run": this.startRun(); break;
      case "toggle-sound": this.toggleSound(); break;
      case "toggle-fullscreen": this.toggleFullscreen(); break;
      default: break;
    }
  }

  destroy() {
    this.running = false;
    removeEventListener("pointerdown", this.unlockHandler);
    removeEventListener("keydown", this.unlockHandler);
    this.renderer?.destroy();
    this.ui?.destroy();
    audio()?.destroy?.();
  }
}
