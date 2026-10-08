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
  ListChecks,
  LogOut,
  MousePointer2,
  RefreshCw,
  ScanSearch,
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
import { findEntryPatterns, type EntryPattern } from '@/lib/entry-patterns';
import {
  analyzeMarketRead,
  normalizeAIConfidence,
  type MarketRead,
} from '@/lib/market-read';
import {
  loadResearchSnapshot,
  saveResearchSnapshot,
  researchMatches,
} from '@/lib/research-cache';
import {
  chartCursor,
  clamp,
  priceViewport,
  scaleTimeAt,
  visibleRange,
} from '@/lib/chart-math';

import {
  agentEndpoint,
  readAgentConnection,
  startAgentLogin,
  logoutAgent,
  type AgentConnection,
} from '@/lib/agent-client';

type CalculationLog = {
  id: number;
  time: string;
  level: 'info' | 'success' | 'warning' | 'error';
  scope: string;
  message: string;
};
const agentLabels = {
  checking: 'Проверка подключения',
  connected: 'Codex подключён',
  unauthorized: 'Требуется авторизация',
  offline: 'Мост недоступен',
};

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
  const [priceAxisMode, setPriceAxisMode] = useState<'pan' | 'scale'>('pan');
  const [dragging, setDragging] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [chartSize, setChartSize] = useState({ width: 980, height: 440 });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Match chart coordinates to rendered pixels so axis labels stay legible
    // on narrow screens instead of shrinking the desktop SVG as an image.
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setChartSize({ width, height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const drag = useRef<{
    mode: 'plot' | 'price-pan' | 'price-scale' | 'time';
    x: number;
    y: number;
    end: number;
    count: number;
    scale: number;
    offset: number;
    span: number;
  } | null>(null);
  // Keep enough real candles in view while allowing the viewport to move into
  // the empty future area to the right of the latest closed candle.
  const futurePadding = Math.max(1, Math.round(windowSize * 0.75));
  const maxPanEnd = bars.length + futurePadding;
  const range = visibleRange(
    bars.length,
    windowSize,
    endOverride,
    futurePadding,
  );
  const { start: offset, end, count: visibleCount } = range;
  const visible = bars.slice(offset, end);
  const atLatest = end === bars.length;
  const viewStructure = useMemo(
    () => analyzeMarket(bars.slice(0, end)),
    [bars, end],
  );
  const { width, height } = chartSize;
  const left = 18,
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
  const resetView = () => {
    setWindowSize(112);
    setEndOverride(null);
    setPriceScale(1);
    setPriceOffset(0);
    setPriceAxisMode('pan');
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
        const next = clamp(end + shift, visibleCount, maxPanEnd);
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
  }, [bars.length, chartWidth, end, maxPanEnd, offset, visibleCount]);
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
          aria-label="Интерактивный свечной график xyz:GOLD. Перетаскивайте поле для перемещения, правую шкалу для сдвига или масштаба цены, нижнюю шкалу для масштаба времени."
          onPointerDown={(event) => {
            const point = pointInChart(event.clientX, event.clientY);
            if (!point) return;
            const mode =
              point.x >= width - right
                ? priceAxisMode === 'pan'
                  ? 'price-pan'
                  : 'price-scale'
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
                  bars.length + Math.max(1, Math.round(started.count * 0.75)),
                );
                setEndOverride(next === bars.length ? null : next);
                setPriceOffset(
                  started.offset +
                    ((event.clientY - started.y) / (chartHeight * svgScale)) *
                      started.span,
                );
              } else if (started.mode === 'price-pan') {
                setPriceOffset(
                  started.offset +
                    ((event.clientY - started.y) / (chartHeight * svgScale)) *
                      started.span,
                );
              } else if (started.mode === 'price-scale') {
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
            сдвигает или масштабирует цену в зависимости от выбранного режима,
            нижняя меняет масштаб времени. Экстремумы подтверждаются тремя
            следующими свечами.
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
                  stroke="#d8e0e5"
                  strokeDasharray="3 6"
                />
                <text
                  x={width - right + 10}
                  y={top + position * chartHeight + 4}
                  textAnchor="start"
                  fill="#586976"
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
            stroke="#bac8d0"
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
                  stroke="#087765"
                  strokeDasharray="6 5"
                  strokeOpacity="0.62"
                />
                <text
                  x={width - right - 4}
                  y={y(viewStructure.support) - 6}
                  textAnchor="end"
                  fill="#087765"
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
                  stroke="#b34562"
                  strokeDasharray="6 5"
                  strokeOpacity="0.62"
                />
                <text
                  x={width - right - 4}
                  y={y(viewStructure.resistance) - 6}
                  textAnchor="end"
                  fill="#b34562"
                  fontSize="10"
                >
                  Сопротивление · {fmt(viewStructure.resistance)}
                </text>
              </g>
            )}
          {visible.map((bar, localIndex) => {
            const index = offset + localIndex,
              color = bar.close >= bar.open ? '#197b79' : '#b96279';
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
              stroke="#647788"
              strokeDasharray="3 5"
              strokeOpacity="0.55"
            />
            <rect
              x={plotRight}
              y={closedTagY - 10}
              width={right}
              height="20"
              fill="#e1e8ec"
            />
            <text
              x={plotRight + right / 2}
              y={closedTagY + 3.5}
              textAnchor="middle"
              fill="#233944"
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
                stroke="#1955da"
                strokeDasharray="2 3"
                strokeOpacity="0.82"
              />
              <circle cx={plotRight} cy={liveY} r="3.5" fill="#1955da" />
              <rect
                x={plotRight}
                y={liveY - 10}
                width={right}
                height="20"
                fill="#1955da"
              />
              <text
                x={plotRight + right / 2}
                y={liveY + 3.5}
                textAnchor="middle"
                fill="#ffffff"
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
              stroke={viewStructure.trend === 'up' ? '#087765' : '#b34562'}
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
                fill={pivot.kind === 'high' ? '#8c661b' : '#087765'}
              />
              <text
                x={x(pivot.index)}
                y={y(pivot.price) + (pivot.kind === 'high' ? -8 : 15)}
                textAnchor="middle"
                fill={pivot.kind === 'high' ? '#8c661b' : '#087765'}
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
                fill={event.kind.includes('reclaim') ? '#8b62b0' : '#337eb8'}
              />
              <text
                x={x(event.index)}
                y={y(bars[event.index].close) + 3.5}
                textAnchor="middle"
                fill="#ffffff"
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
                stroke="#596c7d"
                strokeDasharray="4 4"
              />
              <line
                x1={left}
                x2={plotRight}
                y1={selected.y}
                y2={selected.y}
                stroke="#596c7d"
                strokeDasharray="4 4"
              />
              <rect
                x={plotRight}
                y={selected.y - 11}
                width={right}
                height="22"
                fill="#263944"
              />
              <text
                x={plotRight + right / 2}
                y={selected.y + 4}
                textAnchor="middle"
                fill="#ffffff"
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
                fill="#263944"
              />
              <text
                x={clamp(crossX, left + 58, plotRight - 58)}
                y={height - 13}
                textAnchor="middle"
                fill="#ffffff"
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
              fill="#586976"
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
            style={{ cursor: priceAxisMode === 'pan' ? 'grab' : 'ns-resize' }}
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
        <div className="chart-tools" aria-label="Управление графиком">
          <button aria-label="Приблизить график" onClick={() => zoom(-16)}>
            +
          </button>
          <button aria-label="Отдалить график" onClick={() => zoom(16)}>
            −
          </button>
          <button
            className="chart-tool-reset"
            aria-label="Сбросить положение и масштаб графика"
            title="Сбросить положение и масштаб графика"
            onClick={resetView}
          >
            ↺ <span>Сбросить вид</span>
          </button>
          <button
            className="chart-tool-mode"
            aria-label={`Режим правой шкалы: ${priceAxisMode === 'pan' ? 'сдвиг цены' : 'масштаб цены'}. Переключить режим`}
            title="Переключить действие при перетаскивании правой шкалы"
            onClick={() =>
              setPriceAxisMode((mode) => (mode === 'pan' ? 'scale' : 'pan'))
            }
          >
            Цена: {priceAxisMode === 'pan' ? 'сдвиг' : 'масштаб'}
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
          max={maxPanEnd}
          value={end}
          onChange={(event) => {
            const next = Number(event.target.value);
            setEndOverride(next === bars.length ? null : next);
          }}
        />
        <span>{utc(visible.at(-1)!.time, true)}</span>
      </div>
      <div className="chart-navigation-hint">
        <MousePointer2 /> Тяните поле — перемещение · правую шкалу — сдвиг или
        масштаб цены (переключатель сверху) · нижнюю шкалу или колесо — масштаб
        времени · кнопка «Сбросить вид» возвращает исходный график ·{' '}
        {bars.length} свечей
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
  const [analysisResult, setAnalysisResult] = useState<{
    fingerprint: string;
    read: MarketRead;
  } | null>(null);
  const [entrySearch, setEntrySearch] = useState<{
    fingerprint: string;
    interval: HLInterval;
    patterns: EntryPattern[];
    searchedAt: string;
  } | null>(null);
  const [savedResult, setSavedResult] = useState(false);
  const configRef = useRef(config);
  const experimentRef = useRef(experiment);
  configRef.current = config;
  experimentRef.current = experiment;
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [logs, setLogs] = useState<CalculationLog[]>([]);
  const logId = useRef(0);
  const appendLog = useCallback(
    (level: CalculationLog['level'], scope: string, message: string) => {
      const entry = {
        id: ++logId.current,
        time: new Date().toISOString(),
        level,
        scope,
        message,
      };
      setLogs((current) => [...current, entry].slice(-500));
    },
    [],
  );
  const [agent, setAgent] = useState<AgentConnection>({
    state: 'checking',
    account: null,
    model: null,
    checkedAt: null,
  });
  const [checkingAgent, setCheckingAgent] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [startingLogin, setStartingLogin] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutBusy = useRef(false);
  const authRevision = useRef(0);
  const endAgentSession = async () => {
    if (logoutBusy.current) return;
    logoutBusy.current = true;
    authRevision.current++;
    setLoggingOut(true);
    setLoginError('');
    try {
      await logoutAgent(window.location.hostname);
      setAgent({
        state: 'unauthorized',
        account: null,
        model: null,
        checkedAt: new Date().toISOString(),
        loginState: 'idle',
      });
      setLoginPending(false);
      loginStartedAt.current = 0;
      previousAgentState.current = 'unauthorized';
      appendLog('info', 'Агент', 'Выполнен выход из аккаунта Codex.');
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : 'Не удалось выйти.',
      );
    } finally {
      authRevision.current++;
      logoutBusy.current = false;
      setLoggingOut(false);
    }
  };
  const loginWindow = useRef<Window | null>(null);
  const loginRequestBusy = useRef(false);
  const loginStartedAt = useRef(0);
  const beginAgentLogin = async () => {
    if (loginRequestBusy.current) return;
    const popup = window.open(
      'about:blank',
      'aurum-codex-login',
      'popup,width=520,height=720',
    );
    if (!popup) {
      setLoginError(
        'Разрешите всплывающее окно для этого сайта и повторите вход.',
      );
      return;
    }
    popup.opener = null;
    loginWindow.current = popup;
    loginRequestBusy.current = true;
    setStartingLogin(true);
    setLoginError('');
    try {
      const url = await startAgentLogin(window.location.hostname);
      popup.location.href = url;
      loginStartedAt.current = Date.now();
      setLoginPending(true);
    } catch (error) {
      popup.close();
      setLoginError(
        error instanceof Error ? error.message : 'Не удалось открыть вход.',
      );
    } finally {
      loginRequestBusy.current = false;
      setStartingLogin(false);
    }
  };
  const agentCheckBusy = useRef(false);
  const previousAgentState = useRef<AgentConnection['state'] | null>(null);
  const checkAgent = useCallback(
    async (signal?: AbortSignal) => {
      if (agentCheckBusy.current || logoutBusy.current) return;
      const revision = authRevision.current;
      agentCheckBusy.current = true;
      setCheckingAgent(true);
      try {
        const next = await readAgentConnection(
          window.location.hostname,
          signal,
        );
        if (signal?.aborted || revision !== authRevision.current) return;
        setAgent(next);
        if (next.state === 'connected') {
          loginStartedAt.current = 0;
          setLoginPending(false);
          setLoginError('');
          loginWindow.current?.close();
          loginWindow.current = null;
        } else if (next.loginState === 'pending') {
          if (!loginStartedAt.current) loginStartedAt.current = Date.now();
          setLoginPending(true);
        } else if (next.loginState === 'failed') {
          loginStartedAt.current = 0;
          setLoginPending(false);
          setLoginError(
            next.loginError ?? 'Вход не завершён. Повторите попытку.',
          );
        }
        if (next.state !== previousAgentState.current) {
          appendLog(
            next.state === 'connected' ? 'success' : 'warning',
            'Агент',
            agentLabels[next.state],
          );
          previousAgentState.current = next.state;
        }
      } catch {
        // An unmounted page cancels its pending status check.
      } finally {
        agentCheckBusy.current = false;
        if (!signal?.aborted) setCheckingAgent(false);
      }
    },
    [appendLog],
  );
  useEffect(() => {
    const controller = new AbortController();
    const initialCheck = window.setTimeout(
      () => void checkAgent(controller.signal),
      0,
    );
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === 'visible')
          void checkAgent(controller.signal);
        if (loginPending && Date.now() - loginStartedAt.current > 330_000) {
          setLoginPending(false);
          setLoginError(
            'Время ожидания истекло. Проверьте подключение и повторите вход.',
          );
        }
      },
      loginPending ? 1500 : 30_000,
    );
    const onFocus = () => void checkAgent(controller.signal);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      controller.abort();
      window.clearTimeout(initialCheck);
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [checkAgent, loginPending]);
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
    activeStrategy = useRef<string | null>(null);
  const structure = useMemo(() => analyzeMarket(bars), [bars]);
  const marketRead = useMemo(() => {
    if (analysisResult?.fingerprint === fingerprint(bars))
      return analysisResult.read;
    return market || source !== 'Синтетический резервный набор'
      ? analyzeMarketRead(bars, structure)
      : null;
  }, [analysisResult, bars, structure, market, source]);

  useEffect(() => {
    if (
      !market ||
      !experiment ||
      !researchMatches(experiment, bars, experiment.config)
    )
      return;
    try {
      saveResearchSnapshot(window.localStorage, { market, experiment });
    } catch {
      /* Storage may be disabled; the live calculation still works. */
    }
  }, [market, experiment, bars]);

  const runResearch = useCallback(
    (nextBars: Bar[], reason: string, preserveSelection = false) => {
      const id = ++calculationId.current;
      setCalculating(true);
      appendLog(
        'info',
        'Исследование',
        `${reason}. Запуск: ${nextBars.length} свечей · ${fingerprint(nextBars)}.`,
      );
      const startedAt = performance.now();
      window.setTimeout(() => {
        if (id !== calculationId.current) {
          appendLog(
            'warning',
            'Исследование',
            `Запуск №${id} отменён: начат новый расчёт.`,
          );
          return;
        }
        try {
          const result = research(
            nextBars,
            configRef.current,
            preserveSelection ? activeStrategy.current : null,
          );
          if (id === calculationId.current) {
            setExperiment(result);
            experimentRef.current = result;
            activeStrategy.current = result.selected?.id ?? null;
            setUpdatedReason(reason);
            result.log.forEach((message) =>
              appendLog('info', `Расчёт №${id}`, message),
            );
            appendLog(
              'success',
              `Расчёт №${id}`,
              `Завершён за ${fmt(performance.now() - startedAt, 0)} мс.`,
            );
          }
        } catch (caught) {
          if (id === calculationId.current) {
            const message =
              caught instanceof Error ? caught.message : 'Ошибка исследования.';
            setError(message);
            appendLog('error', `Расчёт №${id}`, message);
          }
        } finally {
          if (id === calculationId.current) setCalculating(false);
        }
      }, 20);
    },
    [appendLog],
  );

  const refresh = useCallback(
    async (requestedInterval: HLInterval, automatic = false) => {
      if (dataBusy.current) return;
      dataBusy.current = true;
      setLoading(true);
      appendLog(
        'info',
        'Данные',
        `Запрос Hyperliquid · ${requestedInterval}${automatic ? ' · автопроверка' : ''}.`,
      );
      if (!automatic) setError('');
      const controller = new AbortController();
      requestRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 25000);
      try {
        const dataset = await loadHyperliquid(
          requestedInterval,
          controller.signal,
        );
        const reusable = researchMatches(
          experimentRef.current,
          dataset.bars,
          configRef.current,
        );
        setBars(dataset.bars);
        setMarket(dataset);
        setSource(`${dataset.venue} · ${dataset.coin}`);
        setIntervalValue(requestedInterval);
        setSavedResult(false);
        appendLog(
          'success',
          'Данные',
          `Получено ${dataset.bars.length} закрытых свечей. ${reusable ? 'История и настройки совпадают; используем готовый расчёт.' : 'Требуется обновить расчёт.'}`,
        );
        if (reusable)
          setUpdatedReason('История проверена; использован готовый расчёт');
        else
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
        appendLog('error', 'Данные', message);
        if (experimentRef.current)
          setUpdatedReason(
            'Свежие данные недоступны; показан предыдущий расчёт',
          );
        if (!automatic || !market) setError(message);
        if (!market && !experimentRef.current)
          runResearch(bars, 'Резервный демонстрационный набор');
      } finally {
        window.clearTimeout(timeout);
        dataBusy.current = false;
        setLoading(false);
        requestRef.current = null;
      }
    },
    [bars, experiment, market, runResearch, appendLog],
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
    let initialInterval: HLInterval = '1h';
    try {
      const saved = loadResearchSnapshot(window.localStorage);
      if (saved) {
        initialInterval = saved.market.interval;
        configRef.current = saved.experiment.config;
        experimentRef.current = saved.experiment;
        activeStrategy.current = saved.experiment.selected?.id ?? null;
        setBars(saved.market.bars);
        setMarket(saved.market);
        setSource(`${saved.market.venue} · ${saved.market.coin}`);
        setIntervalValue(initialInterval);
        setConfig(saved.experiment.config);
        setExperiment(saved.experiment);
        setSavedResult(true);
        setUpdatedReason(
          'Восстановлен последний расчёт; проверяем свежие свечи',
        );
        appendLog(
          'info',
          'Исследование',
          'Восстановлен сохранённый расчёт. Проверяем актуальность истории.',
        );
      }
    } catch {
      /* Continue normally when browser storage is unavailable. */
    }
    const timer = window.setTimeout(
      () => void refreshRef.current(initialInterval, true),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      cancelPending();
    };
  }, [cancelPending, appendLog]);
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
      setSavedResult(false);
      setSource(file.name);
      appendLog(
        'success',
        'Импорт',
        `${file.name}: проверено ${nextBars.length} свечей.`,
      );
      runResearch(nextBars, 'Импортирован CSV');
    } catch (caught) {
      appendLog(
        'error',
        'Импорт',
        caught instanceof Error ? caught.message : 'Не удалось прочитать CSV.',
      );
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
    () =>
      makeTradingSignal(
        bars,
        experiment?.fingerprint === fingerprint(bars) ? experiment : null,
        structure,
      ),
    [bars, experiment, structure],
  );
  const entrySearchCurrent =
    entrySearch?.fingerprint === fingerprint(bars) &&
    entrySearch.interval === interval;
  const runEntrySearch = () => {
    const patterns = findEntryPatterns(bars);
    setEntrySearch({
      fingerprint: fingerprint(bars),
      interval,
      patterns,
      searchedAt: new Date().toISOString(),
    });
    appendLog(
      'info',
      'Модели для входа',
      `Проверены 3 модели по закрытым свечам. Найдено: ${patterns.length}; подтверждено: ${patterns.filter((pattern) => pattern.status === 'confirmed').length}.`,
    );
  };
  const runMarketRead = async () => {
    if (aiAnalyzing) return;
    const startedAt = performance.now();
    appendLog(
      'info',
      'Анализ рынка',
      'Рассчитан OHLC-прокси; отправлен запрос Codex по последним 80 свечам.',
    );
    const fallback = analyzeMarketRead(bars, structure);
    const analysisFingerprint = fingerprint(bars);
    const setMarketRead = (read: MarketRead) =>
      setAnalysisResult({ fingerprint: analysisFingerprint, read });
    setMarketRead(fallback);
    setAiAnalyzing(true);
    try {
      const response = await fetch(
        agentEndpoint('analyze', window.location.hostname),
        {
          method: 'POST',
          signal: AbortSignal.timeout(120_000),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt:
              'Проанализируй закрытые бары xyz:GOLD для учебной платформы. Определи направление рынка, направление от открытия текущего UTC-дня, свечной order-flow proxy и SMT proxy. Объясни сценарий и условия отмены. confidence — субъективная уверенность анализа от 0 до 1 (0.62 означает 62 из 100), не вероятность прибыльной сделки. Данные: ' +
              JSON.stringify({
                bars: bars.slice(-80),
                structure: {
                  trend: structure.trend,
                  support: structure.support,
                  resistance: structure.resistance,
                  recentEvents: structure.events.slice(-6),
                },
              }),
          }),
        },
      );
      if (!response.ok) {
        const failure: unknown = await response.json().catch(() => ({}));
        const failureMessage =
          typeof failure === 'object' &&
          failure !== null &&
          'error' in failure &&
          typeof failure.error === 'string'
            ? failure.error
            : null;
        throw new Error(failureMessage ?? 'Локальный Codex bridge недоступен.');
      }
      const payload = (await response.json()) as { text?: string };
      const raw = payload.text?.match(/\{[\s\S]*\}/)?.[0];
      if (!raw) throw new Error('Codex вернул ответ не в JSON-формате.');
      const parsed = JSON.parse(raw) as Partial<MarketRead>;
      if (!['up', 'down', 'range'].includes(String(parsed.bias)))
        throw new Error('Codex вернул неизвестное направление.');
      appendLog(
        'success',
        'Анализ рынка',
        `Ответ Codex получен за ${fmt((performance.now() - startedAt) / 1000, 1)} с.`,
      );
      setMarketRead({
        ...fallback,
        ...parsed,
        source: 'ai',
        confidence: normalizeAIConfidence(parsed.confidence),
        commentary: parsed.commentary ?? payload.text,
      });
    } catch (error) {
      appendLog(
        'warning',
        'Анализ рынка',
        `${error instanceof Error ? error.message : 'Codex недоступен.'} Использован встроенный OHLC-прокси.`,
      );
      setMarketRead({
        ...fallback,
        aiError:
          error instanceof Error
            ? error.message
            : 'Локальный Codex bridge не подключён.',
      });
    } finally {
      setAiAnalyzing(false);
      void checkAgent();
    }
  };
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
          marketRead,
          entrySearch: entrySearchCurrent ? entrySearch : null,
          experiment,
          calculationLogs: logs,
          agent: {
            state: agent.state,
            model: agent.model,
            checkedAt: agent.checkedAt,
          },
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
          <span className="brand-symbol" aria-hidden="true">
            ✳
          </span>
          <span>
            AURUM<span className="brand-light">/ LAB</span>
          </span>
        </div>
        <span className="top-caption">Лаборатория рыночных исследований</span>
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
          <div className="heading-copy">
            <div className="eyebrow">
              RESEARCH TERMINAL <span>/</span> XYZ:GOLD
            </div>
            <h1>
              За пределами <span>шума.</span>
            </h1>
            <p>Золото. Структура рынка. Проверяемые стратегии.</p>
          </div>
          <div className="heading-schematic" aria-hidden="true">
            <div className="schematic-blue" />
            <svg viewBox="0 0 450 170" fill="none">
              <path
                d="M0 142H105L152 95H450M0 151H112L163 101H450M70 0V170M304 0V170M0 39H450M0 124H450"
                stroke="currentColor"
                strokeWidth=".6"
              />
              <g transform="translate(275 84) rotate(-24)">
                <ellipse rx="143" ry="43" stroke="currentColor" />
                <ellipse
                  rx="112"
                  ry="65"
                  stroke="currentColor"
                  strokeWidth=".6"
                />
                <ellipse
                  rx="67"
                  ry="80"
                  stroke="currentColor"
                  strokeWidth=".6"
                />
                <path
                  d="M-160 0H160M0-92V92"
                  stroke="currentColor"
                  strokeWidth=".6"
                />
                <circle r="8" fill="currentColor" />
              </g>
              <path
                d="M25 24H47M36 13V35M399 140H421M410 129V151"
                stroke="currentColor"
              />
            </svg>
            <span className="schematic-label">
              Au / 79
              <br />
              MARKET STRUCTURE
            </span>
            <span className="schematic-index">01—∞</span>
          </div>
        </div>
        <div className="workspace-toolbar">
          <div className="workspace-label">
            <span>01</span> Обзор рынка <small>/ MARKET OVERVIEW</small>
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
            <Button onClick={runEntrySearch} disabled={loading}>
              <ListChecks /> Найти модели для входа
            </Button>
            <Button
              onClick={() => void runMarketRead()}
              disabled={loading || aiAnalyzing || loggingOut}
            >
              <ScanSearch />
              {aiAnalyzing ? 'Codex анализирует…' : 'Анализ рынка'}
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
                <span className="eyebrow">01.1 / HYPERLIQUID · GOLD</span>
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
            <section
              className="entry-search"
              aria-label="Поиск моделей для входа"
            >
              <div className="entry-search-head">
                <div>
                  <span className="eyebrow">
                    ТОЧКА ВХОДА / {interval.toUpperCase()}
                  </span>
                  <h2>Модели для входа</h2>
                </div>
                <Button
                  variant="outline"
                  onClick={runEntrySearch}
                  disabled={loading}
                >
                  <ScanSearch />{' '}
                  {entrySearch ? 'Повторить поиск' : 'Найти модели'}
                </Button>
              </div>
              <p className="entry-search-intro">
                Пробой и ретест · вынос уровня и возврат · откат по тренду. По
                закрытым свечам, с отношением цели к риску от 1,5.
              </p>
              <div aria-live="polite">
                {!entrySearch ? (
                  <p className="entry-empty">
                    Запустите поиск, чтобы увидеть конкретные условия входа и
                    отмены.
                  </p>
                ) : !entrySearchCurrent ? (
                  <p className="entry-empty">
                    Свечи или таймфрейм изменились. Повторите поиск для
                    актуальных уровней.
                  </p>
                ) : (
                  <>
                    <small className="entry-search-meta">
                      {source} · последняя свеча {utc(last.time, true)} UTC ·
                      поиск {utc(entrySearch.searchedAt, true)} UTC
                    </small>
                    {entrySearch.patterns.length === 0 ? (
                      <p className="entry-empty">
                        Подходящих моделей сейчас нет. Проверены все 3 модели:
                        условия входа или минимальное отношение цели к риску не
                        выполнены. Повторите поиск после следующей закрытой
                        свечи.
                      </p>
                    ) : (
                      <div className="entry-patterns">
                        {entrySearch.patterns.map((pattern) => (
                          <article
                            className={`entry-pattern ${pattern.side}`}
                            key={pattern.id}
                          >
                            <div className="entry-pattern-title">
                              <h3>{pattern.name}</h3>
                              <b>{pattern.side.toUpperCase()}</b>
                            </div>
                            <span className={`entry-status ${pattern.status}`}>
                              {pattern.status === 'confirmed'
                                ? 'Условия выполнены'
                                : 'Ждём подтверждения'}
                            </span>
                            <p>{pattern.reason}</p>
                            <div className="entry-levels">
                              <span>
                                {pattern.status === 'confirmed'
                                  ? 'Расчётный вход'
                                  : 'Триггер закрытия'}
                                <b>{fmt(pattern.entry)}</b>
                              </span>
                              <span>
                                Стоп<b>{fmt(pattern.stop)}</b>
                              </span>
                              <span>
                                Цель<b>{fmt(pattern.target)}</b>
                              </span>
                              <span>
                                Цель / риск<b>{fmt(pattern.rr, 1)} : 1</b>
                              </span>
                            </div>
                            <small>
                              {pattern.targetKind === 'structure'
                                ? 'Цель — ближайший подтверждённый противоположный экстремум.'
                                : 'Цель — проекция 2R: противоположный экстремум не найден.'}
                            </small>
                            <p>
                              <strong>Подтверждение:</strong>{' '}
                              {pattern.confirmation}
                            </p>
                            <p>
                              <strong>Отмена:</strong> {pattern.invalidation}
                            </p>
                          </article>
                        ))}
                      </div>
                    )}
                    <small className="entry-search-meta">
                      Учебные сценарии по OHLC. Выполнение условий не означает
                      допуск стратегии; проверка и бэктест показаны отдельно.
                    </small>
                  </>
                )}
              </div>
            </section>
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
                      : experiment
                        ? 'Расчёт завершён'
                        : 'Ожидает расчёта'}
                  </strong>
                </div>
                <i className={calculating ? 'pulse' : ''} />
              </div>
              <div className="agent-connection" aria-label="Подключение Codex">
                <div className="connection-heading">
                  <output className="connection-status">
                    <i className={`connection-dot ${agent.state}`} />
                    {agentLabels[agent.state]}
                  </output>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Проверить подключение агента"
                    disabled={checkingAgent}
                    onClick={() => void checkAgent()}
                  >
                    <RefreshCw className={checkingAgent ? 'spinning' : ''} />
                  </Button>
                </div>
                {agent.state === 'connected' && (
                  <p>
                    {agent.account ?? 'OAuth-сессия активна'}
                    {agent.model ? ` · ${agent.model}` : ''}
                  </p>
                )}
                {agent.state === 'connected' && (
                  <Button
                    className="agent-login-button"
                    variant="outline"
                    disabled={loggingOut || aiAnalyzing || loginPending}
                    onClick={() => void endAgentSession()}
                  >
                    <LogOut />
                    {loggingOut ? 'Выходим…' : 'Выйти'}
                  </Button>
                )}
                {agent.state === 'unauthorized' && (
                  <p>
                    {loginPending
                      ? 'Подтвердите вход в окне ChatGPT. Подключение обновится автоматически.'
                      : 'Подключите аккаунт ChatGPT для анализа через Codex.'}
                  </p>
                )}
                {agent.state === 'unauthorized' && (
                  <Button
                    className="agent-login-button"
                    disabled={startingLogin}
                    onClick={() => void beginAgentLogin()}
                  >
                    <ShieldCheck />
                    {startingLogin
                      ? 'Открываем вход…'
                      : loginPending
                        ? 'Открыть окно входа'
                        : 'Войти через ChatGPT'}
                  </Button>
                )}
                {loginError && (
                  <p className="agent-login-error" role="alert">
                    {loginError}
                  </p>
                )}
                {agent.state === 'offline' && (
                  <details className="agent-login-help">
                    <summary>Как подключить Codex</summary>
                    <p>
                      Один раз запустите локальный помощник:{' '}
                      <code>npm run ai:bridge</code>. Затем войдите кнопкой на
                      сайте. Аккаунт сохраняется на этом компьютере.
                    </p>
                  </details>
                )}
                <small>
                  {aiAnalyzing
                    ? 'Codex выполняет анализ…'
                    : agent.state === 'connected'
                      ? 'Готов к запросу анализа'
                      : 'Доступен встроенный OHLC-прокси'}
                </small>
                {agent.checkedAt && (
                  <small>
                    Проверено{' '}
                    {new Date(agent.checkedAt).toLocaleTimeString('ru-RU')} ·
                    каждые 30 с
                  </small>
                )}
              </div>
              <div className={`signal ${tradingSignal.side}`}>
                <div className="signal-kicker">
                  <span>
                    {savedResult
                      ? 'Сохранённый сценарий'
                      : 'Фьючерсный сценарий'}
                  </span>
                  <small>
                    {savedResult
                      ? loading
                        ? 'Проверяем актуальность данных'
                        : 'Актуальность не подтверждена'
                      : `до закрытия следующей ${interval} свечи`}
                  </small>
                </div>
                <strong>{tradingSignal.label}</strong>
                <div className="direction-line">
                  Направление по закрытым свечам:{' '}
                  <b>{marketRead?.biasLabel ?? tradingSignal.direction}</b>
                </div>
                <div className="agreement">
                  <span>Согласованность фильтров входа</span>
                  <b>{tradingSignal.agreement}%</b>
                  <i>
                    <em style={{ width: `${tradingSignal.agreement}%` }} />
                  </i>
                </div>
              </div>
              {marketRead && (
                <div
                  className="market-read"
                  aria-label="Результат анализа рынка"
                >
                  <div className="market-read-head">
                    <span>
                      {marketRead.source === 'ai'
                        ? 'АНАЛИЗ CODEX AI'
                        : 'АНАЛИЗ ПОСЛЕДНИХ БАРОВ · ПРОКСИ'}
                    </span>
                    <b
                      className={
                        marketRead.bias === 'up'
                          ? 'market-read-bias up'
                          : marketRead.bias === 'down'
                            ? 'market-read-bias down'
                            : 'market-read-bias range'
                      }
                    >
                      {marketRead.biasLabel}
                    </b>
                  </div>
                  <div className="market-read-grid">
                    <span>
                      Открытие дня <b>{fmt(marketRead.dayOpen)}</b>
                    </span>
                    <span>
                      Order flow <b>{marketRead.flowLabel}</b>
                    </span>
                    <span>
                      SMT <b>{marketRead.smtLabel}</b>
                    </span>
                    <span>
                      {marketRead.source === 'ai'
                        ? 'Уверенность анализа Codex'
                        : 'Согласованность факторов'}{' '}
                      <b title="Условная оценка уверенности анализа, не вероятность прибыльной сделки">
                        {marketRead.confidence}/100
                      </b>
                    </span>
                  </div>
                  <p>{marketRead.scenario}</p>
                  <small>{marketRead.reasons.join(' · ')}</small>
                  {marketRead.commentary && (
                    <p className="market-read-commentary">
                      {marketRead.commentary}
                    </p>
                  )}
                  {marketRead.aiError && (
                    <small className="market-read-warning">
                      {marketRead.aiError}
                    </small>
                  )}
                </div>
              )}
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
              <p className="signal-validity">
                {savedResult
                  ? 'Это последний сохранённый расчёт. Его актуальность ещё не подтверждена свежими данными.'
                  : tradingSignal.invalidation}
              </p>
              {calculating && experiment && (
                <p className="recalculation-note">
                  Идёт проверка новой свечи. До завершения показано предыдущее
                  подтверждённое решение.
                </p>
              )}
            </section>
            <section className="panel structure-card">
              <div className="panel-title">
                <h2>
                  <span className="section-index">02 /</span> Структура цены
                </h2>
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
            <TabsTrigger value="logs">
              <ListChecks /> Логи вычислений{' '}
              {logs.length > 0 && (
                <span className="log-count">{logs.length}</span>
              )}
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
                  <h2>
                    <span className="section-index">03 /</span> Результаты
                    поиска
                  </h2>
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
          <TabsContent value="logs">
            <section className="panel tab-panel">
              <div className="panel-title">
                <div>
                  <h2>Логи вычислений</h2>
                  <p className="section-description">
                    Данные, обучение модели, выбор стратегии и обращения к
                    Codex. Последние 500 записей текущей сессии; время местное.
                  </p>
                </div>
                <div className="log-actions">
                  <Button
                    variant="outline"
                    disabled={!logs.length}
                    onClick={() =>
                      download(
                        'aurum-calculation-logs.json',
                        JSON.stringify(logs, null, 2),
                        'application/json',
                      )
                    }
                  >
                    <ArrowDownToLine /> Скачать JSON
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!logs.length}
                    onClick={() => setLogs([])}
                  >
                    Очистить
                  </Button>
                </div>
              </div>
              <div
                className="calculation-log"
                role="log"
                aria-label="Журнал вычислений"
                aria-live="polite"
                aria-relevant="additions"
              >
                {logs.length ? (
                  logs.map((entry) => (
                    <article
                      className={`log-entry ${entry.level}`}
                      key={entry.id}
                    >
                      <time dateTime={entry.time}>
                        {new Date(entry.time).toLocaleTimeString('ru-RU')}
                      </time>
                      <span className="log-level">
                        {
                          {
                            info: 'ИНФО',
                            success: 'ГОТОВО',
                            warning: 'ВНИМАНИЕ',
                            error: 'ОШИБКА',
                          }[entry.level]
                        }
                      </span>
                      <div>
                        <strong>{entry.scope}</strong>
                        <p>{entry.message}</p>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="section-description">
                    Журнал пуст. Записи появятся при следующем обновлении данных
                    или запуске расчёта.
                  </p>
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
