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
    if( !tools.find( ( t ) => t.name === 'dzt.getTrails' ) ) { fail( 'adapter missing dzt.getTrails tool' ) }
    ok( `adapter built ${tools.length} tool definitions` )

    // 4) getTrails (PRD-001) — a real odta:Trail route as a GeoJSON LineString.
    //    "Gartenparadies-Runde" is a verified multi-vertex trail (>= 290 vertices).
    const trails = await DztDefaultMethods.getTrails( { name: 'Gartenparadies-Runde', limit: 3 } )
    if( trails.type !== 'FeatureCollection' ) { fail( 'getTrails did not return a FeatureCollection' ) }
    if( !Array.isArray( trails.features ) || trails.features.length === 0 ) { fail( 'getTrails returned no trail features' ) }
    const trail = trails.features[ 0 ]
    if( trail.geometry.type !== 'LineString' ) { fail( 'trail geometry is not a LineString' ) }
    const vertexCount = trail.properties._vertexCount
    if( typeof vertexCount !== 'number' || vertexCount < 290 ) { fail( `trail _vertexCount too low: ${vertexCount}` ) }
    const [ tlon, tlat ] = trail.geometry.coordinates[ 0 ]
    if( !( tlon > 5 && tlon < 16 && tlat > 47 && tlat < 56 ) ) { fail( `trail coords not lon-first/in DE: [${tlon}, ${tlat}]` ) }
    if( typeof trail.properties.licence !== 'string' || trail.properties.licence.length === 0 ) { fail( 'trail missing licence' ) }
    ok( `getTrails LineString verified: "${trail.properties.name}" _vertexCount=${vertexCount}, first=[${tlon}, ${tlat}]` )

    // 5) enrich:'transit' (PRD-002) — DHID-join in a dense urban bbox (Munich).
    //    Some features should carry _nearestTransitStop { dhid, walkingDistance }.
    const enriched = await DztDefaultMethods.nearPoint( {
        lat: 48.1374, lon: 11.5755, radiusMeters: 2500, enrich: [ 'transit' ], limit: 25
    } )
    const withStop = enriched.features.filter( ( f ) => f.properties._nearestTransitStop !== undefined )
    if( withStop.length === 0 ) { fail( 'enrich:transit attached no _nearestTransitStop to any feature' ) }
    const sample = withStop[ 0 ].properties._nearestTransitStop
    if( !/^de:\d+:\d+/.test( sample.dhid ) ) { fail( `_nearestTransitStop.dhid not a DHID: ${sample.dhid}` ) }
    if( typeof sample.walkingDistance !== 'number' ) { fail( '_nearestTransitStop.walkingDistance not numeric' ) }
    ok( `enrich:transit attached _nearestTransitStop to ${withStop.length}/${enriched.features.length} features; sample dhid=${sample.dhid} walk=${sample.walkingDistance}m` )

    console.log( '\nLIVE DZT TEST PASSED' )
    process.exit( 0 )
}

run()
    .catch( ( error ) => fail( error.message ) )
