import {
  decision,
  features,
  probability,
  type Bar,
  type Experiment,
} from "./engine.ts";
import type { MarketStructure } from "./market-analysis.ts";

export type TradingSignal = {
  side: "long" | "short" | "wait";
  label: "LONG" | "SHORT" | "WAIT";
  direction: string;
  agreement: number;
  strategyVote: number;
  modelVote: number;
  structureVote: number;
  confirmed: boolean;
  action: string;
  reason: string;
  invalidation: string;
  stop: number | null;
  take: number | null;
};

export function makeTradingSignal(
  bars: Bar[],
  experiment: Experiment | null,
  structure: MarketStructure,
): TradingSignal {
  const waiting: TradingSignal = {
    side: "wait",
    label: "WAIT",
    direction: "не определено",
    agreement: 0,
    strategyVote: 0,
    modelVote: 0,
    structureVote:
      structure.trend === "up" ? 1 : structure.trend === "down" ? -1 : 0,
    confirmed: false,
    action: "Не открывать новую учебную позицию до следующего подтверждения.",
    reason:
      "Исследование ещё не завершено или стратегия не прошла критерии допуска.",
    invalidation: "Решение будет пересчитано после закрытия новой свечи.",
    stop: null,
    take: null,
  };
  if (!experiment?.selected || !experiment.admitted || bars.length < 62)
    return waiting;

  const last = bars.length - 1;
  const current = decision(bars, last, experiment.selected, experiment.model);
  const previous = decision(
    bars,
    last - 1,
    experiment.selected,
    experiment.model,
  );
  const strategyVote = current;
  const confirmed = current !== 0 && current === previous;
  const p = probability(experiment.model, features(bars, last));
  const modelVote = p >= 0.55 ? 1 : p <= 0.45 ? -1 : 0;
  const structureVote =
    structure.trend === "up" ? 1 : structure.trend === "down" ? -1 : 0;
  const supportingVotes = [modelVote, structureVote].filter(
    (vote) => vote === strategyVote,
  ).length;
  const opposingVotes = [modelVote, structureVote].filter(
    (vote) => vote === -strategyVote,
  ).length;
  const accepted = confirmed && supportingVotes >= 1 && opposingVotes < 2;
  const agreement = confirmed
    ? Math.max(20, 45 + supportingVotes * 20 - opposingVotes * 15)
    : 15;

  if (!accepted) {
    return {
      ...waiting,
      strategyVote,
      modelVote,
      structureVote,
      confirmed,
      direction:
        strategyVote === 1
          ? "слабый уклон вверх"
          : strategyVote === -1
            ? "слабый уклон вниз"
            : "не определено",
      agreement,
      reason: !confirmed
        ? "Сигнал выбранной стратегии не повторился на двух последних закрытых свечах."
        : "Стратегия, ML-модель и структура рынка пока не дают достаточного согласия.",
    };
  }

  const side = strategyVote === 1 ? "long" : "short";
  const price = bars[last].close;
  const stop = price * (1 - (strategyVote * experiment.config.stop) / 100);
  const take = price * (1 + (strategyVote * experiment.config.take) / 100);
  return {
    side,
    label: side === "long" ? "LONG" : "SHORT",
    direction: side === "long" ? "вверх" : "вниз",
    agreement,
    strategyVote,
    modelVote,
    structureVote,
    confirmed,
    action:
      side === "long"
        ? "Учебный сценарий: рассматривать длинную фьючерсную позицию после открытия следующей свечи."
        : "Учебный сценарий: рассматривать короткую фьючерсную позицию после открытия следующей свечи.",
    reason: `Направление стратегии подтверждено двумя закрытиями; с ним согласны ${supportingVotes} из 2 независимых фильтров.`,
    invalidation:
      "Сигнал действует до закрытия следующей свечи и отменяется при потере подтверждения.",
    stop,
    take,
  };
}
