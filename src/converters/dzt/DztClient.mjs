//
// DztClient
// ---------
// The Live-Query engine for the DZT Knowledge Graph add-on. It encapsulates the
// blockers the geo provider must NOT carry itself:
//
//   1. Auth        -> header `x-api-key` (OAuth2 option-1 is deprecated since
//                     2025-07-01). The key is read from configure({ apiKey }) or
//                     falls back to process.env.OPEN_DATA_GERMANY_API_KEY.
//   2. Rate-Limit  -> a single-slot minimum interval + one bounded retry on
//                     HTTP 429 / 503 / 504 (no busy loop).
//   3. Cache       -> in-memory response cache keyed by the exact SPARQL string
//                     with a TTL (repeated identical queries cost one slot).
//   4. ToS         -> a descriptive User-Agent header is always sent.
//
// SPARQL is sent via GET (?query=) with accept application/sparql-results+json,
// the stable entry point (POST needs content-type text/plain; the REST-keyword
// endpoint is parameter-fragile). Static class with module-level state, matching
// the add-on family style. No silent defaults: configure only overrides fields
// actually passed; a missing api key throws at request time.
//

const DEFAULTS = {
    endpoint: 'https://proxy.opendatagermany.io/api/ts/v1/kg/sparql',
    userAgent: 'geo-dzt-toolkit/0.1.0 (+https://github.com/FlowMCP/geo-dzt-toolkit)',
    attribution: 'DZT Knowledge Graph / Open Data Germany — licence per object (schema:license)',
    minIntervalMs: 500,
    cacheTtlMs: 300000,
    maxRetries: 1,
    retryDelayMs: 2000
}

const STATE = {
    config: { ...DEFAULTS },
    apiKey: null,
    fetchImpl: null,
    cache: new Map(),
    lastRequestAt: 0,
    now: () => Date.now(),
    sleep: ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) )
}


export class DztClient {
    static configure( { endpoint, userAgent, attribution, minIntervalMs, cacheTtlMs, maxRetries, retryDelayMs, apiKey, fetchImpl, now, sleep } = {} ) {
        if( endpoint !== undefined ) { STATE.config.endpoint = endpoint }
        if( userAgent !== undefined ) { STATE.config.userAgent = userAgent }
        if( attribution !== undefined ) { STATE.config.attribution = attribution }
        if( minIntervalMs !== undefined ) { STATE.config.minIntervalMs = minIntervalMs }
        if( cacheTtlMs !== undefined ) { STATE.config.cacheTtlMs = cacheTtlMs }
        if( maxRetries !== undefined ) { STATE.config.maxRetries = maxRetries }
        if( retryDelayMs !== undefined ) { STATE.config.retryDelayMs = retryDelayMs }
        if( apiKey !== undefined ) { STATE.apiKey = apiKey }
        if( fetchImpl !== undefined ) { STATE.fetchImpl = fetchImpl }
        if( now !== undefined ) { STATE.now = now }
        if( sleep !== undefined ) { STATE.sleep = sleep }
        return { configured: true }
    }


    static reset() {
        STATE.config = { ...DEFAULTS }
        STATE.apiKey = null
        STATE.fetchImpl = null
        STATE.cache = new Map()
        STATE.lastRequestAt = 0
        STATE.now = () => Date.now()
        STATE.sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) )
        return { reset: true }
    }


    static clearCache() {
        STATE.cache = new Map()
        return { cleared: true }
    }


    static getConfig() {
        return { ...STATE.config }
    }


    static async sparql( { query } ) {
        if( typeof query !== 'string' || query.length === 0 ) {
            throw new Error( 'DZT-CLIENT-001: query must be a non-empty SPARQL string' )
        }

        const cached = DztClient.#readCache( { query } )
        if( cached !== null ) {
            return { bindings: cached.bindings, meta: { ...cached.meta, fromCache: true } }
        }

        const result = await DztClient.#request( { query, attempt: 0 } )
        DztClient.#writeCache( { query, result } )
        return { bindings: result.bindings, meta: { ...result.meta, fromCache: false } }
    }


    static async #request( { query, attempt } ) {
        const apiKey = DztClient.#resolveApiKey()
        await DztClient.#respectRateLimit()

        const fetchImpl = STATE.fetchImpl === null ? fetch : STATE.fetchImpl
        STATE.lastRequestAt = STATE.now()

        const url = `${STATE.config.endpoint}?query=${encodeURIComponent( query )}`
        const response = await fetchImpl( url, {
            method: 'GET',
            headers: {
                'x-api-key': apiKey,
                'accept': 'application/sparql-results+json',
                'User-Agent': STATE.config.userAgent
            }
        } )

        const status = response.status
        // 524 = Cloudflare origin timeout (the DZT graph has no spatial index, so
        // a bbox FILTER over a sparse area can exceed the gateway window) — treat
        // it as transient alongside the standard rate-limit / gateway codes.
        if( status === 429 || status === 503 || status === 504 || status === 524 ) {
            if( attempt < STATE.config.maxRetries ) {
                await STATE.sleep( STATE.config.retryDelayMs )
                return DztClient.#request( { query, attempt: attempt + 1 } )
            }
            throw new Error( `DZT-CLIENT-429: rate limit / gateway error (HTTP ${status}) after ${attempt + 1} attempt(s)` )
        }
        if( status === 401 || status === 403 ) {
            throw new Error( `DZT-CLIENT-AUTH: DZT rejected the api key (HTTP ${status})` )
        }
        if( status < 200 || status >= 300 ) {
            throw new Error( `DZT-CLIENT-HTTP: DZT returned HTTP ${status}` )
        }

        const json = await response.json()
        const bindings = DztClient.#extractBindings( { json } )
        const meta = {
            attribution: STATE.config.attribution,
            bindingCount: bindings.length
        }
        return { bindings, meta }
    }


    static #extractBindings( { json } ) {
        if( json === null || json === undefined ) { return [] }
        if( json.results === undefined || json.results === null ) { return [] }
        if( !Array.isArray( json.results.bindings ) ) { return [] }
        return json.results.bindings
    }


    static #resolveApiKey() {
        if( typeof STATE.apiKey === 'string' && STATE.apiKey.length > 0 ) {
            return STATE.apiKey
        }
        const fromEnv = process.env.OPEN_DATA_GERMANY_API_KEY
        if( typeof fromEnv === 'string' && fromEnv.length > 0 ) {
            return fromEnv
        }
        throw new Error( 'DZT-CLIENT-002: missing OPEN_DATA_GERMANY_API_KEY (configure({ apiKey }) or set the env var)' )
    }


    static async #respectRateLimit() {
        const elapsed = STATE.now() - STATE.lastRequestAt
        const wait = STATE.config.minIntervalMs - elapsed
        if( wait > 0 ) {
            await STATE.sleep( wait )
        }
        return { ok: true }
    }


    static #readCache( { query } ) {
        const entry = STATE.cache.get( query )
        if( entry === undefined ) { return null }
        if( STATE.now() - entry.storedAt > STATE.config.cacheTtlMs ) {
            STATE.cache.delete( query )
            return null
        }
        return entry
    }


    static #writeCache( { query, result } ) {
        STATE.cache.set( query, { bindings: result.bindings, meta: result.meta, storedAt: STATE.now() } )
        return { stored: true }
    }
}
