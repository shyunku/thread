import * as sodium from 'react-native-libsodium';
import * as cbor from 'cborg';
import {hkdf} from '@noble/hashes/hkdf';
import {sha256} from '@noble/hashes/sha256';
import {createProtocol} from './protocolFactory';

// Native module resolution selects lib.native.ts on Android/iOS.
export const protocol = createProtocol({sodium, cbor, hkdf, sha256});
