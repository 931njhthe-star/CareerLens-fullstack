import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisReport } from '../../src/features/analysis/report.js';
import { workspacePage } from '../../src/pages/workspace.js';
import { roleChoicesMarkup } from '../../src/features/job-postings/job.js';

function reportWithMatching(matching) {
  return analysisReport({
    company: '테스트 기업',
    role: '테스트 직무',
    report: { demo: true, score: 70, verdict: '결과', summary: '요약', job_matches: matching },
  });
}

test('existing reports no longer mount the eye or display obsolete job connection counts', () => {
  const markup = reportWithMatching({
    total_jobs: 60,
    matched_count: 27,
    threshold: 60,
    items: [],
  });
  assert.ok(!markup.includes('data-matching-eye'));
  assert.ok(!markup.includes('data-analysis-eye'));
  assert.ok(!markup.includes('60개 공고 중 27개'));
  assert.ok(!markup.includes('60점 이상'));
  assert.equal((markup.match(/data-status-radar(?:\s|>)/g) || []).length, 1);
  assert.ok(markup.includes('data-preview-improvement'));
  assert.doesNotMatch(markup, /evaluation-preview-scores|improvement-preview__score/);
  assert.doesNotMatch(markup, /이력서 보완하기|href="#\/resume"/);
});

test('retained matching metadata never enters the new report surface', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const markup = reportWithMatching({
    total_jobs: attack,
    matched_count: attack,
    threshold: attack,
    method: attack,
    items: [{ id: attack, company: attack, role: attack, location: attack }],
  });
  assert.ok(!markup.includes(attack));
  assert.ok(!markup.includes('onerror'));
  assert.ok(!markup.includes('공고 연결'));
});

test('legacy reports without matching metadata remain readable without an unavailable graphic', () => {
  const markup = reportWithMatching(undefined);
  assert.ok(markup.includes('테스트 기업'));
  assert.ok(markup.includes('테스트 직무'));
  assert.ok(!markup.includes('준비도 70점'));
  assert.ok(markup.includes('시연용 점수 · 실제 평가와 무관'));
  assert.ok(!markup.includes('공고 연결 정보를 불러오지 못했습니다'));
  assert.ok(!markup.includes('undefined'));
});

test('desired-role report uses role context and keeps actual status criteria', () => {
  const markup = analysisReport({
    analysis_mode: 'desired_role',
    company: '표시하면 안 되는 과거 기업',
    role: '백엔드 개발자',
    report: {
      demo: true,
      score: 50,
      criteria: [
        { label: '직무 근거', score: 35, max_score: 70 },
        { label: '수행 맥락', score: 10, max_score: 20 },
        { label: '결과·규모', score: 5, max_score: 10 },
      ],
      job_matches: { total_jobs: 600, matched_count: 110 },
    },
  });
  assert.equal((markup.match(/data-status-radar(?:\s|>)/g) || []).length, 1);
  assert.ok(markup.indexOf('data-status-radar') < markup.indexOf('report-hero-copy'));
  assert.ok(markup.includes('시연용 점수 · 실제 평가와 무관'));
  assert.ok(!markup.includes('일반 요소'));
  assert.ok(markup.includes('4개 평가축 시연'));
  assert.ok(!markup.includes('배점과 평가 근거'));
  assert.ok(!markup.includes('준비도 50점'));
  assert.ok(markup.includes('예정 평가 항목'));
  assert.ok(markup.includes('직무별 근거'));
  assert.ok(!markup.includes('과거 기업'));
  assert.ok(!markup.includes('data-matching-eye'));
});

test('studio report preserves account content and section navigation inside one report frame', () => {
  const markup = analysisReport({
    company: '실제 선택한 기업',
    role: '선택한 데이터 직무',
    report: {
      summary: '서버에서 받은 요약입니다.',
      matches: [
        {
          status: 'missing',
          requirement: '데이터 처리 경험',
          evidence_items: [{ excerpt: '입력 이력서의 근거', source_label: '프로젝트 원문' }],
        },
      ],
      strengths: ['서버 강점'],
      gaps: ['서버 부족 근거'],
      priorities: [{ title: '서버 보완 제목', detail: '서버 보완 설명' }],
      questions: ['서버 면접 질문'],
    },
  });
  assert.equal((markup.match(/\bdata-report-frame\b/g) || []).length, 1);
  assert.ok(markup.includes('result-layout--studio'));
  assert.ok(markup.includes('report-section-nav'));
  assert.doesNotMatch(markup, /class="report-sidebar"|김하늘|라이트웨이브|금색|붉은색/);
  assert.match(markup, /aria-controls="saved-report-sidebar"/);
  for (const section of ['overview', 'readiness', 'evidence', 'priorities']) {
    assert.ok(markup.includes(`data-section="${section}"`));
    assert.ok(markup.includes(`id="${section}"`));
  }
  for (const content of [
    '실제 선택한 기업',
    '선택한 데이터 직무',
    '서버에서 받은 요약입니다.',
    '데이터 처리 경험',
    '입력 이력서의 근거',
    '프로젝트 원문',
    '근거 부족',
    '서버 강점',
    '서버 부족 근거',
    '서버 보완 제목',
    '서버 보완 설명',
  ])
    assert.ok(markup.includes(content), `Missing report content: ${content}`);
  assert.doesNotMatch(markup, /서버 면접 질문|id="interview"|data-section="interview"/);
  assert.doesNotMatch(markup, /이력서 보완하기|download=|window\.print|evaluation-preview-scores/);
});

test('workspace views cannot mount the removed question form or preparation screen', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const draft = {
    role: attack,
    resume_text: '이력서',
    analysis_mode: 'desired_role',
    career_target: { role_id: 'custom', label: attack },
    report: { score: 70, summary: '결과', verdict: '완료' },
  };
  for (const page of ['resume', 'desired-role', 'questions', 'preparing', 'result']) {
    const markup = workspacePage(page, draft, []);
    assert.doesNotMatch(
      markup,
      /id="analysis-form"|data-preparation-status|data-analysis-eye|data-report-eye/,
    );
    assert.ok(!markup.includes(attack));
  }
});

test('role choices escape provider-supplied labels, identifiers and descriptions', () => {
  const attack = '"><script>alert(1)</script>';
  const markup = roleChoicesMarkup([{ id: attack, label: attack, description: attack }], attack);
  assert.ok(!markup.includes('<script>'));
  assert.ok(markup.includes('data-description="&quot;&gt;&lt;script&gt;'));
  assert.ok(markup.includes(' selected>'));
});
