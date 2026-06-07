import { Validation } from '../../src/shared/Validation.mjs'


describe( 'Validation.coordinate', () => {
    test( 'accepts a valid coordinate', () => {
        const { status } = Validation.coordinate( { lat: 52.5, lon: 13.4 } )
        expect( status ).toBe( true )
    } )

    test( 'rejects missing lat', () => {
        const { status, messages } = Validation.coordinate( { lon: 13.4 } )
        expect( status ).toBe( false )
        expect( messages.join( ' ' ) ).toContain( 'lat is required' )
    } )

    test( 'rejects out-of-range lon', () => {
        const { status } = Validation.coordinate( { lat: 52.5, lon: 999 } )
        expect( status ).toBe( false )
    } )
} )


describe( 'Validation.radiusMeters', () => {
    test( 'accepts a valid radius', () => {
        const { status } = Validation.radiusMeters( { radiusMeters: 1000, maxRadiusMeters: 50000 } )
        expect( status ).toBe( true )
    } )

    test( 'rejects radius above max', () => {
        const { status } = Validation.radiusMeters( { radiusMeters: 99999, maxRadiusMeters: 50000 } )
        expect( status ).toBe( false )
    } )

    test( 'rejects zero radius', () => {
        const { status } = Validation.radiusMeters( { radiusMeters: 0, maxRadiusMeters: 50000 } )
        expect( status ).toBe( false )
    } )
} )


describe( 'Validation.boundingBox', () => {
    test( 'accepts a valid bbox', () => {
        const { status } = Validation.boundingBox( { minLon: 13.0, minLat: 52.0, maxLon: 13.5, maxLat: 52.6 } )
        expect( status ).toBe( true )
    } )

    test( 'rejects inverted bbox', () => {
        const { status } = Validation.boundingBox( { minLon: 13.5, minLat: 52.0, maxLon: 13.0, maxLat: 52.6 } )
        expect( status ).toBe( false )
    } )
} )


describe( 'Validation.types', () => {
    test( 'accepts null (optional)', () => {
        expect( Validation.types( { types: null } ).status ).toBe( true )
    } )

    test( 'accepts valid schema.org names', () => {
        expect( Validation.types( { types: [ 'Event', 'TouristAttraction' ] } ).status ).toBe( true )
    } )

    test( 'rejects non-array', () => {
        expect( Validation.types( { types: 'Event' } ).status ).toBe( false )
    } )

    test( 'rejects malformed type name', () => {
        expect( Validation.types( { types: [ 'schema:Event' ] } ).status ).toBe( false )
    } )
} )
