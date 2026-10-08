import type { Bar } from './engine.ts';
import { analyzeMarket } from './market-analysis.ts';

export type EntryPattern = {
  id: string;
  name: string;
  side: 'long' | 'short';
  status: 'confirmed' | 'waiting';
  reason: string;
  confirmation: string;
  invalidation: string;
  entry: number;
  stop: number;
  target: number;
  targetKind: 'structure' | 'projection';
  rr: number;
};

// All observations use closed candles and levels known before the signal candle.
export function findEntryPatterns(bars: Bar[]): EntryPattern[] {
  if (bars.length < 30) return [];
  const last = bars.at(-1)!;
  const previous = bars.at(-2)!;
  const prior = analyzeMarket(bars.slice(0, -1));
  const range =
    bars.slice(-15, -1).reduce((sum, bar) => sum + bar.high - bar.low, 0) / 14;
  const buffer = Math.max(range * 0.1, last.close * 0.0001);
  const tolerance = range * 0.25;
  const patterns: EntryPattern[] = [];

  const add = (
    id: string,
    name: string,
    side: 'long' | 'short',
    confirmed: boolean,
    level: number,
    extreme: number,
    reason: string,
  ) => {
    const sign = side === 'long' ? 1 : -1;
    const entry = confirmed
      ? last.close
      : sign === 1
        ? last.high + buffer
        : last.low - buffer;
    const stop = extreme - sign * buffer;
    const risk = sign * (entry - stop);
    if (risk <= 0 || !Number.isFinite(risk) || stop <= 0) return;
    const obstacle = prior.pivots
      .filter(
        (pivot) =>
          pivot.kind === (sign === 1 ? 'high' : 'low') &&
          sign * (pivot.price - entry) > 0,
      )
      .map((pivot) => pivot.price)
      .sort((a, b) => sign * (a - b))[0];
    const target = obstacle ?? entry + sign * risk * 2;
    const rr = (sign * (target - entry)) / risk;
    // A nearby opposing level must not be ignored to manufacture an attractive trade.
    if (rr < 1.5 || target <= 0) return;
    patterns.push({
      id,
      name,
      side,
      status: confirmed ? 'confirmed' : 'waiting',
      reason,
      confirmation: confirmed
        ? 'Условие выполнено на последней закрытой свече. Вход рассчитан от её закрытия; перед исполнением нужен новый расчёт по фактической цене.'
        : `Нужно закрытие ${sign === 1 ? 'выше' : 'ниже'} ${entry.toFixed(2)} на следующей свече. До этого вход не подтверждён.`,
      invalidation: `Отмена при достижении стопа ${stop.toFixed(2)} или закрытии ${sign === 1 ? 'ниже' : 'выше'} уровня ${level.toFixed(2)}. Перепроверить после следующей свечи.`,
      entry,
      stop,
      target,
      targetKind: obstacle === undefined ? 'projection' : 'structure',
      rr,
    });
  };

  for (const side of ['long', 'short'] as const) {
    const up = side === 'long';
    const level = up ? prior.support : prior.resistance;
    if (level !== null) {
      const swept = up
        ? last.low < level - buffer &&
          last.close > level &&
          last.close > last.open
        : last.high > level + buffer &&
          last.close < level &&
          last.close < last.open;
      if (swept)
        add(
          `sweep-${side}`,
          'Вынос уровня и возврат',
          side,
          false,
          level,
          up ? last.low : last.high,
          `Последняя свеча вышла за ${up ? 'поддержку' : 'сопротивление'} ${level.toFixed(2)} и закрылась обратно. Ожидается продолжение после возврата.`,
        );
    }

    const breakout = prior.events
      .filter(
        (event) =>
          event.kind === (up ? 'breakout-up' : 'breakout-down') &&
          event.index >= bars.length - 7,
      )
      .at(-1);
    if (breakout) {
      const since = bars.slice(breakout.index + 1, -1);
      const held = since.every((bar) =>
        up ? bar.close > breakout.level : bar.close < breakout.level,
      );
      const touched = up
        ? last.low <= breakout.level + tolerance
        : last.high >= breakout.level - tolerance;
      const rejected = up
        ? last.close > breakout.level && last.close > last.open
        : last.close < breakout.level && last.close < last.open;
      if (held && touched && rejected)
        add(
          `retest-${side}`,
          'Пробой и ретест',
          side,
          true,
          breakout.level,
          up
            ? Math.min(last.low, breakout.level)
            : Math.max(last.high, breakout.level),
          `Пробой ${breakout.level.toFixed(2)} произошёл ${bars.length - 1 - breakout.index} свечей назад. Последняя свеча проверила уровень и закрылась в сторону пробоя.`,
        );
    }

    if (prior.trend === (up ? 'up' : 'down') && level !== null) {
      const near = up
        ? last.low >= level - tolerance && last.low <= level + tolerance
        : last.high <= level + tolerance && last.high >= level - tolerance;
      const reversal = up
        ? last.close > last.open && last.close > previous.high
        : last.close < last.open && last.close < previous.low;
      const pullback = bars
        .slice(-5, -1)
        .some((bar) => (up ? bar.close < bar.open : bar.close > bar.open));
      if (near && reversal && pullback)
        add(
          `pullback-${side}`,
          'Откат по тренду',
          side,
          true,
          level,
          up ? Math.min(last.low, level) : Math.max(last.high, level),
          `После отката к уровню ${level.toFixed(2)} свеча закрылась за экстремумом предыдущей свечи в сторону подтверждённого тренда.`,
        );
    }
  }
  return patterns.sort(
    (a, b) =>
      Number(b.status === 'confirmed') - Number(a.status === 'confirmed') ||
      b.rr - a.rr,
  );
}
