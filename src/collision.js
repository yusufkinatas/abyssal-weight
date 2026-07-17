/** Dependency-free 2D collision helpers for the logical game world. */

export const EPSILON = 1e-8;
export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function dist(a, b) {
  return Math.sqrt(distSq(a, b));
}

export function angleBetween(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function normalizeAngle(angle) {
  let value = angle % TAU;
  if (value <= -Math.PI) value += TAU;
  if (value > Math.PI) value -= TAU;
  return value;
}

export function angleDiff(a, b) {
  return normalizeAngle(a - b);
}

export function normalizeVector(x, y, fallbackX = 0, fallbackY = 0) {
  const length = Math.hypot(x, y);
  if (length <= EPSILON) {
    const fallbackLength = Math.hypot(fallbackX, fallbackY);
    if (fallbackLength <= EPSILON) return { x: 0, y: 0, length: 0 };
    return { x: fallbackX / fallbackLength, y: fallbackY / fallbackLength, length: 0 };
  }
  return { x: x / length, y: y / length, length };
}

export function normalizeRect(rect) {
  let x = Number(rect?.x) || 0;
  let y = Number(rect?.y) || 0;
  let w = Number(rect?.w ?? rect?.width) || 0;
  let h = Number(rect?.h ?? rect?.height) || 0;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x, y, w, h };
}

export function expandRect(rect, amount = 0) {
  const source = normalizeRect(rect);
  const padding = Math.max(0, Number(amount) || 0);
  return {
    x: source.x - padding,
    y: source.y - padding,
    w: source.w + padding * 2,
    h: source.h + padding * 2,
  };
}

export function pointInAABB(point, rect, padding = 0) {
  const box = expandRect(rect, padding);
  return point.x >= box.x && point.x <= box.x + box.w
    && point.y >= box.y && point.y <= box.y + box.h;
}

export function circleIntersectsAABB(circle, rect) {
  const box = normalizeRect(rect);
  const radius = Math.max(0, Number(circle?.r ?? circle?.radius) || 0);
  const nearestX = clamp(circle.x, box.x, box.x + box.w);
  const nearestY = clamp(circle.y, box.y, box.y + box.h);
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return dx * dx + dy * dy <= radius * radius + EPSILON;
}

export function circlesIntersect(a, b, padding = 0) {
  const radius = Math.max(0, Number(a?.r ?? a?.radius) || 0)
    + Math.max(0, Number(b?.r ?? b?.radius) || 0)
    + Math.max(0, Number(padding) || 0);
  return distSq(a, b) <= radius * radius + EPSILON;
}

/**
 * Return the minimum translation that separates a circle from an AABB.
 * The normal always points away from the box. A null return means no overlap.
 */
export function circleAABBPenetration(circle, rect) {
  const box = normalizeRect(rect);
  const radius = Math.max(0, Number(circle?.r ?? circle?.radius) || 0);
  const left = box.x;
  const right = box.x + box.w;
  const top = box.y;
  const bottom = box.y + box.h;
  const inside = circle.x >= left && circle.x <= right
    && circle.y >= top && circle.y <= bottom;

  if (inside) {
    const faces = [
      { distance: circle.x - left, normalX: -1, normalY: 0 },
      { distance: right - circle.x, normalX: 1, normalY: 0 },
      { distance: circle.y - top, normalX: 0, normalY: -1 },
      { distance: bottom - circle.y, normalX: 0, normalY: 1 },
    ];
    faces.sort((a, b) => a.distance - b.distance);
    return { ...faces[0], depth: radius + faces[0].distance };
  }

  const nearestX = clamp(circle.x, left, right);
  const nearestY = clamp(circle.y, top, bottom);
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= radius * radius - EPSILON) return null;

  const distance = Math.sqrt(distanceSquared);
  if (distance <= EPSILON) return null;
  return {
    normalX: dx / distance,
    normalY: dy / distance,
    depth: radius - distance,
    distance,
  };
}

/** Return a separated copy of the circle and collision information. */
export function resolveCircleAABB(circle, rect) {
  const hit = circleAABBPenetration(circle, rect);
  const radius = Math.max(0, Number(circle?.r ?? circle?.radius) || 0);
  if (!hit || hit.depth <= EPSILON) {
    return { x: circle.x, y: circle.y, r: radius, collided: false, normalX: 0, normalY: 0, depth: 0 };
  }
  return {
    x: circle.x + hit.normalX * hit.depth,
    y: circle.y + hit.normalY * hit.depth,
    r: radius,
    collided: true,
    normalX: hit.normalX,
    normalY: hit.normalY,
    depth: hit.depth,
  };
}

function clampCircleToBounds(position, radius, bounds) {
  if (!bounds) return { ...position, collidedX: false, collidedY: false };
  const box = normalizeRect(bounds);
  const minX = box.x + radius;
  const maxX = box.x + box.w - radius;
  const minY = box.y + radius;
  const maxY = box.y + box.h - radius;
  const safeX = minX <= maxX ? clamp(position.x, minX, maxX) : box.x + box.w * 0.5;
  const safeY = minY <= maxY ? clamp(position.y, minY, maxY) : box.y + box.h * 0.5;
  return {
    x: safeX,
    y: safeY,
    collidedX: Math.abs(safeX - position.x) > EPSILON,
    collidedY: Math.abs(safeY - position.y) > EPSILON,
  };
}

/**
 * Move a circle through static AABBs using small steps and tangent sliding.
 * The input circle is not mutated. Returned slideX/slideY can be used to remove
 * velocity into the wall while retaining velocity along it.
 */
export function moveCircleWithSliding(
  circle,
  deltaX,
  deltaY,
  rectangles = [],
  bounds = null,
  options = {},
) {
  const radius = Math.max(0, Number(circle?.r ?? circle?.radius) || 0);
  const requestedX = Number(deltaX) || 0;
  const requestedY = Number(deltaY) || 0;
  const requestedDistance = Math.hypot(requestedX, requestedY);
  const maxStep = Math.max(1, Number(options.maxStep) || Math.max(2, radius * 0.45));
  const steps = Math.max(1, Math.ceil(requestedDistance / maxStep));
  const solverIterations = Math.max(1, Math.floor(Number(options.iterations) || 3));
  let stepX = requestedX / steps;
  let stepY = requestedY / steps;
  let x = Number(circle.x) || 0;
  let y = Number(circle.y) || 0;
  let collided = false;
  const normals = [];

  for (let step = 0; step < steps; step += 1) {
    x += stepX;
    y += stepY;

    const bounded = clampCircleToBounds({ x, y }, radius, bounds);
    if (bounded.collidedX) { stepX = 0; collided = true; }
    if (bounded.collidedY) { stepY = 0; collided = true; }
    x = bounded.x;
    y = bounded.y;

    for (let iteration = 0; iteration < solverIterations; iteration += 1) {
      let resolvedAny = false;
      for (const rectangle of rectangles) {
        const resolution = resolveCircleAABB({ x, y, r: radius }, rectangle);
        if (!resolution.collided) continue;
        resolvedAny = true;
        collided = true;
        x = resolution.x;
        y = resolution.y;
        normals.push({ x: resolution.normalX, y: resolution.normalY });

        // Remove only the component travelling into the surface. The tangent
        // component remains, producing stable wall sliding.
        const inward = stepX * resolution.normalX + stepY * resolution.normalY;
        if (inward < 0) {
          stepX -= inward * resolution.normalX;
          stepY -= inward * resolution.normalY;
        }
      }
      if (!resolvedAny) break;
    }
  }

  return {
    x,
    y,
    r: radius,
    collided,
    movedX: x - circle.x,
    movedY: y - circle.y,
    slideX: stepX * steps,
    slideY: stepY * steps,
    normals,
  };
}

/** Check whether a point is inside bounds and outside all inflated obstacles. */
export function isPointValid(
  point,
  bounds = null,
  rectangles = [],
  circles = [],
  padding = 0,
) {
  const margin = Math.max(0, Number(padding) || 0);
  if (bounds) {
    const box = normalizeRect(bounds);
    if (point.x < box.x + margin || point.x > box.x + box.w - margin
      || point.y < box.y + margin || point.y > box.y + box.h - margin) return false;
  }
  for (const rectangle of rectangles) {
    if (pointInAABB(point, rectangle, margin)) return false;
  }
  for (const circle of circles) {
    const radius = Math.max(0, Number(circle?.r ?? circle?.radius) || 0) + margin;
    if (distSq(point, circle) <= radius * radius + EPSILON) return false;
  }
  return true;
}

/** Check whether a circle is fully in bounds and clear of all obstacles. */
export function isCircleValid(circle, bounds = null, rectangles = [], circles = []) {
  const radius = Math.max(0, Number(circle?.r ?? circle?.radius) || 0);
  if (bounds) {
    const box = normalizeRect(bounds);
    if (circle.x - radius < box.x || circle.x + radius > box.x + box.w
      || circle.y - radius < box.y || circle.y + radius > box.y + box.h) return false;
  }
  for (const rectangle of rectangles) {
    if (circleIntersectsAABB({ ...circle, r: radius }, rectangle)) return false;
  }
  for (const obstacle of circles) {
    if (circlesIntersect({ ...circle, r: radius }, obstacle)) return false;
  }
  return true;
}

/**
 * Segment cast against an AABB expanded equally on all sides.
 * Returns the earliest hit in normalized segment time, or null.
 */
export function segmentVsExpandedAABB(start, end, rect, expansion = 0) {
  const box = expandRect(rect, expansion);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const inside = pointInAABB(start, box);
  if (inside) {
    const normal = normalizeVector(-dx, -dy);
    return { t: 0, x: start.x, y: start.y, normalX: normal.x, normalY: normal.y };
  }

  let enter = 0;
  let exit = 1;
  let normalX = 0;
  let normalY = 0;

  const castAxis = (origin, delta, min, max, nearNormalX, nearNormalY) => {
    if (Math.abs(delta) <= EPSILON) return origin >= min && origin <= max;
    let near = (min - origin) / delta;
    let far = (max - origin) / delta;
    let axisNormalX = nearNormalX;
    let axisNormalY = nearNormalY;
    if (near > far) {
      [near, far] = [far, near];
      axisNormalX = -axisNormalX;
      axisNormalY = -axisNormalY;
    }
    if (near > enter) {
      enter = near;
      normalX = axisNormalX;
      normalY = axisNormalY;
    }
    exit = Math.min(exit, far);
    return enter <= exit;
  };

  if (!castAxis(start.x, dx, box.x, box.x + box.w, -1, 0)) return null;
  if (!castAxis(start.y, dy, box.y, box.y + box.h, 0, -1)) return null;
  if (enter < -EPSILON || enter > 1 + EPSILON || exit < 0) return null;

  const t = clamp(enter, 0, 1);
  return {
    t,
    x: start.x + dx * t,
    y: start.y + dy * t,
    normalX,
    normalY,
  };
}

export function segmentVsCircle(start, end, circle, expansion = 0) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const radius = Math.max(0, Number(circle?.r ?? circle?.radius) || 0)
    + Math.max(0, Number(expansion) || 0);
  const fx = start.x - circle.x;
  const fy = start.y - circle.y;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - radius * radius;

  if (c <= 0) {
    const normal = normalizeVector(fx, fy, -Math.sign(dx), -Math.sign(dy));
    return { t: 0, x: start.x, y: start.y, normalX: normal.x, normalY: normal.y };
  }
  if (a <= EPSILON) return null;

  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const t = (-b - root) / (2 * a);
  if (t < 0 || t > 1) return null;
  const x = start.x + dx * t;
  const y = start.y + dy * t;
  const normal = normalizeVector(x - circle.x, y - circle.y);
  return { t, x, y, normalX: normal.x, normalY: normal.y };
}

/** Return true when no inflated obstacle blocks the segment. */
export function hasLineOfSight(
  start,
  end,
  rectangles = [],
  circles = [],
  clearance = 0,
) {
  for (const rectangle of rectangles) {
    if (segmentVsExpandedAABB(start, end, rectangle, clearance)) return false;
  }
  for (const circle of circles) {
    if (segmentVsCircle(start, end, circle, clearance)) return false;
  }
  return true;
}

/** Swept moving circle against a stationary target circle. */
export function sweptCircleHit(start, end, movingRadius, targetCircle) {
  return segmentVsCircle(start, end, targetCircle, movingRadius);
}

/**
 * Swept projectile helper accepting either a circle target ({x,y,r}) or an
 * AABB target ({x,y,w,h}). The earliest normalized-time hit is returned.
 */
export function sweptProjectileHit(start, end, projectileRadius, target) {
  if (target && (Number.isFinite(target.w) || Number.isFinite(target.width))) {
    return segmentVsExpandedAABB(start, end, target, projectileRadius);
  }
  return sweptCircleHit(start, end, projectileRadius, target);
}
