import { parseAgentScan } from './setup-agent.ts';
import type { EntryPattern } from './agent-plan.ts';
import type { HLInterval } from './hyperliquid.ts';
export type SavedPlan = EntryPattern & {
  interval: HLInterval;
  created: string;
};
export function validSavedPlan(value: unknown): value is SavedPlan {
  try {
    if (!value || typeof value !== 'object') return false;
    const p = value as SavedPlan;
    if (
      !['15m', '1h', '4h'].includes(p.interval) ||
      typeof p.id !== 'string' ||
      typeof p.created !== 'string' ||
      !Number.isFinite(Date.parse(p.created))
    )
      return false;
    parseAgentScan(JSON.stringify({ readout: 'Сохранённый план', plans: [p] }));
    return true;
  } catch {
    return false;
  }
}
export function restoreTerminal(raw: string | null, legacy: string | null) {
  let value: {
    plans?: unknown[];
    running?: unknown[];
    selected?: unknown;
    interval?: string;
  } = {};
  try {
    value = JSON.parse(raw || '{}');
  } catch {}
  if (!value || typeof value !== 'object') value = {};
  let old: unknown = [];
  try {
    old = JSON.parse(legacy || '[]');
  } catch {}
  const running = (
    Array.isArray(value.running) ? value.running : Array.isArray(old) ? old : []
  ).filter(validSavedPlan);
  const plans = (Array.isArray(value.plans) ? value.plans : []).filter(
    validSavedPlan,
  );
  const selected =
    value.selected === null
      ? null
      : validSavedPlan(value.selected)
        ? value.selected
        : (running[0] ?? null);
  const interval =
    selected?.interval ??
    (['15m', '1h', '4h'].includes(value.interval || '')
      ? (value.interval as HLInterval)
      : '1h');
  return { plans, running, selected, interval };
}
