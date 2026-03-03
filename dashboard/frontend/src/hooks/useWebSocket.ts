// WebSocket 커넥션 훅 — 자동 재연결 + Zustand 스토어 업데이트.
import { useEffect, useRef } from 'react';
import { useBotStore } from '../stores/botStore';
import type { LiveStateUpdate } from '../types';

export function useWebSocket() {
  const setConnected = useBotStore((s) => s.setConnected);
  const setLiveState = useBotStore((s) => s.setLiveState);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${protocol}//${host}/ws/live`;

      const ws = new WebSocket(url);
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
        setConnected(false);
        const delay = Math.min(1000 * 2 ** retryRef.current, 30000);
        retryRef.current += 1;
        setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [setConnected, setLiveState]);
}
