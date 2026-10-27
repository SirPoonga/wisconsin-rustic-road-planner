import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../../rustic-roads-data/wisconsin-rustic-roads.geojson', import.meta.url);
const target = new URL('../dist/data/wisconsin-rustic-roads.geojson', import.meta.url);
const raw = JSON.parse(await readFile(source, 'utf8'));

function cleanCoordinates(value) {
  if (typeof value[0] === 'number') return [value[0], value[1]];
  return value.map(cleanCoordinates);
}

function officialUrl(notes) {
  const match = String(notes || '').match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

const cleaned = {
  type: 'FeatureCollection',
  features: raw.features
    .filter(feature => feature?.geometry && feature?.properties?.is_active !== false)
    .map(feature => ({
      type: 'Feature',
      properties: {
        id: feature.properties.id,
        title: feature.properties.title,
        notes: feature.properties.notes || '',
        url: officialUrl(feature.properties.notes),
        distance: feature.properties.distance || 0,
        latitude: feature.properties.latitude,
        longitude: feature.properties.longitude,
      },
      geometry: {
        type: feature.geometry.type,
        coordinates: cleanCoordinates(feature.geometry.coordinates),
      },
    })),
};

await writeFile(target, JSON.stringify(cleaned));
console.log(`Prepared ${cleaned.features.length} active Rustic Roads.`);
