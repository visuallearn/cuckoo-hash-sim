// Fetch and cache the generated data. Relative paths only: the site lives under
// /<repo>/ on GitHub Pages, never at a domain root.

const cache = new Map();

async function getJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(path, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  });
  cache.set(path, p);
  return p;
}

export function loadManifest() { return getJSON('data/manifest.json'); }
export function loadCode() { return getJSON('data/source/code.json'); }
export function loadGolden() { return getJSON('data/rng-golden.json'); }

export function scenarioOf(manifest, id) {
  return manifest.scenarios.find((s) => s.id === id) || null;
}

export function scenariosOf(manifest, structure) {
  return manifest.scenarios.filter((s) => s.structure === structure);
}

export async function loadTrace(manifest, id) {
  const sc = scenarioOf(manifest, id);
  if (!sc) throw new Error(`unknown scenario ${id}`);
  const t = await getJSON('data/' + sc.file);
  // A corrupted or half-written file should say so loudly rather than render as
  // a blank diagram.
  if (t.schemaVersion !== 1) throw new Error(`${sc.file}: unexpected schemaVersion`);
  if (t.id !== id) throw new Error(`${sc.file}: holds ${t.id}, not ${id}`);
  if (t.params.numBuckets !== sc.numBuckets) {
    throw new Error(`${sc.file}: numBuckets does not match the manifest`);
  }
  return t;
}
