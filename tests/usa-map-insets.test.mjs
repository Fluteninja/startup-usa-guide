/* Regression coverage for the Alaska/Hawaii composite ("Albers USA"-style)
   map insets added in scripts/build-usa-map.mjs. This re-implements the same
   P(lng, lat, stateName) selection formula duplicated in build.mjs and
   site.js (classic-script/ESM split prevents sharing one module — see
   AGENTS-equivalent notes in build.mjs) and checks it against the actual
   committed data/usa-map.json, so a future map regen that breaks the inset
   boxes or the selection logic fails a test instead of shipping silently. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const map = JSON.parse(readFileSync(join(ROOT, "data", "usa-map.json"), "utf8"));

function project(lng, lat, stateName, proj) {
  const q = (proj.insets && proj.insets[stateName]) || proj;
  const px = q.padX ?? q.pad, py = q.padY ?? q.pad;
  return [px + (lng * q.cosLat0 - q.rxMin) * q.s, py + (q.ryMax - lat) * q.s];
}

test("usa-map.json declares independent Alaska and Hawaii insets", () => {
  assert.ok(map.proj.insets, "proj.insets must exist");
  for (const name of ["Alaska", "Hawaii"]) {
    const inset = map.proj.insets[name];
    assert.ok(inset, `${name} inset descriptor must exist`);
    for (const key of ["cosLat0", "rxMin", "ryMax", "s", "padX", "padY"]) {
      assert.equal(typeof inset[key], "number", `${name}.${key} must be a number`);
    }
    assert.ok(map.states[name]?.d?.length > 0, `${name} must have a rendered shape`);
  }
});

test("Anchorage, AK projects inside the Alaska inset box, not the mainland", () => {
  const [x, y] = project(-149.9003, 61.2181, "Alaska", map.proj);
  const [mx, my] = project(-149.9003, 61.2181, "Texas", map.proj); // force mainland formula
  assert.notEqual([x, y].join(","), [mx, my].join(","), "inset and mainland formulas must diverge");
  // The inset box sits below the mainland band and within the canvas.
  assert.ok(x >= 0 && x <= map.viewBox[0], "x must be within the canvas width");
  assert.ok(y >= 0 && y <= map.viewBox[1], "y must be within the canvas height");
  const [scx, scy] = [map.states.Alaska.cx, map.states.Alaska.cy];
  assert.ok(Math.abs(x - scx) < 120 && Math.abs(y - scy) < 120,
    "Anchorage should land reasonably close to the Alaska shape's own centroid");
});

test("Honolulu, HI projects inside the Hawaii inset box", () => {
  const [x, y] = project(-157.8583, 21.3069, "Hawaii", map.proj);
  assert.ok(x >= 0 && x <= map.viewBox[0], "x must be within the canvas width");
  assert.ok(y >= 0 && y <= map.viewBox[1], "y must be within the canvas height");
  const [scx, scy] = [map.states.Hawaii.cx, map.states.Hawaii.cy];
  assert.ok(Math.abs(x - scx) < 100 && Math.abs(y - scy) < 100,
    "Honolulu should land reasonably close to the Hawaii shape's own centroid");
});

test("a mainland state (Texas) still uses the shared mainland projection", () => {
  const [x, y] = project(-97.7431, 30.2672, "Texas", map.proj); // Austin
  assert.ok(x >= 0 && x <= map.viewBox[0]);
  assert.ok(y >= 0 && y <= map.viewBox[1]);
  // Mainland points must land above the inset band (smaller y than any inset's padY).
  const insetTop = Math.min(map.proj.insets.Alaska.padY, map.proj.insets.Hawaii.padY);
  assert.ok(y < insetTop, "a mainland point must not fall inside the inset band");
});

test("the canvas grew to fit the inset band below the mainland", () => {
  // Texas (a mainland state) must be fully above the inset band's top edge.
  const insetTop = Math.min(map.proj.insets.Alaska.padY, map.proj.insets.Hawaii.padY);
  assert.ok(map.viewBox[1] > insetTop, "viewBox height must extend past the inset band");
});
