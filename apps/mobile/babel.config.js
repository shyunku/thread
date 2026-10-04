module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module:react-native-dotenv',
      // A missing .env is fine: config.ts falls back to production defaults.
      { moduleName: '@env', path: '.env', safe: false, allowUndefined: true },
    ],
    ['module-resolver', { root: ['./src'], alias: { '@': './src' } }],
  ],
};
