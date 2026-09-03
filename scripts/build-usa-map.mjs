#!/usr/bin/env node
/* ============================================================
   build-usa-map.mjs — one-off data-prep tool.

   Adapted from startup-india-guide's scripts/build-india-map.mjs. Fetches a
   US states GeoJSON, projects the 48 contiguous states + DC with a
   cos-corrected equirectangular projection into a fixed SVG viewBox, then
   adds Alaska and Hawaii as independently-projected insets — the same
   "Albers USA" composite convention used by the Census Bureau, election
   maps, and D3's geoAlbersUsa — because their true coordinates sit nowhere
   near the mainland (Alaska alone spans ~60° of longitude; Hawaii sits
   ~25° of longitude southwest of California). Plotting them at true
   position on one projection would force a canvas that shrinks every
   mainland state to a sliver, so each inset gets its own small
   self-contained equirectangular fit, placed in a dedicated band below the
   mainland. Writes data/usa-map.json:

     { viewBox:[W,H],
       proj:{cosLat0,rxMin,ryMax,s,pad,
             insets:{ "Alaska":{cosLat0,rxMin,ryMax,s,padX,padY},
                      "Hawaii":{cosLat0,rxMin,ryMax,s,padX,padY} }},
       states:{ "State Name": { d, cx, cy } } }

   Every consumer of this file (build.mjs's hero mini-map, site.js's
   incubator/state-schemes maps, the walkable 3D map) reads states generically
   by name — Alaska and Hawaii need no special-casing there, since their
   shapes already land in final canvas position. Only code that converts a
   raw incubator lat/lng into a canvas position needs to pick the right
   sub-projection by state name (see build.mjs / site.js `P()` helpers).

   Puerto Rico remains excluded (not on the map, still in the data tables) —
   a third inset was judged not worth the added canvas clutter for one
   territory; revisit if that changes.

   Source GeoJSON: PublicaMundi/MappingAPI (MIT), a commonly used simplified
   US states dataset with one dissolved polygon per state. Alaska's polygon
   in this source already uses continuous (unwrapped) longitudes past -180°
   rather than crossing the antimeridian, so no special wraparound handling
   is needed here.

   Usage:  node scripts/build-usa-map.mjs
   ============================================================ */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { closedPath, dp, ringArea, ringsOf, round } from "./geo.mjs";

const SRC_URL = "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";
const CACHE = "scratch/usa_states.geojson";
const OUT = "data/usa-map.json";
const W = 1000, PAD = 12, TOL = 0.55;
const MEAN_LAT = 39; // contiguous US centroid latitude for the cos correction
const MIN_AREA = 3;
const EXCLUDE = new Set(["Alaska", "Hawaii", "Puerto Rico"]);
const INSET_TOL = 0.35, INSET_MIN_AREA = 1.5;
const INSET_GAP = 22;    // gap between mainland and the inset band
const INSET_PAD = 10;    // inner padding of each inset box
const AK_BOX = { w: 230, h: 170, meanLat: 63 };
const HI_BOX = { w: 130, h: 100, meanLat: 20.5 };
const INSET_ROW_GAP = 18; // horizontal gap between the AK and HI boxes

mkdirSync("scratch", { recursive: true });
async function loadUsa() {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8"));
  const text = await (await fetch(SRC_URL)).text();
  writeFileSync(CACHE, text);
  return JSON.parse(text);
}
const g = await loadUsa();
const features = g.features.filter((f) => !EXCLUDE.has(f.properties.name));

/* ---- mainland projection: bbox over every kept-state vertex ---- */
const cosLat0 = Math.cos((MEAN_LAT * Math.PI) / 180);
let rxMin = Infinity, rxMax = -Infinity, ryMin = Infinity, ryMax = -Infinity;
for (const f of features)
  for (const ring of ringsOf(f.geometry))
    for (const [lng, lat] of ring) {
      const rx = lng * cosLat0;
      if (rx < rxMin) rxMin = rx; if (rx > rxMax) rxMax = rx;
      if (lat < ryMin) ryMin = lat; if (lat > ryMax) ryMax = lat;
    }
const s = (W - 2 * PAD) / (rxMax - rxMin);
const mainlandH = Math.round((ryMax - ryMin) * s + 2 * PAD);
const project = (lng, lat) => [PAD + (lng * cosLat0 - rxMin) * s, PAD + (ryMax - lat) * s];

const usableRings = (rings, proj, tol) => rings
  .map((ring) => dp(ring.map(([lng, lat]) => proj(lng, lat)), tol))
  .filter((pts) => pts.length >= 4 && ringArea(pts) >= MIN_AREA);

function centre(rings, proj, tol) {
  let cxSum = 0, cySum = 0, wSum = 0;
  for (const pts of usableRings(rings, proj, tol)) {
    const area = ringArea(pts);
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const [x, y] of pts) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    cxSum += ((minx + maxx) / 2) * area; cySum += ((miny + maxy) / 2) * area; wSum += area;
  }
  return [round(cxSum / (wSum || 1)), round(cySum / (wSum || 1))];
}

const warnings = [];
const states = {};
let subpaths = 0;
for (const f of features) {
  const name = f.properties.name;
  const rings = ringsOf(f.geometry);
  const kept = usableRings(rings, project, TOL)
    .map((pts) => [ringArea(pts), closedPath(pts)])
    .sort((a, b) => b[0] - a[0]);
  if (!kept.length) warnings.push(`${name}: every ring is below the ${MIN_AREA}px² floor`);
  subpaths += kept.length;
  const [cx, cy] = centre(rings, project, TOL);
  states[name] = { d: kept.map(([, d]) => d).join(""), cx, cy };
}

/**
 * Build one composite inset: its own cos-corrected equirectangular fit,
 * scaled (preserving aspect ratio) to fit inside a target box, anchored at
 * (boxX, boxY). Returns the proj descriptor plus the rendered state shape.
 */
function buildInset(name, boxX, boxY, box) {
  const feature = g.features.find((f) => f.properties.name === name);
  if (!feature) { warnings.push(`${name}: not found in source GeoJSON — inset skipped`); return null; }
  const rings = ringsOf(feature.geometry);
  const insetCos = Math.cos((box.meanLat * Math.PI) / 180);
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const ring of rings) for (const [lng, lat] of ring) {
    const rx = lng * insetCos;
    if (rx < bx0) bx0 = rx; if (rx > bx1) bx1 = rx;
    if (lat < by0) by0 = lat; if (lat > by1) by1 = lat;
  }
  const innerW = box.w - 2 * INSET_PAD, innerH = box.h - 2 * INSET_PAD;
  const fitS = Math.min(innerW / (bx1 - bx0), innerH / (by1 - by0));
  // Center the shape within its box on whichever axis has slack.
  const usedW = (bx1 - bx0) * fitS, usedH = (by1 - by0) * fitS;
  const padX = boxX + INSET_PAD + (innerW - usedW) / 2;
  const padY = boxY + INSET_PAD + (innerH - usedH) / 2;
  const insetProject = (lng, lat) => [padX + (lng * insetCos - bx0) * fitS, padY + (by1 - lat) * fitS];
  const kept = usableRings(rings, insetProject, INSET_TOL)
    .map((pts) => [ringArea(pts), closedPath(pts)])
    .filter(([area]) => area >= INSET_MIN_AREA)
    .sort((a, b) => b[0] - a[0]);
  if (!kept.length) warnings.push(`${name}: inset produced no visible rings`);
  const [cx, cy] = centre(rings, insetProject, INSET_TOL);
  states[name] = { d: kept.map(([, d]) => d).join(""), cx, cy };
  return { cosLat0: Math.round(insetCos * 1e6) / 1e6, rxMin: bx0, ryMax: by1, s: fitS, padX: Math.round(padX * 10) / 10, padY: Math.round(padY * 10) / 10 };
}

const insetY = mainlandH + INSET_GAP;
const akProj = buildInset("Alaska", PAD, insetY, AK_BOX);
const hiProj = buildInset("Hawaii", PAD + AK_BOX.w + INSET_ROW_GAP, insetY, HI_BOX);
const insets = {};
if (akProj) insets.Alaska = akProj;
if (hiProj) insets.Hawaii = hiProj;

const H = insetY + Math.max(AK_BOX.h, HI_BOX.h) + PAD;

writeFileSync(OUT, JSON.stringify({
  viewBox: [W, H],
  proj: { cosLat0: Math.round(cosLat0 * 1e6) / 1e6, rxMin, ryMax, s, pad: PAD, insets },
  states,
}));
for (const w of warnings) console.warn(`⚠ ${w}`);
console.log(`✓ ${Object.keys(states).length} states (incl. Alaska + Hawaii insets), ${subpaths} mainland subpaths → ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB), viewBox 0 0 ${W} ${H}`);
