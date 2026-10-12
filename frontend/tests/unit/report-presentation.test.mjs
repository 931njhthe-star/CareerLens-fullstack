import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backendStatusLabel,
  displayReportMarkdown,
  displayReportSummary,
} from '../../src/features/analysis/report-presentation.js';
import { analysisReport } from '../../src/features/analysis/report.js';

test('backend enum display labels are Korean while unknown values are preserved', () => {
  for (const [value, label] of Object.entries({
    met: '충족',
    not_met: '미충족',
    unknown: '확인 필요',
    not_applicable: '평가 제외',
    partial: '일부 확인 필요',
    passed: '검증 통과',
    needs_review: '추가 검토 필요',
    completed: '완료',
    failed: '실패',
    hold: '보류',
  }))
    assert.equal(backendStatusLabel(value), label);
  assert.equal(backendStatusLabel('future_status'), 'future_status');
  assert.equal(backendStatusLabel('met requirements'), 'met requirements');
  assert.equal(backendStatusLabel(null), '제공되지 않음');
});

test('actual backend Markdown fields and exact verdict cells localize without changing evidence', () => {
  const markdown = [
    '# 이력서·채용공고 매칭 보고서',
    '- 지원 자격 상태: unknown',
    '- 검증 상태: partial',
    '',
    '## 하위 항목 평가',
    '| 항목 | 점수 | 판정 | 신뢰도 | 설명 |',
    '|---|---:|---|---:|---|',
    '| 경력 | 80.0 | met | 0.95 | SQL \\| Python<br>확인된 경험 |',
    '| 학력 | 0.0 | not_met | 0.85 | 명시 요건 미충족 |',
    '| 기술 | 확인 필요 | unknown | 0.30 | unknown 값은 근거 원문 |',
    '| 별도 조건 | 평가 제외 | not_applicable | 1.00 | 조건 없음 |',
  ].join('\n');
  const displayed = displayReportMarkdown(markdown);
  assert.match(displayed, /지원 자격 상태: 확인 필요/);
  assert.match(displayed, /검증 상태: 일부 확인 필요/);
  for (const label of ['충족', '미충족', '확인 필요', '평가 제외']) {
    assert.ok(displayed.includes(`| ${label} |`));
  }
  assert.ok(displayed.includes('SQL \\| Python<br>확인된 경험'));
  assert.ok(displayed.includes('unknown 값은 근거 원문'));
  assert.ok(markdown.includes('| not_met |'), 'stored source remains raw');
});

test('localization preserves arbitrary prose, code fences, inline code, links and URL paths', () => {
  const preserved = [
    'The requirements were met; unknown is a useful enum and partial is a field.',
    '판정: met requirements',
    '기업: met',
    '인용: `검증 상태: partial.`',
    '[검증 상태: partial.](https://example.com/not_met?status=unknown)',
    'https://example.com/unknown?verdict=not_met',
    '```md',
    '## 예상 면접 질문',
    '- 지원 자격 상태: not_met',
    '| 상태 | 판정 |',
    '|---|---|',
    '| partial | met |',
    '```',
    '~~~text',
    '검증 상태: partial',
    '~~~',
    '',
  ].join('\r\n');
  assert.equal(displayReportMarkdown(preserved), preserved);
});

test('only exact enum table values are localized, including styled values and escaped pipes', () => {
  const displayed = displayReportMarkdown(
    [
      '| 판정 | 근거 |',
      '|---|---|',
      '| **met** | user_met_unknown |',
      '| `not_met` | partial result |',
      '| __unknown__ | SQL \\| Python |',
      '| future_status | [met](https://example.com/met) |',
    ].join('\n'),
  );
  assert.ok(displayed.includes('| **충족** | user_met_unknown |'));
  assert.ok(displayed.includes('| `미충족` | partial result |'));
  assert.ok(displayed.includes('| __확인 필요__ | SQL \\| Python |'));
  assert.ok(displayed.includes('| future_status | [met](https://example.com/met) |'));
});

test('known question heading removes its subtree but preserves subsequent peer and parent sections', () => {
  const displayed = displayReportMarkdown(
    [
      '# 최종 보고서',
      '예상 면접 질문을 준비하는 일은 도움이 됩니다.',
      '## 예상 면접 질문',
      '- 숨길 질문',
      '### 질문별 근거',
      '숨길 하위 근거',
      '```md',
      '## 코드 속 가짜 경계',
      '```',
      '## 평가 근거와 개선 제안',
      '유지할 근거',
      '### 2. 다음 대화에서 나올 수 있는 질문',
      '숨길 다음 질문',
      '## 계산 방식',
      '유지할 계산 방식',
      '## 면접 질문을 위한 평가 근거',
      '이것은 별개의 제목과 내용',
    ].join('\n'),
  );
  assert.doesNotMatch(displayed, /숨길|코드 속 가짜 경계/);
  assert.ok(displayed.includes('예상 면접 질문을 준비하는 일은 도움이 됩니다.'));
  assert.ok(displayed.includes('## 평가 근거와 개선 제안\n유지할 근거'));
  assert.ok(displayed.includes('## 계산 방식\n유지할 계산 방식'));
  assert.ok(displayed.includes('## 면접 질문을 위한 평가 근거\n이것은 별개의 제목과 내용'));
});

test('legacy summary status fields localize without translating surrounding prose or sources', () => {
  assert.equal(displayReportSummary('검증 상태: partial.'), '검증 상태: 일부 확인 필요.');
  assert.equal(
    displayReportSummary(
      '백엔드 평가가 완료되었습니다. 검증 상태: partial. 지원 자격 상태: not_met.',
    ),
    '백엔드 평가가 완료되었습니다. 검증 상태: 일부 확인 필요. 지원 자격 상태: 미충족.',
  );
  assert.equal(displayReportSummary('unknown'), '확인 필요');
  assert.equal(displayReportSummary('partial 결과를 확인하세요.'), 'partial 결과를 확인하세요.');
  assert.equal(displayReportSummary('`검증 상태: partial.`'), '`검증 상태: partial.`');
});

function backendDraft(report = {}, draft = {}) {
  return {
    company: '현재 선택한 다른 기업',
    role: '현재 선택한 다른 직무',
    ...draft,
    report: {
      source: 'backend',
      status: 'partial',
      validation_status: 'partial',
      eligibility_status: 'not_met',
      summary: '검증 상태: partial.',
      backend_report_text: '# 보고서\n- 지원 자격 상태: not_met',
      questions: ['표시하지 않을 질문'],
      ...report,
    },
  };
}

test('report rendering hides questions, explains partial state and never mutates raw data', () => {
  const draft = backendDraft({
    backend_report_text:
      '# 보고서\n- 지원 자격 상태: not_met\n## 예상 면접 질문\n숨길 본문 질문\n## 계산 방식\n유지할 방식',
  });
  const before = structuredClone(draft);
  const markup = analysisReport(draft);
  assert.doesNotMatch(
    markup,
    /다음 대화에서 나올 수 있는 질문|예상 면접 질문|표시하지 않을 질문|숨길 본문 질문|id="interview"|data-section="interview"/,
  );
  assert.match(markup, /분석 완료 · 일부 확인 필요/);
  assert.match(markup, /분석은 완료되었습니다/);
  assert.match(markup, /종합점수가 제공되지 않았거나 일부 항목에 검증 참고사항/);
  assert.match(markup, /제공되지 않은 점수는 0점으로 처리하지 않습니다/);
  assert.match(markup, /검증 상태: 일부 확인 필요\./);
  assert.match(markup, /지원 자격 상태: 미충족/);
  assert.match(markup, /유지할 방식/);
  assert.deepEqual(draft, before);
});

test('backend report headings use evaluated context for both current and historical views', () => {
  for (const saved_report of [false, true]) {
    const markup = analysisReport(
      backendDraft(
        {
          job_context: {
            job_id: 'old-posting',
            title: '평가 당시 공고',
            company: '평가 당시 기업',
            source: 'report',
          },
        },
        { saved_report, analysis_mode: 'desired_role' },
      ),
    );
    assert.match(markup, /<h1>평가 당시 공고<\/h1>/);
    assert.match(markup, /<p>평가 당시 기업<\/p>/);
    assert.doesNotMatch(markup, /현재 선택한 다른|<p>희망 직무<\/p>/);
  }
});

test('legacy backend Markdown restores company and role after reload without current selection fallback', () => {
  const draft = backendDraft({
    backend_report_text:
      '# 이력서·채용공고 매칭 보고서\n- 채용공고: 백엔드 엔지니어\n- 기업: 과거 분석 기업\n## 하위 항목 평가\n내용',
  });
  const markup = analysisReport(draft);
  assert.match(markup, /<h1>백엔드 엔지니어<\/h1>/);
  assert.match(markup, /<p>과거 분석 기업<\/p>/);
  assert.doesNotMatch(markup, /현재 선택한 다른/);
});

test('missing or incomplete evaluated context has visible fallbacks and an icon, never unrelated company', () => {
  const missing = analysisReport(backendDraft());
  assert.match(missing, /<h1>대상 공고 정보 없음<\/h1>/);
  assert.match(missing, /<p>기업 정보 없음<\/p>/);
  assert.match(missing, /class="company-initial large">\s*<svg/);
  assert.doesNotMatch(missing, /현재 선택한 다른/);
  const titleOnly = analysisReport(backendDraft({ job_context: { title: '제목만 저장된 공고' } }));
  assert.match(titleOnly, /<h1>제목만 저장된 공고<\/h1>/);
  assert.match(titleOnly, /<p>기업 정보 없음<\/p>/);
  assert.doesNotMatch(titleOnly, /현재 선택한 다른/);
});

test('context and unknown enum values remain escaped in the rendered report', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const markup = analysisReport(
    backendDraft({
      job_context: { title: attack, company: attack },
      validation_status: attack,
      backend_report_text: `# 보고서\n\n| 판정 | 설명 |\n|---|---|\n| met | ${attack} |`,
    }),
  );
  assert.ok(!markup.includes(attack));
  assert.match(markup, /<td>충족<\/td>/);
  assert.match(markup, /&lt;img/);
});
