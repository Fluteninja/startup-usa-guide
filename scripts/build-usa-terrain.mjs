#!/usr/bin/env node
/* ============================================================
   build-usa-terrain.mjs — one-off data-prep tool.

   Adapted from startup-india-guide's scripts/build-india-terrain.mjs.
   Builds the walkable map's topographic layer: relief regions, rivers,
   lakes and named peaks, all projected into the SAME SVG space as
   data/usa-map.json and written to data/usa-terrain.json:

     { relief:[{name,kind,d,lx,ly}], rivers:[{name,d}],
       lakes:[{name,d}], peaks:[{name,elevation,x,y}] }

   Co-registration is structural, not hopeful: the projection descriptor
   is read back out of data/usa-map.json rather than recomputed, and the
   simplification helpers are shared via geo.mjs. Regenerate the state map
   first if both are being rebuilt.

   Source: Natural Earth 10m physical (public domain), served as GeoJSON by
   martynafford/natural-earth-geojson. Natural Earth asks for no credit but
   gets it in the README anyway.

   Land scope matches scripts/build-usa-map.mjs: the 48 contiguous states +
   DC (Alaska, Hawaii and Puerto Rico excluded — see that script's header
   for why). Everything that does not overlap that land is dropped at build
   time. Rivers are trimmed to their on-land runs for the same reason.

   Usage:  node scripts/build-usa-terrain.mjs
   ============================================================ */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { closedPath, dp, linesOf, openPath, pointInRing, ringArea, ringsOf, round } from "./geo.mjs";

const NE = "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/10m/physical";
const SOURCES = {
  relief: "ne_10m_geography_regions_polys.json",
  rivers: "ne_10m_rivers_lake_centerlines.json",
  lakes: "ne_10m_lakes.json",
  peaks: "ne_10m_geography_regions_elevation_points.json",
};
const USA_STATES = "scratch/usa_states.geojson";
const MAP = "data/usa-map.json";
const OUT = "data/usa-terrain.json";
const EXCLUDE = new Set(["Alaska", "Hawaii", "Puerto Rico"]);

const RELIEF_TOL = 0.8, RIVER_TOL = 0.7, LAKE_TOL = 0.6;
const MIN_RELIEF_AREA = 8, MIN_LAKE_AREA = 2.5, MIN_RIVER_LENGTH = 14;
const SAMPLE_STEP = 3;        // px grid used for the land-overlap test
const MIN_LAND_SAMPLES = 30;  // a region needs this many on-land samples to earn its bytes
/* A region gets NAMED on the map when it is both big enough to read and
   mostly inside the mapped US land. Size alone is the wrong gate — a range
   that only grazes the border (e.g. the Canadian Rockies dipping into
   Montana) still gets its tint (the map clips it at the border anyway) but
   stays anonymous rather than mislabeling a mostly-foreign feature as a US
   one. */
const MIN_LABEL_SAMPLES = 70;
const MIN_LABEL_SHARE = 0.3;

const MINOR = new Set(["of", "the", "and", "de", "du"]);
const foldAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Natural Earth shouts its major features; give them back their lower case,
 *  minus the joining words a title keeps lowercase anyway. */
const titleCase = (s) => s
  .replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase())
  .replace(/\b[A-Z][a-z]+\b/g, (w, i) => (i > 0 && MINOR.has(w.toLowerCase()) ? w.toLowerCase() : w));
function cleanName(raw) {
  if (!raw) return "";
  return titleCase(foldAccents(raw)).replace(/\s+/g, " ").trim()
    .replace(/\bRa\.$/, "Range").replace(/\bMts\.$/, "Mountains")
    .replace(/\bPk\.$/, "Peak").replace(/\bPlat\.$/, "Plateau").replace(/\bMtn\.$/, "Mountain");
}

/* Natural Earth's featurecla vocabulary → the five tints the map paints. */
const KIND = {
  "Range/mtn": "mtn", Plateau: "plateau", Desert: "desert",
  Wetlands: "wet", Delta: "wet", Valley: "plain", Plain: "plain", Basin: "plain",
};

mkdirSync("scratch", { recursive: true });
async function load(file) {
  const path = `scratch/${file}`;
  if (!existsSync(path)) writeFileSync(path, await (await fetch(`${NE}/${file}`)).text());
  return JSON.parse(readFileSync(path, "utf8"));
}
if (!existsSync(USA_STATES)) throw new Error(`${USA_STATES} is missing — run scripts/build-usa-map.mjs first`);

/* ---- projection, borrowed verbatim from the state map ---- */
const { proj, viewBox: [W, H] } = JSON.parse(readFileSync(MAP, "utf8"));
const { cosLat0, rxMin, ryMax, s, pad } = proj;
const project = ([lng, lat]) => [pad + (lng * cosLat0 - rxMin) * s, pad + (ryMax - lat) * s];

/* ---- mapped US land, in the same space, as the clipping authority ---- */
const usa = JSON.parse(readFileSync(USA_STATES, "utf8"));
const landRings = usa.features
  .filter((f) => !EXCLUDE.has(f.properties.name))
  .flatMap((f) => ringsOf(f.geometry))
  .map((ring) => ring.map(project))
  .filter((pts) => pts.length >= 4);
const onLand = (x, y) => landRings.some((ring) => pointInRing(x, y, ring));

/**
 * Grid-samples a projected ring: how many samples fall inside it (`all`), how
 * many of those are also on mapped US land (`n`), and the centre of the
 * on-land ones — which is where a label can sit and be inside both the
 * region and the US. `n / all` is the region's US share.
 */
function landOverlap(pts) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of pts) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  let n = 0, all = 0, sx = 0, sy = 0;
  for (let x = Math.max(0, minx); x <= Math.min(W, maxx); x += SAMPLE_STEP)
    for (let y = Math.max(0, miny); y <= Math.min(H, maxy); y += SAMPLE_STEP) {
      if (!pointInRing(x, y, pts)) continue;
      all++;
      if (onLand(x, y)) { n++; sx += x; sy += y; }
    }
  return { n, all, lx: n ? round(sx / n) : 0, ly: n ? round(sy / n) : 0 };
}

const warnings = [];
const simplifyRing = (ring, tol) => dp(ring.map(project), tol);

/**
 * Natural Earth splits long features across several records — a river can
 * arrive in two pieces. Merging by name keeps one entry per real-world
 * feature. Unnamed records are left alone.
 */
function mergeByName(items) {
  const byName = new Map();
  const out = [];
  for (const item of items) {
    const seen = item.name && byName.get(item.name);
    if (!seen) { out.push(item); if (item.name) byName.set(item.name, item); continue; }
    seen.d += item.d;
    if ((item.land || 0) > (seen.land || 0)) Object.assign(seen, { land: item.land, lx: item.lx, ly: item.ly });
  }
  return out;
}

/* ---- relief: the named ranges, plateaus, deserts and wetlands ---- */
const relief = [];
for (const f of (await load(SOURCES.relief)).features) {
  const kind = KIND[f.properties?.featurecla];
  if (!kind) continue;
  const rings = ringsOf(f.geometry).map((r) => simplifyRing(r, RELIEF_TOL))
    .filter((pts) => pts.length >= 4 && ringArea(pts) >= MIN_RELIEF_AREA);
  if (!rings.length) continue;
  let best = { n: 0, lx: 0, ly: 0 }, total = 0, spanned = 0;
  for (const pts of rings) {
    const hit = landOverlap(pts);
    total += hit.n;
    spanned += hit.all;
    if (hit.n > best.n) best = hit;
  }
  if (total < MIN_LAND_SAMPLES) continue;
  relief.push({
    name: cleanName(f.properties.name), kind,
    d: rings.sort((a, b) => ringArea(b) - ringArea(a)).map(closedPath).join(""),
    land: total, share: total / (spanned || 1), lx: best.lx, ly: best.ly,
  });
}

/* ---- rivers: trimmed to the runs that actually cross the mapped US ---- */
const rivers = [];
for (const f of (await load(SOURCES.rivers)).features) {
  const subs = [];
  for (const line of linesOf(f.geometry)) {
    const pts = dp(line.map(project), RIVER_TOL);
    // Keep on-land points plus one neighbour either side, so a run still
    // reaches the coastline instead of stopping short of the clip edge.
    const keep = pts.map(([x, y]) => onLand(x, y));
    const padded = keep.map((v, i) => v || keep[i - 1] || keep[i + 1]);
    let run = [];
    for (let i = 0; i <= pts.length; i++) {
      if (i < pts.length && padded[i]) { run.push(pts[i]); continue; }
      if (run.length >= 2) {
        let len = 0;
        for (let j = 1; j < run.length; j++) len += Math.hypot(run[j][0] - run[j - 1][0], run[j][1] - run[j - 1][1]);
        if (len >= MIN_RIVER_LENGTH) subs.push(openPath(run));
      }
      run = [];
    }
  }
  if (subs.length) rivers.push({ name: cleanName(f.properties.name || f.properties.name_en), d: subs.join("") });
}

/* ---- lakes and reservoirs ---- */
const lakes = [];
for (const f of (await load(SOURCES.lakes)).features) {
  const rings = ringsOf(f.geometry).map((r) => simplifyRing(r, LAKE_TOL))
    .filter((pts) => pts.length >= 4 && ringArea(pts) >= MIN_LAKE_AREA && pts.some(([x, y]) => onLand(x, y)));
  if (rings.length) lakes.push({ name: cleanName(f.properties.name), d: rings.map(closedPath).join("") });
}

/* ---- named peaks. Their state comes from the same polygons the rest of the
   map uses, so the set stays consistent with the boundary already drawn. ---- */
const peaks = [];
for (const f of (await load(SOURCES.peaks)).features) {
  const name = cleanName(f.properties.name);
  const elevation = f.properties.elevation;
  if (!name || !elevation) continue;
  const [x, y] = project(f.geometry.coordinates);
  if (!onLand(x, y)) continue;
  peaks.push({ name, elevation, x: round(x), y: round(y) });
}
peaks.sort((a, b) => b.elevation - a.elevation);

/* Merge split records, then decide which regions are present enough in the
   mapped US to deserve a label. A range that only grazes the border still
   gets its tint (the map clips it anyway) but stays anonymous. */
const reliefOut = mergeByName(relief).map(({ land, share, lx, ly, ...rest }) =>
  land >= MIN_LABEL_SAMPLES && share >= MIN_LABEL_SHARE ? { ...rest, lx, ly } : rest);
const riversOut = mergeByName(rivers);
const lakesOut = mergeByName(lakes);

for (const [label, list] of Object.entries({ relief: reliefOut, rivers: riversOut, lakes: lakesOut, peaks }))
  if (!list.length) warnings.push(`${label} came back empty — the source layout may have changed`);

const out = { relief: reliefOut, rivers: riversOut, lakes: lakesOut, peaks };
writeFileSync(OUT, JSON.stringify(out));
for (const w of warnings) console.warn(`⚠ ${w}`);
console.log(`✓ ${reliefOut.length} relief · ${riversOut.length} rivers · ${lakesOut.length} lakes · ${peaks.length} peaks → ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB)`);
console.log(`  relief: ${reliefOut.map((r) => (r.lx ? r.name : `${r.name} (unlabelled)`)).join(" · ")}`);
console.log(`  peaks:  ${peaks.slice(0, 15).map((p) => `${p.name} ${p.elevation}m`).join(" · ")}`);
