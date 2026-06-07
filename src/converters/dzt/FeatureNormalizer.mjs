//
// FeatureNormalizer
// -----------------
// Turns the raw DZT SPARQL `results.bindings[]` into a normalized GeoJSON
// FeatureCollection (RFC 7946 — coordinates are [lon, lat], lon-first), the
// single output contract shared by every geo add-on. Each feature carries the
// canonical anchor fields: uri, name, type, _source, licence and (when a center
// point is given) _distanceMeters.
//
// DZT specifics:
//   - OPTIONAL { ?s a ?type } / schema:license can multiply rows per subject, so
//     bindings are de-duplicated by subject URI (first wins, type collected).
//   - lat/lon arrive as xsd:double string literals -> parsed; bindings without a
//     usable coordinate are dropped, not silently coerced.
//   - licence is per object (schema:license) when present, else the dataset
//     attribution fallback — a feature never ships without a licence.
//   - because the SPARQL FILTER is a square bbox (over-fetch), an optional
//     maxDistanceMeters trims the result to the true circle via Haversine.
//

const SOURCE = 'dzt'


export class FeatureNormalizer {
    static toFeatureCollection( { bindings, licence, center = null, maxDistanceMeters = null, limit = null } ) {
        if( !Array.isArray( bindings ) ) {
            throw new Error( 'NORM-001: bindings must be an array' )
        }
        if( typeof licence !== 'string' || licence.length === 0 ) {
            throw new Error( 'NORM-002: licence (attribution fallback) is required — no feature may ship without it' )
        }

        const bySubject = FeatureNormalizer.#dedupeBySubject( { bindings } )
        const features = [ ...bySubject.values() ]
            .map( ( row ) => FeatureNormalizer.#toFeature( { row, licence, center } ) )
            .filter( ( feature ) => feature !== null )

        const circled = ( center === null || maxDistanceMeters === null )
            ? features
            : features.filter( ( feature ) => feature.properties._distanceMeters <= maxDistanceMeters )

        const sorted = center === null
            ? circled
            : circled.sort( ( a, b ) => a.properties._distanceMeters - b.properties._distanceMeters )

        const sliced = limit === null ? sorted : sorted.slice( 0, limit )

        return {
            type: 'FeatureCollection',
            features: sliced,
            meta: { count: sliced.length, source: SOURCE, licence }
        }
    }


    static #dedupeBySubject( { bindings } ) {
        const map = new Map()
        bindings
            .forEach( ( binding ) => {
                const subject = FeatureNormalizer.#val( { cell: binding.s } )
                if( subject === null ) { return }
                const existing = map.get( subject )
                if( existing === undefined ) {
                    map.set( subject, {
                        uri: subject,
                        name: FeatureNormalizer.#val( { cell: binding.name } ),
                        lat: FeatureNormalizer.#val( { cell: binding.lat } ),
                        lon: FeatureNormalizer.#val( { cell: binding.lon } ),
                        types: FeatureNormalizer.#collect( { value: FeatureNormalizer.#val( { cell: binding.type } ) }, [] ),
                        licence: FeatureNormalizer.#val( { cell: binding.licence } )
                    } )
                    return
                }
                existing.types = FeatureNormalizer.#collect( { value: FeatureNormalizer.#val( { cell: binding.type } ) }, existing.types )
                if( existing.licence === null ) {
                    existing.licence = FeatureNormalizer.#val( { cell: binding.licence } )
                }
            } )
        return map
    }


    static #toFeature( { row, licence, center } ) {
        const lat = FeatureNormalizer.#parseNumber( { text: row.lat } )
        const lon = FeatureNormalizer.#parseNumber( { text: row.lon } )
        if( lat === null || lon === null ) { return null }

        const properties = {
            uri: row.uri,
            name: row.name === undefined ? null : row.name,
            type: FeatureNormalizer.#shortTypes( { types: row.types } ),
            _source: SOURCE,
            licence: ( typeof row.licence === 'string' && row.licence.length > 0 ) ? row.licence : licence
        }
        if( center !== null ) {
            properties._distanceMeters = FeatureNormalizer.#haversineMeters( {
                lat1: center.lat, lon1: center.lon, lat2: lat, lon2: lon
            } )
        }
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [ lon, lat ] },
            properties
        }
    }


    static #shortTypes( { types } ) {
        return types
            .map( ( t ) => t.replace( /^https?:\/\/schema\.org\//, '' ) )
            .filter( ( t ) => t.length > 0 )
    }


    static #collect( { value }, existing ) {
        if( value === null ) { return existing }
        if( existing.includes( value ) ) { return existing }
        return [ ...existing, value ]
    }


    static #val( { cell } ) {
        if( cell === undefined || cell === null ) { return null }
        if( typeof cell.value !== 'string' ) { return null }
        return cell.value
    }


    static #parseNumber( { text } ) {
        if( typeof text !== 'string' ) { return null }
        const parsed = Number.parseFloat( text )
        if( Number.isNaN( parsed ) ) { return null }
        return parsed
    }


    static #haversineMeters( { lat1, lon1, lat2, lon2 } ) {
        const toRad = ( deg ) => deg * Math.PI / 180
        const R = 6371000
        const dLat = toRad( lat2 - lat1 )
        const dLon = toRad( lon2 - lon1 )
        const a = Math.sin( dLat / 2 ) * Math.sin( dLat / 2 ) +
            Math.cos( toRad( lat1 ) ) * Math.cos( toRad( lat2 ) ) *
            Math.sin( dLon / 2 ) * Math.sin( dLon / 2 )
        const c = 2 * Math.atan2( Math.sqrt( a ), Math.sqrt( 1 - a ) )
        return Math.round( R * c * 10 ) / 10
    }
}
