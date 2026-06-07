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
