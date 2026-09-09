module.exports = {
  presets: ['module:metro-react-native-babel-preset'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: '.env',
        blacklist: null,
        whitelist: null,
        safe: true,
        allowUndefined: true,
      },
    ],
    [
      'module-resolver',
      {
        root: ['./src'],
        extensions: [
          '.ios.ts',
          '.android.ts',
          '.ts',
          '.ios.tsx',
          '.android.tsx',
          '.tsx',
          '.jsx',
          '.js',
          '.json',
        ],
        alias: {
          '@': './src',
          '@components': './src/components',
          '@pages': './src/pages',
          '@styles': './src/styles',
          '@atoms': './src/atoms',
          '@utils': './src/utils',
          '@molecules': './src/molecules',
          '@objects': './src/objects',
          '@assets': './src/assets',
        },
      },
    ],
  ],
};

// The isolated native-key probe must not load any real app env file.
if (process.env.THREAD_E2EE_PROBE === '1') {
  module.exports = {presets: ['module:metro-react-native-babel-preset']};
}
