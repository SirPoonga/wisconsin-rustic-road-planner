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
  routeCoordinates: [],
  gpxUrl: null,
  highlightLayer: null,
  activeHighlightKey: null,
  pinnedHighlightKey: null,
};

const STORAGE_KEY = 'wisconsin-rustic-road-planner-state-v1';
const MAX_ROADS = 25;

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
  clearTripButton: document.querySelector('#clearTripButton'),
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
  googleLegs: document.querySelector('#googleLegs'),
  routeNote: document.querySelector('#routeNote'),
  downloadGpxLink: document.querySelector('#downloadGpxLink'),
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
routePane.style.pointerEvents = 'none';
const highlightPane = map.createPane('highlight');
highlightPane.style.zIndex = 440;
highlightPane.style.pointerEvents = 'none';

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

function roadEndpoints(road) {
  const coords = flatCoordinates(road);
  return { a: coords[0], b: coords.at(-1) };
}

function visitsBothEnds(item) {
  if (typeof item.visitBothEnds === 'boolean') return item.visitBothEnds;
  if (item.endpoints) return item.endpoints.a !== false && item.endpoints.b !== false;
  return true;
}

function roadItineraryItem(id, saved = null) {
  return {
    type: 'road',
    id,
    visitBothEnds: typeof saved?.visitBothEnds === 'boolean'
      ? saved.visitBothEnds
      : saved?.endpoints
        ? saved.endpoints.a !== false && saved.endpoints.b !== false
        : true,
  };
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
    clearHighlightForKey(`road:${id}`);
    state.selectedIds.delete(id);
    state.itinerary = state.itinerary.filter(item => !(item.type === 'road' && item.id === id));
  } else {
    if (state.selectedIds.size >= MAX_ROADS) {
      showToast(`Choose up to ${MAX_ROADS} Rustic Roads per route.`);
      return;
    }
    state.selectedIds.add(id);
    state.itinerary.push(roadItineraryItem(id));
  }
  clearRoute();
  styleRoad(id);
  renderRoadList();
  renderItinerary();
  savePlannerState();
}

function renderItinerary() {
  els.selectedCount.textContent = state.selectedIds.size;
  els.itineraryEmpty.hidden = state.itinerary.length > 0;
  els.buildRouteButton.disabled = state.selectedIds.size === 0;
  els.clearTripButton.disabled = state.itinerary.length === 0 && !state.start && !state.end;
  els.itineraryList.innerHTML = state.itinerary.map((item, i) => {
    const isRoad = item.type === 'road';
    const road = isRoad ? state.roadById.get(item.id) : null;
    const title = isRoad ? roadLabel(road) : item.label;
    const subtitle = isRoad ? `${roadMiles(road)} scenic miles` : 'Intermediate stop';
    const key = itineraryItemKey(item);
    const highlighted = key === state.activeHighlightKey;
    const endpointControls = isRoad ? `<span class="road-endpoints">
      <label class="road-endpoint-toggle" title="Drive through both endpoints of ${escapeHtml(title)}"><input type="checkbox" data-visit-both-ends ${visitsBothEnds(item) ? 'checked' : ''} aria-label="Visit both ends of ${escapeHtml(title)}"> Visit both ends</label>
    </span>` : '';
    return `<li class="itinerary-item${highlighted ? ' is-map-highlighted' : ''}" data-index="${i}" data-item-key="${escapeHtml(key)}" tabindex="0" aria-label="Highlight ${escapeHtml(title)} on the map">
      <span class="item-order">${i + 1}</span>
      <span class="item-copy"><strong>${escapeHtml(title)}</strong><small>${subtitle}</small>${endpointControls}</span>
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

function itineraryItemKey(item) {
  return `${item.type}:${item.id}`;
}

function itineraryItemForKey(key) {
  return state.itinerary.find(item => itineraryItemKey(item) === key) || null;
}

function mapItemForKey(key) {
  if (key === 'endpoint:start' && state.start) return { type: 'endpoint', id: 'start', ...state.start };
  if (key === 'endpoint:end' && state.end) return { type: 'endpoint', id: 'end', ...state.end };
  return itineraryItemForKey(key);
}

function updateEndpointRows() {
  document.querySelectorAll('.location-row[data-location]').forEach(row => {
    const hasLocation = Boolean(state[row.dataset.location]);
    row.classList.toggle('has-location', hasLocation);
    row.tabIndex = hasLocation ? 0 : -1;
  });
}

function clearMapHighlight() {
  if (state.highlightLayer) state.highlightLayer.remove();
  state.highlightLayer = null;
  const previous = mapItemForKey(state.activeHighlightKey);
  if (previous && previous.type !== 'road') {
    const marker = state.pointMarkers.get(previous.id);
    marker?.setZIndexOffset(0);
    marker?.getElement()?.classList.remove('itinerary-marker-highlight');
  }
  state.activeHighlightKey = null;
  els.itineraryList.querySelectorAll('[data-item-key]').forEach(row => row.classList.remove('is-map-highlighted'));
  document.querySelectorAll('.location-row[data-highlight-key]').forEach(row => row.classList.remove('is-map-highlighted'));
}

function setMapHighlight(key) {
  if (key === state.activeHighlightKey) return;
  clearMapHighlight();
  const item = mapItemForKey(key);
  if (!item) return;

  state.activeHighlightKey = key;
  els.itineraryList.querySelectorAll('[data-item-key]').forEach(row => {
    row.classList.toggle('is-map-highlighted', row.dataset.itemKey === key);
  });
  document.querySelectorAll('.location-row[data-highlight-key]').forEach(row => {
    row.classList.toggle('is-map-highlighted', row.dataset.highlightKey === key);
  });

  if (item.type === 'road') {
    const road = state.roadById.get(item.id);
    const endpoints = roadEndpoints(road);
    const roadIndex = state.itinerary.indexOf(item);
    const singleEndpoint = visitsBothEnds(item) ? null : preferredSingleEndpoint(item, roadIndex);
    const layers = [];
    if (visitsBothEnds(item)) {
      layers.push(L.polyline(featureLatLngs(road), {
        pane: 'highlight',
        color: '#d8a83e',
        weight: 10,
        opacity: 1,
        lineJoin: 'round',
        interactive: false,
      }));
    }
    const previous = roadIndex > 0 ? itemCoordinate(state.itinerary[roadIndex - 1]) : state.start?.coordinate || null;
    const next = nextItineraryCoordinate(roadIndex);
    const ordered = visitsBothEnds(item)
      ? orderedRoadEndpoints(road, previous, next)
      : [{ key: singleEndpoint, coordinate: endpoints[singleEndpoint] }];
    const endpointMarkers = ['a', 'b'].map(endpoint => {
      const coordinate = endpoints[endpoint];
      const visitIndex = ordered.findIndex(entry => entry.key === endpoint);
      const included = visitIndex !== -1;
      const icon = L.divIcon({
        className: '',
        html: `<div class="road-endpoint-map-marker${included ? ' included' : ''}">${included ? visitIndex + 1 : endpoint.toUpperCase()}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      return L.marker([coordinate[1], coordinate[0]], { pane: 'highlight', icon, interactive: false });
    });
    state.highlightLayer = L.layerGroup([...layers, ...endpointMarkers]).addTo(map);
    return;
  }

  const marker = state.pointMarkers.get(item.id);
  marker?.setZIndexOffset(1000);
  marker?.getElement()?.classList.add('itinerary-marker-highlight');
  state.highlightLayer = L.circleMarker([item.coordinate[1], item.coordinate[0]], {
    pane: 'highlight',
    radius: 18,
    color: '#d8a83e',
    weight: 4,
    fillColor: '#fffdf7',
    fillOpacity: .42,
    interactive: false,
  }).addTo(map);
}

function clearHighlightForKey(key) {
  if (state.pinnedHighlightKey === key) state.pinnedHighlightKey = null;
  if (state.activeHighlightKey === key) setMapHighlight(null);
}

function focusMapItem(key) {
  const item = mapItemForKey(key);
  if (!item) return;
  state.pinnedHighlightKey = key;
  setMapHighlight(key);

  const focusMap = () => {
    if (item.type === 'road') {
      const layer = state.roadLayers.get(item.id);
      if (layer) map.fitBounds(layer.getBounds(), { padding: [80, 80], maxZoom: 13 });
    } else {
      map.flyTo([item.coordinate[1], item.coordinate[0]], Math.max(map.getZoom(), 12), { duration: .6 });
    }
  };

  if (window.innerWidth <= 820) {
    openMap();
    setTimeout(focusMap, 80);
  } else {
    focusMap();
  }
}

function isCoordinate(value) {
  return Array.isArray(value)
    && value.length === 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90;
}

function storedPoint(point) {
  if (!point || !isCoordinate(point.coordinate)) return null;
  return {
    coordinate: [...point.coordinate],
    label: String(point.label || '').slice(0, 160),
  };
}

function savePlannerState() {
  const itinerary = state.itinerary.map(item => {
    if (item.type === 'road') return {
      type: 'road',
      id: item.id,
      visitBothEnds: visitsBothEnds(item),
    };
    return {
      type: 'stop',
      coordinate: [...item.coordinate],
      label: String(item.label || '').slice(0, 160),
    };
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      itinerary,
      start: storedPoint(state.start),
      end: storedPoint(state.end),
    }));
  } catch (error) {
    console.warn('Could not save the trip in this browser.', error);
  }
}

function moveItem(index, direction) {
  const next = index + direction;
  if (next < 0 || next >= state.itinerary.length) return;
  [state.itinerary[index], state.itinerary[next]] = [state.itinerary[next], state.itinerary[index]];
  clearRoute();
  renderItinerary();
  savePlannerState();
}

function removeItem(index) {
  const item = state.itinerary[index];
  if (!item) return;
  clearHighlightForKey(itineraryItemKey(item));
  state.itinerary.splice(index, 1);
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
  savePlannerState();
}

let clearTripTimer;

function resetClearTripConfirmation() {
  clearTimeout(clearTripTimer);
  delete els.clearTripButton.dataset.confirming;
  els.clearTripButton.textContent = 'Clear saved trip';
}

function clearTrip() {
  if (els.clearTripButton.dataset.confirming !== 'true') {
    els.clearTripButton.dataset.confirming = 'true';
    els.clearTripButton.textContent = 'Click again to clear';
    showToast('Click “Clear saved trip” again to remove every saved road and point.');
    clearTripTimer = setTimeout(resetClearTripConfirmation, 5000);
    return;
  }

  resetClearTripConfirmation();
  clearMapHighlight();
  state.pinnedHighlightKey = null;
  const roadIds = [...state.selectedIds];
  state.selectedIds.clear();
  state.itinerary = [];
  state.start = null;
  state.end = null;
  state.lastWaypoints = [];
  state.pointMarkers.forEach(marker => marker.remove());
  state.pointMarkers.clear();
  els.startInput.value = '';
  els.endInput.value = '';
  updateEndpointRows();
  setPickMode(null);
  clearRoute();
  roadIds.forEach(styleRoad);
  renderRoadList();
  renderItinerary();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Could not clear the saved trip from this browser.', error);
  }
  showToast('Saved trip cleared.');
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

function createStopMarker(item) {
  const marker = L.marker([item.coordinate[1], item.coordinate[0]], { icon: markerIcon('stop', '+'), draggable: true }).addTo(map);
  marker.bindTooltip(item.label);
  marker.on('dragend', () => {
    const p = marker.getLatLng();
    item.coordinate = [p.lng, p.lat];
    item.label = 'Custom map stop';
    clearRoute();
    renderItinerary();
    savePlannerState();
  });
  state.pointMarkers.set(item.id, marker);
}

function createEndpointMarker(type, point) {
  const marker = L.marker([point.coordinate[1], point.coordinate[0]], { icon: markerIcon(type, type === 'start' ? 'A' : 'B'), draggable: true }).addTo(map);
  marker.on('dragend', () => {
    const p = marker.getLatLng();
    state[type].coordinate = [p.lng, p.lat];
    state[type].label = `Map ${type}`;
    els[`${type}Input`].value = state[type].label;
    clearRoute();
    savePlannerState();
  });
  state.pointMarkers.set(type, marker);
}

function restorePlannerState() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    console.warn('Could not restore the saved trip from this browser.', error);
    return false;
  }

  if (saved?.version !== 1 || !Array.isArray(saved.itinerary)) return false;

  saved.itinerary.forEach((item, index) => {
    if (item?.type === 'road') {
      const id = String(item.id || '');
      if (state.roadById.has(id) && !state.selectedIds.has(id) && state.selectedIds.size < MAX_ROADS) {
        state.selectedIds.add(id);
        state.itinerary.push(roadItineraryItem(id, item));
      }
      return;
    }

    if (item?.type === 'stop' && isCoordinate(item.coordinate)) {
      const stopNumber = state.itinerary.filter(entry => entry.type === 'stop').length + 1;
      const restoredStop = {
        type: 'stop',
        id: `stop-restored-${index}-${Math.random().toString(16).slice(2)}`,
        coordinate: [...item.coordinate],
        label: String(item.label || `Stop ${stopNumber}`).slice(0, 160),
      };
      state.itinerary.push(restoredStop);
      createStopMarker(restoredStop);
    }
  });

  ['start', 'end'].forEach(type => {
    const point = storedPoint(saved[type]);
    if (!point) return;
    point.label = point.label || `Map ${type}`;
    state[type] = point;
    els[`${type}Input`].value = point.label;
    createEndpointMarker(type, point);
  });
  updateEndpointRows();

  return state.itinerary.length > 0 || Boolean(state.start) || Boolean(state.end);
}

function placePoint(type, coordinate, label) {
  if (type === 'stop') {
    const id = `stop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const item = { type: 'stop', id, coordinate, label: label || `Stop ${state.itinerary.filter(i => i.type === 'stop').length + 1}` };
    state.itinerary.push(item);
    createStopMarker(item);
  } else {
    clearHighlightForKey(`endpoint:${type}`);
    const existing = state.pointMarkers.get(type);
    if (existing) existing.remove();
    state[type] = { coordinate, label: label || `Map ${type}` };
    els[`${type}Input`].value = state[type].label;
    createEndpointMarker(type, state[type]);
    updateEndpointRows();
  }
  clearRoute();
  renderItinerary();
  savePlannerState();
}

async function geocode(type) {
  const input = els[`${type}Input`];
  const query = input.value.trim();
  if (!query) {
    clearHighlightForKey(`endpoint:${type}`);
    const marker = state.pointMarkers.get(type);
    if (marker) marker.remove();
    state.pointMarkers.delete(type);
    state[type] = null;
    updateEndpointRows();
    clearRoute();
    savePlannerState();
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
  savePlannerState();
  showToast('Stops reordered to reduce backtracking.');
}

function itemCoordinate(item) {
  return item.type === 'stop' ? item.coordinate : roadCenter(state.roadById.get(item.id));
}

function preferredSingleEndpoint(item, index, current = null) {
  const endpoints = roadEndpoints(state.roadById.get(item.id));
  const previous = current || state.start?.coordinate || (index > 0 ? itemCoordinate(state.itinerary[index - 1]) : null);
  const next = index < state.itinerary.length - 1
    ? itemCoordinate(state.itinerary[index + 1])
    : state.end?.coordinate || null;
  if (!previous && !next) return 'a';
  const score = endpoint => (previous ? distance(previous, endpoint) : 0) + (next ? distance(endpoint, next) : 0);
  return score(endpoints.b) < score(endpoints.a) ? 'b' : 'a';
}

function shouldReverseRoad(road, current = null, next = null) {
  const endpoints = roadEndpoints(road);
  const forwardScore = (current ? distance(current, endpoints.a) : 0)
    + (next ? distance(endpoints.b, next) : 0);
  const reverseScore = (current ? distance(current, endpoints.b) : 0)
    + (next ? distance(endpoints.a, next) : 0);
  return reverseScore < forwardScore;
}

function orderedRoadEndpoints(road, current = null, next = null) {
  const endpoints = roadEndpoints(road);
  return shouldReverseRoad(road, current, next)
    ? [{ key: 'b', coordinate: endpoints.b }, { key: 'a', coordinate: endpoints.a }]
    : [{ key: 'a', coordinate: endpoints.a }, { key: 'b', coordinate: endpoints.b }];
}

function sampledRoadPoints(road, current, next = null) {
  const coords = flatCoordinates(road);
  if (coords.length < 2) return coords;
  const indexes = [0];
  if (coords.length > 2) indexes.push(Math.round((coords.length - 1) / 3));
  if (coords.length > 3) indexes.push(Math.round(2 * (coords.length - 1) / 3));
  indexes.push(coords.length - 1);
  const points = [...new Set(indexes)].map(index => coords[index]);
  return shouldReverseRoad(road, current, next) ? points.reverse() : points;
}

function nextItineraryCoordinate(index) {
  if (index < state.itinerary.length - 1) return itemCoordinate(state.itinerary[index + 1]);
  return state.end?.coordinate || null;
}

function buildWaypoints() {
  const points = [];
  if (state.start) points.push(state.start.coordinate);
  let current = points.at(-1) || null;
  state.itinerary.forEach((item, index) => {
    if (item.type === 'stop') {
      points.push(item.coordinate);
      current = item.coordinate;
    } else {
      const road = state.roadById.get(item.id);
      const next = nextItineraryCoordinate(index);
      const sampled = visitsBothEnds(item)
        ? sampledRoadPoints(road, current, next)
        : [roadEndpoints(road)[preferredSingleEndpoint(item, index, current)]];
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
  clearRoute();
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
    const casing = L.polyline(latLngs, { pane: 'route', color: '#fffdf7', weight: 10, opacity: .9, lineJoin: 'round', interactive: false }).addTo(map);
    const routeLine = L.polyline(latLngs, { pane: 'route', color: '#bc5f3d', weight: 6, opacity: .98, lineJoin: 'round', interactive: false }).addTo(map);
    state.routeLayers = [casing, routeLine];
    state.lastWaypoints = waypoints;
    state.routeCoordinates = route.geometry.coordinates.map(coordinate => [...coordinate]);
    map.fitBounds(routeLine.getBounds(), { padding: [55, 55] });
    showRouteSummary(route.distance, route.duration, waypoints);
  } catch (error) {
    showToast('The routing service could not connect these stops. Try fewer roads or a different order.');
    console.error(error);
  } finally {
    els.loadingCard.classList.remove('visible');
  }
}

function googleDirectionsUrl(points) {
  if (points.length < 2) return '#';
  const params = new URLSearchParams({
    api: '1',
    origin: `${points[0][1]},${points[0][0]}`,
    destination: `${points.at(-1)[1]},${points.at(-1)[0]}`,
    travelmode: 'driving',
  });
  const intermediate = points.slice(1, -1);
  if (intermediate.length) params.set('waypoints', intermediate.map(point => `${point[1]},${point[0]}`).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}

function googleOverviewPoints() {
  const points = [];
  if (state.start) points.push(state.start.coordinate);
  let current = points.at(-1) || null;
  state.itinerary.forEach((item, index) => {
    if (item.type === 'stop') {
      points.push(item.coordinate);
      current = item.coordinate;
      return;
    }
    const road = state.roadById.get(item.id);
    const endpoints = roadEndpoints(road);
    if (visitsBothEnds(item)) {
      const next = nextItineraryCoordinate(index);
      const ordered = orderedRoadEndpoints(road, current, next).map(entry => entry.coordinate);
      points.push(...ordered);
      current = ordered.at(-1);
      return;
    }
    const endpoint = endpoints[preferredSingleEndpoint(item, index, current)];
    points.push(endpoint);
    current = endpoint;
  });
  if (state.end) points.push(state.end.coordinate);
  return points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > 0.02);
}

function googleRouteLegs(points, maxPoints = 11) {
  const legs = [];
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(start + maxPoints, points.length);
    legs.push(points.slice(start, end));
    start = end - 1;
  }
  return legs;
}

function showRouteSummary(meters, seconds, waypoints) {
  els.routeMiles.textContent = Math.round(meters / 1609.344).toLocaleString();
  els.routeTime.textContent = formatDuration(seconds);
  els.routeRoads.textContent = state.selectedIds.size;
  const detailedLegs = googleRouteLegs(waypoints);
  const overviewPoints = googleOverviewPoints();
  const overviewFits = overviewPoints.length <= 11;

  if (detailedLegs.length === 1) {
    els.googleMapsLink.hidden = false;
    els.googleMapsLink.textContent = 'Open in Google Maps';
    els.googleMapsLink.href = googleDirectionsUrl(detailedLegs[0]);
  } else if (overviewFits) {
    els.googleMapsLink.hidden = false;
    els.googleMapsLink.textContent = 'Open Google overview';
    els.googleMapsLink.href = googleDirectionsUrl(overviewPoints);
  } else {
    els.googleMapsLink.hidden = true;
    els.googleMapsLink.href = '#';
  }

  if (detailedLegs.length > 1) {
    els.googleLegs.hidden = false;
    els.googleLegs.innerHTML = `<span>Full route in Google Maps</span><div class="google-leg-list">${detailedLegs.map((leg, index) => `<a class="google-leg-link" href="${escapeHtml(googleDirectionsUrl(leg))}" target="_blank" rel="noreferrer">Leg ${index + 1} of ${detailedLegs.length}</a>`).join('')}</div>`;
    els.routeNote.textContent = overviewFits
      ? `The overview follows every selected one-end or both-end road visit. Open all ${detailedLegs.length} numbered legs for the detailed path; GPX preserves the exact full track.`
      : `The selected road visits exceed Google Maps' single-link waypoint limit. Open all ${detailedLegs.length} numbered legs, or use GPX for the exact full track.`;
  } else {
    els.googleLegs.hidden = true;
    els.googleLegs.innerHTML = '';
    els.routeNote.textContent = 'Google Maps and GPX include the full planned route. Check road conditions and closures before you leave.';
  }
  prepareGpxDownload();
  els.routeSummary.classList.add('visible');
}

function gpxPoint(point, name, type) {
  return `  <wpt lat="${point[1].toFixed(6)}" lon="${point[0].toFixed(6)}">
    <name>${escapeHtml(name)}</name>
    <type>${escapeHtml(type)}</type>
  </wpt>`;
}

function createGpx() {
  const tripName = 'Wisconsin Rustic Road Trip';
  const roadNames = state.itinerary
    .filter(item => item.type === 'road')
    .map(item => roadLabel(state.roadById.get(item.id)));
  const description = roadNames.length ? `Rustic Roads: ${roadNames.join(', ')}` : 'Wisconsin scenic driving route';
  const namedPoints = [];
  if (state.start) namedPoints.push(gpxPoint(state.start.coordinate, state.start.label || 'Trip start', 'Start'));
  state.itinerary.filter(item => item.type === 'stop').forEach(item => {
    namedPoints.push(gpxPoint(item.coordinate, item.label || 'Visit point', 'Via'));
  });
  if (state.end) namedPoints.push(gpxPoint(state.end.coordinate, state.end.label || 'Trip finish', 'Finish'));

  const routePoints = state.lastWaypoints.map((point, index) => `    <rtept lat="${point[1].toFixed(6)}" lon="${point[0].toFixed(6)}"><name>Route point ${index + 1}</name></rtept>`).join('\n');
  const trackPoints = state.routeCoordinates.map(point => `      <trkpt lat="${point[1].toFixed(6)}" lon="${point[0].toFixed(6)}"></trkpt>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Wisconsin Rustic Road Trip Planner" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeHtml(tripName)}</name>
    <desc>${escapeHtml(description)}</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
${namedPoints.join('\n')}
  <rte>
    <name>${escapeHtml(tripName)}</name>
    <desc>${escapeHtml(description)}</desc>
${routePoints}
  </rte>
  <trk>
    <name>${escapeHtml(tripName)}</name>
    <desc>${escapeHtml(description)}</desc>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

function prepareGpxDownload() {
  if (state.gpxUrl) URL.revokeObjectURL(state.gpxUrl);
  const blob = new Blob([createGpx()], { type: 'application/gpx+xml;charset=utf-8' });
  state.gpxUrl = URL.createObjectURL(blob);
  const date = new Date();
  const dateStamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  els.downloadGpxLink.href = state.gpxUrl;
  els.downloadGpxLink.download = `wisconsin-rustic-road-trip-${dateStamp}.gpx`;
  els.downloadGpxLink.setAttribute('aria-disabled', 'false');
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
  state.lastWaypoints = [];
  state.routeCoordinates = [];
  if (state.gpxUrl) URL.revokeObjectURL(state.gpxUrl);
  state.gpxUrl = null;
  els.downloadGpxLink.href = '#';
  els.downloadGpxLink.removeAttribute('download');
  els.downloadGpxLink.setAttribute('aria-disabled', 'true');
  els.googleMapsLink.hidden = false;
  els.googleMapsLink.href = '#';
  els.googleMapsLink.textContent = 'Open in Google Maps';
  els.googleLegs.hidden = true;
  els.googleLegs.innerHTML = '';
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
    const restored = restorePlannerState();
    state.selectedIds.forEach(styleRoad);
    renderRoadList();
    renderItinerary();
    const allBounds = L.featureGroup([...state.roadLayers.values()]).getBounds();
    requestAnimationFrame(() => {
      map.invalidateSize();
      map.fitBounds(allBounds, { padding: [30, 30] });
    });
    if (restored) {
      savePlannerState();
      showToast('Your saved trip was restored from this browser.');
    }
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
  if (event.target.closest('.road-endpoint-toggle')) return;
  const index = Number(row.dataset.index);
  if (event.target.closest('[data-remove]')) {
    removeItem(index);
    return;
  }
  if (event.target.closest('[data-move="up"]')) {
    moveItem(index, -1);
    return;
  }
  if (event.target.closest('[data-move="down"]')) {
    moveItem(index, 1);
    return;
  }
  focusMapItem(row.dataset.itemKey);
});

els.itineraryList.addEventListener('change', event => {
  const endpointInput = event.target.closest('[data-visit-both-ends]');
  const row = event.target.closest('[data-index]');
  if (!endpointInput || !row) return;
  const item = state.itinerary[Number(row.dataset.index)];
  if (!item || item.type !== 'road') return;
  item.visitBothEnds = endpointInput.checked;
  clearRoute();
  savePlannerState();
  if (state.activeHighlightKey === itineraryItemKey(item)) {
    const key = state.activeHighlightKey;
    clearMapHighlight();
    setMapHighlight(key);
  }
});

els.itineraryList.addEventListener('pointerover', event => {
  const row = event.target.closest('[data-item-key]');
  if (!row || row.contains(event.relatedTarget)) return;
  setMapHighlight(row.dataset.itemKey);
});

els.itineraryList.addEventListener('pointerout', event => {
  const row = event.target.closest('[data-item-key]');
  if (!row || row.contains(event.relatedTarget)) return;
  setMapHighlight(state.pinnedHighlightKey);
});

els.itineraryList.addEventListener('focusin', event => {
  const row = event.target.closest('[data-item-key]');
  if (row) setMapHighlight(row.dataset.itemKey);
});

els.itineraryList.addEventListener('focusout', event => {
  const row = event.target.closest('[data-item-key]');
  if (!row || row.contains(event.relatedTarget)) return;
  setMapHighlight(state.pinnedHighlightKey);
});

els.itineraryList.addEventListener('keydown', event => {
  const row = event.target.closest('[data-item-key]');
  if (!row || event.target !== row || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  focusMapItem(row.dataset.itemKey);
});

const locationStack = document.querySelector('.location-stack');

locationStack.addEventListener('click', event => {
  const row = event.target.closest('.location-row.has-location[data-highlight-key]');
  if (!row || event.target.closest('button')) return;
  focusMapItem(row.dataset.highlightKey);
});

locationStack.addEventListener('pointerover', event => {
  const row = event.target.closest('.location-row.has-location[data-highlight-key]');
  if (!row || row.contains(event.relatedTarget)) return;
  setMapHighlight(row.dataset.highlightKey);
});

locationStack.addEventListener('pointerout', event => {
  const row = event.target.closest('.location-row.has-location[data-highlight-key]');
  if (!row || row.contains(event.relatedTarget)) return;
  setMapHighlight(state.pinnedHighlightKey);
});

locationStack.addEventListener('focusin', event => {
  const row = event.target.closest('.location-row.has-location[data-highlight-key]');
  if (row) setMapHighlight(row.dataset.highlightKey);
});

locationStack.addEventListener('focusout', event => {
  const row = event.target.closest('.location-row.has-location[data-highlight-key]');
  if (!row || row.contains(event.relatedTarget)) return;
  setMapHighlight(state.pinnedHighlightKey);
});

locationStack.addEventListener('keydown', event => {
  const row = event.target.closest('.location-row.has-location[data-highlight-key]');
  if (!row || event.target !== row || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  focusMapItem(row.dataset.highlightKey);
});

document.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => setPickMode(button.dataset.pick)));
els.addStopButton.addEventListener('click', () => setPickMode('stop'));
els.cancelPickButton.addEventListener('click', () => setPickMode(null));
els.optimizeButton.addEventListener('click', autoOrder);
els.clearTripButton.addEventListener('click', clearTrip);
els.buildRouteButton.addEventListener('click', buildRoute);
els.downloadGpxLink.addEventListener('click', () => showToast('GPX downloaded with the route track and saved visit points.'));
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
