import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { jobListPage, jobDetailPage, postingEditorPage } from '../../src/pages/jobs.js';
import {
  catalogPath,
  catalogQuery,
  catalogReturnPath,
  catalogRoute,
  selectionNeedsConfirmation,
  withPostingSelection,
  safeSourceUrl,
  postingPayload,
} from '../../src/features/job-postings/catalog-state.js';
import {
  opportunityPath,
  opportunityRoute,
} from '../../src/features/job-postings/opportunity-state.js';
import { reportGuidance } from '../../src/features/analysis/guidance.js';
import { shell } from '../../src/shared/components/ui.js';

const posting = {
  id: 'example-python',
  company: '예시 기업',
  role: 'Python 개발자',
  description: '주요 업무 및 요건을 담은 가상 공고 본문',
  location: '서울',
  employment_type: '정규직',
  experience_level: '신입',
  skills: ['Python'],
  source_type: 'example',
  is_saved: false,
};

test('registered repository fixtures keep their fictional label without becoming private postings', () => {
  const fixture = { ...posting, id: 'registered-uuid', source_type: 'backend', is_example: true };
  const html = jobDetailPage(fixture, { id: 'member' });
  assert.ok(html.includes('가상 예시'));
  assert.ok(html.includes('실제 채용 중인 기업의 공고가 아닙니다.'));
  assert.ok(!html.includes('내가 입력한 공고 · 비공개'));
  assert.equal(html.includes('data-bookmark="registered-uuid"'), false);
  assert.match(html, /bookmark-button"\s+disabled aria-describedby="jobs-readonly-note"/);
  const registered = jobDetailPage({ ...fixture, is_example: false }, { id: 'member' });
  assert.ok(registered.includes('등록 공고'));
  assert.ok(!registered.includes('본인이 직접 입력한 비공개 공고'));
});

test('selecting a posting protects saved and unsaved job content and preserves unrelated edits', () => {
  const saved = {
    resume_text: '저장된 이력서',
    company: '이전 회사',
    role: '이전 직무',
    job_text: '저장된 공고',
  };
  const edits = {
    resume_text: '작성 중인 이력서',
    role: '작성 중인 지원 직무',
    answers: { work: '작성 중인 답변' },
  };
  assert.equal(selectionNeedsConfirmation(saved, edits, posting), true);
  assert.equal(selectionNeedsConfirmation({}, {}, posting), false);
  const selected = withPostingSelection(edits, posting);
  assert.equal(selected.resume_text, edits.resume_text);
  assert.deepEqual(selected.answers, edits.answers);
  assert.equal(selected.company, posting.company);
  assert.equal(selected.job_text, posting.description);
  assert.equal(selectionNeedsConfirmation(saved, selected, posting), false);
  assert.equal(saved.company, '이전 회사');
  assert.equal(edits.role, '작성 중인 지원 직무');
});

test('catalog filters survive route round trips, Unicode and pagination', () => {
  const query = catalogQuery(
    new URLSearchParams(
      'q=Python+%26+SQL&role_category=데이터+분석&location=서울&skill=C%2B%2B&saved=1&page=2&irrelevant=secret',
    ),
  );
  const route = catalogRoute(`#/jobs?${query}`);
  assert.equal(route.kind, 'list');
  assert.equal(route.query.get('q'), 'Python & SQL');
  assert.equal(route.query.get('skill'), 'C++');
  assert.equal(route.query.get('location'), '서울');
  assert.equal(route.query.get('role_category'), '데이터 분석');
  assert.equal(route.query.get('page'), '2');
  assert.equal(route.query.has('irrelevant'), false);
  for (const page of ['-1', 'NaN', '1.5'])
    assert.equal(catalogQuery(new URLSearchParams({ page })).get('page'), '1');
  assert.deepEqual(catalogRoute('#/jobs/new'), { kind: 'new' });
  assert.deepEqual(catalogRoute('#/jobs/example-python/edit'), {
    kind: 'edit',
    id: 'example-python',
  });
  assert.equal(catalogRoute('#/jobs/%zz'), null);
});

function linkForLabel(html, label) {
  const link = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].find(
    (match) => match[2].includes(label),
  );
  assert.ok(link, `Expected link: ${label}`);
  return link[1].replaceAll('&amp;', '&');
}

test('catalog restores role, scope, page and an off-page selected posting after detail navigation', () => {
  for (const scope of ['category', 'exact', 'all']) {
    const target = { role_id: 'custom', label: 'UX & 데이터', scope };
    const returnTo = opportunityPath(target, 4, 'selected-on-another-page');
    const query = catalogQuery(new URLSearchParams({ return_to: returnTo, q: 'Python', page: '2' }));
    const data = { items: [posting], total: 36, page: 2, page_size: 12 };
    const html = jobListPage(data, query, null);
    const returnLink = linkForLabel(html, '공고 선택으로 돌아가기');
    assert.deepEqual(opportunityRoute(returnLink), {
      ...target,
      page: 4,
      selected: 'selected-on-another-page',
    });
    const next = catalogRoute(linkForLabel(html, '다음')).query;
    assert.equal(next.get('page'), '3');
    assert.equal(next.get('q'), 'Python');
    assert.equal(next.get('return_to'), returnTo);
    const reset = catalogRoute(linkForLabel(html, '검색 초기화')).query;
    assert.equal(reset.get('page'), '1');
    assert.equal(reset.has('q'), false);
    assert.equal(reset.get('return_to'), returnTo);
    const detail = catalogRoute(linkForLabel(html, posting.role));
    assert.equal(detail.id, posting.id);
    const back = catalogRoute(linkForLabel(jobDetailPage(posting, null, detail.query), '← 공고 목록'));
    assert.equal(back.query.get('q'), 'Python');
    assert.equal(back.query.get('page'), '2');
    assert.equal(back.query.get('return_to'), returnTo);
    assert.equal(
      linkForLabel(jobListPage(data, back.query, null), '공고 선택으로 돌아가기'),
      returnLink,
    );
  }
});

test('catalog return targets accept only the local role workflow and normalize its query', () => {
  for (const returnTo of [
    'https://example.com/opportunities?role_id=backend',
    '//example.com/opportunities?role_id=backend',
    'javascript:alert(1)',
    '#/opportunities?role_id=backend',
    '/opportunities?role_id=backend',
    'jobs?role_id=backend',
    'opportunities/other?role_id=backend',
    'opportunities?role_id=',
    'opportunities?role_id=++',
    'opportunities?role_id=backend#fragment',
    'opportunities?role_id=backend?ignored=true',
    'opportunities?role_id=backend\n',
  ]) {
    assert.equal(catalogReturnPath(returnTo), '');
    const query = catalogQuery(new URLSearchParams({ return_to: returnTo }));
    assert.equal(query.has('return_to'), false);
    assert.equal(catalogPath('jobs', query), 'jobs');
    assert.equal(
      jobListPage({ items: [], total: 0, page: 1, page_size: 12 }, query, null).includes(
        '공고 선택으로 돌아가기',
      ),
      false,
    );
  }
  assert.deepEqual(
    opportunityRoute(
      '#/' + catalogReturnPath('opportunities?role_id=backend&scope=invalid&page=-2&selected=id&extra=discard'),
    ),
    { role_id: 'backend', label: '', scope: 'category', page: 1, selected: 'id' },
  );
  assert.equal(catalogReturnPath('opportunities?role_id=backend&extra=discard').includes('extra'), false);
});

test('catalog controller preserves return state on search while keeping it out of backend filters', async () => {
  const source = readFileSync(
    new URL('../../src/features/job-postings/catalog.js', import.meta.url),
    'utf8',
  )
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
    .replace(/^export /gm, '');
  const returnTo = opportunityPath({ role_id: 'backend', label: '백엔드', scope: 'all' }, 3, 'kept-id');
  const route = catalogRoute(
    `#/jobs?${new URLSearchParams({ return_to: returnTo, page: '2', saved: '1' })}`,
  );
  const requests = [];
  const navigations = [];
  const search = {
    listeners: new Map(),
    values: { q: 'SQL', location: '서울', page: '1' },
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
  };
  const main = { innerHTML: '', querySelectorAll: () => [] };
  const context = vm.createContext({
    URLSearchParams,
    AbortController,
    FormData: class {
      constructor(form) {
        return new URLSearchParams(form.values);
      }
    },
    document: { getElementById: (id) => ({ main, 'catalog-search': search })[id] || null },
    api: async (path) => {
      requests.push(path);
      return { items: [posting], total: 36, page: 2, page_size: 12 };
    },
    bindCounters() {},
    catalogPath,
    catalogQuery,
    jobListPage,
    route,
    navigate: (path) => navigations.push(path),
  });
  vm.runInContext(source, context);
  await vm.runInContext('bindCatalog({ route, user: null, navigate })', context);
  assert.equal(new URLSearchParams(requests[0].split('?')[1]).has('return_to'), false);
  assert.equal(new URLSearchParams(requests[0].split('?')[1]).has('saved'), false);
  search.listeners.get('submit')({ preventDefault() {}, currentTarget: search });
  const next = catalogRoute(`#/${navigations[0]}`).query;
  assert.equal(next.get('q'), 'SQL');
  assert.equal(next.get('location'), '서울');
  assert.equal(next.get('page'), '1');
  assert.equal(next.get('return_to'), returnTo);
});

test('confirming a job posting opens the flow popup before selection continues', async () => {
  const source = readFileSync(
    new URL('../../src/features/job-postings/catalog.js', import.meta.url),
    'utf8',
  )
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
    .replace(/^export /gm, '');
  const events = [];
  const button = {
    disabled: false,
    addEventListener(_type, listener) {
      this.listener = listener;
    },
  };
  const main = {
    set innerHTML(_value) {},
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    AbortController,
    URLSearchParams,
    document: {
      getElementById: (id) => id === 'main' ? main : id === 'select-posting' ? button : null,
    },
    window: { alert() {} },
    api: async () => ({ posting }),
    bindCounters() {},
    jobDetailPage: () => '<button id="select-posting"></button>',
    openFlowViewer: () => {
      events.push('popup');
      return {};
    },
    options: {
      route: { kind: 'detail', id: posting.id, query: new URLSearchParams() },
      user: { id: 'member' },
      onSelect: async () => events.push('select'),
    },
  });
  vm.runInContext(source, context);
  await vm.runInContext('bindCatalog(options)', context);
  await button.listener({ currentTarget: button });

  assert.deepEqual(events, ['popup', 'select']);
});

test('job pages render untrusted API values as text and reject executable source URLs', () => {
  const payload = '<img src=x onerror="alert(1)">';
  const dangerous = {
    ...posting,
    company: payload,
    role: payload,
    location: payload,
    skills: [payload],
    description: payload,
    source_url: 'javascript:alert(1)',
  };
  const views = [
    jobListPage(
      { items: [dangerous], total: 1, page: 1, page_size: 12, filters: { locations: [payload] } },
      new URLSearchParams({ q: payload }),
      null,
    ),
    jobDetailPage(dangerous, null),
    postingEditorPage(dangerous, posting.id, undefined, { demo: true }),
  ];
  for (const markup of views) {
    assert.equal(markup.includes(payload), false);
    assert.ok(markup.includes('&lt;img'));
    assert.equal(markup.includes('href="javascript:'), false);
  }
  assert.equal(safeSourceUrl('https://user:pass@example.com'), '');
  assert.equal(safeSourceUrl('data:text/html,hello'), '');
  assert.equal(safeSourceUrl('/local-relative'), '');
  assert.equal(safeSourceUrl('https://example.com/jobs'), 'https://example.com/jobs');
});

test('catalog offers actual role categories and retains an empty selected category for recovery', () => {
  const html = jobListPage(
    { items: [], total: 0, page: 1, page_size: 12, filters: { roles: ['데이터 분석', '서비스 기획'] } },
    new URLSearchParams({ role_category: '데이터 분석' }),
    null,
  );
  assert.match(html, /label for="filter-role_category">직무 분류/);
  assert.match(html, /value="데이터 분석"\s+selected/);
  assert.match(html, /value="서비스 기획"/);
  assert.match(html, /조건에 맞는 공고가 없어요/);
  assert.match(html, /전체 공고 보기/);
});

test('public catalogue offers login, real-source disclaimers and demo-only editing', () => {
  const publicShell = shell('jobs', { page: 'jobs' });
  assert.ok(publicShell.includes('href="#/email"'));
  assert.equal(publicShell.includes('id="logout"'), false);
  assert.equal(publicShell.includes('class="steps"'), true);
  const example = jobDetailPage(
    { ...posting, source_url: 'https://example.com/real-role' },
    { id: 'owner' },
  );
  assert.ok(example.includes('참고한 실제 직무 자료'));
  assert.ok(example.includes('직무 참고 출처'));
  assert.equal(example.includes('id="delete-posting"'), false);
  assert.equal(
    jobDetailPage(
      { ...posting, source_type: 'manual', is_owner: false },
      { id: 'someone' },
    ).includes('id="delete-posting"'),
    false,
  );
  assert.equal(
    jobDetailPage({ ...posting, source_type: 'manual', is_owner: true }, { id: 'owner' }).includes(
      'id="delete-posting"',
    ),
    false,
  );
  assert.ok(
    jobDetailPage({ ...posting, source_type: 'mock' }, { id: 'demo', demo: true }).includes(
      'id="delete-posting"',
    ),
  );
});

test('real accounts and guests see disabled unsupported writes, including stale saved data', () => {
  const local = { ...posting, source_type: 'mock', is_owner: true, is_saved: true };
  for (const user of [null, { id: 'member' }, { id: 'member', demo: 'true' }]) {
    const list = jobListPage(
      { items: [local], total: 1, page: 1, page_size: 12 },
      new URLSearchParams({ saved: '1' }),
      user,
    );
    const detail = jobDetailPage(local, user);
    const editor = postingEditorPage(local, local.id, undefined, user);
    for (const html of [list, detail, editor]) {
      assert.ok(html.includes('백엔드 연동 준비 중'));
      assert.equal(html.includes('data-bookmark='), false);
      assert.equal(html.includes('id="delete-posting"'), false);
      assert.equal(html.includes('id="posting-form"'), false);
      assert.equal(html.includes('시연 저장됨'), false);
    }
    assert.equal(list.includes('href="#/jobs/new'), false);
    assert.match(list, /name="saved"\s+value="1"\s+disabled/);
    assert.equal(detail.includes('/edit"'), false);
    assert.ok(detail.includes('id="select-posting"'));
    if (!user) assert.ok(list.includes('가상 예시 공고로 로그인 전에 모의지원 분석을 진행합니다.'));
  }
});

test('explicit demo retains tab-only posting and bookmark controls', () => {
  const user = { id: 'demo', demo: true };
  const local = { ...posting, source_type: 'mock', is_saved: true };
  const list = jobListPage(
    { items: [local], total: 1, page: 1, page_size: 12 },
    new URLSearchParams({ saved: '1' }),
    user,
  );
  const detail = jobDetailPage(local, user);
  const editor = postingEditorPage(local, local.id, undefined, user);
  assert.ok(list.includes('href="#/jobs/new"'));
  assert.ok(list.includes('시연 저장 공고만'));
  assert.match(list, /name="saved"\s+value="1"\s+checked/);
  for (const html of [list, detail]) {
    assert.ok(html.includes(`data-bookmark="${posting.id}"`));
    assert.ok(html.includes('시연 저장됨'));
    assert.ok(html.includes('이 탭에만'));
    assert.equal(html.includes('백엔드 연동 준비 중'), false);
  }
  assert.ok(detail.includes(`/jobs/${posting.id}/edit`));
  assert.ok(detail.includes('id="delete-posting"'));
  assert.ok(editor.includes('id="posting-form"'));
  assert.ok(editor.includes('실제 계정이나 서버에는 저장되지 않습니다.'));
});

test('unsupported direct editor routes render the pending state without reading or writing postings', async () => {
  const source = readFileSync(
    new URL('../../src/features/job-postings/catalog.js', import.meta.url),
    'utf8',
  )
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
    .replace(/^export /gm, '');
  for (const user of [null, { id: 'member' }]) {
    for (const route of [{ kind: 'new' }, { kind: 'edit', id: posting.id }]) {
      const main = { innerHTML: '' };
      const requests = [];
      const context = vm.createContext({
        AbortController,
        document: { getElementById: () => main },
        api: async (...args) => requests.push(args),
        postingEditorPage,
        user,
        route,
      });
      vm.runInContext(source, context);
      await vm.runInContext('bindCatalog({ route, user })', context);
      assert.equal(requests.length, 0);
      assert.ok(main.innerHTML.includes('백엔드 연동 준비 중'));
      assert.equal(main.innerHTML.includes('id="posting-form"'), false);
    }
  }
});

test('posting form serializes comma-separated unique skills with Unicode intact', () => {
  const form = new URLSearchParams({
    company: '가상 기업',
    skills: 'Python, SQL, Python, 데이터 분석, ,',
    description: '공고 본문',
  });
  const payload = postingPayload(form);
  assert.deepEqual(payload.skills, ['Python', 'SQL', '데이터 분석']);
  assert.equal(payload.company, '가상 기업');
});

test('guidance distinguishes rule analysis, reference guidance and optional AI output safely', () => {
  const payload = '<script>alert(1)</script>';
  const rules = reportGuidance({
    agent: { fallback_used: false },
    reference_guidance: [{ title: payload, text: payload, source: payload }],
  });
  assert.ok(rules.includes('이력서의 경험과 근거를 살펴보고'));
  assert.equal(rules.includes('AI 보완 제안'), false);
  assert.equal(rules.includes(payload), false);
  const ai = reportGuidance({
    agent: {},
    ai_coaching: {
      summary: payload,
      recommendations: [{ text: payload, evidence_quote: payload }],
    },
  });
  assert.ok(ai.includes('AI 보완 제안'));
  assert.equal(ai.includes(payload), false);
  assert.equal(reportGuidance({}), '');
});
