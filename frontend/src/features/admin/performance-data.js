export const RUN_LIMIT = 100;
export const MAX_RUNS = 200;
export const RUN_STATUSES = [
  ['queued', '대기'],
  ['running', '진행'],
  ['completed', '완료'],
  ['partial', '완료 · 확인 필요'],
  ['failed', '실패'],
  ['cancelled', '취소'],
];

export const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const measuredNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const measuredCount = (value) =>
  measuredNumber(value) !== null && Number.isSafeInteger(value) ? value : null;
export const records = (value, limit = 500) =>
  Array.isArray(value) ? value.filter(isRecord).slice(0, limit) : [];

export function normalizePerformance(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.runs))
    throw new Error('Invalid performance response');
  return {
    summary: isRecord(payload.summary) ? payload.summary : {},
    scope: isRecord(payload.scope) ? payload.scope : {},
    generated_at: typeof payload.generated_at === 'string' ? payload.generated_at : null,
    stages: records(payload.stages),
    runs: records(payload.runs, MAX_RUNS).map((run) => ({
      ...run,
      stages_collected: Array.isArray(run.stages),
      stages: records(run.stages),
    })),
  };
}

export function overviewCounts(runs) {
  const counts = Object.fromEntries(RUN_STATUSES.map(([status]) => [status, 0]));
  for (const run of runs) if (Object.hasOwn(counts, run.status)) counts[run.status]++;
  const issueCounts = runs.map((run) => measuredCount(run.validation?.unresolved_issue_count));
  return {
    ...counts,
    unresolved:
      issueCounts.length > 0 && issueCounts.every((count) => count !== null)
        ? issueCounts.reduce((sum, count) => sum + count, 0)
        : null,
    other: runs.length - Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

export function formatDuration(value) {
  const ms = measuredNumber(value);
  if (ms === null) return '미측정';
  if (ms < 1000)
    return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(ms)} ms`;
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(ms / 1000)} 초`;
}

export function formatCount(value) {
  const count = measuredCount(value);
  return count === null ? '기록 없음' : `${count.toLocaleString('ko-KR')}건`;
}

export function formatTime(value) {
  if (typeof value !== 'string' || !value.trim()) return '기록 없음';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)} KST`
    : '기록 없음';
}

export function scoreDisplay(value, { rounded = false } = {}) {
  if (measuredNumber(value) === null || value > 100) return '점수 없음';
  return String(rounded ? Math.round(value) : value);
}

export function statusLabel(value) {
  return (
    RUN_STATUSES.find(([status]) => status === value)?.[1] ||
    (value === 'cancelled' ? '취소' : value === 'skipped' ? '생략' : null) ||
    '상태 확인 불가'
  );
}

export const PARSING_STAGES = new Set(['parse_resume', 'parse_job']);
export const PERSISTENCE_STAGES = new Set([
  'match_result_save',
  'report_render',
  'report_sql_save',
  'report_file_write',
]);

export function filterRuns(runs, status) {
  if (status === 'all') return runs;
  if (status === 'other')
    return runs.filter((run) => !RUN_STATUSES.some(([key]) => key === run.status));
  return runs.filter((run) => run.status === status);
}
