/* eslint-env jest */
// Native safe-area insets are not available under Jest.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
