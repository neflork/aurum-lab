import {
  barsCSV,
  fingerprint,
  parseCSV,
  strategies,
  validateConfig,
  type Bar,
  type Config,
  type Experiment,
} from './engine.ts';
import { GOLD_COIN, HL_INTERVALS, type MarketDataset } from './hyperliquid.ts';

export const RESEARCH_CACHE_KEY = 'aurum.research.v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export type ResearchSnapshot = {
  market: MarketDataset;
  experiment: Experiment;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object';
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const date = (v: unknown) =>
  typeof v === 'string' && Number.isFinite(Date.parse(v));
const strategy = (v: unknown) =>
  v === null || strategies.some((s) => JSON.stringify(s) === JSON.stringify(v));
const result = (v: unknown): boolean =>
  object(v) &&
  ['returnPct', 'drawdownPct', 'finalCapital'].every((k) => finite(v[k])) &&
  ['winRate', 'profitFactor'].every((k) => v[k] === null || finite(v[k])) &&
  Array.isArray(v.equity) &&
  v.equity.every((p) => object(p) && date(p.time) && finite(p.value)) &&
  Array.isArray(v.trades) &&
  v.trades.every(
    (t) =>
      object(t) &&
      date(t.entryTime) &&
      date(t.exitTime) &&
      [1, -1].includes(t.side as number) &&
      typeof t.reason === 'string' &&
      ['entry', 'exit', 'quantity', 'pnl'].every((k) => finite(t[k])),
  );

function validExperiment(v: unknown, bars: Bar[]): v is Experiment {
  if (
    !object(v) ||
    v.version !== '1.0.0' ||
    !date(v.createdAt) ||
    !object(v.config)
  )
    return false;
  validateConfig(v.config as Config);
  if (
    v.fingerprint !== fingerprint(bars) ||
    v.trainEnd !== Math.floor(bars.length * 0.6) ||
    v.validationEnd !== Math.floor(bars.length * 0.8) ||
    typeof v.admitted !== 'boolean'
  )
    return false;
  const m = v.model;
  if (
    !object(m) ||
    !finite(m.samples) ||
    !finite(m.loss) ||
    !Array.isArray(m.weights) ||
    m.weights.length !== 7 ||
    !m.weights.every(finite) ||
    !Array.isArray(m.means) ||
    m.means.length !== 6 ||
    !m.means.every(finite) ||
    !Array.isArray(m.scales) ||
    m.scales.length !== 6 ||
    !m.scales.every((n) => finite(n) && n > 0)
  )
    return false;
  return (
    strategy(v.selected) &&
    (v.test === null || result(v.test)) &&
    result(v.baseline) &&
    Array.isArray(v.candidates) &&
    v.candidates.length === strategies.length &&
    v.candidates.every(
      (c) =>
        object(c) &&
        c.strategy !== null &&
        strategy(c.strategy) &&
        result(c.validation) &&
        finite(c.score) &&
        typeof c.eligible === 'boolean',
    ) &&
    object(v.latest) &&
    [-1, 0, 1].includes(v.latest.direction as number) &&
    (v.latest.probability === null || finite(v.latest.probability)) &&
    typeof v.latest.explanation === 'string' &&
    Array.isArray(v.log) &&
    v.log.every((l) => typeof l === 'string')
  );
}

export function loadResearchSnapshot(
  storage: Storage,
): ResearchSnapshot | null {
  try {
    const raw = storage.getItem(RESEARCH_CACHE_KEY);
    if (!raw || raw.length > 8_000_000) return null;
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.schema !== 1 || !object(value.market))
      return null;
    const m = value.market;
    if (
      !Array.isArray(m.bars) ||
      m.bars.length < 300 ||
      m.bars.length > 5000 ||
      m.coin !== GOLD_COIN ||
      m.venue !== 'Hyperliquid / trade[XYZ]' ||
      typeof m.interval !== 'string' ||
      !(m.interval in HL_INTERVALS) ||
      !date(m.fetchedAt) ||
      !finite(m.midPrice) ||
      m.midPrice <= 0 ||
      m.priceType !== 'trade' ||
      m.instrumentType !== 'perpetual' ||
      typeof m.endpoint !== 'string'
    )
      return null;
    const bars = parseCSV(barsCSV(m.bars as Bar[]));
    if (!validExperiment(value.experiment, bars)) return null;
    return {
      market: { ...m, bars } as MarketDataset,
      experiment: value.experiment,
    };
  } catch {
    return null;
  }
}

export function saveResearchSnapshot(
  storage: Storage,
  snapshot: ResearchSnapshot,
): boolean {
  try {
    if (!validExperiment(snapshot.experiment, snapshot.market.bars))
      return false;
    storage.setItem(
      RESEARCH_CACHE_KEY,
      JSON.stringify({ schema: 1, ...snapshot }),
    );
    return true;
  } catch {
    return false;
  }
}

export function researchMatches(
  experiment: Experiment | null,
  bars: Bar[],
  config: Config,
): boolean {
  return (
    !!experiment &&
    experiment.version === '1.0.0' &&
    experiment.fingerprint === fingerprint(bars) &&
    (Object.keys(config) as (keyof Config)[]).every(
      (k) => config[k] === experiment.config[k],
    )
  );
}
