import { type Bar } from './market-types.ts';

export const GOLD_COIN = 'xyz:GOLD';
export const HL_INTERVALS = {
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000,
} as const;
export type HLInterval = keyof typeof HL_INTERVALS;
export type MarketDataset = {
  bars: Bar[];
  coin: string;
  venue: string;
  interval: HLInterval;
  fetchedAt: string;
  midPrice: number;
  priceType: 'trade';
  instrumentType: 'perpetual';
  endpoint: string;
  archive?: {
    total: number;
    added: number;
    corrected: number;
    missing: number;
    mode: 'initial' | 'incremental';
    stale?: boolean;
    warning?: string;
  };
};
type Candle = {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  h: string;
  l: string;
  c: string;
};
export function normalizeMidPrice(payload: unknown): number {
  const value = Number(
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)[GOLD_COIN]
      : NaN,
  );
  if (!Number.isFinite(value) || value <= 0)
    throw new Error('Hyperliquid не вернул актуальную mid-цену xyz:GOLD.');
  return value;
}
export function normalizeCandleBatch(
  payload: unknown,
  interval: HLInterval,
  now: number,
): Bar[] {
  if (!Object.hasOwn(HL_INTERVALS, interval) || !Array.isArray(payload))
    throw new Error('Hyperliquid вернул неожиданный формат свечей.');
  const closed: Candle[] = [];
  for (const row of payload) {
    if (
      !row ||
      typeof row !== 'object' ||
      row.s !== GOLD_COIN ||
      row.i !== interval ||
      !Number.isSafeInteger(row.t) ||
      row.t < 0 ||
      row.t % HL_INTERVALS[interval] !== 0 ||
      !Number.isSafeInteger(row.T) ||
      row.T - row.t + 1 !== HL_INTERVALS[interval]
    )
      throw new Error(
        'Ответ Hyperliquid содержит неверный инструмент, интервал или время.',
      );
    if (row.T < now) closed.push(row as Candle);
  }
  closed.sort((a, b) => a.t - b.t);
  return closed.map((r, i) => {
    if (i && r.t === closed[i - 1].t)
      throw new Error('Повторное время свечи Hyperliquid.');
    const [open, high, low, close] = [r.o, r.h, r.l, r.c].map((v) =>
      typeof v === 'string' && v.trim() === '' ? NaN : Number(v),
    );
    if (
      [open, high, low, close].some((v) => !Number.isFinite(v) || v <= 0) ||
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      low > high
    )
      throw new Error('Некорректные OHLC-цены Hyperliquid.');
    return { time: new Date(r.t).toISOString(), open, high, low, close };
  });
}
export function normalizeCandles(
  payload: unknown,
  interval: HLInterval,
  now: number,
  count = 2000,
): Bar[] {
  const bars = normalizeCandleBatch(payload, interval, now).slice(-count);
  if (bars.length < 300)
    throw new Error(
      'Hyperliquid вернул менее 300 закрытых свечей. Выберите меньший интервал.',
    );
  return bars;
}
export async function loadHyperliquid(
  interval: HLInterval,
  signal?: AbortSignal,
  range?: { startTime: number; endTime: number },
): Promise<MarketDataset> {
  if (!Object.hasOwn(HL_INTERVALS, interval))
    throw new Error('Недопустимый интервал Hyperliquid.');
  const endpoint = 'https://api.hyperliquid.xyz/info';
  const post = async (body: unknown) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      credentials: 'omit',
    });
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? 'Hyperliquid ограничил частоту запросов. Повторите позже.'
          : 'Hyperliquid недоступен (HTTP ' + response.status + ').',
      );
    return response.json();
  };
  const meta = (await post({ type: 'meta', dex: 'xyz' })) as {
    universe?: { name?: string; isDelisted?: boolean }[];
  } | null;
  if (
    !Array.isArray(meta?.universe) ||
    !meta.universe.some(
      (m: { name?: string; isDelisted?: boolean }) =>
        m?.name === GOLD_COIN && !m.isDelisted,
    )
  )
    throw new Error(
      'Активный контракт xyz:GOLD не найден в каталоге Hyperliquid.',
    );
  const endTime = range?.endTime ?? Date.now();
  const data = await post({
    type: 'candleSnapshot',
    req: {
      coin: GOLD_COIN,
      interval,
      startTime: range?.startTime ?? endTime - 2001 * HL_INTERVALS[interval],
      endTime,
    },
  });
  const mids = await post({ type: 'allMids', dex: 'xyz' });
  const midPrice = normalizeMidPrice(mids);
  const bars = range
    ? normalizeCandleBatch(data, interval, endTime)
    : normalizeCandles(data, interval, endTime);
  return {
    bars,
    coin: GOLD_COIN,
    venue: 'Hyperliquid / trade[XYZ]',
    interval,
    fetchedAt: new Date().toISOString(),
    midPrice,
    priceType: 'trade',
    instrumentType: 'perpetual',
    endpoint,
  };
}
