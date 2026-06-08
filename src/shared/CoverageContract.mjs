//
// CoverageContract
// ----------------
// The live-measured "safe assumption" contract from Memo 122 §6.3, encoded as
// pure data + helpers (no network). The single universal guarantee is
// schema:name; the geo anchor is type-specific (POI / Lodging / Food / Trail use
// schema:geo, but Event uses schema:location, NOT geo). Everything beyond
// name / geo / location must be null-checked at read time — dataset obligation
// (DS-Pflicht) is not the same as live presence.
//
// No silent defaults: an unknown type does not return an empty struct; it returns
// the universal floor { always: ['name'], likely: [], never: [] } plus an explicit
// unknownType: true flag, so callers cannot mistake "unknown" for "nothing safe".
//

const NAME = 'name'

// Per-type contract. Each entry is transcribed from the §6.3 "safe assumption"
// sentences, cross-checked against the §6.2 empirical coverage table (a field
// with ~100% coverage AND named "immer" in §6.3 -> always; "wahrscheinlich" /
// mid coverage -> likely; sparse / "nie annehmen" -> never). The §6.3 sentence
// is the authority where the two disagree. `geoAnchor` records which property
// carries the coordinate ('geo' for everything except Event = 'location').
// POI/Lodging/Food carry both the odta short name and the schema.org synonym.
const CONTRACT = {
    // §6.3: "name + geo + address immer; telephone/url wahrscheinlich; image nur ~30%"
    POI: {
        geoAnchor: 'geo',
        always: [ NAME, 'geo', 'address' ],
        likely: [ 'telephone', 'url', 'description' ],
        never:  [ 'image' ]
    },
    TouristAttraction: {
        geoAnchor: 'geo',
        always: [ NAME, 'geo', 'address' ],
        likely: [ 'telephone', 'url', 'description' ],
        never:  [ 'image' ]
    },
    // §6.3: "name + startDate + location immer; Ort via location (nicht geo);
    // image < 50%, kein tel/url". Event carries NO schema:geo (0% empirically).
    Event: {
        geoAnchor: 'location',
        always: [ NAME, 'startDate', 'location' ],
        likely: [ 'description' ],
        never:  [ 'geo', 'address', 'telephone', 'url', 'image' ]
    },
    // §6.3: "name + geo immer; tel/email/url ~99%; description/image fast leer"
    Lodging: {
        geoAnchor: 'geo',
        always: [ NAME, 'geo' ],
        likely: [ 'address', 'telephone', 'email', 'url' ],
        never:  [ 'description', 'image' ]
    },
    LodgingBusiness: {
        geoAnchor: 'geo',
        always: [ NAME, 'geo' ],
        likely: [ 'address', 'telephone', 'email', 'url' ],
        never:  [ 'description', 'image' ]
    },
    // §6.3: "name + address + geo immer; tel/email/openingHours wahrscheinlich;
    // hasMenu/priceRange nie annehmen" (both DS-Pflicht but ~0% live)
    Food: {
        geoAnchor: 'geo',
        always: [ NAME, 'address', 'geo' ],
        likely: [ 'telephone', 'email', 'openingHours', 'url', 'description' ],
        never:  [ 'hasMenu', 'priceRange' ]
    },
    FoodEstablishment: {
        geoAnchor: 'geo',
        always: [ NAME, 'address', 'geo' ],
        likely: [ 'telephone', 'email', 'openingHours', 'url', 'description' ],
        never:  [ 'hasMenu', 'priceRange' ]
    },
    // §6.3: "name + geo + Linie immer; description fast immer; kein
    // address/url/telephone" (the route geometry is schema:geo -> schema:line)
    Trail: {
        geoAnchor: 'geo',
        always: [ NAME, 'geo', 'line' ],
        likely: [ 'description' ],
        never:  [ 'address', 'url', 'telephone' ]
    }
}


export class CoverageContract {
    static geoAnchorProperty( { type } ) {
        const entry = CoverageContract.#lookup( { type } )
        if( entry === null ) { return 'geo' }
        return entry.geoAnchor
    }


    static safeFields( { type } ) {
        const entry = CoverageContract.#lookup( { type } )
        if( entry === null ) {
            return { always: [ NAME ], likely: [], never: [], unknownType: true }
        }
        return {
            always: [ ...entry.always ],
            likely: [ ...entry.likely ],
            never:  [ ...entry.never ]
        }
    }


    static isSafe( { type, field } ) {
        if( typeof field !== 'string' || field.length === 0 ) { return false }
        const { always } = CoverageContract.safeFields( { type } )
        return always.includes( field )
    }


    static getTypes() {
        return Object.keys( CONTRACT )
    }


    static #lookup( { type } ) {
        if( typeof type !== 'string' || type.length === 0 ) { return null }
        const entry = CONTRACT[ type ]
        if( entry === undefined ) { return null }
        return entry
    }
}
