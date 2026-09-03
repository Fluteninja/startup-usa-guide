import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ZOOM,
  WALK_SPEED,
  WORLD_SCALE,
  clampCamera,
  clampZoom,
  estimateTraverseSeconds,
  normalizeMovement,
  placeDecor,
  placeOrganizations,
} from "../site/walkable-core.js";

test("incubator placement is deterministic, contained, and collision-spaced", () => {
  const organizations = Array.from({ length: 20 }, (_, index) => ({
    slug: `incubator-${index}`,
    region: "test-state",
  }));
  const options = {
    organizations,
    regionBounds: { "test-state": { x: 0, y: 0, width: 100, height: 100 } },
    regionAnchors: { "test-state": { x: 50, y: 50 } },
    contains: (_region, point) => point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100,
    minimumDistance: 4,
  };
  const first = placeOrganizations(options);
  const second = placeOrganizations(options);
  assert.deepEqual(first, second);
  assert.equal(first.length, organizations.length);
  for (let index = 0; index < first.length; index += 1) {
    assert.ok(options.contains("test-state", first[index]));
    for (let other = index + 1; other < first.length; other += 1) {
      assert.ok(Math.hypot(first[index].x - first[other].x, first[index].y - first[other].y) >= 4);
    }
  }
});

test("diagonal movement is normalized to axial speed", () => {
  const diagonal = normalizeMovement(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
  assert.deepEqual(normalizeMovement(0, -1), { x: 0, y: -1 });
});

test("camera centers and clamps at the world edges", () => {
  assert.deepEqual(clampCamera({ x: 500, y: 400 }, { width: 200, height: 100 }, { width: 1000, height: 800 }), { x: 400, y: 350 });
  assert.deepEqual(clampCamera({ x: 10, y: 20 }, { width: 200, height: 100 }, { width: 1000, height: 800 }), { x: 0, y: 0 });
  assert.deepEqual(clampCamera({ x: 990, y: 790 }, { width: 200, height: 100 }, { width: 1000, height: 800 }), { x: 800, y: 700 });
});

test("zoom stays inside the supported range", () => {
  assert.equal(DEFAULT_ZOOM, 0.65);
  assert.equal(clampZoom(0.2), 0.5);
  assert.equal(clampZoom(0.5), 0.5);
  assert.equal(clampZoom(1), 1);
  assert.equal(clampZoom(2), 1.65);
});

test("decor is deterministic, on land, spaced, and clear of interactive targets", () => {
  const options = {
    count: 60,
    width: 200,
    height: 200,
    // A land square with a water margin, so "outside" is reachable by the sampler.
    contains: (p) => p.x >= 20 && p.x <= 180 && p.y >= 20 && p.y <= 180,
    kindAt: (p) => (p.x < 100 ? "desert" : "mtn"),
    avoid: [{ x: 60, y: 60 }, { x: 140, y: 140 }],
    spacing: 6,
    clearance: 18,
  };
  const first = placeDecor(options);
  assert.deepEqual(first, placeDecor(options), "same inputs must give the same scatter");
  assert.ok(first.length > 0);

  for (let i = 0; i < first.length; i += 1) {
    const item = first[i];
    assert.ok(options.contains(item), "every sprite sits on land");
    for (const target of options.avoid) {
      assert.ok(Math.hypot(item.x - target.x, item.y - target.y) >= 18, "sprites keep clear of interactive targets");
    }
    for (let j = i + 1; j < first.length; j += 1) {
      assert.ok(Math.hypot(item.x - first[j].x, item.y - first[j].y) >= 6, "sprites keep apart");
    }
    // The terrain under a sprite chooses its kit — that is what makes the
    // scatter read as geography rather than noise.
    const kit = item.x < 100 ? ["shrub-2", "rock-3"] : ["rock-1", "rock-2", "rock-3", "tree-simple-c"];
    assert.ok(kit.includes(item.sprite), `${item.sprite} belongs to the terrain it stands on`);
  }

  assert.deepEqual([...first].sort((a, b) => a.y - b.y), first, "painted back to front");
  assert.notDeepEqual(placeDecor({ ...options, seed: "other" }), first, "the seed actually varies the scatter");
});

test("a representative north-to-south India route is fast to traverse", () => {
  const route = [
    { x: 241.4, y: 134 },
    { x: 311.8, y: 315.3 },
    { x: 354, y: 490.3 },
    { x: 380, y: 702.9 },
    { x: 353.5, y: 951.7 },
  ];
  const seconds = estimateTraverseSeconds(route, WORLD_SCALE, WALK_SPEED);
  assert.ok(seconds >= 40 && seconds <= 58, `expected 40–58 seconds, received ${seconds}`);
});
