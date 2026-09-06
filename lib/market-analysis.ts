import type { Bar } from "./engine.ts";

export type Pivot = {
  index: number;
  detectedAt: number;
  price: number;
  kind: "high" | "low";
};
export type MarketEvent = {
  index: number;
  kind: "breakout-up" | "breakout-down" | "reclaim-up" | "reclaim-down";
  level: number;
  title: string;
  detail: string;
};
export type MarketStructure = {
  trend: "up" | "down" | "range";
  trendLabel: string;
  confidence: "подтверждён" | "формируется";
  pivots: Pivot[];
  support: number | null;
  resistance: number | null;
  events: MarketEvent[];
  observations: string[];
};

export function confirmedPivots(bars: Bar[], radius = 3): Pivot[] {
  const result: Pivot[] = [];
  for (let i = radius; i < bars.length - radius; i++) {
    const surrounding = [
      ...bars.slice(i - radius, i),
      ...bars.slice(i + 1, i + radius + 1),
    ];
    if (surrounding.every((bar) => bars[i].high > bar.high))
      result.push({
        index: i,
        detectedAt: i + radius,
        price: bars[i].high,
        kind: "high",
      });
    if (surrounding.every((bar) => bars[i].low < bar.low))
      result.push({
        index: i,
        detectedAt: i + radius,
        price: bars[i].low,
        kind: "low",
      });
  }
  return result.sort((a, b) => a.index - b.index);
}

export function analyzeMarket(bars: Bar[]): MarketStructure {
  const pivots = confirmedPivots(bars);
  const highs = pivots.filter((pivot) => pivot.kind === "high").slice(-2);
  const lows = pivots.filter((pivot) => pivot.kind === "low").slice(-2);
  const higher =
    highs.length === 2 &&
    lows.length === 2 &&
    highs[1].price > highs[0].price &&
    lows[1].price > lows[0].price;
  const lower =
    highs.length === 2 &&
    lows.length === 2 &&
    highs[1].price < highs[0].price &&
    lows[1].price < lows[0].price;
  const trend: MarketStructure["trend"] = higher
    ? "up"
    : lower
      ? "down"
      : "range";
  const support = lows.at(-1)?.price ?? null;
  const resistance = highs.at(-1)?.price ?? null;
  const events: MarketEvent[] = [];
  for (let i = 1; i < bars.length; i++) {
    const known = pivots.filter((pivot) => pivot.detectedAt < i);
    const priorHigh = known.filter((pivot) => pivot.kind === "high").at(-1);
    const priorLow = known.filter((pivot) => pivot.kind === "low").at(-1);
    if (
      priorHigh &&
      bars[i - 1].close <= priorHigh.price &&
      bars[i].close > priorHigh.price
    )
      events.push({
        index: i,
        kind: "breakout-up",
        level: priorHigh.price,
        title: "Закрытие выше сопротивления",
        detail:
          "Свеча закрылась выше ранее подтверждённого локального максимума.",
      });
    if (
      priorLow &&
      bars[i - 1].close >= priorLow.price &&
      bars[i].close < priorLow.price
    )
      events.push({
        index: i,
        kind: "breakout-down",
        level: priorLow.price,
        title: "Закрытие ниже поддержки",
        detail:
          "Свеча закрылась ниже ранее подтверждённого локального минимума.",
      });
    if (
      priorHigh &&
      bars[i].high > priorHigh.price &&
      bars[i].close < priorHigh.price
    )
      events.push({
        index: i,
        kind: "reclaim-down",
        level: priorHigh.price,
        title: "Выход выше и возврат",
        detail:
          "Цена превысила максимум внутри свечи, но закрылась ниже уровня. Это наблюдаемый возврат, а не доказательство манипуляции.",
      });
    if (
      priorLow &&
      bars[i].low < priorLow.price &&
      bars[i].close > priorLow.price
    )
      events.push({
        index: i,
        kind: "reclaim-up",
        level: priorLow.price,
        title: "Выход ниже и возврат",
        detail:
          "Цена опустилась ниже минимума внутри свечи, но закрылась выше уровня. Причина движения по OHLC неизвестна.",
      });
  }
  return {
    trend,
    trendLabel:
      trend === "up"
        ? "Восходящая структура"
        : trend === "down"
          ? "Нисходящая структура"
          : "Диапазон / переход",
    confidence: trend === "range" ? "формируется" : "подтверждён",
    pivots,
    support,
    resistance,
    events,
    observations: [
      trend === "up"
        ? "Последние подтверждённые максимум и минимум выше предыдущих."
        : trend === "down"
          ? "Последние подтверждённые максимум и минимум ниже предыдущих."
          : "Последние экстремумы не образуют однонаправленную структуру.",
      support === null
        ? "Поддержка ещё не определена."
        : `Ближайший подтверждённый минимум: ${support.toFixed(2)}.`,
      resistance === null
        ? "Сопротивление ещё не определено."
        : `Ближайший подтверждённый максимум: ${resistance.toFixed(2)}.`,
    ],
  };
}
