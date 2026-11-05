import {
  loadHyperliquid,
  type HLInterval,
  type MarketDataset,
} from './hyperliquid.ts';

export async function loadMarketHistory(
  interval: HLInterval,
  signal?: AbortSignal,
): Promise<MarketDataset> {
  if (
    typeof window !== 'undefined' &&
    !['localhost', '127.0.0.1'].includes(window.location.hostname)
  )
    return loadHyperliquid(interval, signal);
  const response = await fetch('/api/research/market/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interval }),
    signal,
    cache: 'no-store',
  });
  const value = (await response.json()) as MarketDataset & { error?: string };
  if (!response.ok)
    throw new Error(value.error ?? 'Не удалось обновить историю свечей.');
  return value;
}
