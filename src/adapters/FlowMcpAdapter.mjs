import { DztDefaultMethods } from '../converters/dzt/DztDefaultMethods.mjs'


//
// FlowMcpAdapter (Live-Query mode — Memo 116 / 100)
// -------------------------------------------------
// Consumer API for FlowMCP-CLI. Unlike the In-Memory add-ons there is no
// loadFromUrl step — the data source is the live DZT Knowledge Graph. The CLI:
//   (1) buildToolDefinitions — derive auto-tools from the method catalog,
//   (2) executeMethod — run a method against the live engine (async).
//
const KNOWN_METHODS = DztDefaultMethods.getAllMethods().map( ( m ) => m.name )


export class FlowMcpAdapter {
    static getAvailableMethods() {
        return { methods: DztDefaultMethods.getAllMethods() }
    }


    static async executeMethod( { method, params = {} } ) {
        if( !KNOWN_METHODS.includes( method ) ) {
            throw new Error( `Unknown method: ${method}` )
        }
        return DztDefaultMethods[ method ]( { ...params } )
    }


    static buildToolDefinitions( { namespace } ) {
        const { status, messages } = FlowMcpAdapter.#validationNamespace( { namespace } )
        if( !status ) { throw new Error( messages.join( '; ' ) ) }

        const tools = DztDefaultMethods.getAllMethods()
            .map( ( method ) => {
                const properties = {}
                const required = []
                Object
                    .entries( method.params )
                    .forEach( ( [ paramName, paramDef ] ) => {
                        properties[ paramName ] = {
                            type: paramDef.type,
                            description: paramDef.description === undefined ? '' : paramDef.description
                        }
                        if( paramDef.required === true ) {
                            required.push( paramName )
                        }
                    } )
                return {
                    name: `${namespace}.${method.name}`,
                    description: `DZT live-query method: ${method.name}`,
                    inputSchema: { type: 'object', properties, required },
                    method: method.name
                }
            } )
        return { tools }
    }


    static #validationNamespace( { namespace } ) {
        const struct = { status: false, messages: [] }
        if( namespace === undefined || namespace === null ) {
            struct.messages.push( 'namespace is required' )
            return struct
        }
        if( typeof namespace !== 'string' ) {
            struct.messages.push( 'namespace must be a string' )
            return struct
        }
        if( !/^[a-z][a-z0-9-]*$/.test( namespace ) ) {
            struct.messages.push( 'namespace must match /^[a-z][a-z0-9-]*$/' )
            return struct
        }
        struct.status = true
        return struct
    }
}
