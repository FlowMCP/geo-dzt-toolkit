//
// Validation
// ----------
// Shared validation helpers for the DZT add-on. Each method returns a
// { status, messages } struct (never throws). Callers decide whether to throw.
// No silent defaults: every required field is checked explicitly.
//

export class Validation {
    static coordinate( { lat, lon } ) {
        const struct = { status: false, messages: [] }
        const fields = [
            [ 'lat', lat, -90, 90 ],
            [ 'lon', lon, -180, 180 ]
        ]
        fields
            .forEach( ( [ key, value, min, max ] ) => {
                if( value === undefined || value === null ) {
                    struct.messages.push( `${key} is required` )
                    return
                }
                if( typeof value !== 'number' || Number.isNaN( value ) ) {
                    struct.messages.push( `${key} must be a number` )
                    return
                }
                if( value < min || value > max ) {
                    struct.messages.push( `${key} must be within [${min}, ${max}]` )
                }
            } )
        if( struct.messages.length === 0 ) { struct.status = true }
        return struct
    }


    static radiusMeters( { radiusMeters, maxRadiusMeters } ) {
        const struct = { status: false, messages: [] }
        if( radiusMeters === undefined || radiusMeters === null ) {
            struct.messages.push( 'radiusMeters is required' )
            return struct
        }
        if( typeof radiusMeters !== 'number' || Number.isNaN( radiusMeters ) ) {
            struct.messages.push( 'radiusMeters must be a number' )
            return struct
        }
        if( radiusMeters <= 0 ) {
            struct.messages.push( 'radiusMeters must be greater than 0' )
            return struct
        }
        if( radiusMeters > maxRadiusMeters ) {
            struct.messages.push( `radiusMeters must not exceed ${maxRadiusMeters}` )
            return struct
        }
        struct.status = true
        return struct
    }


    static boundingBox( { minLon, minLat, maxLon, maxLat } ) {
        const struct = { status: false, messages: [] }
        const fields = [
            [ 'minLon', minLon, -180, 180 ],
            [ 'minLat', minLat,  -90,  90 ],
            [ 'maxLon', maxLon, -180, 180 ],
            [ 'maxLat', maxLat,  -90,  90 ]
        ]
        fields
            .forEach( ( [ key, value, min, max ] ) => {
                if( value === undefined || value === null ) {
                    struct.messages.push( `${key} is required` )
                    return
                }
                if( typeof value !== 'number' || Number.isNaN( value ) ) {
                    struct.messages.push( `${key} must be a number` )
                    return
                }
                if( value < min || value > max ) {
                    struct.messages.push( `${key} must be within [${min}, ${max}]` )
                }
            } )
        if( struct.messages.length > 0 ) { return struct }
        if( minLon >= maxLon ) {
            struct.messages.push( 'minLon must be less than maxLon' )
        }
        if( minLat >= maxLat ) {
            struct.messages.push( 'minLat must be less than maxLat' )
        }
        if( struct.messages.length === 0 ) { struct.status = true }
        return struct
    }


    static types( { types } ) {
        const struct = { status: false, messages: [] }
        if( types === undefined || types === null ) {
            struct.status = true
            return struct
        }
        if( !Array.isArray( types ) ) {
            struct.messages.push( 'types must be an array of schema.org type names' )
            return struct
        }
        const bad = types
            .filter( ( t ) => typeof t !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test( t ) )
        if( bad.length > 0 ) {
            struct.messages.push( 'each type must be a schema.org local name matching /^[A-Za-z][A-Za-z0-9]*$/' )
            return struct
        }
        struct.status = true
        return struct
    }
}
