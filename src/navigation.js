/**
 * Shared grid navigation for the 320x180 logical arena.
 *
 * A NavGrid represents one agent-clearance class. Static room obstacles are
 * inflated during rebuild, then a reverse Dijkstra flow field is shared by all
 * agents pursuing the same target. This is cheaper and more stable than one A*
 * search per enemy, while still routing cleanly around authored obstacles.
 */

import {
  clamp,
  dist,
  distSq,
  expandRect,
  hasLineOfSight as collisionLineOfSight,
  isPointValid,
  normalizeRect,
  normalizeVector,
} from "./collision.js?v=20260718-6";

const ORTHOGONAL_COST = 10;
const DIAGONAL_COST = 14;
const NEIGHBORS = [
  { dc: 1, dr: 0, cost: ORTHOGONAL_COST },
  { dc: -1, dr: 0, cost: ORTHOGONAL_COST },
  { dc: 0, dr: 1, cost: ORTHOGONAL_COST },
  { dc: 0, dr: -1, cost: ORTHOGONAL_COST },
  { dc: 1, dr: 1, cost: DIAGONAL_COST },
  { dc: 1, dr: -1, cost: DIAGONAL_COST },
  { dc: -1, dr: 1, cost: DIAGONAL_COST },
  { dc: -1, dr: -1, cost: DIAGONAL_COST },
];

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() { return this.items.length; }

  push(index, priority) {
    const item = { index, priority };
    const items = this.items;
    items.push(item);
    let cursor = items.length - 1;
    while (cursor > 0) {
      const parent = Math.floor((cursor - 1) / 2);
      if (items[parent].priority <= priority) break;
      items[cursor] = items[parent];
      cursor = parent;
    }
    items[cursor] = item;
  }

  pop() {
    const items = this.items;
    if (items.length === 0) return null;
    const root = items[0];
    const tail = items.pop();
    if (items.length === 0) return root;

    let cursor = 0;
    while (true) {
      const left = cursor * 2 + 1;
      const right = left + 1;
      if (left >= items.length) break;
      let child = left;
      if (right < items.length && items[right].priority < items[left].priority) child = right;
      if (items[child].priority >= tail.priority) break;
      items[cursor] = items[child];
      cursor = child;
    }
    items[cursor] = tail;
    return root;
  }
}

function toCircle(obstacle) {
  return {
    x: Number(obstacle?.x) || 0,
    y: Number(obstacle?.y) || 0,
    r: Math.max(0, Number(obstacle?.r ?? obstacle?.radius) || 0),
  };
}

function splitObstacles(source) {
  const rectangles = [];
  const circles = [];
  const append = (obstacle) => {
    if (!obstacle) return;
    if (Number.isFinite(obstacle.r) || Number.isFinite(obstacle.radius)) circles.push(toCircle(obstacle));
    else if (Number.isFinite(obstacle.w) || Number.isFinite(obstacle.width)) rectangles.push(normalizeRect(obstacle));
  };

  if (Array.isArray(source)) source.forEach(append);
  else if (source) {
    (source.rectangles || source.rects || []).forEach(append);
    (source.circles || []).forEach(append);
    (source.obstacles || []).forEach(append);
  }
  return { rectangles, circles };
}

export class NavGrid {
  /**
   * @param {object} options
   * @param {{x:number,y:number,w:number,h:number}} [options.bounds]
   * @param {number} [options.width=320]
   * @param {number} [options.height=180]
   * @param {number} [options.cellSize=10] requested approximate cell size
   * @param {number} [options.clearance=0] agent radius plus safety margin
   * @param {Array|object} [options.obstacles]
   */
  constructor(options = {}) {
    const bounds = options.bounds || {
      x: Number(options.x) || 0,
      y: Number(options.y) || 0,
      w: Number(options.width) || 320,
      h: Number(options.height) || 180,
    };
    this.bounds = normalizeRect(bounds);
    this.requestedCellSize = clamp(Number(options.cellSize) || 10, 4, 64);
    this.cols = Math.max(1, Math.ceil(this.bounds.w / this.requestedCellSize));
    this.rows = Math.max(1, Math.ceil(this.bounds.h / this.requestedCellSize));
    this.cellWidth = this.bounds.w / this.cols;
    this.cellHeight = this.bounds.h / this.rows;
    this.count = this.cols * this.rows;
    this.clearance = Math.max(0, Number(options.clearance) || 0);
    this.walkable = new Uint8Array(this.count);
    this.rectangles = [];
    this.circles = [];
    this.inflatedRectangles = [];
    this.inflatedCircles = [];
    this.navigationBounds = { ...this.bounds };
    this.flow = null;
    this.revision = 0;
    this.setObstacles(options.obstacles || {
      rectangles: options.rectangles || options.rects || [],
      circles: options.circles || [],
    });
  }

  /** Replace obstacle geometry and rebuild walkability. */
  setObstacles(source = []) {
    const parsed = splitObstacles(source);
    this.rectangles = parsed.rectangles;
    this.circles = parsed.circles;
    return this.rebuild();
  }

  /** Change the agent radius/clearance represented by this grid. */
  setClearance(clearance) {
    const next = Math.max(0, Number(clearance) || 0);
    if (next === this.clearance) return this;
    this.clearance = next;
    return this.rebuild();
  }

  /** Recompute obstacle inflation and cell walkability. */
  rebuild() {
    const margin = this.clearance;
    this.navigationBounds = {
      x: this.bounds.x + margin,
      y: this.bounds.y + margin,
      w: Math.max(0, this.bounds.w - margin * 2),
      h: Math.max(0, this.bounds.h - margin * 2),
    };
    this.inflatedRectangles = this.rectangles.map((rectangle) => expandRect(rectangle, margin));
    this.inflatedCircles = this.circles.map((circle) => ({
      x: circle.x,
      y: circle.y,
      r: circle.r + margin,
    }));

    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const index = this.index(col, row);
        const point = this.cellCenter(col, row);
        this.walkable[index] = this._pointValid(point) ? 1 : 0;
      }
    }

    this.revision += 1;
    this.flow = null;
    return this;
  }

  _pointValid(point) {
    if (this.navigationBounds.w <= 0 || this.navigationBounds.h <= 0) return false;
    return isPointValid(
      point,
      this.navigationBounds,
      this.inflatedRectangles,
      this.inflatedCircles,
    );
  }

  index(col, row) {
    return row * this.cols + col;
  }

  coordinates(index) {
    return { col: index % this.cols, row: Math.floor(index / this.cols) };
  }

  inGrid(col, row) {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  isWalkableCell(col, row) {
    return this.inGrid(col, row) && this.walkable[this.index(col, row)] === 1;
  }

  cellCenter(col, row) {
    return {
      x: this.bounds.x + (col + 0.5) * this.cellWidth,
      y: this.bounds.y + (row + 0.5) * this.cellHeight,
    };
  }

  worldToCell(point, clampToGrid = true) {
    let col = Math.floor((point.x - this.bounds.x) / this.cellWidth);
    let row = Math.floor((point.y - this.bounds.y) / this.cellHeight);
    const inside = this.inGrid(col, row);
    if (clampToGrid) {
      col = clamp(col, 0, this.cols - 1);
      row = clamp(row, 0, this.rows - 1);
    }
    return {
      col,
      row,
      index: this.inGrid(col, row) ? this.index(col, row) : -1,
      inside,
    };
  }

  /** Find the Euclidean-nearest walkable cell center. */
  nearestWalkable(point, maxDistance = Infinity) {
    let best = null;
    let bestDistanceSquared = Number.isFinite(maxDistance) ? maxDistance * maxDistance : Infinity;
    for (let index = 0; index < this.count; index += 1) {
      if (!this.walkable[index]) continue;
      const { col, row } = this.coordinates(index);
      const center = this.cellCenter(col, row);
      const candidateDistance = distSq(point, center);
      if (candidateDistance >= bestDistanceSquared) continue;
      bestDistanceSquared = candidateDistance;
      best = {
        ...center,
        col,
        row,
        index,
        distance: Math.sqrt(candidateDistance),
      };
    }
    return best;
  }

  /**
   * Keep a valid point unchanged, otherwise project to the closest walkable
   * cell. No geometry is mutated and null means the grid has no valid cell.
   */
  projectToWalkable(point, maxDistance = Infinity) {
    const cell = this.worldToCell(point, false);
    if (cell.inside && this.walkable[cell.index] && this._pointValid(point)) {
      return { x: point.x, y: point.y, ...cell, projected: false, distance: 0 };
    }
    const nearest = this.nearestWalkable(point, maxDistance);
    return nearest ? { ...nearest, projected: true } : null;
  }

  _canTraverse(col, row, dc, dr) {
    const nextCol = col + dc;
    const nextRow = row + dr;
    if (!this.isWalkableCell(nextCol, nextRow)) return false;
    if (dc !== 0 && dr !== 0) {
      // Both adjacent orthogonal cells must be open, otherwise the agent would
      // cut through an inflated obstacle corner.
      if (!this.isWalkableCell(col + dc, row) || !this.isWalkableCell(col, row + dr)) return false;
    }
    return true;
  }

  /**
   * Build and store a reverse Dijkstra field toward target. Repeated calls with
   * a target in the same cell reuse the existing field until rebuild().
   */
  buildFlowField(target) {
    const projectedTarget = this.projectToWalkable(target);
    if (!projectedTarget) {
      this.flow = {
        revision: this.revision,
        target: null,
        targetIndex: -1,
        costs: new Float64Array(this.count).fill(Infinity),
        next: new Int32Array(this.count).fill(-1),
      };
      return this.flow;
    }
    if (this.flow && this.flow.revision === this.revision
      && this.flow.targetIndex === projectedTarget.index) return this.flow;

    const costs = new Float64Array(this.count);
    costs.fill(Infinity);
    const next = new Int32Array(this.count);
    next.fill(-1);
    const open = new MinHeap();
    costs[projectedTarget.index] = 0;
    open.push(projectedTarget.index, 0);

    while (open.size > 0) {
      const current = open.pop();
      if (!current || current.priority !== costs[current.index]) continue;
      const { col, row } = this.coordinates(current.index);

      for (const neighbor of NEIGHBORS) {
        if (!this._canTraverse(col, row, neighbor.dc, neighbor.dr)) continue;
        const neighborIndex = this.index(col + neighbor.dc, row + neighbor.dr);
        const candidate = current.priority + neighbor.cost;
        if (candidate >= costs[neighborIndex]) continue;
        costs[neighborIndex] = candidate;
        // From this neighbor, the best next step is the cell we just expanded.
        next[neighborIndex] = current.index;
        open.push(neighborIndex, candidate);
      }
    }

    this.flow = {
      revision: this.revision,
      target: { x: projectedTarget.x, y: projectedTarget.y },
      targetIndex: projectedTarget.index,
      costs,
      next,
    };
    return this.flow;
  }

  /** Return the normalized flow direction and cost at a world position. */
  directionAt(point, target = null) {
    const flow = target ? this.buildFlowField(target) : this.flow;
    if (!flow || flow.targetIndex < 0) return { x: 0, y: 0, reachable: false, reached: false, cost: Infinity };
    const cell = this.worldToCell(point, false);
    if (!cell.inside || !this.walkable[cell.index] || !Number.isFinite(flow.costs[cell.index])) {
      return { x: 0, y: 0, reachable: false, reached: false, cost: Infinity };
    }
    if (cell.index === flow.targetIndex) {
      const direct = normalizeVector(flow.target.x - point.x, flow.target.y - point.y);
      return { x: direct.x, y: direct.y, reachable: true, reached: direct.length < 1, cost: 0 };
    }

    const nextIndex = flow.next[cell.index];
    if (nextIndex < 0) return { x: 0, y: 0, reachable: false, reached: false, cost: Infinity };
    const nextCell = this.coordinates(nextIndex);
    const waypoint = this.cellCenter(nextCell.col, nextCell.row);
    const direction = normalizeVector(waypoint.x - point.x, waypoint.y - point.y);
    return {
      x: direction.x,
      y: direction.y,
      reachable: true,
      reached: false,
      cost: flow.costs[cell.index],
      waypoint,
      nextIndex,
    };
  }

  costAt(point) {
    if (!this.flow) return Infinity;
    const cell = this.worldToCell(point, false);
    return cell.inside ? this.flow.costs[cell.index] : Infinity;
  }

  hasLineOfSight(start, end, extraClearance = 0) {
    return collisionLineOfSight(
      start,
      end,
      this.inflatedRectangles,
      this.inflatedCircles,
      Math.max(0, Number(extraClearance) || 0),
    );
  }

  isReachable(from, to) {
    const target = this.projectToWalkable(to);
    const source = this.worldToCell(from, false);
    if (!target || !source.inside || !this.walkable[source.index]) return false;
    const flow = this.buildFlowField(target);
    return Number.isFinite(flow.costs[source.index]);
  }

  /** Validate authored points against one connected navigation component. */
  validateReachability(origin, points = []) {
    const authoredOrigin = this.worldToCell(origin, false);
    const originValid = authoredOrigin.inside
      && this.walkable[authoredOrigin.index]
      && this._pointValid(origin);
    if (!originValid) {
      return { valid: false, originValid: false, reachableCount: 0, total: points.length, unreachable: [...points] };
    }
    const flow = this.buildFlowField(origin);
    const unreachable = [];
    let reachableCount = 0;
    points.forEach((point, pointIndex) => {
      const cell = this.worldToCell(point, false);
      const reachable = cell.inside && this.walkable[cell.index] && Number.isFinite(flow.costs[cell.index]);
      if (reachable) reachableCount += 1;
      else unreachable.push({ point, pointIndex });
    });
    return {
      valid: unreachable.length === 0,
      originValid: true,
      reachableCount,
      total: points.length,
      unreachable,
    };
  }

  /** Validate that every walkable cell belongs to one connected component. */
  validateConnectivity() {
    let originIndex = -1;
    let walkableCount = 0;
    for (let index = 0; index < this.count; index += 1) {
      if (!this.walkable[index]) continue;
      walkableCount += 1;
      if (originIndex < 0) originIndex = index;
    }
    if (originIndex < 0) return { valid: false, walkableCount: 0, reachableCount: 0, disconnected: [] };

    const originCell = this.coordinates(originIndex);
    const flow = this.buildFlowField(this.cellCenter(originCell.col, originCell.row));
    const disconnected = [];
    let reachableCount = 0;
    for (let index = 0; index < this.count; index += 1) {
      if (!this.walkable[index]) continue;
      if (Number.isFinite(flow.costs[index])) reachableCount += 1;
      else {
        const cell = this.coordinates(index);
        disconnected.push({ index, ...cell, ...this.cellCenter(cell.col, cell.row) });
      }
    }
    return {
      valid: disconnected.length === 0,
      walkableCount,
      reachableCount,
      disconnected,
    };
  }
}

/**
 * Per-enemy progress monitor. It does not teleport agents; it reports when the
 * caller should invalidate a waypoint, re-project, or request a fresh route.
 */
export class NavAgentState {
  constructor(options = {}) {
    const position = options.position || { x: 0, y: 0 };
    this.anchor = { x: Number(position.x) || 0, y: Number(position.y) || 0 };
    this.minProgress = Math.max(0.1, Number(options.minProgress) || 3);
    this.stuckAfter = Math.max(0.1, Number(options.stuckAfter) || 0.55);
    this.minWantedSpeed = Math.max(0, Number(options.minWantedSpeed) || 8);
    this.recoveryCooldownDuration = Math.max(0, Number(options.recoveryCooldown) || 0.35);
    this.progressTimer = 0;
    this.recoveryCooldown = 0;
    this.elapsed = 0;
    this.totalWantedTime = 0;
    this.totalStuckTime = 0;
    this.stuckEvents = 0;
    this.lastStuckAt = -Infinity;
    this.lastProgress = 0;
  }

  update(position, wantedSpeed, dt) {
    const step = Math.max(0, Number(dt) || 0);
    this.elapsed += step;
    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - step);

    if (!(wantedSpeed >= this.minWantedSpeed)) {
      this.anchor.x = position.x;
      this.anchor.y = position.y;
      this.progressTimer = 0;
      this.lastProgress = 0;
      return { stuck: false, progress: 0, progressTimer: 0 };
    }

    this.totalWantedTime += step;
    const progress = dist(position, this.anchor);
    this.lastProgress = progress;
    if (progress >= this.minProgress) {
      this.anchor.x = position.x;
      this.anchor.y = position.y;
      this.progressTimer = 0;
      return { stuck: false, progress, progressTimer: 0 };
    }

    this.progressTimer += step;
    this.totalStuckTime += step;
    if (this.progressTimer < this.stuckAfter || this.recoveryCooldown > 0) {
      return { stuck: false, progress, progressTimer: this.progressTimer };
    }

    this.stuckEvents += 1;
    this.lastStuckAt = this.elapsed;
    this.progressTimer = 0;
    this.recoveryCooldown = this.recoveryCooldownDuration;
    this.anchor.x = position.x;
    this.anchor.y = position.y;
    return {
      stuck: true,
      progress,
      event: this.stuckEvents,
      elapsed: this.elapsed,
    };
  }

  markRecovered(position) {
    this.anchor.x = position.x;
    this.anchor.y = position.y;
    this.progressTimer = 0;
    this.lastProgress = 0;
    return this;
  }

  telemetry() {
    return {
      stuckEvents: this.stuckEvents,
      totalWantedTime: this.totalWantedTime,
      totalStuckTime: this.totalStuckTime,
      lastStuckAt: this.lastStuckAt,
      lastProgress: this.lastProgress,
    };
  }
}

export function updateStuckTelemetry(agentState, position, wantedSpeed, dt) {
  if (!(agentState instanceof NavAgentState)) {
    throw new TypeError("updateStuckTelemetry expects a NavAgentState");
  }
  return agentState.update(position, wantedSpeed, dt);
}

export default NavGrid;
