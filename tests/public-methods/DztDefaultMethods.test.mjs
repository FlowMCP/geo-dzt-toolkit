import { DztClient } from '../../src/converters/dzt/DztClient.mjs'
import { DztDefaultMethods } from '../../src/converters/dzt/DztDefaultMethods.mjs'


const bindingsFor = ( rows ) => ( { results: { bindings: rows.map( ( r ) => ( {
    s: { value: r.s }, lat: { value: r.lat }, lon: { value: r.lon }, name: { value: r.name }
} ) ) } } )


describe( 'DztDefaultMethods', () => {
    afterEach( () => DztClient.reset() )

    const configure = ( { rows } ) => {
        DztClient.configure( { apiKey: 'k', minIntervalMs: 0, fetchImpl: async () => ( {
            status: 200, json: async () => bindingsFor( rows )
        } ) } )
    }

    test( 'getAllMethods returns the catalog', () => {
        const names = DztDefaultMethods.getAllMethods().map( ( m ) => m.name )
        expect( names ).toEqual( expect.arrayContaining( [ 'nearPoint', 'inBoundingBox', 'byType', 'getTrails', 'searchByName', 'rawSparql' ] ) )
    } )

    test( 'searchByName returns de-duplicated non-geo results with collected types', async () => {
        DztClient.configure( { apiKey: 'k', minIntervalMs: 0, fetchImpl: async () => ( {
            status: 200,
            json: async () => ( { results: { bindings: [
                { s: { value: 'urn:a' }, name: { value: 'Schloss A' }, type: { value: 'https://schema.org/TouristAttraction' } },
                { s: { value: 'urn:a' }, name: { value: 'Schloss A' }, type: { value: 'https://schema.org/Place' } },
                { s: { value: 'urn:b' }, name: { value: 'Schloss B' } }
            ] } } )
        } ) } )
        const out = await DztDefaultMethods.searchByName( { term: 'schloss', limit: 10 } )
        expect( out.results ).toHaveLength( 2 )
        const a = out.results.find( ( r ) => r.uri === 'urn:a' )
        expect( a.types ).toEqual( [ 'TouristAttraction', 'Place' ] )
        expect( out.metadata.source ).toBe( 'dzt' )
    } )

    test( 'searchByName rejects an empty term', async () => {
        configure( { rows: [] } )
        await expect( DztDefaultMethods.searchByName( { term: '', limit: 10 } ) ).rejects.toThrow( 'DZT-SPARQL-003' )
    } )

    test( 'nearPoint returns a trimmed, sorted FeatureCollection', async () => {
        configure( { rows: [
            { s: 'near', lat: '48.1380', lon: '11.5755', name: 'Near' },
            { s: 'far',  lat: '48.2000', lon: '11.5755', name: 'Far' }
        ] } )
        const fc = await DztDefaultMethods.nearPoint( { lat: 48.1374, lon: 11.5755, radiusMeters: 2000, limit: 10 } )
        expect( fc.type ).toBe( 'FeatureCollection' )
        expect( fc.features ).toHaveLength( 1 )
        expect( fc.features[ 0 ].properties.uri ).toBe( 'near' )
        expect( fc.meta.radiusMeters ).toBe( 2000 )
    } )

    test( 'nearPoint rejects an invalid coordinate', async () => {
        configure( { rows: [] } )
        await expect( DztDefaultMethods.nearPoint( { lat: 999, lon: 11, radiusMeters: 1000 } ) ).rejects.toThrow( 'lat must be within' )
    } )

    test( 'nearPoint rejects radius above max', async () => {
        configure( { rows: [] } )
        await expect( DztDefaultMethods.nearPoint( { lat: 48, lon: 11, radiusMeters: 99999 } ) ).rejects.toThrow( 'must not exceed' )
    } )

    test( 'byType requires at least one type', async () => {
        configure( { rows: [] } )
        await expect( DztDefaultMethods.byType( { lat: 48, lon: 11, radiusMeters: 1000, types: [] } ) ).rejects.toThrow( 'DDM-001' )
    } )

    test( 'rawSparql rejects non-read queries', async () => {
        configure( { rows: [] } )
        await expect( DztDefaultMethods.rawSparql( { query: 'INSERT DATA {}' } ) ).rejects.toThrow( 'DDM-QL-002' )
    } )

    test( 'rawSparql passes through SELECT results', async () => {
        configure( { rows: [ { s: 'urn:a', lat: '48.0', lon: '11.0', name: 'A' } ] } )
        const result = await DztDefaultMethods.rawSparql( { query: 'SELECT * WHERE { ?s ?p ?o }' } )
        expect( result.bindings ).toHaveLength( 1 )
        expect( result.metadata.source ).toBe( 'dzt' )
    } )

    const configureRaw = ( { rows } ) => {
        DztClient.configure( { apiKey: 'k', minIntervalMs: 0, fetchImpl: async () => ( {
            status: 200, json: async () => ( { results: { bindings: rows } } )
        } ) } )
    }

    test( 'getTrails returns a LineString FeatureCollection from line bindings', async () => {
        configureRaw( { rows: [ {
            s: { type: 'uri', value: 'urn:trail' },
            name: { value: 'Gartenparadies-Runde', 'xml:lang': 'de' },
            line: { value: '10.100398,48.222792,0 10.100721,48.222787,0 10.101000,48.222800,0' }
        } ] } )
        const fc = await DztDefaultMethods.getTrails( { name: 'Runde', limit: 5 } )
        expect( fc.type ).toBe( 'FeatureCollection' )
        expect( fc.features ).toHaveLength( 1 )
        expect( fc.features[ 0 ].geometry.type ).toBe( 'LineString' )
        expect( fc.features[ 0 ].properties._vertexCount ).toBe( 3 )
        expect( fc.features[ 0 ].properties.type ).toEqual( [ 'Trail' ] )
    } )

    test( 'getTrails throws without a positive limit (no silent default)', async () => {
        configureRaw( { rows: [] } )
        await expect( DztDefaultMethods.getTrails( { name: 'Runde' } ) ).rejects.toThrow( 'DDM-002' )
    } )

    test( 'nearPoint enrich:[transit] passes a _nearestTransitStop through', async () => {
        configureRaw( { rows: [ {
            s: { type: 'uri', value: 'near' },
            lat: { value: '48.1380' }, lon: { value: '11.5755' },
            name: { value: 'Kunstraum' },
            dhid: { value: 'de:09162:142' },
            walkDist: { datatype: 'http://www.w3.org/2001/XMLSchema#double', value: '726.0' }
        } ] } )
        const fc = await DztDefaultMethods.nearPoint( { lat: 48.1374, lon: 11.5755, radiusMeters: 2000, enrich: [ 'transit' ], limit: 10 } )
        expect( fc.features ).toHaveLength( 1 )
        expect( fc.features[ 0 ].properties._nearestTransitStop ).toEqual( { dhid: 'de:09162:142', walkingDistance: 726 } )
    } )

    test( 'nearPoint rejects an unknown enrich token', async () => {
        configureRaw( { rows: [] } )
        await expect( DztDefaultMethods.nearPoint( { lat: 48, lon: 11, radiusMeters: 1000, enrich: [ 'bogus' ] } ) ).rejects.toThrow( 'DDM-ENRICH-002' )
    } )

    test( 'byType passes enrich through and rejects bogus tokens', async () => {
        configureRaw( { rows: [] } )
        await expect( DztDefaultMethods.byType( { lat: 48, lon: 11, radiusMeters: 1000, types: [ 'TouristAttraction' ], enrich: [ 'bogus' ] } ) ).rejects.toThrow( 'DDM-ENRICH-002' )
    } )
} )
