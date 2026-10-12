/* The Nexus manifest (scripts/manifest.mjs) must add up the way the network
   protocol checks it: counts match, every slug is unique and valid, every
   company sits in a declared district, and no contact data travels. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildManifest } from "../scripts/manifest.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const incubators = JSON.parse(readFileSync(join(ROOT, "data", "incubators.json"), "utf8")).incubators;
const m = buildManifest({ incubators, siteBase: "https://fluteninja.github.io/startup-usa-guide/", version: "1.0.0", today: "2026-10-12" });

test("counts add up", () => {
  assert.equal(m.counts.companies, incubators.length);
  assert.equal(m.companies.length, incubators.length);
  assert.equal(m.districts.reduce((n, d) => n + d.count, 0), incubators.length);
});

test("slugs are unique protocol ids and districts exist", () => {
  const slugs = new Set(m.companies.map((c) => c.slug));
  assert.equal(slugs.size, m.companies.length);
  const districts = new Set(m.districts.map((d) => d.slug));
  for (const c of m.companies) {
    assert.match(c.slug, /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,47}$/);
    assert.ok(districts.has(c.district), c.slug);
  }
});

test("urls are https without a trailing slash and no contact data", () => {
  assert.equal(m.url, "https://fluteninja.github.io/startup-usa-guide");
  for (const c of m.companies) assert.ok(c.website === null || c.website.startsWith("https://"), c.slug);
  assert.doesNotMatch(JSON.stringify(m), /@[\w-]+\.\w|\b\d{3}[-. )]+\d{3}[-. ]\d{4}\b/);
});
