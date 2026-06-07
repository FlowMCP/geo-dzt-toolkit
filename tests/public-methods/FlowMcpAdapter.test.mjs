import { FlowMcpAdapter } from '../../src/adapters/FlowMcpAdapter.mjs'
import { DztClient } from '../../src/converters/dzt/DztClient.mjs'


describe( 'FlowMcpAdapter', () => {
    afterEach( () => DztClient.reset() )

    test( 'getAvailableMethods exposes the method catalog', () => {
        const { methods } = FlowMcpAdapter.getAvailableMethods()
        expect( methods.map( ( m ) => m.name ) ).toContain( 'nearPoint' )
    } )

    test( 'buildToolDefinitions derives namespaced tools with required params', () => {
        const { tools } = FlowMcpAdapter.buildToolDefinitions( { namespace: 'dzt' } )
        const nearPoint = tools.find( ( t ) => t.name === 'dzt.nearPoint' )
        expect( nearPoint ).toBeDefined()
        expect( nearPoint.inputSchema.required ).toEqual( expect.arrayContaining( [ 'lat', 'lon', 'radiusMeters' ] ) )
    } )

    test( 'buildToolDefinitions rejects an invalid namespace', () => {
        expect( () => FlowMcpAdapter.buildToolDefinitions( { namespace: 'Dzt!' } ) ).toThrow( 'namespace must match' )
    } )

    test( 'executeMethod rejects an unknown method', async () => {
        await expect( FlowMcpAdapter.executeMethod( { method: 'nope', params: {} } ) ).rejects.toThrow( 'Unknown method' )
    } )

    test( 'executeMethod runs a known method against an injected engine', async () => {
        DztClient.configure( { apiKey: 'k', minIntervalMs: 0, fetchImpl: async () => ( {
            status: 200,
            json: async () => ( { results: { bindings: [ { s: { value: 'urn:a' }, lat: { value: '48.1374' }, lon: { value: '11.5755' }, name: { value: 'A' } } ] } } )
        } ) } )
        const fc = await FlowMcpAdapter.executeMethod( { method: 'nearPoint', params: { lat: 48.1374, lon: 11.5755, radiusMeters: 2000, limit: 5 } } )
        expect( fc.type ).toBe( 'FeatureCollection' )
        expect( fc.features.length ).toBeGreaterThan( 0 )
    } )
} )
