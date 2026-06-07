export default {
    testEnvironment: 'node',
    testMatch: [ '**/tests/**/*.test.mjs' ],
    collectCoverageFrom: [ 'src/**/*.mjs' ],
    coverageDirectory: 'coverage',
    transform: {}
}
