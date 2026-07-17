(function (scope) {
  "use strict";

  const AUDIO_MODES = new Set([
    "hub",
    "descent",
    "ascent",
    "boss",
    "death",
    "victory",
  ]);

  const BIOMES = new Set(["moss", "crystal", "foundry"]);

  const SFX_NAMES = new Set([
    "ui",
    "attack",
    "melee",
    "shoot",
    "ricochet",
    "reload",
    "empty",
    "hit",
    "enemyHit",
    "coin",
    "dodge",
    "dash",
    "block",
    "perfect",
    "parry",
    "deflect",
    "stagger",
    "execute",
    "explosion",
    "enemyTell",
    "hazard",
    "weaponSwap",
    "hurt",
    "death",
    "step",
    "basin",
    "balloon",
    "reward",
    "roomClear",
    "extract",
    "bossRoar",
    "bossPhase",
  ]);

  // Dense combat can request the same cue many times in one simulation tick.
  // These tiny voice limits preserve the attack rhythm without flattening the
  // whole mix under a wall of overlapping transients.
  const SFX_COOLDOWNS = Object.freeze({
    ui: 0.025,
    melee: 0.035,
    attack: 0.035,
    shoot: 0.026,
    ricochet: 0.025,
    reload: 0.08,
    empty: 0.08,
    hit: 0.035,
    enemyHit: 0.025,
    coin: 0.035,
    dash: 0.08,
    dodge: 0.08,
    block: 0.055,
    perfect: 0.08,
    parry: 0.08,
    deflect: 0.055,
    stagger: 0.09,
    execute: 0.15,
    explosion: 0.075,
    enemyTell: 0.06,
    hazard: 0.09,
    weaponSwap: 0.09,
    hurt: 0.08,
    death: 0.3,
    step: 0.055,
    reward: 0.14,
    roomClear: 0.25,
    bossRoar: 0.5,
    bossPhase: 0.45,
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finiteOr = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  const midiToHz = (note) => 440 * Math.pow(2, (note - 69) / 12);

  /**
   * Dependency-free procedural audio for Abyssal Weight.
   *
   * Create one instance, call unlock() from the first pointer/key interaction,
   * then drive setMode(), setCombatIntensity(), and sfx() from game state.
   */
  class AudioEngine {
    constructor(options = {}) {
      this.ctx = null;
      this.masterGain = null;
      this.musicGain = null;
      this.sfxGain = null;
      this.compressor = null;

      this.mode = AUDIO_MODES.has(options.mode) ? options.mode : "hub";
      this.biome = BIOMES.has(options.biome) ? options.biome : "moss";
      this.bossPhase = clamp(Math.round(finiteOr(options.bossPhase, 1)), 1, 3);
      this.combatIntensity = 0;
      this.muted = Boolean(options.muted);
      this.masterVolume = clamp(finiteOr(options.masterVolume, 0.42), 0, 1);
      this.musicVolume = clamp(finiteOr(options.musicVolume, 0.2), 0, 1);
      this.sfxVolume = clamp(finiteOr(options.sfxVolume, 0.62), 0, 1);

      this._unlocked = false;
      this._unlockPromise = null;
      this._destroyed = false;
      this._noiseBuffer = null;
      this._voices = new Set();
      this._lastSfx = new Map();
      this._musicTimer = null;
      this._musicStep = 0;
      this._nextMusicTime = 0;
      this._lookAhead = 0.14;
      this._schedulerPeriod = 50;

      this._onVisibilityChange = () => {
        if (!this.ctx) return;
        if (typeof document !== "undefined" && document.hidden) {
          this._stopVoices("music");
          return;
        }
        this._nextMusicTime = this.ctx.currentTime + 0.04;
      };

      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", this._onVisibilityChange);
      }
    }

    async unlock() {
      if (this._destroyed) return false;
      if (this._unlockPromise) return this._unlockPromise;

      this._unlockPromise = this._performUnlock();
      try {
        return await this._unlockPromise;
      } finally {
        this._unlockPromise = null;
      }
    }

    async _performUnlock() {
      if (this.ctx && this.ctx.state === "closed") this.ctx = null;
      if (!this.ctx && !this._createGraph()) return false;

      try {
        if (this.ctx.state !== "running") await this.ctx.resume();
      } catch (_error) {
        return false;
      }

      this._unlocked = this.ctx.state === "running";
      if (this._unlocked) {
        this._applyMasterVolume(true);
        this._startMusicScheduler();
      }
      return this._unlocked;
    }

    _createGraph() {
      const Context = scope.AudioContext || scope.webkitAudioContext;
      if (!Context) return false;

      try {
        try {
          this.ctx = new Context({ latencyHint: "interactive" });
        } catch (_error) {
          this.ctx = new Context();
        }

        this.masterGain = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();
        this.compressor = this.ctx.createDynamicsCompressor();

        this.musicGain.gain.value = this.musicVolume;
        this.sfxGain.gain.value = this.sfxVolume;
        this.masterGain.gain.value = 0;

        this.compressor.threshold.value = -16;
        this.compressor.knee.value = 12;
        this.compressor.ratio.value = 5;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.18;

        this.musicGain.connect(this.masterGain);
        this.sfxGain.connect(this.masterGain);
        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
        return true;
      } catch (_error) {
        this.ctx = null;
        return false;
      }
    }

    setMuted(shouldMute) {
      this.muted = Boolean(shouldMute);
      this._applyMasterVolume();
      if (!this.muted && this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
      return this.muted;
    }

    toggleMuted() {
      return this.setMuted(!this.muted);
    }

    _applyMasterVolume(immediate = false) {
      if (!this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime;
      const target = this.muted ? 0 : this.masterVolume;
      const param = this.masterGain.gain;
      param.cancelScheduledValues(now);
      if (immediate) {
        param.setValueAtTime(target, now);
      } else {
        param.setTargetAtTime(target, now, 0.025);
      }
    }

    setMode(mode) {
      if (!AUDIO_MODES.has(mode) || mode === this.mode) return this.mode;
      this.mode = mode;
      this._musicStep = 0;

      if (this.ctx) {
        // Let already-playing notes finish their short envelopes; hard-stopping
        // oscillators creates clicks precisely when a scene change should breathe.
        this._nextMusicTime = this.ctx.currentTime + 0.075;
      }
      return this.mode;
    }

    setBiome(biome) {
      if (!BIOMES.has(biome) || biome === this.biome) return this.biome;
      this.biome = biome;
      this._musicStep = 0;
      if (this.ctx) this._nextMusicTime = this.ctx.currentTime + 0.045;
      return this.biome;
    }

    setBossPhase(phase) {
      const next = clamp(Math.round(finiteOr(phase, 1)), 1, 3);
      if (next === this.bossPhase) return this.bossPhase;
      this.bossPhase = next;
      this._musicStep = 0;
      if (this.ctx) this._nextMusicTime = this.ctx.currentTime + 0.035;
      return this.bossPhase;
    }

    /**
     * Compact state API for room transitions. Every key is optional:
     * audio.setMusicState({ mode: "boss", biome: "crystal", intensity: .8, bossPhase: 2 })
     */
    setMusicState(state = {}) {
      if (state.mode != null) this.setMode(state.mode);
      if (state.biome != null) this.setBiome(state.biome);
      if (state.intensity != null) this.setCombatIntensity(state.intensity);
      if (state.bossPhase != null) this.setBossPhase(state.bossPhase);
      return this.getState();
    }

    setVolumes(options = {}) {
      if (options.master != null) this.masterVolume = clamp(finiteOr(options.master, this.masterVolume), 0, 1);
      if (options.music != null) this.musicVolume = clamp(finiteOr(options.music, this.musicVolume), 0, 1);
      if (options.sfx != null) this.sfxVolume = clamp(finiteOr(options.sfx, this.sfxVolume), 0, 1);
      if (this.ctx) {
        const now = this.ctx.currentTime;
        this.musicGain.gain.setTargetAtTime(this._musicTarget(), now, 0.04);
        this.sfxGain.gain.setTargetAtTime(this.sfxVolume, now, 0.04);
        this._applyMasterVolume();
      }
      return this.getState();
    }

    getState() {
      return {
        unlocked: this._unlocked,
        muted: this.muted,
        mode: this.mode,
        biome: this.biome,
        intensity: this.combatIntensity,
        bossPhase: this.bossPhase,
        masterVolume: this.masterVolume,
        musicVolume: this.musicVolume,
        sfxVolume: this.sfxVolume,
      };
    }

    setCombatIntensity(value) {
      const numeric = Number(value);
      const next = Number.isFinite(numeric) ? clamp(numeric, 0, 1) : 0;
      if (Math.abs(next - this.combatIntensity) < 0.015) return this.combatIntensity;
      this.combatIntensity = next;
      if (this.ctx && this.musicGain) {
        const now = this.ctx.currentTime;
        this.musicGain.gain.setTargetAtTime(this._musicTarget(), now, 0.15);
      }
      return this.combatIntensity;
    }

    _musicTarget() {
      return this.musicVolume * (0.88 + this.combatIntensity * 0.18);
    }

    _duckMusic(amount = 0.36, duration = 0.16) {
      if (!this.ctx || !this.musicGain) return;
      const now = this.ctx.currentTime;
      const gain = this.musicGain.gain;
      const target = this._musicTarget();
      gain.cancelScheduledValues(now);
      gain.setTargetAtTime(target * clamp(1 - amount, 0.35, 1), now, 0.008);
      gain.setTargetAtTime(target, now + Math.max(0.04, duration), 0.055);
    }

    _startMusicScheduler() {
      if (this._musicTimer || !this.ctx) return;
      this._musicStep = 0;
      this._nextMusicTime = this.ctx.currentTime + 0.05;
      this._musicTimer = scope.setInterval(() => this._scheduleMusic(), this._schedulerPeriod);
      this._scheduleMusic();
    }

    _scheduleMusic() {
      if (
        !this.ctx ||
        this.ctx.state !== "running" ||
        this._destroyed ||
        (typeof document !== "undefined" && document.hidden)
      ) {
        return;
      }

      const now = this.ctx.currentTime;
      if (this._nextMusicTime < now - 0.1) this._nextMusicTime = now + 0.03;
      if (this.muted) {
        this._nextMusicTime = now + 0.04;
        return;
      }

      let scheduled = 0;
      while (this._nextMusicTime < now + this._lookAhead && scheduled < 8) {
        const stepDuration = 30 / this._musicTempo();
        this._composeMusicStep(this._musicStep, this._nextMusicTime, stepDuration);
        this._nextMusicTime += stepDuration;
        this._musicStep = (this._musicStep + 1) % 64;
        scheduled += 1;
      }
    }

    _musicTempo() {
      const base = {
        hub: 68,
        descent: 100,
        ascent: 118,
        boss: 136,
        death: 54,
        victory: 96,
      }[this.mode];
      const intensityBoost = {
        hub: 3,
        descent: 14,
        ascent: 16,
        boss: 12,
        death: 0,
        victory: 4,
      }[this.mode];
      const biomePush = this.biome === "foundry" ? 4 : this.biome === "crystal" ? 2 : 0;
      const phasePush = this.mode === "boss" ? (this.bossPhase - 1) * 4 : 0;
      return base + biomePush + phasePush + intensityBoost * this.combatIntensity;
    }

    _composeMusicStep(step, time, duration) {
      const s = step % 16;
      switch (this.mode) {
        case "hub":
          this._musicHub(s, time, duration);
          break;
        case "descent":
          this._musicDescent(s, time, duration);
          break;
        case "ascent":
          this._musicAscent(s, time, duration);
          break;
        case "boss":
          this._musicBoss(s, time, duration);
          break;
        case "death":
          this._musicDeath(s, time, duration);
          break;
        case "victory":
          this._musicVictory(s, time, duration);
          break;
      }
    }

    _musicHub(step, time, d) {
      const root = 38;
      if (step % 4 === 0) {
        const bass = [0, -2, 3, -2][step / 4];
        this._tone({
          freq: midiToHz(root + bass),
          time,
          duration: d * 3.7,
          type: "triangle",
          volume: 0.052,
          attack: 0.045,
          release: d * 1.5,
          filterFreq: 540,
          bus: this.musicGain,
          category: "music",
        });
      }
      const pluckSteps = [0, 3, 6, 10, 12, 15];
      const index = pluckSteps.indexOf(step);
      if (index !== -1) {
        const notes = [12, 15, 19, 17, 22, 19];
        this._tone({
          freq: midiToHz(root + notes[index]),
          time,
          duration: d * 0.72,
          type: "square",
          volume: 0.024,
          attack: 0.008,
          release: d * 0.48,
          filterFreq: 1450,
          bus: this.musicGain,
          category: "music",
        });
      }
      if (step === 7 || step === 15) {
        this._tone({
          freq: midiToHz(root + (step === 7 ? 27 : 24)),
          time,
          duration: d * 2.2,
          type: "sine",
          volume: 0.022,
          attack: 0.015,
          release: d * 1.5,
          bus: this.musicGain,
          category: "music",
        });
      }
    }

    _musicDescent(step, time, d) {
      this._musicAction(step, time, d, "descent");
    }

    _musicAscent(step, time, d) {
      this._musicAction(step, time, d, "ascent");
    }

    _musicBoss(step, time, d) {
      this._musicAction(step, time, d, "boss");
    }

    /**
     * The action score is assembled from independent layers. Intensity adds
     * subdivisions and a lead instead of merely making the same loop louder;
     * ascent adds pursuit syncopation, while boss phases alter the ostinato.
     */
    _musicAction(step, time, d, direction) {
      const palette = {
        moss: {
          root: 38,
          bass: [0, 0, 3, 5, 0, 7, 5, 3],
          arp: [12, 15, 19, 22, 19, 15, 17, 14],
          lead: [24, 22, 19, 17, 22, 24, 27, 22],
          bassType: "triangle",
          bassFilter: 720,
        },
        crystal: {
          root: 41,
          bass: [0, -2, 3, 1, 0, 5, 3, -2],
          arp: [12, 19, 15, 22, 17, 24, 19, 15],
          lead: [24, 27, 31, 29, 27, 22, 24, 19],
          bassType: "triangle",
          bassFilter: 920,
        },
        foundry: {
          root: 34,
          bass: [0, 0, 1, 6, 0, 8, 6, 1],
          arp: [12, 13, 18, 13, 20, 18, 13, 11],
          lead: [24, 25, 30, 29, 25, 32, 30, 25],
          bassType: "sawtooth",
          bassFilter: 590,
        },
      }[this.biome];

      const isAscent = direction === "ascent";
      const isBoss = direction === "boss";
      const phaseEnergy = isBoss ? (this.bossPhase - 1) * 0.16 : 0;
      const energy = clamp(
        this.combatIntensity + (isAscent ? 0.14 : 0) + (isBoss ? 0.32 : 0) + phaseEnergy,
        0,
        1,
      );
      const bassIndex = step / 2;

      // Foundation: each biome keeps a recognizable low-register identity.
      if (step % 2 === 0) {
        let note = palette.bass[bassIndex];
        if (isBoss && this.bossPhase === 2 && step >= 8) note += 1;
        if (isBoss && this.bossPhase === 3 && (step === 6 || step === 14)) note += 6;
        this._tone({
          freq: midiToHz(palette.root + note),
          time,
          duration: d * (isBoss ? 1.76 : 1.52),
          type: isAscent || isBoss ? "sawtooth" : palette.bassType,
          volume: isBoss ? 0.059 : 0.049,
          attack: 0.004,
          release: d * 0.66,
          filterFreq: palette.bassFilter + energy * 470,
          bus: this.musicGain,
          category: "music",
        });
      }

      // Percussion communicates threat state before the player reads the HUD.
      const kickSteps = isBoss
        ? (energy > 0.78 ? [0, 2, 6, 8, 10, 14] : [0, 6, 8, 14])
        : isAscent
          ? [0, 3, 8, 11]
          : [0, 8];
      if (kickSteps.includes(step) || (energy > 0.84 && step === 12)) {
        this._kick(time, (isBoss ? 0.074 : 0.058) + energy * 0.009, "music", 0, this.biome === "foundry" ? 82 : 96);
      }
      if (step === 4 || step === 12) {
        this._snare(time, (isBoss ? 0.046 : 0.034) + energy * 0.007, "music");
      }
      if ((energy > 0.24 && step % 2 === 1) || (energy > 0.72 && step % 2 === 0)) {
        this._hat(time, 0.009 + energy * 0.013, "music");
      }

      // Biome texture layer: organic drums, glass harmonics, or machinery.
      if (this.biome === "moss") {
        if ([3, 7, 11, 15].includes(step)) {
          this._tone({
            freq: (step === 7 || step === 15 ? 96 : 118) + energy * 18,
            endFreq: 54,
            time,
            duration: d * 0.7,
            type: "sine",
            volume: 0.025 + energy * 0.01,
            release: d * 0.55,
            bus: this.musicGain,
            category: "music",
          });
        }
        if ((step === 2 || step === 10) && energy > 0.52) {
          this._noise({
            time,
            duration: d * 0.6,
            volume: 0.012,
            filterType: "bandpass",
            filterFreq: 780,
            endFilterFreq: 1260,
            q: 1.4,
            bus: this.musicGain,
            category: "music",
          });
        }
      } else if (this.biome === "crystal") {
        if (step % 2 === 0 || energy > 0.58) {
          const arpIndex = energy > 0.58 ? step % 8 : bassIndex % 8;
          this._tone({
            freq: midiToHz(palette.root + palette.arp[arpIndex]),
            time,
            duration: d * 0.58,
            type: step % 4 === 0 ? "sine" : "square",
            volume: 0.019 + energy * 0.008,
            release: d * 0.42,
            filterFreq: 2900 + energy * 900,
            bus: this.musicGain,
            category: "music",
          });
        }
        if ((step === 5 || step === 13) && energy > 0.3) {
          [0, 7, 12].forEach((offset, index) => this._tone({
            freq: midiToHz(palette.root + 24 + offset),
            time: time + index * 0.012,
            duration: d * 1.15,
            type: "sine",
            volume: 0.011,
            attack: 0.003,
            release: d * 0.9,
            bus: this.musicGain,
            category: "music",
          }));
        }
      } else {
        if ([2, 6, 10, 14].includes(step)) {
          this._tone({
            freq: (step % 8 === 2 ? 244 : 184),
            endFreq: 92,
            time,
            duration: d * 0.38,
            type: "square",
            volume: 0.025 + energy * 0.009,
            release: d * 0.26,
            filterFreq: 1250,
            bus: this.musicGain,
            category: "music",
          });
          this._noise({
            time,
            duration: d * 0.25,
            volume: 0.018,
            filterType: "bandpass",
            filterFreq: 1850,
            q: 2.2,
            bus: this.musicGain,
            category: "music",
          });
        }
      }

      // Momentum lead; only enters once combat is underway, then doubles at
      // maximum pressure or in the final boss phase.
      if (energy > 0.46 && (step % 2 === 0 || energy > 0.8)) {
        const leadIndex = energy > 0.8 ? step % 8 : bassIndex % 8;
        this._tone({
          freq: midiToHz(palette.root + palette.lead[leadIndex]),
          time,
          duration: d * (energy > 0.8 ? 0.4 : 0.62),
          type: this.biome === "crystal" ? "sine" : "square",
          volume: 0.014 + energy * 0.012,
          release: d * 0.25,
          filterFreq: this.biome === "foundry" ? 2050 : 2750,
          bus: this.musicGain,
          category: "music",
        });
      }
    }

    _musicDeath(step, time, d) {
      const notes = [50, 48, 45, 43];
      if (step % 4 === 0) {
        const index = step / 4;
        this._tone({
          freq: midiToHz(notes[index]),
          time,
          duration: d * 3.5,
          type: index === 3 ? "triangle" : "square",
          volume: 0.032,
          attack: 0.025,
          release: d * 2.1,
          filterFreq: 760,
          bus: this.musicGain,
          category: "music",
        });
        this._tone({
          freq: midiToHz(notes[index] - 12),
          time,
          duration: d * 3.7,
          type: "sine",
          volume: 0.041,
          attack: 0.04,
          release: d * 2,
          bus: this.musicGain,
          category: "music",
        });
      }
    }

    _musicVictory(step, time, d) {
      const root = 38;
      const arp = [0, 4, 7, 12, 7, 4, 9, 12];
      if (step % 2 === 0) {
        this._tone({
          freq: midiToHz(root + 12 + arp[step / 2]),
          time,
          duration: d * 1.45,
          type: "square",
          volume: 0.028,
          release: d * 0.7,
          filterFreq: 2300,
          bus: this.musicGain,
          category: "music",
        });
      }
      if (step % 4 === 0) {
        this._tone({
          freq: midiToHz(root + [0, 5, 7, 5][step / 4]),
          time,
          duration: d * 3.4,
          type: "triangle",
          volume: 0.049,
          attack: 0.012,
          release: d * 1.3,
          bus: this.musicGain,
          category: "music",
        });
        this._kick(time, 0.038, "music");
      }
      if (step === 4 || step === 12) this._snare(time, 0.025, "music");
      if (step === 7 || step === 15) {
        this._tone({
          freq: midiToHz(root + (step === 7 ? 28 : 31)),
          time,
          duration: d * 1.9,
          type: "sine",
          volume: 0.027,
          release: d * 1.2,
          bus: this.musicGain,
          category: "music",
        });
      }
    }

    sfx(name, options = {}) {
      if (!SFX_NAMES.has(name) || this._destroyed) return false;

      if (!this.ctx) this.unlock().catch(() => {});
      if (!this.ctx || this.muted) return false;
      if (this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
        return false;
      }
      if (this.ctx.state !== "running") return false;

      const audibleNow = this.ctx.currentTime;
      const cooldownKey = `${name}:${options.voice || "global"}`;
      const cooldown = finiteOr(options.cooldown, SFX_COOLDOWNS[name] || 0);
      const lastPlayed = this._lastSfx.get(cooldownKey) ?? -Infinity;
      if (!options.force && audibleNow - lastPlayed < cooldown) return false;
      this._lastSfx.set(cooldownKey, audibleNow);

      const now = audibleNow + 0.004;
      const volume = clamp(finiteOr(options.volume, 1), 0, 2);
      const pitch = clamp(finiteOr(options.pitch, 1), 0.45, 2.2);
      const pan = clamp(finiteOr(options.pan, 0), -1, 1);
      const heavy = Boolean(options.heavy);
      const variant = clamp(Math.round(finiteOr(options.variant, 0)), 0, 3);
      const tone = (config) => this._tone({
        bus: this.sfxGain,
        category: "sfx",
        pan,
        ...config,
      });
      const noise = (config) => this._noise({
        bus: this.sfxGain,
        category: "sfx",
        pan,
        ...config,
      });

      switch (name) {
        case "ui":
          tone({ freq: 660 * pitch, time: now, duration: 0.045, type: "square", volume: 0.055 * volume, release: 0.025, filterFreq: 2400 });
          break;
        case "attack":
        case "melee": {
          const length = heavy ? 0.21 : 0.125;
          const color = 1 + variant * 0.075;
          tone({ freq: (heavy ? 180 : 280) * pitch * color, endFreq: (heavy ? 52 : 92) * pitch, time: now, duration: length, type: "sawtooth", volume: (heavy ? 0.14 : 0.105) * volume, release: length * 0.72, filterFreq: heavy ? 900 : 1500 });
          noise({ time: now, duration: length * 0.8, volume: 0.065 * volume, filterType: "bandpass", filterFreq: (heavy ? 520 : 1050) * color, endFilterFreq: 2400, q: 1.3 });
          if (heavy) this._duckMusic(0.14, 0.08);
          break;
        }
        case "shoot": {
          const base = [620, 760, 490, 880][variant] * pitch;
          tone({ freq: base, endFreq: base * (heavy ? 0.28 : 0.52), time: now, duration: heavy ? 0.13 : 0.072, type: variant === 2 ? "sawtooth" : "square", volume: (heavy ? 0.118 : 0.076) * volume, release: heavy ? 0.09 : 0.042, filterFreq: heavy ? 1900 : 3400 });
          noise({ time: now, duration: heavy ? 0.08 : 0.038, volume: (heavy ? 0.08 : 0.052) * volume, filterType: "highpass", filterFreq: (heavy ? 1250 : 2600) * pitch });
          if (heavy) this._kick(now, 0.07 * volume, "sfx", pan, 78 * pitch);
          break;
        }
        case "ricochet":
          tone({ freq: (1380 + variant * 185) * pitch, endFreq: (810 + variant * 90) * pitch, time: now, duration: 0.095, type: "square", volume: 0.057 * volume, release: 0.07, filterFreq: 4400 });
          tone({ freq: (2080 + variant * 210) * pitch, time: now + 0.018, duration: 0.065, type: "sine", volume: 0.041 * volume, release: 0.05 });
          break;
        case "reload":
          [0, 0.075, 0.17].forEach((offset, index) => {
            const frequencies = heavy ? [230, 185, 420] : [420, 330, 720];
            tone({ freq: frequencies[index] * pitch, endFreq: frequencies[index] * 0.78, time: now + offset, duration: index === 2 ? 0.075 : 0.045, type: index === 2 ? "triangle" : "square", volume: (index === 2 ? 0.062 : 0.047) * volume, release: index === 2 ? 0.05 : 0.025, filterFreq: 2400 });
          });
          break;
        case "empty":
          tone({ freq: 310 * pitch, endFreq: 205 * pitch, time: now, duration: 0.052, type: "square", volume: 0.052 * volume, release: 0.032, filterFreq: 1900 });
          tone({ freq: 215 * pitch, time: now + 0.055, duration: 0.04, type: "triangle", volume: 0.034 * volume, release: 0.025 });
          break;
        case "hit":
          this._kick(now, 0.16 * volume, "sfx", pan, 112 * pitch);
          noise({ time: now, duration: 0.09, volume: 0.095 * volume, filterType: "bandpass", filterFreq: 510 * pitch, q: 1.7 });
          break;
        case "enemyHit":
          tone({ freq: (heavy ? 132 : 175) * pitch, endFreq: (heavy ? 44 : 67) * pitch, time: now, duration: heavy ? 0.17 : 0.12, type: "triangle", volume: (heavy ? 0.17 : 0.14) * volume, release: heavy ? 0.13 : 0.09, filterFreq: heavy ? 720 : 950 });
          noise({ time: now, duration: heavy ? 0.1 : 0.065, volume: (heavy ? 0.09 : 0.072) * volume, filterType: "bandpass", filterFreq: (heavy ? 540 : 820) * pitch, q: 1.1 });
          break;
        case "coin":
          tone({ freq: 880 * pitch, time: now, duration: 0.075, type: "square", volume: 0.068 * volume, release: 0.045, filterFreq: 3600 });
          tone({ freq: 1320 * pitch, time: now + 0.068, duration: 0.12, type: "square", volume: 0.064 * volume, release: 0.075, filterFreq: 3900 });
          break;
        case "dodge":
          noise({ time: now, duration: heavy ? 0.26 : 0.18, volume: (heavy ? 0.12 : 0.084) * volume, filterType: "bandpass", filterFreq: (heavy ? 260 : 620) * pitch, endFilterFreq: (heavy ? 900 : 2600) * pitch, q: 0.8 });
          tone({ freq: (heavy ? 82 : 145) * pitch, endFreq: (heavy ? 45 : 310) * pitch, time: now, duration: heavy ? 0.18 : 0.105, type: "triangle", volume: (heavy ? 0.072 : 0.038) * volume, release: heavy ? 0.14 : 0.07 });
          break;
        case "dash":
          noise({ time: now, duration: heavy ? 0.2 : 0.135, volume: (heavy ? 0.115 : 0.092) * volume, filterType: "bandpass", filterFreq: (heavy ? 310 : 780) * pitch, endFilterFreq: (heavy ? 1450 : 3900) * pitch, q: 0.7 });
          tone({ freq: (heavy ? 105 : 210) * pitch, endFreq: (heavy ? 62 : 520) * pitch, time: now, duration: heavy ? 0.15 : 0.09, type: "sawtooth", volume: (heavy ? 0.068 : 0.044) * volume, release: heavy ? 0.11 : 0.06, filterFreq: 1800 });
          break;
        case "block":
          this._metalChord(now, [218, 327, 463], 0.1, 0.052 * volume, pitch, pan);
          noise({ time: now, duration: 0.075, volume: 0.08 * volume, filterType: "highpass", filterFreq: 1700 * pitch });
          break;
        case "perfect":
          this._metalChord(now, [523, 1046, 1568], 0.18, 0.06 * volume, pitch, pan);
          tone({ freq: 2093 * pitch, time: now + 0.045, duration: 0.19, type: "sine", volume: 0.072 * volume, release: 0.15 });
          break;
        case "parry":
          this._kick(now, 0.14 * volume, "sfx", pan, 130 * pitch);
          this._metalChord(now, [294, 466, 740, 1175], 0.15, 0.064 * volume, pitch, pan);
          noise({ time: now, duration: 0.07, volume: 0.105 * volume, filterType: "highpass", filterFreq: 2100 * pitch });
          this._duckMusic(0.27, 0.12);
          break;
        case "deflect":
          this._metalChord(now, [392, 622, 988, 1568], 0.13, 0.052 * volume, pitch, pan);
          tone({ freq: 2350 * pitch, endFreq: 1480 * pitch, time: now + 0.025, duration: 0.12, type: "sine", volume: 0.058 * volume, release: 0.095 });
          noise({ time: now, duration: 0.045, volume: 0.083 * volume, filterType: "highpass", filterFreq: 2700 * pitch });
          this._duckMusic(0.2, 0.09);
          break;
        case "stagger":
          this._kick(now, 0.2 * volume, "sfx", pan, 92 * pitch);
          tone({ freq: 116 * pitch, endFreq: 43 * pitch, time: now, duration: 0.25, type: "square", volume: 0.105 * volume, release: 0.2, filterFreq: 620 });
          break;
        case "execute":
          noise({ time: now, duration: 0.24, volume: 0.13 * volume, filterType: "bandpass", filterFreq: 2100 * pitch, endFilterFreq: 360 * pitch, q: 0.7 });
          tone({ freq: 390 * pitch, endFreq: 48 * pitch, time: now, duration: 0.29, type: "sawtooth", volume: 0.16 * volume, release: 0.2, filterFreq: 1200 });
          this._kick(now + 0.09, 0.23 * volume, "sfx", pan, 105 * pitch);
          this._duckMusic(0.35, 0.18);
          break;
        case "explosion":
          noise({ time: now, duration: heavy ? 0.48 : 0.3, volume: (heavy ? 0.17 : 0.135) * volume, attack: 0.002, release: heavy ? 0.42 : 0.25, filterType: "lowpass", filterFreq: (heavy ? 1250 : 1750) * pitch, endFilterFreq: 130 * pitch, q: 0.8, playbackRate: heavy ? 0.62 : 0.83 });
          noise({ time: now, duration: heavy ? 0.19 : 0.12, volume: (heavy ? 0.1 : 0.075) * volume, filterType: "highpass", filterFreq: 2100 * pitch, endFilterFreq: 5800 * pitch });
          this._kick(now, (heavy ? 0.245 : 0.19) * volume, "sfx", pan, (heavy ? 88 : 112) * pitch);
          tone({ freq: (heavy ? 67 : 92) * pitch, endFreq: 31 * pitch, time: now, duration: heavy ? 0.42 : 0.27, type: "sine", volume: (heavy ? 0.18 : 0.12) * volume, release: heavy ? 0.36 : 0.22 });
          this._duckMusic(heavy ? 0.48 : 0.34, heavy ? 0.3 : 0.2);
          break;
        case "enemyTell": {
          const tellBase = [410, 515, 345, 625][variant] * pitch;
          tone({ freq: tellBase, endFreq: tellBase * 1.72, time: now, duration: heavy ? 0.18 : 0.11, type: variant === 1 ? "sine" : "square", volume: (heavy ? 0.062 : 0.052) * volume, attack: 0.002, release: heavy ? 0.13 : 0.075, filterFreq: 3200 });
          if (heavy) tone({ freq: tellBase * 0.5, time: now, duration: 0.16, type: "triangle", volume: 0.045 * volume, release: 0.12 });
          break;
        }
        case "hazard":
          if (heavy) {
            tone({ freq: 86 * pitch, endFreq: 42 * pitch, time: now, duration: 0.32, type: "sawtooth", volume: 0.09 * volume, attack: 0.025, release: 0.22, filterFreq: 650 });
            noise({ time: now, duration: 0.3, volume: 0.065 * volume, filterType: "lowpass", filterFreq: 840 * pitch, endFilterFreq: 190 * pitch, playbackRate: 0.65 });
          } else {
            noise({ time: now, duration: 0.22, volume: 0.058 * volume, filterType: "bandpass", filterFreq: (900 + variant * 410) * pitch, endFilterFreq: (2500 + variant * 330) * pitch, q: 1.2 });
            tone({ freq: (220 + variant * 75) * pitch, endFreq: (410 + variant * 110) * pitch, time: now, duration: 0.15, type: "triangle", volume: 0.035 * volume, release: 0.1 });
          }
          break;
        case "weaponSwap":
          noise({ time: now, duration: 0.065, volume: 0.045 * volume, filterType: "bandpass", filterFreq: 1050 * pitch, endFilterFreq: 2350 * pitch, q: 1.5 });
          tone({ freq: 360 * pitch, endFreq: 650 * pitch, time: now, duration: 0.08, type: "square", volume: 0.047 * volume, release: 0.05, filterFreq: 2900 });
          break;
        case "hurt":
          tone({ freq: 168 * pitch, endFreq: 59 * pitch, time: now, duration: 0.23, type: "sawtooth", volume: 0.125 * volume, release: 0.18, filterFreq: 830 });
          noise({ time: now, duration: 0.13, volume: 0.093 * volume, filterType: "bandpass", filterFreq: 390 * pitch, q: 0.9 });
          this._duckMusic(0.24, 0.13);
          break;
        case "death":
          [0, 0.17, 0.35].forEach((offset, index) => {
            tone({ freq: [196, 155.6, 110][index] * pitch, endFreq: [164, 130.8, 55][index] * pitch, time: now + offset, duration: 0.32 + index * 0.12, type: index === 2 ? "sawtooth" : "square", volume: (0.07 + index * 0.02) * volume, attack: 0.015, release: 0.24, filterFreq: 760 });
          });
          noise({ time: now + 0.28, duration: 0.65, volume: 0.065 * volume, filterType: "lowpass", filterFreq: 520, endFilterFreq: 120, playbackRate: 0.7 });
          break;
        case "step":
          noise({ time: now, duration: 0.045, volume: 0.033 * volume, filterType: "bandpass", filterFreq: (heavy ? 105 : 165) * pitch, q: 0.8 });
          tone({ freq: (heavy ? 51 : 68) * pitch, endFreq: 38 * pitch, time: now, duration: heavy ? 0.08 : 0.052, type: "sine", volume: (heavy ? 0.045 : 0.025) * volume, release: 0.04 });
          break;
        case "basin":
          [740, 554, 415, 277].forEach((frequency, index) => {
            tone({ freq: frequency * pitch, time: now + index * 0.075, duration: 0.11, type: "square", volume: 0.045 * volume, release: 0.075, filterFreq: 2300 });
          });
          this._kick(now + 0.28, (heavy ? 0.2 : 0.12) * volume, "sfx", pan, (heavy ? 58 : 78) * pitch);
          break;
        case "balloon":
          noise({ time: now, duration: 0.58, volume: 0.038 * volume, filterType: "highpass", filterFreq: 720, endFilterFreq: 2800, playbackRate: 1.2 });
          [392, 494, 587, 784].forEach((frequency, index) => {
            tone({ freq: frequency * pitch, time: now + index * 0.115, duration: 0.16, type: "square", volume: 0.045 * volume, release: 0.11, filterFreq: 2600 });
          });
          break;
        case "reward":
          [523, 659, 784, 1047].forEach((frequency, index) => {
            tone({ freq: frequency * pitch, time: now + index * 0.055, duration: index === 3 ? 0.3 : 0.11, type: index === 3 ? "sine" : "square", volume: (index === 3 ? 0.072 : 0.052) * volume, attack: 0.003, release: index === 3 ? 0.24 : 0.075, filterFreq: 3800 });
          });
          noise({ time: now, duration: 0.22, volume: 0.028 * volume, filterType: "highpass", filterFreq: 3100, endFilterFreq: 6700 });
          break;
        case "roomClear":
          [392, 523, 659].forEach((frequency, index) => {
            tone({ freq: frequency * pitch, time: now + index * 0.085, duration: index === 2 ? 0.38 : 0.16, type: index === 2 ? "triangle" : "square", volume: (index === 2 ? 0.083 : 0.061) * volume, attack: 0.004, release: index === 2 ? 0.3 : 0.1, filterFreq: 3100 });
          });
          this._kick(now, 0.075 * volume, "sfx", pan, 102 * pitch);
          break;
        case "extract":
          [294, 370, 440, 587, 740].forEach((frequency, index) => {
            tone({ freq: frequency * pitch, time: now + index * 0.105, duration: index === 4 ? 0.55 : 0.19, type: index === 4 ? "triangle" : "square", volume: (index === 4 ? 0.095 : 0.067) * volume, release: index === 4 ? 0.43 : 0.12, filterFreq: 2700 });
          });
          this._kick(now, 0.11 * volume, "sfx", pan, 95 * pitch);
          this._kick(now + 0.42, 0.13 * volume, "sfx", pan, 112 * pitch);
          break;
        case "bossRoar":
          noise({ time: now, duration: 1.15, volume: 0.12 * volume, filterType: "lowpass", filterFreq: 680 * pitch, endFilterFreq: 150 * pitch, q: 1.6, playbackRate: 0.52 });
          [-11, 0, 9].forEach((detune, index) => {
            tone({ freq: (72 + index * 6) * pitch, endFreq: (39 + index * 3) * pitch, detune, time: now + index * 0.025, duration: 0.92, type: "sawtooth", volume: 0.075 * volume, attack: 0.08, release: 0.5, filterFreq: 620 });
          });
          this._duckMusic(0.46, 0.5);
          break;
        case "bossPhase":
          [110, 147, 196, 277, 392].forEach((frequency, index) => {
            tone({ freq: frequency * pitch, endFreq: frequency * 1.08 * pitch, time: now + index * 0.055, duration: 0.2 + index * 0.04, type: index < 2 ? "sawtooth" : "square", volume: (0.065 + index * 0.006) * volume, attack: 0.006, release: 0.14 + index * 0.025, filterFreq: 1400 + index * 460 });
          });
          noise({ time: now + 0.12, duration: 0.48, volume: 0.1 * volume, filterType: "bandpass", filterFreq: 420 * pitch, endFilterFreq: 3200 * pitch, q: 0.75 });
          this._kick(now + 0.31, 0.24 * volume, "sfx", pan, 118 * pitch);
          this._duckMusic(0.55, 0.42);
          break;
      }
      return true;
    }

    play(name, options = {}) {
      return this.sfx(name, options);
    }

    /** Map a horizontal world position to stereo without exposing Web Audio. */
    playAt(name, x, center = 0, span = 320, options = {}) {
      const safeSpan = Math.max(1, Math.abs(finiteOr(span, 320)));
      const pan = clamp((finiteOr(x, center) - finiteOr(center, 0)) / (safeSpan * 0.5), -1, 1);
      return this.sfx(name, { ...options, pan });
    }

    _metalChord(time, frequencies, duration, volume, pitch = 1, pan = 0) {
      frequencies.forEach((frequency, index) => {
        this._tone({
          freq: frequency * pitch,
          time: time + index * 0.004,
          duration,
          type: index % 2 ? "square" : "triangle",
          volume,
          attack: 0.002,
          release: duration * 0.82,
          filterFreq: 3600,
          pan,
          bus: this.sfxGain,
          category: "sfx",
        });
      });
    }

    _kick(time, volume, category = "music", pan = 0, startFrequency = 92) {
      this._tone({
        freq: startFrequency,
        endFreq: 34,
        time,
        duration: 0.14,
        type: "sine",
        volume,
        attack: 0.002,
        release: 0.11,
        pan,
        bus: category === "music" ? this.musicGain : this.sfxGain,
        category,
      });
    }

    _snare(time, volume, category = "music") {
      const bus = category === "music" ? this.musicGain : this.sfxGain;
      this._noise({
        time,
        duration: 0.1,
        volume,
        filterType: "bandpass",
        filterFreq: 1350,
        q: 0.7,
        bus,
        category,
      });
      this._tone({
        freq: 175,
        endFreq: 105,
        time,
        duration: 0.075,
        type: "triangle",
        volume: volume * 0.65,
        release: 0.05,
        bus,
        category,
      });
    }

    _hat(time, volume, category = "music") {
      this._noise({
        time,
        duration: 0.038,
        volume,
        filterType: "highpass",
        filterFreq: 4300,
        bus: category === "music" ? this.musicGain : this.sfxGain,
        category,
      });
    }

    _tone(config) {
      if (!this.ctx || !config.bus) return null;
      const now = this.ctx.currentTime;
      const time = Math.max(now, Number(config.time ?? now));
      const duration = clamp(Number(config.duration ?? 0.1), 0.012, 3);
      const end = time + duration;
      const attack = clamp(Number(config.attack ?? 0.004), 0.001, duration * 0.45);
      const release = clamp(Number(config.release ?? duration * 0.55), 0.004, duration * 0.94);
      const volume = clamp(Number(config.volume ?? 0.05), 0.0001, 0.45);

      const oscillator = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const nodes = [oscillator, gain];
      let lastNode = oscillator;

      oscillator.type = config.type || "square";
      oscillator.frequency.setValueAtTime(clamp(Number(config.freq ?? 220), 20, 14000), time);
      if (config.endFreq != null) {
        oscillator.frequency.exponentialRampToValueAtTime(clamp(Number(config.endFreq), 20, 14000), end);
      }
      if (config.detune != null) oscillator.detune.setValueAtTime(Number(config.detune), time);

      if (config.filterFreq) {
        const filter = this.ctx.createBiquadFilter();
        filter.type = config.filterType || "lowpass";
        filter.frequency.setValueAtTime(clamp(Number(config.filterFreq), 30, 18000), time);
        if (config.endFilterFreq) {
          filter.frequency.exponentialRampToValueAtTime(clamp(Number(config.endFilterFreq), 30, 18000), end);
        }
        filter.Q.value = Number(config.q ?? 0.7);
        lastNode.connect(filter);
        lastNode = filter;
        nodes.push(filter);
      }

      lastNode.connect(gain);
      lastNode = gain;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(volume, time + attack);
      const releaseStart = Math.max(time + attack, end - release);
      gain.gain.setValueAtTime(volume, releaseStart);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      if (this.ctx.createStereoPanner && config.pan) {
        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(clamp(Number(config.pan), -1, 1), time);
        lastNode.connect(panner);
        lastNode = panner;
        nodes.push(panner);
      }

      lastNode.connect(config.bus);
      this._trackVoice(oscillator, nodes, config.category || "sfx");
      oscillator.start(time);
      oscillator.stop(end + 0.025);
      return oscillator;
    }

    _noise(config) {
      if (!this.ctx || !config.bus) return null;
      const now = this.ctx.currentTime;
      const time = Math.max(now, Number(config.time ?? now));
      const duration = clamp(Number(config.duration ?? 0.08), 0.012, 1.8);
      const end = time + duration;
      const volume = clamp(Number(config.volume ?? 0.04), 0.0001, 0.4);
      const attack = clamp(Number(config.attack ?? 0.003), 0.001, duration * 0.4);
      const release = clamp(Number(config.release ?? duration * 0.8), 0.004, duration * 0.95);

      const source = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      const nodes = [source, filter, gain];
      source.buffer = this._getNoiseBuffer();
      source.playbackRate.setValueAtTime(clamp(Number(config.playbackRate ?? 1), 0.2, 3), time);

      filter.type = config.filterType || "bandpass";
      filter.frequency.setValueAtTime(clamp(Number(config.filterFreq ?? 1200), 30, 18000), time);
      filter.Q.value = Number(config.q ?? 0.8);
      if (config.endFilterFreq) {
        filter.frequency.exponentialRampToValueAtTime(clamp(Number(config.endFilterFreq), 30, 18000), end);
      }

      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(volume, time + attack);
      const releaseStart = Math.max(time + attack, end - release);
      gain.gain.setValueAtTime(volume, releaseStart);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      source.connect(filter);
      filter.connect(gain);
      let lastNode = gain;
      if (this.ctx.createStereoPanner && config.pan) {
        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(clamp(Number(config.pan), -1, 1), time);
        lastNode.connect(panner);
        lastNode = panner;
        nodes.push(panner);
      }
      lastNode.connect(config.bus);

      this._trackVoice(source, nodes, config.category || "sfx");
      const maxOffset = Math.max(0, source.buffer.duration - duration - 0.01);
      source.start(time, Math.random() * maxOffset, duration);
      source.stop(end + 0.02);
      return source;
    }

    _getNoiseBuffer() {
      if (this._noiseBuffer) return this._noiseBuffer;
      const frameCount = Math.ceil(this.ctx.sampleRate * 2);
      const buffer = this.ctx.createBuffer(1, frameCount, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < frameCount; i += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.15 + white * 0.85;
        data[i] = last;
      }
      this._noiseBuffer = buffer;
      return buffer;
    }

    _trackVoice(source, nodes, category) {
      const voice = { source, nodes, category };
      this._voices.add(voice);
      source.onended = () => {
        this._voices.delete(voice);
        for (const node of nodes) {
          try {
            node.disconnect();
          } catch (_error) {
            // Already disconnected.
          }
        }
      };
    }

    _stopVoices(category = null) {
      for (const voice of Array.from(this._voices)) {
        if (category && voice.category !== category) continue;
        try {
          voice.source.stop();
        } catch (_error) {
          // The source may already have ended.
        }
      }
    }

    async destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      if (this._musicTimer) {
        scope.clearInterval(this._musicTimer);
        this._musicTimer = null;
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", this._onVisibilityChange);
      }
      this._stopVoices();
      this._voices.clear();
      this._lastSfx.clear();
      this._noiseBuffer = null;

      const context = this.ctx;
      this.ctx = null;
      this._unlocked = false;
      if (context && context.state !== "closed") {
        try {
          await context.close();
        } catch (_error) {
          // Closing can fail during page teardown; all timers are already gone.
        }
      }
    }
  }

  AudioEngine.MODES = Object.freeze(Array.from(AUDIO_MODES));
  AudioEngine.BIOMES = Object.freeze(Array.from(BIOMES));
  AudioEngine.SFX = Object.freeze(Array.from(SFX_NAMES));
  scope.AudioEngine = AudioEngine;
})(typeof window !== "undefined" ? window : globalThis);
