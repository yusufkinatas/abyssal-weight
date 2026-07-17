/**
 * Deterministic 32-bit random number utilities.
 *
 * Gameplay code should own one SeededRng per run and avoid Math.random().
 * Cosmetic systems can fork a separate stream so particles never perturb drops,
 * encounters, or boss pattern selection.
 */

const UINT32_RANGE = 0x1_0000_0000;
const DEFAULT_NON_ZERO_SEED = 0x6d2b79f5;

function stableSeedString(value, seen = new WeakSet()) {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string") return value;
  if (type === "number") return Number.isFinite(value) ? String(value) : `number:${value}`;
  if (type === "bigint") return `${value}n`;
  if (type === "boolean" || type === "undefined") return String(value);
  if (type === "symbol" || type === "function") return String(value);

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => stableSeedString(item, seen)).join(",")}]`;
  } else {
    const keys = Object.keys(value).sort();
    result = `{${keys.map((key) => `${stableSeedString(key, seen)}:${stableSeedString(value[key], seen)}`).join(",")}}`;
  }

  seen.delete(value);
  return result;
}

/** Hash any practical seed value into an unsigned 32-bit integer. */
export function hashSeed(seed) {
  const text = stableSeedString(seed);
  let hash = 0x811c9dc5;

  // FNV-1a over UTF-16 code units, followed by an avalanche. This avoids any
  // dependency on TextEncoder and therefore behaves identically in browsers
  // and Node-based QA runs.
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash ^= code & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= code >>> 8;
    hash = Math.imul(hash, 0x01000193);
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) || DEFAULT_NON_ZERO_SEED;
}

export class SeededRng {
  constructor(seed = DEFAULT_NON_ZERO_SEED) {
    this.initialSeed = hashSeed(seed);
    this._state = this.initialSeed;
  }

  /** Return a deterministic floating-point value in [0, 1). */
  next() {
    // Mulberry32: small, fast, and stable because all operations are explicit
    // 32-bit integer operations.
    this._state = (this._state + 0x6d2b79f5) >>> 0;
    let value = this._state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  }

  /** Return a floating-point value in [min, max). */
  range(min = 0, max = 1) {
    let low = Number(min);
    let high = Number(max);
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      throw new TypeError("SeededRng.range expects finite bounds");
    }
    if (high < low) [low, high] = [high, low];
    if (high === low) return low;
    return low + this.next() * (high - low);
  }

  /** Return an integer between min and max, inclusive. */
  int(min, max) {
    let low = Math.ceil(Number(min));
    let high = Math.floor(Number(max));
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      throw new TypeError("SeededRng.int expects finite bounds");
    }
    if (high < low) [low, high] = [high, low];
    return low + Math.floor(this.next() * (high - low + 1));
  }

  /** Return true with the supplied probability, clamped to [0, 1]. */
  chance(probability = 0.5) {
    const value = Number(probability);
    if (!Number.isFinite(value)) return false;
    if (value <= 0) return false;
    if (value >= 1) return true;
    return this.next() < value;
  }

  /** Pick an element, or undefined for an empty/non-array collection. */
  pick(items) {
    if (!Array.isArray(items) || items.length === 0) return undefined;
    return items[this.int(0, items.length - 1)];
  }

  /**
   * Fisher-Yates shuffle. A copy is returned unless inPlace is true.
   */
  shuffle(items, inPlace = false) {
    if (!Array.isArray(items)) throw new TypeError("SeededRng.shuffle expects an array");
    const result = inPlace ? items : [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.int(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  /**
   * Select one original entry using non-negative weights.
   *
   * By default the method reads entry.weight. Pass a selector for other data
   * shapes. If every weight is zero or invalid, selection falls back to pick().
   */
  weighted(items, weightSelector = (entry) => entry?.weight ?? 1) {
    if (!Array.isArray(items) || items.length === 0) return undefined;
    if (typeof weightSelector !== "function") {
      throw new TypeError("SeededRng.weighted expects a weight selector function");
    }

    const weights = new Float64Array(items.length);
    let total = 0;
    for (let index = 0; index < items.length; index += 1) {
      const candidate = Number(weightSelector(items[index], index));
      const weight = Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
      weights[index] = weight;
      total += weight;
    }

    if (!(total > 0)) return this.pick(items);
    let roll = this.next() * total;
    for (let index = 0; index < items.length; index += 1) {
      roll -= weights[index];
      if (roll < 0) return items[index];
    }
    return items[items.length - 1];
  }

  /** Create an independent deterministic stream without advancing this one. */
  fork(label) {
    return new SeededRng(`${this.initialSeed}:${this._state}:${stableSeedString(label)}`);
  }

  /** Serializable current stream state for deterministic replays. */
  get state() {
    return this._state >>> 0;
  }

  /** Restore a previously captured unsigned 32-bit stream state. */
  restore(state) {
    const numeric = Number(state);
    if (!Number.isFinite(numeric)) throw new TypeError("SeededRng.restore expects a finite state");
    this._state = numeric >>> 0;
    return this;
  }

  reset() {
    this._state = this.initialSeed;
    return this;
  }
}

export function createRng(seed) {
  return new SeededRng(seed);
}

export default SeededRng;
