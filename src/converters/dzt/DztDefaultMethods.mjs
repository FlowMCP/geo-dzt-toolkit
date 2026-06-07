import { DztClient } from './DztClient.mjs'
import { DztSparqlBuilder } from './DztSparqlBuilder.mjs'
import { FeatureNormalizer } from './FeatureNormalizer.mjs'
import { Validation } from '../../shared/Validation.mjs'


//
// DztDefaultMethods
// -----------------
// The shared geo method family on top of the DZT Live-Query engine. The DZT
// Knowledge Graph has no GeoSPARQL, so radius is emulated: a square bbox FILTER
// over-fetches, then the FeatureNormalizer trims to the true circle (Haversine).
// Radius is always in METERS. No silent defaults: a selector/coordinate is
// required where the contract says so. `rawSparql` is the low-level escape hatch
// reused by the non-geo `open-data-germany` (kgSparql) schema.
//

const MAX_RADIUS_METERS = 50000

const METHOD_CATALOG = [
    {
        name: 'nearPoint',
        params: {
            lat:          { type: 'number',  required: true,  description: 'Center latitude (WGS84)' },
            lon:          { type: 'number',  required: true,  description: 'Center longitude (WGS84)' },
            radiusMeters: { type: 'number',  required: true,  description: 'Search radius in METERS (max 50000)' },
            types:        { type: 'array',   required: false, description: 'schema.org type names to restrict to (e.g. TouristAttraction, Event)' },
            limit:        { type: 'integer', required: false, default: 50, description: 'Max results after circle-trim' }
        }
    },
    {
        name: 'inBoundingBox',
        params: {
            minLon: { type: 'number',  required: true,  description: 'West bound (WGS84 longitude, lon-first RFC 7946)' },
            minLat: { type: 'number',  required: true,  description: 'South bound (WGS84 latitude)' },
            maxLon: { type: 'number',  required: true,  description: 'East bound (WGS84 longitude)' },
            maxLat: { type: 'number',  required: true,  description: 'North bound (WGS84 latitude)' },
            types:  { type: 'array',   required: false, description: 'schema.org type names to restrict to' },
            limit:  { type: 'integer', required: false, default: 100, description: 'Max results' }
        }
    },
    {
        name: 'byType',
        params: {
            lat:          { type: 'number',  required: true,  description: 'Center latitude (WGS84)' },
            lon:          { type: 'number',  required: true,  description: 'Center longitude (WGS84)' },
            radiusMeters: { type: 'number',  required: true,  description: 'Search radius in METERS (max 50000)' },
            types:        { type: 'array',   required: true,  description: 'schema.org type names (at least one, e.g. Event)' },
            limit:        { type: 'integer', required: false, default: 50, description: 'Max results after circle-trim' }
        }
    },
    {
        name: 'searchByName',
        params: {
            term:  { type: 'string',  required: true,  description: 'Case-insensitive substring matched against schema:name (non-geo keyword search)' },
            types: { type: 'array',   required: false, description: 'schema.org type names to restrict to' },
            limit: { type: 'integer', required: false, default: 20, description: 'Max results' }
        }
    },
    {
        name: 'rawSparql',
        params: {
            query: { type: 'string', required: true, description: 'Raw SPARQL (SELECT/ASK/CONSTRUCT only; sent via GET)' }
        }
    }
]


export class DztDefaultMethods {
    static getAllMethods() {
        return METHOD_CATALOG.map( ( m ) => ( { ...m } ) )
    }


    static getMethodByName( { name } ) {
        const method = METHOD_CATALOG.find( ( m ) => m.name === name )
        if( !method ) { throw new Error( `Unknown method: ${name}` ) }
        return { ...method }
    }


    static async nearPoint( { lat, lon, radiusMeters, types = null, limit = 50 } ) {
        DztDefaultMethods.#assert( { struct: Validation.coordinate( { lat, lon } ) } )
        DztDefaultMethods.#assert( { struct: Validation.radiusMeters( { radiusMeters, maxRadiusMeters: MAX_RADIUS_METERS } ) } )
        DztDefaultMethods.#assert( { struct: Validation.types( { types } ) } )

        const bbox = DztSparqlBuilder.bboxFromRadius( { lat, lon, radiusMeters } )
        const fetchLimit = DztDefaultMethods.#fetchLimit( { limit } )
        const { sparql } = DztSparqlBuilder.buildBboxQuery( { ...bbox, types, limit: fetchLimit } )
        const { bindings, meta } = await DztClient.sparql( { query: sparql } )
        const fc = FeatureNormalizer.toFeatureCollection( {
            bindings, licence: meta.attribution, center: { lat, lon },
            maxDistanceMeters: radiusMeters, limit
        } )
        return { ...fc, meta: { ...fc.meta, fromCache: meta.fromCache, radiusMeters } }
    }


    static async inBoundingBox( { minLon, minLat, maxLon, maxLat, types = null, limit = 100 } ) {
        DztDefaultMethods.#assert( { struct: Validation.boundingBox( { minLon, minLat, maxLon, maxLat } ) } )
        DztDefaultMethods.#assert( { struct: Validation.types( { types } ) } )

        const fetchLimit = DztDefaultMethods.#fetchLimit( { limit } )
        const { sparql } = DztSparqlBuilder.buildBboxQuery( { minLat, maxLat, minLon, maxLon, types, limit: fetchLimit } )
        const { bindings, meta } = await DztClient.sparql( { query: sparql } )
        const fc = FeatureNormalizer.toFeatureCollection( {
            bindings, licence: meta.attribution, center: null, maxDistanceMeters: null, limit
        } )
        return { ...fc, meta: { ...fc.meta, fromCache: meta.fromCache } }
    }


    static async byType( { lat, lon, radiusMeters, types, limit = 50 } ) {
        if( !Array.isArray( types ) || types.length === 0 ) {
            throw new Error( 'DDM-001: types is required and must contain at least one schema.org type (no silent default)' )
        }
        return DztDefaultMethods.nearPoint( { lat, lon, radiusMeters, types, limit } )
    }


    static async searchByName( { term, types = null, limit = 20 } ) {
        DztDefaultMethods.#assert( { struct: Validation.types( { types } ) } )
        const { sparql } = DztSparqlBuilder.buildNameQuery( { term, types, limit } )
        const { bindings, meta } = await DztClient.sparql( { query: sparql } )
        const bySubject = new Map()
        bindings
            .forEach( ( binding ) => {
                const uri = binding.s !== undefined && binding.s !== null ? binding.s.value : null
                if( uri === null ) { return }
                const name = binding.name !== undefined && binding.name !== null ? binding.name.value : null
                const typeUri = binding.type !== undefined && binding.type !== null ? binding.type.value : null
                const existing = bySubject.get( uri )
                if( existing === undefined ) {
                    bySubject.set( uri, { uri, name, types: typeUri === null ? [] : [ typeUri.replace( /^https?:\/\/schema\.org\//, '' ) ] } )
                    return
                }
                if( typeUri !== null ) {
                    const short = typeUri.replace( /^https?:\/\/schema\.org\//, '' )
                    if( !existing.types.includes( short ) ) { existing.types.push( short ) }
                }
            } )
        const results = [ ...bySubject.values() ]
        return {
            results,
            metadata: { source: 'dzt', licence: meta.attribution, resultCount: results.length, fromCache: meta.fromCache }
        }
    }


    static async rawSparql( { query } ) {
        if( typeof query !== 'string' || query.trim().length === 0 ) {
            throw new Error( 'DDM-QL-001: query must be a non-empty SPARQL string' )
        }
        const lower = query.toLowerCase()
        const isReadOnly = lower.includes( 'select' ) || lower.includes( 'ask' ) || lower.includes( 'construct' )
        if( !isReadOnly ) {
            throw new Error( 'DDM-QL-002: only SELECT / ASK / CONSTRUCT queries are allowed' )
        }
        const { bindings, meta } = await DztClient.sparql( { query } )
        return {
            bindings,
            metadata: {
                source: 'dzt',
                licence: meta.attribution,
                bindingCount: bindings.length,
                fromCache: meta.fromCache
            }
        }
    }


    // ----- helpers ----------------------------------------------------------

    static #fetchLimit( { limit } ) {
        // Over-fetch: the bbox is a square around the circle, so request more than
        // the final limit and let the Haversine trim do the cut. Bounded.
        const wanted = limit * 3
        if( wanted < 20 ) { return 20 }
        if( wanted > 200 ) { return 200 }
        return wanted
    }


    static #assert( { struct } ) {
        if( !struct.status ) { throw new Error( struct.messages.join( '; ' ) ) }
        return { ok: true }
    }
}
