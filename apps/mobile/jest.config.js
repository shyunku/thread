module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // packages/e2ee (linked, outside this app) resolves its imports from this app's node_modules.
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    // Same libsodium API as the native module, runnable under Node.
    '^react-native-libsodium$': '<rootDir>/jest/libsodium.js',
    // cborg only publishes an ESM "import" entry; Jest resolves with require conditions.
    '^cborg$': '<rootDir>/node_modules/cborg/cborg.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|react-redux|@reduxjs/toolkit|immer|reselect|redux|cborg|@noble/hashes|@noble/ciphers)/)',
  ],
};
