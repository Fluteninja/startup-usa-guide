export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 1113;
export const WORLD_SCALE = 18;
export const WALK_SPEED = 360;
export const DEFAULT_ZOOM = 0.65;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 1.65;
export const ZOOM_STEP = 0.2;

export function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let state = hashString(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeMovement(x, y) {
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

export function clampZoom(value, minimum = MIN_ZOOM, maximum = MAX_ZOOM) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function clampCamera(position, viewport, world) {
  const maxX = Math.max(0, world.width - viewport.width);
  const maxY = Math.max(0, world.height - viewport.height);
  return {
    x: Math.max(0, Math.min(maxX, position.x - viewport.width / 2)),
    y: Math.max(0, Math.min(maxY, position.y - viewport.height / 2)),
  };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function estimateTraverseSeconds(points, scale = WORLD_SCALE, speed = WALK_SPEED) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1], points[index]);
  }
  return length * scale / speed;
}

/* Which watercolour sprites belong on which terrain. Ranges get rock, the
   Thar gets scrub, wetlands and the Ghats get trees. `other` covers land no
   Natural Earth region claims. */
export const DECOR_KITS = {
  mtn: ["rock-1", "rock-2", "rock-3", "tree-simple-c"],
  desert: ["shrub-2", "rock-3"],
  wet: ["tree-simple-a", "shrub-1"],
  plateau: ["tree-simple-b", "rock-1", "shrub-1"],
  plain: ["tree-simple-a", "shrub-1"],
  other: ["tree-simple-a", "tree-simple-b", "shrub-1", "rock-1"],
};

/**
 * Scatters decorative sprites across the land, deterministically.
 *
 * Rejection sampling over the map's bounding box: a candidate survives only
 * if it is on land, far enough from the sprites already placed, and clear of
 * every interactive target (`avoid` — incubator icons and state landmarks),
 * because decor must never sit under something the player needs to click.
 * `kindAt` maps a point to a terrain kind, which chooses the sprite kit.
 *
 * Returns the sprites sorted by y, so nearer ones paint over farther ones.
 */
export function placeDecor({
  count,
  width = MAP_WIDTH,
  height = MAP_HEIGHT,
  contains,
  kindAt = () => "other",
  avoid = [],
  kits = DECOR_KITS,
  spacing = 7,
  clearance = 14,
  seed = "walkable-decor",
}) {
  const random = seededRandom(seed);
  const placed = [];
  // Bounded work: rejection sampling over a mostly-water box can never be
  // allowed to spin, so the attempt budget is fixed rather than a while-true.
  const attempts = count * 40;

  for (let attempt = 0; attempt < attempts && placed.length < count; attempt += 1) {
    const point = { x: random() * width, y: random() * height };
    // Draw the kit roll every iteration so a rejected candidate cannot shift
    // the sequence for the ones that follow — that is what keeps this stable.
    const roll = random();
    const scale = 0.78 + random() * 0.5;
    if (!contains(point)) continue;
    if (avoid.some((other) => distance(point, other) < clearance)) continue;
    if (placed.some((other) => distance(point, other) < spacing)) continue;
    const kit = kits[kindAt(point)] || kits.other;
    placed.push({ ...point, sprite: kit[Math.floor(roll * kit.length)], scale });
  }

  return placed.sort((a, b) => a.y - b.y);
}

export function placeOrganizations({
  organizations,
  regionBounds,
  regionAnchors,
  contains,
  minimumDistance = 4,
}) {
  const placed = [];
  const byRegion = new Map();

  for (const organization of [...organizations].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const region = organization.region;
    const bounds = regionBounds[region];
    const anchor = regionAnchors[region];
    if (!bounds || !anchor) continue;

    const regionPlaced = byRegion.get(region) || [];
    const random = seededRandom(`${region}:${organization.slug}`);
    let point = null;
    let lastInside = null;

    for (let pass = 0; pass < 5 && !point; pass += 1) {
      const spacing = minimumDistance * (1 - pass * 0.2);
      for (let attempt = 0; attempt < 800; attempt += 1) {
        const candidate = {
          x: bounds.x + random() * bounds.width,
          y: bounds.y + random() * bounds.height,
        };
        if (!contains(region, candidate)) continue;
        lastInside = candidate;
        if (regionPlaced.every((other) => distance(candidate, other) >= spacing)) {
          point = candidate;
          break;
        }
      }
    }

    point ||= lastInside || anchor;
    regionPlaced.push(point);
    byRegion.set(region, regionPlaced);
    placed.push({ ...organization, x: point.x, y: point.y });
  }

  return placed;
}
