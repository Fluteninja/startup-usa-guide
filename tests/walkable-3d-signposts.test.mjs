/* Regression test for a real shipped bug: walkable-3d.js's `signs` and
   `transfers` arrays are hand-authored location data (wayfinder targets and
   inset-teleport destinations) baked directly into the module rather than
   read from data/*.json. When the India edition's walkable-3d.js was reused
   here, those arrays still referenced India state/territory names (e.g.
   "Jammu and Kashmir", "Lakshadweep") that don't exist in the USA map data,
   which crashed every wayfinder at runtime with
   "Cannot read properties of undefined (reading 'y')" — a class of bug no
   server-side render or data-only test could catch, since the arrays live
   only in client JS. This test statically extracts every state name
   referenced there and checks it against the real committed
   data/usa-map.json, so a future edit that reintroduces a bad name (or a
   map regen that renames/drops a state) fails a test instead of shipping. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, "site", "walkable-3d.js"), "utf8");
const map = JSON.parse(readFileSync(join(ROOT, "data", "usa-map.json"), "utf8"));
const validNames = new Set(Object.keys(map.states));

function extractBlock(varName) {
  const start = src.indexOf(`const ${varName} = [`);
  assert.ok(start !== -1, `expected to find "const ${varName} = [" in walkable-3d.js`);
  const end = src.indexOf("];", start);
  return src.slice(start, end);
}

test("every wayfinder sign target is a real state on the map", () => {
  const block = extractBlock("signs");
  const targetLists = [...block.matchAll(/targets:\s*\[([^\]]*)\]/g)].map((m) => m[1]);
  assert.ok(targetLists.length > 0, "expected at least one sign with targets");
  const names = targetLists.flatMap((list) => [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  assert.ok(names.length > 0, "expected at least one target name");
  for (const name of names) {
    assert.ok(validNames.has(name), `sign target "${name}" is not a key in data/usa-map.json states`);
  }
});

test("every inset transfer destination is a real state on the map", () => {
  const block = extractBlock("transfers");
  const destinations = [...block.matchAll(/destination:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(destinations.length > 0, "expected at least one transfer destination");
  for (const name of destinations) {
    assert.ok(validNames.has(name), `transfer destination "${name}" is not a key in data/usa-map.json states`);
  }
});

test("Alaska and Hawaii are each reachable via at least one transfer", () => {
  const block = extractBlock("transfers");
  const destinations = [...block.matchAll(/destination:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(destinations.includes("Alaska"), "no transfer flies to Alaska");
  assert.ok(destinations.includes("Hawaii"), "no transfer flies to Hawaii");
});

test("the avatar's initial spawn state exists on the map", () => {
  // Regression: this was hardcoded to stateAnchors["Madhya Pradesh"] (India),
  // which is undefined here — `position = { ...undefined }` silently becomes
  // `{}`, so position.x/position.y are undefined, NaN propagates through
  // groundAt/toGrid, and the avatar and camera are placed nowhere. No crash,
  // no console error, just a broken/frozen scene — the worst kind of bug to
  // find by reading server-rendered output or running Node tests, which is
  // exactly how it shipped once already. Guard it explicitly.
  const m = src.match(/let position = \{ \.\.\.stateAnchors\["([^"]+)"\]/);
  assert.ok(m, "expected to find the avatar's initial `position = { ...stateAnchors[\"...\"] }` line");
  const spawnState = m[1];
  assert.ok(validNames.has(spawnState), `spawn state "${spawnState}" is not a key in data/usa-map.json states`);
  const anchor = map.states[spawnState];
  assert.equal(typeof anchor.cx, "number");
  assert.equal(typeof anchor.cy, "number");
});
