import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createFlowStore } from '../../src/features/activity-flow/events.js';
import { shell, escapeHtml } from '../../src/shared/components/ui.js';
import { myPage, savedReportsList, filterSavedReports } from '../../src/pages/my-page.js';
import { adminDashboard, adminAccessDenied } from '../../src/pages/admin-dashboard.js';
import { publicErrorMessage } from '../../src/shared/api/error-messages.js';
import { analysisReport } from '../../src/features/analysis/report.js';
import { bindSavedReportPicker } from '../../src/features/analysis/saved-report-picker.js';
import { workspacePage } from '../../src/pages/workspace.js';
import { introductionPage } from '../../src/pages/introduction.js';
import { renderAuth } from '../../src/features/auth/auth.js';
import { guestResumePage } from '../../src/features/resumes/guest.js';
import { draftForPage, remainingEdits } from '../../src/app/workspace-state.js';
import { catalogRoute } from '../../src/features/job-postings/catalog-state.js';
import { opportunityRoute } from '../../src/features/job-postings/opportunity-state.js';
import { guestWorkspace, practiceDestination } from '../../src/features/analysis/guest-state.js';

const controller = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace(/\bstart\(\);\s*$/, '');
const settle = () => new Promise(setImmediate);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function storedDraft(id = 'stored-run') {
  return {
    analysis_mode: 'saved_report',
    saved_report: true,
    company: '',
    role: '저장한 분석보고서',
    created_at: '2026-10-10T12:30:00Z',
    report: {
      run_id: id,
      source: 'backend',
      status: 'completed',
      score: null,
      summary: `${id}의 보관 보고서`,
      backend_report_text: `# ${id}의 보관 보고서`,
      criteria: [],
      matches: [],
    },
  };
}

// Only DOM mounting, authentication widgets and transport are replaced. The
// account route guards, response ownership and workspace state are real main.js.
function accountFixture({
  member = true,
  draft = {},
  edits = {},
  request,
  guestResponse = { draft: {}, completed: false },
  workspaceResponse = { draft: {}, questions: [] },
  sessionRequest,
} = {}) {
  const elements = new Map();
  class Element {
    constructor(id = '') {
      this.id = id;
      this.dataset = {};
      this.listeners = new Map();
      this.children = [];
      this.isConnected = true;
      this.disabled = false;
      this.writes = 0;
      this.content = '';
      this.classList = { add() {} };
    }
    disconnect() {
      this.isConnected = false;
      for (const child of this.children) child.disconnect();
      if (this.id && elements.get(this.id) === this) elements.delete(this.id);
    }
    set innerHTML(value) {
      this.writes++;
      this.content = value;
      for (const child of this.children) child.disconnect();
      this.children = [];
      for (const match of value.matchAll(/<[a-z][^>]*>/gi)) {
        const id = match[0].match(/\bid="([^"]+)"/)?.[1];
        const attributes = [...match[0].matchAll(/\b(data-[\w-]+)(?:="([^"]*)")?/g)];
        if (!id && !attributes.length) continue;
        const child = new Element(id);
        child.dataAttributes = new Set(attributes.map((attribute) => attribute[1]));
        for (const [, name, value = ''] of attributes)
          child.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
            value;
        if (id) elements.set(id, child);
        this.children.push(child);
      }
    }
    get innerHTML() {
      return this.content;
    }
    replaceChildren() {
      this.innerHTML = '';
    }
    querySelector(selector) {
      const attribute = selector.match(/^\[(data-[\w-]+)\]$/)?.[1];
      return attribute
        ? this.children.find((child) => child.dataAttributes?.has(attribute)) || null
        : null;
    }
    querySelectorAll() {
      return [];
    }
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    }
    focus() {
      this.focused = true;
    }
    dispatch(type) {
      return this.listeners.get(type)?.({ currentTarget: this, preventDefault() {} });
    }
  }
  const app = new Element('app');
  let hash = '#/mypage';
  const location = {
    pathname: '/',
    search: '',
    get hash() {
      return hash;
    },
    set hash(value) {
      hash = value.startsWith('#') ? value : `#${value}`;
    },
  };
  const document = {
    title: '',
    getElementById: (id) => (id === 'app' ? app : elements.get(id) || null),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const flow = createFlowStore();
  const calls = { requests: [], notices: [], auth: null, sessions: [] };
  const user = { id: 'member-one', name: '테스트 회원', email: 'member@example.test' };
  let startupSession = { user: null };
  const context = vm.createContext({
    beginFlowEvent: flow.begin,
    finishFlowEvent: flow.finish,
    recordFlowEvent: flow.record,
    observeFlowProgress() {},
    setFlowSession: flow.setSession,
    mountFlowLauncher() {},
    document,
    location,
    history: {
      replaceState(_state, _unused, url) {
        location.hash = url.slice(url.indexOf('#'));
      },
      pushState(_state, _unused, url) {
        location.hash = url.slice(url.indexOf('#'));
      },
    },
    window: { addEventListener() {}, scrollTo() {}, confirm: () => true },
    URLSearchParams,
    AbortController,
    setTimeout() {},
    clearTimeout() {},
    shell,
    escapeHtml,
    myPage,
    savedReportsList,
    filterSavedReports,
    adminDashboard,
    publicErrorMessage,
    mountAdminDashboard() {
      return () => {};
    },
    adminAccessDenied,
    analysisReport,
    bindSavedReportPicker,
    workspacePage,
    introductionPage,
    renderAuth,
    guestResumePage,
    draftForPage,
    remainingEdits,
    catalogRoute,
    opportunityRoute,
    guestWorkspace,
    practiceDestination,
    stopCatalogLoad() {},
    stopResumeExamples() {},
    clearCatalogEdits() {},
    hasCatalogEdits: () => false,
    bindCounters() {},
    bindResumeExamples() {},
    bindIntroduction() {},
    bindAuth(options) {
      calls.auth = options;
    },
    notice(message) {
      calls.notices.push(message);
    },
    setSession(session) {
      calls.sessions.push(session);
    },
    getSession: async () => sessionRequest ? sessionRequest() : startupSession,
    consumeAuthCallback: () => null,
    api: async (path, options = {}) => {
      calls.requests.push({ path, ...options });
      if (path.startsWith('/account/reports')) {
        if (request) return request(path, options);
        return path.includes('?')
          ? { items: [], next_offset: null }
          : { draft: storedDraft(path.split('/').at(-1)), questions: [] };
      }
      if (path === '/guest/workspace') return structuredClone(guestResponse);
      if (path === '/workspace') return structuredClone(workspaceResponse);
      if (path === '/guest/claim')
        return {
          draft: {
            ...storedDraft('unrelated-guest-run'),
            resume_text: 'GUEST_MUST_NOT_REPLACE_MEMBER_WORK',
          },
          questions: [{ id: 'unrelated-guest-question' }],
        };
      if (path === '/auth/logout') return {};
      assert.fail(`Unexpected request ${path}`);
    },
    initialUser: member ? user : null,
    initialDraft: structuredClone(draft),
    initialEdits: structuredClone(edits),
  });
  vm.runInContext(controller, context);
  vm.runInContext(
    `
    session = {user: initialUser};
    workspace = {draft: initialDraft, questions: [{id: 'current-question'}]};
    edits = initialEdits;
  `,
    context,
  );
  async function render(route = location.hash) {
    location.hash = route;
    for (let step = 0; step < 8; step++) {
      const before = location.hash;
      vm.runInContext('render()', context);
      await settle();
      if (location.hash === before) return;
    }
    assert.fail('Account route did not settle');
  }
  return {
    calls,
    observed: () => flow.snapshot().events,
    flowSnapshot: flow.snapshot,
    document,
    location,
    app,
    render,
    element: (id) => elements.get(id),
    snapshot: () =>
      JSON.parse(
        vm.runInContext('JSON.stringify({session, workspace, edits, returnAfterLogin})', context),
      ),
    async login() {
      assert.ok(calls.auth, 'the login widget is mounted');
      await calls.auth.onSession({ user, backend_adapter: true });
      await render();
    },
    async start(route) {
      location.hash = route;
      startupSession = { user, backend_adapter: true };
      await vm.runInContext('start()', context);
      await settle();
    },
    changeOwner() {
      vm.runInContext('session = {user: {id: "member-two", name: "다른 회원"}}', context);
    },
    setAdmin(value) {
      context.adminValue = value;
      vm.runInContext('session.user.is_admin = adminValue', context);
    },
    async click(element) {
      assert.ok(element, 'the requested action is present');
      const before = location.hash;
      await element.dispatch('click');
      await settle();
      if (location.hash !== before) await render();
    },
  };
}

for (const refreshFails of [false, true]) {
  test(`successful logout immediately publishes guest state while session refresh ${refreshFails ? 'fails' : 'is delayed'}`, async () => {
    const verification = deferred();
    const fixture = accountFixture({ member: true, sessionRequest: () => verification.promise,
      draft: { resume_text: 'PRIVATE_MEMBER_RESUME', report: { summary: 'PRIVATE_MEMBER_REPORT' } } });
    await fixture.render('#/reports/stored-run');
    assert.ok(fixture.flowSnapshot().states.some(({ node }) => node === 'report'));
    const logout = fixture.click(fixture.element('logout'));
    await settle();
    assert.equal(fixture.flowSnapshot().session.mode, 'guest');
    assert.equal(fixture.flowSnapshot().states.find(({ node }) => node === 'auth').sessionMode, 'guest');
    assert.equal(fixture.flowSnapshot().states.some(({ node }) => node === 'report'), false);
    assert.equal(fixture.snapshot().session.user, null);
    assert.doesNotMatch(JSON.stringify(fixture.snapshot().workspace), /PRIVATE_MEMBER/);
    if (refreshFails) verification.reject(new Error('Synthetic offline'));
    else verification.resolve({ user: null });
    await logout;
    assert.equal(fixture.flowSnapshot().session.mode, 'guest');
    assert.equal(fixture.flowSnapshot().states.some(({ node }) => node === 'report'), false);
    if (refreshFails) assert.equal(fixture.observed().filter(({ node }) => node === 'notice').at(-1).state, 'failed');
    assert.doesNotMatch(JSON.stringify(fixture.observed()), /PRIVATE_MEMBER|Synthetic offline/);
  });
}

for (const route of ['#/mypage', '#/reports/stored-run']) {
  for (const completed of [false, true]) {
    const guestKind = completed ? 'completed guest analysis' : 'prepared guest resume';
    for (const entry of ['login', 'start']) {
      test(`${entry} into ${route} ignores an unrelated ${guestKind} and never claims it`, async () => {
        const workspaceResponse = {
          draft: {
            resume_text: '회원 계정에 저장된 현재 이력서',
            selected_posting_id: 'member-current-posting',
            report: { run_id: 'member-current-run', summary: '현재 회원 보고서' },
          },
          questions: [{ id: 'member-current-question' }],
        };
        const fixture = accountFixture({
          member: false,
          guestResponse: {
            completed,
            draft: { resume_attached: true, report_locked: completed, filename: 'guest.md' },
          },
          workspaceResponse,
        });
        if (entry === 'login') {
          await fixture.render(route);
          assert.equal(fixture.snapshot().returnAfterLogin, route.slice(2));
          await fixture.login();
        } else {
          await fixture.start(route);
        }
        assert.equal(
          fixture.calls.requests.some(({ path }) => path === '/guest/claim'),
          false,
          'viewing account reports must never import a staged guest resume or overwrite member work',
        );
        assert.equal(
          fixture.calls.requests.some(({ path }) => path === '/guest/workspace'),
          false,
          'account entry does not inspect an unrelated guest workflow',
        );
        assert.equal(
          fixture.location.hash,
          route,
          'the requested account destination survives authentication and startup',
        );
        assert.deepEqual(fixture.snapshot().workspace, workspaceResponse);
        assert.equal(
          fixture.calls.requests.filter(({ path }) => path.startsWith('/account/reports')).length,
          1,
        );
      });
    }
  }
}

for (const route of ['#/mypage', '#/reports/stored-run']) {
  test(`${route} requires login and returns to the requested account page afterward`, async () => {
    const fixture = accountFixture({ member: false });
    await fixture.render(route);
    assert.equal(fixture.location.hash, '#/email');
    assert.equal(fixture.snapshot().returnAfterLogin, route.slice(2));
    assert.equal(
      fixture.calls.requests.length,
      0,
      'protected reports are not fetched before login',
    );
    assert.ok(fixture.calls.notices.some((message) => message.includes('로그인 후 확인')));
    await fixture.login();
    assert.equal(fixture.location.hash, route);
    assert.equal(fixture.snapshot().returnAfterLogin, null);
    assert.ok(fixture.calls.requests.some(({ path }) => path.startsWith('/account/reports')));
    assert.equal(fixture.snapshot().workspace.draft.resume_text, undefined);
  });

  test(`a signed-in member without a resume can open ${route}`, async () => {
    const fixture = accountFixture();
    await fixture.render(route);
    assert.equal(fixture.location.hash, route);
    assert.equal(
      fixture.document.title,
      route === '#/mypage' ? '마이페이지 · CareerLens' : '저장한 분석보고서 · CareerLens',
    );
    assert.equal(fixture.calls.requests.length, 1);
    assert.ok(fixture.calls.requests[0].path.startsWith('/account/reports'));
  });
}

test('opening an archived report leaves the current workspace, questions and unsaved editor input intact', async () => {
  const pending = deferred();
  const fixture = accountFixture({
    draft: {
      resume_text: '현재 작성 중인 이력서',
      selected_posting_id: 'current-posting',
      career_target: { role_id: 'current-role', label: '현재 직무' },
      report: { run_id: 'current-run', summary: '현재 보고서' },
    },
    edits: { resume_text: '아직 저장하지 않은 수정', focus: '현재 관심 사항' },
    request: () => pending.promise,
  });
  const before = fixture.snapshot();
  await fixture.render('#/reports/archived-run');
  assert.deepEqual(fixture.snapshot(), before);
  pending.resolve({ draft: storedDraft('archived-run'), questions: [{ id: 'archived-question' }] });
  await settle();
  assert.match(fixture.element('main').innerHTML, /archived-run의 보관 보고서/);
  assert.deepEqual(fixture.snapshot(), before);
  assert.deepEqual(
    fixture.calls.requests.map(({ path }) => path),
    ['/account/reports/archived-run'],
  );
  await fixture.render('#/resume');
  assert.match(fixture.app.innerHTML, /아직 저장하지 않은 수정/);
  assert.deepEqual(fixture.snapshot(), before);
});

test('saved report history appends unique records, retains them on failure and retries the failed offset', async () => {
  let fail = true;
  const first = { id: 'old-one', status: 'completed', created_at: '2026-10-10T10:00:00Z' };
  const second = { id: 'old-two', status: 'partial', created_at: '2026-10-10T11:00:00Z' };
  const fixture = accountFixture({
    request(path) {
      if (path.endsWith('/context'))
        return { job_context: { title: '저장된 공고', company: '저장된 기업' } };
      if (path.endsWith('offset=0')) return { items: [first], next_offset: 100 };
      assert.equal(path, '/account/reports?offset=100');
      if (fail) throw new Error('일시적인 조회 오류');
      return { items: [first, second], next_offset: null };
    },
  });
  const before = fixture.snapshot();
  await fixture.render('#/mypage');
  const host = fixture.element('saved-reports-list');
  assert.match(host.innerHTML, /#\/reports\/old-one/);
  await fixture.click(host.querySelector('[data-reports-more]'));
  assert.doesNotMatch(host.innerHTML, /일시적인 조회 오류/);
  assert.ok(host.innerHTML.includes(publicErrorMessage(new Error('일시적인 조회 오류'))));
  assert.match(host.innerHTML, /#\/reports\/old-one/);
  fail = false;
  await fixture.click(host.querySelector('[data-reports-retry]'));
  assert.equal((host.innerHTML.match(/#\/reports\/old-one/g) || []).length, 1);
  assert.match(host.innerHTML, /#\/reports\/old-two/);
  assert.equal(host.querySelector('[data-reports-more]'), null);
  assert.deepEqual(
    fixture.calls.requests.filter(({ path }) => !path.endsWith('/context')).map(({ path }) => path),
    ['/account/reports?offset=0', '/account/reports?offset=100', '/account/reports?offset=100'],
  );
  assert.deepEqual(fixture.snapshot(), before);
});

for (const route of ['#/mypage', '#/reports/old-run']) {
  const response = () =>
    route === '#/mypage'
      ? {
          items: [{ id: 'LATE_PRIVATE', status: 'completed', created_at: '2026-10-10T10:00:00Z' }],
          next_offset: null,
        }
      : { draft: storedDraft('LATE_PRIVATE'), questions: [] };

  test(`leaving ${route} aborts its request and ignores a response from a transport that resolves after abort`, async () => {
    const pending = deferred();
    const fixture = accountFixture({ request: () => pending.promise });
    await fixture.render(route);
    const request = fixture.calls.requests[0];
    const abandoned = fixture.element(route === '#/mypage' ? 'saved-reports-list' : 'main');
    const writes = abandoned.writes;
    await fixture.render('#/intro');
    const state = fixture.snapshot();
    const markup = fixture.app.innerHTML;
    assert.equal(request.signal.aborted, true);
    pending.resolve(response());
    await settle();
    assert.equal(abandoned.writes, writes);
    assert.equal(fixture.app.innerHTML, markup);
    assert.equal(fixture.location.hash, '#/intro');
    assert.deepEqual(fixture.snapshot(), state);
  });

  test(`changing accounts while ${route} is pending prevents the previous owner's report from being rendered`, async () => {
    const pending = deferred();
    const fixture = accountFixture({ request: () => pending.promise });
    await fixture.render(route);
    const host = fixture.element(route === '#/mypage' ? 'saved-reports-list' : 'main');
    const writes = host.writes;
    fixture.changeOwner();
    const state = fixture.snapshot();
    pending.resolve(response());
    await settle();
    assert.equal(host.writes, writes);
    assert.doesNotMatch(host.innerHTML, /LATE_PRIVATE/);
    assert.deepEqual(fixture.snapshot(), state);
  });

  test(`logout clears ${route} and ignores its late response without restoring private state`, async () => {
    const pending = deferred();
    const fixture = accountFixture({
      draft: { resume_text: '이전 회원의 이력서' },
      edits: { resume_text: '이전 회원의 수정' },
      request: () => pending.promise,
    });
    await fixture.render(route);
    const accountRequest = fixture.calls.requests[0];
    await fixture.click(fixture.element('logout'));
    assert.equal(accountRequest.signal.aborted, true);
    assert.equal(fixture.location.hash, '#/resume');
    assert.equal(fixture.snapshot().session.user, null);
    const state = fixture.snapshot();
    const markup = fixture.app.innerHTML;
    pending.resolve(response());
    await settle();
    assert.equal(fixture.app.innerHTML, markup);
    assert.doesNotMatch(markup, /이전 회원|LATE_PRIVATE/);
    assert.deepEqual(fixture.snapshot(), state);
  });
}

test('a late unauthorized response cannot sign out the replacement account', async () => {
  const pending = deferred();
  const fixture = accountFixture({ request: () => pending.promise });
  await fixture.render('#/reports/old-run');
  fixture.changeOwner();
  const state = fixture.snapshot();
  pending.reject(Object.assign(new Error('이전 세션 만료'), { status: 401 }));
  await settle();
  assert.deepEqual(fixture.snapshot(), state);
  assert.equal(fixture.location.hash, '#/reports/old-run');
  assert.deepEqual(
    fixture.calls.requests.map(({ path }) => path),
    ['/account/reports/old-run'],
  );
});

test('an inaccessible saved report provides a safe retry without replacing the active workspace', async () => {
  let fail = true;
  const fixture = accountFixture({
    edits: { focus: '작성 중인 관심 사항' },
    request() {
      if (fail) throw Object.assign(new Error('PRIVATE_UPSTREAM_DETAIL'), { status: 404 });
      return { draft: storedDraft('retried-run'), questions: [] };
    },
  });
  const before = fixture.snapshot();
  await fixture.render('#/reports/retried-run');
  assert.match(fixture.element('main').innerHTML, /현재 계정으로 열 수 없습니다/);
  assert.doesNotMatch(fixture.element('main').innerHTML, /PRIVATE_UPSTREAM_DETAIL/);
  fail = false;
  await fixture.click(fixture.element('retry-saved-report'));
  assert.match(fixture.element('main').innerHTML, /retried-run의 보관 보고서/);
  assert.deepEqual(fixture.snapshot(), before);
  assert.deepEqual(
    fixture.calls.requests.map(({ path }) => path),
    ['/account/reports/retried-run', '/account/reports/retried-run'],
  );
});

test('dashboard opens directly without login or access to private account data', async () => {
  const fixture = accountFixture({ member: false });
  const returnAfterLogin = fixture.snapshot().returnAfterLogin;
  await fixture.render('#/admin');
  assert.equal(fixture.location.hash, '#/admin');
  assert.equal(fixture.snapshot().returnAfterLogin, returnAfterLogin);
  assert.equal(fixture.calls.requests.length, 0);
  assert.match(fixture.app.innerHTML, /data-admin-dashboard/);
  assert.match(fixture.document.title, /대시보드/);
});

test('normal members can open the dashboard from My Page and a direct address', async () => {
  const fixture = accountFixture();
  await fixture.render('#/mypage');
  assert.match(fixture.app.innerHTML, /href="#\/admin"/);
  await fixture.render('#/admin');
  assert.match(fixture.document.title, /대시보드/);
  assert.match(fixture.app.innerHTML, /data-admin-dashboard/);
  assert.match(fixture.app.innerHTML, /대기 분석/);
});

test('dashboard entry does not depend on the authenticated member admin flag', async () => {
  const fixture = accountFixture();
  fixture.setAdmin('true');
  await fixture.render('#/mypage');
  assert.match(fixture.app.innerHTML, /href="#\/admin"/);
  fixture.setAdmin(true);
  await fixture.render('#/mypage');
  assert.match(fixture.app.innerHTML, /href="#\/admin"/);
  await fixture.render('#/admin');
  assert.match(fixture.app.innerHTML, /대시보드/);
  assert.match(fixture.app.innerHTML, /대기 분석/);
  assert.match(fixture.app.innerHTML, /data-admin-dashboard/);
});

test('late posting metadata is cancelled and never restores a former account after logout', async () => {
  const context = deferred();
  const fixture = accountFixture({
    request(path) {
      return path.endsWith('/context')
        ? context.promise
        : {
            items: [
              { id: 'archived-run', status: 'completed', created_at: '2026-10-12T00:00:00Z' },
            ],
            next_offset: null,
          };
    },
  });
  await fixture.render('#/mypage');
  const request = fixture.calls.requests.find(({ path }) => path.endsWith('/context'));
  assert.ok(request);
  await fixture.click(fixture.element('logout'));
  const markup = fixture.app.innerHTML;
  assert.equal(request.signal.aborted, true);
  context.resolve({ job_context: { title: 'PRIVATE OLD JOB', company: 'PRIVATE OLD COMPANY' } });
  await settle();
  assert.equal(fixture.app.innerHTML, markup);
  assert.equal(fixture.snapshot().session.user, null);
});

test('opening a saved report records navigation separately and only confirms display after data is rendered', async () => {
  const response = deferred();
  const fixture = accountFixture({ request: () => response.promise });
  await fixture.render('#/reports/PRIVATE_REPORT_IDENTIFIER');
  assert.ok(fixture.observed().some(({ node, kind }) => node === 'history' && kind === 'navigation'));
  assert.equal(fixture.observed().some(({ node }) => node === 'report'), false);
  assert.equal(JSON.stringify(fixture.observed()).includes('PRIVATE_REPORT_IDENTIFIER'), false);
  response.resolve({ draft: storedDraft('PRIVATE_REPORT_IDENTIFIER'), questions: [] });
  await settle();
  assert.ok(fixture.observed().some(({ node, kind, state }) => node === 'report' && kind === 'action' && state === 'complete'));
});

test('a failed saved-report read never records a successful report display', async () => {
  const fixture = accountFixture({ request() { throw new Error('PRIVATE_FAILURE_DETAIL'); } });
  await fixture.render('#/reports/private-report');
  assert.ok(fixture.observed().some(({ node, kind, state }) => node === 'history' && kind === 'action' && state === 'failed'));
  assert.equal(fixture.observed().some(({ node }) => node === 'report'), false);
  assert.equal(JSON.stringify(fixture.observed()).includes('PRIVATE_FAILURE_DETAIL'), false);
});

test('a report response after navigation records cancellation and cannot report display success', async () => {
  const response = deferred();
  const fixture = accountFixture({ request: () => response.promise });
  await fixture.render('#/reports/old-report');
  await fixture.render('#/intro');
  response.resolve({ draft: storedDraft('old-report'), questions: [] });
  await settle();
  assert.ok(fixture.observed().some(({ node, kind, state }) => node === 'history' && kind === 'action' && state === 'cancelled'));
  assert.equal(fixture.observed().some(({ node }) => node === 'report'), false);
});
