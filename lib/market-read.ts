import type { Bar } from './engine.ts';
import type { MarketStructure } from './market-analysis.ts';

export type MarketRead = {
  source?: 'ai' | 'proxy';
  commentary?: string;
  aiError?: string;
  bias: 'up' | 'down' | 'range';
  biasLabel: string;
  dayOpen: number;
  dayLabel: string;
  flow: 'buying' | 'selling' | 'balanced';
  flowLabel: string;
  flowScore: number;
  smtLabel: string;
  confidence: number;
  scenario: string;
  reasons: string[];
};

const dayKey = (time: string) => new Date(time).toISOString().slice(0, 10);

export function analyzeMarketRead(
  bars: Bar[],
  structure: MarketStructure,
): MarketRead {
  const last = bars.at(-1)!;
  const today = bars.filter((bar) => dayKey(bar.time) === dayKey(last.time));
  const dayOpen = today[0]?.open ?? last.open;
  const dayChange = last.close - dayOpen;
  const dayLabel =
    dayChange > 0 ? 'выше' : dayChange < 0 ? 'ниже' : 'на уровне';
  const sample = bars.slice(-12);
  const pressure =
    sample.reduce((sum, bar) => {
      const range = Math.max(bar.high - bar.low, 0.000001);
      return sum + (bar.close - bar.open) / range;
    }, 0) / Math.max(sample.length, 1);
  const flow =
    pressure > 0.12 ? 'buying' : pressure < -0.12 ? 'selling' : 'balanced';
  const flowLabel =
    flow === 'buying'
      ? 'покупатели'
      : flow === 'selling'
        ? 'продавцы'
        : 'баланс';
  const trendVote =
    structure.trend === 'up' ? 1 : structure.trend === 'down' ? -1 : 0;
  const dayVote = dayChange > 0 ? 1 : dayChange < 0 ? -1 : 0;
  const flowVote = flow === 'buying' ? 1 : flow === 'selling' ? -1 : 0;
  const biasVote = trendVote + dayVote + flowVote;
  const bias = biasVote > 0 ? 'up' : biasVote < 0 ? 'down' : 'range';
  const biasLabel =
    bias === 'up' ? 'вверх' : bias === 'down' ? 'вниз' : 'нейтрально';
  const flowMomentum = sample.at(-1)!.close - sample[0].open;
  const smt =
    flowMomentum * pressure < 0 && Math.abs(pressure) > 0.08
      ? flowMomentum > 0
        ? 'медвежья дивергенция (SMT-прокси)'
        : 'бычья дивергенция (SMT-прокси)'
      : 'нет подтверждённой дивергенции';
  const confidence = Math.round(
    Math.min(100, 42 + Math.abs(biasVote) * 16 + Math.abs(pressure) * 22),
  );
  return {
    source: 'proxy',
    bias,
    biasLabel,
    dayOpen,
    dayLabel: 'Цена ' + dayLabel + ' открытия дня',
    flow,
    flowLabel,
    flowScore: Math.round(pressure * 100),
    smtLabel: smt,
    confidence,
    scenario:
      bias === 'up'
        ? 'Искать подтверждённый вход в long после отката или продолжения импульса.'
        : bias === 'down'
          ? 'Искать подтверждённый вход в short после отката или продолжения импульса.'
          : 'Не форсировать вход: дождаться выхода из диапазона и подтверждения закрытием.',
    reasons: [
      structure.trendLabel,
      'Цена ' + dayLabel + ' открытия дня (' + dayOpen.toFixed(2) + ')',
      'Order flow по свечам: ' + flowLabel,
      smt,
    ],
  };
}
