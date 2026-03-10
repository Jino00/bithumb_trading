// REST API 페치 훅 — @tanstack/react-query 래퍼.
import { useQuery } from '@tanstack/react-query';
import type {
  PortfolioOverview,
  TradesPaginated,
  EquityCurvePoint,
  TradeSummary,
  AnalyticsBucket,
  ExitPattern,
  PnLBucket,
  SystemEvent,
  CompletedTrade,
  PaperOverview,
} from '../types';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function usePortfolioOverview() {
  return useQuery<PortfolioOverview>({
    queryKey: ['portfolio', 'overview'],
    queryFn: () => fetchJson('/api/portfolio/overview'),
    refetchInterval: 5000,
  });
}

export function useRecentTrades(limit = 20) {
  return useQuery<CompletedTrade[]>({
    queryKey: ['trades', 'recent', limit],
    queryFn: () => fetchJson(`/api/trades/recent?limit=${limit}`),
    refetchInterval: 10000,
  });
}

export function useCompletedTrades(limit = 50, offset = 0, coin?: string) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (coin) params.set('coin', coin);
  return useQuery<TradesPaginated>({
    queryKey: ['trades', 'completed', limit, offset, coin],
    queryFn: () => fetchJson(`/api/trades/completed?${params}`),
    refetchInterval: 15000,
  });
}

export function useEquityCurve() {
  return useQuery<EquityCurvePoint[]>({
    queryKey: ['trades', 'equity-curve'],
    queryFn: () => fetchJson('/api/trades/equity-curve'),
    refetchInterval: 30000,
  });
}

export function useTradeSummary() {
  return useQuery<TradeSummary>({
    queryKey: ['analytics', 'summary'],
    queryFn: () => fetchJson('/api/analytics/summary'),
    refetchInterval: 30000,
  });
}

export function useAnalyticsByHour() {
  return useQuery<AnalyticsBucket[]>({
    queryKey: ['analytics', 'by-hour'],
    queryFn: () => fetchJson('/api/analytics/by-hour'),
    refetchInterval: 60000,
  });
}

export function useAnalyticsByStrategy() {
  return useQuery<AnalyticsBucket[]>({
    queryKey: ['analytics', 'by-strategy'],
    queryFn: () => fetchJson('/api/analytics/by-strategy'),
    refetchInterval: 60000,
  });
}

export function useAnalyticsByTrend() {
  return useQuery<AnalyticsBucket[]>({
    queryKey: ['analytics', 'by-trend'],
    queryFn: () => fetchJson('/api/analytics/by-trend'),
    refetchInterval: 60000,
  });
}

export function useAnalyticsByVolatility() {
  return useQuery<AnalyticsBucket[]>({
    queryKey: ['analytics', 'by-volatility'],
    queryFn: () => fetchJson('/api/analytics/by-volatility'),
    refetchInterval: 60000,
  });
}

export function useAnalyticsByRsiBucket() {
  return useQuery<AnalyticsBucket[]>({
    queryKey: ['analytics', 'by-rsi-bucket'],
    queryFn: () => fetchJson('/api/analytics/by-rsi-bucket'),
    refetchInterval: 60000,
  });
}

export function useExitPatterns() {
  return useQuery<ExitPattern[]>({
    queryKey: ['analytics', 'exit-patterns'],
    queryFn: () => fetchJson('/api/analytics/exit-patterns'),
    refetchInterval: 60000,
  });
}

export function usePnlDistribution() {
  return useQuery<PnLBucket[]>({
    queryKey: ['analytics', 'pnl-distribution'],
    queryFn: () => fetchJson('/api/analytics/pnl-distribution'),
    refetchInterval: 60000,
  });
}

export function useSystemEvents(limit = 50) {
  return useQuery<SystemEvent[]>({
    queryKey: ['system', 'events', limit],
    queryFn: () => fetchJson(`/api/system/events?limit=${limit}`),
    refetchInterval: 10000,
  });
}

export function usePaperOverview() {
  return useQuery<PaperOverview>({
    queryKey: ['paper', 'overview'],
    queryFn: () => fetchJson('/api/paper/overview'),
    refetchInterval: 5000,
  });
}
