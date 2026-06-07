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


    static buildBboxQuery( { minLat, maxLat, minLon, maxLon, types = null, limit } ) {
        if( typeof limit !== 'number' || limit <= 0 ) {
            throw new Error( 'DZT-SPARQL-002: limit must be a positive number (no silent default)' )
        }
        const hasTypes = Array.isArray( types ) && types.length > 0
        const fLatMin = DztSparqlBuilder.#num( { value: minLat } )
        const fLatMax = DztSparqlBuilder.#num( { value: maxLat } )
        const fLonMin = DztSparqlBuilder.#num( { value: minLon } )
        const fLonMax = DztSparqlBuilder.#num( { value: maxLon } )
        // The DZT graph is not geo-indexed, so the bbox FILTER is a scan. To keep
        // the query under the gateway timeout we keep it lean: no per-row type
        // OPTIONAL (a multi-valued cross-product). When `types` is given we add a
        // VALUES set + a REQUIRED `?s a ?type` join, which both restricts and
        // populates the type — cheaper than an unbounded OPTIONAL.
        const selectVars = hasTypes ? '?s ?name ?lat ?lon ?type ?licence' : '?s ?name ?lat ?lon ?licence'
        const typeLines = hasTypes
            ? [ `  VALUES ?type { ${types.map( ( t ) => `schema:${t}` ).join( ' ' )} }`, '  ?s a ?type .' ]
            : []
        // lat/lon are stored as xsd:double literals, so compare directly against
        // numeric literals — casting every triple with xsd:double() is what makes
        // the (unindexed) FILTER scan blow past the gateway timeout.
        const sparql = [
            'PREFIX schema: <https://schema.org/>',
            `SELECT ${selectVars} WHERE {`,
            '  ?s schema:geo ?g .',
            '  ?g schema:latitude ?lat ; schema:longitude ?lon .',
            '  OPTIONAL { ?s schema:name ?name }',
            '  OPTIONAL { ?s schema:license ?licence }',
            ...typeLines,
            `  FILTER( ?lat >= ${fLatMin} && ?lat <= ${fLatMax}`,
            `       && ?lon >= ${fLonMin} && ?lon <= ${fLonMax} )`,
            '}',
            `LIMIT ${Math.floor( limit )}`
        ]
            .filter( ( line ) => line.length > 0 )
            .join( '\n' )
        return { sparql }
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
