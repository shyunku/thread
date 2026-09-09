import {protocol} from './protocol';
import {membership} from './membership';
import {createSyncProtocol} from '../../../../desktop/public/electron/e2ee/syncProtocolCore';
export const syncProtocol = createSyncProtocol(protocol, membership);
