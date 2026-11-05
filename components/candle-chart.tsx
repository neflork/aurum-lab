'use client';
import { useEffect, useRef, useState } from 'react';
import { LocateFixed, MousePointer2 } from 'lucide-react';
import type { Bar } from '@/lib/market-types';
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
const utc = (value: string, full = false) =>
  new Date(value).toLocaleString('ru-RU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    ...(full ? { year: 'numeric', hour: '2-digit', minute: '2-digit' } : {}),
  });
export function CandleChart({
  bars,
  livePrice,
  fetchedAt,
  plan,
}: {
  bars: Bar[];
  livePrice: number | null;
  fetchedAt: string | null;
  plan?: { entry: number; stop: number; target: number } | null;
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
  const { width, height } = chartSize;
  const left = 18,
    right = 78,
    top = 22,
    bottom = 38;
  const chartWidth = width - left - right,
    chartHeight = height - top - bottom;
  const scalePrices = visible.flatMap((bar) => [bar.low, bar.high]);
  if (atLatest && livePrice !== null) scalePrices.push(livePrice);
  if (plan) scalePrices.push(plan.entry, plan.stop, plan.target);
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
            нижняя меняет масштаб времени. Уровни выбранного плана формирует
            Codex.
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
          {plan &&
            (
              [
                ['ВХОД', plan.entry, '#d8b977'],
                ['СТОП', plan.stop, '#e1908c'],
                ['ЦЕЛЬ', plan.target, '#79c8ac'],
              ] as const
            ).map(([label, price, color]) => (
              <g key={label} pointerEvents="none">
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(price)}
                  y2={y(price)}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray="6 5"
                />
                <rect
                  x={Math.max(left, width - right - 151)}
                  y={y(price) - 20}
                  width={145}
                  height={18}
                  fill="#151a20"
                />
                <text
                  x={width - right - 12}
                  textAnchor="end"
                  y={y(price) - 8}
                  fill={color}
                  fontSize={10}
                >
                  {label} · {price.toFixed(2)}
                </text>
              </g>
            ))}
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
