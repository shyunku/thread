import {useEffect, useState} from 'react';
import {AppState} from 'react-native';
import {useDispatch, useSelector} from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {accountInfoSlice, accountAuthSlice} from '@/store/accountSlice';
import {getServerEndpoint} from '@/util/common';
import {applyInitialState} from './executor';
import {ReadReplica, toLegacy} from '@/sync/readReplica';

// Native WebSocket headers carry the bearer token; never put tokens in URLs.
export default function useSyncRead() {
  const account = useSelector(accountInfoSlice),
    auth = useSelector(accountAuthSlice);
  const dispatch = useDispatch();
  const [mode, setMode] = useState('unknown');
  const [status, setStatus] = useState({
    connected: false,
    seq: '0',
    high: '0',
    error: '',
  });
  useEffect(() => {
    if (!account.uid || !auth.accessToken) return;
    let stopped = false,
      running = false,
      socket: WebSocket | null = null,
      epoch = '';
    setMode('unknown');
    setStatus({connected: false, seq: '0', high: '0', error: ''});
    const base = getServerEndpoint().replace(/\/v[0-9]+\/?$/, '') + '/v2/sync';
    const request = async (path: string, body?: any) => {
      try {
        const result = await axios({
          url: base + path,
          method: body === undefined ? 'GET' : 'POST',
          data: body,
          headers: {Authorization: 'Bearer ' + auth.accessToken},
          timeout: 30000,
        });
        if (stopped) throw new Error('STOPPED');
        return result.data;
      } catch (e: any) {
        throw new Error(
          e.response?.data?.code ||
            (e.response?.status === 401 ? 'UNAUTHORIZED' : 'SYNC_UNAVAILABLE'),
        );
      }
    };
    const replica = new ReadReplica(account.uid, AsyncStorage, request);
    const show = () => {
      if (!stopped && replica.cache)
        applyInitialState(dispatch, 0, toLegacy(replica.cache.rows), account.uid);
    };
    const openSocket = () => {
      if (socket || stopped) return;
      const ws = new WebSocket(
        base.replace(/^http/, 'ws') +
          '/connect?epoch=' +
          encodeURIComponent(epoch),
        null,
        {
          headers: {Authorization: 'Bearer ' + auth.accessToken},
        },
      );
      socket = ws;
      ws.onmessage = () => {
        void reconcile();
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
      };
      ws.onerror = () => {
        ws.close();
      };
    };
    const reconcile = async () => {
      if (stopped || running) return;
      running = true;
      try {
        const caps = await request('/capabilities');
        if (caps.protocolVersion !== 2 || !['legacy', 'v2'].includes(caps.mode))
          throw new Error('UPDATE_REQUIRED');
        if (replica.cache && caps.mode !== 'v2')
          throw new Error('ACCOUNT_MODE_REGRESSION');
        if (stopped) return;
        setMode(caps.mode);
        if (caps.mode === 'legacy') return;
        if (!caps.enabled) throw new Error('SYNC_DISABLED');
        if (epoch !== caps.epoch) {
          socket?.close();
          socket = null;
          epoch = caps.epoch;
        }
        await replica.sync(epoch);
        if (stopped) return;
        show();
        setStatus({
          connected: true,
          seq: replica.cache!.seq,
          high: replica.cache!.seq,
          error: '',
        });
        openSocket();
      } catch (e: any) {
        if (!stopped)
          setStatus(old => ({...old, connected: false, error: e.message}));
      } finally {
        running = false;
      }
    };
    void (async () => {
      try {
        await replica.load();
        if (stopped) return;
        if (replica.cache) {
          setMode('v2');
          setStatus(old => ({...old, seq: replica.cache!.seq, high: replica.cache!.seq}));
          show();
        }
        await reconcile();
      } catch {
        if (!stopped) setStatus(old => ({...old, error: 'CACHE_UNAVAILABLE'}));
      }
    })();
    const timer = setInterval(() => {
      void reconcile();
    }, 15000);
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') void reconcile();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      foreground.remove();
      socket?.close();
    };
  }, [account.uid, auth.accessToken, dispatch]);
  return {mode, uid: account.uid, ...status};
}
