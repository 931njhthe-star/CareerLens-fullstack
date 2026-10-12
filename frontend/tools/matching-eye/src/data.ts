export const MATCH_THRESHOLD = 60;
export const CONNECTION_START = 1.05;
export const CONNECTION_DURATION = 0.9;
export const SETTLED_TIME = 2.25;

export interface MatchingJob {
  id: string;
  company: string;
  role: string;
  location: string;
  score: number | null;
  matched: boolean;
  latitude: number | null;
  longitude: number | null;
  x: number;
  y: number;
  positionSource: 'coordinates' | 'id';
  connectionStart: number | null;
}

export interface MatchingData {
  jobs: MatchingJob[];
  matchedCount: number;
  threshold: number;
  status: string;
}

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  // Avalanche the final bits so sequential posting IDs do not cluster together.
  result ^= result >>> 16;
  result = Math.imul(result, 0x85ebca6b);
  result ^= result >>> 13;
  result = Math.imul(result, 0xc2b2ae35);
  result ^= result >>> 16;
  return (result >>> 0) / 4294967296;
}

function coordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= min && value <= max ? value : null;
}

/** Layout never depends on score, item order, or which résumé is selected. */
export function positionForJob(
  id: string,
  latitude: number | null,
  longitude: number | null,
): Pick<MatchingJob, 'x' | 'y' | 'positionSource'> {
  if (latitude !== null && longitude !== null) {
    // Fixed Korea-centered projection; do not refit bounds when a report changes.
    // Positions remain meaningful if the same postings appear in another report.
    const x = (longitude - 127.8) * 47;
    const y = (latitude - 36.15) * 59;
    const scale = Math.min(1, 197 / Math.max(1, Math.hypot(x, y)));
    return { x: x * scale, y: y * scale, positionSource: 'coordinates' };
  }

  // No geography is invented for records without coordinates: IDs provide a
  // stable schematic position in the iris, independent of matching score.
  const angle = hash(`angle:${id}`) * Math.PI * 2;
  const radius = 111 + hash(`radius:${id}`) * 86;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    positionSource: 'id',
  };
}

/** Accept only the supplied posting records; decorative geometry adds no jobs. */
export function normalizeMatching(value: unknown): MatchingData {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const items = Array.isArray(input.items) ? input.items : [];
  const records = new Map<string, MatchingJob>();

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== 'string' && typeof raw.id !== 'number') continue;
    const id = String(raw.id).trim();
    if (!id || records.has(id)) continue;

    const score =
      typeof raw.score === 'number' && Number.isFinite(raw.score)
        ? Math.max(0, Math.min(100, raw.score))
        : null;
    // Respect a backend exclusion while rejecting contradictory scores below 60.
    const matched = score !== null && score >= MATCH_THRESHOLD && raw.matched !== false;
    const latitude = coordinate(raw.latitude, -85, 85);
    const longitude = coordinate(raw.longitude, -180, 180);
    const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '');

    records.set(id, {
      id,
      company: text('company'),
      role: text('role'),
      location: text('location'),
      score,
      matched,
      latitude,
      longitude,
      ...positionForJob(id, latitude, longitude),
      connectionStart: matched ? CONNECTION_START : null,
    });
  }

  const jobs = [...records.values()].sort((left, right) => left.id.localeCompare(right.id));
  return {
    jobs,
    matchedCount: jobs.filter((job) => job.matched).length,
    threshold: MATCH_THRESHOLD,
    status: typeof input.status === 'string' ? input.status : jobs.length ? 'ready' : 'no_jobs',
  };
}

/** Exported for deterministic boundary tests and SVG fallback parity. */
export function connectionProgress(time: number): number {
  const clock = Math.max(0, Math.min(1, (time - CONNECTION_START) / CONNECTION_DURATION));
  return clock * clock * (3 - 2 * clock);
}
