import { parseCSV, type Bar } from './engine.ts';

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
  priceType: 'trade';
  instrumentType: 'perpetual';
  endpoint: string;
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
export function normalizeCandles(
  payload: unknown,
  interval: HLInterval,
  now: number,
  count = 2000,
): Bar[] {
  if (!Array.isArray(payload))
    throw new Error('Hyperliquid вернул неожиданный формат свечей.');
  const closed: Candle[] = [];
  for (const row of payload) {
    if (
      !row ||
      typeof row !== 'object' ||
      row.s !== GOLD_COIN ||
      row.i !== interval ||
      !Number.isSafeInteger(row.t) ||
      !Number.isSafeInteger(row.T) ||
      row.T < row.t ||
      row.T - row.t + 1 !== HL_INTERVALS[interval]
    ) {
      throw new Error(
        'Ответ Hyperliquid содержит неверный инструмент, интервал или время.',
      );
    }
    if (row.T < now) closed.push(row as Candle);
  }
  closed.sort((a, b) => a.t - b.t);
  if (closed.length < 300)
    throw new Error(
      'Hyperliquid вернул менее 300 закрытых свечей. Выберите меньший интервал.',
    );
  const chosen = closed.slice(-count);
  return parseCSV(
    'time,open,high,low,close\n' +
      chosen.map((r) => [r.t, r.o, r.h, r.l, r.c].join(',')).join('\n'),
  );
}
export async function loadHyperliquid(
  interval: HLInterval,
  signal?: AbortSignal,
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
  const endTime = Date.now();
  const data = await post({
    type: 'candleSnapshot',
    req: {
      coin: GOLD_COIN,
      interval,
      startTime: endTime - 2001 * HL_INTERVALS[interval],
      endTime,
    },
  });
  const bars = normalizeCandles(data, interval, endTime);
  return {
    bars,
    coin: GOLD_COIN,
    venue: 'Hyperliquid / trade[XYZ]',
    interval,
    fetchedAt: new Date().toISOString(),
    priceType: 'trade',
    instrumentType: 'perpetual',
    endpoint,
  };
}
