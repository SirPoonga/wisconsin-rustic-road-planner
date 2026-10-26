# Wisconsin Rustic Road Trip Planner

A buildless, browser-based route planner for Wisconsin's official Rustic Roads. Visitors can select up to 12 roads, search for intermediate places or add custom points on the map, rearrange or automatically order the itinerary, choose street, satellite, or topographic basemaps, and create a driving route.

## Local preview

Serve `dist/` with any static HTTP server. For example:

```powershell
python -m http.server 4173 --directory dist
```

## Data and services

- Rustic Roads geometry: [Wiscmapper/WisconsinRusticRoads](https://github.com/Wiscmapper/WisconsinRusticRoads), MIT License.
- Basemap and place search: OpenStreetMap contributors and Nominatim.
- Routing: the public OSRM routing service.

Run `node scripts/prepare-data.mjs` to refresh the sanitized, site-local GeoJSON after updating the source repository.
