#!/usr/bin/env node
/* ============================================================
   build.mjs — generates the static documentation site into docs/
   from data/*.json + site/ (tokens.css, site.css, site.js).

   Zero dependencies. Node >= 18.      Usage:  node build.mjs

   Contract (mirrors site2deck's philosophy):
   - docs/ is GENERATED — never hand-edit it; edit data/ or site/.
   - The build FAILS LOUDLY on broken cross-references, missing
     fields, duplicate slugs, or unresolvable scheme names.
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, "data");
const SITE = join(ROOT, "site");
const OUT = join(ROOT, "docs");

/* site.config.json — the template knobs: where the site is hosted and what
   it is called. Everything else is content (data/) or skin (site/). */
const CONFIG = existsSync(join(ROOT, "site.config.json"))
  ? JSON.parse(readFileSync(join(ROOT, "site.config.json"), "utf8"))
  : {};
const SITE_NAME = CONFIG.siteName || "Startup USA Guide";
const SITE_BASE = CONFIG.siteBase || "https://fluteninja.github.io/startup-usa-guide/"; // sitemap + og
const PATH_PREFIX = CONFIG.pathPrefix ?? "/startup-usa-guide/"; // 404 page absolute links
const REPO_URL = CONFIG.repo || "https://github.com/Fluteninja/startup-usa-guide";

/* ---------------- utilities ---------------- */
const readJSON = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const attr = esc;
const slugify = (s) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const paras = (t) => String(t ?? "").split(/\n{2,}|\r\n\r\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("\n");

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

/* ---------------- load data ---------------- */
const schemes = readJSON("schemes.json").schemes;
const tree = readJSON("decision-tree.json");
const needs = readJSON("needs-index.json");
const lifecycle = readJSON("lifecycle.json");
const about = readJSON("about.json");
const psu = readJSON("psu.json");
const states = readJSON("states.json");
const immigration = readJSON("immigration.json");
const glossary = readJSON("glossary.json");
const incubators = readJSON("incubators.json");
const indiaMap = readJSON("usa-map.json");
/* Relief, rivers, lakes and peaks for the walkable map only. The incubator and
   state-scheme maps are choropleths — they encode counts as fill colour, and a
   terrain tint underneath would corrupt that reading. Built by
   scripts/build-usa-terrain.mjs from Natural Earth, scoped to the same 48
   contiguous states + DC as usa-map.json. */
const indiaTerrain = readJSON("usa-terrain.json");
const stateSchemes = readJSON("state-schemes.json");

/* ---- external news (optional): a vetted feed powering the overview ticker.
   data/news.json is a flat array of { title, url, source, date }. If the file
   is absent or empty, the ticker is simply omitted from the build. */
const news = (() => {
  if (!existsSync(join(DATA, "news.json"))) return [];
  try {
    const raw = JSON.parse(readFileSync(join(DATA, "news.json"), "utf8"));
    return Array.isArray(raw)
      ? raw.filter((n) => n && n.title && n.url).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      : [];
  } catch { return []; }
})();
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const tickerItem = (n) => `<a class="ticker-item" href="${attr(n.url)}" target="_blank" rel="noopener"><span class="ti-src">${esc(n.source || hostOf(n.url))}</span><span class="ti-title">${esc(n.title)}</span></a>`;
const NEWS_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtNewsDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${NEWS_MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ""; };
const newsSlug = (n) => (n.id || "n-" + hostOf(n.url) + "-" + (n.date || "")).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
const newsCard = (n) => `
  <article class="news-card" id="${newsSlug(n)}">
    <div class="nc-head">
      <span class="nc-src">${esc(n.source || hostOf(n.url))}</span>
      ${n.date ? `<time class="nc-date" datetime="${attr(n.date)}">${esc(fmtNewsDate(n.date))}</time>` : ""}
    </div>
    <h3 class="nc-title"><a href="${attr(n.url)}" target="_blank" rel="noopener">${esc(n.title)} ${ICONS.external}</a></h3>
    ${n.summary ? `<p class="nc-summary">${esc(n.summary)}</p>` : ""}
    <div class="nc-foot">${(n.tags || []).map((t) => `<span class="nc-tag">${esc(t)}</span>`).join("")}<span class="nc-host">${esc(hostOf(n.url))}</span></div>
  </article>`;

/* ---------------- taxonomy labels ---------------- */
const CAT_LABEL = { grant: "Grant", equity: "Equity", "loan-credit": "Loan / Credit", incubation: "Incubation", "market-access": "Market Access", mixed: "Mixed", other: "Other" };
const CAT_DESC = {
  grant: "Funding with no repayment and no equity given up",
  equity: "Investment in exchange for a stake in your startup",
  "loan-credit": "Repayable loans or credit guarantees to access debt",
  incubation: "Labs, workspace, mentoring and ecosystem support",
  "market-access": "Pathways to sell, export, or access procurement",
  mixed: "A combination of support types",
  other: "Other support mechanisms",
};
const STAGE_LABEL = { ideation: "Ideation", prototype: "Prototype / PoC", "early-stage": "Seed / Early-Stage", growth: "Growth / Scaling", "market-access": "Market Access & IP" };
const STAGE_DESC = {
  ideation: "You have an idea but no prototype or product yet",
  prototype: "Idea validated; building or testing a prototype",
  "early-stage": "Prototype done; entering market or scaling pilot",
  growth: "Product in market; scaling operations and team",
  "market-access": "Ready to sell, export or protect your innovation",
};
const SECTOR_LABEL = {
  "sector-agnostic": "Sector-agnostic", "agriculture-food": "Agriculture & Food", "biotech-health-pharma": "Biotech, Health & Pharma",
  defense: "Defense & Aerospace", space: "Space", "semiconductor-electronics": "Semiconductors & Electronics", quantum: "Quantum Technology",
  "it-software-deeptech": "IT, Software & Deep Tech", telecom: "Telecom", manufacturing: "Manufacturing", "mining-metals": "Mining & Metals",
  fintech: "Fintech", "food-processing": "Food Processing", "energy-cleantech": "Energy & Clean Tech", "social-impact": "Social Impact",
  "education-research": "Education & Research", trade: "Trade & Export", biotech: "Biotech",
};
const AUD_LABEL = {
  "aspiring-founders": "Aspiring founders", "sam-registered": "SAM.gov-registered businesses", "early-stage-startups": "Early-stage startups",
  "growth-startups": "Growth-stage startups", students: "Students", researchers: "Researchers", "small-businesses": "Small businesses",
  "incubators-institutions": "Incubators & institutions", "women-owned-businesses": "Women-owned businesses", "minority-owned-businesses": "Minority-owned businesses",
  "veteran-owned-businesses": "Veteran-owned businesses", "rural-businesses": "Rural businesses", "immigrant-founders": "Immigrant founders",
};

/* ---------------- icons (lucide-style, stroke=currentColor) ---------------- */
const I = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const ICONS = {
  search: I('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/>'),
  moon: I('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  chevron: I('<path d="m9 6 6 6-6 6"/>', ' class="chev"'),
  arrow: I('<path d="M5 12h14m-6-6 6 6-6 6"/>'),
  check: I('<path d="M20 6 9 17l-5-5"/>'),
  gift: I('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13m-7-9v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>'),
  external: I('<path d="M15 3h6v6m0-6L10 14M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  compass: I('<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.3 6.1-6.1 2.3 2.3-6.1z"/>'),
  map: I('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14"/>'),
  layers: I('<path d="m12 2 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5"/>'),
  scale: I('<path d="M12 3v18M8 21h8M7 7 3 12h8L7 7Zm10 0-4 5h8l-4-5Z"/><path d="M3 12a4 4 0 0 0 8 0m2 0a4 4 0 0 0 8 0"/>'),
  target: I('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
  users: I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  file: I('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6"/>'),
  link: I('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  book: I('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
  building: I('<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/>'),
  flag: I('<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 8 2a6 6 0 0 0 3-.7V14a6 6 0 0 1-3 .7c-3 0-5-2-8-2a6 6 0 0 0-4 1.4"/>'),
  grid: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  info: I('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>'),
  rocket: I('<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2-.7-3-.2Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.9 7.4-6 11a22 22 0 0 1-4 2Z"/><path d="M9 12H4s.6-3.3 2-4c1.6-.9 5 0 5 0m0 7v5s3.3-.6 4-2c.9-1.6 0-5 0-5"/>'),
  sprout: I('<path d="M12 20v-8m0 0S9 4 3 4c0 6 5 8 9 8Zm0-3s2-6 9-6c0 5-4 7-9 7"/>'),
  clipboard: I('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 13 2 2 4-4"/>'),
  send: I('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
  up: I('<path d="m18 15-6-6-6 6"/>'),
  banknote: I('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'),
  chart: I('<path d="M3 3v18h18"/><path d="M7 15v-4m5 4V8m5 7v-6"/>'),
  ip: I('<circle cx="12" cy="12" r="10"/><path d="M9 8h1v8H9m4-8h2.5a2 2 0 0 1 0 4.5H13V8Zm0 4.5V16"/>'),
  download: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5m-5 5V3"/>'),
  pin: I('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
  phone: I('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z"/>'),
  mail: I('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
  globe: I('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z"/>'),
  news: I('<path d="M4 22h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z"/>'),
  close: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  list: I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
};

/* ---------------- normalize & index schemes ---------------- */
const seenSlugs = new Set();
for (const s of schemes) {
  if (seenSlugs.has(s.slug)) fail(`duplicate slug: ${s.slug}`);
  seenSlugs.add(s.slug);
  if (s.shortName && s.name.endsWith(`(${s.shortName})`)) s.name = s.name.slice(0, -`(${s.shortName})`.length).trim();
  for (const field of ["name", "ministry", "tagline", "whatIsThis", "objectives", "howToApply", "bestSuitedFor"])
    if (!s[field] || !String(s[field]).trim()) fail(`${s.slug}: missing ${field}`);
  if (!s.eligibility?.length) fail(`${s.slug}: no eligibility bullets`);
  if (!s.benefits?.length) fail(`${s.slug}: no benefit bullets`);
  for (const l of s.links || []) if (!/^https?:\/\//.test(l.url)) fail(`${s.slug}: bad link url ${l.url}`);
  if (!s.category) s.category = s.supportTypes?.length === 1 ? s.supportTypes[0] : "mixed";
  if (!CAT_LABEL[s.category]) fail(`${s.slug}: unknown category ${s.category}`);
  for (const st of s.stages || []) if (!STAGE_LABEL[st]) fail(`${s.slug}: unknown stage ${st}`);
  for (const sec of s.sectors || []) if (!SECTOR_LABEL[sec]) fail(`${s.slug}: unknown sector ${sec}`);
}
schemes.sort((a, b) => a.page - b.page);
const partA = schemes.filter((s) => s.part === "A");
const partB = schemes.filter((s) => s.part === "B");

/* ---------------- scheme-name resolver ---------------- */
const norm = (s) => s.toLowerCase().replace(/[’'".]/g, "").replace(/&/g, "and").replace(/[–—]/g, "-").replace(/[^a-z0-9]+/g, " ").trim();
const lookup = new Map();
const addKey = (k, s) => { const n = norm(k); if (!n) return; if (!lookup.has(n)) lookup.set(n, s); };
for (const s of schemes) {
  addKey(s.name, s);
  if (s.shortName) addKey(s.shortName, s);
  addKey(s.slug.replace(/-/g, " "), s);
  addKey(`${s.name} ${s.shortName}`, s);
}
const ALIASES = readJSON("aliases.json"); // { "printed name": "slug" }
for (const [alias, slug] of Object.entries(ALIASES)) {
  const s = schemes.find((x) => x.slug === slug);
  if (!s) fail(`aliases.json: unknown slug ${slug} for "${alias}"`);
  else addKey(alias, s);
}
function resolveScheme(printed, context) {
  let name = printed.trim();
  let qual = "";
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const direct = lookup.get(norm(name));
  if (direct) return { name: printed.trim(), qual: "", scheme: direct };
  if (m) {
    const base = lookup.get(norm(m[1]));
    if (base) return { name: m[1].trim(), qual: `(${m[2]})`, scheme: base };
  }
  // trailing qualifier without parens, e.g. "iDEX Prime", "NQM Startup Support"
  const words = name.split(/\s+/);
  for (let cut = words.length - 1; cut >= 1; cut--) {
    const head = lookup.get(norm(words.slice(0, cut).join(" ")));
    if (head) return { name: words.slice(0, cut).join(" "), qual: words.slice(cut).join(" "), scheme: head };
  }
  fail(`unresolvable scheme reference "${printed}" (${context}) — add it to data/aliases.json`);
  return { name: printed, qual: "", scheme: null };
}
const resolveList = (list, context) => (list || []).map((n) => {
  const r = resolveScheme(n, context);
  return { name: r.name, qual: r.qual, slug: r.scheme?.slug ?? null, category: r.scheme?.category ?? "other", full: r.scheme?.name ?? "", tagline: r.scheme?.tagline ?? "" };
});

/* resolve nav structures */
const treeResolved = {
  intro: tree.intro,
  questions: tree.questions.map((q) => ({
    id: q.id, question: q.question,
    branches: q.branches.map((b) => ({ label: b.label, note: b.note || "", schemes: resolveList(b.schemes, `decision-tree Q${q.id} "${b.label}"`) })),
  })),
};
const needsResolved = {
  intro: needs.intro,
  rows: needs.rows.map((r) => ({
    need: r.need, needNote: r.needNote || "",
    startupSpecific: resolveList(r.startupSpecific, `needs-index "${r.need}"`),
    startupRelevant: resolveList(r.startupRelevant, `needs-index "${r.need}"`),
  })),
};
const lifecycleResolved = {
  intro: lifecycle.intro,
  stages: lifecycle.stages.map((st) => ({
    ...st,
    specific: resolveList(st.specific, `lifecycle "${st.title}"`),
    relevant: resolveList(st.relevant, `lifecycle "${st.title}"`),
  })),
};

/* ---------------- fail loudly before writing anything ---------------- */
if (errors.length) {
  console.error(`\n✗ BUILD FAILED — ${errors.length} error(s):\n`);
  for (const e of errors) console.error("  • " + e);
  process.exit(1);
}

/* ---------------- shared shell ---------------- */
const NAV_PAGES = [
  { group: "Get oriented", items: [
    { href: "index.html", title: "Overview", icon: "flag" },
    { href: "finder.html", title: "Scheme Finder", icon: "compass" },
    { href: "lifecycle.html", title: "Lifecycle Map", icon: "sprout" },
    { href: "needs.html", title: "What do you need?", icon: "target" },
  ]},
  { group: "Browse", items: [
    { href: "directory.html", title: "All schemes", icon: "grid" },
    { href: "compare.html", title: "Compare schemes", icon: "scale" },
  ]},
  { group: "Beyond federal schemes", items: [
    { href: "ecosystem-map.html", title: "Explore the USA map", icon: "compass" },
    { href: "state-schemes.html", title: "State schemes", icon: "layers" },
    { href: "incubators.html", title: "Incubators directory", icon: "pin" },
    { href: "psu.html", title: "Federal innovation programs", icon: "building" },
    { href: "states.html", title: "State portals", icon: "map" },
    { href: "immigration.html", title: "Visas & Immigration", icon: "globe" },
  ]},
  { group: "Reference", items: [
    { href: "glossary.html", title: "Glossary", icon: "book" },
    { href: "about.html", title: "About & disclaimer", icon: "info" },
  ]},
];

const sidebar = (root, active) => {
  const link = (href, title, icon) =>
    `<a class="nav-link" href="${root}${href}"${active === href ? ' aria-current="page"' : ""}>${icon ? `<span class="card-icon" style="width:22px;height:22px;border-radius:6px;background:transparent;color:var(--text-faint)">${ICONS[icon].replace('aria-hidden="true"', 'aria-hidden="true" width="15" height="15"')}</span>` : ""}${esc(title)}</a>`;
  const schemeLink = (s) =>
    `<a class="nav-link" href="${root}schemes/${s.slug}.html"${active === `schemes/${s.slug}.html` ? ' aria-current="page"' : ""}><span class="cat-dot" style="background:var(--cat-${s.category === "loan-credit" ? "loan" : s.category === "market-access" ? "market" : s.category})"></span>${esc(s.shortName || s.name)}</a>`;
  const groups = NAV_PAGES.map((g) => `
    <div class="sidebar-group">
      <div class="sidebar-title">${esc(g.group)}</div>
      ${g.items.map((it) => link(it.href, it.title, it.icon)).join("\n")}
      ${g.group === "Browse" ? `
      <details${active.startsWith("schemes/") && partA.some((s) => `schemes/${s.slug}.html` === active) ? " open" : ""}>
        <summary><span class="sum-label">Part A · Startup-specific</span> <span class="count-pill">${partA.length}</span> ${ICONS.chevron}</summary>
        <div>${partA.map(schemeLink).join("\n")}</div>
      </details>
      <details${active.startsWith("schemes/") && partB.some((s) => `schemes/${s.slug}.html` === active) ? " open" : ""}>
        <summary><span class="sum-label">Part B · Startup-relevant</span> <span class="count-pill">${partB.length}</span> ${ICONS.chevron}</summary>
        <div>${partB.map(schemeLink).join("\n")}</div>
      </details>` : ""}
    </div>`).join("\n");
  return `<nav class="sidebar" id="sidebar" aria-label="Site navigation">${groups}</nav>`;
};

const themeBoot = `<script>(function(){var t;try{t=localStorage.getItem("usa-guide-theme")}catch(e){}
if(t!=="light"&&t!=="dark"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}
document.documentElement.setAttribute("data-theme",t);
try{if(localStorage.getItem("rail-collapsed")==="1")document.documentElement.classList.add("rail-collapsed")}catch(e){}})();</script>`;

/* Google Analytics 4 (gtag.js). Measurement ID lives in site.config.json
   (analyticsId); omit it there to build the site without the tag. */
const GA_MEASUREMENT_ID = CONFIG.analyticsId || "";
const analyticsTag = GA_MEASUREMENT_ID
  ? `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GA_MEASUREMENT_ID}');
</script>`
  : "";

const brandParts = SITE_NAME.split(" ");
const brandMain = brandParts.length > 1 ? brandParts.slice(0, -1).join(" ") : SITE_NAME;
const brandThin = brandParts.length > 1 ? brandParts[brandParts.length - 1] : "";

function shell({ root, active, title, description, body, extraHead = "", pageClass = "", toc = "", immersive = false }) {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : `${SITE_NAME} — Federal & State Funding for US Startups`;
  return `<!doctype html>
<html lang="en" data-root="${root}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${analyticsTag}
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#1f3864">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${attr(SITE_NAME)}">
<meta property="og:image" content="${SITE_BASE}assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="${root}assets/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
${themeBoot}
<link rel="stylesheet" href="${root}assets/tokens.css">
<link rel="stylesheet" href="${root}assets/site.css">
${extraHead}
</head>
<body${immersive ? ' class="immersive-body"' : ""}>
<a class="skip-link" href="#main">Skip to content</a>
<header class="topbar">
  <button class="nav-toggle" id="nav-toggle" aria-label="Toggle navigation" aria-expanded="false"><span class="hb" aria-hidden="true"><span class="hb-t"></span><span class="hb-m"></span><span class="hb-b"></span></span></button>
  <a class="brand" href="${root}index.html">
    <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64" width="18" height="18"><rect x="6" y="14" width="52" height="9" rx="4.5" fill="#8c1d2b"/><rect x="6" y="27.5" width="52" height="9" rx="4.5" fill="#ffffff"/><rect x="6" y="41" width="52" height="9" rx="4.5" fill="#1f3864"/></svg></span>
    <span class="brand-name">${esc(brandMain)}${brandThin ? ` <span class="thin">${esc(brandThin)}</span>` : ""}</span>
  </a>
  <span class="topbar-spacer"></span>
  <button class="searchbtn" data-search-open type="button" aria-label="Search schemes">
    ${ICONS.search}<span class="searchbtn-label">Search schemes…</span><kbd>⌘K</kbd>
  </button>
  <button class="icon-btn theme-toggle" id="theme-toggle" type="button" aria-label="Toggle light / dark theme">
    <span class="sun">${ICONS.sun}</span><span class="moon">${ICONS.moon}</span>
  </button>
</header>
<div class="scrim" id="scrim"></div>
${immersive ? `
<main id="main" class="content ${pageClass}">
${body}
</main>` : `
<div class="layout">
${sidebar(root, active)}
<main id="main" class="content ${pageClass}">
${toc ? `<div class="content-with-toc"><div class="content-main">${body}</div>${toc}</div>` : body}
</main>
</div>`}
${immersive ? "" : `
<footer class="footer"><div class="footer-inner">
  <div class="footer-author">
    <img class="author-avatar" src="${root}assets/avatar.png" alt="Fluteninja" width="32" height="32" loading="lazy">
    <div class="author-meta">
      <div class="author-role">Built &amp; maintained by</div>
      <div class="author-name">Fluteninja</div>
      <div class="author-links">
        <a href="https://github.com/Fluteninja" target="_blank" rel="noopener">GitHub</a> ·
        <a href="https://www.linkedin.com/in/ethanwysocki/" target="_blank" rel="noopener">LinkedIn</a>
      </div>
    </div>
  </div>
  <div class="footer-note">An independent reference compiled from official federal and state government sources. Not a government website — always verify on the linked official portals.</div>
  <div class="f-links">
    <a href="${root}about.html">About &amp; disclaimer</a>
    <a href="https://www.sba.gov/" target="_blank" rel="noopener">sba.gov ↗</a>
    <a href="${attr(REPO_URL)}" target="_blank" rel="noopener">GitHub ↗</a>
  </div>
</div></footer>`}
<div class="search-modal" id="search-modal" role="dialog" aria-modal="true" aria-label="Search">
  <div class="backdrop"></div>
  <div class="search-panel">
    <div class="search-head">${ICONS.search}<input id="search-input" type="text" placeholder="Search ${schemes.length} programs, glossary, states…" autocomplete="off" aria-label="Search schemes, glossary and states"></div>
    <div class="sr-only" id="search-status" role="status" aria-live="polite"></div>
    <div class="results" id="search-results"></div>
    <div class="search-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
  </div>
</div>
${immersive ? "" : `<button class="to-top" id="to-top" aria-label="Back to top">${ICONS.up}</button>`}
<script src="${root}assets/search-index.js" defer></script>
<script src="${root}assets/site.js" defer></script>
</body>
</html>`;
}

/* ---------------- shared fragments ---------------- */
const catBadge = (cat) => `<span class="badge b-${cat}">${esc(CAT_LABEL[cat])}</span>`;
const pillList = (root, list) => `<div class="pill-list">${list.map((r) => r.slug
  ? `<a href="${root}schemes/${r.slug}.html">${esc(r.name)}${r.qual ? ` <span class="qual">${esc(r.qual)}</span>` : ""}</a>`
  : `<span class="dead">${esc(r.name)}</span>`).join("")}</div>`;
const crumbs = (root, items) => `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([t, h], i) =>
  h ? `<a href="${root}${h}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`)
  .join('<span class="sep">/</span>')}</nav>`;
const schemeCardHTML = (root, s) => `
  <a class="scheme-card" href="${root}schemes/${s.slug}.html">
    <div class="top"><span class="abbr">${s.shortName ? `${esc(s.shortName)} · ` : ""}Part ${s.part}</span>${catBadge(s.category)}</div>
    <h3>${esc(s.name)}</h3>
    <div class="ministry">${esc(s.ministry)}</div>
    <p class="tagline">${esc(s.tagline)}</p>
    <div class="meta">${(s.stages || []).map((st) => `<span class="badge b-plain b-part">${esc(STAGE_LABEL[st])}</span>`).join("")}
    ${s.maxFunding ? `<span class="amount">${esc(s.maxFunding)}</span>` : ""}</div>
  </a>`;

/* ---------------- write helpers ---------------- */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "schemes"), { recursive: true });
mkdirSync(join(OUT, "assets"), { recursive: true });
const pages = [];
const write = (rel, html) => { mkdirSync(dirname(join(OUT, rel)), { recursive: true }); writeFileSync(join(OUT, rel), html); pages.push(rel); };

/* ================= HOME ================= */
{
  const catCounts = Object.fromEntries(Object.keys(CAT_LABEL).map((c) => [c, schemes.filter((s) => s.category === c).length]));
  const stageCounts = Object.fromEntries(Object.keys(STAGE_LABEL).map((st) => [st, schemes.filter((s) => (s.stages || []).includes(st)).length]));
  const sectorCounts = Object.entries(SECTOR_LABEL).map(([k, v]) => [k, v, schemes.filter((s) => (s.sectors || []).includes(k)).length]).filter(([, , n]) => n > 0);
  const flagshipSlugs = ["sisfs", "ffs", "cgss", "idex", "big", "samridh"];
  const flagship = flagshipSlugs.map((sl) => schemes.find((s) => s.slug === sl)).filter(Boolean).slice(0, 6);
  const CAT_ICON = { grant: "gift", equity: "chart", "loan-credit": "banknote", incubation: "sprout", "market-access": "send", mixed: "layers" };
  const CAT_TONE = { grant: "tone-green", equity: "tone-violet", "loan-credit": "tone-amber", incubation: "tone-teal", "market-access": "tone-blue", mixed: "" };

  // hero mini-map: the real USA choropleth, states shaded by incubator count
  // + city dots, linking to the incubators directory. Server-rendered (no JS).
  let heroMap = "";
  if (indiaMap) {
    const counts = {};
    incubators.incubators.forEach((o) => { if (o.state) counts[o.state] = (counts[o.state] || 0) + 1; });
    const bucket = (n) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : n <= 20 ? 4 : 5);
    const [W, H] = indiaMap.viewBox;
    const pr = indiaMap.proj;
    const P = (lng, lat, stateName) => {
      const q = (pr.insets && pr.insets[stateName]) || pr;
      const px = q.padX ?? q.pad, py = q.padY ?? q.pad;
      return [px + (lng * q.cosLat0 - q.rxMin) * q.s, py + (q.ryMax - lat) * q.s];
    };
    const paths = Object.entries(indiaMap.states).map(([name, r]) =>
      `<path d="${r.d}" class="hm${bucket(counts[name] || 0)}"/>`).join("");
    const cityKeys = new Set();
    const dots = incubators.incubators.filter((o) => o.lat != null && o.lng != null).map((o) => {
      const k = `${o.lat},${o.lng}`;
      if (cityKeys.has(k)) return "";
      cityKeys.add(k);
      const [x, y] = P(o.lng, o.lat, o.state);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/>`;
    }).join("");
    heroMap = `<a class="hero-map" href="ecosystem-map.html" aria-label="Choose how to explore the USA map — ${incubators.incubators.length} incubators mapped nationwide">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">${paths}${dots}</svg>
    </a>`;
  }

  // News ticker — an auto-scrolling marquee of the latest headlines, pinned at
  // the top of the overview. Pure-CSS marquee (two duplicated sequences); pauses
  // on hover and honours prefers-reduced-motion. Omitted when there is no news.
  const tickerItems = news.slice(0, 14);
  const tickerDur = Math.max(30, tickerItems.length * 5);
  const seq = tickerItems.map(tickerItem).join("");
  const tickerHTML = tickerItems.length ? `
<div class="news-ticker" role="region" aria-label="Latest US startup ecosystem news">
  <a class="ticker-tag" href="news.html">${ICONS.news}<span>News</span></a>
  <div class="ticker-viewport">
    <div class="ticker-track" style="animation-duration:${tickerDur}s">
      <div class="ticker-seq">${seq}</div>
      <div class="ticker-seq" aria-hidden="true">${seq}</div>
    </div>
  </div>
  <a class="ticker-more" href="news.html">All news ${ICONS.arrow}</a>
</div>` : "";

  const body = `
${tickerHTML}
<section class="hero glass">
  <div class="hero-grid">
    <div class="hero-copy">
      <div class="kicker">🇺🇸 Federal &amp; state programs · Independent reference</div>
      <h1>Every federal and state program for your US startup, in one place.</h1>
      <p>${schemes.length} programs across ${about.stats?.ministries || "10+"} federal agencies — grants, loans, tax incentives, incubation and market access — sourced from official government pages and organised so you can find what you're eligible for in minutes.</p>
    </div>
    ${heroMap}
    <div class="hero-cta">
      <button class="hero-search" data-search-open type="button">${ICONS.search} Search programs, e.g. “SBIR”, “R&amp;D credit”, “SBA loan”… <kbd>⌘K</kbd></button>
      <div class="hero-actions">
        <a class="btn btn-primary" href="finder.html">${ICONS.compass} Find your program in 5 questions</a>
        <a class="btn btn-secondary" href="directory.html">Browse all ${schemes.length} programs</a>
      </div>
    </div>
  </div>
</section>

<div class="stats">
  <div class="stat"><div class="n">${schemes.length}</div><div class="l">Programs documented in full</div></div>
  <div class="stat"><div class="n">${esc(about.stats?.ministries || "10+")}</div><div class="l">Federal agencies &amp; regulators</div></div>
  <a class="stat" href="ecosystem-map.html"><div class="n">${incubators.incubators.length}</div><div class="l">Incubators &amp; resource partners mapped</div></a>
  <div class="stat"><div class="n">6</div><div class="l">Types of support</div></div>
  <div class="stat"><div class="n">5</div><div class="l">Lifecycle stages covered</div></div>
</div>

<h2 class="home-h2">Start here</h2>
<div class="grid grid-2">
  <a class="card" href="finder.html"><h3><span class="card-icon">${ICONS.compass}</span>Scheme Finder</h3><p>Answer 5 quick questions about your stage, needs and sector — get a personalised shortlist from the official decision tree.</p><span class="go">${ICONS.arrow}</span></a>
  <a class="card" href="needs.html"><h3><span class="card-icon tone-green">${ICONS.target}</span>“What do you need?”</h3><p>Jump straight from a need — grant, loan, lab space, buyers — to the schemes that provide it.</p><span class="go">${ICONS.arrow}</span></a>
  <a class="card" href="lifecycle.html"><h3><span class="card-icon tone-teal">${ICONS.sprout}</span>Lifecycle Map</h3><p>From idea to IPO: see which schemes match your stage of the journey, side by side.</p><span class="go">${ICONS.arrow}</span></a>
  <a class="card" href="compare.html"><h3><span class="card-icon tone-violet">${ICONS.scale}</span>Compare schemes</h3><p>Put up to three schemes side by side — eligibility, benefits, amounts and how to apply.</p><span class="go">${ICONS.arrow}</span></a>
</div>

<h2 class="home-h2">Browse by type of support<a class="more" href="directory.html">All schemes →</a></h2>
<div class="grid grid-3">
  ${Object.keys(CAT_ICON).map((c) => `
  <a class="card" href="directory.html?support=${c}">
    <h3><span class="card-icon ${CAT_TONE[c]}">${ICONS[CAT_ICON[c]]}</span>${esc(CAT_LABEL[c])}</h3>
    <p>${esc(CAT_DESC[c])}.</p>
    <p><strong>${catCounts[c]}</strong> scheme${catCounts[c] === 1 ? "" : "s"}</p>
    <span class="go">${ICONS.arrow}</span>
  </a>`).join("")}
</div>

<h2 class="home-h2">Browse by lifecycle stage<a class="more" href="lifecycle.html">Full map →</a></h2>
<div class="grid grid-3">
  ${Object.entries(STAGE_LABEL).map(([k, v]) => `
  <a class="card" href="directory.html?stage=${k}">
    <h3><span class="stage-dot tone-${k}" style="width:30px;height:30px;font-size:0.8rem">${v[0]}</span>${esc(v)}</h3>
    <p>${esc(STAGE_DESC[k])}.</p>
    <p><strong>${stageCounts[k]}</strong> schemes</p>
    <span class="go">${ICONS.arrow}</span>
  </a>`).join("")}
</div>

<h2 class="home-h2">Browse by sector</h2>
<p class="muted small">Deep-tech and strategic sectors get dedicated schemes — everything else is covered by sector-agnostic programs.</p>
<div class="chip-row" style="margin-top:14px">
  ${sectorCounts.map(([k, v, n]) => `<a class="chip" href="directory.html?sector=${k}">${esc(v)} <span class="count-pill">${n}</span></a>`).join("")}
</div>

<h2 class="home-h2">Flagship starting points<a class="more" href="directory.html">See all →</a></h2>
<div class="grid grid-2">${flagship.map((s) => schemeCardHTML("", s)).join("")}</div>

<h2 class="home-h2">Beyond federal schemes</h2>
<div class="grid grid-3">
  <a class="card" href="state-schemes.html"><h3><span class="card-icon tone-green">${ICONS.layers}</span>State schemes</h3><p>${stateSchemes.states.flatMap((s) => s.schemes).length} state-level startup schemes &amp; incentives — seed grants, tax credits, reimbursements — that stack on top of federal programs. By state, searchable, on a map.</p><span class="go">${ICONS.arrow}</span></a>
  <a class="card" href="incubators.html"><h3><span class="card-icon tone-teal">${ICONS.pin}</span>Incubators directory</h3><p>${incubators.incubators.length} Small Business Development Centers, NSF I-Corps hubs and accelerators across the US — on an interactive map, searchable and state-wise.</p><span class="go">${ICONS.arrow}</span></a>
  <a class="card" href="psu.html"><h3><span class="card-icon tone-blue">${ICONS.building}</span>Federal innovation programs</h3><p>${psu.programs.length} startup initiatives run by federal agencies and defense innovation units — AFWERX, DIU, NSIN, In-Q-Tel and more.</p><span class="go">${ICONS.arrow}</span></a>
  <a class="card" href="states.html"><h3><span class="card-icon tone-green">${ICONS.map}</span>State startup portals</h3><p>Every state runs its own economic-development programs — find your state's portal and incentives.</p><span class="go">${ICONS.arrow}</span></a>
  <a class="card" href="immigration.html"><h3><span class="card-icon tone-amber">${ICONS.globe}</span>Visas &amp; Immigration</h3><p>${immigration.pathways.length} US visa and green-card pathways for founders who aren't citizens or permanent residents — O-1A, EB-2 NIW, E-2 and more.</p><span class="go">${ICONS.arrow}</span></a>
</div>

<div class="callout tone-info" style="margin-top:44px">
  <span class="ic">${ICONS.info}</span>
  <div>This site is an independent reference compiled from official federal and state sources. Program details change — always confirm deadlines, amounts and eligibility on the <a href="about.html">linked official portals</a> before applying.</div>
</div>`;

  write("index.html", shell({
    root: "", active: "index.html", title: "",
    description: `${schemes.length} federal programs for US startups — grants, loans, tax incentives, incubation and market access — searchable, filterable and explained in plain English.`,
    body,
  }));
}

/* ================= DIRECTORY ================= */
{
  const lean = schemes.map((s) => ({
    slug: s.slug, name: s.name, shortName: s.shortName, ministry: s.ministry, tagline: s.tagline,
    part: s.part, category: s.category, stages: s.stages || [], supportTypes: s.supportTypes || [],
    sectors: s.sectors || [], audience: s.audience || [], maxFunding: s.maxFunding || "",
  }));
  const options = (obj, used) => Object.entries(obj).filter(([k]) => used.has(k)).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  const usedSectors = new Set(schemes.flatMap((s) => s.sectors || []));
  const usedAud = new Set(schemes.flatMap((s) => s.audience || []));
  const usedStages = new Set(schemes.flatMap((s) => s.stages || []));
  const usedCats = new Set(schemes.map((s) => s.category));

  const body = `
${crumbs("", [["Home", "index.html"], ["All schemes", null]])}
<div class="page-head">
  <div class="kicker">Directory</div>
  <h1>All ${schemes.length} schemes</h1>
  <p class="lede">Filter by what you need, where you are in the journey, and what you're building. <strong>Part A</strong> schemes name startups as the primary beneficiary; <strong>Part B</strong> schemes are open to startups among others.</p>
</div>
<div id="directory">
  <div class="toolbar">
    <div class="field">${ICONS.search}<input id="f-q" type="search" placeholder="Search name, ministry, keyword…" aria-label="Search schemes"></div>
    <select id="f-part" aria-label="Filter by part"><option value="">Part: all</option><option value="A">Part A — startup-specific</option><option value="B">Part B — startup-relevant</option></select>
    <select id="f-support" aria-label="Filter by support type"><option value="">Support: all</option>${options(CAT_LABEL, usedCats)}</select>
    <select id="f-stage" aria-label="Filter by stage"><option value="">Stage: all</option>${options(STAGE_LABEL, usedStages)}</select>
    <select id="f-sector" aria-label="Filter by sector"><option value="">Sector: all</option>${options(SECTOR_LABEL, usedSectors)}</select>
    <select id="f-audience" aria-label="Filter by who you are"><option value="">Who you are: all</option>${options(AUD_LABEL, usedAud)}</select>
    <div class="view-toggle" id="view-toggle" role="group" aria-label="View">
      <button data-view="cards" aria-pressed="true">${ICONS.grid} Cards</button>
      <button data-view="table" aria-pressed="false">${ICONS.menu} Table</button>
    </div>
    <button class="btn btn-ghost" id="f-reset" type="button">Reset</button>
  </div>
  <div class="result-count" id="f-count" role="status" aria-live="polite"></div>
  <h2 class="sr-only">Results</h2>
  <div id="dir-out"></div>
</div>
<script type="application/json" id="directory-data">${JSON.stringify(lean)}</script>`;

  write("directory.html", shell({
    root: "", active: "directory.html", title: "All Schemes",
    description: `Browse and filter all ${schemes.length} federal programs for US startups by support type, stage, sector and audience.`,
    body,
  }));
}

/* ================= FINDER ================= */
{
  const treeData = { intro: treeResolved.intro, questions: treeResolved.questions };
  const body = `
${crumbs("", [["Home", "index.html"], ["Scheme Finder", null]])}
<div class="page-head">
  <div class="kicker">Scheme Finder</div>
  <h1>Find your scheme in 5 questions</h1>
  <p class="lede">${esc(tree.intro || "Answer the questions below in order. Each answer points you to the most relevant schemes — you can appear in more than one branch.")}</p>
</div>
<div class="wizard" id="wizard"></div>
<script type="application/json" id="tree-data">${JSON.stringify(treeData)}</script>
<hr class="rule">
<h2>The full decision tree</h2>
<p class="muted small">Prefer to see the whole thing at once? This is the complete official tree.</p>
<div class="tree">
${treeResolved.questions.map((q) => `
  <div class="tree-q">
    <h3><span class="qn">Q${q.id}</span> ${esc(q.question)}</h3>
    <div class="tree-branches">
      ${q.branches.map((b, i) => `
      <div class="tree-branch">
        <div class="b-head h-${i % 6}">${esc(b.label)}</div>
        <div class="b-body">
          ${b.note ? `<p class="b-note">${esc(b.note)}</p>` : ""}
          ${b.schemes.length ? pillList("", b.schemes) : ""}
        </div>
      </div>`).join("")}
    </div>
  </div>`).join("")}
</div>`;

  write("finder.html", shell({
    root: "", active: "finder.html", title: "Scheme Finder",
    description: "Answer 5 questions about your startup's stage, needs and sector to get a personalised shortlist of government schemes.",
    body,
  }));
}

/* ================= LIFECYCLE ================= */
{
  const body = `
${crumbs("", [["Home", "index.html"], ["Lifecycle Map", null]])}
<div class="page-head">
  <div class="kicker">Lifecycle Map</div>
  <h1>Schemes for every stage of the journey</h1>
  <p class="lede">${esc(lifecycle.intro || "Find schemes aligned to where you are in your startup journey.")}</p>
</div>
<div class="lifecycle">
${lifecycleResolved.stages.map((st, i) => `
  <div class="stage-row">
    <div class="stage-rail"><div class="stage-dot tone-${st.id}">${i + 1}</div></div>
    <div class="stage-card">
      <h3>${esc(st.title)}</h3>
      <p class="desc">${esc(st.description)}</p>
      <div class="cols">
        <div class="col"><h4>Startup-specific schemes</h4>${pillList("", st.specific)}</div>
        <div class="col"><h4>Startup-relevant schemes</h4>${pillList("", st.relevant)}</div>
      </div>
    </div>
  </div>`).join("")}
</div>
<div class="callout" style="margin-top:34px"><span class="ic">${ICONS.info}</span><div>Stages overlap in practice — a scheme listed under Prototype may still accept seed-stage applicants. Check each scheme's <em>Who can apply</em> section.</div></div>`;

  write("lifecycle.html", shell({
    root: "", active: "lifecycle.html", title: "Startup Lifecycle Map",
    description: "See which government schemes fit each stage of your startup journey — from ideation to growth and market access.",
    body,
  }));
}

/* ================= NEEDS INDEX ================= */
{
  const body = `
${crumbs("", [["Home", "index.html"], ["What do you need?", null]])}
<div class="page-head">
  <div class="kicker">Needs Index</div>
  <h1>“What do you need?”</h1>
  <p class="lede">${esc(needs.intro || "Use this index to find schemes based on the type of support you are looking for.")}</p>
</div>
${needsResolved.rows.map((r) => `
<div class="tree-q" style="margin-top:18px">
  <h3>${esc(r.need)}${r.needNote ? ` <span class="muted" style="font-weight:400;font-size:0.85rem">${esc(r.needNote)}</span>` : ""}</h3>
  <div class="tree-branches">
    <div class="tree-branch"><div class="b-head h-0">Startup-specific</div><div class="b-body">${r.startupSpecific.length ? pillList("", r.startupSpecific) : '<p class="b-note">—</p>'}</div></div>
    <div class="tree-branch"><div class="b-head h-1">Startup-relevant</div><div class="b-body">${r.startupRelevant.length ? pillList("", r.startupRelevant) : '<p class="b-note">—</p>'}</div></div>
  </div>
</div>`).join("")}
<div class="tree-q" style="margin-top:18px">
  <h3>Immigration Status <span class="muted" style="font-weight:400;font-size:0.85rem">Not a US citizen or permanent resident</span></h3>
  <div class="tree-branches">
    <div class="tree-branch" style="grid-column:1/-1"><div class="b-head h-0">Startup-specific</div><div class="b-body"><div class="pill-list">${immigration.pathways.map((p) => `<a href="immigration/${p.slug}.html">${esc(p.shortName)}</a>`).join("")}</div></div></div>
  </div>
</div>`;

  write("needs.html", shell({
    root: "", active: "needs.html", title: "What Do You Need?",
    description: "Jump from what you need — grant, equity, loan, incubation, market access — straight to the government schemes that provide it.",
    body,
  }));
}

/* ================= COMPARE ================= */
{
  const cmpData = schemes.map((s) => ({
    slug: s.slug, name: s.name, shortName: s.shortName, ministry: s.ministry, tagline: s.tagline,
    category: s.category, bestSuitedFor: s.bestSuitedFor, eligibility: s.eligibility, benefits: s.benefits,
    howToApply: s.howToApply, maxFunding: s.maxFunding || "",
  }));
  const body = `
${crumbs("", [["Home", "index.html"], ["Compare", null]])}
<div class="page-head">
  <div class="kicker">Compare</div>
  <h1>Compare schemes side by side</h1>
  <p class="lede">Pick two or three schemes to see eligibility, benefits, amounts and application routes next to each other.</p>
</div>
<div id="compare">
  <div class="compare-pickers">
    <select aria-label="First scheme"></select>
    <select aria-label="Second scheme"></select>
    <select aria-label="Third scheme"></select>
  </div>
  <div class="sr-only" id="compare-status" role="status" aria-live="polite"></div>
  <div id="compare-out"></div>
</div>
<script type="application/json" id="compare-data">${JSON.stringify(cmpData)}</script>`;

  write("compare.html", shell({
    root: "", active: "compare.html", title: "Compare Schemes",
    description: "Compare US federal startup programs side by side — eligibility, benefits, funding amounts and how to apply.",
    body,
  }));
}

/* ================= PSU ================= */
{
  const body = `
${crumbs("", [["Home", "index.html"], ["Federal innovation programs", null]])}
<div class="page-head">
  <div class="kicker">Beyond federal schemes</div>
  <h1>Federal innovation &amp; defense programs</h1>
  <p class="lede">${esc(psu.intro || "Federal agencies run their own startup-facing innovation programs — non-dilutive funding, accelerators, challenge grants and procurement pathways, run agency-by-agency rather than through a single central scheme.")}</p>
</div>
<div class="org-grid">
${psu.programs.map((p) => p.url ? `
  <a class="org-card" href="${attr(p.url)}" target="_blank" rel="noopener">
    <span class="o-org">${esc(p.organization)}</span>
    <span class="o-name">${esc(p.program)}</span>
    ${p.description ? `<span class="o-desc">${esc(p.description)}</span>` : ""}
    <span class="o-link">${ICONS.external} <span class="host">${esc(new URL(p.url).hostname)}</span></span>
  </a>` : `
  <div class="org-card">
    <span class="o-org">${esc(p.organization)}</span>
    <span class="o-name">${esc(p.program)}</span>
    ${p.description ? `<span class="o-desc">${esc(p.description)}</span>` : ""}
  </div>`).join("")}
</div>
<div class="callout" style="margin-top:30px"><span class="ic">${ICONS.info}</span><div>Programs open and close on their own cycles — check each organisation's portal for live challenges and cohort dates.</div></div>`;

  write("psu.html", shell({
    root: "", active: "psu.html", title: "Federal Innovation Programs",
    description: "Startup-facing innovation programs run by federal agencies and defense innovation units — accelerators, challenges and procurement pathways.",
    body,
  }));
}

/* ================= IMMIGRATION ================= */
const IMM_CAT_TONE = {
  "Temporary work visa": "tone-blue",
  "Permanent residency (green card)": "tone-green",
  "Discretionary parole (not a visa)": "tone-amber",
};
{
  const body = `
${crumbs("", [["Home", "index.html"], ["Visas & Immigration", null]])}
<div class="page-head">
  <div class="kicker">Beyond federal schemes</div>
  <h1>Startup visas &amp; immigration pathways</h1>
  <p class="lede">${esc(immigration.intro)}</p>
</div>
<div class="callout tone-warn" style="margin-bottom:24px"><span class="ic">${ICONS.info}</span><div>${esc(immigration.disclaimer)}</div></div>
<div class="grid grid-3">
${immigration.pathways.map((p) => `
  <a class="card" href="immigration/${p.slug}.html">
    <h3><span class="card-icon ${IMM_CAT_TONE[p.category] || ""}">${ICONS.globe}</span>${esc(p.shortName)}</h3>
    <p>${esc(p.tagline)}</p>
    <span class="go">${ICONS.arrow}</span>
  </a>`).join("")}
</div>`;

  write("immigration.html", shell({
    root: "", active: "immigration.html", title: "Startup Visas & Immigration Pathways",
    description: "The main US visa and green-card pathways relevant to startup founders who are not US citizens or permanent residents — O-1A, EB-1A, EB-2 NIW, International Entrepreneur Parole, E-2, and L-1A.",
    body,
  }));

  immigration.pathways.forEach((p, idx) => {
    const root = "../";
    const prev = immigration.pathways[idx - 1];
    const next = immigration.pathways[idx + 1];
    const related = immigration.pathways.filter((o) => o.slug !== p.slug && o.category === p.category);
    const officialUrl = (p.links || [])[0]?.url;
    const pbody = `
${crumbs(root, [["Home", "index.html"], ["Visas & Immigration", "immigration.html"], [p.shortName, null]])}
<article>
<header class="page-head">
  <div class="kicker">${esc(p.category)}</div>
  <h1>${esc(p.name)}</h1>
  <p class="lede">${esc(p.tagline)}</p>
</header>

<section class="section" id="overview" style="margin-top:8px">
  <div class="body prose"><p class="lead">${esc(p.whatIsThis)}</p></div>
</section>

<div class="facts">
  <div class="fact"><div class="k">Category</div><div class="v"><span class="badge ${IMM_CAT_TONE[p.category] || ""}">${esc(p.category)}</span></div></div>
  <div class="fact"><div class="k">Best for</div><div class="v">${esc(p.bestFor)}</div></div>
  <div class="fact"><div class="k">Source</div><div class="v">${officialUrl ? `<a href="${attr(officialUrl)}" target="_blank" rel="noopener">${esc(p.links[0].label || "Official page")} ↗</a>` : "—"}</div></div>
</div>

<section class="section" id="eligibility">
  <h2><span class="sec-icon">${ICONS.clipboard}</span>Eligibility</h2>
  <ul class="checklist">${(p.eligibility || []).map((e) => `<li><span class="tick">${ICONS.check}</span><span>${esc(e)}</span></li>`).join("\n")}</ul>
</section>

<section class="section" id="benefits">
  <h2><span class="sec-icon">${ICONS.gift}</span>Benefits</h2>
  <ul class="benefits">${(p.benefits || []).map((b) => `<li><span class="gift">${ICONS.gift}</span><span>${esc(b)}</span></li>`).join("\n")}</ul>
</section>

${(p.limitations || []).length ? `
<section class="section" id="limitations">
  <h2><span class="sec-icon">${ICONS.info}</span>Tradeoffs to know</h2>
  <ul class="benefits">${p.limitations.map((l) => `<li><span class="gift">${ICONS.info}</span><span>${esc(l)}</span></li>`).join("\n")}</ul>
</section>` : ""}

<section class="section" id="apply">
  <h2><span class="sec-icon">${ICONS.send}</span>How to apply</h2>
  <div class="body prose">${paras(p.howToApply)}</div>
  ${officialUrl ? `<p style="margin-top:16px"><a class="btn btn-primary" href="${attr(officialUrl)}" target="_blank" rel="noopener">Go to official source ${ICONS.external}</a></p>` : ""}
</section>

<div class="callout tone-warn"><span class="ic">${ICONS.info}</span><div>${esc(immigration.disclaimer)}</div></div>

${related.length ? `
<section class="section" id="related">
  <h2><span class="sec-icon">${ICONS.layers}</span>Related pathways</h2>
  <div class="related">${related.map((r) => `
    <a href="${root}immigration/${r.slug}.html"><span class="rn">${esc(r.shortName)}</span><span class="rm">${esc(r.category)}</span></a>`).join("")}</div>
</section>` : ""}

<nav class="pagenav" aria-label="Adjacent pathways">
  ${prev ? `<a class="prev" href="${root}immigration/${prev.slug}.html"><span class="dir">← Previous</span><span class="t">${esc(prev.shortName)}</span></a>` : "<span></span>"}
  ${next ? `<a class="next" href="${root}immigration/${next.slug}.html"><span class="dir">Next →</span><span class="t">${esc(next.shortName)}</span></a>` : "<span></span>"}
</nav>
</article>`;

    write(`immigration/${p.slug}.html`, shell({
      root, active: `immigration/${p.slug}.html`,
      title: `${p.shortName} — ${p.name}`,
      description: p.tagline,
      body: pbody,
    }));
  });
}

/* ================= STATES ================= */
{
  const sorted = [...states.states].sort((a, b) => a.name.localeCompare(b.name));
  const body = `
${crumbs("", [["Home", "index.html"], ["State initiatives", null]])}
<div class="page-head">
  <div class="kicker">Beyond federal schemes</div>
  <h1>State startup initiatives</h1>
  <p class="lede">${esc(states.intro || "Every state runs its own economic-development incentives — seed grants, tax credits, subsidies, incubation and more. Federal programs stack with state ones.")}</p>
</div>
<div class="org-grid">
${sorted.map((st) => st.url ? `
  <a class="org-card" id="${slugify(st.name)}" href="${attr(st.url)}" target="_blank" rel="noopener">
    <span class="o-org">${esc(st.name)}</span>
    ${st.program ? `<span class="o-name">${esc(st.program)}</span>` : ""}
    <span class="o-link">${ICONS.external} <span class="host">${esc(new URL(st.url).hostname)}</span></span>
  </a>` : `
  <div class="org-card" id="${slugify(st.name)}">
    <span class="o-org">${esc(st.name)}</span>
    ${st.program ? `<span class="o-name">${esc(st.program)}</span>` : ""}
  </div>`).join("")}
</div>
<div class="callout tone-info" style="margin-top:30px"><span class="ic">${ICONS.info}</span><div>State program details live on each state's own economic-development portal, indexed via the <a href="https://www.eda.gov/economic-development-directory" target="_blank" rel="noopener">U.S. EDA's Economic Development Directory</a>.</div></div>`;

  write("states.html", shell({
    root: "", active: "states.html", title: "State Startup Initiatives",
    description: "Find your state's economic-development portal — local seed grants, tax credits and incubation that stack with federal programs.",
    body,
  }));
}

/* ================= ECOSYSTEM MAP ================= */
{
  const leanIncubators = incubators.incubators.map((incubator, index) => ({
    slug: `${slugify(incubator.name)}-${index + 1}`,
    name: incubator.name,
    shortName: incubator.name.length > 34 ? incubator.name.split(/\s+/).slice(0, 5).join(" ") : incubator.name,
    host: incubator.host || "",
    city: incubator.city || "",
    region: incubator.state,
    type: incubator.type,
    website: incubator.website || "",
  }));
  const minimapStates = stateSchemes.states.map((state) =>
    `<button type="button" data-state="${attr(state.state)}" aria-label="Open ${attr(state.state)}"><span class="sr-only">${esc(state.state)}</span></button>`).join("");
  const walkableBody = `
<div class="walkable-map" id="walkable-map">
  <div class="walkable-viewport" role="application" aria-label="3D walkable map of the US startup incubator ecosystem. Use arrow keys or WASD to walk.">
    <canvas class="walkable-canvas" aria-hidden="true"></canvas>
    <div class="walkable-overlay">
      <div class="walkable-terrain-labels" aria-hidden="true"></div>
      <div class="walkable-wayfinders" aria-label="State and regional wayfinders"></div>
      <div class="walkable-landmarks" aria-label="State landmarks"></div>
      <div class="walkable-orgs" aria-label="Incubators"></div>
    </div>
    <div class="walkable-stick" aria-hidden="true"><span class="walkable-stick-knob"></span></div>
    <div class="walkable-3d-fallback" hidden>
      <div>
        <h2>This map needs WebGL</h2>
        <p>Your browser could not start the 3D scene. Every incubator and state scheme remains reachable through the conventional maps and directories.</p>
        <a class="btn btn-primary" href="incubators.html?view=map">Open incubator map</a>
        <a class="btn btn-secondary" href="state-schemes.html?view=map">State schemes map</a>
        <a class="btn btn-ghost" href="ecosystem-map.html">Map choices</a>
      </div>
    </div>
  </div>

  <section class="walkable-intro is-open" aria-label="Map instructions">
    <button class="walkable-intro-close" id="walkable-intro-close" type="button" aria-label="Dismiss instructions">${ICONS.close}</button>
    <div class="walkable-kicker">Walk the USA</div>
    <h1>Explore the incubator ecosystem on foot</h1>
    <p>Walk the real shape of all 50 states and DC in 3D — over the Rockies, across the Great Plains, along the Mississippi, with Alaska and Hawaii mapped as their own insets. Follow state wayfinders and open a state when you arrive. Incubator pins show state membership—not street addresses. If you get lost, choose Recenter to swing the camera back behind you.</p>
    <div class="walkable-keyhint"><span><kbd>WASD</kbd>, arrows, or touch-drag to walk</span><span><kbd>Enter</kbd> to open your current state</span><span>Mouse-drag, <kbd>Q</kbd>/<kbd>E</kbd> to look · pinch to zoom</span></div>
  </section>

  <div class="walkable-actions">
    <a class="walkable-list-link" href="incubators.html">${ICONS.list}<span>Browse incubators</span></a>
    <a class="walkable-map-home" href="ecosystem-map.html" aria-label="Map choices">${ICONS.map}</a>
    <button class="walkable-recenter" id="walkable-recenter" type="button" aria-label="Recenter map on avatar" title="Recenter on avatar">${ICONS.target}</button>
    <button class="walkable-help" id="walkable-help" type="button" aria-label="Show map instructions">?</button>
  </div>
  <button class="walkable-nearby" id="walkable-nearby" type="button" hidden></button>

  <aside class="walkable-minimap" aria-label="USA inset map">
    <div class="walkable-minimap-head"><strong>USA</strong><span>You are here</span></div>
    <div class="walkable-minimap-stage">
      <svg class="walkable-minimap-map" viewBox="0 0 ${indiaMap.viewBox[0]} ${indiaMap.viewBox[1]}" aria-hidden="true"></svg>
      <div class="walkable-minimap-states">${minimapStates}</div>
      <span class="walkable-minimap-dot" aria-hidden="true"></span>
    </div>
  </aside>

  <div class="walkable-zoom" aria-label="Map zoom controls">
    <button id="walkable-zoom-in" type="button" aria-label="Zoom in">+</button>
    <output id="walkable-zoom-level" aria-live="polite">65%</output>
    <button id="walkable-zoom-out" type="button" aria-label="Zoom out">−</button>
    <button id="walkable-zoom-reset" type="button" aria-label="Reset zoom to 65 percent">Reset</button>
  </div>

  <div class="walkable-dpad" aria-label="Movement controls">
    <button type="button" data-direction="up" aria-label="Walk north">↑</button>
    <button type="button" data-direction="left" aria-label="Walk west">←</button>
    <button type="button" data-direction="down" aria-label="Walk south">↓</button>
    <button type="button" data-direction="right" aria-label="Walk east">→</button>
  </div>

  <div class="walkable-drawer" id="state-drawer" hidden>
    <button class="walkable-drawer-backdrop" type="button" aria-label="Close state"></button>
    <section class="walkable-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="state-drawer-title">
      <header class="walkable-drawer-head">
        <div><span>State</span><h2 id="state-drawer-title"></h2></div>
        <button class="icon-btn" id="state-drawer-close" type="button" aria-label="Close state">${ICONS.close}</button>
      </header>
      <div class="walkable-drawer-body"></div>
    </section>
  </div>
</div>
<script type="application/json" id="walkable-incubators">${JSON.stringify(leanIncubators)}</script>
<script type="application/json" id="walkable-states">${JSON.stringify(stateSchemes.states)}</script>
<script type="application/json" id="india-map-data">${JSON.stringify(indiaMap)}</script>
<script type="application/json" id="india-terrain-data">${JSON.stringify(indiaTerrain)}</script>
<script type="module" src="assets/walkable-3d.js"></script>`;
  write("walkable-map.html", shell({
    root: "",
    active: "walkable-map.html",
    title: "Walkable 3D USA ecosystem map",
    description: "Walk across a 3D map of all 50 states and DC — mountains, rivers, lakes, and Alaska/Hawaii as their own insets — following state wayfinders and discovering incubators and state support.",
    body: walkableBody,
    pageClass: "walkable-page",
    immersive: true,
  }));

  const previewPaths = Object.entries(indiaMap.states).map(([name, shape]) =>
    `<path data-state="${attr(name)}" d="${shape.d}"></path>`).join("");
  const landingBody = `
${crumbs("", [["Home", "index.html"], ["Explore the USA map", null]])}
<section class="map-entry-hero">
  <div class="map-entry-copy">
    <div class="kicker">USA ecosystem maps</div>
    <h1>Choose how you want to explore</h1>
    <p class="lede">All three views use the guide's source-linked records across US states. The walkable map places incubators generally within their state—it does not claim an exact street location.</p>
  </div>
  <div class="map-entry-preview" aria-hidden="true"><svg viewBox="0 0 ${indiaMap.viewBox[0]} ${indiaMap.viewBox[1]}">${previewPaths}</svg></div>
</section>

<div class="map-entry-grid map-entry-grid-three">
  <article class="map-entry-card map-entry-walk">
    <div class="map-entry-icon">${ICONS.compass}</div>
    <div class="map-entry-label">Immersive 3D experience</div>
    <h2>Walk the USA ecosystem in 3D</h2>
    <p>Walk a small explorer across the real shape of all 50 states and DC — mountain ranges, rivers and lakes on the mainland, with Alaska and Hawaii mapped as their own insets — follow state wayfinders, and open policy-rich state drawers as you arrive.</p>
    <ul>
      <li>Keyboard, touch D-pad, drag-to-look, and pinch controls</li>
      <li>State landmarks and directional signposts</li>
      <li>Designed for exploratory, full-screen browsing</li>
    </ul>
    <a class="btn btn-primary" href="walkable-map.html">Enter the 3D map ${ICONS.arrow}</a>
  </article>

  <article class="map-entry-card">
    <div class="map-entry-icon">${ICONS.pin}</div>
    <div class="map-entry-label">Incubator directory</div>
    <h2>Scan incubators by state</h2>
    <p>Use the conventional US map to compare incubator coverage, filter all ${incubators.incubators.length} records, and switch between map, cards, table, and state views.</p>
    <ul>
      <li>Search by incubator, host institution, city, or sector</li>
      <li>Filter by state, type, and supporting programme</li>
      <li>Best for targeted research and fast comparison</li>
    </ul>
    <a class="btn btn-secondary" href="incubators.html?view=map">Open incubator map ${ICONS.arrow}</a>
  </article>

  <article class="map-entry-card">
    <div class="map-entry-icon">${ICONS.layers}</div>
    <div class="map-entry-label">State support map</div>
    <h2>Compare state schemes</h2>
    <p>Explore local startup policies and incentives through the existing state choropleth, with filters for grants, subsidies, seed funding, incubation, and more.</p>
    <ul>
      <li>Compare scheme volume across states and UTs</li>
      <li>Open policy summaries and official portals</li>
      <li>Best for funding and incentive research</li>
    </ul>
    <a class="btn btn-secondary" href="state-schemes.html?view=map">Open state schemes map ${ICONS.arrow}</a>
  </article>
</div>

<div class="map-entry-note">
  ${ICONS.info}
  <p><strong>Know what you need?</strong> Use the <a href="incubators.html">incubator directory</a> or <a href="state-schemes.html">state schemes directory</a>. Every record remains reachable without entering the walkable experience.</p>
</div>`;
  write("ecosystem-map.html", shell({
    root: "",
    active: "ecosystem-map.html",
    title: "Explore the USA map",
    description: "Choose an immersive walkable map, the filterable incubator map, or the state schemes map.",
    body: landingBody,
  }).replace(/[ \t]+\n/g, "\n"));
}

/* ================= INCUBATORS ================= */
{
  const INC_TYPE = {
    SBDC: "Small Business Development Center", ICORPS: "NSF I-Corps Hub/Site", Academic: "Academic / University",
    Government: "Government", Private: "Private / Accelerator", "Sector-specific": "Sector-specific",
  };
  const list = incubators.incubators;
  const nStates = new Set(list.map((r) => r.state)).size;
  const nCities = new Set(list.map((r) => `${r.city}|${r.state}`)).size;
  const nDst = list.filter((r) => /SBA|SBDC/i.test(r.supportedBy)).length;
  const nAic = list.filter((r) => r.type === "ICORPS").length;

  const usedTypes = new Set(list.map((r) => r.type));
  const usedStates = [...new Set(list.map((r) => r.state))].sort();
  const usedSupport = [...new Set(list.map((r) => {
    const s = r.supportedBy;
    if (/SBA|SBDC/i.test(s)) return "SBA / SBDC network";
    if (/\bNSF\b/i.test(s)) return "NSF";
    if (/DOD|Defense/i.test(s)) return "DOD";
    if (/State/i.test(s)) return "State government";
    if (/Private/i.test(s)) return "Private";
    return "";
  }).filter(Boolean))].sort();

  const typeOpts = Object.entries(INC_TYPE).filter(([k]) => usedTypes.has(k)).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  const stateOpts = usedStates.map((s) => `<option value="${attr(s)}">${esc(s)}</option>`).join("");
  const supportOpts = usedSupport.map((s) => `<option value="${attr(s)}">${esc(s)}</option>`).join("");

  const body = `
${crumbs("", [["Home", "index.html"], ["Incubators directory", null]])}
<div class="page-head">
  <div class="kicker">Beyond federal schemes</div>
  <h1>US startup incubators, mapped</h1>
  <p class="lede">${esc(incubators.intro)}</p>
</div>

<div class="stats">
  <div class="stat"><div class="n">${list.length}</div><div class="l">Incubators indexed</div></div>
  <div class="stat"><div class="n">${nStates}</div><div class="l">States covered</div></div>
  <div class="stat"><div class="n">${nCities}</div><div class="l">Cities &amp; towns</div></div>
  <div class="stat"><div class="n">${nDst}</div><div class="l">SBA / SBDC supported</div></div>
  <div class="stat"><div class="n">${nAic}</div><div class="l">NSF I-Corps hubs/sites</div></div>
</div>

<div id="incubators">
  <div class="toolbar">
    <div class="field">${ICONS.search}<input id="i-q" type="search" placeholder="Search name, host institution, city, sector…" aria-label="Search incubators"></div>
    <select id="i-state" aria-label="Filter by state"><option value="">State: all</option>${stateOpts}</select>
    <select id="i-type" aria-label="Filter by type"><option value="">Type: all</option>${typeOpts}</select>
    <select id="i-support" aria-label="Filter by support"><option value="">Support: all</option>${supportOpts}</select>
    <div class="view-toggle" id="i-view-toggle" role="group" aria-label="View">
      <button data-view="map" aria-pressed="true">${ICONS.pin} Map</button>
      <button data-view="cards" aria-pressed="false">${ICONS.grid} Cards</button>
      <button data-view="table" aria-pressed="false">${ICONS.menu} Table</button>
      <button data-view="state" aria-pressed="false">${ICONS.map} By state</button>
    </div>
    <button class="btn btn-ghost" id="i-reset" type="button">Reset</button>
  </div>
  <div class="result-count" id="i-count" role="status" aria-live="polite"></div>
  <h2 class="sr-only">Incubators</h2>
  <div id="inc-out"></div>
</div>

<div class="callout tone-info" style="margin-top:30px"><span class="ic">${ICONS.info}</span><div>Compiled from the SBA's Small Business Development Center directory, NSF I-Corps hub/site listings, and each incubator's own site. Contact details change and some fields are intentionally left blank where they could not be verified — always confirm on the incubator's official website before reaching out. Spotted an error or a missing incubator? <a href="${attr(REPO_URL)}" target="_blank" rel="noopener">Open an issue on GitHub</a>.</div></div>

<script type="application/json" id="incubators-data">${JSON.stringify(list)}</script>
<script type="application/json" id="india-map-data">${JSON.stringify(indiaMap)}</script>`;

  write("incubators.html", shell({
    root: "", active: "incubators.html", title: "Incubators Directory",
    description: `A searchable, mappable directory of ${list.length} SBA Small Business Development Centers, NSF I-Corps hubs and startup accelerators across ${nStates} US states — with locations, websites and contacts.`,
    body,
  }));
}

/* ================= STATE SCHEMES ================= */
{
  const SS_TYPE = ["Grant", "Seed funding", "Subsidy", "Reimbursement", "Incentive", "Incubation", "Loan/Credit", "Procurement", "Other"];
  const sts = stateSchemes.states;
  const allSchemes = sts.flatMap((s) => s.schemes);
  const withPolicy = sts.filter((s) => s.schemes.length).length;
  const usedTypes = new Set(allSchemes.map((s) => s.type));
  const usedStates = sts.filter((s) => s.schemes.length).map((s) => s.state);

  const typeOpts = SS_TYPE.filter((t) => usedTypes.has(t)).map((t) => `<option value="${attr(t)}">${esc(t)}</option>`).join("");
  const stateOpts = usedStates.map((s) => `<option value="${attr(s)}">${esc(s)}</option>`).join("");

  const body = `
${crumbs("", [["Home", "index.html"], ["State schemes", null]])}
<div class="page-head">
  <div class="kicker">Beyond federal schemes</div>
  <h1>State startup schemes</h1>
  <p class="lede">${esc(stateSchemes.intro)}</p>
</div>

<div class="stats">
  <div class="stat"><div class="n">${withPolicy}</div><div class="l">States with programs indexed</div></div>
  <div class="stat"><div class="n">${allSchemes.length}</div><div class="l">Schemes &amp; incentives indexed</div></div>
  <div class="stat"><div class="n">${usedTypes.size}</div><div class="l">Types of support</div></div>
  <a class="stat" href="incubators.html"><div class="n">${incubators.incubators.length}</div><div class="l">State &amp; central incubators →</div></a>
</div>

<div id="state-schemes">
  <div class="toolbar">
    <div class="field">${ICONS.search}<input id="s-q" type="search" placeholder="Search scheme, benefit, keyword…" aria-label="Search state schemes"></div>
    <select id="s-state" aria-label="Filter by state"><option value="">State: all</option>${stateOpts}</select>
    <select id="s-type" aria-label="Filter by support type"><option value="">Type: all</option>${typeOpts}</select>
    <div class="view-toggle" id="s-view-toggle" role="group" aria-label="View">
      <button data-view="state" aria-pressed="true">${ICONS.map} By state</button>
      <button data-view="list" aria-pressed="false">${ICONS.grid} All schemes</button>
      <button data-view="map" aria-pressed="false">${ICONS.pin} Map</button>
    </div>
    <button class="btn btn-ghost" id="s-reset" type="button">Reset</button>
  </div>
  <div class="result-count" id="s-count" role="status" aria-live="polite"></div>
  <h2 class="sr-only">State schemes</h2>
  <div id="ss-out"></div>
</div>

<div class="callout tone-info" style="margin-top:30px"><span class="ic">${ICONS.info}</span><div>State incentives <strong>stack with federal programs</strong> — a startup can draw on both. Amounts, windows and eligibility come from each state's official economic-development portal and change often; blank fields are left blank rather than guessed. Always confirm on the state portal before applying. Spotted an error or a missing scheme? <a href="${attr(REPO_URL)}" target="_blank" rel="noopener">Open an issue on GitHub</a>.</div></div>

<script type="application/json" id="state-schemes-data">${JSON.stringify(sts)}</script>
<script type="application/json" id="india-map-data">${JSON.stringify(indiaMap)}</script>`;

  write("state-schemes.html", shell({
    root: "", active: "state-schemes.html", title: "State Startup Schemes",
    description: `A searchable index of ${allSchemes.length} state-level startup schemes and incentives across ${withPolicy} states — seed grants, tax credits, subsidies and more, straight from each state's official economic-development portal. Kept separate from federal programs.`,
    body,
  }));
}

/* ================= GLOSSARY ================= */
{
  const items = glossary.terms.map((t) => ({ ...t, id: slugify(t.term) }));
  const letters = [...new Set(items.map((t) => t.term[0].toUpperCase()))].sort();
  const body = `
${crumbs("", [["Home", "index.html"], ["Glossary", null]])}
<div class="page-head">
  <div class="kicker">Reference</div>
  <h1>Definitions &amp; glossary</h1>
  <p class="lede">Definitions — what counts as a “small business,” what SAM.gov registration means, and every abbreviation used across the programs.</p>
</div>
<div class="alpha-row">${letters.map((l) => `<a href="#letter-${l}">${l}</a>`).join("")}</div>
<dl class="glossary-list">
${letters.map((l) => `
  <div id="letter-${l}"></div>
  ${items.filter((t) => t.term[0].toUpperCase() === l).map((t) => `
  <div class="glossary-item" id="${t.id}">
    <dt>${esc(t.term)}</dt>
    <dd>${esc(t.definition)}</dd>
  </div>`).join("")}`).join("")}
</dl>`;

  write("glossary.html", shell({
    root: "", active: "glossary.html", title: "Glossary",
    description: "Definitions and abbreviations used across this guide — SBA, SBIR/STTR, SAM.gov, QSBS, incubators and more.",
    body,
  }));
}

/* ================= ABOUT ================= */
{
  const body = `
${crumbs("", [["Home", "index.html"], ["About", null]])}
<div class="page-head">
  <div class="kicker">Reference</div>
  <h1>About this guide</h1>
  <p class="lede">${esc(about.tagline || "An independent, source-linked guide to federal and state funding for US startups.")}</p>
</div>
<div class="prose">
  <h2>Objective</h2>
  ${paras(about.objective)}
  <h2>Who it is for</h2>
  <ul>${(about.whoItIsFor || []).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
  ${(() => {
    if (!about.howToUse) return "";
    const [stepsPart, legendPart] = String(about.howToUse).split(/Startup Focus Legend[:\s]*/i);
    const steps = stepsPart.split(/(?=\b\d{1,2}\.\s)/).map((s) => s.replace(/^\d{1,2}\.\s*/, "").trim()).filter(Boolean);
    return `<h2>How to use it</h2>
      ${steps.length > 1 ? `<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : paras(stepsPart)}
      ${legendPart ? `<h3>Startup focus legend</h3>${paras(legendPart)}` : ""}`;
  })()}
  ${about.structure ? `<h2>How it is organised</h2>${paras(about.structure)}` : ""}
  <h2>The six types of support</h2>
</div>
<div class="grid grid-3">
${(about.supportCategories || []).map((c) => `
  <div class="card"><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p></div>`).join("")}
</div>
<div class="prose" style="margin-top:36px">
  <h2>About this website</h2>
  <p>This site is an independent reference compiled from official federal and state government sources — SBA.gov, SBIR.gov, Grants.gov, agency program pages, and each state's official economic-development portal. Every program page cites the specific official page it was drawn from, and every entry is re-checked against that source before it ships. There is no single source document the way there is for the India edition this project was adapted from; see <a href="${attr(REPO_URL)}" target="_blank" rel="noopener">the repository</a> for the full sourcing method.</p>
  ${about.licensingNote ? `<h2>Licensing &amp; attribution</h2><p>${esc(about.licensingNote)}</p>` : ""}
  <h2>Disclaimer</h2>
</div>
<div class="callout tone-warn"><span class="ic">${ICONS.info}</span><div>${esc(about.disclaimer)}</div></div>`;

  write("about.html", shell({
    root: "", active: "about.html", title: "About & Disclaimer",
    description: "About Startup USA Guide — objective, audience, sourcing method, structure and disclaimer.",
    body,
  }));
}

/* ================= SCHEME PAGES ================= */
const SECTION_META = [
  ["objectives", "Objectives", "target"],
  ["eligibility", "Who can apply?", "clipboard"],
  ["benefits", "What do you get?", "gift"],
  ["apply", "How to apply", "send"],
  ["links", "Key links", "link"],
  ["related", "Related schemes", "layers"],
];
function relatedSchemes(s) {
  const score = (o) => {
    if (o.slug === s.slug) return -1;
    let sc = 0;
    const shared = (a, b) => (a || []).filter((x) => (b || []).includes(x)).length;
    sc += shared(s.sectors?.filter((x) => x !== "sector-agnostic"), o.sectors) * 5;
    sc += (o.category === s.category ? 3 : 0);
    sc += shared(s.stages, o.stages) * 2;
    sc += (o.ministry === s.ministry ? 2 : 0);
    return sc;
  };
  return schemes.map((o) => [score(o), o]).filter(([sc]) => sc > 2)
    .sort((a, b) => b[0] - a[0]).slice(0, 4).map(([, o]) => o);
}

schemes.forEach((s, idx) => {
  const root = "../";
  const rel = relatedSchemes(s);
  const prev = schemes[idx - 1];
  const next = schemes[idx + 1];
  const toc = `
<aside class="toc" aria-label="On this page">
  <div class="toc-title">On this page</div>
  <a href="#overview">What is this?</a>
  ${SECTION_META.filter(([id]) => id !== "related" || rel.length).map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join("\n")}
</aside>`;

  const applyUrl = (s.links || [])[0]?.url;
  const body = `
${crumbs(root, [["Home", "index.html"], ["All schemes", "directory.html"], [s.shortName || s.name, null]])}
<article>
<header class="page-head">
  <div class="kicker">Part ${s.part} · ${s.part === "A" ? "Startup-specific" : "Startup-relevant"} scheme</div>
  <h1>${esc(s.name)}${s.shortName ? ` <span class="muted" style="font-weight:500">(${esc(s.shortName)})</span>` : ""}</h1>
  <p class="lede">${esc(s.ministry)}</p>
  <div class="chip-row" style="margin-top:14px">
    ${catBadge(s.category)}
    ${(s.stages || []).map((st) => `<span class="badge b-plain b-part">${esc(STAGE_LABEL[st])}</span>`).join("")}
    ${(s.sectors || []).filter((x) => x !== "sector-agnostic").map((sec) => `<span class="badge b-plain b-part">${esc(SECTOR_LABEL[sec])}</span>`).join("")}
  </div>
</header>

<section class="section" id="overview" style="margin-top:8px">
  <div class="body prose"><p class="lead">${esc(s.whatIsThis)}</p></div>
</section>

<div class="facts">
  <div class="fact"><div class="k">Type of support</div><div class="v">${catBadge(s.category)}</div></div>
  <div class="fact"><div class="k">Best suited for</div><div class="v">${esc(s.bestSuitedFor)}</div></div>
  ${s.maxFunding ? `<div class="fact"><div class="k">Headline amount</div><div class="v" style="color:var(--success)">${esc(s.maxFunding)}</div></div>` : ""}
  ${s.howMuch && s.howMuch !== s.maxFunding ? `<div class="fact"><div class="k">How much</div><div class="v">${esc(s.howMuch)}</div></div>` : ""}
  <div class="fact"><div class="k">Source</div><div class="v">${s.links && s.links[0] ? `<a href="${attr(s.links[0].url)}" target="_blank" rel="noopener">${esc(s.links[0].label || "Official page")} ↗</a>` : "—"}</div></div>
</div>

<section class="section" id="objectives">
  <h2><span class="sec-icon">${ICONS.target}</span>Objectives</h2>
  <div class="body prose">${paras(s.objectives)}</div>
</section>

<section class="section" id="eligibility">
  <h2><span class="sec-icon">${ICONS.clipboard}</span>Who can apply?</h2>
  <ul class="checklist">${s.eligibility.map((e) => `<li><span class="tick">${ICONS.check}</span><span>${esc(e)}</span></li>`).join("\n")}</ul>
</section>

<section class="section" id="benefits">
  <h2><span class="sec-icon">${ICONS.gift}</span>What do you get?</h2>
  <ul class="benefits">${s.benefits.map((b) => `<li><span class="gift">${ICONS.gift}</span><span>${esc(b)}</span></li>`).join("\n")}</ul>
</section>

<section class="section" id="apply">
  <h2><span class="sec-icon">${ICONS.send}</span>How to apply</h2>
  <div class="body prose">${paras(s.howToApply)}</div>
  ${applyUrl ? `<p style="margin-top:16px"><a class="btn btn-primary" href="${attr(applyUrl)}" target="_blank" rel="noopener">Go to official portal ${ICONS.external}</a></p>` : ""}
</section>

<section class="section" id="links">
  <h2><span class="sec-icon">${ICONS.link}</span>Key links</h2>
  ${(s.links || []).length ? `<div class="keylinks">${s.links.map((l) => `
    <a class="keylink" href="${attr(l.url)}" target="_blank" rel="noopener">${ICONS.external}<span>${esc(l.label)}<span class="url">${esc(l.url.replace(/^https?:\/\//, ""))}</span></span></a>`).join("")}</div>`
    : `<p class="muted">No links printed for this scheme — search the nodal ministry's site.</p>`}
  <div class="callout tone-warn"><span class="ic">${ICONS.info}</span><div>Details as most recently confirmed against the official source linked above. Deadlines, amounts and windows change — <strong>verify on the official portal before applying.</strong></div></div>
</section>

${rel.length ? `
<section class="section" id="related">
  <h2><span class="sec-icon">${ICONS.layers}</span>Related schemes</h2>
  <div class="related">${rel.map((r) => `
    <a href="${root}schemes/${r.slug}.html"><span class="rn">${esc(r.shortName || r.name)}</span><span class="rm">${esc(CAT_LABEL[r.category])}${r.shortName && r.shortName !== r.name ? ` · ${esc(r.name)}` : ""}</span></a>`).join("")}</div>
</section>` : ""}

<nav class="pagenav" aria-label="Adjacent schemes">
  ${prev ? `<a class="prev" href="${root}schemes/${prev.slug}.html"><span class="dir">← Previous</span><span class="t">${esc(prev.shortName || prev.name)}</span></a>` : "<span></span>"}
  ${next ? `<a class="next" href="${root}schemes/${next.slug}.html"><span class="dir">Next →</span><span class="t">${esc(next.shortName || next.name)}</span></a>` : "<span></span>"}
</nav>
</article>`;

  const ld = {
    "@context": "https://schema.org", "@type": "GovernmentService",
    name: s.name, alternateName: s.shortName || undefined,
    description: s.tagline, provider: { "@type": "GovernmentOrganization", name: s.ministry },
    areaServed: "US", url: applyUrl,
  };

  write(`schemes/${s.slug}.html`, shell({
    root, active: `schemes/${s.slug}.html`,
    title: s.shortName ? `${s.shortName} — ${s.name}` : s.name,
    description: s.tagline,
    body, toc,
    extraHead: `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  }));
});

/* ================= NEWS ================= */
{
  const srcNames = [...new Set(news.map((n) => n.source).filter(Boolean))];
  const latest = news.length ? fmtNewsDate(news[0].date) : "";
  const intro = news.length
    ? `The latest coverage of the US startup ecosystem — ${news.length} stories from ${srcNames.length} source${srcNames.length === 1 ? "" : "s"}, each linking straight to the publisher.`
    : `A source-linked feed of the latest coverage of the US startup ecosystem.`;
  const body = `
${crumbs("", [["Home", "index.html"], ["Ecosystem news", null]])}
<div class="page-head">
  <div class="kicker">Startup ecosystem${latest ? ` · latest ${esc(latest)}` : ""}</div>
  <h1>Ecosystem news</h1>
  <p class="lede">${esc(intro)}</p>
</div>
${news.length ? `
<div class="news-meta">
  <div class="callout tone-info" style="margin:0 0 22px">
    <span class="ic">${ICONS.info}</span>
    <div>Headlines are curated from reputable outlets covering the US startup ecosystem — each links straight to the publisher. Nothing here is written or edited by this site; always verify scheme details on the official portals.</div>
  </div>
  <div class="news-sources"><span class="ns-label">Sources in this feed</span>${srcNames.map((s) => `<span class="nc-tag">${esc(s)}</span>`).join("")}</div>
</div>
<div class="news-grid">
  ${news.map((n) => newsCard(n)).join("")}
</div>` : `
<div class="empty-state" style="margin-top:40px">
  <div class="big">📰</div>
  <h2 style="font-size:1.3rem">No news yet</h2>
  <p class="muted" style="margin-top:8px">This feed is populated from <code>data/news.json</code>. Add source-linked headlines there and rebuild.</p>
  <p style="margin-top:18px"><a class="btn btn-primary" href="directory.html">Browse all schemes</a></p>
</div>`}`;
  write("news.html", shell({ root: "", active: "news.html", title: "Ecosystem news", description: "Source-linked news about the US startup ecosystem — funding, policy, schemes and incubators.", body }));
}

/* ================= 404 ================= */
write("404.html", shell({
  root: PATH_PREFIX, active: "", title: "Page not found",
  description: "Page not found.",
  body: `<div class="empty-state" style="margin-top:60px"><div class="big">🧭</div><h1 style="font-size:1.5rem">That page doesn't exist</h1><p class="muted" style="margin-top:8px">The scheme may have been renamed. Try the search (<kbd>⌘K</kbd>) or start from the directory.</p><p style="margin-top:18px"><a class="btn btn-primary" href="${PATH_PREFIX}directory.html">Browse all schemes</a></p></div>`,
}));

/* ================= SEARCH INDEX ================= */
{
  const idx = [];
  for (const s of schemes) idx.push({
    t: s.name, s: s.shortName || "", m: s.ministry, d: s.tagline, u: `schemes/${s.slug}.html`, k: "scheme", c: s.category,
    g: [...(s.sectors || []).map((x) => SECTOR_LABEL[x]), ...(s.stages || []).map((x) => STAGE_LABEL[x]), CAT_LABEL[s.category], s.maxFunding].join(" "),
  });
  for (const g of NAV_PAGES.flatMap((x) => x.items)) idx.push({ t: g.title, u: g.href, k: "page", d: "" });
  for (const t of glossary.terms) idx.push({ t: t.term, u: `glossary.html#${slugify(t.term)}`, k: "glossary", d: t.definition.slice(0, 110) });
  for (const p of psu.programs) idx.push({ t: p.program, m: p.organization, u: "psu.html", k: "psu", d: `${p.organization} startup initiative`, g: p.organization });
  for (const st of states.states) idx.push({ t: `${st.name} startup portal`, u: `states.html#${slugify(st.name)}`, k: "state", d: st.program || "", g: st.name });
  const INC_TYPE_FULL = { SBDC: "Small Business Development Center", ICORPS: "NSF I-Corps Hub/Site", Academic: "Academic", Government: "Government", Private: "Private" };
  for (const r of incubators.incubators) idx.push({ t: r.name, m: r.host, u: `incubators.html?q=${encodeURIComponent(r.name)}`, k: "incubator", d: `${INC_TYPE_FULL[r.type] || r.type} · ${r.city}, ${r.state}`, g: `${r.host} ${r.city} ${r.state} ${(r.sectors || []).join(" ")}` });
  for (const st of stateSchemes.states) {
    if (st.schemes.length) idx.push({ t: `${st.state} startup schemes`, u: `state-schemes.html?state=${encodeURIComponent(st.state)}`, k: "state-scheme", d: st.policy || `${st.schemes.length} state schemes & incentives`, g: st.state });
    for (const sc of st.schemes) idx.push({ t: sc.name, m: st.state, u: `state-schemes.html?state=${encodeURIComponent(st.state)}&q=${encodeURIComponent(sc.name)}`, k: "state-scheme", d: `${st.state} · ${sc.type}${sc.benefit ? ` · ${sc.benefit}` : ""}`, g: `${st.state} ${sc.type}` });
  }
  writeFileSync(join(OUT, "assets", "search-index.js"), `window.SEARCH_INDEX=${JSON.stringify(idx)};`);
}

/* ================= ASSETS ================= */
cpSync(join(SITE, "tokens.css"), join(OUT, "assets", "tokens.css"));
cpSync(join(SITE, "site.css"), join(OUT, "assets", "site.css"));
cpSync(join(SITE, "site.js"), join(OUT, "assets", "site.js"));
cpSync(join(SITE, "walkable-core.js"), join(OUT, "assets", "walkable-core.js"));
cpSync(join(SITE, "walkable-3d-core.js"), join(OUT, "assets", "walkable-3d-core.js"));
cpSync(join(SITE, "walkable-3d.js"), join(OUT, "assets", "walkable-3d.js"));
cpSync(join(SITE, "vendor"), join(OUT, "assets", "vendor"), { recursive: true }); // three.js (MIT)
if (existsSync(join(SITE, "og.png"))) cpSync(join(SITE, "og.png"), join(OUT, "assets", "og.png"));
if (existsSync(join(SITE, "avatar.png"))) cpSync(join(SITE, "avatar.png"), join(OUT, "assets", "avatar.png"));

writeFileSync(join(OUT, "assets", "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#1f3864"/>
<rect x="12" y="16" width="40" height="7" rx="3.5" fill="#8c1d2b"/>
<rect x="12" y="28" width="40" height="7" rx="3.5" fill="#ffffff"/>
<rect x="12" y="40" width="40" height="7" rx="3.5" fill="#93b4e6"/>
</svg>`);
writeFileSync(join(OUT, ".nojekyll"), "");
writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE_BASE}sitemap.xml\n`);
writeFileSync(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.filter((p) => p !== "404.html").map((p) => `<url><loc>${SITE_BASE}${p === "index.html" ? "" : p}</loc></url>`).join("\n")}
</urlset>`);

/* ================= report ================= */
if (warnings.length) { console.warn(`\n⚠ ${warnings.length} warning(s):`); for (const w of warnings) console.warn("  • " + w); }
console.log(`\n✓ built ${pages.length} pages → docs/ (${schemes.length} schemes: ${partA.length} Part A, ${partB.length} Part B)`);
