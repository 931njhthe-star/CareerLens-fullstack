import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKEND_FLOW_NODES, sanitizeFlowProgressEvents, sanitizeGuestFlowEvents, stageForFlow } from '../../src/features/activity-flow/backend-progress.js';

const event = (id, stage, message, status = 'running', progress_percent = null) => ({
  id, stage, message, status, progress_percent,
  run_id: 'PRIVATE_RUN', event_payload: { resume_text: 'PRIVATE_RESUME' },
  node_execution_id: 'PRIVATE_NODE', created_at: 'PRIVATE_DATE', failure_reason: 'PRIVATE_ERROR',
});

test('real parsing and indexing messages distinguish completion from the still-running run', () => {
  assert.deepEqual(sanitizeFlowProgressEvents([
    event(1, 'parsing', '이력서 문서 구조화 시작', 'running', 5),
    event(2, 'parsing', '이력서 문서 구조화 완료', 'running', 8),
    event(3, 'parsing', '채용공고 구조화 완료', 'running', 12),
    event(4, 'indexing', '이력서 근거 검색 준비 완료', 'running', 18),
  ]), [
    { id: 1, node: 'parse_resume', state: 'running', progress: 5 },
    { id: 2, node: 'parse_resume', state: 'complete', progress: 8 },
    { id: 3, node: 'parse_job', state: 'complete', progress: 12 },
    { id: 4, node: 'indexing', state: 'complete', progress: 18 },
  ]);
});

test('all twelve criteria preserve identity without claiming domain completion from a substep', () => {
  for (const domain of ['A', 'B', 'C', 'D']) for (const number of [1, 2, 3]) {
    const code = `${domain}${number}`;
    const [running, finished] = sanitizeFlowProgressEvents([
      event(1, 'criterion', `${code} · 초안 평가 완료`, 'running', 43),
      event(2, 'criterion', `${code} · 12/12개 항목 검증 및 저장 완료`, 'completed', 82),
    ]);
    assert.deepEqual(running, { id: 1, node: `domain_${domain.toLowerCase()}`, state: 'running', criterion: code, progress: 43 });
    assert.deepEqual(finished, { id: 2, node: `domain_${domain.toLowerCase()}`, state: 'complete', criterion: code, progress: 82 });
  }
  assert.deepEqual(sanitizeFlowProgressEvents([
    event(1, 'criterion', 'A4 · 평가 시작'), event(2, 'criterion', 'E1 · 평가 시작'),
    event(3, 'criterion', 'A1 · 13/12개 항목 검증 및 저장 완료', 'completed'),
    event(4, 'criterion', 'A1 · 초안 평가 완료', 'completed'),
  ]), []);
});

test('validation, one bounded recheck, scoring and persisted report are separate proven stages', () => {
  const output = sanitizeFlowProgressEvents([
    event(1, 'validation', '전체 평가 결과 교차 검토 시작'),
    event(2, 'validation', '전체 평가 결과 교차 검토 완료', 'completed'),
    event(3, 'validation', '검토 지적 항목 2개 재평가 시작'),
    event(4, 'validation', '검토 지적 항목 2개 재평가 완료', 'completed'),
    event(5, 'validation', '최종 점수 계산 시작'),
    event(6, 'validation', '최종 점수 계산 완료', 'completed'),
    event(7, 'validation', '점수 계산 및 Markdown 보고서 생성 시작'),
    event(8, 'validation', '최종 Markdown 보고서 저장 완료', 'completed', 99),
    event(9, 'completed', '평가 및 Markdown 보고서 완료', 'completed', 100),
  ]);
  assert.deepEqual(output.map(({ node, state }) => [node, state]), [
    ['validation', 'running'], ['validation', 'complete'], ['validation', 'running'], ['validation', 'complete'],
    ['scoring', 'running'], ['scoring', 'complete'], ['database', 'running'], ['database', 'complete'], ['analysis', 'complete'],
  ]);
  assert.ok(output.every(({ node }) => BACKEND_FLOW_NODES.includes(node)));
  assert.ok(!output.some(({ node }) => node === 'report'), 'report display still requires a successful report fetch and render');
});

test('only known complete metadata is accepted; private and changed server messages are omitted', () => {
  const output = sanitizeFlowProgressEvents([
    event(1, 'evaluation', '4개 영역·12개 항목 병렬 평가 시작', 'running', 18),
    event(2, 'criterion', 'A1 · PRIVATE_RESUME'),
    event(3, 'PRIVATE_STAGE', '이력서 문서 구조화 시작'),
    event(4, 'parsing', '이력서 문서 구조화 시작 PRIVATE_TEXT'),
    event(5, 'validation', '최종 Markdown 보고서 저장 완료', 'failed', 99),
    event(6, 'validation', '검토 지적 항목 0개 재평가 시작'),
    event(7, 'validation', '검토 지적 항목 13개 재평가 시작'),
    event(8, 'criterion', 'A1 · 평가 시작', 'running', '18'),
  ]);
  assert.equal(output.length, 2);
  assert.equal(output[1].progress, null);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|message|payload|run_id|created_at|failure_reason/);
  for (const malformed of [null, {}, '', false]) assert.deepEqual(sanitizeFlowProgressEvents(malformed), []);
});

test('source dedup, ordering, invalid percentages and API page bounds are enforced', () => {
  const sample = (id, progress) => event(id, 'evaluation', '4개 영역·12개 항목 병렬 평가 시작', 'running', progress);
  const output = sanitizeFlowProgressEvents([
    null, sample('1', 25), sample(-1, 25), sample(0, 25), sample(Number.MAX_SAFE_INTEGER + 1, 25),
    sample(3, 0), sample(2, Infinity), sample(1, -1), sample(3, 55), sample(4, 101), sample(5, 23.75),
  ]);
  assert.deepEqual(output.map(({ id, progress }) => [id, progress]), [[1, null], [2, null], [3, 0], [4, null], [5, 23.75]]);
  assert.equal(sanitizeFlowProgressEvents(Array.from({ length: 120 }, (_, index) => sample(index + 1, 18))).length, 100);
});

test('superseded evaluation cancellation is recognized without leaking its run identity', () => {
  assert.deepEqual(sanitizeFlowProgressEvents([
    event(1, 'cancelled', '새 평가 요청으로 이전 평가가 취소되었습니다.', 'skipped', 45),
  ]), [{ id: 1, node: 'analysis', state: 'cancelled', progress: 45 }]);
});

test('stage fallback stays coarse and never invents a parsed-document or criterion result', () => {
  for (const [stage, node] of Object.entries({ queued: 'queue', parsing: 'analysis', indexing: 'indexing', evaluation: 'analysis', criterion: 'analysis', validation: 'validation', completed: 'analysis', cancelled: 'analysis' }))
    assert.equal(stageForFlow(stage), node);
  for (const stage of [null, {}, 'PRIVATE_STAGE', '__proto__', 'parse_resume', 'A1']) assert.equal(stageForFlow(stage), null);
});

test('guest callback events keep measured duration but never imply member database storage', () => {
  const events = sanitizeGuestFlowEvents([
    { id: 1, node: 'parse_resume', state: 'complete', durationMs: 245.5, run_id: 'PRIVATE_RUN', resume: 'PRIVATE_TEXT' },
    { id: 2, node: 'domain_c', state: 'complete', criterion: 'C2', durationMs: -1 },
    { id: 3, node: 'domain_c', state: 'complete', criterion: 'A1' },
    { id: 4, node: 'database', state: 'complete' },
    { id: 5, node: 'guest_store', state: 'complete', payload: 'PRIVATE_REPORT' },
    { id: 6, node: 'report', state: 'complete' },
    { id: 7, node: 'validation', state: 'unknown' },
  ]);
  assert.deepEqual(events, [
    { id: 1, node: 'parse_resume', state: 'complete', durationMs: 245.5 },
    { id: 2, node: 'domain_c', state: 'complete', criterion: 'C2', durationMs: null },
    { id: 5, node: 'guest_store', state: 'complete', durationMs: null },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|payload|run_id|database/);
  assert.deepEqual(sanitizeGuestFlowEvents(null), []);
  assert.equal(sanitizeGuestFlowEvents(Array.from({ length: 200 }, (_, i) => ({ id: i + 1, node: 'validation', state: 'complete' }))).length, 100);
});
