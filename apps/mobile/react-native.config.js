module.exports = {
  project: {
    ios: {},
    android: {},
  },
  assets: ['./src/assets/fonts/'],
  dependencies: {
    ...(process.env.THREAD_E2EE_PROBE === '1'
      ? Object.fromEntries(Object.keys(require('./package.json').dependencies)
          .filter(name => !['react-native-keychain', 'react-native-libsodium'].includes(name))
          .map(name => [name, {platforms: {android: null, ios: null}}]))
      : {}),
    'react-native-vector-icons': {
      platforms: {
        ios: null,
        android: null,
      },
    },
  },
};
