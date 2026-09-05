// All prices are midpoint USD per troy ounce. Decisions use closed candles only.
export type Bar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};
export type Config = {
  capital: number;
  allocation: number;
  spread: number;
  slippage: number;
  commission: number;
  stop: number;
  take: number;
  maxDrawdown: number;
};
export type Strategy = {
  id: string;
  name: string;
  family: 'trend' | 'breakout' | 'reversion' | 'ml';
  a: number;
  b: number;
  description: string;
};
export type Trade = {
  entryTime: string;
  exitTime: string;
  side: number;
  entry: number;
  exit: number;
  quantity: number;
  pnl: number;
  reason: string;
};
export type Result = {
  returnPct: number;
  drawdownPct: number;
  winRate: number | null;
  profitFactor: number | null;
  trades: Trade[];
  equity: { time: string; value: number }[];
  finalCapital: number;
};
export type Model = {
  weights: number[];
  means: number[];
  scales: number[];
  samples: number;
  loss: number;
};
export type Candidate = {
  strategy: Strategy;
  validation: Result;
  score: number;
  eligible: boolean;
};
export type Experiment = {
  version: string;
  createdAt: string;
  config: Config;
  fingerprint: string;
  trainEnd: number;
  validationEnd: number;
  model: Model;
  candidates: Candidate[];
  selected: Strategy | null;
  test: Result | null;
  baseline: Result;
  latest: {
    direction: number;
    probability: number | null;
    explanation: string;
  };
  admitted: boolean;
  log: string[];
};
export const defaults: Config = {
  capital: 10000,
  allocation: 50,
  spread: 0.4,
  slippage: 0.1,
  commission: 0,
  stop: 0.8,
  take: 1.6,
  maxDrawdown: 10,
};
export const configLimits: Record<keyof Config, [number, number]> = {
  capital: [100, 10000000],
  allocation: [1, 100],
  spread: [0, 100],
  slippage: [0, 100],
  commission: [0, 100],
  stop: [0.05, 20],
  take: [0.05, 50],
  maxDrawdown: [0.1, 100],
};
export function validateConfig(config: Config) {
  for (const key of Object.keys(configLimits) as (keyof Config)[]) {
    const [min, max] = configLimits[key];
    if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max)
      throw new Error(
        'Проверьте параметры: значение вне допустимого диапазона.',
      );
  }
}
export function demoBars(count = 1600): Bar[] {
  let seed = 87123,
    price = 2300,
    time = Date.UTC(2024, 0, 2),
    previousMove = 0;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    while ([0, 6].includes(new Date(time).getUTCDay())) time += 3600000;
    const open = price * (1 + (rand() - 0.5) * 0.0003);
    const regime = Math.sin(i / 85) * 0.0007;
    const move =
      regime + 0.28 * previousMove + (rand() + rand() + rand() - 1.5) * 0.003;
    const close = open * (1 + move);
    previousMove = move;
    const high = Math.max(open, close) * (1 + rand() * 0.0014),
      low = Math.min(open, close) * (1 - rand() * 0.0014);
    bars.push({
      time: new Date(time).toISOString(),
      open: +open.toFixed(4),
      high: +high.toFixed(4),
      low: +low.toFixed(4),
      close: +close.toFixed(4),
    });
    price = close;
    time += 3600000;
  }
  return bars;
}
export function parseCSV(text: string): Bar[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .filter((x) => x.trim());
  if (lines.length < 301 || lines.length > 20001)
    throw new Error('Нужно от 300 до 20 000 свечей, плюс строка заголовка.');
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const split = (s: string) =>
    s.split(delimiter).map((x) => x.trim().replace(/^"(.*)"$/, '$1'));
  const headers = split(lines[0]).map((x) => x.toLowerCase());
  const fields = ['time', 'open', 'high', 'low', 'close'];
  const indices = fields.map((k) => headers.indexOf(k));
  if (indices.some((x) => x < 0) || new Set(headers).size !== headers.length)
    throw new Error(
      'Заголовок CSV: time,open,high,low,close. Имена столбцов не должны повторяться.',
    );
  let previous = -Infinity;
  return lines.slice(1).map((line, row) => {
    const values = split(line);
    if (values.length !== headers.length)
      throw new Error('Строка ' + (row + 2) + ': неверное число столбцов.');
    let raw = values[indices[0]],
      t: number;
    if (/^\d{10}(?:\d{3})?$/.test(raw))
      t = Number(raw) * (raw.length === 10 ? 1000 : 1);
    else {
      if (
        !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
          raw,
        )
      )
        throw new Error(
          'Строка ' +
            (row + 2) +
            ': используйте время ISO 8601 или Unix timestamp.',
        );
      const day = raw.slice(0, 10),
        calendar = Date.parse(day + 'T00:00:00Z');
      if (
        !Number.isFinite(calendar) ||
        new Date(calendar).toISOString().slice(0, 10) !== day
      )
        throw new Error(
          'Строка ' + (row + 2) + ': несуществующая календарная дата.',
        );
      raw = raw.replace(' ', 'T');
      if (raw.length === 10) raw += 'T00:00:00Z';
      else if (!/(Z|[+-]\d{2}:\d{2})$/.test(raw)) raw += 'Z';
      t = Date.parse(raw);
    }
    if (!Number.isFinite(t) || t <= previous)
      throw new Error(
        'Строка ' +
          (row + 2) +
          ': время должно строго возрастать, без повторов.',
      );
    previous = t;
    const [open, high, low, close] = indices
      .slice(1)
      .map((i) => (values[i] === '' ? NaN : Number(values[i])));
    if (
      [open, high, low, close].some((x) => !Number.isFinite(x) || x <= 0) ||
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      low > high
    )
      throw new Error('Строка ' + (row + 2) + ': некорректные OHLC-цены.');
    return { time: new Date(t).toISOString(), open, high, low, close };
  });
}
export const barsCSV = (bars: Bar[]) =>
  'time,open,high,low,close\n' +
  bars
    .map((b) => [b.time, b.open, b.high, b.low, b.close].join(','))
    .join('\n');
export function fingerprint(bars: Bar[]): string {
  let hash = 2166136261;
  for (const ch of barsCSV(bars)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
export function features(bars: Bar[], i: number): number[] {
  if (i < 20) throw new Error('Недостаточно свечей для признаков.');
  const returns = bars
      .slice(i - 19, i + 1)
      .map((b, j) => b.close / bars[i - 20 + j].close - 1),
    closes = bars.slice(i - 19, i + 1).map((b) => b.close),
    b = bars[i];
  return [
    b.close / bars[i - 1].close - 1,
    b.close / bars[i - 5].close - 1,
    b.close / bars[i - 20].close - 1,
    sd(returns),
    b.close / mean(closes) - 1,
    (b.close - b.open) / b.open,
  ];
}
const sigmoid = (z: number) =>
  1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));
export function trainModel(bars: Bar[], trainEnd: number): Model {
  const x: number[][] = [],
    y: number[] = [];
  // Label at i+1 must be strictly inside the training partition.
  for (let i = 20; i < trainEnd - 1; i++) {
    x.push(features(bars, i));
    y.push(bars[i + 1].close > bars[i + 1].open ? 1 : 0);
  }
  const means = x[0].map((_, j) => mean(x.map((r) => r[j]))),
    scales = means.map((_, j) => sd(x.map((r) => r[j])) || 1);
  const z = x.map((r) => [1, ...r.map((v, j) => (v - means[j]) / scales[j])]),
    weights = Array(7).fill(0) as number[];
  for (let epoch = 0; epoch < 220; epoch++) {
    const grad = weights.map(() => 0);
    z.forEach((r, i) => {
      const err = sigmoid(r.reduce((s, v, j) => s + v * weights[j], 0)) - y[i];
      r.forEach((v, j) => {
        grad[j] += err * v;
      });
    });
    weights.forEach((w, j) => {
      weights[j] -= 0.08 * (grad[j] / z.length + (j === 0 ? 0 : 0.01 * w));
    });
  }
  const loss = mean(
    z.map((r, i) => {
      const p = sigmoid(r.reduce((s, v, j) => s + v * weights[j], 0));
      return -y[i] * Math.log(p) - (1 - y[i]) * Math.log(1 - p);
    }),
  );
  return { weights, means, scales, samples: x.length, loss };
}
export function probability(model: Model, barFeatures: number[]): number {
  return sigmoid(
    model.weights[0] +
      barFeatures.reduce(
        (s, x, j) =>
          s + ((x - model.means[j]) / model.scales[j]) * model.weights[j + 1],
        0,
      ),
  );
}
export const strategies: Strategy[] = [
  ...[
    [5, 20],
    [10, 40],
    [20, 60],
  ].map(([a, b]) => ({
    id: 'ma-' + a + '-' + b,
    name: 'Скользящие ' + a + ' / ' + b,
    family: 'trend' as const,
    a,
    b,
    description:
      'Покупка, если средняя за ' +
      a +
      ' свечей выше средней за ' +
      b +
      '; иначе продажа. Выход при смене направления или защитном уровне.',
  })),
  ...[10, 20, 40].map((a) => ({
    id: 'break-' + a,
    name: 'Пробой диапазона ' + a,
    family: 'breakout' as const,
    a,
    b: 0,
    description:
      'Покупка при закрытии выше максимума предыдущих ' +
      a +
      ' свечей; продажа ниже минимума. Если нового пробоя нет, выход на следующем открытии.',
  })),
  ...[1, 1.5, 2].map((b) => ({
    id: 'mean-' + b,
    name: 'Возврат к среднему · ' + b + 'σ',
    family: 'reversion' as const,
    a: 20,
    b,
    description:
      'Покупка ниже средней за 20 свечей на ' +
      b +
      ' стандартных отклонения, продажа выше. Возврат внутрь диапазона закрывает позицию.',
  })),
  ...[0.52, 0.55, 0.6].map((a) => ({
    id: 'ml-' + a,
    name: 'ML · порог ' + Math.round(a * 100) + '%',
    family: 'ml' as const,
    a,
    b: 0,
    description:
      'Логистическая регрессия предсказывает рост следующей свечи от открытия до закрытия. Покупка при p > ' +
      a +
      ', продажа при p < ' +
      (1 - a).toFixed(2) +
      ', иначе вне рынка.',
  })),
];
export function decision(
  bars: Bar[],
  i: number,
  s: Strategy,
  model?: Model,
): number {
  if (i < Math.max(60, s.a)) return 0;
  const close = bars[i].close;
  if (s.family === 'ml') {
    if (!model) throw new Error('Модель не обучена.');
    const p = probability(model, features(bars, i));
    return p > s.a ? 1 : p < 1 - s.a ? -1 : 0;
  }
  if (s.family === 'trend') {
    const fast = mean(bars.slice(i - s.a + 1, i + 1).map((b) => b.close)),
      slow = mean(bars.slice(i - s.b + 1, i + 1).map((b) => b.close));
    return fast > slow ? 1 : fast < slow ? -1 : 0;
  }
  if (s.family === 'breakout') {
    const window = bars.slice(i - s.a, i);
    return close > Math.max(...window.map((b) => b.high))
      ? 1
      : close < Math.min(...window.map((b) => b.low))
        ? -1
        : 0;
  }
  const window = bars.slice(i - s.a + 1, i + 1).map((b) => b.close),
    m = mean(window),
    d = sd(window);
  return d === 0 ? 0 : close < m - s.b * d ? 1 : close > m + s.b * d ? -1 : 0;
}
export function backtest(
  bars: Bar[],
  signals: number[],
  start: number,
  end: number,
  c: Config,
): Result {
  validateConfig(c);
  let cash = c.capital,
    peak = c.capital,
    drawdown = 0;
  let position: {
    side: number;
    entry: number;
    quantity: number;
    entryTime: string;
    entryFee: number;
    stop: number;
    take: number;
  } | null = null;
  const trades: Trade[] = [],
    equity: Result['equity'] = [];
  const cost = c.spread / 2 + c.slippage;
  const closePosition = (mid: number, time: string, reason: string) => {
    if (!position) return;
    const p = position,
      exit = mid - p.side * cost;
    const gross = p.side * (exit - p.entry) * p.quantity,
      fee = p.quantity * c.commission;
    cash += gross - fee;
    trades.push({
      entryTime: p.entryTime,
      exitTime: time,
      side: p.side,
      entry: p.entry,
      exit,
      quantity: p.quantity,
      pnl: gross - fee - p.entryFee,
      reason,
    });
    position = null;
  };
  for (let i = start; i < end; i++) {
    const bar = bars[i],
      target = signals[i - 1] ?? 0;
    // Existing protective orders execute across gaps before a new market decision.
    let gapClosed = false;
    if (position) {
      const p = position;
      if (p.side * (bar.open - p.stop) <= 0) {
        closePosition(bar.open, bar.time, 'Стоп: разрыв цены');
        gapClosed = true;
      } else if (p.side * (bar.open - p.take) >= 0) {
        closePosition(bar.open, bar.time, 'Тейк: разрыв цены');
        gapClosed = true;
      }
    }
    if (position && position.side !== target)
      closePosition(bar.open, bar.time, 'Смена сигнала');
    if (!position && !gapClosed && target !== 0 && cash > 0) {
      const entry: number = bar.open + target * cost,
        quantity: number =
          (cash * c.allocation) / 100 / (bar.open + cost + c.commission),
        entryFee = quantity * c.commission;
      cash -= entryFee;
      position = {
        side: target,
        entry,
        quantity,
        entryTime: bar.time,
        entryFee,
        stop: entry * (1 - (target * c.stop) / 100),
        take: entry * (1 + (target * c.take) / 100),
      };
    }
    if (position) {
      const p = position,
        stopHit = p.side === 1 ? bar.low <= p.stop : bar.high >= p.stop,
        takeHit = p.side === 1 ? bar.high >= p.take : bar.low <= p.take;
      if (p.entryTime === bar.time && p.side * (bar.open - p.stop) <= 0)
        closePosition(bar.open, bar.time, 'Стоп: уровень при входе');
      else if (stopHit)
        closePosition(
          p.stop,
          bar.time,
          takeHit ? 'Стоп: оба уровня в свече' : 'Стоп-лосс',
        );
      else if (takeHit) closePosition(p.take, bar.time, 'Тейк-профит');
    }
    if (i === end - 1) closePosition(bar.close, bar.time, 'Конец периода');
    const value =
      cash +
      (position
        ? position.side *
            (bar.close - position.side * cost - position.entry) *
            position.quantity -
          position.quantity * c.commission
        : 0);
    peak = Math.max(peak, value);
    drawdown = Math.max(drawdown, ((peak - value) / peak) * 100);
    equity.push({ time: bar.time, value });
  }
  const gains = trades.reduce((s, t) => s + Math.max(t.pnl, 0), 0),
    losses = -trades.reduce((s, t) => s + Math.min(t.pnl, 0), 0);
  return {
    returnPct: (cash / c.capital - 1) * 100,
    drawdownPct: drawdown,
    winRate: trades.length
      ? (trades.filter((t) => t.pnl > 0).length / trades.length) * 100
      : null,
    profitFactor: losses > 0 ? gains / losses : null,
    trades,
    equity,
    finalCapital: cash,
  };
}
export function research(bars: Bar[], config: Config): Experiment {
  validateConfig(config);
  if (
    bars.some(
      (b) => b.low <= config.spread / 2 + config.slippage + config.commission,
    )
  )
    throw new Error('Издержки слишком велики относительно цен в наборе.');
  if (bars.length < 300) throw new Error('Нужно минимум 300 свечей.');
  const trainEnd = Math.floor(bars.length * 0.6),
    validationEnd = Math.floor(bars.length * 0.8),
    model = trainModel(bars, trainEnd);
  const signals = new Map(
    strategies.map((s) => [
      s.id,
      bars.map((_, i) => decision(bars, i, s, model)),
    ]),
  );
  const candidates = strategies
    .map((strategy) => {
      const validation = backtest(
        bars,
        signals.get(strategy.id)!,
        trainEnd,
        validationEnd,
        config,
      );
      const eligible =
        validation.trades.length >= 5 &&
        validation.drawdownPct <= config.maxDrawdown &&
        validation.returnPct > 0;
      return {
        strategy,
        validation,
        score: validation.returnPct - validation.drawdownPct,
        eligible,
      };
    })
    .sort(
      (a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score,
    );
  const selected = candidates.find((c) => c.eligible)?.strategy ?? null;
  // Test outcomes are computed only AFTER selection; never used for ranking.
  const test = selected
    ? backtest(
        bars,
        signals.get(selected.id)!,
        validationEnd,
        bars.length,
        config,
      )
    : null;
  const baseline = backtest(
    bars,
    signals.get('ma-10-40')!,
    validationEnd,
    bars.length,
    config,
  );
  const last = bars.length - 1,
    direction = selected ? decision(bars, last, selected, model) : 0;
  const p =
    selected?.family === 'ml' ? probability(model, features(bars, last)) : null;
  const admitted =
    !!test &&
    test.returnPct > 0 &&
    test.drawdownPct <= config.maxDrawdown &&
    test.trades.length >= 5;
  return {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    config: { ...config },
    fingerprint: fingerprint(bars),
    trainEnd,
    validationEnd,
    model,
    candidates,
    selected,
    test,
    baseline,
    admitted,
    latest: {
      direction,
      probability: p,
      explanation: selected
        ? selected.description
        : 'Ни один вариант не прошёл критерии валидации. Торговый сигнал не сформирован.',
    },
    log: [
      'Проверено ' +
        bars.length +
        ' свечей. Разбиение по времени: ' +
        trainEnd +
        ' / ' +
        (validationEnd - trainEnd) +
        ' / ' +
        (bars.length - validationEnd) +
        '.',
      'Логистическая регрессия обучена на ' +
        model.samples +
        ' примерах. Масштабирование признаков рассчитано только по обучающему периоду.',
      'На валидации проверено 12 вариантов: 9 технических и 3 порога одной ML-модели. Критерий ранжирования: доходность минус просадка.',
      selected
        ? 'Выбрана стратегия «' +
          selected.name +
          '». Параметры зафиксированы до расчёта финального теста.'
        : 'Ни одна стратегия не прошла ограничения: прибыль > 0, минимум 5 сделок, просадка в пределах лимита.',
      test
        ? 'Финальный тест: ' +
          test.trades.length +
          ' сделок, доходность ' +
          test.returnPct.toFixed(2) +
          '%. Результат не использовался для выбора стратегии.'
        : 'Финальный тест кандидата не выполнялся. Рассчитана только фиксированная базовая стратегия.',
      admitted
        ? 'Стратегия прошла учебные критерии допуска. Сигнал рассчитан по последней исторической свече.'
        : 'Допуск к сигналам не пройден. Решение системы: вне рынка.',
    ],
  };
}
