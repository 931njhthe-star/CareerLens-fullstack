import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractReportJobContext,
  reportJobContext,
} from '../../src/features/analysis/report-context.js';

test('report context reads evaluated posting metadata from the backend Markdown header', () => {
  const markdown = [
    '# 이력서·채용공고 매칭 보고서',
    '',
    '- 평가 ID: synthetic-run',
    '- 평가 기준일: 2026-10-12',
    '- 채용공고: RAG 개발자 채용',
    '- 기업: 예시 기업',
    '- 종합 매칭 점수: **75.0**',
    '',
    '## 세부 평가 결과',
    '- 채용공고: 근거에서 인용된 다른 공고',
    '- 기업: 근거에서 인용된 다른 회사',
  ].join('\r\n');
  assert.deepEqual(extractReportJobContext(markdown), {
    title: 'RAG 개발자 채용',
    company: '예시 기업',
    source: 'report',
  });
});

test('header metadata trims whitespace and optional emphasis while retaining the first value', () => {
  const context = extractReportJobContext(
    [
      '# 보고서',
      '* 채용공고 : **  데이터 분석가  **',
      '- 기업:   **예시 회사**  ',
      '- 채용공고: 나중에 나온 다른 공고',
      '- 기업: 나중에 나온 다른 회사',
    ].join('\n'),
  );
  assert.deepEqual(context, { title: '데이터 분석가', company: '예시 회사', source: 'report' });
});

test('quoted text and report sections cannot substitute for absent header metadata', () => {
  for (const section of ['## 근거', '### 인용', '###### 참고']) {
    const context = extractReportJobContext(
      [
        '# 보고서',
        '> - 채용공고: 인용된 공고',
        '> - 기업: 인용된 회사',
        '본문에 나온 기업: 문장 속 회사',
        section,
        '- 채용공고: 본문 속 공고',
        '- 기업: 본문 속 회사',
      ].join('\n'),
    );
    assert.deepEqual(context, { title: '', company: '', source: 'report' });
  }
});

test('code fences are ignored without treating a heading inside them as the end of metadata', () => {
  for (const marker of ['```', '~~~']) {
    const context = extractReportJobContext(
      [
        '# 보고서',
        `${marker}markdown`,
        '## 코드 예시의 제목',
        '- 채용공고: 코드 속 공고',
        '- 기업: 코드 속 회사',
        marker,
        '- 채용공고: 실제 공고',
        '- 기업: 실제 회사',
        '## 분석',
      ].join('\n'),
    );
    assert.deepEqual(context, { title: '실제 공고', company: '실제 회사', source: 'report' });
  }
});

test('a shorter or nonclosing fence inside a longer code block cannot expose fake metadata', () => {
  for (const [opening, nested] of [
    ['````markdown', '```'],
    ['~~~~markdown', '~~~'],
    ['```markdown', '```example'],
  ]) {
    const closing = opening.startsWith('~~~~')
      ? '~~~~'
      : opening.startsWith('````')
        ? '````'
        : '```';
    const context = extractReportJobContext(
      [
        '# 보고서',
        opening,
        nested,
        '- 채용공고: 코드 속 가짜 공고',
        '- 기업: 코드 속 가짜 회사',
        closing,
        '- 채용공고: 실제 공고',
        '- 기업: 실제 회사',
      ].join('\n'),
    );
    assert.deepEqual(context, { title: '실제 공고', company: '실제 회사', source: 'report' });
  }
});

test('an unclosed code fence leaves subsequent metadata unavailable', () => {
  assert.deepEqual(
    extractReportJobContext(
      '# 보고서\n```markdown\n- 채용공고: 코드 속 공고\n- 기업: 코드 속 회사',
    ),
    {
      title: '',
      company: '',
      source: 'report',
    },
  );
});

test('empty or unsupported metadata remains explicitly unavailable', () => {
  for (const markdown of [
    '',
    undefined,
    null,
    '# 보고서\n- 공고명: 다른 형식\n- 회사명: 다른 형식',
    '# 보고서\n- 채용공고: \n- 기업: ',
  ]) {
    assert.deepEqual(extractReportJobContext(markdown), {
      title: '',
      company: '',
      source: 'report',
    });
  }
});

test('metadata stays inert plain text for the view to escape once', () => {
  const title = '<img src=x onerror="alert(1)"> & 공고';
  const company = '<script>alert(2)</script> "기업"';
  const context = extractReportJobContext(`# 보고서\n- 채용공고: ${title}\n- 기업: ${company}`);
  assert.deepEqual(context, { title, company, source: 'report' });
  assert.equal(typeof context.title, 'string');
  assert.equal(typeof context.company, 'string');
});

test('stored job context uses valid saved fields and fills only missing fields from report metadata', () => {
  const report = Object.freeze({
    job_context: Object.freeze({ title: '  저장된 공고  ', company: '   ' }),
    backend_report_text: '# 보고서\n- 채용공고: Markdown 공고\n- 기업: Markdown 기업',
    selected_posting: Object.freeze({ title: '현재 공고', company: '현재 기업' }),
  });
  assert.deepEqual(reportJobContext(report), {
    title: '저장된 공고',
    company: 'Markdown 기업',
    source: 'report',
  });
  assert.equal(report.job_context.title, '  저장된 공고  ');
});

test('invalid stored fields and current workspace values cannot invent report context', () => {
  assert.deepEqual(
    reportJobContext({
      job_context: { title: 42, company: { name: '객체' } },
      backend_report_text: '# 보고서\n- 채용공고: 실제 공고\n- 기업: 실제 기업',
    }),
    { title: '실제 공고', company: '실제 기업', source: 'report' },
  );
  assert.deepEqual(
    reportJobContext({
      role: '현재 직무',
      company: '현재 회사',
      selected_posting: { title: '현재 공고' },
    }),
    { title: '', company: '', source: 'report' },
  );
  assert.deepEqual(reportJobContext(), { title: '', company: '', source: 'report' });
});
