# startup-usa-guide

**Federal and state funding programs for US startups — one searchable, source-linked reference, plus the visa and immigration pathways founders actually need.**

An independent guide to US startup funding: 32 federal programs, federal-agency innovation programs (AFWERX, DIU, NSIN, In-Q-Tel), 65 state-level incentive programs across all 50 states + DC, a 91-entry incubator/accelerator directory covering all 49 mapped states, every state's economic-development portal, and — the one thing the source template didn't have — a 7-pathway Visas & Immigration section for founders who aren't US citizens or permanent residents.

This repo is an adaptation of [`startup-india-guide`](https://github.com/fritzhand/startup-india-guide), which documents India's central government startup schemes from a single official playbook PDF. The **engine** (`build.mjs`, `site/*.js`, `site/*.css`) is reused essentially unchanged — it was built to be content-agnostic. Everything in `data/*.json`, the palette in `site/tokens.css`, and the two map datasets were replaced for the US.

## What's on the site

| Page | What it does |
| --- | --- |
| Overview | Stats, browse by support/stage/sector, flagship programs |
| Scheme Finder | A 5-question decision tree pointing to relevant federal programs |
| All programs / Compare | Filter all 32 federal programs; compare up to three side by side |
| Lifecycle Map | Ideation → prototype → seed → growth → market access |
| What do you need? | From a need (grant/loan/lab/buyers/IP/tax savings/**immigration status**) to what provides it |
| Explore the USA map | Real state-shaped choropleth + a 3D walkable map (48 contiguous states + DC) |
| State schemes | 65 state-level incentive programs across all 50 states + DC, each independently sourced |
| Incubators directory | 91 real, individually-verified incubators/accelerators — at least one per mapped state |
| Federal innovation programs | AFWERX, DIU, NSIN, In-Q-Tel, NASA, DOE national labs |
| State portals | Every state's official economic-development directory entry |
| **Visas & Immigration** | O-1A, EB-1A, EB-2 NIW, EB-5, International Entrepreneur Parole, E-2, L-1A — with eligibility, tradeoffs, and official USCIS/State Dept. sources |
| Glossary / About | US-specific terms; sourcing methodology and disclaimer |

## What changed from the India edition

| Area | India | USA |
| --- | --- | --- |
| Central schemes | 69 India-specific schemes tied to DPIIT recognition | 32 federal programs (SBA loans, SBIR/STTR, EDA, NSF I-Corps, R&D tax credit, QSBS, Opportunity Zones, USPTO fee reductions & pro bono patents, EXIM, MBDA, SBIC, DOE, USDA, NIST MEP, ARPA-E, GSA Schedules, 8(a)/HUBZone, clean-energy ITC, Manufacturing USA, and more) |
| "PSU & regulator programs" | India's public-sector-undertaking corporate funds (ONGC, BHEL, ...) | Federal agency / defense innovation programs (AFWERX, DIU, NSIN, In-Q-Tel) — a genuine conceptual swap, not a content copy |
| Incubators | 220+ Technology Business Incubators / Atal Incubation Centres | 91 verified entries: SBA Small Business Development Centers, NSF I-Corps hubs, major accelerators (Y Combinator, Techstars, MassChallenge, gener8tor), and 1-2 named programs per state |
| Geography | India's real state/UT outlines + Himalaya/Deccan terrain | Real US state outlines (48 contiguous + DC) via public GeoJSON, plus real terrain (Rockies, Appalachians, 100+ rivers, 90+ lakes, 40+ named peaks) from Natural Earth; Alaska/Hawaii covered in data tables, not the map (see "Honest limitations") |
| New feature | — | **Visas & Immigration Pathways** — a real, underserved gap with no India equivalent |
| Sourcing | One government PDF, extracted and machine-verified against it | No single source exists for the US — every entry cites its own specific official `.gov` page instead |
| Deleted concepts | DPIIT recognition, GST-linked benefits, import-duty exemptions | No direct US analog; folded into general SBA/EXIM framing where a real equivalent exists |

Full build brief and rationale: see the project's planning notes (not tracked in this repo).

## Working on the site

```bash
npm run build      # regenerate docs/ from data/ + site/
npm test            # engine unit tests (walkable-map layout, movement, timing)
npm run dev         # build and preview at http://localhost:8000
```

- **Content change**? Edit `data/*.json`, rebuild.
- **Design change**? Edit `site/tokens.css` (palette/fonts — civic navy, a muted brick red, and green; a subtly American identity, not a literal flag lift) or `site/site.css` (components), rebuild.
- **Never edit `docs/`** — every build overwrites it.

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
| `data/usa-map.json` — state outlines (48 contiguous + DC) | [PublicaMundi/MappingAPI](https://github.com/PublicaMundi/MappingAPI) | MIT |
| `data/usa-terrain.json` — relief, rivers, lakes, peaks | [Natural Earth](https://www.naturalearthdata.com/) 10m physical, via [martynafford/natural-earth-geojson](https://github.com/martynafford/natural-earth-geojson) | Public domain |

Alaska, Hawaii, and Puerto Rico are excluded from the map itself (a naive equirectangular projection would either waste the canvas on ocean or shrink the mainland to a sliver) but remain fully covered in `data/states.json` and `data/state-schemes.json`.

## Honest limitations

- **A few state programs have sunset or paused for new applicants** (e.g. Maine's Pine Tree Development Zone, Rhode Island's Qualified Jobs Incentive Act, Montana's Big Sky Trust Fund) — each is flagged in its own entry in `data/state-schemes.json` rather than silently presented as active.
- **Alaska, Hawaii, and Puerto Rico aren't on the map** (walkable or choropleth) — a projection covering their true position would shrink the mainland to a sliver. Alaska and Hawaii are still fully covered in `data/states.json` and `data/state-schemes.json`; Puerto Rico is covered in neither yet.
- **This is an independent reference, not a government website, and not legal, tax, or immigration advice** — especially true for the Visas & Immigration section.
- **Program details drift.** Every page links to its official source and carries a "verify before applying" notice for exactly that reason.

## License

MIT — see [LICENSE](LICENSE). Most program content describes US federal government works, which are generally public domain under 17 U.S.C. §105. State-program and accelerator content is summarized from each organization's own public materials with a link back to the source.
