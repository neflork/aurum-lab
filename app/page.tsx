'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  BrainCircuit,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Database,
  FlaskConical,
  LocateFixed,
  MousePointer2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  defaults,
  configLimits,
  demoBars,
  parseCSV,
  barsCSV,
  research,
  fingerprint,
  type Bar,
  type Config,
  type Experiment,
  type Result,
} from '@/lib/engine';
import {
  loadHyperliquid,
  type HLInterval,
  type MarketDataset,
} from '@/lib/hyperliquid';
import { analyzeMarket } from '@/lib/market-analysis';
import { makeTradingSignal } from '@/lib/trading-signal';
import {
  chartCursor,
  clamp,
  priceViewport,
  scaleTimeAt,
  visibleRange,
} from '@/lib/chart-math';

const fmt = (n: number, digits = 2) =>
  new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
const pct = (n: number) => `${n > 0 ? '+' : ''}${fmt(n)}%`;
const utc = (value: string, full = false) =>
  new Date(value).toLocaleString('ru-RU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    ...(full ? { year: 'numeric', hour: '2-digit', minute: '2-digit' } : {}),
  });
const download = (name: string, content: string, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const tradesCSV = (result: Result) =>
  `entry_time,exit_time,side,entry,exit,quantity,pnl,reason\n${result.trades.map((trade) => [trade.entryTime, trade.exitTime, trade.side === 1 ? 'BUY' : 'SELL', trade.entry, trade.exit, trade.quantity, trade.pnl, trade.reason].join(',')).join('\n')}`;

function CandleChart({
  bars,
  livePrice,
  fetchedAt,
}: {
  bars: Bar[];
  livePrice: number | null;
  fetchedAt: string | null;
}) {
  const [windowSize, setWindowSize] = useState(112);
  const [endOverride, setEndOverride] = useState<number | null>(null);
  const [priceScale, setPriceScale] = useState(1);
  const [priceOffset, setPriceOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    mode: 'plot' | 'price' | 'time';
    x: number;
    y: number;
    end: number;
    count: number;
    scale: number;
    offset: number;
    span: number;
  } | null>(null);
  const range = visibleRange(bars.length, windowSize, endOverride);
  const { start: offset, end, count: visibleCount } = range;
  const visible = bars.slice(offset, end);
  const atLatest = end === bars.length;
  const viewStructure = useMemo(
    () => analyzeMarket(bars.slice(0, end)),
    [bars, end],
  );
  const width = 980,
    height = 440,
    left = 18,
    right = 78,
    top = 22,
    bottom = 38;
  const chartWidth = width - left - right,
    chartHeight = height - top - bottom;
  const scalePrices = visible.flatMap((bar) => [bar.low, bar.high]);
  if (atLatest && livePrice !== null) scalePrices.push(livePrice);
  const rawLow = Math.min(...scalePrices),
    rawHigh = Math.max(...scalePrices);
  const { low, high } = priceViewport(rawLow, rawHigh, priceScale, priceOffset);
  const x = (index: number) =>
    left + ((index - offset + 0.5) / visibleCount) * chartWidth;
  const y = (price: number) =>
    top + ((high - price) / (high - low)) * chartHeight;
  const candleWidth = Math.max(
    2,
    Math.min(11, (chartWidth / visibleCount) * 0.68),
  );
  const pivots = viewStructure.pivots
    .filter((pivot) => pivot.index >= offset && pivot.index < end)
    .slice(-12);
  const events = viewStructure.events
    .filter((event) => event.index >= offset && event.index < end)
    .slice(-12);
  const trendPivots =
    viewStructure.trend === 'up'
      ? pivots.filter((pivot) => pivot.kind === 'low').slice(-3)
      : viewStructure.trend === 'down'
        ? pivots.filter((pivot) => pivot.kind === 'high').slice(-3)
        : [];
  const trendPath = trendPivots
    .map((pivot) => `${x(pivot.index)},${y(pivot.price)}`)
    .join(' ');
  const zoom = (delta: number, fraction = 0.5) => {
    const next = scaleTimeAt(
      bars.length,
      offset,
      visibleCount,
      visibleCount + delta,
      fraction,
    );
    setWindowSize(next.count);
    setEndOverride(next.end === bars.length ? null : next.end);
    setCursor(null);
  };
  const pointInChart = (clientX: number, clientY: number) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: point.x, y: point.y };
  };
  const pointerCursor = (clientX: number, clientY: number) => {
    const point = pointInChart(clientX, clientY);
    if (!point) return;
    const mapped = chartCursor(
      point.x,
      point.y,
      { left, right, top, bottom, width, height },
      offset,
      visibleCount,
      low,
      high,
    );
    setCursor({ x: mapped.x, y: mapped.y });
  };
  useEffect(() => {
    const stage = stageRef.current;
    const svg = svgRef.current;
    if (!stage || !svg) return;
    // React's wheel listener may be passive; the native non-passive listener
    // keeps trackpad zoom from scrolling the page at the same time.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = svg.getScreenCTM();
      const point = matrix
        ? new DOMPoint(event.clientX, event.clientY).matrixTransform(
            matrix.inverse(),
          )
        : null;
      if (!point) return;
      const horizontal =
        event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (horizontal) {
        const delta = event.deltaX || event.deltaY;
        const shift =
          Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / 40));
        const next = clamp(end + shift, visibleCount, bars.length);
        setEndOverride(next === bars.length ? null : next);
      } else {
        const fraction = clamp((point.x - left) / chartWidth, 0, 1);
        const next = scaleTimeAt(
          bars.length,
          offset,
          visibleCount,
          visibleCount +
            Math.sign(event.deltaY) *
              Math.max(2, Math.round(Math.abs(event.deltaY) / 8)),
          fraction,
        );
        setWindowSize(next.count);
        setEndOverride(next.end === bars.length ? null : next.end);
      }
      setCursor(null);
    };
    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [bars.length, chartWidth, end, offset, visibleCount]);
  const selected = cursor
    ? chartCursor(
        cursor.x,
        cursor.y,
        { left, right, top, bottom, width, height },
        offset,
        visibleCount,
        low,
        high,
      )
    : null;
  const selectedBar = selected ? bars[selected.index] : null;
  const latestClosed = visible.at(-1)!;
  const plotRight = width - right;
  const liveY = atLatest && livePrice !== null ? y(livePrice) : null;
  const closedY = y(latestClosed.close);
  const closedTagY = clamp(
    liveY !== null && Math.abs(liveY - closedY) < 24
      ? liveY < top + chartHeight / 2
        ? liveY + 24
        : liveY - 24
      : closedY,
    top + 11,
    height - bottom - 11,
  );
  const crossX = selected ? x(selected.index) : null;
  return (
    <div className="chart-explorer">
      <div className="chart-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          className={`candle-chart ${dragging ? 'is-dragging' : ''}`}
          viewBox={`0 0 ${width} ${height}`}
          aria-label="Интерактивный свечной график xyz:GOLD. Перетаскивайте поле для перемещения, правую шкалу для масштаба цены, нижнюю шкалу для масштаба времени."
          onPointerDown={(event) => {
            const point = pointInChart(event.clientX, event.clientY);
            if (!point) return;
            const mode =
              point.x >= width - right
                ? 'price'
                : point.y >= height - bottom
                  ? 'time'
                  : 'plot';
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              mode,
              x: event.clientX,
              y: event.clientY,
              end,
              count: visibleCount,
              scale: priceScale,
              offset: priceOffset,
              span: high - low,
            };
            setDragging(true);
            setCursor(null);
          }}
          onPointerMove={(event) => {
            if (drag.current) {
              const started = drag.current;
              const matrix = event.currentTarget.getScreenCTM();
              const svgScale = matrix
                ? Math.hypot(matrix.a, matrix.b)
                : event.currentTarget.getBoundingClientRect().width / width;
              if (started.mode === 'plot') {
                const shift = Math.round(
                  (started.x - event.clientX) /
                    ((chartWidth * svgScale) / started.count),
                );
                const next = clamp(
                  started.end + shift,
                  started.count,
                  bars.length,
                );
                setEndOverride(next === bars.length ? null : next);
                setPriceOffset(
                  started.offset +
                    ((event.clientY - started.y) / (chartHeight * svgScale)) *
                      started.span,
                );
              } else if (started.mode === 'price') {
                const delta = (event.clientY - started.y) / svgScale;
                setPriceScale(
                  clamp(started.scale * Math.exp(delta / 170), 0.2, 8),
                );
              } else {
                const delta = (event.clientX - started.x) / svgScale;
                const nextCount = clamp(
                  Math.round(started.count * Math.exp(-delta / 260)),
                  40,
                  Math.min(320, bars.length),
                );
                setWindowSize(nextCount);
                const nextEnd = clamp(started.end, nextCount, bars.length);
                setEndOverride(nextEnd === bars.length ? null : nextEnd);
              }
              setCursor(null);
            } else pointerCursor(event.clientX, event.clientY);
          }}
          onPointerUp={(event) => {
            drag.current = null;
            setDragging(false);
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX >= bounds.left &&
              event.clientX <= bounds.right &&
              event.clientY >= bounds.top &&
              event.clientY <= bounds.bottom
            )
              pointerCursor(event.clientX, event.clientY);
            else setCursor(null);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
            setCursor(null);
          }}
          onPointerLeave={() => {
            if (!drag.current) setCursor(null);
          }}
          onDoubleClick={(event) => {
            const point = pointInChart(event.clientX, event.clientY);
            if (point && point.x >= width - right) {
              setPriceScale(1);
              setPriceOffset(0);
            } else if (point && point.y >= height - bottom) {
              setWindowSize(112);
              setEndOverride(null);
            }
          }}
        >
          <title>
            Перемещение по графику — горизонтально и вертикально. Правая шкала
            меняет масштаб цены, нижняя — масштаб времени. Экстремумы
            подтверждаются тремя следующими свечами.
          </title>
          {[0, 0.25, 0.5, 0.75, 1].map((position) => {
            const price = high - position * (high - low);
            return (
              <g key={position}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={top + position * chartHeight}
                  y2={top + position * chartHeight}
                  stroke="#273342"
                  strokeDasharray="3 6"
                />
                <text
                  x={width - right + 10}
                  y={top + position * chartHeight + 4}
                  textAnchor="start"
                  fill="#8392a6"
                  fontSize="11"
                >
                  {fmt(price)}
                </text>
              </g>
            );
          })}
          <line
            x1={width - right}
            x2={width - right}
            y1={top}
            y2={height - bottom}
            stroke="#30384a"
          />
          {viewStructure.support !== null &&
            viewStructure.support >= low &&
            viewStructure.support <= high && (
              <g>
                <line
                  x1={left + chartWidth * 0.72}
                  x2={width - right}
                  y1={y(viewStructure.support)}
                  y2={y(viewStructure.support)}
                  stroke="#62b99f"
                  strokeDasharray="6 5"
                  strokeOpacity="0.62"
                />
                <text
                  x={width - right - 4}
                  y={y(viewStructure.support) - 6}
                  textAnchor="end"
                  fill="#76c9ae"
                  fontSize="10"
                >
                  Поддержка · {fmt(viewStructure.support)}
                </text>
              </g>
            )}
          {viewStructure.resistance !== null &&
            viewStructure.resistance >= low &&
            viewStructure.resistance <= high && (
              <g>
                <line
                  x1={left + chartWidth * 0.72}
                  x2={width - right}
                  y1={y(viewStructure.resistance)}
                  y2={y(viewStructure.resistance)}
                  stroke="#ff647c"
                  strokeDasharray="6 5"
                  strokeOpacity="0.62"
                />
                <text
                  x={width - right - 4}
                  y={y(viewStructure.resistance) - 6}
                  textAnchor="end"
                  fill="#ff8395"
                  fontSize="10"
                >
                  Сопротивление · {fmt(viewStructure.resistance)}
                </text>
              </g>
            )}
          {visible.map((bar, localIndex) => {
            const index = offset + localIndex,
              color = bar.close >= bar.open ? '#6fc7ae' : '#e88989';
            return (
              <g key={bar.time}>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={y(bar.high)}
                  y2={y(bar.low)}
                  stroke={color}
                />
                <rect
                  x={x(index) - candleWidth / 2}
                  y={y(Math.max(bar.open, bar.close))}
                  width={candleWidth}
                  height={Math.max(
                    1,
                    y(Math.min(bar.open, bar.close)) -
                      y(Math.max(bar.open, bar.close)),
                  )}
                  fill={color}
                  rx="1"
                />
              </g>
            );
          })}
          <g className="closed-price-line">
            <line
              x1={left}
              x2={plotRight}
              y1={closedY}
              y2={closedY}
              stroke="#9aa5bb"
              strokeDasharray="3 5"
              strokeOpacity="0.55"
            />
            <rect
              x={plotRight}
              y={closedTagY - 10}
              width={right}
              height="20"
              fill="#343b4c"
            />
            <text
              x={plotRight + right / 2}
              y={closedTagY + 3.5}
              textAnchor="middle"
              fill="#dce2ed"
              fontSize="10"
            >
              C {fmt(latestClosed.close)}
            </text>
          </g>
          {liveY !== null && livePrice !== null && (
            <g className="live-price-line">
              <line
                x1={left}
                x2={plotRight}
                y1={liveY}
                y2={liveY}
                stroke="#d7ff68"
                strokeDasharray="2 3"
                strokeOpacity="0.82"
              />
              <circle cx={plotRight} cy={liveY} r="3.5" fill="#d7ff68" />
              <rect
                x={plotRight}
                y={liveY - 10}
                width={right}
                height="20"
                fill="#d7ff68"
              />
              <text
                x={plotRight + right / 2}
                y={liveY + 3.5}
                textAnchor="middle"
                fill="#0b0e12"
                fontWeight="750"
                fontSize="10"
              >
                MID {fmt(livePrice)}
              </text>
            </g>
          )}
          {trendPath && (
            <polyline
              points={trendPath}
              fill="none"
              stroke={viewStructure.trend === 'up' ? '#38d7a7' : '#ff647c'}
              strokeWidth="2.5"
              strokeDasharray="8 5"
            />
          )}
          {pivots.map((pivot) => (
            <g key={`${pivot.kind}-${pivot.index}`}>
              <circle
                cx={x(pivot.index)}
                cy={y(pivot.price)}
                r="3.5"
                fill={pivot.kind === 'high' ? '#ddbb70' : '#76c9ae'}
              />
              <text
                x={x(pivot.index)}
                y={y(pivot.price) + (pivot.kind === 'high' ? -8 : 15)}
                textAnchor="middle"
                fill={pivot.kind === 'high' ? '#ddbb70' : '#76c9ae'}
                fontSize="10"
              >
                {pivot.kind === 'high' ? 'H' : 'L'}
              </text>
            </g>
          ))}
          {events.map((event) => (
            <g key={`${event.kind}-${event.index}`}>
              <circle
                cx={x(event.index)}
                cy={y(bars[event.index].close)}
                r="7"
                fill={event.kind.includes('reclaim') ? '#a78bda' : '#5eaed6'}
              />
              <text
                x={x(event.index)}
                y={y(bars[event.index].close) + 3.5}
                textAnchor="middle"
                fill="#0d1117"
                fontWeight="700"
                fontSize="9"
              >
                {event.kind.includes('reclaim') ? 'R' : 'B'}
              </text>
            </g>
          ))}
          {selected && selectedBar && crossX !== null && (
            <g className="crosshair">
              <line
                x1={crossX}
                x2={crossX}
                y1={top}
                y2={height - bottom}
                stroke="#c7cfdd"
                strokeDasharray="4 4"
              />
              <line
                x1={left}
                x2={plotRight}
                y1={selected.y}
                y2={selected.y}
                stroke="#c7cfdd"
                strokeDasharray="4 4"
              />
              <rect
                x={plotRight}
                y={selected.y - 11}
                width={right}
                height="22"
                fill="#e5e9f1"
              />
              <text
                x={plotRight + right / 2}
                y={selected.y + 4}
                textAnchor="middle"
                fill="#0b0e12"
                fontWeight="750"
                fontSize="10"
              >
                {fmt(selected.price)}
              </text>
              <rect
                x={clamp(crossX - 58, left, plotRight - 116)}
                y={height - bottom}
                width="116"
                height={bottom - 3}
                fill="#e5e9f1"
              />
              <text
                x={clamp(crossX, left + 58, plotRight - 58)}
                y={height - 13}
                textAnchor="middle"
                fill="#0b0e12"
                fontWeight="650"
                fontSize="10"
              >
                {utc(selectedBar.time, true)}
              </text>
            </g>
          )}
          {[0, 0.5, 1].map((position) => (
            <text
              key={position}
              x={left + position * chartWidth}
              y={height - 5}
              textAnchor={
                position === 0 ? 'start' : position === 1 ? 'end' : 'middle'
              }
              fill="#8392a6"
              fontSize="11"
            >
              {utc(visible[Math.round(position * (visible.length - 1))].time)}
            </text>
          ))}
          <rect
            className="chart-time-axis-hitbox"
            x={left}
            y={height - bottom}
            width={chartWidth}
            height={bottom}
            fill="transparent"
          />
          <rect
            className="chart-price-axis-hitbox"
            x={plotRight}
            y={0}
            width={right}
            height={height}
            fill="transparent"
          />
        </svg>
        {selectedBar && (
          <div className="crosshair-ohlc">
            <strong>{utc(selectedBar.time, true)} UTC</strong>
            <span>O {fmt(selectedBar.open)}</span>
            <span>H {fmt(selectedBar.high)}</span>
            <span>L {fmt(selectedBar.low)}</span>
            <span>C {fmt(selectedBar.close)}</span>
          </div>
        )}
        <div className="chart-tools" aria-label="Масштаб графика">
          <button aria-label="Приблизить график" onClick={() => zoom(-16)}>
            +
          </button>
          <button aria-label="Отдалить график" onClick={() => zoom(16)}>
            −
          </button>
        </div>
        {atLatest && livePrice !== null && fetchedAt && (
          <div className="live-price-caption">
            MID — текущая mid-цена Hyperliquid · обновлено{' '}
            {utc(fetchedAt, true)}
            UTC
          </div>
        )}
        {endOverride !== null && (
          <button className="return-live" onClick={() => setEndOverride(null)}>
            <LocateFixed /> К текущей цене
          </button>
        )}
      </div>
      <div className="history-control">
        <span>{utc(visible[0].time, true)}</span>
        <input
          aria-label="Положение в истории"
          type="range"
          min={visibleCount}
          max={bars.length}
          value={end}
          onChange={(event) => {
            const next = Number(event.target.value);
            setEndOverride(next === bars.length ? null : next);
          }}
        />
        <span>{utc(visible.at(-1)!.time, true)}</span>
      </div>
      <div className="chart-navigation-hint">
        <MousePointer2 /> Тяните поле — перемещение · правую шкалу — масштаб
        цены · нижнюю шкалу или колесо — масштаб времени · двойной клик по шкале
        — сброс · {bars.length} свечей
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong
        className={
          tone === 'good' ? 'positive' : tone === 'bad' ? 'negative' : ''
        }
      >
        {value}
      </strong>
      <small>{note}</small>
    </div>
  );
}

function SignalVote({ label, value }: { label: string; value: number }) {
  return (
    <span className={value === 1 ? 'vote-up' : value === -1 ? 'vote-down' : ''}>
      {label} <b>{value === 1 ? '↑' : value === -1 ? '↓' : '—'}</b>
    </span>
  );
}

export default function Home() {
  const [bars, setBars] = useState<Bar[]>(() => demoBars());
  const [market, setMarket] = useState<MarketDataset | null>(null);
  const [source, setSource] = useState('Синтетический резервный набор');
  const [interval, setIntervalValue] = useState<HLInterval>('1h');
  const [config, setConfig] = useState<Config>({ ...defaults });
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [loading, setLoading] = useState(true),
    [calculating, setCalculating] = useState(false),
    [error, setError] = useState('');
  const [updatedReason, setUpdatedReason] = useState(
    'Первичное получение данных',
  );
  const uploadRef = useRef<HTMLInputElement>(null),
    requestRef = useRef<AbortController | null>(null);
  const dataBusy = useRef(false),
    calculationId = useRef(0),
    lastAnalyzed = useRef(''),
    activeStrategy = useRef<string | null>(null);
  const structure = useMemo(() => analyzeMarket(bars), [bars]);

  const runResearch = useCallback(
    (nextBars: Bar[], reason: string, preserveSelection = false) => {
      const id = ++calculationId.current;
      setCalculating(true);
      window.setTimeout(() => {
        try {
          const result = research(
            nextBars,
            config,
            preserveSelection ? activeStrategy.current : null,
          );
          if (id === calculationId.current) {
            setExperiment(result);
            activeStrategy.current = result.selected?.id ?? null;
            lastAnalyzed.current = result.fingerprint;
            setUpdatedReason(reason);
          }
        } catch (caught) {
          if (id === calculationId.current)
            setError(
              caught instanceof Error ? caught.message : 'Ошибка исследования.',
            );
        } finally {
          if (id === calculationId.current) setCalculating(false);
        }
      }, 20);
    },
    [config],
  );

  const refresh = useCallback(
    async (requestedInterval: HLInterval, automatic = false) => {
      if (dataBusy.current) return;
      dataBusy.current = true;
      setLoading(true);
      if (!automatic) setError('');
      const controller = new AbortController();
      requestRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 25000);
      try {
        const dataset = await loadHyperliquid(
          requestedInterval,
          controller.signal,
        );
        const nextFingerprint = fingerprint(dataset.bars);
        setBars(dataset.bars);
        setMarket(dataset);
        setSource(`${dataset.venue} · ${dataset.coin}`);
        setIntervalValue(requestedInterval);
        if (nextFingerprint !== lastAnalyzed.current)
          runResearch(
            dataset.bars,
            automatic ? 'Новая закрытая свеча' : 'Данные Hyperliquid обновлены',
            automatic,
          );
      } catch (caught) {
        const message = controller.signal.aborted
          ? 'Hyperliquid не ответил за 25 секунд.'
          : caught instanceof Error
            ? caught.message
            : 'Не удалось получить свечи.';
        if (!automatic || !market) setError(message);
        if (!market && !experiment)
          runResearch(bars, 'Резервный демонстрационный набор');
      } finally {
        window.clearTimeout(timeout);
        dataBusy.current = false;
        setLoading(false);
        requestRef.current = null;
      }
    },
    [bars, experiment, market, runResearch],
  );

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const cancelPending = useCallback(() => {
    requestRef.current?.abort();
    calculationId.current++;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshRef.current('1h'), 0);
    return () => {
      window.clearTimeout(timer);
      cancelPending();
    };
  }, [cancelPending]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible')
        void refreshRef.current(interval, true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [interval]);

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('Файл больше 5 МБ.');
      const nextBars = parseCSV(await file.text());
      setBars(nextBars);
      setMarket(null);
      setSource(file.name);
      runResearch(nextBars, 'Импортирован CSV');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Не удалось прочитать CSV.',
      );
    } finally {
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };
  const updateConfig = (key: keyof Config, value: string) =>
    setConfig((current) => ({
      ...current,
      [key]: value === '' ? NaN : Number(value),
    }));
  const field = (key: keyof Config, label: string, step = 1) => (
    <label className="field">
      <span>{label}</span>
      <Input
        type="number"
        min={configLimits[key][0]}
        max={configLimits[key][1]}
        step={step}
        value={Number.isFinite(config[key]) ? config[key] : ''}
        onChange={(event) => updateConfig(key, event.target.value)}
      />
    </label>
  );
  const last = bars.at(-1)!,
    test = experiment?.test,
    selected = experiment?.selected;
  const latestEvent = structure.events.at(-1);
  const tradingSignal = useMemo(
    () => makeTradingSignal(bars, experiment, structure),
    [bars, experiment, structure],
  );
  const exportReport = () =>
    experiment &&
    download(
      `aurum-${experiment.fingerprint}.json`,
      JSON.stringify(
        {
          source,
          market: market ? { ...market, bars: undefined } : null,
          bars,
          structure,
          experiment,
        },
        null,
        2,
      ),
      'application/json',
    );

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          ◈{' '}
          <span>
            AURUM<span className="brand-light">LAB</span>
          </span>
        </div>
        <span className="top-caption">
          Интеллектуальная система поиска стратегий
        </span>
        <span className="live-pill">
          <i className={market ? 'online' : ''} />
          {loading
            ? 'получение данных'
            : market
              ? 'Hyperliquid подключён'
              : 'резервный набор'}
        </span>
      </header>
      <div className="workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">AGENT WORKSPACE / XYZ:GOLD</div>
            <h1>Gold futures intelligence</h1>
            <p>
              Направление, подтверждение и сценарий для perpetual-фьючерса
              xyz:GOLD по закрытым свечам.
            </p>
          </div>
          <div className="heading-actions">
            <Select
              value={interval}
              disabled={loading}
              onValueChange={(value) =>
                value && void refresh(value as HLInterval)
              }
            >
              <SelectTrigger aria-label="Таймфрейм">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15m">15 минут</SelectItem>
                <SelectItem value="1h">1 час</SelectItem>
                <SelectItem value="4h">4 часа</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void refresh(interval)}
            >
              <RefreshCw className={loading ? 'spinning' : ''} />
              Обновить
            </Button>
          </div>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            <span>{error}</span>
            <button aria-label="Закрыть" onClick={() => setError('')}>
              <X />
            </button>
          </div>
        )}
        <section className="market-command">
          <div className="panel chart-panel">
            <div className="chart-head">
              <div>
                <span className="eyebrow">LIVE MARKET · HYPERLIQUID</span>
                <div className="quote-row">
                  <h2>xyz:GOLD</h2>
                  <strong>{fmt(market?.midPrice ?? last.close)}</strong>
                  <span>
                    {market ? 'текущий mid' : 'последнее закрытие'} · USDC/oz
                  </span>
                  {market && (
                    <small className="closed-quote">
                      Закрытие {fmt(last.close)} · {utc(last.time, true)} UTC
                    </small>
                  )}
                </div>
              </div>
              <div className="market-meta">
                <span>PERPETUAL</span>
                <strong>{interval.toUpperCase()}</strong>
              </div>
            </div>
            <CandleChart
              bars={bars}
              livePrice={market?.midPrice ?? null}
              fetchedAt={market?.fetchedAt ?? null}
            />
            <div className="chart-key">
              <span>
                <i className="key-high" />
                H/L — подтверждённые экстремумы
              </span>
              <span>
                <i className="key-break" />B — пробой закрытием
              </span>
              <span>
                <i className="key-reclaim" />R — выход и возврат
              </span>
              <span>Пивот появляется через 3 свечи</span>
            </div>
          </div>
          <aside className="analysis-rail">
            <section className="panel agent-card">
              <div className="agent-status">
                <BrainCircuit />
                <div>
                  <span>АГЕНТ-ИССЛЕДОВАТЕЛЬ</span>
                  <strong>
                    {calculating
                      ? 'Обучает модель и сравнивает варианты'
                      : 'Анализ актуален'}
                  </strong>
                </div>
                <i className={calculating ? 'pulse' : ''} />
              </div>
              <div className={`signal ${tradingSignal.side}`}>
                <div className="signal-kicker">
                  <span>Фьючерсный сценарий</span>
                  <small>до закрытия следующей {interval} свечи</small>
                </div>
                <strong>{tradingSignal.label}</strong>
                <div className="direction-line">
                  Ожидаемое направление: <b>{tradingSignal.direction}</b>
                </div>
                <div className="agreement">
                  <span>Согласованность фильтров</span>
                  <b>{tradingSignal.agreement}%</b>
                  <i>
                    <em style={{ width: `${tradingSignal.agreement}%` }} />
                  </i>
                </div>
              </div>
              <div className="decision-copy">
                <span>Что делать</span>
                <p>{tradingSignal.action}</p>
                <span>Почему</span>
                <p>{tradingSignal.reason}</p>
              </div>
              <div className="vote-row">
                <SignalVote
                  label="Стратегия"
                  value={tradingSignal.strategyVote}
                />
                <SignalVote label="ML" value={tradingSignal.modelVote} />
                <SignalVote
                  label="Структура"
                  value={tradingSignal.structureVote}
                />
              </div>
              {tradingSignal.stop !== null && tradingSignal.take !== null && (
                <div className="risk-levels">
                  <span>
                    Стоп <b>{fmt(tradingSignal.stop)}</b>
                  </span>
                  <span>
                    Цель <b>{fmt(tradingSignal.take)}</b>
                  </span>
                </div>
              )}
              <p className="signal-validity">{tradingSignal.invalidation}</p>
              {calculating && experiment && (
                <p className="recalculation-note">
                  Идёт проверка новой свечи. До завершения показано предыдущее
                  подтверждённое решение.
                </p>
              )}
            </section>
            <section className="panel structure-card">
              <div className="panel-title">
                <h2>Структура цены</h2>
                <span className={`trend-chip ${structure.trend}`}>
                  {structure.trendLabel}
                </span>
              </div>
              {structure.observations.map((item) => (
                <p key={item} className="observation">
                  <CheckCircle2 />
                  {item}
                </p>
              ))}
              {latestEvent && (
                <div className="event-note">
                  <strong>{latestEvent.title}</strong>
                  <p>{latestEvent.detail}</p>
                </div>
              )}
            </section>
            <section className="panel freshness">
              <Clock3 />
              <div>
                <strong>Последняя закрытая свеча</strong>
                <span>{utc(last.time, true)} UTC</span>
                <small>Автопроверка каждую минуту · {updatedReason}</small>
              </div>
            </section>
          </aside>
        </section>
        <div className="metric-grid">
          <Metric
            label="Выбранная стратегия"
            value={selected?.name ?? '—'}
            note="Выбор только на валидации"
          />
          <Metric
            label="Финальный тест"
            value={test ? pct(test.returnPct) : '—'}
            note={test ? `${test.trades.length} сделок` : 'Кандидат не допущен'}
            tone={test ? (test.returnPct >= 0 ? 'good' : 'bad') : undefined}
          />
          <Metric
            label="Макс. просадка"
            value={test ? `${fmt(test.drawdownPct)}%` : '—'}
            note={`Лимит ${fmt(config.maxDrawdown, 0)}%`}
          />
          <Metric
            label="ML-модель"
            value={experiment ? `${experiment.model.samples} примеров` : '—'}
            note="Логистическая регрессия · 6 признаков"
          />
        </div>
        <Tabs defaultValue="research" className="research-tabs">
          <TabsList variant="line">
            <TabsTrigger value="research">
              <FlaskConical />
              Поиск стратегий
            </TabsTrigger>
            <TabsTrigger value="events">
              <Activity />
              Наблюдения
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 />
              Дополнительные настройки
            </TabsTrigger>
            <TabsTrigger value="method">
              <CircleHelp />
              Методика
            </TabsTrigger>
          </TabsList>
          <TabsContent value="research">
            <section className="panel tab-panel">
              <div className="panel-title">
                <div>
                  <h2>Результаты автоматического поиска</h2>
                  <p className="section-description">
                    12 вариантов ранжируются на валидации; финальный период не
                    участвует в выборе.
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={!experiment}
                  onClick={exportReport}
                >
                  <ArrowDownToLine />
                  Отчёт JSON
                </Button>
              </div>
              {experiment ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Стратегия</TableHead>
                      <TableHead>Доходность</TableHead>
                      <TableHead>Просадка</TableHead>
                      <TableHead>Сделки</TableHead>
                      <TableHead>Допуск</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {experiment.candidates.map((candidate) => (
                      <TableRow
                        key={candidate.strategy.id}
                        className={
                          candidate.strategy.id === selected?.id
                            ? 'chosen-row'
                            : ''
                        }
                      >
                        <TableCell>
                          <strong>{candidate.strategy.name}</strong>
                          <small className="table-sub">
                            {candidate.strategy.family === 'ml'
                              ? 'машинное обучение'
                              : 'формализованное правило'}
                          </small>
                        </TableCell>
                        <TableCell
                          className={
                            candidate.validation.returnPct >= 0
                              ? 'positive'
                              : 'negative'
                          }
                        >
                          {pct(candidate.validation.returnPct)}
                        </TableCell>
                        <TableCell>
                          {fmt(candidate.validation.drawdownPct)}%
                        </TableCell>
                        <TableCell>
                          {candidate.validation.trades.length}
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              candidate.eligible
                                ? 'status-good'
                                : 'status-neutral'
                            }
                          >
                            {candidate.eligible ? 'пройден' : 'не пройден'}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="empty-state">
                  <BrainCircuit />
                  <h3>Автоматическое исследование выполняется</h3>
                  <p>
                    Модель обучается на первых 60% истории, стратегии
                    сравниваются на следующих 20%.
                  </p>
                </div>
              )}
            </section>
          </TabsContent>
          <TabsContent value="events">
            <section className="panel tab-panel">
              <div className="panel-title">
                <div>
                  <h2>Объективные события на графике</h2>
                  <p className="section-description">
                    Наблюдения по OHLC. Мотивы участников из свечей установить
                    невозможно.
                  </p>
                </div>
                <span className="badge">
                  {structure.events.length} последних событий
                </span>
              </div>
              <div className="event-list">
                {structure.events.length ? (
                  structure.events
                    .slice()
                    .reverse()
                    .slice(0, 12)
                    .map((event) => (
                      <article key={`${event.kind}-${event.index}`}>
                        <span
                          className={
                            event.kind.includes('reclaim')
                              ? 'reclaim-dot'
                              : 'break-dot'
                          }
                        >
                          {event.kind.includes('reclaim') ? 'R' : 'B'}
                        </span>
                        <div>
                          <strong>{event.title}</strong>
                          <p>{event.detail}</p>
                          <small>
                            {utc(bars[event.index].time, true)} UTC · уровень{' '}
                            {fmt(event.level)}
                          </small>
                        </div>
                      </article>
                    ))
                ) : (
                  <div className="empty-state">
                    <ShieldCheck />
                    <h3>Подтверждённых событий пока нет</h3>
                    <p>Агент продолжит проверку после следующего закрытия.</p>
                  </div>
                )}
              </div>
            </section>
          </TabsContent>
          <TabsContent value="settings">
            <section className="panel tab-panel settings-panel">
              <div>
                <h2>Данные и ручные инструменты</h2>
                <p className="section-description">
                  Основной режим работает автоматически. Эти функции нужны для
                  экспериментов.
                </p>
                <div className="manual-actions">
                  <Button
                    variant="outline"
                    onClick={() => uploadRef.current?.click()}
                  >
                    <Upload />
                    Загрузить CSV
                  </Button>
                  <input
                    ref={uploadRef}
                    className="sr-only"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) =>
                      void importFile(event.target.files?.[0])
                    }
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      download('xyz-GOLD.csv', barsCSV(bars), 'text/csv')
                    }
                  >
                    <ArrowDownToLine />
                    Свечи CSV
                  </Button>
                  {test && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        download('trades.csv', tradesCSV(test), 'text/csv')
                      }
                    >
                      <ArrowDownToLine />
                      Сделки CSV
                    </Button>
                  )}
                </div>
                <p className="source-line">
                  <Database />
                  {source} · {bars.length} закрытых свечей
                </p>
              </div>
              <details className="advanced">
                <summary>Модель исполнения и риск</summary>
                <div className="fields-grid">
                  {field('capital', 'Капитал, USD', 100)}
                  {field('allocation', 'Доля капитала, %', 5)}
                  {field('stop', 'Стоп-лосс, %', 0.1)}
                  {field('take', 'Тейк-профит, %', 0.1)}
                  {field('maxDrawdown', 'Лимит просадки, %', 1)}
                  {field('spread', 'Спред, USD/унц.', 0.1)}
                  {field('slippage', 'Проскальзывание, USD/унц.', 0.05)}
                  {field('commission', 'Комиссия за сторону', 0.01)}
                </div>
                <Button
                  onClick={() =>
                    runResearch(bars, 'Параметры изменены пользователем')
                  }
                >
                  Пересчитать с параметрами
                </Button>
              </details>
            </section>
          </TabsContent>
          <TabsContent value="method">
            <section className="panel tab-panel method-grid">
              <article>
                <h3>Интеллектуальная часть</h3>
                <p>
                  Логистическая регрессия обучается на шести признаках цены.
                  Система сравнивает три её порога и девять технических правил,
                  фиксирует победителя до финального теста и блокирует сигнал
                  при нарушении риска.
                </p>
              </article>
              <article>
                <h3>Структура рынка</h3>
                <p>
                  Восходящая структура требует более высокого подтверждённого
                  максимума и минимума; нисходящая — более низких. Пивот
                  подтверждается только после трёх последующих свечей.
                </p>
              </article>
              <article>
                <h3>Пробой и возврат</h3>
                <p>
                  Пробой требует закрытия за ранее известным экстремумом. Выход
                  тенью и возврат отмечается отдельно. Это описание цены, не
                  доказательство «манипуляции».
                </p>
              </article>
              <article>
                <h3>Ограничения</h3>
                <p>
                  Свечи относятся к perpetual-контракту xyz:GOLD. Funding,
                  стакан, точная последовательность внутри свечи и причины
                  движения не известны. Сигнал исторический и учебный.
                </p>
              </article>
            </section>
          </TabsContent>
        </Tabs>
        <footer className="footer">
          <span>AURUM LAB · учебная интеллектуальная система</span>
          <span>Данные → признаки → поиск → тест → объяснение</span>
        </footer>
      </div>
    </main>
  );
}
