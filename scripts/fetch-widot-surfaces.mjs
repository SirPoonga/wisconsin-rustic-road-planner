import { readFile, writeFile } from 'node:fs/promises';

const dataPath = new URL('../dist/data/wisconsin-rustic-roads.geojson', import.meta.url);
const outputPath = new URL('./widot-surfaces.json', import.meta.url);
const data = JSON.parse(await readFile(dataPath, 'utf8'));

function classifySurface(surfaces) {
  const values = [...surfaces].map(value => value.toLowerCase());
  const paved = values.some(value => /\bpaved?\b|\bpavement\b/.test(value));
  const unpaved = values.some(value => /\bunpaved\b|\bgravel\b|\bdirt\b|\bstone\b/.test(value));
  let surface = null;
  if (paved && unpaved) surface = 'Paved and unpaved';
  else if (paved) surface = 'Paved';
  else if (unpaved) surface = 'Unpaved';
  return { surface, paved, unpaved };
}

function normalizeSurface(value) {
  return String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').replace(/^\s*:\s*/, '').trim();
}

function pageSurface(markdown) {
  const match = String(markdown || '').match(/\*\*Surface:?\*\*\s*([^\n]+)/i)
    || String(markdown || '').match(/Surface:?\s*([^\n]+)/i);
  return normalizeSurface(match?.[1]);
}

async function fetchPageSurface(feature) {
  const url = feature.properties.url;
  if (!url) return null;
  const readerUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(readerUrl, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const surface = pageSurface(await response.text());
      if (surface) return { surface, source: 'WisDOT road page' };
    } catch {
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 750));
    }
  }
  return null;
}

// The page fetch above is the primary source. The public WisDOT ArcGIS layer
// is a segment-level fallback if a page is temporarily unavailable.
const endpoint = 'https://dotmaps.wi.gov/arcgis/rest/services/agohub/RUSTIC_ROAD/MapServer/0/query?where=1%3D1&outFields=RUSTICROADNUMBER%2CSURFACETYPE%2CLINK_TO_WEBPAGE&returnGeometry=false&f=json';
const response = await fetch(endpoint, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`WisDOT surface layer returned HTTP ${response.status}`);
const payload = await response.json();
if (payload.error) throw new Error(`WisDOT surface layer error: ${JSON.stringify(payload.error)}`);
const byNumber = new Map();
for (const feature of payload.features || []) {
  const attributes = feature.attributes || {};
  const number = Number(attributes.RUSTICROADNUMBER);
  if (!Number.isFinite(number)) continue;
  const entry = byNumber.get(number) || { surfaces: new Set(), url: attributes.LINK_TO_WEBPAGE || null };
  if (attributes.SURFACETYPE) entry.surfaces.add(normalizeSurface(attributes.SURFACETYPE));
  if (!entry.url && attributes.LINK_TO_WEBPAGE) entry.url = attributes.LINK_TO_WEBPAGE;
  byNumber.set(number, entry);
}

const verifiedPageSurfaces = {
  'Wisconsin Rustic Road 003': 'Paved',
  'Wisconsin Rustic Road 004': 'Unpaved',
  'Wisconsin Rustic Road 019': 'Paved',
  'Wisconsin Rustic Road 028': 'Paved and unpaved portions',
  'Wisconsin Rustic Road 048': 'Paved',
  'Wisconsin Rustic Road 083': 'Unpaved',
};

const pageResults = [];
let nextIndex = 0;
async function worker() {
  while (nextIndex < data.features.length) {
    const index = nextIndex++;
    pageResults[index] = await fetchPageSurface(data.features[index]);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

const results = data.features.map((feature, index) => {
  const title = feature.properties.title;
  const match = title.match(/(\d+)\s*$/);
  const number = match ? Number(match[1]) : null;
  const page = pageResults[index];
  const verifiedSurface = verifiedPageSurfaces[title];
  const source = number === null ? null : byNumber.get(number);
  const surfaceText = verifiedSurface || page?.surface;
  const classification = surfaceText ? classifySurface(new Set([surfaceText])) : classifySurface(source?.surfaces || new Set());
  return {
    title,
    url: feature.properties.url || source?.url || null,
    sourceUrl: source?.url || feature.properties.url || null,
    source: verifiedSurface ? 'WisDOT road page' : page?.source || 'WisDOT Rustic Roads ArcGIS layer',
    surfaceSegments: surfaceText ? [surfaceText] : source ? [...source.surfaces].sort() : [],
    ...classification,
  };
});

await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);

const missing = results.filter(item => !item.surface);
console.log(`Fetched ${results.length} WisDOT road records; ${results.length - missing.length} included surface data.`);
if (missing.length) console.log(`Missing surface data: ${missing.map(item => item.title).join(', ')}`);
