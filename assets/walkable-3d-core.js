/* Pure, DOM-free math for the 3D walkable map. Everything here is
   deterministic and unit-tested in tests/walkable-3d-core.test.mjs; the
   scene code in walkable-3d.js only wires these results to three.js. */
import { hashString } from "./walkable-core.js";

/* Terrain kinds are indexed so a rasterized kind map fits in one byte per
   cell. Index 0 is "no relief region claims this cell". */
export const KIND_ORDER = ["other", "mtn", "plateau", "desert", "wet", "plain"];

/* Peak world-height for each relief kind, in world units (1 unit = 1 SVG map
   unit ≈ 3 km at this map's scale — the map is a stylised game world, not a
   DEM). The avatar stands ~7 units tall, so a 30-unit mountain range reads as
   a proper wall on the horizon while a 1.5-unit plain stays walk-around-able. */
export const KIND_HEIGHT = {
  other: 1.4,
  mtn: 30,
  plateau: 7,
  desert: 2.6,
  wet: 0.9,
  plain: 1.7,
};

/** Minimum height of dry land above sea level, before coast falloff. */
export const LAND_BASE = 0.9;
/** How far below sea level the sea floor sits. */
export const SEA_FLOOR = -4;

/**
 * Deterministic 2D value noise in [0, 1]. Lattice values come from a hash of
 * the integer cell and the seed string, interpolated with a smoothstep — the
 * classic recipe, kept dependency-free. Same seed, same field, every load.
 */
export function valueNoise2D(seed) {
  const base = hashString(seed);
  const lattice = (x, y) => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + base) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = fade(x - x0);
    const ty = fade(y - y0);
    const a = lattice(x0, y0);
    const b = lattice(x0 + 1, y0);
    const c = lattice(x0, y0 + 1);
    const d = lattice(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

/** Two-octave fractal wrapper over valueNoise2D, still in [0, 1]. */
export function fbmNoise2D(seed, frequency = 1) {
  const coarse = valueNoise2D(`${seed}:coarse`);
  const fine = valueNoise2D(`${seed}:fine`);
  return (x, y) =>
    (coarse(x * frequency, y * frequency) * 2 + fine(x * frequency * 3.1, y * frequency * 3.1)) / 3;
}

/** One 3×3 box-blur pass over a w×h grid, edges clamped. */
function blurPass(grid, width, height) {
  const out = new Float32Array(grid.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const sy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = Math.min(width - 1, Math.max(0, x + dx));
          sum += grid[sy * width + sx];
        }
      }
      out[y * width + x] = sum / 9;
    }
  }
  return out;
}

/** N box-blur passes. Returns a new grid; the input is never mutated. */
export function blurGrid(grid, width, height, passes = 1) {
  let current = Float32Array.from(grid);
  for (let pass = 0; pass < passes; pass += 1) current = blurPass(current, width, height);
  return current;
}

/**
 * Coastal falloff in [0, 1]: 0 in open sea, rising to 1 deep inland. Made by
 * blurring the binary land mask, so heights taper into the sea instead of
 * ending in a cliff at the shoreline.
 */
export function coastFalloff(land, width, height, passes = 3) {
  const blurred = blurGrid(land, width, height, passes);
  const out = new Float32Array(blurred.length);
  for (let index = 0; index < blurred.length; index += 1) {
    const t = Math.min(1, Math.max(0, blurred[index]));
    out[index] = t * t * (3 - 2 * t);
  }
  return out;
}

/**
 * Builds the terrain height grid from the rasterized land mask and relief
 * kind map. Land rises from LAND_BASE by the kind's KIND_HEIGHT, shaped by
 * seeded noise so ranges undulate instead of extruding; sea cells drop to
 * SEA_FLOOR. A final blur keeps every transition walkable.
 */
export function buildHeightField({
  width,
  height,
  land,
  kind,
  kindHeights = KIND_HEIGHT,
  seed = "walkable-3d-terrain",
  noiseFrequency = 0.055,
  smoothing = 2,
  coastPasses = 3,
  bumps = [],
}) {
  const noise = fbmNoise2D(seed, noiseFrequency);
  const falloff = coastFalloff(land, width, height, coastPasses);
  const raw = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!land[index]) {
        raw[index] = SEA_FLOOR * (1 - falloff[index] * 0.7);
        continue;
      }
      const peak = kindHeights[KIND_ORDER[kind[index]]] ?? kindHeights.other;
      const shaped = peak * (0.55 + 0.9 * noise(x, y));
      raw[index] = (LAND_BASE + shaped) * falloff[index];
    }
  }
  /* Guaranteed ground. Small islands or slivers far below the raster
     resolution would otherwise blur and taper straight into the sea. Each
     bump raises a small cosine dome to at least `height`, so every landmark
     stands on dry land no matter how small its geometry. */
  for (const bump of bumps) {
    const radius = Math.max(1, bump.radius);
    const minX = Math.max(0, Math.floor(bump.x - radius));
    const maxX = Math.min(width - 1, Math.ceil(bump.x + radius));
    const minY = Math.max(0, Math.floor(bump.y - radius));
    const maxY = Math.min(height - 1, Math.ceil(bump.y + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const t = Math.hypot(x - bump.x, y - bump.y) / radius;
        if (t > 1) continue;
        const dome = bump.height * (0.5 + 0.5 * Math.cos(t * Math.PI));
        const index = y * width + x;
        raw[index] = Math.max(raw[index], dome);
      }
    }
  }
  return blurGrid(raw, width, height, smoothing);
}

/**
 * Bilinear sample of a w×h grid at fractional grid coordinates, clamped to
 * the edges. Used for terrain height under any world point.
 */
export function sampleGrid(grid, width, height, x, y) {
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const top = grid[y0 * width + x0] * (1 - tx) + grid[y0 * width + x1] * tx;
  const bottom = grid[y1 * width + x0] * (1 - tx) + grid[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/* The zoom control keeps its 2D contract — 50% to 165%, default 65% — and
   maps onto the follow camera's distance from the avatar. More zoom, closer
   camera. The pitch eases from a low, horizon-hugging angle up close to a
   steeper, map-reading angle when pulled out. */
export const CAMERA_DISTANCE = { near: 26, far: 150 };
export const CAMERA_PITCH = { near: 0.34, far: 0.98 };

export function zoomToDistance(zoom, minZoom, maxZoom, range = CAMERA_DISTANCE) {
  const clamped = Math.min(maxZoom, Math.max(minZoom, zoom));
  const t = (1 / clamped - 1 / maxZoom) / (1 / minZoom - 1 / maxZoom);
  return range.near + (range.far - range.near) * t;
}

export function distanceToPitch(distanceValue, range = CAMERA_DISTANCE, pitch = CAMERA_PITCH) {
  const t = Math.min(1, Math.max(0,
    (distanceValue - range.near) / (range.far - range.near)));
  return pitch.near + (pitch.far - pitch.near) * t;
}

/**
 * Positions the follow camera on a spherical offset behind the avatar.
 * Azimuth 0 puts the camera due south of the avatar looking north, so the
 * compass D-pad matches the screen by default.
 */
export function cameraOffset(azimuth, pitchValue, distanceValue) {
  const horizontal = Math.cos(pitchValue) * distanceValue;
  return {
    x: Math.sin(azimuth) * horizontal,
    y: Math.sin(pitchValue) * distanceValue,
    z: Math.cos(azimuth) * horizontal,
  };
}

/** Frame-rate-independent exponential smoothing factor. */
export function damp(lambda, elapsed) {
  return 1 - Math.exp(-lambda * elapsed);
}

/** Shortest-arc lerp between two angles in radians. */
export function lerpAngle(from, to, t) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

/* The eight decor sprite names from the 2D kit map onto three instanced
   archetypes in 3D — the deterministic scatter stays byte-identical, only
   the renderer changes. */
export function decorArchetype(sprite) {
  if (sprite.startsWith("tree")) return "tree";
  if (sprite.startsWith("rock")) return "rock";
  return "shrub";
}
