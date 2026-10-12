import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisReport } from '../../src/features/analysis/report.js';
import { renderMarkdown } from '../../src/shared/components/markdown.js';
import {
  createDemoScoreModel,
  demoScoreModel,
  normalizeDemoScores,
} from '../../src/features/analysis/demo-score-data.js';
import { pyramidAxes, pyramidPreview } from '../../src/features/analysis/status-radar-data.js';

const AXIS_LABELS = ['이력서 완성도', '직무 적합도', '지원 자격 충족도', '실무 경쟁력'];

function legacyReport() {
  return {
    demo: true,
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

test('explicit demo retains its scores and preview on repeated rendering', () => {
  const report = { demo: true };
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

test('report dates convert timezone-aware ISO instants to Seoul and preserve legacy local text', () => {
  const dateText = (created_at) =>
    analysisReport({ report: legacyReport(), created_at })
      .match(/class="result-date">\s*([^]*?)\s*<\/span>/)[1]
      .trim();
  assert.equal(dateText('2026-10-09T08:16:00Z'), '2026. 10. 09. 17:16 KST');
  assert.equal(dateText('2026-10-09T23:16:00Z'), '2026. 10. 10. 08:16 KST');
  assert.equal(dateText('2026-10-09T17:16:00+09:00'), '2026. 10. 09. 17:16 KST');
  assert.equal(dateText('2026-10-09 17:16 KST'), '2026-10-09 17:16 KST');
  assert.equal(dateText('2026-10-09T17:16:00'), '2026-10-09T17:16:00');
  assert.equal(dateText('invalid timestamp'), 'invalid timestamp');
  assert.equal(dateText('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(dateText(undefined), '');
});

function backendReport(overrides = {}) {
  return {
    ...legacyReport(),
    source: 'backend',
    status: 'partial',
    validation_status: 'partial',
    eligibility_status: 'unknown',
    run_id: 'synthetic-run-1',
    score: null,
    score_components: {
      resume_completeness: { label: '이력서 완성도', score: 0 },
      job_fit: { label: '직무 적합도', score: 72.4 },
      qualifications: { label: '지원 자격 충족도', score: null },
    },
    backend_report_text:
      '# 최종 평가\n\n**실제 평가 근거**\n\n| 항목 | 설명 |\n|---|---|\n| 기술 | SQL \\| Python<br>프로젝트 근거 |\n\n## 다음 단계\n\n- 경험을 구체화하세요.',
    ...overrides,
  };
}

test('backend report content and actual score pyramid share the studio frame without random previews', () => {
  const report = backendReport();
  const before = structuredClone(report);
  const markup = analysisReport({ role: '테스트 직무', company: '예시 기업', report });
  assert.match(markup, /result-layout--studio/);
  assert.match(markup, /data-report-frame/);
  assert.match(markup, /data-status-radar/);
  assert.match(markup, /data-section="backend-evaluation"/);
  assert.match(markup, /id="backend-evaluation"/);
  assert.match(markup, /분석 완료 · 일부 확인 필요/);
  assert.match(markup, /<dt>검증 상태<\/dt><dd>일부 확인 필요<\/dd>/);
  assert.match(markup, /<dt>지원 자격<\/dt><dd>확인 필요<\/dd>/);
  assert.doesNotMatch(markup, /synthetic-run-1|평가 ID/);
  assert.match(markup, /<h2>최종 평가<\/h2>/);
  assert.match(markup, /<strong>실제 평가 근거<\/strong>/);
  assert.match(markup, /<td>SQL \| Python<br>프로젝트 근거<\/td>/);
  assert.doesNotMatch(markup, /시연용 점수 · 실제 평가와 무관|점수 변화 시연 보기|예정 비중/);
  assert.match(markup, /4개 평가축 점수/);
  assert.match(markup, /백엔드가 반환한 네 평가축 점수를 사용/);
  assert.equal(analysisReport({ role: '테스트 직무', company: '예시 기업', report }), markup);
  assert.deepEqual(report, before);
});

test('nullable backend totals and components are unavailable while actual zero remains zero', () => {
  for (const score of [null, undefined, NaN, Infinity, '0']) {
    const markup = analysisReport({ report: backendReport({ score }) });
    assert.match(markup, /data-backend-total><dt>종합점수<\/dt><dd>제공되지 않음<\/dd>/);
    assert.match(markup, /<dt>이력서 완성도<\/dt><dd>0점<\/dd>/);
    assert.match(markup, /<dt>지원 자격 충족도<\/dt><dd>제공되지 않음<\/dd>/);
  }
  const zero = analysisReport({ report: backendReport({ score: 0 }) });
  assert.match(zero, /data-backend-total><dt>종합점수<\/dt><dd>0점<\/dd>/);
});

test('actual criteria show server weights, verdict, estimation and confidence without invented subcriteria', () => {
  const report = backendReport({
    backend_criteria: [
      {
        score: 65.1,
        verdict: 'unknown',
        confidence: 0.61,
        estimated: true,
        reasoning_summary: '확인된 운영 사례가 제한적입니다.',
        comparison_basis: '해당 공고의 운영 업무',
        validation_status: 'partial',
        issues: ['비교 자료 부족'],
        evaluation_criteria: {
          domain_code: 'practical_competitiveness',
          criterion_code: 'D1',
          name_ko: '업무 규모',
          weight: 0.35,
        },
      },
    ],
    matches: [{ requirement: '별도 자격 요건', status: 'excluded' }],
    priorities: [],
  });
  const markup = analysisReport({ report });
  assert.equal((markup.match(/class="evaluation-criterion"/g) || []).length, 1);
  for (const text of [
    '65점',
    '추정 평가',
    '판단 신뢰도 · 61%',
    '기준 비중 35%',
    '해당 공고의 운영 업무',
    '비교 자료 부족',
    '평가 대상에서 제외',
    '백엔드에서 제공한 개선 제안이 없습니다.',
  ])
    assert.ok(markup.includes(text), text);
  assert.doesNotMatch(markup, /예정 비중|점수 변화 시연|시연용 결과/);
});

test('component, total and criterion displays round without mutating backend precision', () => {
  const report = backendReport({
    score: 81.125,
    score_components: { job_fit: { label: '직무 적합도', score: 81.125 } },
    backend_criteria: [
      {
        score: 62.375,
        verdict: 'met',
        evaluation_criteria: { domain_code: 'job_fit', name_ko: '직무 근거' },
      },
    ],
  });
  const markup = analysisReport({ report });
  assert.match(markup, /81점/);
  assert.match(markup, /62점/);
  assert.doesNotMatch(markup, /81\.125점|62\.375점/);
  assert.equal(pyramidAxes(report)[1].score, 81.125);
});

test('backend metadata and missing Markdown never replace or break the studio report', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const report = backendReport({
    status: 'completed',
    validation_status: attack,
    eligibility_status: attack,
    run_id: attack,
    backend_report_text: '   ',
    score_components: { unsafe: { label: attack, score: null }, omitted: null },
  });
  const markup = analysisReport({ report });
  assert.match(markup, /백엔드 최종 보고서 본문이 제공되지 않았습니다/);
  assert.match(markup, /data-status-radar/);
  assert.ok(!markup.includes(attack));
  assert.match(markup, /&lt;img/);
});

test('backend Markdown supports its tables and code without accepting raw HTML or unsafe links', () => {
  const markup = renderMarkdown(
    [
      '# 보고서',
      '',
      '<script>alert(1)</script><img src=x onerror=alert(1)><br onload=alert(1)>',
      '',
      '[안전한 출처](https://example.com/?x=1&y=2) [실행](javascript:alert(1))',
      '',
      '```html',
      '<img src=x onerror=alert(1)>',
      '**강조되지 않는 코드**',
      '```',
      '',
      '1. 확인 항목',
      '2. 다음 항목',
      '',
      '\u0000999\u0000',
    ].join('\n'),
  );
  assert.match(markup, /<h2>보고서<\/h2>/);
  assert.match(markup, /href="https:\/\/example.com\/\?x=1&amp;y=2"/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.ok(!markup.includes('href="javascript:'));
  assert.ok(!markup.includes('<script>'));
  assert.ok(!markup.includes('<img'));
  assert.ok(!markup.includes('<br onload'));
  assert.match(markup, /<pre><code>&lt;img[^]*\*\*강조되지 않는 코드\*\*<\/code><\/pre>/);
  assert.match(markup, /<ol><li>확인 항목<\/li><li>다음 항목<\/li><\/ol>/);
  assert.ok(!markup.includes('undefined'));
});
