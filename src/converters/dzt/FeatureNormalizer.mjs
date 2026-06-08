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
                        licence: FeatureNormalizer.#val( { cell: binding.licence } ),
                        transitStops: FeatureNormalizer.#collectStop( { binding }, [] )
                    } )
                    return
                }
                existing.types = FeatureNormalizer.#collect( { value: FeatureNormalizer.#val( { cell: binding.type } ) }, existing.types )
                if( existing.licence === null ) {
                    existing.licence = FeatureNormalizer.#val( { cell: binding.licence } )
                }
                existing.transitStops = FeatureNormalizer.#collectStop( { binding }, existing.transitStops )
            } )
        return map
    }


    static #collectStop( { binding }, existing ) {
        // PRD-002: a POI can carry many GeoLinkObjects (one row each). Gather every
        // candidate transit stop (dhid + walking distance); the nearest is chosen
        // later. A row without a dhid contributes nothing (no null junk).
        const dhid = FeatureNormalizer.#val( { cell: binding.dhid } )
        if( dhid === null ) { return existing }
        const walkDist = FeatureNormalizer.#parseNumber( { text: FeatureNormalizer.#val( { cell: binding.walkDist } ) } )
        const alreadyHas = existing.some( ( stop ) => stop.dhid === dhid )
        if( alreadyHas ) { return existing }
        return [ ...existing, { dhid, walkingDistance: walkDist } ]
    }


    static #nearestStop( { transitStops } ) {
        // Pick the stop with the smallest walking distance. Stops without a numeric
        // distance rank last (a known stop is still better than none).
        if( transitStops.length === 0 ) { return null }
        const ranked = [ ...transitStops ]
            .sort( ( a, b ) => {
                const da = a.walkingDistance === null ? Number.POSITIVE_INFINITY : a.walkingDistance
                const db = b.walkingDistance === null ? Number.POSITIVE_INFINITY : b.walkingDistance
                return da - db
            } )
        return ranked[ 0 ]
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
        const nearestStop = FeatureNormalizer.#nearestStop( { transitStops: row.transitStops === undefined ? [] : row.transitStops } )
        if( nearestStop !== null ) {
            properties._nearestTransitStop = { dhid: nearestStop.dhid, walkingDistance: nearestStop.walkingDistance }
        }
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [ lon, lat ] },
            properties
        }
    }


    static toLineStringFeatureCollection( { bindings, licence, limit = null } ) {
        // PRD-001: turn odta:Trail routes into GeoJSON LineString features. Each
        // ?line is ONE whitespace-separated string of `lon,lat,elev` triples
        // (already lon-first, elev always 0 in the feed -> dropped, 2D output).
        // Features with fewer than 2 valid points are dropped (not a LineString).
        // The licence contract is preserved: never ship a feature without licence.
        if( !Array.isArray( bindings ) ) {
            throw new Error( 'NORM-001: bindings must be an array' )
        }
        if( typeof licence !== 'string' || licence.length === 0 ) {
            throw new Error( 'NORM-002: licence (attribution fallback) is required — no feature may ship without it' )
        }

        const bySubject = FeatureNormalizer.#dedupeTrailBySubject( { bindings } )
        const features = [ ...bySubject.values() ]
            .map( ( row ) => FeatureNormalizer.#toLineStringFeature( { row, licence } ) )
            .filter( ( feature ) => feature !== null )

        const sliced = limit === null ? features : features.slice( 0, limit )

        return {
            type: 'FeatureCollection',
            features: sliced,
            meta: { count: sliced.length, source: SOURCE, licence }
        }
    }


    static #dedupeTrailBySubject( { bindings } ) {
        const map = new Map()
        bindings
            .forEach( ( binding ) => {
                const subject = FeatureNormalizer.#val( { cell: binding.s } )
                if( subject === null ) { return }
                if( map.has( subject ) ) { return }
                map.set( subject, {
                    uri: subject,
                    name: FeatureNormalizer.#val( { cell: binding.name } ),
                    line: FeatureNormalizer.#val( { cell: binding.line } ),
                    licence: FeatureNormalizer.#val( { cell: binding.licence } )
                } )
            } )
        return map
    }


    static #toLineStringFeature( { row, licence } ) {
        const coordinates = FeatureNormalizer.#parseLine( { line: row.line } )
        if( coordinates.length < 2 ) { return null }
        return {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: {
                uri: row.uri,
                name: row.name === undefined ? null : row.name,
                type: [ 'Trail' ],
                _source: SOURCE,
                licence: ( typeof row.licence === 'string' && row.licence.length > 0 ) ? row.licence : licence,
                _vertexCount: coordinates.length
            }
        }
    }


    static #parseLine( { line } ) {
        if( typeof line !== 'string' || line.trim().length === 0 ) { return [] }
        return line
            .trim()
            .split( /\s+/ )
            .map( ( token ) => {
                const parts = token.split( ',' )
                const lon = FeatureNormalizer.#parseNumber( { text: parts[ 0 ] } )
                const lat = FeatureNormalizer.#parseNumber( { text: parts[ 1 ] } )
                if( lon === null || lat === null ) { return null }
                return [ lon, lat ]
            } )
            .filter( ( point ) => point !== null )
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
