import {
  accountAuthSlice,
  accountInfoSlice,
  removeAuth,
} from '@/store/accountSlice';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import PackageJSON from '../../package.json';
import {v4 as uuid} from 'uuid';
import {Buffer} from 'buffer';
import {getServerEndpoint} from '@/util/common';

const WEBSOCKET_ENDPOINT = `${getServerEndpoint().replace(
  /http/g,
  'ws',
)}/websocket/connect`;

const queue: Map<string, any> = new Map();
const messageHandlers: Map<string, any> = new Map();

const useSocket = () => {
  const authInfo = useSelector(accountAuthSlice);
  const dispatch = useDispatch();
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const sendSync = useCallback(
    async (topic: string, data: any = null, timeout = 3000) => {
      if (!socket) return;
      return new Promise((resolve, reject) => {
        const reqId: string = uuid();
        const packet = {topic, data, reqId};
        const callback = (data: any) => {
          let dataStr = JSON.stringify(data);
          if (dataStr.length > 5000) {
            dataStr = dataStr.substring(0, 5000) + '...';
          }
          resolve(data);
        };
        const errorHandler = (err: Error) => {
          reject(err);
        };

        let timeoutHandler = setTimeout(() => {
          reject(`Request timeout`);
        }, timeout);

        queue.set(reqId, {callback, errorHandler, timeoutHandler});

        const packetJson = JSON.stringify(packet);

        try {
          socket.send(packetJson);
        } catch (err) {
          console.error(err);
          reject(err);
        }
      });
    },
    [socket],
  );

  const onMessage = useCallback(
    (topic: string, callback: Function) => {
      if (!socket) return;

      const newCallback = (data: any) => {
        const success = data?.success;
        const reqId = data?.reqId;

        if (success) {
          return callback(data);
        }
      };

      messageHandlers.set(topic, newCallback);
    },
    [socket],
  );

  useEffect(() => {
    // delete old handlers
    messageHandlers.clear();
    queue.clear();

    console.log(`Connecting to server: ${WEBSOCKET_ENDPOINT}`);
    const ws = new WebSocket(WEBSOCKET_ENDPOINT, null, {
      headers: {
        Authorization: `Bearer ${authInfo.accessToken}`,
      },
    });
    ws.onopen = () => {
      setConnected(true);
      console.log('Connected to server');
    };
    ws.onclose = () => {
      setConnected(false);
      console.log('Disconnected from server');
    };
    ws.onerror = error => {
      console.log('Error: ', error);
      if (error?.message.includes('401')) {
        console.log('Unauthorized User, deleting auth info');
        dispatch(removeAuth());
      }
    };
    ws.onmessage = (...arg) => {
      try {
        const [buffer] = arg;
        let raw = Buffer.from(buffer.data);
        let str = raw.toString('utf8');
        const data = JSON.parse(str);

        // find handlers
        let handlers = messageHandlers;
        if (handlers != null && data.topic != null) {
          // formalized data
          const reqId = data.reqId;
          if (reqId == null) {
            console.warn(`Request ID not present for message: ${data.topic}`);
            return;
          }

          // find on queue
          const queueItem = queue.get(reqId);
          if (queueItem != null) {
            clearTimeout(queueItem.timeoutHandler);
            if (data.success) {
              queueItem?.callback(data.data);
            } else {
              queueItem.errorHandler(new Error(data.err_message));
            }

            queue.delete(reqId);
            return;
          }

          const handler = handlers.get(data?.topic);

          if (handler != null && typeof handler === 'function') {
            handler(data);
          } else {
            console.warn(`Unhandled message from websocket: ${data.topic}`);
          }
        } else {
          // raw data
          console.warn(`Unhandled raw message from websocket:`, data);
        }
      } catch (err) {
        console.error(err);
      }
    };
    setSocket(ws);
  }, []);

  return {socket, connected, onMessage, sendSync};
};

export default useSocket;
