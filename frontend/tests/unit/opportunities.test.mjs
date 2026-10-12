import test from 'node:test';
import assert from 'node:assert/strict';
import { guestResumePage, guestFileMetadata } from '../../src/features/resumes/guest.js';
import {
  opportunityRoute,
  opportunityPath,
  opportunityQuery,
} from '../../src/features/job-postings/opportunity-state.js';
import {
  opportunitiesPage,
  opportunityList,
  opportunityDetail,
} from '../../src/pages/opportunities.js';
import { analysisReport } from '../../src/features/analysis/report.js';
import { shell } from '../../src/shared/components/ui.js';

test('file choice validates metadata while guest attachment UI never previews the resume', () => {
  const file = {
    name: '경험.pdf',
    size: 1000,
    text() {
      throw new Error('must not read');
    },
    arrayBuffer() {
      throw new Error('must not read');
    },
  };
  assert.equal(guestFileMetadata(file), file.name);
  assert.equal(guestFileMetadata({ name: '경험.md', size: 1000 }), '경험.md');
  assert.throws(() => guestFileMetadata({ name: 'large.pdf', size: 11000000 }));
  assert.throws(() => guestFileMetadata({ name: 'script.html', size: 100 }));
  const html = guestResumePage('<script>private</script>.pdf');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('id="upload-form"'));
  assert.ok(!html.includes('<textarea'));
  assert.ok(!html.includes('resume-examples'));
  assert.ok(html.includes('id="guest-upload-form"'));
  assert.ok(shell(html, { draft: { guest: true } }).includes('채용공고'));
});

test('role filters, selected posting and pagination round-trip without uploading resume data', () => {
  const route = opportunityRoute(
    '#/' + opportunityPath({ role_id: 'custom', label: 'UX & 데이터' }, 2, '공고/?&'),
  );
  assert.deepEqual(route, {
    role_id: 'custom',
    label: 'UX & 데이터',
    page: 2,
    selected: '공고/?&',
  });
  const query = new URLSearchParams(opportunityQuery(route).split('?')[1]);
  assert.equal(query.get('role'), 'UX & 데이터');
  assert.equal(query.get('page'), '2');
  assert.equal(query.has('resume_text'), false);
  assert.equal(opportunityRoute('#/questions'), null);
});

test('master-detail content escapes DB fields and guests may analyze before result login', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const posting = {
    id: attack,
    company: attack,
    role: attack,
    location: attack,
    experience_level: attack,
    employment_type: attack,
    description: attack,
    skills: [attack],
    source_type: 'example',
  };
  for (const html of [opportunityList([posting], posting.id), opportunityDetail(posting, null)]) {
    assert.ok(!html.includes(attack));
    assert.ok(html.includes('&lt;img'));
  }
  assert.ok(opportunityDetail(posting, null).includes('시연 결과 확인'));
  assert.ok(opportunityDetail(posting, null).includes('실제 백엔드 계정'));
  assert.ok(opportunityDetail(posting, { id: 'test' }).includes('시연 결과 확인'));
  assert.ok(opportunitiesPage().includes('opportunity-list'));
  assert.ok(opportunitiesPage().includes('opportunity-detail'));
});

test('source Markdown is rendered in the posting detail with HTML escaped', () => {
  const posting = {
    id: 'backup-001',
    company: '예시 회사',
    role: '예시 직무',
    location: '서울',
    experience_level: '신입',
    employment_type: '정규직',
    skills: [],
    description: '',
    source_type: 'example',
    source_markdown: '# 원본 공고\n\n- **담당 업무:** <script>alert(1)</script>',
  };
  const html = opportunityDetail(posting, null);
  assert.ok(html.includes('<h2>원본 공고</h2>'));
  assert.ok(html.includes('<strong>담당 업무:</strong>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
});

test('backend-registered posting offers agent evaluation while a demo account stays clearly mocked', () => {
  const posting = {
    id: 'job-uuid',
    company: '예시 회사',
    role: '예시 직무',
    location: '서울',
    experience_level: '신입',
    employment_type: '정규직',
    skills: [],
    description: '공고 설명',
    source_type: 'backend',
  };
  const memberMarkup = opportunityDetail(posting, { id: 'member-1' });
  assert.ok(memberMarkup.includes('에이전트 평가 결과 확인'));
  assert.ok(memberMarkup.includes('백엔드에 저장된 이력서'));
  const demoMarkup = opportunityDetail(posting, { id: 'demo-user', demo: true });
  assert.ok(demoMarkup.includes('시연 결과 확인'));
  assert.ok(demoMarkup.includes('실제 에이전트 평가에는 실제 백엔드 계정'));
});

test('Markdown report renderer supports headings, tables, safe links, and escaped HTML', () => {
  const posting = {
    id: 'backup-001',
    company: '예시 회사',
    role: '예시 직무',
    location: '서울',
    experience_level: '신입',
    employment_type: '정규직',
    skills: [],
    description: '',
    source_type: 'example',
    source_markdown:
      '# 결과\n\n| 기준 | 점수 |\n| --- | --- |\n| 역량 | **80점** |\n\n[출처](https://finance.yahoo.com) <img src=x onerror=alert(1)>',
  };
  const html = opportunityDetail(posting, null);
  assert.ok(html.includes('<h2>결과</h2>'));
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<strong>80점</strong>'));
  assert.ok(html.includes('href="https://finance.yahoo.com/"'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
});

test('report is view-only and clearly labels the four demonstration axes', () => {
  const html = analysisReport({ report: { score: 50, criteria: [], matches: [] } });
  assert.ok(!html.includes('print-report'));
  assert.ok(!html.includes('리포트 인쇄'));
  for (const label of ['이력서 완성도', '직무 적합도', '지원 자격 충족도', '실무 경쟁력'])
    assert.ok(html.includes(label));
  assert.ok(html.includes('시연용 점수 · 실제 평가와 무관'));
});
