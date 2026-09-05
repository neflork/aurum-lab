'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  BrainCircuit,
  Check,
  CircleHelp,
  Database,
  FlaskConical,
  Play,
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
import {
  loadHyperliquid,
  type HLInterval,
  type MarketDataset,
} from '@/lib/hyperliquid';
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
  type Bar,
  type Config,
  type Experiment,
  type Result,
} from '@/lib/engine';

const number = (n: number, d = 2) =>
  new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
const pct = (n: number) => (n > 0 ? '+' : '') + number(n) + '%';
const date = (s: string, full = false) =>
  new Date(s).toLocaleString('ru-RU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: full ? 'numeric' : undefined,
    ...(full ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
  });
const download = (name: string, content: string, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const tradesCSV = (r: Result) =>
  'entry_time,exit_time,side,entry_usd,exit_usd,quantity_oz,pnl_usd,reason\n' +
  r.trades
    .map((t) =>
      [
        t.entryTime,
        t.exitTime,
        t.side === 1 ? 'BUY' : 'SELL',
        t.entry,
        t.exit,
        t.quantity,
        t.pnl,
        t.reason,
      ].join(','),
    )
    .join('\n');

function Chart({
  values,
  times,
  label,
  split = false,
  color = '#ddbb70',
}: {
  values: number[];
  times: string[];
  label: string;
  split?: boolean;
  color?: string;
}) {
  const min = Math.min(...values),
    max = Math.max(...values),
    pad = Math.max((max - min) * 0.12, 0.01),
    lo = min - pad,
    hi = max + pad;
  const width = 800,
    height = 240,
    left = 65,
    right = 12,
    top = 15,
    bottom = 28,
    w = width - left - right,
    h = height - top - bottom;
  const step = Math.max(1, Math.floor(values.length / 700));
  const points = values
    .map((v, i) => ({ v, i }))
    .filter(({ i }) => i % step === 0 || i === values.length - 1)
    .map(
      ({ v, i }) =>
        left +
        (i / Math.max(1, values.length - 1)) * w +
        ',' +
        (top + ((hi - v) / (hi - lo)) * h),
    )
    .join(' ');
  return (
    <svg
      className="price-chart"
      viewBox={'0 0 ' + width + ' ' + height}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {split && (
        <>
          <rect
            x={left}
            y={top}
            width={w * 0.6}
            height={h}
            fill="#24344a"
            opacity=".35"
          />
          <rect
            x={left + w * 0.6}
            y={top}
            width={w * 0.2}
            height={h}
            fill="#6c5633"
            opacity=".15"
          />
          <rect
            x={left + w * 0.8}
            y={top}
            width={w * 0.2}
            height={h}
            fill="#224c44"
            opacity=".17"
          />
        </>
      )}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line
            x1={left}
            x2={width - right}
            y1={top + t * h}
            y2={top + t * h}
            stroke="#293341"
            strokeDasharray="3 5"
          />
          <text
            x={left - 10}
            y={top + t * h + 4}
            textAnchor="end"
            fill="#9aa9bc"
            fontSize="12"
          >
            {number(hi - t * (hi - lo), 0)}
          </text>
        </g>
      ))}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
      />
      {[0, 0.5, 1].map((t) => (
        <text
          key={t}
          x={left + t * w}
          y={height - 4}
          textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}
          fill="#9aa9bc"
          fontSize="12"
        >
          {date(times[Math.round(t * (times.length - 1))])}
        </text>
      ))}
    </svg>
  );
}
function Metric({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong
        className={
          positive === undefined ? '' : positive ? 'positive' : 'negative'
        }
      >
        {value}
      </strong>
      <small>{sub}</small>
    </div>
  );
}

export default function Home() {
  const [bars, setBars] = useState<Bar[]>(() => demoBars());
  const [source, setSource] = useState('Синтетический набор · 1 600 свечей');
  const [synthetic, setSynthetic] = useState(true);
  const [config, setConfig] = useState<Config>({ ...defaults });
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [calculating, setBusy] = useState(false),
    [error, setError] = useState(''),
    [tab, setTab] = useState('strategies');
  const [market, setMarket] = useState<MarketDataset | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [hlInterval, setHLInterval] = useState<HLInterval>('1h');
  const busy = calculating || dataLoading;
  const requestController = useRef<AbortController | null>(null);
  const dataPending = useRef(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null),
    worker = useRef<Worker | null>(null),
    running = useRef(false);
  const barsRef = useRef(bars),
    configRef = useRef(config),
    resultRef = useRef(experiment);
  barsRef.current = bars;
  configRef.current = config;
  resultRef.current = experiment;
  useEffect(
    () => () => {
      worker.current?.terminate();
      requestController.current?.abort();
    },
    [],
  );
  const loadMarket = useCallback(async (requestedInterval: HLInterval) => {
    if (running.current || dataPending.current)
      throw new Error('Дождитесь завершения текущего действия.');
    dataPending.current = true;
    setDataLoading(true);
    setError('');
    const controller = new AbortController();
    requestController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const dataset = await loadHyperliquid(
        requestedInterval,
        controller.signal,
      );
      barsRef.current = dataset.bars;
      setBars(dataset.bars);
      setMarket(dataset);
      setSource(dataset.venue + ' · ' + dataset.coin);
      setSynthetic(false);
      setExperiment(null);
      resultRef.current = null;
      setHLInterval(requestedInterval);
      return dataset;
    } catch (e) {
      const message = controller.signal.aborted
        ? 'Загрузка Hyperliquid прервана или заняла больше 25 секунд. Можно повторить запрос.'
        : e instanceof Error
          ? e.message
          : 'Не удалось загрузить Hyperliquid.';
      setError(message);
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
      dataPending.current = false;
      setDataLoading(false);
      requestController.current = null;
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void loadMarket('1h').catch(() => {}), 0);
    return () => clearTimeout(timer);
  }, [loadMarket]);
  const start = useCallback(
    () =>
      new Promise<Experiment>((resolve, reject) => {
        if (running.current || dataPending.current) {
          reject(new Error('Исследование уже выполняется.'));
          return;
        }
        running.current = true;
        setBusy(true);
        setError('');
        setExperiment(null);
        resultRef.current = null;
        try {
          const task = new Worker(
            new URL('../lib/research.worker.ts', import.meta.url),
            { type: 'module' },
          );
          worker.current = task;
          const finish = () => {
            task.terminate();
            worker.current = null;
            running.current = false;
            setBusy(false);
          };
          task.onmessage = (event) => {
            finish();
            if (event.data.ok) {
              resultRef.current = event.data.result;
              setExperiment(event.data.result);
              setTab('strategies');
              resolve(event.data.result);
            } else {
              setError(event.data.error);
              reject(new Error(event.data.error));
            }
          };
          task.onerror = () => {
            finish();
            const message =
              'Не удалось завершить расчёт. Попробуйте ещё раз или уменьшите набор данных.';
            setError(message);
            reject(new Error(message));
          };
          task.postMessage({
            bars: barsRef.current,
            config: configRef.current,
          });
        } catch (e) {
          running.current = false;
          setBusy(false);
          setError(e instanceof Error ? e.message : 'Ошибка запуска.');
          reject(e);
        }
      }),
    [],
  );
  // Progressive WebMCP enhancement: the page works normally without this API.
  useEffect(() => {
    type Context = {
      registerTool: (
        tool: unknown,
        options: { signal: AbortSignal },
      ) => void | Promise<void>;
    };
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const noArgs = (input: unknown) => {
      if (
        input === null ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length
      )
        throw new Error('Ожидается пустой объект.');
    };
    const tools = [
      {
        name: 'run_strategy_research',
        title: 'Запустить исследование стратегий',
        description:
          'Обучает модель и сравнивает 12 стратегий на загруженном наборе, заменяя текущий отчёт. Использует видимые параметры.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => {
          noArgs(input);
          const r = await start();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          return {
            selected: r.selected?.name ?? null,
            testReturnPct: r.test?.returnPct ?? null,
            admitted: r.admitted,
            fingerprint: r.fingerprint,
          };
        },
      },
      {
        name: 'read_research_summary',
        title: 'Прочитать результат исследования',
        description:
          'Возвращает сводку текущего исследования и статус расчёта. Не запускает расчёты.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: (input: unknown) => {
          noArgs(input);
          const r = resultRef.current;
          return {
            busy: running.current,
            hasResult: !!r,
            selected: r?.selected?.name ?? null,
            testReturnPct: r?.test?.returnPct ?? null,
            admitted: r?.admitted ?? false,
          };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Unsupported registry does not block the application. */
      }
    }
    return () => lifecycle.abort();
  }, [start]);
  const update = (key: keyof Config, value: string) => {
    setConfig((c) => ({ ...c, [key]: value === '' ? NaN : Number(value) }));
    setExperiment(null);
    setError('');
  };
  const field = (key: keyof Config, label: string, step = 1) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <Input
        type="number"
        value={Number.isFinite(config[key]) ? config[key] : ''}
        min={configLimits[key][0]}
        max={configLimits[key][1]}
        step={step}
        disabled={busy}
        onChange={(e) => update(key, e.target.value)}
      />
    </label>
  );
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      if (file.size > 5000000)
        throw new Error('Файл слишком большой. Максимум 5 МБ.');
      const data = parseCSV(await file.text());
      setBars(data);
      setSource(file.name);
      setMarket(null);
      setSynthetic(false);
      setExperiment(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось прочитать CSV.');
    } finally {
      if (upload.current) upload.current.value = '';
    }
  };
  const last = bars[bars.length - 1],
    first = bars[0],
    change = (last.close / first.close - 1) * 100;
  const tr = Math.floor(bars.length * 0.6),
    va = Math.floor(bars.length * 0.8);
  const test = experiment?.test;
  const intervals = bars
    .slice(1)
    .map((b, i) => Date.parse(b.time) - Date.parse(bars[i].time))
    .sort((a, b) => a - b);
  const interval = intervals[Math.floor(intervals.length / 2)] / 60000;
  const gaps = intervals.filter((v) => v > interval * 60000 * 1.5).length;
  const intervalLabel =
    interval < 60
      ? number(interval, 0) + ' мин'
      : interval < 1440
        ? number(interval / 60, 1) + ' ч'
        : number(interval / 1440, 1) + ' д';
  const exportReport = () => {
    if (experiment)
      download(
        'aurum-research-' + experiment.fingerprint + '.json',
        JSON.stringify(
          {
            source,
            synthetic,
            instrument: market
              ? market.coin
              : 'XAU/USD (declared by user for imported CSV)',
            market: market ? { ...market, bars: undefined } : null,
            timezone: 'UTC',
            bars,
            experiment,
          },
          null,
          2,
        ),
        'application/json',
      );
  };
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          ◈{' '}
          <span>
            AURUM<span className="brand-light">LAB</span>
          </span>
        </a>
        <span className="top-caption">Лаборатория торговых стратегий</span>
        <span className="badge">Учебный прототип · 01</span>
      </header>
      <div className="workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              XAU/USD / ИССЛЕДОВАТЕЛЬСКОЕ ПРОСТРАНСТВО
            </div>
            <h1>Золото. Гипотезы. Данные.</h1>
            <p>
              Сравнивайте стратегии. Проверяйте результат. Изучайте сигналы.
            </p>
          </div>
          <Button
            className="primary"
            disabled={busy}
            onClick={() => void start().catch(() => {})}
          >
            {busy ? <span className="spinner" /> : <Play size={16} />}{' '}
            {dataLoading
              ? 'Загрузка котировок…'
              : calculating
                ? 'Идёт исследование…'
                : 'Запустить исследование'}
          </Button>
        </div>
        <div className={'notice ' + (!synthetic ? 'real-notice' : '')}>
          <span className="dot" />
          <span>
            {market
              ? 'Hyperliquid · xyz:GOLD — бессрочный контракт на золото. Свечи сделок; funding не учтён, исполнение моделируется приближённо.'
              : synthetic
                ? 'Синтетические котировки · только демонстрация. Результаты не описывают торговлю реальным золотом.'
                : 'Загружен CSV · инструмент и источник указаны пользователем. Котировки не обновляются в реальном времени.'}
          </span>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            <span>{error}</span>
            <button
              aria-label="Закрыть сообщение об ошибке"
              onClick={() => setError('')}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="main-grid">
          <section className="panel market-panel">
            <div className="panel-title">
              <div>
                <div className="eyebrow">ИСТОРИЯ ЦЕНЫ</div>
                <h2>
                  {market ? 'xyz:GOLD' : 'XAU / USD'}{' '}
                  <span className="muted small">
                    {market ? 'Gold perpetual' : 'Золото'}
                  </span>
                </h2>
              </div>
              <span className="badge">
                {market ? 'HYPERLIQUID' : synthetic ? 'DEMO' : 'CSV'} ·{' '}
                {intervalLabel}
              </span>
            </div>
            <div className="quote">
              {number(last.close)}
              <span>{market ? 'USDC / тр. унция' : 'USD / тр. унция'}</span>
            </div>
            <div className="price-caption">
              <span className={change >= 0 ? 'positive' : 'negative'}>
                {pct(change)}
              </span>
              <span>
                за весь набор · последняя свеча {date(last.time, true)} UTC
              </span>
            </div>
            <Chart
              values={bars.map((b) => b.close)}
              times={bars.map((b) => b.time)}
              label="Цена закрытия XAU/USD в USD, исторический набор"
              split
            />
            <div className="split-legend">
              <span>
                <i className="train" />
                Обучение · 60%
              </span>
              <span>
                <i className="validation" />
                Выбор · 20%
              </span>
              <span>
                <i className="test" />
                Финальный тест · 20%
              </span>
            </div>
            <div className="chart-footer">
              <span>
                {number(bars.length, 0)} свечей · {date(first.time, true)} —{' '}
                {date(last.time, true)}
              </span>
              <span>{gaps} интервалов больше обычного, включая выходные</span>
            </div>
            <div className="api-loader">
              <div>
                <strong>Hyperliquid</strong>
                <span>xyz:GOLD · до 2 000 закрытых свечей</span>
              </div>
              <div className="api-controls">
                <Select
                  value={hlInterval}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (value) setHLInterval(value as HLInterval);
                  }}
                >
                  <SelectTrigger aria-label="Интервал загрузки Hyperliquid">
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
                  disabled={busy}
                  onClick={() => void loadMarket(hlInterval).catch(() => {})}
                >
                  {dataLoading
                    ? 'Загрузка…'
                    : market
                      ? 'Обновить свечи'
                      : 'Загрузить свечи'}
                </Button>
              </div>
            </div>
            {market && (
              <p className="api-caption">
                Получено {date(market.fetchedAt, true)} UTC. Обновление вручную.
                Кошелёк и API-ключ не нужны.{' '}
                <button
                  className="text-link"
                  onClick={() =>
                    download(
                      'hyperliquid-xyz-GOLD-' + market.interval + '.csv',
                      barsCSV(bars),
                      'text/csv',
                    )
                  }
                >
                  Скачать свечи CSV
                </button>
              </p>
            )}
            <div className="data-actions">
              <span className="source-name" title={source}>
                <Database size={14} />
                {source}
              </span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => upload.current?.click()}
              >
                <Upload size={15} /> Загрузить CSV
              </Button>
              <input
                ref={upload}
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                aria-label="Загрузить историю XAU/USD"
                onChange={(e) => void importFile(e.target.files?.[0])}
              />
            </div>
            <div className="csv-hint">
              Столбцы: <code>time,open,high,low,close</code> · 300–20 000
              закрытых свечей · время без зоны считается UTC.{' '}
              <button
                className="text-link"
                onClick={() =>
                  download(
                    'synthetic-xauusd-example.csv',
                    barsCSV(demoBars()),
                    'text/csv',
                  )
                }
              >
                Скачать пример
              </button>
              {!synthetic && (
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() => {
                    setBars(demoBars());
                    setMarket(null);
                    setSynthetic(true);
                    setSource('Синтетический набор · 1 600 свечей');
                    setExperiment(null);
                  }}
                >
                  Вернуть демо
                </button>
              )}
            </div>
          </section>
          <aside className="panel settings">
            <div className="panel-title">
              <h2>Параметры проверки</h2>
              <FlaskConical size={19} />
            </div>
            <div className="fields-grid">
              {field('capital', 'Капитал, USD', 100)}
              {field('allocation', 'Доля капитала, %', 5)}
              {field('stop', 'Стоп-лосс, %', 0.1)}
              {field('take', 'Тейк-профит, %', 0.1)}
            </div>
            {field('maxDrawdown', 'Лимит просадки, %', 1)}
            <details className="cost-details">
              <summary>Издержки исполнения</summary>
              <div className="fields-grid">
                {field('spread', 'Спред, USD/унц.', 0.1)}
                {field('slippage', 'Проскальзывание, USD/унц.', 0.05)}
              </div>
              {field('commission', 'Комиссия за сторону, USD/унц.', 0.01)}
            </details>
            <div className="settings-note">
              <ShieldCheck size={16} />
              <span>
                Одна позиция, без плеча. Вход на открытии следующей свечи.
              </span>
            </div>
            <div className="criteria">
              Допуск на валидации: прибыль выше нуля, от 5 сделок, просадка в
              пределах лимита.
            </div>
            <Button
              className="full"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfig({ ...defaults });
                setExperiment(null);
                setError('');
              }}
            >
              Сбросить параметры
            </Button>
          </aside>
        </div>
        <div className="metric-grid">
          <Metric
            label="Доходность на тесте"
            value={test ? pct(test.returnPct) : '—'}
            sub={
              test
                ? 'После всех заданных издержек'
                : 'Появится после исследования'
            }
            positive={test ? test.returnPct >= 0 : undefined}
          />
          <Metric
            label="Максимальная просадка"
            value={test ? number(test.drawdownPct) + '%' : '—'}
            sub="По капиталу на закрытиях свечей"
          />
          <Metric
            label="Сделки / доля прибыльных"
            value={
              test
                ? test.trades.length +
                  ' / ' +
                  (test.winRate === null ? '—' : number(test.winRate, 1) + '%')
                : '—'
            }
            sub="Только финальный тестовый период"
          />
          <Metric
            label="Сравнение с базовой"
            value={
              test && experiment
                ? pct(test.returnPct - experiment.baseline.returnPct).replace(
                    '%',
                    ' п.п.',
                  )
                : '—'
            }
            sub="Разница с фиксированной MA 10 / 40"
            positive={
              test && experiment
                ? test.returnPct >= experiment.baseline.returnPct
                : undefined
            }
          />
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(String(value))}
          className="research-tabs"
        >
          <div className="tabs-header">
            <TabsList variant="line">
              <TabsTrigger value="strategies">
                <FlaskConical />
                Стратегии
              </TabsTrigger>
              <TabsTrigger value="backtest">
                <Activity />
                Бэктест
              </TabsTrigger>
              <TabsTrigger value="signals">
                <BrainCircuit />
                Сигнал
              </TabsTrigger>
              <TabsTrigger value="method">
                <CircleHelp />
                Методика
              </TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              disabled={!experiment || busy}
              onClick={exportReport}
            >
              <ArrowDownToLine size={15} /> Отчёт JSON
            </Button>
          </div>
          <TabsContent value="strategies">
            <section className="panel results-panel">
              <div className="panel-title">
                <div>
                  <h2>Поиск стратегии</h2>
                  <p className="section-description">
                    9 технических вариантов и 3 порога ML-модели. Ранжирование
                    только на валидации.
                  </p>
                </div>
                <span className="badge">
                  {experiment ? '12 вариантов проверено' : 'Готово к запуску'}
                </span>
              </div>
              {!experiment ? (
                <div className="empty-research">
                  <div className="empty-icon">
                    <BrainCircuit size={29} />
                  </div>
                  <h3>
                    {busy
                      ? 'Обучаем модель и проверяем стратегии'
                      : 'От гипотезы к проверяемому результату'}
                  </h3>
                  <p>
                    {busy
                      ? 'Расчёты выполняются на вашем устройстве. При большом наборе это может занять несколько секунд.'
                      : 'Запустите исследование: система обучит модель, сравнит варианты и отдельно проверит выбранную стратегию.'}
                  </p>
                  <div className="empty-steps">
                    <span>01 · Обучение</span>
                    <span>02 · Валидация</span>
                    <span>03 · Финальный тест</span>
                  </div>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Стратегия</TableHead>
                        <TableHead>Доходность</TableHead>
                        <TableHead>Просадка</TableHead>
                        <TableHead>Сделки</TableHead>
                        <TableHead>Оценка¹</TableHead>
                        <TableHead>Допуск</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {experiment.candidates.map((c) => (
                        <TableRow
                          key={c.strategy.id}
                          className={
                            c.strategy.id === experiment.selected?.id
                              ? 'chosen-row'
                              : ''
                          }
                        >
                          <TableCell>
                            <button
                              className="strategy-button"
                              onClick={() =>
                                setExpanded(
                                  expanded === c.strategy.id
                                    ? null
                                    : c.strategy.id,
                                )
                              }
                              aria-expanded={expanded === c.strategy.id}
                            >
                              <span
                                className={
                                  'strategy-icon ' +
                                  (c.strategy.family === 'ml' ? 'ml' : '')
                                }
                              >
                                {c.strategy.family === 'ml' ? (
                                  <BrainCircuit size={16} />
                                ) : (
                                  <Activity size={16} />
                                )}
                              </span>
                              <span>
                                {c.strategy.name}
                                {c.strategy.id === experiment.selected?.id && (
                                  <small>Выбрана для финального теста</small>
                                )}
                              </span>
                            </button>
                            {expanded === c.strategy.id && (
                              <p className="strategy-description">
                                {c.strategy.description}
                              </p>
                            )}
                          </TableCell>
                          <TableCell
                            className={
                              c.validation.returnPct >= 0
                                ? 'positive'
                                : 'negative'
                            }
                          >
                            {pct(c.validation.returnPct)}
                          </TableCell>
                          <TableCell>
                            {number(c.validation.drawdownPct)}%
                          </TableCell>
                          <TableCell>{c.validation.trades.length}</TableCell>
                          <TableCell>{number(c.score)}</TableCell>
                          <TableCell>
                            <span
                              className={
                                c.eligible ? 'status-good' : 'status-neutral'
                              }
                            >
                              {c.eligible ? 'Пройден' : 'Не пройден'}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="table-footnote">
                    ¹ Оценка = доходность (%) − максимальная просадка (%).
                    Нажмите название, чтобы прочитать правила. Тестовые
                    результаты не участвуют в этой таблице.
                  </p>
                </>
              )}
            </section>
          </TabsContent>
          <TabsContent value="backtest">
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h2>Финальный тест</h2>
                  <p className="section-description">
                    {date(bars[va].time, true)} — {date(last.time, true)} UTC ·
                    отдельные 20% истории
                  </p>
                </div>
                {test && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      download('aurum-trades.csv', tradesCSV(test), 'text/csv')
                    }
                  >
                    <ArrowDownToLine size={15} /> Сделки CSV
                  </Button>
                )}
              </div>
              {!test ? (
                <div className="empty-research">
                  <ShieldCheck size={30} />
                  <h3>
                    {experiment
                      ? 'Кандидат не прошёл валидацию'
                      : 'Сначала выберите стратегию через исследование'}
                  </h3>
                  <p>
                    {experiment
                      ? 'Финальный тест кандидата не выполнялся. Система не подменяет отсутствие результата случайной стратегией.'
                      : 'Система зафиксирует параметры по валидации и только затем откроет финальный тест.'}
                  </p>
                  {experiment && (
                    <p>
                      Базовая MA 10 / 40 на тесте:{' '}
                      {pct(experiment.baseline.returnPct)}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="equity-title">
                    <span>Капитал, USD · {experiment?.selected?.name}</span>
                    <strong>{number(test.finalCapital)} USD</strong>
                  </div>
                  <Chart
                    values={[
                      config.capital,
                      ...test.equity.map((e) => e.value),
                    ]}
                    times={[bars[va].time, ...test.equity.map((e) => e.time)]}
                    label="Капитал на финальном тесте в USD"
                    color="#6fc7ae"
                  />
                  <div className="test-summary">
                    <span>
                      Profit factor:{' '}
                      <strong>
                        {test.profitFactor === null
                          ? 'Не определён (нет убыточных сделок)'
                          : number(test.profitFactor)}
                      </strong>
                    </span>
                    <span>
                      Базовая MA 10 / 40:{' '}
                      <strong>{pct(experiment!.baseline.returnPct)}</strong>
                    </span>
                    <span>
                      Правило допуска:{' '}
                      <strong>
                        {experiment?.admitted ? 'пройдено' : 'не пройдено'}
                      </strong>
                    </span>
                  </div>
                  <h3 className="trade-heading">
                    Последние 30 сделок{' '}
                    <span className="muted small">
                      / всего {test.trades.length}
                    </span>
                  </h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Вход, UTC</TableHead>
                        <TableHead>Выход, UTC</TableHead>
                        <TableHead>Направление</TableHead>
                        <TableHead>Вход → выход</TableHead>
                        <TableHead>Результат, USD</TableHead>
                        <TableHead>Причина выхода</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {test.trades
                        .slice(-30)
                        .reverse()
                        .map((t, i) => (
                          <TableRow key={i}>
                            <TableCell>{date(t.entryTime, true)}</TableCell>
                            <TableCell>{date(t.exitTime, true)}</TableCell>
                            <TableCell
                              className={t.side === 1 ? 'positive' : 'negative'}
                            >
                              {t.side === 1 ? 'Покупка' : 'Продажа'}
                            </TableCell>
                            <TableCell>
                              {number(t.entry)} → {number(t.exit)}
                            </TableCell>
                            <TableCell
                              className={t.pnl >= 0 ? 'positive' : 'negative'}
                            >
                              {number(t.pnl)}
                            </TableCell>
                            <TableCell>{t.reason}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </section>
          </TabsContent>
          <TabsContent value="signals">
            <div className="signal-grid">
              <section className="panel">
                <div className="panel-title">
                  <h2>Сигнал по последней свече</h2>
                  <span className="badge">ИСТОРИЧЕСКИЙ</span>
                </div>
                <div
                  className={
                    'signal-direction ' +
                    (experiment?.admitted && experiment.latest.direction === 1
                      ? 'positive'
                      : experiment?.admitted &&
                          experiment.latest.direction === -1
                        ? 'negative'
                        : '')
                  }
                >
                  {!experiment
                    ? 'Нет расчёта'
                    : !experiment.admitted || experiment.latest.direction === 0
                      ? 'Вне рынка'
                      : experiment.latest.direction === 1
                        ? 'Покупка'
                        : 'Продажа'}
                </div>
                <p className="muted small">
                  Свеча {date(last.time, true)} UTC. Это исторический сигнал, не
                  текущая торговая рекомендация.
                </p>
                {experiment && (
                  <>
                    <div className="signal-explanation">
                      <h3>
                        {experiment.selected?.name ??
                          'Нет допущенной стратегии'}
                      </h3>
                      <p>{experiment.latest.explanation}</p>
                      {!experiment.admitted && (
                        <p className="negative">
                          Выдача торгового сигнала заблокирована критериями
                          валидации или финального теста.
                        </p>
                      )}
                    </div>
                    {experiment.latest.probability !== null && (
                      <div className="probability">
                        <span>Оценка модели: рост следующей свечи</span>
                        <strong>
                          {number(experiment.latest.probability * 100, 1)}%
                        </strong>
                        <p>
                          Выход логистической модели. Калибровка вероятностей не
                          проверена; это не вероятность прибыльной сделки.
                        </p>
                      </div>
                    )}
                    <div className="settings-note">
                      <ShieldCheck size={17} />
                      <span>
                        Если стратегия допущена: вход по следующему доступному
                        открытию, стоп {config.stop}% и тейк {config.take}% от
                        цены исполнения. Будущая цена входа пока неизвестна.
                      </span>
                    </div>
                  </>
                )}
              </section>
              <section className="panel">
                <div className="panel-title">
                  <h2>Журнал исследования</h2>
                  <span className="badge">
                    {experiment ? 'Завершено' : 'Ожидание'}
                  </span>
                </div>
                {experiment ? (
                  <ol className="research-log">
                    {experiment.log.map((line, i) => (
                      <li key={line}>
                        <span>{String(i + 1).padStart(2, '0')}</span>
                        <p>{line}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted">
                    После запуска здесь появятся выполненные шаги и причины
                    решений системы.
                  </p>
                )}
              </section>
            </div>
          </TabsContent>
          <TabsContent value="method">
            <section className="panel methodology">
              <div className="panel-title">
                <h2>Как устроен эксперимент</h2>
                <span className="badge">Версия 1.0</span>
              </div>
              <div className="method-grid">
                <article>
                  <h3>01 / Данные и границы</h3>
                  <p>
                    Используйте API Hyperliquid для xyz:GOLD или загружайте
                    закрытые свечи одного источника XAU/USD. Значения OHLC
                    трактуются как средняя цена между покупкой и продажей в USD
                    за тройскую унцию. Свечи Hyperliquid построены по сделкам и
                    используются как приближение midpoint; для этого режима USD
                    и USDC приравнены. Это не точная модель исполнения
                    Hyperliquid. Сайт проверяет цены, порядок и уникальность
                    времени, но не может подтвердить подлинность источника.
                  </p>
                  <p>
                    Первые {tr} свечей используются для обучения, следующие{' '}
                    {va - tr} — для выбора стратегии, последние{' '}
                    {bars.length - va} — для финального теста. Пропуски не
                    заполняются; периоды индикаторов измеряются в свечах.
                  </p>
                </article>
                <article>
                  <h3>02 / Настоящее машинное обучение</h3>
                  <p>
                    Логистическая регрессия использует шесть признаков:
                    изменение цены за 1, 5 и 20 свечей, волатильность за 20
                    свечей, отклонение от средней и тело свечи. Цель — рост
                    следующей свечи от открытия до закрытия.
                  </p>
                  <p>
                    Стандартизация и веса обучаются только на первых 60%
                    истории: 220 шагов градиентного спуска, шаг 0,08,
                    L2-регуляризация 0,01. На валидации сравниваются пороги 52%,
                    55% и 60%. Языковая модель и чат-агенты пока не подключены.
                  </p>
                </article>
                <article>
                  <h3>03 / Исполнение и издержки</h3>
                  <p>
                    Сигнал закрытой свечи исполняется на следующем открытии.
                    Позиция занимает заданную долю капитала без плеча. Каждая
                    сторона сделки учитывает половину спреда, проскальзывание и
                    комиссию на унцию.
                  </p>
                  <p>
                    Если стоп и тейк достигнуты в одной свече, первым считается
                    стоп. Разрыв через защитный уровень исполняется по открытию
                    с издержками. Остаток позиции закрывается в конце каждого
                    периода. Просадка измеряется по капиталу на закрытиях, не
                    внутри свечи.
                  </p>
                </article>
                <article>
                  <h3>04 / Что можно заключить</h3>
                  <p>
                    Финальный тест считается после фиксации выбранной стратегии.
                    Базовая стратегия для сравнения заранее задана: MA 10 / 40.
                    Для допуска к историческим сигналам тест должен также дать
                    прибыль, минимум 5 сделок и просадку в пределах лимита.
                  </p>
                  <p>
                    Повторная настройка после просмотра теста превращает его в
                    часть подбора. Для нового независимого вывода нужен новый
                    период. Нет проверки статистической значимости,
                    walk-forward, свопов и финансирования, а также ограничений
                    конкретного брокера. Доходность не годовая.
                  </p>
                </article>
              </div>
              <div className="method-footer">
                <Check size={17} />
                <p>
                  Расчёты выполняются в браузере. История не отправляется на
                  сервер и не сохраняется после перезагрузки. Экспорт JSON
                  содержит данные, параметры, веса модели и все результаты для
                  воспроизведения.
                </p>
              </div>
            </section>
          </TabsContent>
        </Tabs>
        <footer className="footer">
          <span>
            AURUM LAB{' '}
            <span className="muted">/ Учебная исследовательская система</span>
          </span>
          <span>История → гипотеза → проверка</span>
        </footer>
      </div>
    </main>
  );
}
