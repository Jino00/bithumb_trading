// WebSocket 커넥션 훅 — exponential backoff + 최대 재시도 제한.
import { useEffect, useRef } from 'react';
import { useBotStore } from '../stores/botStore';
import type { LiveStateUpdate } from '../types';

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;

export function useWebSocket() {
  const setConnected = useBotStore((s) => s.setConnected);
  const setLiveState = useBotStore((s) => s.setLiveState);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      if (retryRef.current >= MAX_RETRIES) {
        setConnected(false);
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const ws = new WebSocket(`${protocol}//${host}/ws/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data: LiveStateUpdate = JSON.parse(event.data);
          setLiveState(data);
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setConnected(false);
        const delay = Math.min(BASE_DELAY_MS * 2 ** retryRef.current, MAX_DELAY_MS);
        retryRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [setConnected, setLiveState]);
}
