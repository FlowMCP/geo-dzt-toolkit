# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-07

Initial release (Memo 116, prospect P11).

### Added
- Query the **DZT Knowledge Graph (Open Data Germany)** as a **live-query geo data source**,
  modelled on `geo-overpass-toolkit`.
- `DztClient` — SPARQL-over-GET engine with `x-api-key` auth, in-memory query cache (TTL),
  single-slot rate limiting, descriptive User-Agent, and bounded retry on 429/503/504/**524**
  (Cloudflare origin timeout).
- `DztSparqlBuilder` — emulates a radius (DZT has **no GeoSPARQL**): bbox FILTER on
  `schema:latitude`/`schema:longitude` (no per-triple `xsd:double()` cast) + optional
  `VALUES ?type` join.
- `FeatureNormalizer` — SPARQL bindings → RFC 7946 FeatureCollection (lon-first), de-dupe by
  subject, per-object `schema:license` (fallback to dataset attribution), Haversine
  `_distanceMeters` + circle-trim.
- `DztDefaultMethods` — `nearPoint`, `inBoundingBox`, `byType`, `rawSparql`.
- `FlowMcpAdapter` — derives namespaced auto-tools; `executeMethod` for live calls.
- 44 unit tests (injected fetch) + a live integration test against the real DZT graph.

### Known limitations
- The DZT graph has **no spatial index**, so a bbox FILTER over a **sparse** area (few matches)
  can exceed the gateway timeout (HTTP 524). Dense areas fill the LIMIT and return quickly.
  Mitigation: bounded retry; prefer modest radii. OAuth2 option-1 is deprecated → `x-api-key` only.
