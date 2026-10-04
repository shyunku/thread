module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module:react-native-dotenv',
      // A missing .env is fine: config.ts falls back to production defaults.
      // THREAD_ENV_FILE picks another file, e.g. .env.phone for a phone build.
      {
        moduleName: '@env',
        path: process.env.THREAD_ENV_FILE || '.env',
        safe: false,
        allowUndefined: true,
      },
    ],
    ['module-resolver', { root: ['./src'], alias: { '@': './src' } }],
  ],
};
