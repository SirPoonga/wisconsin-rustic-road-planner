# Wisconsin Rustic Road Trip Planner

A buildless, browser-based route planner for Wisconsin's official Rustic Roads. Visitors can select up to 25 roads, visit both ends by default (or uncheck a road to visit one automatically selected endpoint), search for intermediate places or add custom points on the map, rearrange or automatically order the itinerary, choose street, satellite, or topographic basemaps, and create a driving route.

## Local preview

Serve `dist/` with any static HTTP server. For example:

```powershell
python -m http.server 4173 --directory dist
```

The feedback form uses the Worker API so the destination address is never shipped to the browser. To test it locally, copy `.dev.vars.example` to `.dev.vars`, fill in the two secret values, and run:

```powershell
npx wrangler dev
```

For production, configure the same values as Worker secrets:

```powershell
npx wrangler secret put FEEDBACK_TO
npx wrangler secret put FEEDBACK_FROM
```

`FEEDBACK_FROM` must be an address on a domain onboarded to Cloudflare Email Service. Email Sending requires a Workers Paid plan; the Worker binding is named `EMAIL` in `wrangler.jsonc`.

## Data and services

- Rustic Roads geometry: [Wiscmapper/WisconsinRusticRoads](https://github.com/Wiscmapper/WisconsinRusticRoads), MIT License.
- Basemap and place search: OpenStreetMap contributors and Nominatim.
- Routing: the public OSRM routing service for connectors between stops; the supplied Rustic Road GeoJSON geometry is used directly for selected road segments so the map and GPX stay on the scenic road even when the routing network takes a nearby shortcut.

The GeoJSON has no structured pavement or surface field. Some road descriptions mention gravel, sand, paved, or unpaved sections, but that free text is not complete enough to classify every road.

Run `node scripts/prepare-data.mjs` to refresh the sanitized, site-local GeoJSON after updating the source repository.
