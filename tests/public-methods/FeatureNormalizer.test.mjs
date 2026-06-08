import { FeatureNormalizer } from '../../src/converters/dzt/FeatureNormalizer.mjs'


const binding = ( { s, lat, lon, name, type, licence } ) => {
    const row = { s: { type: 'uri', value: s }, lat: { value: lat }, lon: { value: lon } }
    if( name !== undefined ) { row.name = { value: name, 'xml:lang': 'de' } }
    if( type !== undefined ) { row.type = { type: 'uri', value: type } }
    if( licence !== undefined ) { row.licence = { value: licence } }
    return row
}


describe( 'FeatureNormalizer.toFeatureCollection', () => {
    test( 'emits lon-first RFC 7946 features with anchor fields', () => {
        const bindings = [ binding( { s: 'urn:a', lat: '48.1374', lon: '11.5755', name: 'A' } ) ]
        const fc = FeatureNormalizer.toFeatureCollection( { bindings, licence: 'DZT fallback' } )
        expect( fc.type ).toBe( 'FeatureCollection' )
        expect( fc.features[ 0 ].geometry.coordinates ).toEqual( [ 11.5755, 48.1374 ] )
        expect( fc.features[ 0 ].properties._source ).toBe( 'dzt' )
        expect( fc.features[ 0 ].properties.licence ).toBe( 'DZT fallback' )
    } )

    test( 'uses per-object licence when present, else fallback', () => {
        const bindings = [
            binding( { s: 'urn:a', lat: '48.0', lon: '11.0', licence: 'CC-BY-4.0' } ),
            binding( { s: 'urn:b', lat: '48.0', lon: '11.0' } )
        ]
        const fc = FeatureNormalizer.toFeatureCollection( { bindings, licence: 'fallback' } )
        const byUri = Object.fromEntries( fc.features.map( ( f ) => [ f.properties.uri, f.properties.licence ] ) )
        expect( byUri[ 'urn:a' ] ).toBe( 'CC-BY-4.0' )
        expect( byUri[ 'urn:b' ] ).toBe( 'fallback' )
    } )

    test( 'de-duplicates by subject and collects short types', () => {
        const bindings = [
            binding( { s: 'urn:a', lat: '48.0', lon: '11.0', type: 'https://schema.org/Event' } ),
            binding( { s: 'urn:a', lat: '48.0', lon: '11.0', type: 'https://schema.org/Place' } )
        ]
        const fc = FeatureNormalizer.toFeatureCollection( { bindings, licence: 'x' } )
        expect( fc.features ).toHaveLength( 1 )
        expect( fc.features[ 0 ].properties.type ).toEqual( [ 'Event', 'Place' ] )
    } )

    test( 'drops coordinate-less rows instead of coercing', () => {
        const bindings = [ binding( { s: 'urn:a', lat: 'not-a-number', lon: '11.0' } ) ]
        const fc = FeatureNormalizer.toFeatureCollection( { bindings, licence: 'x' } )
        expect( fc.features ).toHaveLength( 0 )
    } )

    test( 'circle-trims to maxDistanceMeters and sorts by distance', () => {
        const bindings = [
            binding( { s: 'far', lat: '48.20', lon: '11.5755' } ),
            binding( { s: 'near', lat: '48.1380', lon: '11.5755' } )
        ]
        const center = { lat: 48.1374, lon: 11.5755 }
        const fc = FeatureNormalizer.toFeatureCollection( { bindings, licence: 'x', center, maxDistanceMeters: 2000 } )
        expect( fc.features ).toHaveLength( 1 )
        expect( fc.features[ 0 ].properties.uri ).toBe( 'near' )
        expect( fc.features[ 0 ].properties._distanceMeters ).toBeLessThanOrEqual( 2000 )
    } )

    test( 'throws when licence fallback is missing', () => {
        expect( () => FeatureNormalizer.toFeatureCollection( { bindings: [], licence: '' } ) ).toThrow( 'NORM-002' )
    } )

    test( 'throws when bindings is not an array', () => {
        expect( () => FeatureNormalizer.toFeatureCollection( { bindings: null, licence: 'x' } ) ).toThrow( 'NORM-001' )
    } )
} )


const transitBinding = ( { s, lat, lon, dhid, walkDist } ) => {
    const row = { s: { type: 'uri', value: s }, lat: { value: lat }, lon: { value: lon } }
    if( dhid !== undefined ) { row.dhid = { value: dhid } }
    if( walkDist !== undefined ) { row.walkDist = { datatype: 'http://www.w3.org/2001/XMLSchema#double', value: walkDist } }
    return row
}


describe( 'FeatureNormalizer.toFeatureCollection transit enrich', () => {
    test( 'attaches _nearestTransitStop when dhid + walking distance present', () => {
        const bindings = [ transitBinding( { s: 'urn:a', lat: '48.0', lon: '11.0', dhid: 'de:09162:142', walkDist: '726.0' } ) ]
        const fc = FeatureNormalizer.toFeatureCollection( { bindings, licence: 'x' } )
        expect( fc.features[ 0 ].properties._nearestTransitStop ).toEqual( { dhid: 'de:09162:142', walkingDistance: 726 } )
    } )

    test( 'omits _nearestTransitStop entirely when no transit columns present', () => {
        const bindings = [ binding( { s: 'urn:a', lat: '48.0', lon: '11.0' } ) ]
        const fc = FeatureNormalizer.toFeatureCollection( { bindings, licence: 'x' } )
        expect( fc.features[ 0 ].properties ).not.toHaveProperty( '_nearestTransitStop' )
    } )

    test( 'picks the nearest stop when a POI has multiple GeoLinks', () => {
        const bindings = [
            transitBinding( { s: 'urn:a', lat: '48.0', lon: '11.0', dhid: 'de:09162:110', walkDist: '2050.0' } ),
            transitBinding( { s: 'urn:a', lat: '48.0', lon: '11.0', dhid: 'de:09162:142', walkDist: '726.0' } ),
            transitBinding( { s: 'urn:a', lat: '48.0', lon: '11.0', dhid: 'de:09162:28', walkDist: '882.0' } )
        ]
        const fc = FeatureNormalizer.toFeatureCollection( { bindings, licence: 'x' } )
        expect( fc.features ).toHaveLength( 1 )
        expect( fc.features[ 0 ].properties._nearestTransitStop ).toEqual( { dhid: 'de:09162:142', walkingDistance: 726 } )
    } )
} )


const lineBinding = ( { s, name, line, licence } ) => {
    const row = { s: { type: 'uri', value: s } }
    if( name !== undefined ) { row.name = { value: name, 'xml:lang': 'de' } }
    if( line !== undefined ) { row.line = { value: line } }
    if( licence !== undefined ) { row.licence = { value: licence } }
    return row
}


describe( 'FeatureNormalizer.toLineStringFeatureCollection', () => {
    test( 'parses a multi-vertex line string into lon-first LineString coords', () => {
        const line = '10.100398,48.222792,0 10.100721,48.222787,0 10.101000,48.222800,0'
        const bindings = [ lineBinding( { s: 'urn:trail', name: 'Gartenparadies-Runde', line } ) ]
        const fc = FeatureNormalizer.toLineStringFeatureCollection( { bindings, licence: 'DZT fallback' } )
        expect( fc.features ).toHaveLength( 1 )
        const feature = fc.features[ 0 ]
        expect( feature.geometry.type ).toBe( 'LineString' )
        expect( feature.geometry.coordinates[ 0 ] ).toEqual( [ 10.100398, 48.222792 ] )
        expect( feature.geometry.coordinates ).toHaveLength( 3 )
        expect( feature.properties.type ).toEqual( [ 'Trail' ] )
        expect( feature.properties._vertexCount ).toBe( 3 )
        expect( feature.properties._source ).toBe( 'dzt' )
        expect( feature.properties.licence ).toBe( 'DZT fallback' )
    } )

    test( 'drops trails with fewer than 2 valid points', () => {
        const bindings = [ lineBinding( { s: 'urn:trail', line: '10.1,48.2,0' } ) ]
        const fc = FeatureNormalizer.toLineStringFeatureCollection( { bindings, licence: 'x' } )
        expect( fc.features ).toHaveLength( 0 )
    } )

    test( 'keeps per-object licence when present, else fallback', () => {
        const line = '10.1,48.2,0 10.2,48.3,0'
        const bindings = [ lineBinding( { s: 'urn:trail', line, licence: 'CC-BY-4.0' } ) ]
        const fc = FeatureNormalizer.toLineStringFeatureCollection( { bindings, licence: 'fallback' } )
        expect( fc.features[ 0 ].properties.licence ).toBe( 'CC-BY-4.0' )
    } )

    test( 'throws when licence fallback is missing (NORM-002)', () => {
        expect( () => FeatureNormalizer.toLineStringFeatureCollection( { bindings: [], licence: '' } ) ).toThrow( 'NORM-002' )
    } )

    test( 'throws when bindings is not an array (NORM-001)', () => {
        expect( () => FeatureNormalizer.toLineStringFeatureCollection( { bindings: null, licence: 'x' } ) ).toThrow( 'NORM-001' )
    } )
} )
