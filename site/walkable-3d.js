/* ============================================================
   walkable-3d.js — the 3D walkable map of India's startup
   ecosystem. A three.js scene in the spirit of "Summer
   Afternoon": a small explorer on painterly terrain, with the
   guide's real state geometry, terrain, and all 224 incubators.

   Everything interactive stays native DOM projected over the
   canvas — buttons and links keep their accessible names, the
   state drawer is the same one the 2D map used, and every
   record remains reachable without walking (see WALKABLE_MAP.md).
   ============================================================ */
import * as THREE from "./vendor/three.module.min.js";
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MAP_HEIGHT,
  MAP_WIDTH,
  MIN_ZOOM,
  WALK_SPEED,
  WORLD_SCALE,
  ZOOM_STEP,
  clampZoom,
  distance,
  normalizeMovement,
  placeDecor,
  placeOrganizations,
  seededRandom,
} from "./walkable-core.js";
import {
  KIND_ORDER,
  buildHeightField,
  cameraOffset,
  damp,
  decorArchetype,
  distanceToPitch,
  lerpAngle,
  sampleGrid,
  valueNoise2D,
  zoomToDistance,
} from "./walkable-3d-core.js";

/** Zoom at or above which terrain names and peak markers appear. */
const DETAIL_ZOOM = 1;
/** Decor scatter — same budget and determinism as the 2D map carried. */
const DECOR_COUNT = 760;
/** Avatar speed in map units per second (the 2D contract, ÷ world scale). */
const AVATAR_SPEED = WALK_SPEED / WORLD_SCALE;
/** Proximity radius for the "Learn about …" prompt, in map units. */
const NEARBY_RADIUS = 620 / WORLD_SCALE;
/** Height-field raster resolution. */
const GRID_W = 300;
const GRID_H = Math.round(GRID_W * MAP_HEIGHT / MAP_WIDTH); // 334
/** Overlay draw distances, in map units. */
const RANGE = { org: 95, landmark: 340, wayfinder: 300, transfer: 560, label: 380 };

const root = document.querySelector("#walkable-map");

if (root) main(root);

function main(root) {
  /* ---------------- data ---------------- */
  const readJSON = (id) => JSON.parse(document.getElementById(id)?.textContent || "null");
  const incubators = readJSON("walkable-incubators") || [];
  const map = readJSON("india-map-data");
  const terrain = readJSON("india-terrain-data") || { relief: [], rivers: [], lakes: [], peaks: [] };
  const stateRecords = readJSON("walkable-states") || [];
  const stateMeta = Object.fromEntries(stateRecords.map((state) => [state.state, state]));
  const mapStates = map?.states || {};
  if (!mapStates.Lakshadweep?.d) {
    mapStates.Lakshadweep = {
      cx: 163.3,
      cy: 964.4,
      d: [
        "M148,952a2,2 0 1,0 0,4a2,2 0 1,0 0,-4",
        "M156,961.5a1.75,1.75 0 1,0 0,3.5a1.75,1.75 0 1,0 0,-3.5",
        "M163,962a2.25,2.25 0 1,0 0,4.5a2.25,2.25 0 1,0 0,-4.5",
        "M169,975.5a1.75,1.75 0 1,0 0,3.5a1.75,1.75 0 1,0 0,-3.5",
        "M174,988a2,2 0 1,0 0,4a2,2 0 1,0 0,-4",
        "M178,1031.5a2.5,2.5 0 1,0 0,5a2.5,2.5 0 1,0 0,-5",
      ].join(""),
    };
  }

  /* ---------------- DOM ---------------- */
  const viewport = root.querySelector(".walkable-viewport");
  const canvas = root.querySelector(".walkable-canvas");
  const overlay = root.querySelector(".walkable-overlay");
  const orgLayer = root.querySelector(".walkable-orgs");
  const landmarkLayer = root.querySelector(".walkable-landmarks");
  const wayfinderLayer = root.querySelector(".walkable-wayfinders");
  const labelLayer = root.querySelector(".walkable-terrain-labels");
  const fallback = root.querySelector(".walkable-3d-fallback");
  const minimapDot = root.querySelector(".walkable-minimap-dot");
  const nearbyButton = root.querySelector("#walkable-nearby");
  const zoomIn = root.querySelector("#walkable-zoom-in");
  const zoomOut = root.querySelector("#walkable-zoom-out");
  const zoomReset = root.querySelector("#walkable-zoom-reset");
  const zoomLevel = root.querySelector("#walkable-zoom-level");
  const recenter = root.querySelector("#walkable-recenter");
  const help = root.querySelector("#walkable-help");
  const drawer = root.querySelector("#state-drawer");
  const drawerBackdrop = root.querySelector(".walkable-drawer-backdrop");
  const drawerPanel = root.querySelector(".walkable-drawer-panel");
  const drawerBody = root.querySelector(".walkable-drawer-body");
  const drawerTitle = root.querySelector("#state-drawer-title");
  const drawerClose = root.querySelector("#state-drawer-close");
  const motionOK = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- renderer, or the graceful exit ---------------- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    if (!renderer.getContext()) throw new Error("no context");
  } catch {
    fallback.hidden = false;
    canvas.hidden = true;
    return;
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  /* ---------------- shared labels/icons (as on the 2D map) ---------------- */
  const typeLabels = {
    Academic: "Academic incubator",
    TBI: "Technology Business Incubator",
    AIC: "Atal Incubation Centre",
    Government: "Government incubator",
    "Sector-specific": "Sector-specific incubator",
    Private: "Private incubator",
  };
  const typeKeys = {
    Academic: "academic",
    TBI: "tbi",
    AIC: "aic",
    Government: "government",
    "Sector-specific": "sector",
    Private: "private",
  };
  const iconPaths = {
    academic: '<path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
    tbi: '<path d="M12 21v-9"/><path d="M12 14c-5 0-7-3-7-7 4 0 7 2 7 7Zm0-3c4 0 6-3 6-6-4 0-6 2-6 6Z"/>',
    aic: '<path d="M14.5 4.5C17 2 20 2 20 2s0 3-2.5 5.5l-7 7-4-4 8-6Z"/><circle cx="15.5" cy="6.5" r="1.5"/><path d="M10.5 7H6L3 10l4 1.5M14 14l-1.5 4.5L9.5 21 9 15.5"/><path d="M7 17c-2 0-3 1-3 3 2 0 3-1 3-3Z"/>',
    government: '<path d="m3 9 9-5 9 5"/><path d="M5 10h14M6 10v8m4-8v8m4-8v8m4-8v8M3 20h18"/>',
    sector: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 3v4m0 10v4M3 12h4m10 0h4"/>',
    private: '<path d="M9 7V5h6v2"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 12h18m-11 0v2h4v-2"/>',
  };
  const icon = (type) => {
    const key = typeKeys[type] || type;
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[key] || iconPaths.private}</svg>`;
  };
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));

  /* ---------------- geometry hit-testing (identical to 2D) ---------------- */
  const hitContext = document.createElement("canvas").getContext("2d");
  const paths = Object.fromEntries(Object.entries(mapStates).map(([name, shape]) => [name, new Path2D(shape.d)]));
  const landPaths = Object.values(paths);
  const containsLand = (point) => landPaths.some((path) => hitContext.isPointInPath(path, point.x, point.y));
  const containsState = (name, point) => Boolean(paths[name] && hitContext.isPointInPath(paths[name], point.x, point.y));
  const safeAnchor = (name) => {
    const shape = mapStates[name];
    const origin = { x: shape?.cx || MAP_WIDTH / 2, y: shape?.cy || MAP_HEIGHT / 2 };
    if (containsState(name, origin)) return origin;
    for (let radius = 2; radius <= 80; radius += 2) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const point = { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
        if (containsState(name, point)) return point;
      }
    }
    return origin;
  };

  /* State bounding boxes come from a throwaway measuring SVG so incubator
     placement stays byte-identical with what the 2D map computed. */
  const stateAnchors = {};
  const stateBounds = {};
  {
    const svgNS = "http://www.w3.org/2000/svg";
    const measure = document.createElementNS(svgNS, "svg");
    measure.setAttribute("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
    measure.style.cssText = "position:absolute;left:-9999px;top:0;width:100px;height:111px;";
    document.body.append(measure);
    for (const [name, shape] of Object.entries(mapStates)) {
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", shape.d);
      measure.append(path);
      const box = path.getBBox();
      stateBounds[name] = { x: box.x, y: box.y, width: box.width, height: box.height };
      stateAnchors[name] = safeAnchor(name);
    }
    measure.remove();
  }

  const reliefOrder = { mtn: 0, desert: 1, wet: 2, plateau: 3, plain: 4 };
  const relief = [...(terrain.relief || [])].sort(
    (a, b) => (reliefOrder[a.kind] ?? 9) - (reliefOrder[b.kind] ?? 9));
  const reliefHitPaths = relief.map((region) => [region.kind, new Path2D(region.d)]);
  const kindAt = (point) => {
    for (const [kind, path] of reliefHitPaths)
      if (hitContext.isPointInPath(path, point.x, point.y)) return kind;
    return "other";
  };

  /* ---------------- palette from the design tokens ---------------- */
  const cssColor = (name, fallbackColor) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallbackColor;
  };
  const isDark = () => document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.getAttribute("data-theme") &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  function readPalette() {
    return {
      dark: isDark(),
      water: cssColor("--walk-water", "#dbeef4"),
      land: cssColor("--walk-land", "#e6efd2"),
      landAlt: cssColor("--walk-land-alt", "#d4e4b8"),
      border: cssColor("--walk-land-border", "#718b5b"),
      relief: {
        mtn: cssColor("--walk-relief-mtn", "#c3cfa4"),
        plateau: cssColor("--walk-relief-plateau", "#dfe3bd"),
        desert: cssColor("--walk-relief-desert", "#f0e6c4"),
        wet: cssColor("--walk-relief-wet", "#c2d9c4"),
        plain: cssColor("--walk-relief-plain", "#e8f0d2"),
      },
      river: cssColor("--walk-river", "#8fbccf"),
      lake: cssColor("--walk-lake", "#9fcbdc"),
      skyTop: cssColor("--walk3d-sky-top", "#6fb2e4"),
      skyHorizon: cssColor("--walk3d-sky-horizon", "#f3ecd7"),
      sea: cssColor("--walk3d-sea", "#8ec7db"),
      seaDeep: cssColor("--walk3d-sea-deep", "#5da3c2"),
      fog: cssColor("--walk3d-fog", "#e9eedd"),
      sun: cssColor("--walk3d-sun", "#fff3da"),
      cloud: cssColor("--walk3d-cloud", "#fffaf0"),
      trunk: cssColor("--walk3d-trunk", "#8a6642"),
      canopyA: cssColor("--walk3d-canopy-a", "#7fae62"),
      canopyB: cssColor("--walk3d-canopy-b", "#96a45c"),
      pine: cssColor("--walk3d-pine", "#5d8b58"),
      shrub: cssColor("--walk3d-shrub", "#a4b36a"),
      rock: cssColor("--walk3d-rock", "#b0a894"),
      orgTypes: {
        academic: cssColor("--org-academic", "#6d4fc4"),
        tbi: cssColor("--org-tbi", "#1f7a4d"),
        aic: cssColor("--org-aic", "#c05621"),
        government: cssColor("--org-government", "#b7791f"),
        sector: cssColor("--org-sector", "#0f766e"),
        private: cssColor("--org-private", "#2b6cb0"),
      },
    };
  }
  let palette = readPalette();

  /* ---------------- raster masks → height field ---------------- */
  const kindIndex = Object.fromEntries(KIND_ORDER.map((kind, index) => [kind, index]));
  function rasterizeGrids() {
    const canvas2d = document.createElement("canvas");
    canvas2d.width = GRID_W;
    canvas2d.height = GRID_H;
    const ctx = canvas2d.getContext("2d", { willReadFrequently: true });
    ctx.scale(GRID_W / MAP_WIDTH, GRID_H / MAP_HEIGHT);

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    ctx.fillStyle = "#fff";
    for (const path of landPaths) ctx.fill(path);
    const landData = ctx.getImageData(0, 0, GRID_W, GRID_H).data;
    const land = new Float32Array(GRID_W * GRID_H);
    for (let index = 0; index < land.length; index += 1) land[index] = landData[index * 4] > 127 ? 1 : 0;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    // Painted lowest-priority first so the kind map matches kindAt()'s
    // first-match-wins order (mtn beats everything it overlaps).
    for (const region of [...relief].reverse()) {
      const index = kindIndex[region.kind] ?? 0;
      ctx.fillStyle = `rgb(${index * 40},0,0)`;
      ctx.fill(new Path2D(region.d));
    }
    const kindData = ctx.getImageData(0, 0, GRID_W, GRID_H).data;
    const kind = new Uint8Array(GRID_W * GRID_H);
    for (let index = 0; index < kind.length; index += 1) {
      kind[index] = Math.min(KIND_ORDER.length - 1, Math.round(kindData[index * 4] / 40));
    }
    return { land, kind };
  }
  const { land: landGrid, kind: kindGrid } = rasterizeGrids();
  const toGrid = (point) => ({
    x: point.x / MAP_WIDTH * (GRID_W - 1),
    y: point.y / MAP_HEIGHT * (GRID_H - 1),
  });
  /* Every landmark gets guaranteed dry ground under it; islands smaller than
     a raster cell (Lakshadweep's atolls) get their islets stamped directly. */
  const lakshadweepIslets = [
    { x: 150, y: 954 }, { x: 157.75, y: 963.25 }, { x: 165.25, y: 964.25 },
    { x: 170.75, y: 977.25 }, { x: 176, y: 990 }, { x: 180.5, y: 1034 },
  ];
  const bumps = [...Object.values(stateAnchors), ...lakshadweepIslets].map((anchor) => {
    const grid = toGrid(anchor);
    return { x: grid.x, y: grid.y, radius: 2.6, height: 1.7 };
  });
  const heightGrid = buildHeightField({
    width: GRID_W, height: GRID_H, land: landGrid, kind: kindGrid, bumps,
  });
  const heightAt = (x, y) => {
    const grid = toGrid({ x, y });
    return sampleGrid(heightGrid, GRID_W, GRID_H, grid.x, grid.y);
  };
  const groundAt = (x, y) => Math.max(heightAt(x, y), 0.35);

  /* ---------------- ground texture ---------------- */
  const TEXTURE_W = 2048;
  const TEXTURE_H = Math.round(TEXTURE_W * MAP_HEIGHT / MAP_WIDTH);
  const groundCanvas = document.createElement("canvas");
  groundCanvas.width = TEXTURE_W;
  groundCanvas.height = TEXTURE_H;
  const landUnion = new Path2D();
  for (const [, shape] of Object.entries(mapStates)) landUnion.addPath(new Path2D(shape.d));

  function paintGround() {
    const ctx = groundCanvas.getContext("2d");
    ctx.setTransform(TEXTURE_W / MAP_WIDTH, 0, 0, TEXTURE_H / MAP_HEIGHT, 0, 0);
    ctx.fillStyle = palette.water;
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    // Shallow-water shelf: a soft halo hugging the coastline, visible through
    // the translucent sea surface.
    ctx.save();
    ctx.strokeStyle = palette.landAlt;
    ctx.globalAlpha = 0.4;
    ctx.lineJoin = "round";
    for (const width of [14, 7]) {
      ctx.lineWidth = width;
      ctx.stroke(landUnion);
    }
    ctx.restore();

    const statePaths = Object.entries(mapStates);
    statePaths.forEach(([, shape], index) => {
      // nth-child(3n) in the 2D stylesheet — every third state takes the
      // alternate tone, so the patchwork reads the same from the air.
      ctx.fillStyle = (index + 1) % 3 === 0 ? palette.landAlt : palette.land;
      ctx.fill(new Path2D(shape.d));
    });

    ctx.save();
    ctx.clip(landUnion);
    ctx.globalAlpha = 0.62;
    for (const region of [...relief].reverse()) {
      ctx.fillStyle = palette.relief[region.kind] || palette.land;
      ctx.fill(new Path2D(region.d));
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.river;
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const river of terrain.rivers || []) ctx.stroke(new Path2D(river.d));
    ctx.fillStyle = palette.lake;
    for (const lake of terrain.lakes || []) ctx.fill(new Path2D(lake.d));
    ctx.restore();

    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 0.9;
    ctx.lineJoin = "round";
    for (const [, shape] of statePaths) ctx.stroke(new Path2D(shape.d));
  }
  paintGround();
  const groundTexture = new THREE.CanvasTexture(groundCanvas);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  /* ---------------- scene ---------------- */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.5, 6000);
  const centerX = MAP_WIDTH / 2;
  const centerZ = MAP_HEIGHT / 2;

  scene.fog = new THREE.Fog(new THREE.Color(palette.fog), 320, 1500);

  // Sky dome: a vertical gradient, unaffected by fog.
  const skyUniforms = {
    topColor: { value: new THREE.Color(palette.skyTop) },
    horizonColor: { value: new THREE.Color(palette.skyHorizon) },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2800, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        varying vec3 vPos;
        void main() {
          float t = smoothstep(-80.0, 700.0, vPos.y);
          gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
        }`,
    }),
  );
  sky.position.set(centerX, 0, centerZ);
  scene.add(sky);

  /* Dusk needs stronger fill than daylight: the dark palette's albedo is
     already deep, so without the boost the world crushes to black. */
  const hemisphere = new THREE.HemisphereLight(
    new THREE.Color(palette.skyHorizon), new THREE.Color(palette.land),
    palette.dark ? 1.9 : 1.15);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(new THREE.Color(palette.sun), palette.dark ? 2.6 : 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 40;
  sun.shadow.camera.far = 700;
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  // Terrain: the whole map as one displaced, textured plane.
  const SEGMENTS_X = 240;
  const SEGMENTS_Z = 267;
  const terrainGeometry = new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT, SEGMENTS_X, SEGMENTS_Z);
  terrainGeometry.rotateX(-Math.PI / 2);
  terrainGeometry.translate(centerX, 0, centerZ);
  {
    const positions = terrainGeometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(index, heightAt(positions.getX(index), positions.getZ(index)));
    }
    terrainGeometry.computeVertexNormals();
  }
  const terrainMaterial = new THREE.MeshLambertMaterial({ map: groundTexture });
  const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // Sea: a translucent disc with a scrolling generated normal map, so the sun
  // glints move like slow swell. The shallow shelf painted on the ground
  // texture shows through near every coast.
  const seaNormalTexture = (() => {
    const size = 128;
    const noiseCanvas = document.createElement("canvas");
    noiseCanvas.width = size;
    noiseCanvas.height = size;
    const ctx = noiseCanvas.getContext("2d");
    const image = ctx.createImageData(size, size);
    const noise = valueNoise2D("walkable-sea");
    const heightOf = (x, y) => noise(x * 0.09, y * 0.09) + 0.4 * noise(x * 0.23 + 40, y * 0.23 + 40);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = heightOf(x + 1, y) - heightOf(x - 1, y);
        const dy = heightOf(x, y + 1) - heightOf(x, y - 1);
        const offset = (y * size + x) * 4;
        image.data[offset] = 128 + dx * 220;
        image.data[offset + 1] = 128 + dy * 220;
        image.data[offset + 2] = 255;
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(noiseCanvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(90, 90);
    return texture;
  })();
  const seaMaterial = new THREE.MeshPhongMaterial({
    color: new THREE.Color(palette.sea),
    specular: new THREE.Color(palette.sun),
    shininess: 120,
    transparent: true,
    opacity: 0.82,
    normalMap: seaNormalTexture,
    normalScale: new THREE.Vector2(0.55, 0.55),
  });
  const seaMesh = new THREE.Mesh(new THREE.CircleGeometry(3200, 48), seaMaterial);
  seaMesh.rotation.x = -Math.PI / 2;
  seaMesh.position.set(centerX, 0, centerZ);
  scene.add(seaMesh);

  // Clouds: a few soft billboards drifting far overhead.
  const cloudTexture = (() => {
    const size = 256;
    const cloudCanvas = document.createElement("canvas");
    cloudCanvas.width = size;
    cloudCanvas.height = size;
    const ctx = cloudCanvas.getContext("2d");
    const random = seededRandom("walkable-clouds");
    for (let blob = 0; blob < 14; blob += 1) {
      const radius = 26 + random() * 42;
      const x = size * (0.2 + random() * 0.6);
      const y = size * (0.35 + random() * 0.3);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(255,255,255,0.85)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(cloudCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  })();
  const clouds = [];
  {
    const random = seededRandom("walkable-cloud-field");
    for (let index = 0; index < 16; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: cloudTexture,
        color: new THREE.Color(palette.cloud),
        transparent: true,
        opacity: 0.55 + random() * 0.25,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(random() * 2400 - 700, 150 + random() * 110, random() * 2500 - 700);
      const scale = 130 + random() * 160;
      sprite.scale.set(scale, scale * 0.42, 1);
      sprite.userData.speed = 1.5 + random() * 2;
      scene.add(sprite);
      clouds.push(sprite);
    }
  }

  /* ---------------- decor: instanced trees, pines, shrubs, rocks ------- */
  const placedIncubators = placeOrganizations({
    organizations: incubators,
    regionBounds: stateBounds,
    regionAnchors: stateAnchors,
    contains: containsState,
  });

  const signs = [
    { x: 277, y: 205, targets: ["Jammu and Kashmir", "Himachal Pradesh", "Punjab"] },
    { x: 319, y: 323, targets: ["Delhi", "Haryana", "Uttarakhand", "Uttar Pradesh"] },
    { x: 188, y: 493, targets: ["Rajasthan", "Gujarat", "Maharashtra"] },
    { x: 388, y: 505, targets: ["Madhya Pradesh", "Chhattisgarh", "Odisha"] },
    { x: 570, y: 506, targets: ["Bihar", "Jharkhand", "West Bengal", "Odisha"] },
    { x: 747, y: 409, targets: ["Sikkim", "Assam", "Meghalaya", "Arunachal Pradesh"] },
    { x: 872, y: 443, targets: ["Nagaland", "Manipur", "Mizoram", "Tripura"] },
    { x: 363, y: 694, targets: ["Maharashtra", "Telangana", "Andhra Pradesh", "Karnataka"] },
    { x: 335, y: 844, targets: ["Karnataka", "Tamil Nadu", "Kerala", "Puducherry"] },
  ];
  const transfers = [
    { x: 286, y: 974, label: "Ferry to Lakshadweep", destination: "Lakshadweep" },
    { x: 163.3, y: 982, label: "Return to Kerala", destination: "Kerala" },
    { x: 410, y: 895, label: "Sail to Andaman & Nicobar", destination: "Andaman and Nicobar Islands" },
    { x: 840, y: 950, label: "Return to Tamil Nadu", destination: "Tamil Nadu" },
  ];

  const decor = placeDecor({
    count: DECOR_COUNT,
    contains: containsLand,
    kindAt,
    avoid: [
      ...placedIncubators,
      ...Object.values(stateAnchors),
      ...signs.map(({ x, y }) => ({ x, y })),
      ...transfers.map(({ x, y }) => ({ x, y })),
    ],
  });

  const decorGroups = {
    tree: decor.filter((item) => decorArchetype(item.sprite) === "tree" && !item.sprite.endsWith("c")),
    pine: decor.filter((item) => item.sprite === "tree-simple-c"),
    shrub: decor.filter((item) => decorArchetype(item.sprite) === "shrub"),
    rock: decor.filter((item) => decorArchetype(item.sprite) === "rock"),
  };
  const decorMeshes = []; // [{mesh, group, colorOf}]
  function addInstanced(items, geometry, material, colorOf, place) {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mesh.castShadow = true;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    items.forEach((item, index) => {
      const ground = groundAt(item.x, item.y);
      const spin = seededRandom(`decor-spin:${item.x.toFixed(2)}:${item.y.toFixed(2)}`)();
      quaternion.setFromAxisAngle(up, spin * Math.PI * 2);
      const { position, scale } = place(item, ground);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, colorOf(item, index));
    });
    scene.add(mesh);
    decorMeshes.push({ mesh, items, colorOf });
  }
  const decorColor = (hex, jitterSeed, amount = 0.08) => (item, index) => {
    const color = new THREE.Color(hex);
    const jitter = seededRandom(`${jitterSeed}:${index}`)();
    color.offsetHSL(0, 0, (jitter - 0.5) * amount * 2);
    return color;
  };
  function buildDecor() {
    for (const entry of decorMeshes) {
      scene.remove(entry.mesh);
      entry.mesh.dispose();
    }
    decorMeshes.length = 0;
    const scaleOf = (item, base) => item.scale * base;
    // Round tree: blobby canopy on a short trunk (trunk merged into the cone
    // of the canopy visually; two instanced meshes would double draw calls
    // for little gain at this art scale).
    const canopy = new THREE.IcosahedronGeometry(2.1, 1);
    canopy.translate(0, 3.6, 0);
    const trunkless = new THREE.CylinderGeometry(0.34, 0.44, 2.6, 6);
    trunkless.translate(0, 1.2, 0);
    addInstanced(decorGroups.tree, mergeGeometry([canopy, trunkless]),
      new THREE.MeshLambertMaterial({ flatShading: true }),
      (item, index) => (item.sprite.endsWith("b")
        ? decorColor(palette.canopyB, "canopy-b")(item, index)
        : decorColor(palette.canopyA, "canopy-a")(item, index)),
      (item, ground) => ({
        position: new THREE.Vector3(item.x, ground - 0.15, item.y),
        scale: new THREE.Vector3(scaleOf(item, 1), scaleOf(item, 1), scaleOf(item, 1)),
      }));
    const pine = new THREE.ConeGeometry(1.7, 4.6, 7);
    pine.translate(0, 3.4, 0);
    const pineTrunk = new THREE.CylinderGeometry(0.3, 0.4, 1.4, 6);
    pineTrunk.translate(0, 0.7, 0);
    addInstanced(decorGroups.pine, mergeGeometry([pine, pineTrunk]),
      new THREE.MeshLambertMaterial({ flatShading: true }),
      decorColor(palette.pine, "pine"),
      (item, ground) => ({
        position: new THREE.Vector3(item.x, ground - 0.15, item.y),
        scale: new THREE.Vector3(scaleOf(item, 1), scaleOf(item, 1), scaleOf(item, 1)),
      }));
    const shrubGeometry = new THREE.IcosahedronGeometry(1.15, 1);
    shrubGeometry.scale(1, 0.72, 1);
    shrubGeometry.translate(0, 0.6, 0);
    addInstanced(decorGroups.shrub, shrubGeometry,
      new THREE.MeshLambertMaterial({ flatShading: true }),
      decorColor(palette.shrub, "shrub", 0.1),
      (item, ground) => ({
        position: new THREE.Vector3(item.x, ground - 0.1, item.y),
        scale: new THREE.Vector3(scaleOf(item, 1), scaleOf(item, 1), scaleOf(item, 1)),
      }));
    const rockGeometry = new THREE.DodecahedronGeometry(1.05, 0);
    rockGeometry.scale(1.25, 0.8, 1);
    rockGeometry.translate(0, 0.45, 0);
    addInstanced(decorGroups.rock, rockGeometry,
      new THREE.MeshLambertMaterial({ flatShading: true }),
      decorColor(palette.rock, "rock", 0.09),
      (item, ground) => ({
        position: new THREE.Vector3(item.x, ground - 0.1, item.y),
        scale: new THREE.Vector3(scaleOf(item, 1), scaleOf(item, 0.85), scaleOf(item, 1)),
      }));
  }
  function mergeGeometry(geometries) {
    // Minimal non-indexed merge — enough for two convex primitives.
    let total = 0;
    const prepared = geometries.map((geometry) => {
      const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
      total += nonIndexed.attributes.position.count;
      return nonIndexed;
    });
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    let offset = 0;
    for (const geometry of prepared) {
      positions.set(geometry.attributes.position.array, offset * 3);
      normals.set(geometry.attributes.normal.array, offset * 3);
      offset += geometry.attributes.position.count;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    return merged;
  }
  buildDecor();

  /* ---------------- incubator pins (instanced, clickable) -------------- */
  let pinCones;
  let pinHeads;
  function buildPins() {
    if (pinCones) {
      scene.remove(pinCones);
      scene.remove(pinHeads);
      pinCones.dispose();
      pinHeads.dispose();
    }
    const coneGeometry = new THREE.ConeGeometry(1.1, 3.1, 10);
    coneGeometry.rotateX(Math.PI); // tip down
    const headGeometry = new THREE.SphereGeometry(1.15, 12, 10);
    const material = new THREE.MeshLambertMaterial();
    pinCones = new THREE.InstancedMesh(coneGeometry, material.clone(), placedIncubators.length);
    pinHeads = new THREE.InstancedMesh(headGeometry, material.clone(), placedIncubators.length);
    pinCones.castShadow = true;
    const matrix = new THREE.Matrix4();
    placedIncubators.forEach((incubator, index) => {
      const ground = groundAt(incubator.x, incubator.y);
      const color = new THREE.Color(palette.orgTypes[typeKeys[incubator.type] || "private"]);
      matrix.makeTranslation(incubator.x, ground + 2, incubator.y);
      pinCones.setMatrixAt(index, matrix);
      pinCones.setColorAt(index, color);
      matrix.makeTranslation(incubator.x, ground + 4.1, incubator.y);
      pinHeads.setMatrixAt(index, matrix);
      pinHeads.setColorAt(index, color);
    });
    scene.add(pinCones);
    scene.add(pinHeads);
  }
  buildPins();

  /* ---------------- avatar ---------------- */
  const avatar = new THREE.Group();
  const avatarParts = {};
  {
    const skin = new THREE.MeshLambertMaterial({ color: new THREE.Color("#9a6238") });
    const shirt = new THREE.MeshLambertMaterial({ color: new THREE.Color("#f3ead2") });
    const shorts = new THREE.MeshLambertMaterial({ color: new THREE.Color("#7a9c53") });
    const straw = new THREE.MeshLambertMaterial({ color: new THREE.Color("#e5c268") });
    const leg = () => {
      const pivot = new THREE.Group();
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.5, 3, 8), skin);
      limb.position.y = -1.05;
      limb.castShadow = true;
      pivot.add(limb);
      pivot.position.y = 2.5;
      return pivot;
    };
    const arm = (side) => {
      const pivot = new THREE.Group();
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 1.35, 3, 8), skin);
      limb.position.y = -0.95;
      limb.castShadow = true;
      pivot.add(limb);
      pivot.position.set(1.05 * side, 4.55, 0);
      pivot.rotation.z = 0.16 * side;
      return pivot;
    };
    avatarParts.leftLeg = leg();
    avatarParts.leftLeg.position.x = -0.42;
    avatarParts.rightLeg = leg();
    avatarParts.rightLeg.position.x = 0.42;
    avatarParts.leftArm = arm(-1);
    avatarParts.rightArm = arm(1);
    const hip = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.72, 1.1, 10), shorts);
    hip.position.y = 2.8;
    hip.castShadow = true;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.82, 1.75, 10), shirt);
    torso.position.y = 4.1;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 12), skin);
    head.position.y = 5.85;
    head.castShadow = true;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.16, 14), straw);
    brim.position.y = 6.4;
    brim.castShadow = true;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.85, 0.65, 12), straw);
    crown.position.y = 6.75;
    crown.castShadow = true;
    avatarParts.body = new THREE.Group();
    avatarParts.body.add(hip, torso, head, brim, crown, avatarParts.leftArm, avatarParts.rightArm);
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 20),
      new THREE.MeshBasicMaterial({ color: 0x1c2a1a, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.06;
    avatar.add(avatarParts.leftLeg, avatarParts.rightLeg, avatarParts.body, blob);
  }
  scene.add(avatar);

  /* ---------------- overlay elements ---------------- */
  const tracked = []; // {el, x, z, lift, range, scaleBias}
  function track(el, x, z, { lift = 0, range = Infinity, scaleBias = 1 } = {}) {
    el.style.left = "0";
    el.style.top = "0";
    const entry = { el, x, z, lift, range, scaleBias, shown: true };
    tracked.push(entry);
    return entry;
  }

  for (const incubator of placedIncubators) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "walkable-org";
    button.dataset.type = typeKeys[incubator.type] || "private";
    button.dataset.state = incubator.region;
    button.dataset.slug = incubator.slug;
    button.setAttribute("aria-label", `${incubator.name}, ${typeLabels[incubator.type] || incubator.type}`);
    button.innerHTML = `${icon(incubator.type)}<span>${escapeHTML(incubator.shortName || incubator.name)}</span>`;
    button.addEventListener("click", () => openState(incubator.region, button, incubator.slug));
    orgLayer.append(button);
    track(button, incubator.x, incubator.y, { lift: 6, range: RANGE.org });
  }

  for (const state of stateRecords) {
    const anchor = stateAnchors[state.state];
    if (!anchor) continue;
    const count = incubators.filter((incubator) => incubator.region === state.state).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `walkable-landmark${count ? "" : " is-empty"}`;
    button.innerHTML = `<span class="walkable-landmark-pin" aria-hidden="true"></span><strong>${escapeHTML(state.state)}</strong><small>${count} incubator${count === 1 ? "" : "s"} · ${state.schemes.length} schemes</small>`;
    button.setAttribute("aria-label", `Open ${state.state}`);
    button.addEventListener("click", () => openState(state.state, button));
    landmarkLayer.append(button);
    track(button, anchor.x, anchor.y, { lift: 8, range: RANGE.landmark, scaleBias: 1.05 });
  }

  for (const sign of signs) {
    const signpost = document.createElement("div");
    signpost.className = "walkable-wayfinder";
    signpost.innerHTML = sign.targets.map((name) => {
      const target = stateAnchors[name];
      const angle = Math.atan2(target.y - sign.y, target.x - sign.x) * 180 / Math.PI;
      return `<button type="button" data-state="${escapeHTML(name)}"><span class="walkable-wayfinder-arrow" style="transform:rotate(${angle}deg)" aria-hidden="true">→</span>${escapeHTML(name)}</button>`;
    }).join("");
    signpost.querySelectorAll("button").forEach((button) =>
      button.addEventListener("click", () => openState(button.dataset.state, button)));
    wayfinderLayer.append(signpost);
    track(signpost, sign.x, sign.y, { lift: 5, range: RANGE.wayfinder });
  }

  for (const transfer of transfers) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "walkable-transfer";
    button.innerHTML = `<span aria-hidden="true">⛴</span><strong>${escapeHTML(transfer.label)}</strong>`;
    button.setAttribute("aria-label", `${transfer.label}. Move avatar to ${transfer.destination}.`);
    button.addEventListener("click", () => travelTo(transfer.destination));
    wayfinderLayer.append(button);
    track(button, transfer.x, transfer.y, { lift: 2.5, range: RANGE.transfer });
  }

  const labelledRelief = relief.filter((region) => region.lx && region.name);
  for (const region of labelledRelief) {
    const label = document.createElement("div");
    label.className = "walkable-terrain-name";
    label.dataset.kind = region.kind;
    label.textContent = region.name;
    labelLayer.append(label);
    track(label, region.lx, region.ly, { lift: 12, range: RANGE.label });
  }
  for (const peak of terrain.peaks || []) {
    const label = document.createElement("div");
    label.className = "walkable-peak";
    label.innerHTML = `<span class="walkable-peak-mark" aria-hidden="true"></span><strong>${escapeHTML(peak.name)}</strong><small>${peak.elevation.toLocaleString("en-IN")} m</small>`;
    labelLayer.append(label);
    track(label, peak.x, peak.y, { lift: 6, range: RANGE.label });
  }

  /* ---------------- minimap ---------------- */
  root.querySelector(".walkable-minimap-map").innerHTML = Object.entries(mapStates).map(([name, shape]) =>
    `<path data-state="${escapeHTML(name)}" d="${shape.d}"></path>`).join("");
  root.querySelectorAll(".walkable-minimap-states button").forEach((button) => {
    const anchor = stateAnchors[button.dataset.state];
    if (!anchor) return;
    button.style.left = `${anchor.x / MAP_WIDTH * 100}%`;
    button.style.top = `${anchor.y / MAP_HEIGHT * 100}%`;
    button.addEventListener("click", () => openState(button.dataset.state, button));
  });

  /* ---------------- state: position, camera, zoom ---------------- */
  let position = { ...stateAnchors["Madhya Pradesh"] };
  let heading = 0; // avatar facing, radians about +y
  let zoom = DEFAULT_ZOOM;
  let azimuth = 0; // camera yaw offset — 0 looks north
  let pitchOffset = 0;
  let nearbyState = "";
  let nearbyIncubator = null;
  let lastTrigger = null;
  let walkPhase = 0;
  const pressed = new Set();
  const cameraPosition = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  {
    const startGround = groundAt(position.x, position.y);
    avatar.position.set(position.x, startGround, position.y);
    const dist = zoomToDistance(zoom, MIN_ZOOM, MAX_ZOOM);
    const pitch = distanceToPitch(dist);
    const offset = cameraOffset(azimuth, pitch, dist);
    cameraTarget.set(position.x, startGround + 5, position.y);
    cameraPosition.set(position.x + offset.x, startGround + offset.y, position.y + offset.z);
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
  }

  function updateNearby() {
    const mapPoint = { x: position.x, y: position.y };
    const currentState = stateRecords.find((state) => containsState(state.state, mapPoint))?.state || "";
    nearbyState = currentState;

    let nearestIncubator = null;
    for (const incubator of placedIncubators) {
      if (incubator.region !== currentState) continue;
      const candidate = { incubator, distance: distance(position, incubator) };
      if (!nearestIncubator || candidate.distance < nearestIncubator.distance) nearestIncubator = candidate;
    }
    const nextIncubator = nearestIncubator && nearestIncubator.distance < NEARBY_RADIUS
      ? nearestIncubator.incubator : null;
    if (nextIncubator?.slug !== nearbyIncubator?.slug) {
      nearbyIncubator = nextIncubator;
      root.querySelectorAll(".walkable-org.is-nearby").forEach((button) => button.classList.remove("is-nearby"));
      if (nearbyIncubator) {
        root.querySelector(`.walkable-org[data-slug="${CSS.escape(nearbyIncubator.slug)}"]`)?.classList.add("is-nearby");
      }
    }
    if (nearbyIncubator) {
      nearbyButton.hidden = false;
      nearbyButton.dataset.kind = "incubator";
      nearbyButton.dataset.state = currentState;
      nearbyButton.innerHTML = `Learn about <strong>${escapeHTML(nearbyIncubator.shortName || nearbyIncubator.name)}</strong><span>Enter</span>`;
      return;
    }
    if (currentState) {
      nearbyButton.hidden = false;
      nearbyButton.dataset.kind = "state";
      nearbyButton.dataset.state = currentState;
      nearbyButton.innerHTML = `Explore <strong>${escapeHTML(currentState)}</strong><span>Enter</span>`;
    } else {
      nearbyButton.hidden = true;
      delete nearbyButton.dataset.kind;
      delete nearbyButton.dataset.state;
    }
  }

  /* ---------------- overlay projection ---------------- */
  const projectVector = new THREE.Vector3();
  let viewWidth = 1;
  let viewHeight = 1;
  function projectOverlay() {
    for (const entry of tracked) {
      const range = Math.hypot(entry.x - position.x, entry.z - position.y);
      let show = range <= entry.range;
      let sx = 0;
      let sy = 0;
      let scale = 1;
      if (show) {
        projectVector.set(entry.x, groundAt(entry.x, entry.z) + entry.lift, entry.z);
        projectVector.project(camera);
        if (projectVector.z >= 1 ||
            projectVector.x < -1.15 || projectVector.x > 1.15 ||
            projectVector.y < -1.2 || projectVector.y > 1.25) {
          show = false;
        } else {
          sx = (projectVector.x * 0.5 + 0.5) * viewWidth;
          sy = (-projectVector.y * 0.5 + 0.5) * viewHeight;
          const cameraDistance = camera.position.distanceTo(
            projectVector.set(entry.x, groundAt(entry.x, entry.z), entry.z));
          scale = Math.min(1.15, Math.max(0.5, 62 / cameraDistance)) * entry.scaleBias;
        }
      }
      if (show) {
        entry.el.style.transform =
          `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
        // z-order: nearer overlays paint above farther ones.
        entry.el.style.zIndex = `${Math.max(1, Math.round(1400 - entry.z + position.y))}`;
      }
      if (show !== entry.shown) {
        entry.shown = show;
        entry.el.classList.toggle("is-offstage", !show);
      }
    }
  }

  /* ---------------- frame loop ---------------- */
  const clock = new THREE.Clock();
  function frame() {
    const elapsed = Math.min(0.05, clock.getDelta());
    const time = clock.elapsedTime;

    let movement;
    if (stickDelta.x || stickDelta.y) {
      /* Thumbstick input is camera-relative — pushing up walks away from the
         camera, matching what the thumb sees — while keys and the D-pad stay
         compass-locked. Deflection under full throw walks proportionally
         slower, which is what makes a stick feel analog. */
      const forwardX = -Math.sin(azimuth);
      const forwardZ = -Math.cos(azimuth);
      movement = normalizeMovement(
        -forwardZ * stickDelta.x - forwardX * stickDelta.y,
        forwardX * stickDelta.x - forwardZ * stickDelta.y,
      );
    } else {
      const horizontal = (pressed.has("right") ? 1 : 0) - (pressed.has("left") ? 1 : 0);
      const vertical = (pressed.has("down") ? 1 : 0) - (pressed.has("up") ? 1 : 0);
      movement = normalizeMovement(horizontal, vertical);
    }
    const moving = (movement.x || movement.y) && drawer.hidden;
    if (moving) {
      const next = {
        x: position.x + movement.x * AVATAR_SPEED * elapsed,
        y: position.y + movement.y * AVATAR_SPEED * elapsed,
      };
      if (containsLand(next)) {
        position = next;
      } else if (containsLand({ x: next.x, y: position.y })) {
        position = { ...position, x: next.x }; // slide along the coast
      } else if (containsLand({ x: position.x, y: next.y })) {
        position = { ...position, y: next.y };
      }
      heading = lerpAngle(heading, Math.atan2(movement.x, movement.y),
        motionOK ? damp(12, elapsed) : 1);
      walkPhase += elapsed * 9 * Math.min(1, Math.hypot(movement.x, movement.y) + 0.25);
    }

    const ground = groundAt(position.x, position.y);
    avatar.position.set(position.x, ground, position.y);
    avatar.rotation.y = heading;
    if (motionOK) {
      const swing = moving ? Math.sin(walkPhase) * 0.55 : 0;
      avatarParts.leftLeg.rotation.x = swing;
      avatarParts.rightLeg.rotation.x = -swing;
      avatarParts.leftArm.rotation.x = -swing * 0.8;
      avatarParts.rightArm.rotation.x = swing * 0.8;
      avatarParts.body.position.y = moving
        ? Math.abs(Math.sin(walkPhase)) * 0.18
        : Math.sin(time * 1.8) * 0.05;
    }

    const dist = zoomToDistance(zoom, MIN_ZOOM, MAX_ZOOM);
    const pitch = Math.min(1.25, Math.max(0.16, distanceToPitch(dist) + pitchOffset));
    const offset = cameraOffset(azimuth, pitch, dist);
    cameraTarget.set(position.x, ground + 5, position.y);
    const desired = new THREE.Vector3(
      position.x + offset.x, ground + offset.y, position.y + offset.z);
    // Never sink the camera into a mountainside.
    desired.y = Math.max(desired.y, groundAt(desired.x, desired.z) + 3);
    const follow = motionOK ? damp(4.5, elapsed) : 1;
    cameraPosition.lerp(desired, follow);
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);

    sun.position.set(position.x - 160, 260, position.y + 120);
    sun.target.position.set(position.x, 0, position.y);

    if (motionOK) {
      seaNormalTexture.offset.set(time * 0.008, time * 0.011);
      for (const cloud of clouds) {
        cloud.position.x += cloud.userData.speed * elapsed;
        if (cloud.position.x > 1900) cloud.position.x = -750;
      }
    }

    updateNearby();
    projectOverlay();
    minimapDot.style.left = `${position.x / MAP_WIDTH * 100}%`;
    minimapDot.style.top = `${position.y / MAP_HEIGHT * 100}%`;

    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  /* ---------------- resize ---------------- */
  function resize() {
    viewWidth = viewport.clientWidth;
    viewHeight = viewport.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(viewWidth, viewHeight);
    camera.aspect = viewWidth / Math.max(1, viewHeight);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  /* ---------------- zoom & camera controls ---------------- */
  function setZoom(nextZoom) {
    zoom = clampZoom(nextZoom);
    root.dataset.detail = zoom >= DETAIL_ZOOM ? "on" : "off";
    zoomLevel.value = `${Math.round(zoom * 100)}%`;
    zoomLevel.textContent = zoomLevel.value;
    zoomIn.disabled = zoom >= MAX_ZOOM;
    zoomOut.disabled = zoom <= MIN_ZOOM;
    zoomReset.disabled = zoom === DEFAULT_ZOOM;
  }
  zoomIn.addEventListener("click", () => setZoom(zoom + ZOOM_STEP));
  zoomOut.addEventListener("click", () => setZoom(zoom - ZOOM_STEP));
  zoomReset.addEventListener("click", () => setZoom(DEFAULT_ZOOM));
  recenter.addEventListener("click", () => {
    pressed.clear();
    azimuth = 0;
    pitchOffset = 0;
  });

  /* Pointer input, by device:
     - touch: a floating thumbstick — the base circle spawns under the finger,
       the drag deflection (÷75px, length-clamped to 1) walks the avatar at
       analog speed relative to the camera. A second finger pinch-zooms and
       lets the stick go; a tap without a drag is a click.
     - mouse: drag orbits the camera; a short press-and-release is a click
       (pin raycast / open the state under the cursor). */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const stickElement = viewport.querySelector(".walkable-stick");
  const stickKnob = viewport.querySelector(".walkable-stick-knob");
  const STICK_RADIUS = 75;
  const STICK_KNOB_TRAVEL = 36;
  const stickDelta = { x: 0, y: 0 };
  let stickPointer = null;
  let stickOrigin = { x: 0, y: 0 };
  let stickMoved = false;
  let dragPointer = null;
  let dragMoved = false;
  let dragLast = { x: 0, y: 0 };
  const touchPoints = new Map();
  let pinchDistance = 0;
  let pinchZoom = 1;

  function placeStickKnob() {
    stickKnob.style.transform =
      `translate(${(stickDelta.x * STICK_KNOB_TRAVEL).toFixed(1)}px, ${(stickDelta.y * STICK_KNOB_TRAVEL).toFixed(1)}px)`;
  }
  function startStick(event) {
    stickPointer = event.pointerId;
    stickMoved = false;
    stickOrigin = { x: event.clientX, y: event.clientY };
    const rect = viewport.getBoundingClientRect();
    stickElement.style.left = `${event.clientX - rect.left}px`;
    stickElement.style.top = `${event.clientY - rect.top}px`;
    stickElement.dataset.active = "true";
    placeStickKnob();
  }
  function moveStick(event) {
    const dx = event.clientX - stickOrigin.x;
    const dy = event.clientY - stickOrigin.y;
    const pixels = Math.hypot(dx, dy);
    if (pixels > 7) stickMoved = true;
    const scale = pixels > STICK_RADIUS ? 1 / pixels : 1 / STICK_RADIUS;
    stickDelta.x = dx * scale;
    stickDelta.y = dy * scale;
    placeStickKnob();
  }
  function endStick() {
    if (stickPointer === null) return;
    stickPointer = null;
    stickDelta.x = 0;
    stickDelta.y = 0;
    delete stickElement.dataset.active;
    placeStickKnob();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size === 2) {
        const [first, second] = [...touchPoints.values()];
        pinchDistance = Math.hypot(second.x - first.x, second.y - first.y);
        pinchZoom = zoom;
        endStick();
        return;
      }
      if (touchPoints.size === 1) {
        startStick(event);
        try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
      }
      return;
    }
    dragPointer = event.pointerId;
    dragMoved = false;
    dragLast = { x: event.clientX, y: event.clientY };
    try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") {
      if (!touchPoints.has(event.pointerId)) return;
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size === 2 && pinchDistance) {
        event.preventDefault();
        const [first, second] = [...touchPoints.values()];
        setZoom(pinchZoom * Math.hypot(second.x - first.x, second.y - first.y) / pinchDistance);
        return;
      }
      if (event.pointerId === stickPointer) {
        event.preventDefault();
        moveStick(event);
      }
      return;
    }
    if (event.pointerId !== dragPointer) return;
    const dx = event.clientX - dragLast.x;
    const dy = event.clientY - dragLast.y;
    if (dragMoved || Math.hypot(dx, dy) > 4) {
      dragMoved = true;
      azimuth -= dx * 0.0055;
      pitchOffset = Math.min(0.5, Math.max(-0.45, pitchOffset + dy * 0.0035));
      dragLast = { x: event.clientX, y: event.clientY };
    }
  });
  const endPointer = (event) => {
    touchPoints.delete(event.pointerId);
    if (touchPoints.size < 2) pinchDistance = 0;
    if (event.pointerId === stickPointer) {
      if (!stickMoved) clickScene(event);
      endStick();
      return;
    }
    if (event.pointerId !== dragPointer) return;
    dragPointer = null;
    if (!dragMoved) clickScene(event);
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  /* All canvas interaction is pointer-driven, so the compatibility mouse
     events a touch tap synthesizes are pure hazard: by the time they fire,
     a drawer opened by that same tap sits under the finger, and the
     synthetic click would land on its backdrop and close it again. */
  canvas.addEventListener("touchend", (event) => event.preventDefault(), { passive: false });
  function clickScene(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([pinHeads, pinCones]);
    if (hits.length) {
      const incubator = placedIncubators[hits[0].instanceId];
      if (incubator) openState(incubator.region, canvas, incubator.slug);
      return;
    }
    const groundHits = raycaster.intersectObject(terrainMesh);
    if (groundHits.length) {
      const point = groundHits[0].point;
      const target = { x: point.x, y: point.z };
      const state = stateRecords.find((record) => containsState(record.state, target))?.state;
      if (state) openState(state, canvas);
    }
  }
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoom(zoom - event.deltaY * (event.ctrlKey ? 0.004 : 0.0016));
  }, { passive: false });

  /* ---------------- keyboard & D-pad ---------------- */
  function setDirection(direction, on) {
    on ? pressed.add(direction) : pressed.delete(direction);
  }
  function travelTo(stateName) {
    const destination = stateAnchors[stateName];
    if (!destination) return;
    pressed.clear();
    position = { ...destination };
    cameraPosition.set(0, 0, 0); // forces the lerp to snap next frame
    const ground = groundAt(position.x, position.y);
    const dist = zoomToDistance(zoom, MIN_ZOOM, MAX_ZOOM);
    const offset = cameraOffset(azimuth, distanceToPitch(dist), dist);
    cameraPosition.set(position.x + offset.x, ground + offset.y, position.y + offset.z);
  }
  const keyDirection = {
    ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right",
  };
  window.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && nearbyState && drawer.hidden && !/^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(document.activeElement?.tagName || "")) {
      event.preventDefault();
      openState(nearbyState, nearbyButton, nearbyIncubator?.region === nearbyState ? nearbyIncubator.slug : "");
      return;
    }
    if ((event.key === "q" || event.key === "Q") && drawer.hidden) { azimuth += 0.14; return; }
    if ((event.key === "e" || event.key === "E") && drawer.hidden) { azimuth -= 0.14; return; }
    const direction = keyDirection[event.key];
    if (!direction || !drawer.hidden || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
    event.preventDefault();
    setDirection(direction, true);
  });
  window.addEventListener("keyup", (event) => {
    const direction = keyDirection[event.key];
    if (direction) setDirection(direction, false);
  });
  window.addEventListener("blur", () => pressed.clear());
  document.addEventListener("visibilitychange", () => { if (document.hidden) pressed.clear(); });
  root.querySelectorAll(".walkable-dpad button").forEach((button) => {
    const release = () => setDirection(button.dataset.direction, false);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      setDirection(button.dataset.direction, true);
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  });

  /* ---------------- state drawer (as on the 2D map) ---------------- */
  function incubatorRow(incubator, focused) {
    const key = typeKeys[incubator.type] || "private";
    const content = `<span class="walkable-drawer-icon">${icon(incubator.type)}</span>
      <span><strong>${escapeHTML(incubator.name)}</strong><small>${escapeHTML(typeLabels[incubator.type] || incubator.type)}${incubator.city ? ` · ${escapeHTML(incubator.city)}` : ""}</small></span>
      <span aria-hidden="true">${incubator.website ? "↗" : ""}</span>`;
    return incubator.website
      ? `<a class="walkable-drawer-org${focused ? " is-focused" : ""}" href="${escapeHTML(incubator.website)}" target="_blank" rel="noopener" data-type="${key}">${content}</a>`
      : `<div class="walkable-drawer-org${focused ? " is-focused" : ""}" data-type="${key}">${content}</div>`;
  }

  function renderDrawer(stateName, focusedSlug = "") {
    const state = stateMeta[stateName];
    const local = incubators.filter((incubator) => incubator.region === stateName);
    const counts = Object.entries(local.reduce((all, incubator) => {
      all[incubator.type] = (all[incubator.type] || 0) + 1;
      return all;
    }, {})).sort((a, b) => b[1] - a[1]);
    drawerTitle.textContent = stateName;
    drawerBody.innerHTML = `
      ${state?.policy ? `<p class="walkable-drawer-policy">${escapeHTML(state.policy)}${state.period ? ` · ${escapeHTML(state.period)}` : ""}</p>` : ""}
      <p class="walkable-drawer-description">${escapeHTML(state?.summary || "Explore this state or union territory’s incubators and startup support.")}</p>
      <div class="walkable-drawer-stats">
        <span>${local.length} incubator${local.length === 1 ? "" : "s"}</span>
        <span>${state?.schemes?.length || 0} state scheme${state?.schemes?.length === 1 ? "" : "s"}</span>
        ${counts.map(([type, count]) => `<span data-type="${typeKeys[type]}">${icon(type)}${escapeHTML(typeLabels[type] || type)} · ${count}</span>`).join("")}
      </div>
      <div class="walkable-drawer-filters">
        <label><span>Search this state</span><input id="walkable-state-search" type="search" placeholder="Incubator name or city…"></label>
        <label><span>Incubator type</span><select id="walkable-state-type"><option value="">All types</option>${counts.map(([type]) => `<option value="${escapeHTML(type)}">${escapeHTML(typeLabels[type] || type)}</option>`).join("")}</select></label>
      </div>
      <div class="walkable-drawer-list" id="walkable-state-list">${local.length ? local.map((incubator) => incubatorRow(incubator, incubator.slug === focusedSlug)).join("") : `<p class="walkable-drawer-empty">No incubators are currently listed for this state or UT.</p>`}</div>
      <div class="walkable-drawer-links">
        <a class="btn btn-primary" href="incubators.html?state=${encodeURIComponent(stateName)}&view=map">Open incubator map</a>
        <a class="btn btn-ghost" href="state-schemes.html?state=${encodeURIComponent(stateName)}&view=map">View state schemes</a>
      </div>`;
    const search = drawerBody.querySelector("#walkable-state-search");
    const type = drawerBody.querySelector("#walkable-state-type");
    const list = drawerBody.querySelector("#walkable-state-list");
    const filter = () => {
      const query = search.value.trim().toLowerCase();
      const filtered = local.filter((incubator) =>
        (!type.value || incubator.type === type.value) &&
        (!query || `${incubator.name} ${incubator.host || ""} ${incubator.city || ""}`.toLowerCase().includes(query)));
      list.innerHTML = filtered.length
        ? filtered.map((incubator) => incubatorRow(incubator, incubator.slug === focusedSlug)).join("")
        : `<p class="walkable-drawer-empty">No incubators match those filters.</p>`;
    };
    search.addEventListener("input", filter);
    type.addEventListener("change", filter);
  }

  function openState(stateName, trigger, focusedSlug = "") {
    if (!stateMeta[stateName]) return;
    lastTrigger = trigger || document.activeElement;
    pressed.clear();
    renderDrawer(stateName, focusedSlug);
    drawer.hidden = false;
    document.body.classList.add("walkable-drawer-open");
    root.querySelectorAll(".walkable-minimap-states button").forEach((button) =>
      button.classList.toggle("is-active", button.dataset.state === stateName));
    drawerClose.focus();
    if (focusedSlug) requestAnimationFrame(() => drawerBody.querySelector(".is-focused")?.scrollIntoView({ block: "center" }));
  }
  function closeDrawer() {
    if (drawer.hidden) return;
    drawer.hidden = true;
    document.body.classList.remove("walkable-drawer-open");
    root.querySelectorAll(".walkable-minimap-states button").forEach((button) => button.classList.remove("is-active"));
    lastTrigger?.focus?.();
  }
  nearbyButton.addEventListener("click", () => {
    if (nearbyState) openState(nearbyState, nearbyButton, nearbyIncubator?.region === nearbyState ? nearbyIncubator.slug : "");
  });
  drawerClose.addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);
  drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = [...drawerPanel.querySelectorAll('button, a, input, select, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.disabled);
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  help.addEventListener("click", () => root.querySelector(".walkable-intro").classList.toggle("is-open"));
  root.querySelector("#walkable-intro-close").addEventListener("click", () => root.querySelector(".walkable-intro").classList.remove("is-open"));

  /* ---------------- theme switching ---------------- */
  function applyPalette() {
    palette = readPalette();
    paintGround();
    groundTexture.needsUpdate = true;
    skyUniforms.topColor.value.set(palette.skyTop);
    skyUniforms.horizonColor.value.set(palette.skyHorizon);
    scene.fog.color.set(palette.fog);
    hemisphere.color.set(palette.skyHorizon);
    hemisphere.groundColor.set(palette.land);
    hemisphere.intensity = palette.dark ? 1.9 : 1.15;
    sun.color.set(palette.sun);
    sun.intensity = palette.dark ? 2.6 : 2.3;
    seaMaterial.color.set(palette.sea);
    seaMaterial.specular.set(palette.sun);
    for (const cloud of clouds) cloud.material.color.set(palette.cloud);
    buildDecor();
    buildPins();
  }
  const themeObserver = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.attributeName === "data-theme")) applyPalette();
  });
  themeObserver.observe(document.documentElement, { attributes: true });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyPalette);

  /* ---------------- go ---------------- */
  setZoom(DEFAULT_ZOOM);
  updateNearby();
}
