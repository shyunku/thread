module.exports = {
  root: true,
  extends: '@react-native-community',
  rules: {
    'linebreak-style': 'off',
    'prettier/prettier': ['error', {endOfLine: 'lf'}],
    // disable the rule for limiting space between bracket like (ex: import {a} from 'a';)
    'object-curly-spacing': ['error', 'never'],
    // disable the rule for 'any' type as warn
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
