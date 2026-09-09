import {protocol} from './protocol';
import {createMembership} from '../../../../desktop/public/electron/e2ee/membershipCore';
export const membership = createMembership(protocol);
