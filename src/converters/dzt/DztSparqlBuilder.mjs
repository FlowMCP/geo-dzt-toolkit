//
// DztSparqlBuilder
// ----------------
// The DZT Knowledge Graph has NO GeoSPARQL (asWKT count = 0), so there is no
// native geodesic radius. We emulate it: compute a lat/lon bounding box around
// the point (over-fetch a square), FILTER on schema:latitude/longitude as
// xsd:double, then post-filter to the true circle with Haversine in the
// FeatureNormalizer. This mirrors the bbox-prefilter + Haversine pattern used by
// the SQLite add-ons (_shared/sqliteRadius.mjs).
//
// No silent defaults: the builder never invents a bbox or a limit.
//

const METERS_PER_DEGREE_LAT = 111320


export class DztSparqlBuilder {
    static bboxFromRadius( { lat, lon, radiusMeters } ) {
        if( typeof lat !== 'number' || typeof lon !== 'number' || typeof radiusMeters !== 'number' ) {
            throw new Error( 'DZT-SPARQL-001: lat, lon and radiusMeters must be numbers' )
        }
        const latDelta = radiusMeters / METERS_PER_DEGREE_LAT
        const cosLat = Math.cos( lat * Math.PI / 180 )
        const safeCos = Math.abs( cosLat ) < 1e-9 ? 1e-9 : cosLat
        const lonDelta = radiusMeters / ( METERS_PER_DEGREE_LAT * Math.abs( safeCos ) )
        return {
            minLat: lat - latDelta,
            maxLat: lat + latDelta,
            minLon: lon - lonDelta,
            maxLon: lon + lonDelta
        }
    }


    static buildBboxQuery( { minLat, maxLat, minLon, maxLon, types = null, enrich = null, limit } ) {
        if( typeof limit !== 'number' || limit <= 0 ) {
            throw new Error( 'DZT-SPARQL-002: limit must be a positive number (no silent default)' )
        }
        const hasTypes = Array.isArray( types ) && types.length > 0
        const wantsTransit = DztSparqlBuilder.#wantsTransit( { enrich } )
        const fLatMin = DztSparqlBuilder.#num( { value: minLat } )
        const fLatMax = DztSparqlBuilder.#num( { value: maxLat } )
        const fLonMin = DztSparqlBuilder.#num( { value: minLon } )
        const fLonMax = DztSparqlBuilder.#num( { value: maxLon } )
        // The DZT graph is not geo-indexed, so the bbox FILTER is a scan. To keep
        // the query under the gateway timeout we keep it lean: no per-row type
        // OPTIONAL (a multi-valued cross-product). When `types` is given we add a
        // VALUES set + a REQUIRED `?s a ?type` join, which both restricts and
        // populates the type — cheaper than an unbounded OPTIONAL.
        const baseVars = hasTypes ? '?s ?name ?lat ?lon ?type ?licence' : '?s ?name ?lat ?lon ?licence'
        // Transit enrich (PRD-002): a reified odta:GeoLinkObject links a POI
        // (?s = linkTarget) to a transit stop (linkSource) carrying the DHID via
        // schema:identifier, plus a precomputed walking distance reified one level
        // deeper (walkingDistance -> GeoLinkObjectDistance -> schema:value). The
        // whole block is OPTIONAL so the lean default path is untouched and POIs
        // without a GeoLink still come through. A POI can carry MANY GeoLinks; we
        // surface all matching rows here and let the normalizer pick the nearest.
        const selectVars = wantsTransit ? `${baseVars} ?dhid ?walkDist` : baseVars
        const typeLines = hasTypes
            ? [ `  VALUES ?type { ${types.map( ( t ) => `schema:${t}` ).join( ' ' )} }`, '  ?s a ?type .' ]
            : []
        const enrichLines = wantsTransit
            ? [
                '  OPTIONAL {',
                '    ?glo a odta:GeoLinkObject ; odta:linkTarget ?s ; odta:linkSource ?stop ; odta:walkingDistance ?wd .',
                '    ?stop schema:identifier ?dhid .',
                '    ?wd schema:value ?walkDist .',
                '  }'
            ]
            : []
        const prefixLines = wantsTransit
            ? [ 'PREFIX schema: <https://schema.org/>', 'PREFIX odta: <https://odta.io/voc/>' ]
            : [ 'PREFIX schema: <https://schema.org/>' ]
        // lat/lon are stored as xsd:double literals, so compare directly against
        // numeric literals — casting every triple with xsd:double() is what makes
        // the (unindexed) FILTER scan blow past the gateway timeout.
        const sparql = [
            ...prefixLines,
            `SELECT ${selectVars} WHERE {`,
            '  ?s schema:geo ?g .',
            '  ?g schema:latitude ?lat ; schema:longitude ?lon .',
            '  OPTIONAL { ?s schema:name ?name }',
            '  OPTIONAL { ?s schema:license ?licence }',
            ...typeLines,
            ...enrichLines,
            `  FILTER( ?lat >= ${fLatMin} && ?lat <= ${fLatMax}`,
            `       && ?lon >= ${fLonMin} && ?lon <= ${fLonMax} )`,
            '}',
            `LIMIT ${Math.floor( limit )}`
        ]
            .filter( ( line ) => line.length > 0 )
            .join( '\n' )
        return { sparql }
    }


    static buildTrailQuery( { name = null, limit } ) {
        if( typeof limit !== 'number' || limit <= 0 ) {
            throw new Error( 'DZT-SPARQL-002: limit must be a positive number (no silent default)' )
        }
        const hasName = name !== undefined && name !== null
        if( hasName && ( typeof name !== 'string' || name.trim().length === 0 ) ) {
            throw new Error( 'DZT-SPARQL-004: name, when given, must be a non-empty string' )
        }
        // NAMESPACE TRAP (verified live): a route is a `odta:Trail` (odta: =
        // https://odta.io/voc/), NOT `schema:Trail` (which yields 0). The route
        // geometry hangs off schema:geo -> schema:line, ONE whitespace-separated
        // string of `lon,lat,elev` triples (lon-first, elev always 0). The query
        // is anchored on `?s a odta:Trail` and always bounded with a LIMIT (no
        // spatial index -> unbounded scans time out, HTTP 524).
        const nameLines = hasName
            ? [ `  FILTER( CONTAINS( LCASE( STR( ?name ) ), "${DztSparqlBuilder.#escapeLiteral( { value: name.trim().toLowerCase() } )}" ) )` ]
            : []
        const sparql = [
            'PREFIX schema: <https://schema.org/>',
            'PREFIX odta: <https://odta.io/voc/>',
            'SELECT ?s ?name ?line ?licence WHERE {',
            '  ?s a odta:Trail .',
            '  ?s schema:geo ?g .',
            '  ?g schema:line ?line .',
            '  OPTIONAL { ?s schema:name ?name }',
            '  OPTIONAL { ?s schema:license ?licence }',
            ...nameLines,
            '}',
            `LIMIT ${Math.floor( limit )}`
        ]
            .filter( ( line ) => line.length > 0 )
            .join( '\n' )
        return { sparql }
    }


    static #wantsTransit( { enrich } ) {
        if( enrich === undefined || enrich === null ) { return false }
        const list = DztSparqlBuilder.#normalizeEnrich( { enrich } )
        return list.includes( 'transit' )
    }


    static #normalizeEnrich( { enrich } ) {
        if( Array.isArray( enrich ) ) {
            return enrich.map( ( token ) => String( token ).trim() ).filter( ( token ) => token.length > 0 )
        }
        if( typeof enrich === 'string' ) {
            return enrich.split( ',' ).map( ( token ) => token.trim() ).filter( ( token ) => token.length > 0 )
        }
        return []
    }


    static buildNameQuery( { term, types = null, limit } ) {
        if( typeof term !== 'string' || term.trim().length === 0 ) {
            throw new Error( 'DZT-SPARQL-003: term must be a non-empty string' )
        }
        if( typeof limit !== 'number' || limit <= 0 ) {
            throw new Error( 'DZT-SPARQL-002: limit must be a positive number (no silent default)' )
        }
        const safe = DztSparqlBuilder.#escapeLiteral( { value: term.trim().toLowerCase() } )
        const hasTypes = Array.isArray( types ) && types.length > 0
        const selectVars = hasTypes ? '?s ?name ?type' : '?s ?name'
        const typeLines = hasTypes
            ? [ `  VALUES ?type { ${types.map( ( t ) => `schema:${t}` ).join( ' ' )} }`, '  ?s a ?type .' ]
            : []
        const sparql = [
            'PREFIX schema: <https://schema.org/>',
            `SELECT ${selectVars} WHERE {`,
            '  ?s schema:name ?name .',
            ...typeLines,
            `  FILTER( CONTAINS( LCASE( STR( ?name ) ), "${safe}" ) )`,
            '}',
            `LIMIT ${Math.floor( limit )}`
        ]
            .filter( ( line ) => line.length > 0 )
            .join( '\n' )
        return { sparql }
    }


    static #escapeLiteral( { value } ) {
        // Escape for a SPARQL string literal: backslash, double-quote and control
        // chars. Prevents query breakage / injection from the user term.
        return value
            .replace( /\\/g, '\\\\' )
            .replace( /"/g, '\\"' )
            .replace( /[\r\n\t]/g, ' ' )
    }


    static #num( { value } ) {
        // Render a plain decimal literal (never scientific notation) for the FILTER.
        const fixed = value.toFixed( 8 )
        return fixed
    }
}
