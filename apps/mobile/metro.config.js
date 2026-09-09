/**
 * Metro configuration for React Native
 * https://github.com/facebook/react-native
 *
 * @format
 */

const {getDefaultConfig} = require('metro-config');
const MetroSymlinksResolver = require('@rnx-kit/metro-resolver-symlinks');

module.exports = (async () => {
  const {
    resolver: {sourceExts},
  } = await getDefaultConfig();
  return {
    watchFolders: [
      require('path').resolve(__dirname, '../../docs/protocol'),
      require('path').resolve(__dirname, '../desktop/public/electron/e2ee'),
    ],
    transformer: {
      babelTransformerPath: require.resolve('react-native-sass-transformer'),
    },
    resolver: {
      resolveRequest: MetroSymlinksResolver({experimental_retryResolvingFromDisk: true}),
      sourceExts: [...sourceExts, 'scss', 'sass'],
    },
  };
})();
