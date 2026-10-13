import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { publicErrorMessage } from '../../src/shared/api/error-messages.js';
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
  opportunityCountLabel,
} from '../../src/pages/opportunities.js';
import { analysisReport } from '../../src/features/analysis/report.js';
import { shell, escapeHtml } from '../../src/shared/components/ui.js';
import { createFlowStore } from '../../src/features/activity-flow/events.js';

test('file choice validates metadata while guest attachment UI never previews the resume', () => {
  const file = {
    name: '경험.md',
    size: 1000,
    text() {
      throw new Error('must not read');
    },
    arrayBuffer() {
      throw new Error('must not read');
    },
  };
  assert.equal(guestFileMetadata(file), file.name);
  assert.throws(() => guestFileMetadata({ name: 'large.md', size: 11000000 }));
  assert.throws(() => guestFileMetadata({ name: 'script.html', size: 100 }));
  const html = guestResumePage('<script>private</script>.md');
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
    scope: 'category',
    page: 2,
    selected: '공고/?&',
  });
  const query = new URLSearchParams(opportunityQuery(route).split('?')[1]);
  assert.equal(query.get('role'), 'UX & 데이터');
  assert.equal(query.get('role_scope'), 'category');
  assert.equal(query.get('page'), '2');
  assert.equal(query.has('resume_text'), false);
  assert.equal(opportunityRoute('#/questions'), null);
});

test('scope survives selection, pagination and reload while invalid values default to category', () => {
  for (const scope of ['category', 'exact', 'all']) {
    const target = { role_id: 'serving', label: 'AI 모델 서빙 최적화 엔지니어', scope };
    const selected = opportunityRoute(`#/${opportunityPath(target, 3, 'registered-uuid')}`);
    assert.equal(selected.scope, scope);
    assert.equal(selected.selected, 'registered-uuid');
    const next = opportunityRoute(`#/${opportunityPath(selected, 4)}`);
    assert.equal(next.scope, scope);
    assert.equal(next.page, 4);
    assert.equal(next.selected, '');
    const request = new URLSearchParams(opportunityQuery(next).split('?')[1]);
    assert.equal(request.get('role_scope'), scope);
    assert.equal(request.get('role_id'), target.role_id);
  }
  for (const value of ['', 'unknown', 'ALL', '<script>']) {
    const route = opportunityRoute(`#/opportunities?scope=${encodeURIComponent(value)}`);
    assert.equal(route.scope, 'category');
    const query = new URLSearchParams(opportunityQuery({ ...route, scope: value }).split('?')[1]);
    assert.equal(query.get('role_scope'), 'category');
  }
});

test('scope counts explain the source classification and custom role fallback', () => {
  const category = {
    total: 11,
    available_total: 100,
    role_category: '플랫폼·서빙',
    role_scope: 'category',
  };
  assert.equal(
    opportunityCountLabel(category, { scope: 'category' }),
    '전체 100개 중 11개 공고 · 플랫폼·서빙 분류',
  );
  assert.equal(
    opportunityCountLabel({ ...category, total: 1 }, { scope: 'exact' }),
    '전체 100개 중 1개 공고 · 선택한 직무명만',
  );
  assert.equal(
    opportunityCountLabel({ ...category, total: 100 }, { scope: 'all' }),
    '전체 100개 공고',
  );
  assert.equal(
    opportunityCountLabel(
      { ...category, total: 100, role_scope: 'all', role_category: '' },
      { scope: 'category', role_id: 'legacy-role' },
    ),
    '전체 100개 공고 · 분류 정보가 없어 전체 표시',
  );
  const fallback = { ...category, total: 2, role_scope: 'exact', role_category: '' };
  assert.equal(
    opportunityCountLabel(fallback, { scope: 'category', role_id: 'custom' }),
    '전체 100개 중 2개 공고 · 입력 직무 기준 · 분류 정보 없음',
  );
  assert.equal(
    opportunityCountLabel(fallback, { scope: 'category', role_id: 'legacy-role' }),
    '전체 100개 중 2개 공고 · 선택한 직무명만 · 분류 정보 없음',
  );
});

const opportunityController = readFileSync(
  new URL('../../src/features/job-postings/opportunities.js', import.meta.url),
  'utf8',
)
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace('export function bindOpportunities', 'function bindOpportunities');

const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function postingFixture(id) {
  return {
    id,
    role: `직무 ${id}`,
    company: '가상 기업',
    description: `${id} 공고 본문`,
    skills: [],
  };
}

function listResult(page) {
  return {
    items: [postingFixture(`page-${page}-first`), postingFixture(`page-${page}-second`)],
    total: 100,
    available_total: 100,
    page_size: 20,
    role_category: '플랫폼·서빙',
    role_scope: 'category',
  };
}

// Exercise production event handlers and requests, including DOM identity when
// detail markup is replaced. No real backend or evaluation request is made.
async function opportunityFixture({ selected = '', listRequest, detailRequest } = {}) {
  const flow = createFlowStore();
  const elements = new Map();
  class Element {
    constructor(id = '') {
      this.id = id;
      this.listeners = new Map();
      this.attributes = new Map();
      this.children = [];
      this.rows = [];
      this.value = '';
      this.isConnected = true;
      this.disabled = false;
      this.scrollTop = 0;
      this.writes = 0;
      this.dataset = {};
      this.content = '';
      this.style = { setProperty() {}, removeProperty() {} };
    }
    set innerHTML(value) {
      this.writes += 1;
      this.content = value;
      for (const child of this.children) {
        child.isConnected = false;
        elements.delete(child.id);
      }
      this.children = [...value.matchAll(/\bid="([^"]+)"/g)].map((match) => {
        const child = new Element(match[1]);
        elements.set(child.id, child);
        return child;
      });
      this.rows = [
        ...value.matchAll(/data-posting-id="([^"]+)"[\s\S]*?aria-current="([^"]+)"/g),
      ].map((match) => {
        const row = new Element();
        row.dataset.postingId = match[1];
        row.setAttribute('aria-current', match[2]);
        return row;
      });
    }
    get innerHTML() {
      return this.content;
    }
    set textContent(value) {
      this.innerHTML = value;
    }
    get textContent() {
      return this.content;
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      return this.attributes.get(name);
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
    querySelectorAll(selector) {
      return selector === '[data-posting-id]' ? this.rows : [];
    }
    querySelector() {
      return null;
    }
    closest() {
      return container;
    }
    getBoundingClientRect() {
      return { top: 200, bottom: 800, height: 600, width: 1000 };
    }
    addEventListener(type, callback, options = {}) {
      this.listeners.set(type, { callback, options });
    }
    focus() {
      this.focused = true;
    }
    dispatch(type, event = {}) {
      const listener = this.listeners.get(type);
      if (listener && !listener.options.signal?.aborted) return listener.callback(event);
    }
  }
  const container = new Element('opportunities');
  for (const id of [
    'opportunity-list',
    'opportunity-detail',
    'opportunity-count',
    'opportunity-pagination',
    'opportunity-scope',
    'opportunity-role',
    'opportunity-catalog',
    'opportunity-list-status',
    'opportunities-panel',
    'opportunity-list-heading',
  ])
    elements.set(id, new Element(id));
  const route = { role_id: 'serving', label: '서빙 직무', scope: 'category', page: 3, selected };
  const navigations = [];
  const requests = [];
  const evaluations = [];
  const errors = [];
  const popupEvents = [];
  let selectedUrl = `#/${opportunityPath(route, route.page, selected)}`;
  const context = vm.createContext({
    openFlowViewer: () => {
      popupEvents.push('popup');
      return {};
    },
    recordFlowEvent: flow.record,
    publicErrorMessage,
    AbortController,
    URLSearchParams,
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelector: () => container,
      documentElement: { clientHeight: 900 },
    },
    window: { innerHeight: 900, addEventListener() {}, removeEventListener() {} },
    history: { replaceState: (_state, _unused, url) => (selectedUrl = url) },
    opportunityList,
    opportunityDetail,
    opportunityCountLabel,
    opportunityPath,
    opportunityQuery,
    e: escapeHtml,
    api: async (path, options = {}) => {
      const request = { path, signal: options.signal };
      requests.push(request);
      if (path === '/career-roles') return { items: [{ id: 'serving', label: route.label }] };
      if (path.includes('?')) {
        const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
        return listRequest ? listRequest(page, request) : listResult(page);
      }
      const id = decodeURIComponent(path.split('/').at(-1));
      return detailRequest ? detailRequest(id, request) : { posting: postingFixture(id) };
    },
    options: {
      route,
      user: { id: 'member' },
      navigate: (path) => navigations.push(opportunityRoute(`#/${path}`)),
      onSelect: async (posting) => {
        popupEvents.push('select');
        evaluations.push(posting);
      },
      onError: (error) => errors.push(error),
    },
  });
  vm.runInContext(`${opportunityController}\nconst dispose = bindOpportunities(options);`, context);
  await settle();
  return {
    observed: () => flow.snapshot().events,
    elements,
    requests,
    navigations,
    evaluations,
    popupEvents,
    errors,
    get route() {
      return opportunityRoute(selectedUrl);
    },
    async page(page) {
      elements.get('opportunity-pagination').dispatch('click', {
        target: { closest: () => ({ dataset: { page: String(page) }, disabled: false }) },
      });
      await settle();
    },
    async select(id) {
      elements.get('opportunity-list').dispatch('click', {
        target: { closest: () => ({ dataset: { postingId: id } }) },
      });
      await settle();
    },
    async apply() {
      await elements.get('opportunity-apply').dispatch('click');
    },
    async retry() {
      assert.ok(elements.get('retry-opportunities'), 'a list retry control is present');
      elements.get('retry-opportunities').dispatch('click');
      await settle();
    },
    changeScope(value) {
      const scope = elements.get('opportunity-scope');
      scope.value = value;
      scope.dispatch('change');
    },
    dispose() {
      vm.runInContext('dispose();', context);
    },
  };
}

test('paging replaces only the list and retains detail DOM, scroll and evaluation posting until a row is chosen', async () => {
  const fixture = await opportunityFixture();
  const detail = fixture.elements.get('opportunity-detail');
  const apply = fixture.elements.get('opportunity-apply');
  const initialMarkup = detail.innerHTML;
  const initialWrites = detail.writes;
  assert.equal(fixture.observed().filter(({ node }) => node === 'posting').length, 2, 'initial list and actual detail are both observed');
  detail.scrollTop = 387;
  await fixture.page(4);
  assert.equal(fixture.observed().filter(({ node }) => node === 'posting').length, 3, 'in-place pagination has no router render but is still observed');
  assert.equal(fixture.navigations.length, 0, 'paging never remounts the route');
  assert.match(fixture.elements.get('opportunity-list').innerHTML, /page-4-first/);
  assert.equal(detail.innerHTML, initialMarkup);
  assert.equal(detail.writes, initialWrites, 'even equivalent detail markup is not replaced');
  assert.equal(detail.scrollTop, 387);
  assert.equal(fixture.elements.get('opportunity-apply'), apply);
  assert.equal(fixture.route.page, 4);
  assert.equal(fixture.route.selected, 'page-3-first');
  assert.equal(
    fixture.elements
      .get('opportunity-list')
      .rows.some((row) => row.getAttribute('aria-current') === 'true'),
    false,
    'an off-page detail does not mark an unrelated row as selected',
  );
  await fixture.apply();
  assert.equal(fixture.evaluations.at(-1).id, 'page-3-first');
  await fixture.page(3);
  assert.equal(fixture.route.page, 3);
  assert.equal(detail.writes, initialWrites);
  assert.equal(detail.scrollTop, 387);
  assert.equal(fixture.elements.get('opportunity-apply'), apply);
  assert.equal(
    fixture.elements.get('opportunity-list').rows[0].getAttribute('aria-current'),
    'true',
  );
  await fixture.page(4);
  assert.equal(fixture.requests.filter(({ path }) => path === '/career-roles').length, 1);
  assert.equal(
    fixture.requests.filter(({ path }) => !path.includes('?') && path.startsWith('/job-postings/'))
      .length,
    1,
  );

  const observationsBeforeSelection = fixture.observed().length;
  await fixture.select('page-4-second');
  assert.equal(fixture.observed().length, observationsBeforeSelection + 1);
  assert.ok(fixture.observed().every(({ node, kind }) => node === 'posting' && kind === 'navigation'));
  assert.doesNotMatch(JSON.stringify(fixture.observed()), /page-3|page-4|공고 본문/);
  assert.match(detail.innerHTML, /page-4-second 공고 본문/);
  assert.equal(detail.scrollTop, 0);
  assert.notEqual(fixture.elements.get('opportunity-apply'), apply);
  assert.equal(apply.isConnected, false);
  assert.equal(fixture.route.page, 4);
  assert.equal(fixture.route.selected, 'page-4-second');
  await fixture.apply();
  assert.equal(fixture.evaluations.at(-1).id, 'page-4-second');
  fixture.dispose();
});

test('confirming a selected opportunity opens the flow popup before starting the analysis', async () => {
  const fixture = await opportunityFixture({ selected: 'selected-posting' });

  await fixture.apply();

  assert.deepEqual(fixture.popupEvents, ['popup', 'select']);
  assert.equal(fixture.evaluations[0].id, 'selected-posting');
});

test('scope changes reset the route while catalog return links retain the current list page and open detail', async () => {
  const fixture = await opportunityFixture();
  await fixture.page(4);
  const catalog = fixture.elements.get('opportunity-catalog');
  const returnTo = new URLSearchParams(
    (catalog.href || catalog.getAttribute('href')).split('?')[1],
  ).get('return_to');
  assert.deepEqual(opportunityRoute(`#/${returnTo}`), fixture.route);
  fixture.changeScope('all');
  assert.equal(fixture.navigations.length, 1);
  assert.equal(fixture.navigations[0].scope, 'all');
  assert.equal(fixture.navigations[0].page, 1);
  assert.equal(fixture.navigations[0].selected, '');
  fixture.dispose();
});

test('a page request failure keeps old rows and open detail usable and retries the requested page', async () => {
  let fail = true;
  const fixture = await opportunityFixture({
    listRequest(page) {
      if (page === 4 && fail) throw new Error('Traceback: /srv/private/app.py sk-test-private-key');
      return listResult(page);
    },
  });
  const list = fixture.elements.get('opportunity-list');
  const oldRows = list.innerHTML;
  const detail = fixture.elements.get('opportunity-detail');
  const oldDetail = detail.innerHTML;
  const apply = fixture.elements.get('opportunity-apply');
  detail.scrollTop = 234;
  await fixture.page(4);
  assert.equal(list.innerHTML, oldRows);
  assert.equal(detail.innerHTML, oldDetail);
  assert.equal(detail.scrollTop, 234);
  assert.equal(fixture.elements.get('opportunity-apply'), apply);
  assert.equal(fixture.route.page, 3, 'URL keeps the last successfully displayed list');
  assert.equal(fixture.elements.get('opportunity-list-status').hidden, false);
  assert.match(fixture.elements.get('opportunity-list-status').innerHTML, /잠시 후 다시 시도/);
  assert.doesNotMatch(fixture.elements.get('opportunity-list-status').innerHTML, /Traceback|private|sk-test/);
  await fixture.apply();
  assert.equal(fixture.evaluations.at(-1).id, 'page-3-first');
  fail = false;
  await fixture.retry();
  assert.match(list.innerHTML, /page-4-first/);
  assert.equal(detail.innerHTML, oldDetail);
  assert.equal(fixture.route.page, 4);
  assert.equal(fixture.elements.get('opportunity-list-status').hidden, true);
  assert.equal(fixture.requests.filter(({ path }) => path === '/career-roles').length, 1);
  fixture.dispose();
});

test('newer page results win when an aborted list request returns late', async () => {
  const fourth = deferred();
  const fifth = deferred();
  const fixture = await opportunityFixture({
    listRequest: (page) =>
      page === 4 ? fourth.promise : page === 5 ? fifth.promise : listResult(page),
  });
  const detail = fixture.elements.get('opportunity-detail');
  const initialWrites = detail.writes;
  await fixture.page(4);
  const obsolete = fixture.requests.at(-1);
  await fixture.page(5);
  assert.equal(obsolete.signal.aborted, true);
  fifth.resolve(listResult(5));
  await settle();
  assert.equal(fixture.route.page, 5);
  assert.match(fixture.elements.get('opportunity-list').innerHTML, /page-5-first/);
  fourth.resolve(listResult(4));
  await settle();
  assert.equal(fixture.route.page, 5);
  assert.match(fixture.elements.get('opportunity-list').innerHTML, /page-5-first/);
  assert.equal(detail.writes, initialWrites);
  assert.equal(fixture.route.selected, 'page-3-first');
  fixture.dispose();
});

test('disposed list and detail requests cannot update the abandoned view', async () => {
  const pendingList = deferred();
  const fixture = await opportunityFixture({
    listRequest: (page) => (page === 4 ? pendingList.promise : listResult(page)),
  });
  await fixture.page(4);
  const lastRequest = fixture.requests.at(-1);
  const oldList = fixture.elements.get('opportunity-list').innerHTML;
  const oldDetail = fixture.elements.get('opportunity-detail').innerHTML;
  fixture.dispose();
  assert.equal(lastRequest.signal.aborted, true);
  pendingList.resolve(listResult(4));
  await settle();
  assert.equal(fixture.elements.get('opportunity-list').innerHTML, oldList);
  assert.equal(fixture.elements.get('opportunity-detail').innerHTML, oldDetail);
  assert.equal(fixture.route.page, 3);

  const pendingDetail = deferred();
  const second = await opportunityFixture({
    detailRequest: (id) =>
      id === 'page-3-second' ? pendingDetail.promise : { posting: postingFixture(id) },
  });
  await second.select('page-3-second');
  const detailRequest = second.requests.at(-1);
  const loadingDetail = second.elements.get('opportunity-detail').innerHTML;
  const observedBeforeDispose = second.observed();
  second.dispose();
  assert.equal(detailRequest.signal.aborted, true);
  pendingDetail.resolve({ posting: postingFixture('page-3-second') });
  await settle();
  assert.equal(second.elements.get('opportunity-detail').innerHTML, loadingDetail);
  assert.deepEqual(second.observed(), observedBeforeDispose, 'a discarded response cannot claim another detail was displayed');
});

test('a reload can show a selected posting that is absent from the current list page', async () => {
  const fixture = await opportunityFixture({ selected: 'off-page-selected' });
  assert.match(fixture.elements.get('opportunity-list').innerHTML, /page-3-first/);
  assert.match(fixture.elements.get('opportunity-detail').innerHTML, /off-page-selected 공고 본문/);
  assert.equal(fixture.route.selected, 'off-page-selected');
  await fixture.apply();
  assert.equal(fixture.evaluations.at(-1).id, 'off-page-selected');
  assert.equal(fixture.requests.filter(({ path }) => path === '/career-roles').length, 1);
  fixture.dispose();
});

test('registered fictional postings keep their badge and analysis identity in both panes', () => {
  const posting = {
    id: 'registered-posting',
    source_type: 'backend',
    is_example: true,
    company: '가상 기업',
    role: '에이전트 엔지니어',
    description: '파일의 공고 본문',
    skills: [],
  };
  const list = opportunityList([posting], posting.id);
  assert.ok(list.includes('data-posting-id="registered-posting"'));
  assert.ok(list.includes('가상 공고'));
  assert.ok(opportunityDetail(posting, { id: 'member' }).includes('가상 공고'));
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
  assert.ok(opportunityDetail(posting, null).includes('모의지원 결과 확인'));
  assert.ok(opportunityDetail(posting, null).includes('로그인·회원가입'));
  assert.ok(opportunityDetail(posting, { id: 'test' }).includes('모의지원 결과 확인'));
  assert.ok(opportunitiesPage().includes('opportunity-list'));
  assert.ok(opportunitiesPage().includes('opportunity-detail'));
});

test('report is view-only and clearly labels the four demonstration axes', () => {
  const html = analysisReport({ report: { demo: true, score: 50, criteria: [], matches: [] } });
  assert.ok(!html.includes('print-report'));
  assert.ok(!html.includes('리포트 인쇄'));
  for (const label of ['이력서 완성도', '직무 적합도', '지원 자격 충족도', '실무 경쟁력'])
    assert.ok(html.includes(label));
  assert.ok(html.includes('시연용 점수 · 실제 평가와 무관'));
});
