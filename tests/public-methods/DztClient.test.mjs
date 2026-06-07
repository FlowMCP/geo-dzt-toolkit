import { DztClient } from '../../src/converters/dzt/DztClient.mjs'


const okJson = { results: { bindings: [ { s: { value: 'urn:a' }, lat: { value: '48.0' }, lon: { value: '11.0' } } ] } }
const response = ( { status, json = okJson } ) => ( { status, json: async () => json } )


describe( 'DztClient', () => {
    afterEach( () => DztClient.reset() )

    test( 'rejects empty query', async () => {
        DztClient.configure( { apiKey: 'k', fetchImpl: async () => response( { status: 200 } ) } )
        await expect( DztClient.sparql( { query: '' } ) ).rejects.toThrow( 'DZT-CLIENT-001' )
    } )

    test( 'throws when api key is missing', async () => {
        DztClient.reset()
        const saved = process.env.OPEN_DATA_GERMANY_API_KEY
        delete process.env.OPEN_DATA_GERMANY_API_KEY
        DztClient.configure( { minIntervalMs: 0, fetchImpl: async () => response( { status: 200 } ) } )
        await expect( DztClient.sparql( { query: 'SELECT * WHERE {}' } ) ).rejects.toThrow( 'DZT-CLIENT-002' )
        if( saved !== undefined ) { process.env.OPEN_DATA_GERMANY_API_KEY = saved }
    } )

    test( 'sends x-api-key + accept + user-agent headers via GET', async () => {
        let captured = null
        DztClient.configure( { apiKey: 'secret', minIntervalMs: 0, fetchImpl: async ( url, opts ) => {
            captured = { url, opts }
            return response( { status: 200 } )
        } } )
        await DztClient.sparql( { query: 'SELECT * WHERE {}' } )
        expect( captured.opts.method ).toBe( 'GET' )
        expect( captured.opts.headers[ 'x-api-key' ] ).toBe( 'secret' )
        expect( captured.opts.headers[ 'accept' ] ).toBe( 'application/sparql-results+json' )
        expect( captured.opts.headers[ 'User-Agent' ] ).toContain( 'geo-dzt-toolkit' )
        expect( captured.url ).toContain( 'query=' )
    } )

    test( 'caches identical queries (one network call)', async () => {
        let calls = 0
        DztClient.configure( { apiKey: 'k', minIntervalMs: 0, fetchImpl: async () => { calls++; return response( { status: 200 } ) } } )
        const a = await DztClient.sparql( { query: 'SELECT 1' } )
        const b = await DztClient.sparql( { query: 'SELECT 1' } )
        expect( calls ).toBe( 1 )
        expect( a.meta.fromCache ).toBe( false )
        expect( b.meta.fromCache ).toBe( true )
    } )

    test( 'retries once on 524 then succeeds', async () => {
        let calls = 0
        DztClient.configure( { apiKey: 'k', minIntervalMs: 0, retryDelayMs: 1, fetchImpl: async () => {
            calls++
            return calls === 1 ? response( { status: 524 } ) : response( { status: 200 } )
        } } )
        const result = await DztClient.sparql( { query: 'SELECT 2' } )
        expect( calls ).toBe( 2 )
        expect( result.bindings ).toHaveLength( 1 )
    } )

    test( 'throws on auth failure', async () => {
        DztClient.configure( { apiKey: 'k', minIntervalMs: 0, fetchImpl: async () => response( { status: 403 } ) } )
        await expect( DztClient.sparql( { query: 'SELECT 3' } ) ).rejects.toThrow( 'DZT-CLIENT-AUTH' )
    } )
} )
