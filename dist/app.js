const state = {
  roads: [],
  roadById: new Map(),
  selectedIds: new Set(),
  itinerary: [],
  start: null,
  end: null,
  pickMode: null,
  roadLayers: new Map(),
  pointMarkers: new Map(),
  routeLayers: [],
  lastWaypoints: [],
};

const els = {
  shell: document.querySelector('.app-shell'),
  roadList: document.querySelector('#roadList'),
  roadSearch: document.querySelector('#roadSearch'),
  selectedCount: document.querySelector('#selectedCount'),
  roadTotal: document.querySelector('#roadTotal'),
  itineraryList: document.querySelector('#itineraryList'),
  itineraryEmpty: document.querySelector('#itineraryEmpty'),
  startInput: document.querySelector('#startInput'),
  endInput: document.querySelector('#endInput'),
  addStopButton: document.querySelector('#addStopButton'),
  optimizeButton: document.querySelector('#optimizeButton'),
  buildRouteButton: document.querySelector('#buildRouteButton'),
  fitWisconsinButton: document.querySelector('#fitWisconsinButton'),
  pickBanner: document.querySelector('#pickBanner'),
  pickBannerText: document.querySelector('#pickBannerText'),
  cancelPickButton: document.querySelector('#cancelPickButton'),
  routeSummary: document.querySelector('#routeSummary'),
  routeMiles: document.querySelector('#routeMiles'),
  routeTime: document.querySelector('#routeTime'),
  routeRoads: document.querySelector('#routeRoads'),
  googleMapsLink: document.querySelector('#googleMapsLink'),
  loadingCard: document.querySelector('#loadingCard'),
  toast: document.querySelector('#toast'),
  mobileMapToggle: document.querySelector('#mobileMapToggle'),
};

const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([44.7, -89.7], 7);
L.control.zoom({ position: 'bottomright' }).addTo(map);
const baseLayers = {
  streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
  }),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: 'Map data &copy; OpenStreetMap contributors, style &copy; OpenTopoMap',
  }),
};
let activeBaseLayer = baseLayers.streets.addTo(map);

const roadsPane = map.createPane('roads');
roadsPane.style.zIndex = 410;
const selectedPane = map.createPane('selectedRoads');
selectedPane.style.zIndex = 420;
const routePane = map.createPane('route');
routePane.style.zIndex = 430;

function roadNumber(road) {
  const match = road.properties.title.match(/(?:Rustic\s+Road|R[- ]?)\s*0*(\d+)/i);
  return match ? Number(match[1]) : 999;
}

function roadLabel(road) {
  const n = roadNumber(road);
  return n === 999 ? road.properties.title : `Rustic Road ${n}`;
}

function roadMiles(road) {
  return (Number(road.properties.distance || 0) / 1609.344).toFixed(1);
}

function featureLatLngs(road) {
  const coords = road.geometry.coordinates;
  const lines = road.geometry.type === 'MultiLineString' ? coords : [coords];
  return lines.map(line => line.map(c => [c[1], c[0]]));
}

function flatCoordinates(road) {
  const coords = road.geometry.coordinates;
  const lines = road.geometry.type === 'MultiLineString' ? coords : [coords];
  return lines.flat().map(c => [c[0], c[1]]);
}

function roadCenter(road) {
  const coords = flatCoordinates(road);
  return coords[Math.floor(coords.length / 2)];
}

function shortDescription(road) {
  const note = (road.properties.notes || '').split(/https?:\/\//)[0].trim();
  if (!note) return 'Official Wisconsin Rustic Road';
  return note.length > 88 ? `${note.slice(0, 85).trim()}…` : note;
}

function initRoadLayer(road) {
  const layer = L.polyline(featureLatLngs(road), {
    pane: 'roads',
    color: '#536d58',
    weight: 3,
    opacity: 0.62,
  }).addTo(map);
  layer.bindTooltip(`${roadLabel(road)} · ${roadMiles(road)} mi`, { className: 'rustic-road-tooltip', sticky: true });
  layer.on('click', e => {
    L.DomEvent.stopPropagation(e);
    if (!state.pickMode) toggleRoad(road.properties.id);
  });
  state.roadLayers.set(road.properties.id, layer);
}

function styleRoad(id) {
  const layer = state.roadLayers.get(id);
  if (!layer) return;
  const selected = state.selectedIds.has(id);
  layer.setStyle({
    pane: selected ? 'selectedRoads' : 'roads',
    color: selected ? '#bc5f3d' : '#536d58',
    weight: selected ? 6 : 3,
    opacity: selected ? 0.95 : 0.62,
  });
  if (selected) layer.bringToFront();
}

function renderRoadList() {
  const q = els.roadSearch.value.trim().toLowerCase();
  const roads = state.roads.filter(road => {
    if (!q) return true;
    return `${roadLabel(road)} ${road.properties.notes || ''}`.toLowerCase().includes(q);
  });

  if (!roads.length) {
    els.roadList.innerHTML = '<div class="empty-search">No Rustic Roads match that search.</div>';
    return;
  }

  els.roadList.innerHTML = roads.map(road => {
    const id = road.properties.id;
    const selected = state.selectedIds.has(id);
    const n = roadNumber(road);
    return `<button class="road-card${selected ? ' selected' : ''}" data-road-id="${id}" role="listitem" aria-pressed="${selected}">
      <span class="mini-shield">${n === 999 ? 'R' : n}</span>
      <span class="road-copy"><strong>${roadLabel(road)}</strong><small>${roadMiles(road)} miles</small></span>
      <span class="road-check" aria-hidden="true">✓</span>
    </button>`;
  }).join('');
}

function toggleRoad(id) {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
    state.itinerary = state.itinerary.filter(item => !(item.type === 'road' && item.id === id));
  } else {
    if (state.selectedIds.size >= 12) {
      showToast('Choose up to 12 Rustic Roads per route.');
      return;
    }
    state.selectedIds.add(id);
    state.itinerary.push({ type: 'road', id });
  }
  clearRoute();
  styleRoad(id);
  renderRoadList();
  renderItinerary();
}

function renderItinerary() {
  els.selectedCount.textContent = state.selectedIds.size;
  els.itineraryEmpty.hidden = state.itinerary.length > 0;
  els.buildRouteButton.disabled = state.selectedIds.size === 0;
  els.itineraryList.innerHTML = state.itinerary.map((item, i) => {
    const isRoad = item.type === 'road';
    const road = isRoad ? state.roadById.get(item.id) : null;
    const title = isRoad ? roadLabel(road) : item.label;
    const subtitle = isRoad ? `${roadMiles(road)} scenic miles` : 'Intermediate stop';
    return `<li class="itinerary-item" data-index="${i}">
      <span class="item-order">${i + 1}</span>
      <span class="item-copy"><strong>${escapeHtml(title)}</strong><small>${subtitle}</small></span>
      <span class="item-buttons">
        <button data-move="up" aria-label="Move ${escapeHtml(title)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button data-move="down" aria-label="Move ${escapeHtml(title)} down" ${i === state.itinerary.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-remove aria-label="Remove ${escapeHtml(title)}">×</button>
      </span>
    </li>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function moveItem(index, direction) {
  const next = index + direction;
  if (next < 0 || next >= state.itinerary.length) return;
  [state.itinerary[index], state.itinerary[next]] = [state.itinerary[next], state.itinerary[index]];
  clearRoute();
  renderItinerary();
}

function removeItem(index) {
  const [item] = state.itinerary.splice(index, 1);
  if (item.type === 'road') {
    state.selectedIds.delete(item.id);
    styleRoad(item.id);
    renderRoadList();
  } else {
    const marker = state.pointMarkers.get(item.id);
    if (marker) marker.remove();
    state.pointMarkers.delete(item.id);
  }
  clearRoute();
  renderItinerary();
}

function setPickMode(mode) {
  state.pickMode = mode;
  if (!mode) {
    els.pickBanner.classList.remove('visible');
    map.getContainer().style.cursor = '';
    return;
  }
  const labels = { start: 'Click the map to set your start', end: 'Click the map to set your finish', stop: 'Click the map to add an intermediate stop' };
  els.pickBannerText.textContent = labels[mode];
  els.pickBanner.classList.add('visible');
  map.getContainer().style.cursor = 'crosshair';
  if (window.innerWidth <= 820) openMap();
}

function markerIcon(type, label = '') {
  const className = type === 'stop' ? 'stop-marker' : `endpoint-marker ${type}`;
  return L.divIcon({ className: '', html: `<div class="${className}" style="width:28px;height:28px">${escapeHtml(label)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
}

function placePoint(type, coordinate, label) {
  if (type === 'stop') {
    const id = `stop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const item = { type: 'stop', id, coordinate, label: label || `Stop ${state.itinerary.filter(i => i.type === 'stop').length + 1}` };
    state.itinerary.push(item);
    const marker = L.marker([coordinate[1], coordinate[0]], { icon: markerIcon('stop', '+'), draggable: true }).addTo(map);
    marker.bindTooltip(item.label);
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      item.coordinate = [p.lng, p.lat];
      item.label = 'Custom map stop';
      clearRoute();
      renderItinerary();
    });
    state.pointMarkers.set(id, marker);
  } else {
    const existing = state.pointMarkers.get(type);
    if (existing) existing.remove();
    state[type] = { coordinate, label: label || `Map ${type}` };
    els[`${type}Input`].value = state[type].label;
    const marker = L.marker([coordinate[1], coordinate[0]], { icon: markerIcon(type, type === 'start' ? 'A' : 'B'), draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      state[type].coordinate = [p.lng, p.lat];
      state[type].label = `Map ${type}`;
      els[`${type}Input`].value = state[type].label;
      clearRoute();
    });
    state.pointMarkers.set(type, marker);
  }
  clearRoute();
  renderItinerary();
}

async function geocode(type) {
  const input = els[`${type}Input`];
  const query = input.value.trim();
  if (!query) {
    const marker = state.pointMarkers.get(type);
    if (marker) marker.remove();
    state.pointMarkers.delete(type);
    state[type] = null;
    clearRoute();
    return;
  }
  input.disabled = true;
  try {
    const result = await findPlace(query);
    const coordinate = [Number(result.lon), Number(result.lat)];
    placePoint(type, coordinate, result.display_name.split(',').slice(0, 2).join(','));
    map.flyTo([coordinate[1], coordinate[0]], 11);
  } catch (error) {
    showToast(`Could not find “${query}”. Try a nearby city or pick the map.`);
  } finally {
    input.disabled = false;
  }
}

async function findPlace(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&viewbox=-92.89,47.31,-86.25,42.49&bounded=0&limit=1&q=${encodeURIComponent(query + ', Wisconsin')}`;
  const response = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!response.ok) throw new Error('Search unavailable');
  const [result] = await response.json();
  if (!result) throw new Error('No match');
  return result;
}

async function addSearchedStop(event) {
  event.preventDefault();
  const input = document.querySelector('#stopSearchInput');
  const button = document.querySelector('#stopSearchButton');
  const query = input.value.trim();
  if (!query) {
    input.focus();
    return;
  }
  input.disabled = true;
  button.disabled = true;
  button.textContent = '…';
  try {
    const result = await findPlace(query);
    const coordinate = [Number(result.lon), Number(result.lat)];
    const label = result.display_name.split(',').slice(0, 2).join(',');
    placePoint('stop', coordinate, label);
    map.flyTo([coordinate[1], coordinate[0]], 11);
    input.value = '';
    showToast(`${label} added to your visit order.`);
  } catch (error) {
    showToast(`Could not find “${query}”. Try a nearby town or add it on the map.`);
  } finally {
    input.disabled = false;
    button.disabled = false;
    button.textContent = 'Add';
    input.focus();
  }
}

function distance(a, b) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat/2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

function autoOrder() {
  if (state.itinerary.length < 2) {
    showToast('Choose at least two roads or stops to auto-order.');
    return;
  }
  const remaining = [...state.itinerary];
  const ordered = [];
  let current = state.start?.coordinate || itemCoordinate(remaining[0]);
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((item, i) => {
      const d = distance(current, itemCoordinate(item));
      if (d < bestDistance) { bestDistance = d; bestIndex = i; }
    });
    const [best] = remaining.splice(bestIndex, 1);
    ordered.push(best);
    current = itemCoordinate(best);
  }
  state.itinerary = ordered;
  clearRoute();
  renderItinerary();
  showToast('Stops reordered to reduce backtracking.');
}

function itemCoordinate(item) {
  return item.type === 'stop' ? item.coordinate : roadCenter(state.roadById.get(item.id));
}

function sampledRoadPoints(road, current) {
  let coords = flatCoordinates(road);
  if (coords.length < 2) return coords;
  if (current && distance(current, coords.at(-1)) < distance(current, coords[0])) coords = [...coords].reverse();
  const samples = Math.min(4, coords.length);
  const points = [];
  for (let i = 0; i < samples; i += 1) {
    points.push(coords[Math.round(i * (coords.length - 1) / (samples - 1))]);
  }
  return points;
}

function buildWaypoints() {
  const points = [];
  if (state.start) points.push(state.start.coordinate);
  let current = points.at(-1) || null;
  state.itinerary.forEach(item => {
    if (item.type === 'stop') {
      points.push(item.coordinate);
      current = item.coordinate;
    } else {
      const sampled = sampledRoadPoints(state.roadById.get(item.id), current);
      sampled.forEach(point => points.push(point));
      current = sampled.at(-1);
    }
  });
  if (state.end) points.push(state.end.coordinate);
  return points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > 0.02);
}

async function buildRoute() {
  if (!state.selectedIds.size) return;
  const waypoints = buildWaypoints();
  if (waypoints.length < 2) {
    showToast('Add another road or endpoint to build a route.');
    return;
  }
  clearRoute(false);
  els.loadingCard.classList.add('visible');
  if (window.innerWidth <= 820) openMap();
  try {
    const coordinates = waypoints.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Routing service error');
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route found');
    const route = data.routes[0];
    const latLngs = route.geometry.coordinates.map(c => [c[1], c[0]]);
    const casing = L.polyline(latLngs, { pane: 'route', color: '#fffdf7', weight: 10, opacity: .9, lineJoin: 'round' }).addTo(map);
    const routeLine = L.polyline(latLngs, { pane: 'route', color: '#bc5f3d', weight: 6, opacity: .98, lineJoin: 'round' }).addTo(map);
    state.routeLayers = [casing, routeLine];
    state.lastWaypoints = waypoints;
    map.fitBounds(routeLine.getBounds(), { padding: [55, 55] });
    showRouteSummary(route.distance, route.duration, waypoints);
  } catch (error) {
    showToast('The routing service could not connect these stops. Try fewer roads or a different order.');
    console.error(error);
  } finally {
    els.loadingCard.classList.remove('visible');
  }
}

function showRouteSummary(meters, seconds, waypoints) {
  els.routeMiles.textContent = Math.round(meters / 1609.344).toLocaleString();
  els.routeTime.textContent = formatDuration(seconds);
  els.routeRoads.textContent = state.selectedIds.size;
  const origin = waypoints[0];
  const destination = waypoints.at(-1);
  const intermediate = waypoints.slice(1, -1).slice(0, 9);
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin[1]},${origin[0]}`,
    destination: `${destination[1]},${destination[0]}`,
    travelmode: 'driving',
  });
  if (intermediate.length) params.set('waypoints', intermediate.map(c => `${c[1]},${c[0]}`).join('|'));
  els.googleMapsLink.href = `https://www.google.com/maps/dir/?${params}`;
  els.routeSummary.classList.add('visible');
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (!hours) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function clearRoute(hideSummary = true) {
  state.routeLayers.forEach(layer => layer.remove());
  state.routeLayers = [];
  if (hideSummary) els.routeSummary.classList.remove('visible');
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 3500);
}

function openMap() {
  els.shell.classList.add('map-open');
  setTimeout(() => map.invalidateSize(), 50);
}

function closeMap() {
  els.shell.classList.remove('map-open');
}

async function loadRoads() {
  try {
    const response = await fetch('data/wisconsin-rustic-roads.geojson');
    if (!response.ok) throw new Error('Dataset unavailable');
    const data = await response.json();
    state.roads = data.features.sort((a, b) => roadNumber(a) - roadNumber(b));
    state.roads.forEach(road => {
      state.roadById.set(road.properties.id, road);
      initRoadLayer(road);
    });
    els.roadTotal.textContent = state.roads.length;
    renderRoadList();
    const allBounds = L.featureGroup([...state.roadLayers.values()]).getBounds();
    requestAnimationFrame(() => {
      map.invalidateSize();
      map.fitBounds(allBounds, { padding: [30, 30] });
    });
  } catch (error) {
    els.roadList.innerHTML = '<div class="empty-search">The road dataset could not be loaded. Refresh to try again.</div>';
    showToast('Could not load the Rustic Roads dataset.');
  }
}

els.roadList.addEventListener('click', event => {
  const card = event.target.closest('[data-road-id]');
  if (card) toggleRoad(card.dataset.roadId);
});

els.roadSearch.addEventListener('input', renderRoadList);
document.addEventListener('keydown', event => {
  if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
    event.preventDefault();
    els.roadSearch.focus();
  }
  if (event.key === 'Escape') setPickMode(null);
});

els.itineraryList.addEventListener('click', event => {
  const row = event.target.closest('[data-index]');
  if (!row) return;
  const index = Number(row.dataset.index);
  if (event.target.closest('[data-remove]')) removeItem(index);
  if (event.target.closest('[data-move="up"]')) moveItem(index, -1);
  if (event.target.closest('[data-move="down"]')) moveItem(index, 1);
});

document.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => setPickMode(button.dataset.pick)));
els.addStopButton.addEventListener('click', () => setPickMode('stop'));
els.cancelPickButton.addEventListener('click', () => setPickMode(null));
els.optimizeButton.addEventListener('click', autoOrder);
els.buildRouteButton.addEventListener('click', buildRoute);
els.fitWisconsinButton.addEventListener('click', () => map.fitBounds(L.featureGroup([...state.roadLayers.values()]).getBounds(), { padding: [30, 30] }));
els.startInput.addEventListener('change', () => geocode('start'));
els.endInput.addEventListener('change', () => geocode('end'));
els.mobileMapToggle.addEventListener('click', openMap);
document.querySelector('#closeMapButton').addEventListener('click', closeMap);
document.querySelector('#stopSearchForm').addEventListener('submit', addSearchedStop);
document.querySelector('#mapStyleSelect').addEventListener('change', event => {
  const nextLayer = baseLayers[event.target.value];
  if (!nextLayer || nextLayer === activeBaseLayer) return;
  map.removeLayer(activeBaseLayer);
  activeBaseLayer = nextLayer.addTo(map);
});
document.querySelector('#summaryClose').addEventListener('click', () => els.routeSummary.classList.remove('visible'));
document.querySelector('#editRouteButton').addEventListener('click', () => {
  els.routeSummary.classList.remove('visible');
  if (window.innerWidth <= 820) closeMap();
});

map.on('click', event => {
  if (!state.pickMode) return;
  const type = state.pickMode;
  placePoint(type, [event.latlng.lng, event.latlng.lat]);
  setPickMode(null);
  if (type === 'stop') showToast('Stop added. Use the arrows to place it in your trip order.');
});

loadRoads();
