const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// packages/e2ee is linked from outside this app; watch it and resolve its
// imports (buffer, @babel/runtime) from this app's node_modules.
const e2ee = path.resolve(__dirname, '../../packages/e2ee');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [e2ee],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
