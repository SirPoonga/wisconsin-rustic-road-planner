# Wisconsin Rustic Road Trip Planner

A buildless, browser-based route planner for Wisconsin's official Rustic Roads. Visitors can select up to 25 roads, visit both ends by default (or uncheck a road to visit one automatically selected endpoint), search for intermediate places or add custom points on the map, rearrange or automatically order the itinerary, choose street, satellite, or topographic basemaps, and create a driving route.

## Local preview

Serve `dist/` with any static HTTP server. For example:

```powershell
python -m http.server 4173 --directory dist
```

The feedback form uses a Worker API and Resend so the destination address and API key are never shipped to the browser. To test it locally, copy `.dev.vars.example` to `.dev.vars`, fill in the Resend API key and destination, and run:

```powershell
npx wrangler dev
```

For production, configure the private values as Worker secrets:

```powershell
npx wrangler secret put FEEDBACK_TO
npx wrangler secret put RESEND_API_KEY
```

The sender is configured as `feedback@kevinmjonas.com` in `wrangler.jsonc`; that domain must be verified in Resend before delivery will work.

## Data and services

- Rustic Roads geometry: [Wiscmapper/WisconsinRusticRoads](https://github.com/Wiscmapper/WisconsinRusticRoads), MIT License.
- Basemap and place search: OpenStreetMap contributors and Nominatim.
- Routing: the public OSRM routing service for connectors between stops; the supplied Rustic Road GeoJSON geometry is used directly for selected road segments so the map and GPX stay on the scenic road even when the routing network takes a nearby shortcut.

The GeoJSON has no structured pavement or surface field. Some road descriptions mention gravel, sand, paved, or unpaved sections, but that free text is not complete enough to classify every road.

The site-local GeoJSON also includes a structured `url` property extracted from each road's notes when an official link is present. Roads without a source link keep `url: null`.

Run `node scripts/prepare-data.mjs` to refresh the sanitized, site-local GeoJSON after updating the source repository.
