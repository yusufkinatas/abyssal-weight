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

  const SFX_NAMES = new Set([
    "ui",
    "attack",
    "hit",
    "enemyHit",
    "coin",
    "dodge",
    "block",
    "perfect",
    "parry",
    "stagger",
    "execute",
    "hurt",
    "death",
    "step",
    "basin",
    "balloon",
    "extract",
    "bossRoar",
  ]);

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

    setCombatIntensity(value) {
      const numeric = Number(value);
      const next = Number.isFinite(numeric) ? clamp(numeric, 0, 1) : 0;
      if (Math.abs(next - this.combatIntensity) < 0.015) return this.combatIntensity;
      this.combatIntensity = next;
      if (this.ctx && this.musicGain) {
        const now = this.ctx.currentTime;
        const lift = 0.88 + this.combatIntensity * 0.18;
        this.musicGain.gain.setTargetAtTime(this.musicVolume * lift, now, 0.15);
      }
      return this.combatIntensity;
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
        descent: 88,
        ascent: 108,
        boss: 128,
        death: 54,
        victory: 96,
      }[this.mode];
      const intensityBoost = {
        hub: 3,
        descent: 20,
        ascent: 24,
        boss: 18,
        death: 0,
        victory: 4,
      }[this.mode];
      return base + intensityBoost * this.combatIntensity;
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
      const root = 38;
      if (step % 2 === 0) {
        const bassLine = [0, 0, 1, 3, 0, 5, 3, 1];
        this._tone({
          freq: midiToHz(root + bassLine[step / 2]),
          time,
          duration: d * 1.65,
          type: "triangle",
          volume: 0.061,
          attack: 0.006,
          release: d * 0.75,
          filterFreq: 680,
          bus: this.musicGain,
          category: "music",
        });
      }
      if (step % 4 === 0) this._kick(time, 0.052, "music");
      if (step === 4 || step === 12) this._snare(time, 0.034, "music");

      const melodySteps = [1, 3, 6, 9, 11, 14];
      const melodyIndex = melodySteps.indexOf(step);
      if (melodyIndex !== -1) {
        const melody = [15, 13, 12, 17, 15, 13];
        this._tone({
          freq: midiToHz(root + melody[melodyIndex]),
          time,
          duration: d * 0.7,
          type: "square",
          volume: 0.027 + this.combatIntensity * 0.009,
          release: d * 0.35,
          filterFreq: 1750,
          bus: this.musicGain,
          category: "music",
        });
      }
      if (this.combatIntensity > 0.35 && step % 2 === 1) {
        this._hat(time, 0.012 + this.combatIntensity * 0.009, "music");
      }
    }

    _musicAscent(step, time, d) {
      const root = 37;
      const bass = [0, 0, 3, 1, 0, 5, 6, 3];
      if (step % 2 === 0) {
        this._tone({
          freq: midiToHz(root + bass[step / 2]),
          time,
          duration: d * 1.5,
          type: "sawtooth",
          volume: 0.044,
          attack: 0.005,
          release: d * 0.65,
          filterFreq: 570 + this.combatIntensity * 350,
          bus: this.musicGain,
          category: "music",
        });
      }

      if ([0, 3, 8, 11].includes(step)) this._kick(time, 0.061, "music");
      if (step === 4 || step === 12) this._snare(time, 0.038, "music");
      if (step % 2 === 1) this._hat(time, 0.014, "music");

      const arp = [12, 15, 19, 20, 19, 15, 13, 10];
      if (step % 2 === 0 || this.combatIntensity > 0.62) {
        const i = this.combatIntensity > 0.62 ? step % 8 : (step / 2) % 8;
        this._tone({
          freq: midiToHz(root + arp[i]),
          time,
          duration: d * 0.62,
          type: "square",
          volume: 0.024 + this.combatIntensity * 0.008,
          release: d * 0.28,
          filterFreq: 1900,
          bus: this.musicGain,
          category: "music",
        });
      }
    }

    _musicBoss(step, time, d) {
      const root = 36;
      const riff = [0, 0, 6, 5, 0, 8, 6, 3];
      if (step % 2 === 0) {
        const note = riff[step / 2];
        this._tone({
          freq: midiToHz(root + note),
          time,
          duration: d * 1.72,
          type: "sawtooth",
          volume: 0.056,
          attack: 0.004,
          release: d * 0.58,
          filterFreq: 620 + this.combatIntensity * 450,
          bus: this.musicGain,
          category: "music",
        });
        this._tone({
          freq: midiToHz(root + note + 12),
          time,
          duration: d * 0.7,
          type: "square",
          volume: 0.019,
          release: d * 0.3,
          filterFreq: 1300,
          bus: this.musicGain,
          category: "music",
        });
      }
      if (step % 4 === 0 || (this.combatIntensity > 0.7 && step % 4 === 2)) {
        this._kick(time, 0.073, "music");
      }
      if (step === 4 || step === 12) this._snare(time, 0.046, "music");
      if (step % 2 === 1) this._hat(time, 0.018 + this.combatIntensity * 0.007, "music");

      if (this.combatIntensity > 0.22) {
        const highRiff = [12, 15, 18, 15, 20, 18, 15, 11];
        this._tone({
          freq: midiToHz(root + highRiff[step % 8]),
          time,
          duration: d * 0.48,
          type: "square",
          volume: 0.019 + this.combatIntensity * 0.01,
          release: d * 0.2,
          filterFreq: 2200,
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

      const now = this.ctx.currentTime + 0.004;
      const volume = clamp(finiteOr(options.volume, 1), 0, 2);
      const pitch = clamp(finiteOr(options.pitch, 1), 0.45, 2.2);
      const pan = clamp(finiteOr(options.pan, 0), -1, 1);
      const heavy = Boolean(options.heavy);
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
        case "attack": {
          const length = heavy ? 0.21 : 0.125;
          tone({ freq: (heavy ? 180 : 280) * pitch, endFreq: (heavy ? 52 : 92) * pitch, time: now, duration: length, type: "sawtooth", volume: (heavy ? 0.14 : 0.105) * volume, release: length * 0.72, filterFreq: heavy ? 900 : 1500 });
          noise({ time: now, duration: length * 0.8, volume: 0.065 * volume, filterType: "bandpass", filterFreq: heavy ? 520 : 1050, endFilterFreq: 2400, q: 1.3 });
          break;
        }
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
          break;
        case "stagger":
          this._kick(now, 0.2 * volume, "sfx", pan, 92 * pitch);
          tone({ freq: 116 * pitch, endFreq: 43 * pitch, time: now, duration: 0.25, type: "square", volume: 0.105 * volume, release: 0.2, filterFreq: 620 });
          break;
        case "execute":
          noise({ time: now, duration: 0.24, volume: 0.13 * volume, filterType: "bandpass", filterFreq: 2100 * pitch, endFilterFreq: 360 * pitch, q: 0.7 });
          tone({ freq: 390 * pitch, endFreq: 48 * pitch, time: now, duration: 0.29, type: "sawtooth", volume: 0.16 * volume, release: 0.2, filterFreq: 1200 });
          this._kick(now + 0.09, 0.23 * volume, "sfx", pan, 105 * pitch);
          break;
        case "hurt":
          tone({ freq: 168 * pitch, endFreq: 59 * pitch, time: now, duration: 0.23, type: "sawtooth", volume: 0.125 * volume, release: 0.18, filterFreq: 830 });
          noise({ time: now, duration: 0.13, volume: 0.093 * volume, filterType: "bandpass", filterFreq: 390 * pitch, q: 0.9 });
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
          break;
      }
      return true;
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
  AudioEngine.SFX = Object.freeze(Array.from(SFX_NAMES));
  scope.AudioEngine = AudioEngine;
})(typeof window !== "undefined" ? window : globalThis);
