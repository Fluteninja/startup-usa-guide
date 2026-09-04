# startup-usa-guide

**Federal and state funding programs for US startups — one searchable, source-linked reference, plus the visa and immigration pathways founders actually need.**

An independent guide to US startup funding: 80 federal programs, federal-agency innovation programs (AFWERX, DIU, NSIN, In-Q-Tel), 65 state-level incentive programs across all 50 states + DC, a 111-entry incubator/accelerator directory, every state's economic-development portal, and — the one thing the source template didn't have — a 7-pathway Visas & Immigration section for founders who aren't US citizens or permanent residents.

[**Live site**](https://fluteninja.github.io/startup-usa-guide/) · [**Explore the USA map**](https://fluteninja.github.io/startup-usa-guide/ecosystem-map.html) · [**Scheme Finder**](https://fluteninja.github.io/startup-usa-guide/finder.html) · [**All 80 programs**](https://fluteninja.github.io/startup-usa-guide/directory.html) · [**Compare**](https://fluteninja.github.io/startup-usa-guide/compare.html)

![Live on GitHub Pages](https://img.shields.io/badge/live-fluteninja.github.io-1f3864?style=flat-square&logo=githubpages&logoColor=white)
![Node ≥ 18](https://img.shields.io/badge/node-%E2%89%A5%2018-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/dependencies-zero-0E6B63?style=flat-square)
![WCAG 2.1 AA](https://img.shields.io/badge/contrast-WCAG%202.1%20AA-2f5fa8?style=flat-square)
![License: MIT](https://img.shields.io/badge/license-MIT-8c1d2b?style=flat-square)

This repo is an adaptation of [`startup-india-guide`](https://github.com/fritzhand/startup-india-guide), which documents India's central government startup schemes from a single official playbook PDF. The **engine** (`build.mjs`, `site/*.js`, `site/*.css`) is reused essentially unchanged — it was built to be content-agnostic. Everything in `data/*.json`, the palette in `site/tokens.css`, and the two map datasets were replaced for the US.

## What's on the site

| Page | What it does |
| --- | --- |
| [Overview](https://fluteninja.github.io/startup-usa-guide/) | Stats, browse by support/stage/sector, flagship programs |
| [Scheme Finder](https://fluteninja.github.io/startup-usa-guide/finder.html) | A 5-question decision tree pointing to relevant federal programs |
| [All programs](https://fluteninja.github.io/startup-usa-guide/directory.html) / [Compare](https://fluteninja.github.io/startup-usa-guide/compare.html) | Filter all 80 federal programs; compare up to three side by side |
| [Lifecycle Map](https://fluteninja.github.io/startup-usa-guide/lifecycle.html) | Ideation → prototype → seed → growth → market access |
| [What do you need?](https://fluteninja.github.io/startup-usa-guide/needs.html) | From a need (grant/loan/lab/buyers/IP/tax savings/**immigration status**) to what provides it |
| [Explore the USA map](https://fluteninja.github.io/startup-usa-guide/ecosystem-map.html) | Real state-shaped choropleth + a 3D walkable map (all 50 states + DC — Alaska/Hawaii as Albers-USA-style insets) |
| [State schemes](https://fluteninja.github.io/startup-usa-guide/state-schemes.html) | 65 state-level incentive programs across all 50 states + DC, each independently sourced |
| [Incubators directory](https://fluteninja.github.io/startup-usa-guide/incubators.html) | 111 real, individually-verified incubators/accelerators — at least one per state + DC, several major states with 3+ |
| [Federal innovation programs](https://fluteninja.github.io/startup-usa-guide/psu.html) | AFWERX, DIU, NSIN, In-Q-Tel, NASA, DOE national labs |
| [State portals](https://fluteninja.github.io/startup-usa-guide/states.html) | Every state's official economic-development directory entry |
| [**Visas & Immigration**](https://fluteninja.github.io/startup-usa-guide/immigration.html) | O-1A, EB-1A, EB-2 NIW, EB-5, International Entrepreneur Parole, E-2, L-1A — with eligibility, tradeoffs, and official USCIS/State Dept. sources |
| [Glossary](https://fluteninja.github.io/startup-usa-guide/glossary.html) / [About](https://fluteninja.github.io/startup-usa-guide/about.html) | US-specific terms; sourcing methodology and disclaimer |

## What changed from the India edition

| Area | India | USA |
| --- | --- | --- |
| Central schemes | 69 India-specific schemes tied to DPIIT recognition | 80 federal programs — now more than the India edition — spanning SBA loans & resource partners (7(a)/504/microloans/SBDC/SCORE/WBC/VBOC), SBIR/STTR, EDA Build to Scale & Tech Hubs, NSF I-Corps/Engines/Convergence Accelerator, federal contracting set-asides (8(a)/HUBZone/WOSB/VOSB/EDWOSB), R&D and manufacturing tax credits (45X, QSBS, Section 1244/195), Opportunity Zones, USPTO fee reductions/pro bono/Patents for Humanity, EXIM/DFC/USTDA export & development finance, MBDA, SBIC, SSBCI, DOE (LPO + OSBP + ARPA-E), USDA (REAP/RBDG/B&I/RMAP/AFRI/FSA microloans), NIST MEP, GSA Schedules & Startup Springboard, regional commissions (ARC/Delta/Northern Border/Denali), CDFI Fund programs, clean-energy ITC bonus credits, Manufacturing USA, and more |
| "PSU & regulator programs" | India's public-sector-undertaking corporate funds (ONGC, BHEL, ...) | Federal agency / defense innovation programs (AFWERX, DIU, NSIN, In-Q-Tel) — a genuine conceptual swap, not a content copy |
| Incubators | 220+ Technology Business Incubators / Atal Incubation Centres | 111 verified entries: SBA Small Business Development Centers, NSF I-Corps hubs, major accelerators (Y Combinator, Techstars, MassChallenge, gener8tor, Greentown Labs, mHUB), and 1-3+ named programs per state |
| Geography | India's real state/UT outlines + Himalaya/Deccan terrain | Real US state outlines for all 50 states + DC (Alaska/Hawaii as Albers-USA-style insets) via public GeoJSON, plus real mainland terrain (Rockies, Appalachians, 100+ rivers, 90+ lakes, 40+ named peaks) from Natural Earth |
| New feature | — | **Visas & Immigration Pathways** — a real, underserved gap with no India equivalent |
| Sourcing | One government PDF, extracted and machine-verified against it | No single source exists for the US — every entry cites its own specific official `.gov` page instead |
| Deleted concepts | DPIIT recognition, GST-linked benefits, import-duty exemptions | No direct US analog; folded into general SBA/EXIM framing where a real equivalent exists |

## How it works

```
Federal/state program research (multi-source, individually verified)
      │
      │  research → cite the specific official page → cross-check
      ▼
data/*.json                                     the content: 80 federal programs, decision tree,
      │                                         lifecycle, needs index, state schemes, incubators, immigration
      +
site/tokens.css + site.css + site.js            the skin (civic red/white/blue palette) + engine
      │                                         (reused from the India edition, content-agnostic)
      │
      │  node build.mjs                         zero dependencies, fails loudly
      ▼
docs/  →  GitHub Pages                          104 static pages, search, no runtime deps
```

Unlike the India edition, there is no single source document for US startup funding — no equivalent government playbook exists. Every program here is sourced independently against its own official page rather than one shared corpus; see [How the data was made](#how-the-data-was-made).

## Repo tour

```
startup-usa-guide/
├── site.config.json         # template knobs: site name, base URL, path prefix, repo
├── data/                    # the content — single source of truth
│   ├── schemes.json         # 80 federal programs: eligibility/benefits/links + tags
│   ├── decision-tree.json   # the 5-question finder
│   ├── lifecycle.json       # stage → programs map
│   ├── needs-index.json     # need → programs map
│   ├── state-schemes.json   # 65 state-level incentive programs, by state
│   ├── incubators.json      # 111 incubators/accelerators: location, type, sectors, website, lat/lng
│   ├── immigration.json     # 7 visa/immigration pathways for non-citizen founders
│   ├── usa-map.json         # projected + simplified US state outlines (see scripts/) for the maps
│   ├── usa-terrain.json     # relief, rivers, lakes and named peaks for the walkable map
│   ├── psu.json · states.json · glossary.json · about.json
│   └── aliases.json         # printed-name → slug overrides for cross-references
├── site/                    # the engine — consumed by build.mjs
│   ├── tokens.css           # the skin: civic navy/red/blue palette, light + dark
│   ├── site.css             # layout & component vocabulary; reads only tokens
│   ├── site.js              # search, filters, wizard, compare, incubator map, theme toggle
│   ├── walkable-core.js     # pure movement, zoom, timing and placement helpers
│   ├── walkable-3d-core.js  # pure terrain/height-field, noise and camera-rig math
│   ├── walkable-3d.js       # full-screen 3D USA world, controls, wayfinders and state drawers
│   └── vendor/              # three.js module build (MIT), the map's only runtime dependency
├── build.mjs                # data + site → docs/   (zero dependencies, Node ≥ 18)
├── scripts/geo.mjs               # projection/simplification helpers shared by the two data-prep tools
├── scripts/build-usa-map.mjs     # one-off: US GeoJSON → data/usa-map.json (state outlines + projection)
├── scripts/build-usa-terrain.mjs # one-off: Natural Earth → data/usa-terrain.json (same projection)
├── tests/                   # Node test-runner suite: map insets, walkable-map math, signposts
├── docs/                    # GENERATED — never hand-edit; what GitHub Pages serves
└── .github/workflows/deploy-pages.yml   # builds docs/ fresh and publishes it to gh-pages on push
```

## Working on the site

```bash
npm run build      # regenerate docs/ from data/ + site/
npm test            # engine unit tests (walkable-map layout, movement, timing)
npm run dev         # build and preview at http://localhost:8000
```

- **Content change**? Edit `data/*.json`, rebuild.
- **Design change**? Edit `site/tokens.css` (palette/fonts — civic navy, a muted brick red, and blue; a subtly American identity, not a literal flag lift) or `site/site.css` (components), rebuild.
- **Never edit `docs/`** — every build overwrites it.

## How the data was made

The India edition's playbook PDF has no US equivalent — there is no single government document listing every federal startup program. Instead, each of this site's 80 federal programs, 65 state programs, and 111 incubators was individually researched against its own official source (an `.gov` agency page, `irs.gov`, `uspto.gov`, or the organization's own site), with one specific, non-search-page URL cited on every entry. Programs that have sunset, paused, or (in one case, the Work Opportunity Tax Credit) lapsed pending reauthorization are flagged explicitly in their own entry rather than presented as unconditionally active.

## Map data

```
scripts/build-usa-map.mjs      fetches public US-states GeoJSON, projects and
                                simplifies it into data/usa-map.json (real state
                                shapes for the choropleth and walkable map)
scripts/build-usa-terrain.mjs  fetches Natural Earth 10m physical data, clips it
                                to the mapped US land, and writes
                                data/usa-terrain.json (relief/rivers/lakes/peaks)
```

| Dataset | Source | Terms |
|---|---|---|
| `data/usa-map.json` — state outlines (all 50 states + DC; AK/HI as insets) | [PublicaMundi/MappingAPI](https://github.com/PublicaMundi/MappingAPI) | MIT |
| `data/usa-terrain.json` — relief, rivers, lakes, peaks | [Natural Earth](https://www.naturalearthdata.com/) 10m physical, via [martynafford/natural-earth-geojson](https://github.com/martynafford/natural-earth-geojson) | Public domain |

Alaska and Hawaii are on the map as independently-projected insets (the same "Albers USA" composite convention used by the Census Bureau and most election maps) — each gets its own small self-contained projection rather than sharing the mainland's, since their true coordinates sit nowhere near it. Puerto Rico remains excluded from the map (a third inset wasn't judged worth the added clutter) but is still covered in `data/states.json` and `data/state-schemes.json`.

The walkable map renders with [three.js](https://threejs.org/) (MIT), vendored in `site/vendor/` so the site keeps building with zero npm dependencies.

## Deployment

[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds the site fresh (zero npm dependencies, so no install step) and pushes `docs/` to the `gh-pages` branch on every push to `master` that touches `data/`, `site/`, `scripts/`, or `build.mjs`. GitHub Pages serves that branch at **[fluteninja.github.io/startup-usa-guide](https://fluteninja.github.io/startup-usa-guide/)**.

## Honest limitations

- **A few state programs have sunset or paused for new applicants** (e.g. Maine's Pine Tree Development Zone, Rhode Island's Qualified Jobs Incentive Act, Montana's Big Sky Trust Fund) — each is flagged in its own entry in `data/state-schemes.json` rather than silently presented as active.
- **The Work Opportunity Tax Credit (WOTC)'s federal authorization lapsed** for wages paid after December 31, 2025, and had not been reauthorized as of this writing — its entry flags this explicitly rather than presenting it as unconditionally active.
- **Puerto Rico isn't on the map** (walkable or choropleth) and has no incubator/state-scheme entry yet — the plan treated territories as optional; Alaska and Hawaii are fully in.
- **Alaska and Hawaii's insets have no terrain** (flat land, like the rest of the map got before terrain was added) and their shapes are simplified more aggressively than the mainland to fit their small inset boxes — real outlines, just lower fidelity.
- **This is an independent reference, not a government website, and not legal, tax, or immigration advice** — especially true for the Visas & Immigration section.
- **Program details drift.** Every page links to its official source and carries a "verify before applying" notice for exactly that reason.

## License

MIT — see [LICENSE](LICENSE). Most program content describes US federal government works, which are generally public domain under 17 U.S.C. §105. State-program and accelerator content is summarized from each organization's own public materials with a link back to the source.

## Acknowledgments

Thanks to Jeremy Fritzhand ([@fritzhand](https://github.com/fritzhand)), whose [`startup-india-guide`](https://github.com/fritzhand/startup-india-guide) is the engine this project adapts, and who set this as the assignment that became this repo.
