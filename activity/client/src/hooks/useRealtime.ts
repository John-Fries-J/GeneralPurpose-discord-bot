import { useEffect, useState } from 'react';
import { ActivityApiClient } from '../services/activityApi';

type RealtimeState = {
  status: 'idle' | 'connected' | 'reconnecting' | 'error';
  tick: number;
};

export function useRealtime(api: ActivityApiClient, enabled: boolean): RealtimeState {
  const [state, setState] = useState<RealtimeState>({ status: 'idle', tick: 0 });

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', tick: 0 });
      return undefined;
    }

    let closed = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;

    function connect() {
      if (closed) return;
      setState(current => ({ ...current, status: current.status === 'idle' ? 'reconnecting' : current.status }));
      source = new EventSource(api.eventSourceUrl(), { withCredentials: true });
      source.addEventListener('hello', () => {
        setState(current => ({ ...current, status: 'connected' }));
      });
      source.addEventListener('activity', () => {
        setState(current => ({ status: 'connected', tick: current.tick + 1 }));
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (closed) return;
        setState(current => ({ ...current, status: 'reconnecting' }));
        reconnectTimer = window.setTimeout(connect, 1500);
      };
    }

    connect();
    return () => {
      closed = true;
      source?.close();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
  }, [api, enabled]);

  return state;
}
