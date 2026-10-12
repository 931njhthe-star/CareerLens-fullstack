// The active FastAPI worker's progress_events contract, not its private artifacts.
// Source: backend app/application/evaluation.py and app/agent/graphs/matching.py.
// Only these fixed messages are interpreted; none of their text crosses the flow channel.
export const BACKEND_FLOW_NODES = Object.freeze([
  'queue', 'analysis', 'parse_resume', 'parse_job', 'indexing',
  'domain_a', 'domain_b', 'domain_c', 'domain_d', 'validation', 'scoring', 'database',
]);
export const GUEST_FLOW_NODES = Object.freeze([
  'parse_resume', 'parse_job', 'indexing', 'domain_a', 'domain_b', 'domain_c', 'domain_d',
  'validation', 'scoring', 'guest_store',
]);

/** Frontend-server guest engine callbacks; deliberately excludes member DB storage. */
export function sanitizeGuestFlowEvents(events) {
  if (!Array.isArray(events)) return [];
  const accepted = new Map();
  for (const event of events.slice(-100)) {
    if (!event || !Number.isSafeInteger(event.id) || event.id <= 0 || accepted.has(event.id)
      || !GUEST_FLOW_NODES.includes(event.node) || !['running', 'complete'].includes(event.state)) continue;
    const criterion = /^domain_[a-d]$/.test(event.node) ? event.criterion : undefined;
    if (/^domain_[a-d]$/.test(event.node) && (typeof criterion !== 'string' || !new RegExp(`^${event.node.at(-1).toUpperCase()}[1-3]$`).test(criterion))) continue;
    const durationMs = typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)
      && event.durationMs >= 0 && event.durationMs <= 86400000 ? event.durationMs : null;
    accepted.set(event.id, { id: event.id, node: event.node, state: event.state, durationMs,
      ...(criterion ? { criterion } : {}) });
  }
  return [...accepted.values()].sort((a, b) => a.id - b.id);
}

const STAGE_NODES = Object.freeze({
  queued: 'queue', parsing: 'analysis', indexing: 'indexing', evaluation: 'analysis',
  criterion: 'analysis', validation: 'validation', completed: 'analysis', cancelled: 'analysis',
});

// current_stage alone cannot distinguish the two parsers or one of twelve criteria.
export function stageForFlow(stage) {
  return typeof stage === 'string' && Object.hasOwn(STAGE_NODES, stage) ? STAGE_NODES[stage] : null;
}

const FIXED_EVENTS = new Map([
  ['parsing:이력서 문서 구조화 시작', ['parse_resume', 'running', 'running']],
  // These parsing/indexing notifications use status=running for the overall run.
  ['parsing:이력서 문서 구조화 완료', ['parse_resume', 'complete', 'running']],
  ['parsing:채용공고 구조화 완료', ['parse_job', 'complete', 'running']],
  ['indexing:이력서 근거 검색 준비 완료', ['indexing', 'complete', 'running']],
  ['evaluation:4개 영역·12개 항목 병렬 평가 시작', ['analysis', 'running', 'running']],
  ['validation:전체 평가 결과 교차 검토 시작', ['validation', 'running', 'running']],
  ['validation:전체 평가 결과 교차 검토 완료', ['validation', 'complete', 'completed']],
  ['validation:최종 점수 계산 시작', ['scoring', 'running', 'running']],
  ['validation:최종 점수 계산 완료', ['scoring', 'complete', 'completed']],
  ['validation:점수 계산 및 Markdown 보고서 생성 시작', ['database', 'running', 'running']],
  // Emitted only after result/report SQL writes and report/audit file writes succeed.
  ['validation:최종 Markdown 보고서 저장 완료', ['database', 'complete', 'completed']],
  ['completed:평가 및 Markdown 보고서 완료', ['analysis', 'complete', 'completed']],
  ['cancelled:새 평가 요청으로 이전 평가가 취소되었습니다.', ['analysis', 'cancelled', 'skipped']],
]);

const CRITERION_STEPS = new Set([
  '평가 시작', '이력서 근거 검색 시작', '이력서 근거 검색 완료',
  '규칙 기반 점수 판정 완료', '초안 평가 요청 중', '초안 평가 완료',
  '근거 검토 요청 중', '근거 검토 완료', '독립 평가 요청 중', '독립 평가 완료',
  '평가 차이 재검토 요청 중', '평가 차이 재검토 완료', '원문 인용 및 점수 검증 중',
  '검증 오류 보완 요청 중', '검증 오류 보완 완료',
]);

function eventMeaning(event) {
  if (typeof event.stage !== 'string' || typeof event.message !== 'string' || event.message.length > 100) return null;
  const fixed = FIXED_EVENTS.get(`${event.stage}:${event.message}`);
  if (fixed) return event.status === fixed[2] ? { node: fixed[0], state: fixed[1] } : null;
  if (event.stage === 'criterion') {
    const match = /^([A-D][1-3]) · (.+)$/.exec(event.message);
    if (!match) return null;
    const [, criterion, step] = match;
    const completed = /^(?:[1-9]|1[0-2])\/12개 항목 검증 및 저장 완료$/.test(step);
    if (completed ? event.status !== 'completed' : event.status !== 'running' || !CRITERION_STEPS.has(step)) return null;
    // A completed criterion does not mean its whole three-criterion domain is done.
    return { node: `domain_${criterion[0].toLowerCase()}`, state: completed ? 'complete' : 'running', criterion };
  }
  if (event.stage === 'validation') {
    const match = /^검토 지적 항목 (?:[1-9]|1[0-2])개 재평가 (시작|완료)$/.exec(event.message);
    if (!match) return null;
    const completed = match[1] === '완료';
    return event.status === (completed ? 'completed' : 'running')
      ? { node: 'validation', state: completed ? 'complete' : 'running' } : null;
  }
  return null;
}

/**
 * Returns at most one API page of metadata. The numeric id is for source dedup only.
 * progress is the overall run percentage, never an individual criterion percentage.
 * UUIDs, timestamps, messages, payloads, error reasons and document text are discarded.
 */
export function sanitizeFlowProgressEvents(events) {
  if (!Array.isArray(events)) return [];
  const accepted = new Map();
  for (const event of events.slice(0, 100)) {
    if (!event || typeof event !== 'object' || !Number.isSafeInteger(event.id) || event.id <= 0 || accepted.has(event.id)) continue;
    const meaning = eventMeaning(event);
    if (!meaning) continue;
    const progress = typeof event.progress_percent === 'number' && Number.isFinite(event.progress_percent)
      && event.progress_percent >= 0 && event.progress_percent <= 100 ? event.progress_percent : null;
    accepted.set(event.id, { id: event.id, ...meaning, progress });
  }
  return [...accepted.values()].sort((a, b) => a.id - b.id);
}
