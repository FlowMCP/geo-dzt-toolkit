import { CoverageContract } from '../../src/shared/CoverageContract.mjs'


describe( 'CoverageContract.geoAnchorProperty', () => {
    test( 'Event anchors on schema:location', () => {
        expect( CoverageContract.geoAnchorProperty( { type: 'Event' } ) ).toBe( 'location' )
    } )

    test( 'TouristAttraction anchors on schema:geo', () => {
        expect( CoverageContract.geoAnchorProperty( { type: 'TouristAttraction' } ) ).toBe( 'geo' )
    } )

    test( 'Trail anchors on schema:geo', () => {
        expect( CoverageContract.geoAnchorProperty( { type: 'Trail' } ) ).toBe( 'geo' )
    } )

    test( 'unknown type falls back to geo (the common anchor)', () => {
        expect( CoverageContract.geoAnchorProperty( { type: 'Spaceship' } ) ).toBe( 'geo' )
    } )
} )


describe( 'CoverageContract.safeFields', () => {
    test( 'Trail has name + geo in always; address/url/telephone in never', () => {
        const { always, never } = CoverageContract.safeFields( { type: 'Trail' } )
        expect( always ).toEqual( expect.arrayContaining( [ 'name', 'geo' ] ) )
        expect( never ).toEqual( expect.arrayContaining( [ 'address', 'url', 'telephone' ] ) )
    } )

    test( 'Lodging does not promise description/image in always', () => {
        const { always } = CoverageContract.safeFields( { type: 'Lodging' } )
        expect( always ).not.toContain( 'description' )
        expect( always ).not.toContain( 'image' )
    } )

    test( 'Event keeps location (not geo) in always', () => {
        const { always } = CoverageContract.safeFields( { type: 'Event' } )
        expect( always ).toContain( 'location' )
        expect( always ).not.toContain( 'geo' )
    } )

    test( 'POI promises name + geo + address in always (§6.3); address is not a never', () => {
        const { always, never } = CoverageContract.safeFields( { type: 'POI' } )
        expect( always ).toEqual( expect.arrayContaining( [ 'name', 'geo', 'address' ] ) )
        expect( never ).not.toContain( 'address' )
        expect( never ).toContain( 'image' )
    } )

    test( 'Event promises name + startDate + location in always (§6.3); geo is a never', () => {
        const { always, never } = CoverageContract.safeFields( { type: 'Event' } )
        expect( always ).toEqual( expect.arrayContaining( [ 'name', 'startDate', 'location' ] ) )
        expect( never ).toContain( 'geo' )
    } )

    test( 'Food promises name + address + geo in always; hasMenu/priceRange never (§6.3)', () => {
        const { always, never } = CoverageContract.safeFields( { type: 'Food' } )
        expect( always ).toEqual( expect.arrayContaining( [ 'name', 'address', 'geo' ] ) )
        expect( never ).toEqual( expect.arrayContaining( [ 'hasMenu', 'priceRange' ] ) )
    } )

    test( 'Lodging: tel/url likely, description/image never (§6.3 "fast leer")', () => {
        const { likely, never } = CoverageContract.safeFields( { type: 'Lodging' } )
        expect( likely ).toEqual( expect.arrayContaining( [ 'telephone', 'url' ] ) )
        expect( never ).toEqual( expect.arrayContaining( [ 'description', 'image' ] ) )
    } )

    test( 'Trail promises the route line in always (§6.3 "Linie immer")', () => {
        const { always } = CoverageContract.safeFields( { type: 'Trail' } )
        expect( always ).toContain( 'line' )
    } )

    test( 'unknown type returns the universal floor with unknownType flag (no silent {})', () => {
        const struct = CoverageContract.safeFields( { type: 'Spaceship' } )
        expect( struct.always ).toEqual( [ 'name' ] )
        expect( struct.likely ).toEqual( [] )
        expect( struct.never ).toEqual( [] )
        expect( struct.unknownType ).toBe( true )
    } )

    test( 'returns fresh arrays (no shared mutable state)', () => {
        const a = CoverageContract.safeFields( { type: 'Trail' } )
        a.always.push( 'mutated' )
        const b = CoverageContract.safeFields( { type: 'Trail' } )
        expect( b.always ).not.toContain( 'mutated' )
    } )
} )


describe( 'CoverageContract.isSafe', () => {
    test( 'name is safe for every type (universal guarantee)', () => {
        expect( CoverageContract.isSafe( { type: 'Trail', field: 'name' } ) ).toBe( true )
        expect( CoverageContract.isSafe( { type: 'Event', field: 'name' } ) ).toBe( true )
    } )

    test( 'geo is safe for Trail but not the anchor for Event', () => {
        expect( CoverageContract.isSafe( { type: 'Trail', field: 'geo' } ) ).toBe( true )
        expect( CoverageContract.isSafe( { type: 'Event', field: 'geo' } ) ).toBe( false )
        expect( CoverageContract.isSafe( { type: 'Event', field: 'location' } ) ).toBe( true )
    } )

    test( 'a never-field is not safe', () => {
        expect( CoverageContract.isSafe( { type: 'Trail', field: 'telephone' } ) ).toBe( false )
    } )
} )
