export type EntryPattern = {
  id: string;
  name: string;
  side: 'long' | 'short';
  status: 'confirmed' | 'waiting';
  reason: string;
  confirmation: string;
  invalidation: string;
  entry: number;
  stop: number;
  target: number;
  targetKind: 'structure' | 'projection';
  rr: number;
};
