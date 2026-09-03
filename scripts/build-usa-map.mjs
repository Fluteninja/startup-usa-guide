#!/usr/bin/env node
/* ============================================================
   build-usa-map.mjs — one-off data-prep tool.

   Adapted from startup-india-guide's scripts/build-india-map.mjs. Fetches a
   US states GeoJSON, projects it with the same cos-corrected equirectangular
   projection into a fixed SVG viewBox, simplifies rings with Douglas-Peucker,
   and writes data/usa-map.json:

     { viewBox:[W,H],
       proj:{cosLat0,rxMin,ryMax,s,pad},
       states:{ "State Name": { d, cx, cy } } }

   Scope decision (see startup-usa-guide-PLAN.md §3): Alaska, Hawaii and
   Puerto Rico are EXCLUDED from this map. Their true coordinates sit far
   from the contiguous states (Alaska spans ~60° of longitude on its own;
   Hawaii sits ~25° of longitude southwest of California), so plotting them
   at true position on a simple equirectangular projection would force a
   huge canvas that shrinks every mainland state to a sliver. They still get
   full data-table treatment in data/states.json / data/state-schemes.json —
   they are just not drawn on this choropleth. A future pass could add a
   proper Albers-USA-style composite projection (mainland + scaled insets)
   if the walkable/geographic experience is extended to all states.

   Source GeoJSON: PublicaMundi/MappingAPI (MIT), a commonly used simplified
   US states dataset with one dissolved polygon per state.

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

mkdirSync("scratch", { recursive: true });
const raw = existsSync(CACHE)
  ? readFileSync(CACHE, "utf8")
  : await (async () => { const t = await (await fetch(SRC_URL)).text(); writeFileSync(CACHE, t); return t; })();
const g = JSON.parse(raw);
const features = g.features.filter((f) => !EXCLUDE.has(f.properties.name));

/* ---- projection: bbox over every kept-state vertex ---- */
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
const H = Math.round((ryMax - ryMin) * s + 2 * PAD);
const project = (lng, lat) => [PAD + (lng * cosLat0 - rxMin) * s, PAD + (ryMax - lat) * s];

const usableRings = (rings) => rings
  .map((ring) => dp(ring.map(([lng, lat]) => project(lng, lat)), TOL))
  .filter((pts) => pts.length >= 4 && ringArea(pts) >= MIN_AREA);

function centre(rings) {
  let cxSum = 0, cySum = 0, wSum = 0;
  for (const pts of usableRings(rings)) {
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
  const kept = usableRings(rings)
    .map((pts) => [ringArea(pts), closedPath(pts)])
    .sort((a, b) => b[0] - a[0]);
  if (!kept.length) warnings.push(`${name}: every ring is below the ${MIN_AREA}px² floor`);
  subpaths += kept.length;
  const [cx, cy] = centre(rings);
  states[name] = { d: kept.map(([, d]) => d).join(""), cx, cy };
}

writeFileSync(OUT, JSON.stringify({
  viewBox: [W, H],
  proj: { cosLat0: Math.round(cosLat0 * 1e6) / 1e6, rxMin, ryMax, s, pad: PAD },
  states,
}));
for (const w of warnings) console.warn(`⚠ ${w}`);
console.log(`✓ ${Object.keys(states).length} states, ${subpaths} subpaths → ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB), viewBox 0 0 ${W} ${H}`);
