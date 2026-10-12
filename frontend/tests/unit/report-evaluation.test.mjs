import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisReport } from '../../src/features/analysis/report.js';
import {
  createDemoScoreModel,
  demoScoreModel,
  normalizeDemoScores,
} from '../../src/features/analysis/demo-score-data.js';
import { pyramidAxes, pyramidPreview } from '../../src/features/analysis/status-radar-data.js';

const AXIS_LABELS = ['이력서 완성도', '직무 적합도', '지원 자격 충족도', '실무 경쟁력'];

function legacyReport() {
  return {
    score: 19,
    verdict: '이전 종합 준비도 판정',
    criteria: [{ label: '기존 연결', score: 7, max_score: 70 }],
    recruiter_email: { subject: '이전 종합 점수에 의한 권고', body: '예전 권고 본문' },
    summary: '이력서에 드러난 경험 요약',
    matches: [{ requirement: '실무 근거', status: 'missing' }],
  };
}

test('demo generation has four independent random values in the requested range', () => {
  const samples = [0, 0.25, 0.5, 1, 0, 0.25, 0.5, 1];
  const model = createDemoScoreModel(() => samples.shift());
  assert.equal(model.kind, 'presentation_demo');
  assert.deepEqual(
    model.axes.map((axis) => axis.label),
    AXIS_LABELS,
  );
  assert.deepEqual(
    model.axes.map((axis) => axis.score),
    [35, 49, 63, 90],
  );
  assert.deepEqual(
    model.preview.axes.map((axis) => axis.score),
    [39, 54, 70, 100],
  );
  assert.deepEqual(
    model.axes.map((axis) => axis.subcriteria.map((item) => item.weight)),
    [
      [0.4, 0.35, 0.25],
      [0.45, 0.4, 0.15],
      [0.6, 0.25, 0.15],
      [0.35, 0.35, 0.3],
    ],
  );
  assert.ok(
    model.axes.every((axis) => axis.subcriteria.every((item) => !Object.hasOwn(item, 'score'))),
  );
});

test('normalization preserves zero and unavailable values without pretending missing values are zero', () => {
  assert.deepEqual(
    normalizeDemoScores([0, null, '62', NaN]).map((axis) => axis.normalized),
    [0, null, null, null],
  );
  assert.deepEqual(
    normalizeDemoScores([-1, 101, Infinity, 100]).map((axis) => axis.normalized),
    [null, null, null, 100],
  );
  assert.deepEqual(
    normalizeDemoScores(undefined).map((axis) => axis.normalized),
    [null, null, null, null],
  );
  const model = createDemoScoreModel(() => NaN);
  assert.ok(model.axes.every((axis) => Number.isFinite(axis.score)));
});

test('same report object retains its random scores and preview without reading any report content', () => {
  const report = new Proxy(
    {},
    {
      get() {
        throw new Error('Personal report content must not seed the demo');
      },
    },
  );
  const model = demoScoreModel(report);
  assert.equal(demoScoreModel(report), model);
  assert.equal(pyramidAxes(report), model.axes);
  assert.equal(pyramidPreview(report), model.preview);
  assert.notEqual(demoScoreModel({}), model);
});

test('rendering preserves real report text while all score claims are explicitly demonstrations', () => {
  const report = legacyReport();
  const before = structuredClone(report);
  const draft = { role: '테스트 직무', company: '예시 기업', report };
  const markup = analysisReport(draft);
  assert.equal(analysisReport(draft), markup);
  assert.deepEqual(report, before);
  for (const label of AXIS_LABELS) assert.ok(markup.includes(label));
  assert.equal((markup.match(/class="evaluation-criterion"/g) || []).length, 12);
  assert.equal((markup.match(/예정 비중 /g) || []).length, 12);
  assert.ok(markup.includes('예정 비중 45%'));
  assert.ok(markup.includes('가중 기하평균'));
  assert.ok(markup.includes('시연용 점수 · 실제 평가와 무관'));
  assert.ok(markup.includes('본인의 이력서나 실제 역량을 평가한 점수가 아닙니다.'));
  assert.ok(markup.includes('badge missing'));
  assert.ok(markup.includes(report.summary));
  assert.ok(markup.includes('점수 변화 시연 보기'));
  assert.ok(!markup.includes('<summary>평가 근거</summary>'));
  for (const old of [
    report.verdict,
    '준비도 19점',
    '이대로 지원해도 될까요?',
    report.recruiter_email.subject,
    report.recruiter_email.body,
  ])
    assert.ok(!markup.includes(old));
});

test('server evaluations cannot alter or be mistaken for the cached demo', () => {
  const report = legacyReport();
  const before = pyramidAxes(report).map((axis) => axis.score);
  report.evaluation = { axes: AXIS_LABELS.map((label) => ({ label, score: 100 })) };
  report.score = 100;
  report.improvement_preview = { score: 100, notice: '실제 보완 효과를 보장하는 잘못된 문구' };
  assert.deepEqual(
    pyramidAxes(report).map((axis) => axis.score),
    before,
  );
  const markup = analysisReport({ role: '테스트', report });
  assert.ok(!markup.includes(report.improvement_preview.notice));
  assert.ok(markup.includes('실제 보완 효과를 예측하지 않습니다.'));
});

test('real report evidence remains escaped', () => {
  const report = legacyReport();
  const attack = '<img src=x onerror=alert(1)>';
  report.summary = attack;
  report.matches[0].requirement = attack;
  report.matches[0].evidence_items = [{ excerpt: attack, source_label: attack }];
  const markup = analysisReport({ role: '테스트', report });
  assert.ok(!markup.includes(attack));
  assert.ok(markup.includes('&lt;img'));
});

test('backend report renders the agent Markdown as the final output without demo score graphics', () => {
  const report = {
    source: 'backend',
    status: 'partial',
    score: null,
    backend_report_text: `# 최종 평가 보고서

## 종합 판정
종합점수: 보류

| 평가 항목 | 상태 |
| --- | --- |
| 기업 정보 | Yahoo Finance 확인 |

[Yahoo Finance 출처](https://finance.yahoo.com)`,
  };
  const markup = analysisReport({
    role: '데이터 분석가',
    company: '예시 기업',
    created_at: '2026-01-01',
    selected_posting_id: 'db-job-id',
    report,
  });
  assert.ok(markup.includes('CareerLens · 실제 백엔드 에이전트 보고서'));
  assert.ok(markup.includes('<h3>종합 판정</h3>'));
  assert.ok(markup.includes('종합점수: 보류'));
  assert.ok(markup.includes('<table>'));
  assert.ok(markup.includes('href="https://finance.yahoo.com/"'));
  assert.ok(markup.includes('에이전트 평가 부분 완료'));
  assert.ok(!markup.includes('시연용 점수 · 실제 평가와 무관'));
  assert.ok(!markup.includes('data-status-radar'));
  assert.ok(!markup.includes('가중 기하평균'));
});

test('backend report never falls through to fabricated output when Markdown is unavailable', () => {
  const markup = analysisReport({
    role: '데이터 분석가',
    report: { source: 'backend', score: null, backend_report_text: '' },
  });
  assert.ok(markup.includes('백엔드 최종 보고서 본문을 불러오지 못했습니다'));
  assert.ok(!markup.includes('시연용 점수 · 실제 평가와 무관'));
});
