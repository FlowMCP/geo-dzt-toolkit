import { DztSparqlBuilder } from '../../src/converters/dzt/DztSparqlBuilder.mjs'


describe( 'DztSparqlBuilder.bboxFromRadius', () => {
    test( 'produces a symmetric bbox around the point', () => {
        const bbox = DztSparqlBuilder.bboxFromRadius( { lat: 48.0, lon: 11.0, radiusMeters: 1000 } )
        expect( bbox.minLat ).toBeLessThan( 48.0 )
        expect( bbox.maxLat ).toBeGreaterThan( 48.0 )
        expect( bbox.minLon ).toBeLessThan( 11.0 )
        expect( bbox.maxLon ).toBeGreaterThan( 11.0 )
    } )

    test( 'longitude delta widens toward the poles (cos correction)', () => {
        const low = DztSparqlBuilder.bboxFromRadius( { lat: 0, lon: 0, radiusMeters: 1000 } )
        const high = DztSparqlBuilder.bboxFromRadius( { lat: 60, lon: 0, radiusMeters: 1000 } )
        const lowSpan = low.maxLon - low.minLon
        const highSpan = high.maxLon - high.minLon
        expect( highSpan ).toBeGreaterThan( lowSpan )
    } )

    test( 'throws on non-numeric input', () => {
        expect( () => DztSparqlBuilder.bboxFromRadius( { lat: 'x', lon: 11, radiusMeters: 1000 } ) ).toThrow( 'DZT-SPARQL-001' )
    } )
} )


describe( 'DztSparqlBuilder.buildBboxQuery', () => {
    const bbox = { minLat: 47.9, maxLat: 48.1, minLon: 10.9, maxLon: 11.1 }

    test( 'requires a positive limit (no silent default)', () => {
        expect( () => DztSparqlBuilder.buildBboxQuery( { ...bbox, limit: 0 } ) ).toThrow( 'DZT-SPARQL-002' )
    } )

    test( 'builds a query without xsd:double cast and with a LIMIT', () => {
        const { sparql } = DztSparqlBuilder.buildBboxQuery( { ...bbox, limit: 20 } )
        expect( sparql ).toContain( 'schema:geo' )
        expect( sparql ).toContain( 'FILTER( ?lat >=' )
        expect( sparql ).not.toContain( 'xsd:double(?lat)' )
        expect( sparql ).toContain( 'LIMIT 20' )
    } )

    test( 'omits ?type when no types given', () => {
        const { sparql } = DztSparqlBuilder.buildBboxQuery( { ...bbox, limit: 20 } )
        expect( sparql ).not.toContain( '?type' )
    } )

    test( 'adds a required VALUES type join when types given', () => {
        const { sparql } = DztSparqlBuilder.buildBboxQuery( { ...bbox, types: [ 'Event' ], limit: 20 } )
        expect( sparql ).toContain( 'VALUES ?type { schema:Event }' )
        expect( sparql ).toContain( '?s a ?type .' )
    } )
} )


describe( 'DztSparqlBuilder.buildNameQuery', () => {
    test( 'requires a non-empty term', () => {
        expect( () => DztSparqlBuilder.buildNameQuery( { term: '  ', limit: 10 } ) ).toThrow( 'DZT-SPARQL-003' )
    } )

    test( 'requires a positive limit', () => {
        expect( () => DztSparqlBuilder.buildNameQuery( { term: 'schloss', limit: 0 } ) ).toThrow( 'DZT-SPARQL-002' )
    } )

    test( 'builds a lowercased CONTAINS filter on schema:name', () => {
        const { sparql } = DztSparqlBuilder.buildNameQuery( { term: 'Schloss', limit: 10 } )
        expect( sparql ).toContain( 'schema:name ?name' )
        expect( sparql ).toContain( 'CONTAINS( LCASE( STR( ?name ) ), "schloss" )' )
        expect( sparql ).toContain( 'LIMIT 10' )
    } )

    test( 'escapes quotes/backslashes to prevent injection', () => {
        const { sparql } = DztSparqlBuilder.buildNameQuery( { term: 'a" ) } INJECT \\', limit: 5 } )
        expect( sparql ).not.toContain( '") }' )
        expect( sparql ).toContain( '\\"' )
    } )
} )


describe( 'DztSparqlBuilder.buildBboxQuery transit enrich', () => {
    const bbox = { minLat: 47.9, maxLat: 48.1, minLon: 10.9, maxLon: 11.1 }

    test( 'omits the GeoLinkObject join when no enrich requested (lean default)', () => {
        const { sparql } = DztSparqlBuilder.buildBboxQuery( { ...bbox, limit: 20 } )
        expect( sparql ).not.toContain( 'GeoLinkObject' )
        expect( sparql ).not.toContain( '?dhid' )
        expect( sparql ).not.toContain( 'PREFIX odta:' )
    } )

    test( 'adds an OPTIONAL GeoLinkObject join with DHID + walk distance on enrich:transit', () => {
        const { sparql } = DztSparqlBuilder.buildBboxQuery( { ...bbox, enrich: [ 'transit' ], limit: 20 } )
        expect( sparql ).toContain( 'PREFIX odta: <https://odta.io/voc/>' )
        expect( sparql ).toContain( 'odta:GeoLinkObject' )
        expect( sparql ).toContain( 'odta:linkTarget ?s' )
        expect( sparql ).toContain( 'odta:linkSource ?stop' )
        expect( sparql ).toContain( '?stop schema:identifier ?dhid' )
        expect( sparql ).toContain( '?walkDist' )
        expect( sparql ).toContain( 'OPTIONAL {' )
    } )

    test( 'accepts a comma-separated enrich string', () => {
        const { sparql } = DztSparqlBuilder.buildBboxQuery( { ...bbox, enrich: 'transit', limit: 20 } )
        expect( sparql ).toContain( 'odta:GeoLinkObject' )
    } )
} )


describe( 'DztSparqlBuilder.buildTrailQuery', () => {
    test( 'requires a positive limit (no silent default)', () => {
        expect( () => DztSparqlBuilder.buildTrailQuery( { limit: 0 } ) ).toThrow( 'DZT-SPARQL-002' )
    } )

    test( 'anchors on odta:Trail with schema:line and a LIMIT', () => {
        const { sparql } = DztSparqlBuilder.buildTrailQuery( { limit: 5 } )
        expect( sparql ).toContain( 'PREFIX odta: <https://odta.io/voc/>' )
        expect( sparql ).toContain( '?s a odta:Trail' )
        expect( sparql ).toContain( 'schema:line ?line' )
        expect( sparql ).toContain( 'LIMIT 5' )
        expect( sparql ).not.toContain( 'schema:Trail' )
    } )

    test( 'adds a name CONTAINS filter when name is given', () => {
        const { sparql } = DztSparqlBuilder.buildTrailQuery( { name: 'Runde', limit: 5 } )
        expect( sparql ).toContain( 'CONTAINS( LCASE( STR( ?name ) ), "runde" )' )
    } )

    test( 'rejects an empty name', () => {
        expect( () => DztSparqlBuilder.buildTrailQuery( { name: '  ', limit: 5 } ) ).toThrow( 'DZT-SPARQL-004' )
    } )
} )
