// Jest stand-in for react-native-libsodium: libsodium-wrappers(-sumo, for crypto_pwhash) has the same API but
// fills in its functions only after `ready`, so hand out a live view instead of a copy.
const sodium = require('libsodium-wrappers-sumo');
module.exports = new Proxy(
  {},
  { get: (_, key) => (key === '__esModule' ? true : sodium[key]) },
);
