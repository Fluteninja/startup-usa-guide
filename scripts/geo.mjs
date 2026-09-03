/* ============================================================
   geo.mjs — geometry helpers shared by the data-prep scripts
   (build-india-map.mjs and build-india-terrain.mjs).

   Both scripts must simplify and round IDENTICALLY, otherwise the
   terrain layer would drift away from the state polygons it is drawn
   inside. Keeping the arithmetic in one place is what guarantees they
   stay co-registered.
   ============================================================ */

/** Douglas-Peucker on projected [x,y] points. */
export function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let idx = -1, max = tol;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const t = ((px - ax) * dx + (py - ay) * dy) / len2;
      const cx = ax + t * dx, cy = ay + t * dy;
      const d = Math.hypot(px - cx, py - cy);
      if (d > max) { max = d; idx = i; }
    }
    if (idx !== -1) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Unsigned area of a projected ring. */
export function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += (pts[j][0] * pts[i][1]) - (pts[i][0] * pts[j][1]);
  return Math.abs(a / 2);
}

/** One decimal place — the precision the committed JSON is written at. */
export const round = (n) => Math.round(n * 10) / 10;

/** GeoJSON geometry → flat list of rings (Polygon and MultiPolygon). */
export const ringsOf = (geom) =>
  !geom ? [] :
  geom.type === "Polygon" ? geom.coordinates :
  geom.type === "MultiPolygon" ? geom.coordinates.flat() : [];

/** GeoJSON geometry → flat list of lines (LineString and MultiLineString). */
export const linesOf = (geom) =>
  !geom ? [] :
  geom.type === "LineString" ? [geom.coordinates] :
  geom.type === "MultiLineString" ? geom.coordinates : [];

/** "M x,y L x,y … Z" for a closed ring. */
export const closedPath = (pts) =>
  "M" + pts.map(([x, y]) => `${round(x)},${round(y)}`).join("L") + "Z";

/** "M x,y L x,y …" for an open line. */
export const openPath = (pts) =>
  "M" + pts.map(([x, y]) => `${round(x)},${round(y)}`).join("L");

/**
 * Even-odd point-in-ring test (ray casting). Used to keep terrain that
 * never touches Indian land out of the committed data.
 */
export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Fetch-with-cache for the one-off data-prep tools. */
export async function cached(url, file, { readFileSync, writeFileSync, existsSync }) {
  if (existsSync(file)) return readFileSync(file, "utf8");
  const text = await (await fetch(url)).text();
  writeFileSync(file, text);
  return text;
}
