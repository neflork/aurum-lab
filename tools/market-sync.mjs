import {
  loadHyperliquid,
  GOLD_COIN,
  HL_INTERVALS,
} from '../lib/hyperliquid.ts';
import { candleGaps, latestContinuousBars } from '../lib/candle-history.ts';

export function archiveDataset(archive, stats = {}) {
  if (!archive) return null;
  const {
    initialized: _initialized,
    lastRepair: _lastRepair,
    ...dataset
  } = archive;
  const gaps = candleGaps(archive.bars, archive.interval);
  const bars = latestContinuousBars(archive.bars, archive.interval);
  if (bars.length < 300)
    throw new Error(
      'После разрыва истории меньше 300 последовательных свечей. Требуется восстановить данные.',
    );
  const missing = gaps.reduce((n, g) => n + g.count, 0);
  return {
    ...dataset,
    bars,
    archive: {
      total: archive.bars.length,
      added: 0,
      corrected: 0,
      mode: 'incremental',
      missing,
      ...(missing
        ? {
            warning: `В архиве отсутствует ${missing} свечей. Анализ использует последний непрерывный участок (${bars.length} свечей).`,
          }
        : {}),
      ...stats,
    },
  };
}

export function createMarketSync(
  database,
  { load = loadHyperliquid, clock = Date.now } = {},
) {
  const pending = new Map();
  const checkedAt = new Map();
  return function sync(interval) {
    if (!Object.hasOwn(HL_INTERVALS, interval))
      return Promise.reject(new Error('Недопустимый интервал Hyperliquid.'));
    if (pending.has(interval)) return pending.get(interval);
    // Multiple tabs share a single synchronization and a short request cooldown.
    if (clock() - (checkedAt.get(interval) ?? 0) < 15000)
      return Promise.resolve(archiveDataset(database.marketHistory(interval)));
    const task = (async () => {
      const previous = database.marketHistory(interval);
      const now = clock(),
        step = HL_INTERVALS[interval];
      const availableFrom = Math.floor(now / step) * step - 4999 * step;
      const initial = !previous?.initialized;
      let startTime = initial
        ? availableFrom
        : Math.max(
            availableFrom,
            Date.parse(previous.bars.at(-1).time) - 2 * step,
          );
      // Repair holes still reachable through the API, without repeatedly
      // re-downloading unrecoverable periods or hammering market-closure gaps.
      const repair =
        previous && now - previous.lastRepair >= 900000
          ? candleGaps(previous.bars, interval).find(
              (g) => g.to >= availableFrom,
            )
          : null;
      if (repair)
        startTime = Math.min(
          startTime,
          Math.max(availableFrom, repair.from - step),
        );
      try {
        const dataset = await load(interval, AbortSignal.timeout(22000), {
          startTime,
          endTime: now,
        });
        if (dataset.coin !== GOLD_COIN || dataset.interval !== interval)
          throw new Error('Получен другой инструмент или таймфрейм.');
        if (
          !dataset.bars.length ||
          Date.parse(dataset.bars.at(-1).time) <
            Math.floor(now / step) * step - step
        )
          throw new Error('Hyperliquid не вернул последнюю закрытую свечу.');
        if (
          dataset.bars.some(
            (b) => Date.parse(b.time) < startTime || Date.parse(b.time) >= now,
          )
        )
          throw new Error('Свечи находятся вне запрошенного диапазона.');
        const stats = database.mergeMarket(dataset, {
          initialized: true,
          repairedAt: repair ? now : 0,
          now,
        });
        checkedAt.set(interval, now);
        return archiveDataset(database.marketHistory(interval), {
          ...stats,
          mode: initial ? 'initial' : 'incremental',
        });
      } catch (error) {
        const cached = archiveDataset(database.marketHistory(interval));
        if (!cached) throw error;
        return {
          ...cached,
          archive: {
            ...cached.archive,
            stale: true,
            warning: `Свежие данные не подтверждены: ${error.message}${cached.archive.warning ? ' ' + cached.archive.warning : ''}`,
          },
        };
      }
    })().finally(() => pending.delete(interval));
    pending.set(interval, task);
    return task;
  };
}
