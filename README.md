# geo-dzt-toolkit

Live-query **geo add-on** for the **DZT Knowledge Graph** (Deutsche Zentrale für Tourismus /
"Open Data Germany"). It exposes ~500k German tourism entities (events, POIs, trails, lodging,
food) to the FlowMCP `geo` provider as RFC 7946 FeatureCollections (lon-first), modelled on
`geo-overpass-toolkit` (Memo 116, prospect P11).

The DZT graph has **no GeoSPARQL**, so there is no native geodesic radius. This toolkit emulates
it the same way the SQLite add-ons do: a lat/lon **bounding-box FILTER over-fetches**, then a
client-side **Haversine** trims the result to the true circle.

## Install

```bash
npm install github:FlowMCP/geo-dzt-toolkit
```

Set the API key (header `x-api-key`, free + registration via `open-data@germany.travel`):

```bash
export OPEN_DATA_GERMANY_API_KEY=...   # never commit the value
```

## Usage

```javascript
import { DztDefaultMethods, FlowMcpAdapter } from 'geo-dzt-toolkit'

const fc = await DztDefaultMethods.nearPoint( {
    lat: 48.1374, lon: 11.5755, radiusMeters: 2000, limit: 10
} )
// → { type: 'FeatureCollection', features: [ { geometry: { coordinates: [lon, lat] },
//     properties: { uri, name, type, _source: 'dzt', licence, _distanceMeters } } ], meta: {...} }
```

## Methods

| Method | Input | Output |
|--------|-------|--------|
| `nearPoint` | `{ lat, lon, radiusMeters, types?, limit? }` | FeatureCollection (circle-trimmed, distance-sorted) |
| `inBoundingBox` | `{ minLon, minLat, maxLon, maxLat, types?, limit? }` | FeatureCollection |
| `byType` | `{ lat, lon, radiusMeters, types, limit? }` | FeatureCollection restricted to schema.org types |
| `searchByName` | `{ term, types?, limit? }` | non-geo keyword search (schema:name CONTAINS) → `{ results: [{ uri, name, types }], metadata }` — for the `kgSearch` schema tool |
| `rawSparql` | `{ query }` | raw SPARQL bindings (SELECT/ASK/CONSTRUCT only) — for the non-geo `kgSparql` schema |

`types` are schema.org local names (e.g. `Event`, `TouristAttraction`, `LodgingBusiness`).

## Geo-norm contract

Every feature is lon-first (`[lon, lat]`, RFC 7946) and carries the mandatory anchor properties
`_source: 'dzt'`, `licence` (per-object `schema:license` when present, else the dataset
attribution), and `_distanceMeters` (when a center is given). Radius is always in metres.

## Wiring into the `geo` provider

Add `'geo-dzt-toolkit'` to the geo schema's `requiredLibraries`, add an opt-in `sources: 'dzt'`
branch in `geoNearby`, and a `dzt` entry in `SOURCE_PRIORITY`. The provider stays thin — the
add-on encapsulates auth, cache, rate-limit and the radius emulation.

## Tests

```bash
npm test          # 44 unit tests (injected fetch, offline)
npm run test:live # live integration test (requires OPEN_DATA_GERMANY_API_KEY)
```

## Limitations

The DZT graph has no spatial index, so a bbox FILTER over a **sparse** region (few matches) can
exceed the gateway timeout (HTTP 524); dense areas return quickly. The client retries once on
524/429/503/504. OAuth2 option-1 is deprecated (2025-07-01) → use `x-api-key` only.

## License

MIT © FlowMCP
