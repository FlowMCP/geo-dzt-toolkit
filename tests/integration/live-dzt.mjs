// Live integration test against the real DZT Knowledge Graph.
// Run: OPEN_DATA_GERMANY_API_KEY=... node tests/integration/live-dzt.mjs
// Skips (exit 0) when the key is absent so CI without the secret stays green.

import { DztClient, DztDefaultMethods, FlowMcpAdapter } from '../../src/index.mjs'


const fail = ( msg ) => { console.error( `FAIL: ${msg}` ); process.exit( 1 ) }
const ok = ( msg ) => { console.log( `ok: ${msg}` ) }


const run = async () => {
    if( !process.env.OPEN_DATA_GERMANY_API_KEY ) {
        console.log( 'SKIP: OPEN_DATA_GERMANY_API_KEY not set' )
        process.exit( 0 )
    }
    DztClient.reset()

    // 1) nearPoint around Munich Marienplatz — dense POI area (engine fills LIMIT
    //    early; sparse rural bboxes can time out, see README "Limitations").
    const fc = await DztDefaultMethods.nearPoint( { lat: 48.1374, lon: 11.5755, radiusMeters: 2000, limit: 10 } )
    if( fc.type !== 'FeatureCollection' ) { fail( 'nearPoint did not return a FeatureCollection' ) }
    if( !Array.isArray( fc.features ) || fc.features.length === 0 ) { fail( 'nearPoint returned no features' ) }
    ok( `nearPoint returned ${fc.features.length} features (count=${fc.meta.count})` )

    const first = fc.features[ 0 ]
    if( first.geometry.type !== 'Point' ) { fail( 'feature geometry is not a Point' ) }
    const [ lon, lat ] = first.geometry.coordinates
    if( !( lon > 9 && lon < 12 && lat > 47 && lat < 49 ) ) { fail( `coordinates not lon-first/in region: [${lon}, ${lat}]` ) }
    ok( `lon-first coordinates verified: [${lon}, ${lat}] (${first.properties.name})` )

    if( typeof first.properties.licence !== 'string' || first.properties.licence.length === 0 ) { fail( 'feature missing licence' ) }
    if( first.properties._source !== 'dzt' ) { fail( '_source is not dzt' ) }
    if( typeof first.properties._distanceMeters !== 'number' ) { fail( '_distanceMeters missing' ) }
    if( first.properties._distanceMeters > 2000 ) { fail( 'circle-trim failed: feature beyond radius' ) }
    ok( `anchor fields present: _source=dzt, licence ok, _distanceMeters=${first.properties._distanceMeters}` )

    // 2) cache hit on identical query (same coords/radius/limit as call 1).
    const fc2 = await DztDefaultMethods.nearPoint( { lat: 48.1374, lon: 11.5755, radiusMeters: 2000, limit: 10 } )
    if( fc2.meta.fromCache !== true ) { fail( 'second identical query was not served from cache' ) }
    ok( 'cache hit verified on identical query' )

    // 3) adapter tool definitions.
    const { tools } = FlowMcpAdapter.buildToolDefinitions( { namespace: 'dzt' } )
    if( !tools.find( ( t ) => t.name === 'dzt.nearPoint' ) ) { fail( 'adapter missing dzt.nearPoint tool' ) }
    ok( `adapter built ${tools.length} tool definitions` )

    console.log( '\nLIVE DZT TEST PASSED' )
    process.exit( 0 )
}

run()
    .catch( ( error ) => fail( error.message ) )
