import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_DISTANCE,
  CAMERA_PITCH,
  KIND_HEIGHT,
  KIND_ORDER,
  LAND_BASE,
  SEA_FLOOR,
  blurGrid,
  buildHeightField,
  cameraOffset,
  coastFalloff,
  damp,
  decorArchetype,
  distanceToPitch,
  fbmNoise2D,
  lerpAngle,
  sampleGrid,
  valueNoise2D,
  zoomToDistance,
} from "../site/walkable-3d-core.js";
import { MAX_ZOOM, MIN_ZOOM } from "../site/walkable-core.js";

test("value noise is deterministic, bounded, and seed-sensitive", () => {
  const first = valueNoise2D("terrain");
  const second = valueNoise2D("terrain");
  const other = valueNoise2D("different-seed");
  let diverged = false;
  for (let index = 0; index < 200; index += 1) {
    const x = index * 0.37;
    const y = index * 0.73;
    const value = first(x, y);
    assert.equal(value, second(x, y));
    assert.ok(value >= 0 && value <= 1);
    if (Math.abs(value - other(x, y)) > 1e-9) diverged = true;
  }
  assert.ok(diverged, "different seeds should produce different fields");
});

test("value noise interpolates continuously between lattice points", () => {
  const noise = valueNoise2D("continuity");
  // Steps of 0.01 across a couple of cells should never jump.
  let previous = noise(0, 0.5);
  for (let x = 0.01; x < 2; x += 0.01) {
    const value = noise(x, 0.5);
    assert.ok(Math.abs(value - previous) < 0.08, `jump at ${x}`);
    previous = value;
  }
});

test("fbm noise stays within [0, 1]", () => {
  const noise = fbmNoise2D("fbm", 0.05);
  for (let index = 0; index < 500; index += 1) {
    const value = noise(index * 1.3, index * 2.7);
    assert.ok(value >= 0 && value <= 1);
  }
});

test("blurGrid preserves a constant field and never mutates its input", () => {
  const width = 8;
  const height = 6;
  const grid = new Float32Array(width * height).fill(5);
  const copy = Float32Array.from(grid);
  const blurred = blurGrid(grid, width, height, 3);
  assert.deepEqual(Array.from(grid), Array.from(copy));
  for (const value of blurred) assert.ok(Math.abs(value - 5) < 1e-5);
});

test("coastFalloff is ~0 in open sea and ~1 deep inland", () => {
  const width = 21;
  const height = 21;
  const land = new Float32Array(width * height);
  // A square island in the middle of the grid.
  for (let y = 6; y < 15; y += 1)
    for (let x = 6; x < 15; x += 1) land[y * width + x] = 1;
  const falloff = coastFalloff(land, width, height, 2);
  assert.ok(falloff[0] < 0.01, "open sea should stay near zero");
  assert.ok(falloff[10 * width + 10] > 0.95, "island centre should stay near one");
  const coastal = falloff[10 * width + 6];
  assert.ok(coastal > 0.05 && coastal < 0.95, "the shoreline should taper");
});

test("height field raises land by kind and sinks the sea", () => {
  const width = 40;
  const height = 40;
  const land = new Float32Array(width * height);
  const kind = new Uint8Array(width * height);
  const mtnIndex = KIND_ORDER.indexOf("mtn");
  const plainIndex = KIND_ORDER.indexOf("plain");
  // Left half: mountains. Right half: plain. Sea frame all around.
  for (let y = 4; y < 36; y += 1) {
    for (let x = 4; x < 36; x += 1) {
      land[y * width + x] = 1;
      kind[y * width + x] = x < 20 ? mtnIndex : plainIndex;
    }
  }
  const first = buildHeightField({ width, height, land, kind });
  const second = buildHeightField({ width, height, land, kind });
  assert.deepEqual(Array.from(first), Array.from(second));

  const mountain = first[20 * width + 10];
  const plain = first[20 * width + 30];
  assert.ok(mountain > plain, "mountains should rise above plains");
  assert.ok(mountain > KIND_HEIGHT.plain + LAND_BASE);
  assert.ok(plain > 0, "interior plains should sit above sea level");
  assert.ok(first[0] < 0 && first[0] >= SEA_FLOOR, "open sea should sit below sea level");
});

test("bumps guarantee dry land even where the raster shows open sea", () => {
  const width = 30;
  const height = 30;
  const land = new Float32Array(width * height); // all sea — a sub-pixel island
  const kind = new Uint8Array(width * height);
  const without = buildHeightField({ width, height, land, kind });
  assert.ok(without[15 * width + 15] < 0, "pure sea should stay submerged");
  const withBump = buildHeightField({
    width, height, land, kind,
    bumps: [{ x: 15, y: 15, radius: 3, height: 2 }],
  });
  assert.ok(withBump[15 * width + 15] > 0.2, "a bump must surface above the sea");
  assert.ok(withBump[0] < 0, "far sea must stay sea");
});

test("sampleGrid interpolates bilinearly and clamps at the edges", () => {
  const width = 3;
  const height = 3;
  const grid = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(sampleGrid(grid, width, height, 1, 1), 4);
  assert.equal(sampleGrid(grid, width, height, 0.5, 0), 0.5);
  assert.equal(sampleGrid(grid, width, height, 0.5, 0.5), 2);
  assert.equal(sampleGrid(grid, width, height, -10, -10), 0);
  assert.equal(sampleGrid(grid, width, height, 10, 10), 8);
});

test("zoom maps monotonically onto camera distance within the rig's range", () => {
  const zooms = [MIN_ZOOM, 0.65, 1, 1.3, MAX_ZOOM];
  const distances = zooms.map((zoom) => zoomToDistance(zoom, MIN_ZOOM, MAX_ZOOM));
  for (let index = 1; index < distances.length; index += 1) {
    assert.ok(distances[index] < distances[index - 1], "more zoom must mean a closer camera");
  }
  assert.equal(distances[0], CAMERA_DISTANCE.far);
  assert.equal(distances.at(-1), CAMERA_DISTANCE.near);
  // Out-of-range zooms clamp instead of overshooting the rig.
  assert.equal(zoomToDistance(99, MIN_ZOOM, MAX_ZOOM), CAMERA_DISTANCE.near);
  assert.equal(zoomToDistance(0.01, MIN_ZOOM, MAX_ZOOM), CAMERA_DISTANCE.far);
});

test("camera pitch eases between its bounds as distance changes", () => {
  assert.equal(distanceToPitch(CAMERA_DISTANCE.near), CAMERA_PITCH.near);
  assert.equal(distanceToPitch(CAMERA_DISTANCE.far), CAMERA_PITCH.far);
  const middle = distanceToPitch((CAMERA_DISTANCE.near + CAMERA_DISTANCE.far) / 2);
  assert.ok(middle > CAMERA_PITCH.near && middle < CAMERA_PITCH.far);
});

test("cameraOffset puts azimuth zero due south at the requested distance", () => {
  const offset = cameraOffset(0, Math.PI / 4, 10);
  assert.ok(Math.abs(offset.x) < 1e-9);
  assert.ok(offset.y > 0 && offset.z > 0);
  assert.ok(Math.abs(Math.hypot(offset.x, offset.y, offset.z) - 10) < 1e-6);
});

test("damp approaches one with time and lerpAngle takes the short way round", () => {
  assert.ok(damp(4, 0.016) > 0 && damp(4, 0.016) < 1);
  assert.ok(damp(4, 10) > 0.999);
  const wrapped = lerpAngle(Math.PI * 0.9, -Math.PI * 0.9, 0.5);
  // Halfway between 162° and -162° the short way is ±180°, not 0°.
  assert.ok(Math.abs(Math.abs(wrapped) - Math.PI) < 1e-9);
});

test("every 2D decor sprite maps onto a 3D archetype", () => {
  const sprites = ["rock-1", "rock-2", "rock-3", "shrub-1", "shrub-2",
    "tree-simple-a", "tree-simple-b", "tree-simple-c"];
  for (const sprite of sprites) {
    assert.ok(["tree", "rock", "shrub"].includes(decorArchetype(sprite)));
  }
  assert.equal(decorArchetype("tree-simple-a"), "tree");
  assert.equal(decorArchetype("rock-2"), "rock");
  assert.equal(decorArchetype("shrub-1"), "shrub");
});
