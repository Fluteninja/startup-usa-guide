/* The guide's public manifest for the Portfolio Map Network (wearenexus.xyz):
   who publishes it, its districts and a light index of its companies.
   build.mjs writes it to docs/portfolio-map.json; the Nexus reads it to show
   this guide as a world. The protocol is portfolio-map/1
   (https://github.com/fritzhand/portfolio-map-3d, docs/network.md).

   Here a "company" is an incubator or accelerator from data/incubators.json
   and a "district" is its type. Descriptions are null (the data has none) and
   no contact field is ever copied, so nothing is invented or personal. */

export const NEXUS_URL = "https://wearenexus.xyz";
export const NETWORK_ID = "startup-usa-guide";
export const NEXUS_META = "portfolio-map:nexus";
export const nexusHref = (via) => `${NEXUS_URL}/?world&from=${NETWORK_ID}${via ? `&via=${via}` : ""}`;

const TYPES = [
  { slug: "private", key: "Private", label: "Private accelerators", color: "#1f3864" },
  { slug: "academic", key: "Academic", label: "Academic", color: "#2f5fa8" },
  { slug: "government", key: "Government", label: "Government", color: "#8c1d2b" },
  { slug: "i-corps", key: "ICORPS", label: "NSF I-Corps hubs", color: "#0e6b63" },
  { slug: "sbdc", key: "SBDC", label: "Small Business Development Centers", color: "#b8860b" },
];

const slugify = (s) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function buildManifest({ incubators, siteBase, version, today = new Date().toISOString().slice(0, 10) }) {
  const url = siteBase.replace(/\/+$/, "");
  const seen = new Set();
  const companies = incubators.map((o) => {
    const type = TYPES.find((t) => t.key === o.type);
    if (!type) throw new Error(`manifest: "${o.name}" has an unknown type "${o.type}"`);
    let slug = slugify(o.name).slice(0, 48).replace(/-+$/, "");
    if (seen.has(slug)) slug = `${slug.slice(0, 40)}-${slugify(o.state)}`.replace(/-+$/, "").slice(0, 48);
    if (seen.has(slug)) throw new Error(`manifest: slug "${slug}" for "${o.name}" is not unique`);
    seen.add(slug);
    return {
      slug,
      name: o.name,
      district: type.slug,
      description: null,
      website: /^https:\/\//.test(o.website ?? "") ? o.website : null,
      keywords: (o.sectors ?? []).filter((k) => k.length <= 40).slice(0, 12),
    };
  });
  return {
    protocol: "portfolio-map/1",
    id: NETWORK_ID,
    name: "Startup USA Guide",
    publisher: { name: "Fluteninja", website: "https://github.com/Fluteninja/startup-usa-guide" },
    url,
    tagline: "Federal and state funding for US startups, with every incubator and accelerator mapped.",
    logo: `${url}/assets/favicon.svg`,
    accent: "#1f3864",
    nexus: NEXUS_URL,
    framework: { name: "startup-usa-guide", version },
    labels: { company: "incubator", companies: "incubators", district: "type", districts: "types", people: null },
    counts: { companies: companies.length, people: 0, districts: TYPES.length },
    districts: TYPES.map((t) => ({ slug: t.slug, label: t.label, color: t.color, count: companies.filter((c) => c.district === t.slug).length })),
    companies,
    updated: today,
  };
}
