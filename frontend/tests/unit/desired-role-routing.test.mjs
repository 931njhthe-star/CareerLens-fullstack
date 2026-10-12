import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { File } from 'node:buffer';
import vm from 'node:vm';
import { createFlowStore } from '../../src/features/activity-flow/events.js';
import { shell, escapeHtml } from '../../src/shared/components/ui.js';
import { workspacePage } from '../../src/pages/workspace.js';
import { bindSavedReportPicker } from '../../src/features/analysis/saved-report-picker.js';
import { publicErrorMessage } from '../../src/shared/api/error-messages.js';
import { jobsLoading } from '../../src/pages/jobs.js';
import { opportunitiesPage } from '../../src/pages/opportunities.js';
import { introductionPage } from '../../src/pages/introduction.js';
import { renderAuth } from '../../src/features/auth/auth.js';
import { guestResumePage, guestFileMetadata } from '../../src/features/resumes/guest.js';
import { validateResumeFile } from '../../src/features/resumes/file-preflight.js';
import { reportGatePage } from '../../src/features/auth/report-gate.js';
import { draftForPage, remainingEdits } from '../../src/app/workspace-state.js';
import { catalogRoute } from '../../src/features/job-postings/catalog-state.js';
import {
  opportunityRoute,
  opportunityPath,
} from '../../src/features/job-postings/opportunity-state.js';
import { roleChoicesMarkup } from '../../src/features/job-postings/job.js';
import { guestWorkspace, practiceDestination } from '../../src/features/analysis/guest-state.js';

// Exercise the real controller and markup. Only browser mounting and requests
// are replaced; route decisions and editor state remain production code.
const controller = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace(/\bstart\(\);\s*$/, '');

function routeFixture({ member = false, draft = {}, edits = {} } = {}) {
  const flow = createFlowStore();
  const elements = new Map();
  const calls = {
    catalog: 0,
    opportunities: [],
    gates: 0,
    journeys: [],
    observers: [],
    api: [],
    notices: [],
  };
  const element = () => ({
    dataset: {},
    innerHTML: '',
    value: '',
    selectedOptions: [{ dataset: {}, textContent: '' }],
    listeners: new Map(),
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    },
    focus() {}, prepend() {},
    classList: { add() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  let markup = '';
  const app = {
    dataset: {},
    get innerHTML() {
      return markup;
    },
    set innerHTML(value) {
      markup = value;
      elements.clear();
      for (const match of value.matchAll(/\bid="([^"]+)"/g))
        elements.set(match[1], element(match[1]));
    },
  };
  let hash = '#/desired-role';
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
    createElement: () => ({
      set innerHTML(value) {
        for (const match of value.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], element());
      },
    }),
  };
  const context = vm.createContext({
    beginFlowEvent: flow.begin, finishFlowEvent: flow.finish, recordFlowEvent: flow.record,
    observeFlowProgress() {}, setFlowSession() {}, mountFlowLauncher() {},
    document,
    location,
    history: {
      pushState(_state, _unused, url) {
        location.hash = url.slice(url.indexOf('#'));
      },
      replaceState(_state, _unused, url) {
        location.hash = url.slice(url.indexOf('#'));
      },
    },
    window: { addEventListener() {}, scrollTo() {} },
    URLSearchParams,
    AbortController, DOMException,
    FormData: class {
      constructor(form) {
        this.values = form.testValues || new Map();
      }
      get(name) {
        return this.values.get(name);
      }
      [Symbol.iterator]() { return this.values[Symbol.iterator](); }
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        calls.observers.push(this);
      }
      observe(target) {
        this.target = target;
      }
      disconnect() {
        this.disconnected = true;
      }
    },
    setTimeout() {},
    clearTimeout() {},
    shell,
    escapeHtml,
    workspacePage,
    bindSavedReportPicker,
    publicErrorMessage,
    jobsLoading,
    opportunitiesPage,
    introductionPage,
    renderAuth,
    guestResumePage,
    guestFileMetadata,
    validateResumeFile,
    reportGatePage,
    draftForPage,
    remainingEdits,
    catalogRoute,
    opportunityRoute,
    opportunityPath,
    roleChoicesMarkup,
    guestWorkspace,
    practiceDestination,
    mountJourneyMotion(host, options) {
      calls.journeys.push({ host, options });
      assert.fail('ordinary workflow pages must not mount a background journey');
    },
    stopCatalogLoad() {},
    stopResumeExamples() {},
    clearCatalogEdits() {},
    bindCounters() {},
    bindResumeExamples(options) { calls.examples = options; },
    bindIntroduction() {},
    bindAuth() {},
    notice(message) {
      calls.notices.push(message);
    },
    pending(_form, _label, action) {
      calls.pending = action();
    },
    bindCatalog() {
      calls.catalog += 1;
    },
    bindOpportunities({ route }) {
      calls.opportunities.push(route);
    },
    bindReportGate() {
      calls.gates += 1;
    },
    api: async (path) => {
      calls.api.push(path);
      assert.equal(path, '/career-roles');
      return {
        items: [
          { id: 'backend', label: '백엔드 개발자', description: 'API 개발' },
          { id: 'ai', label: 'AI 개발자', description: '모델 개발' },
          { id: 'custom', label: '직접 입력', description: '' },
        ],
      };
    },
    initialUser: member ? { id: 'test-member', name: '테스트 회원' } : null,
    initialDraft: structuredClone(draft),
    initialEdits: structuredClone(edits),
  });
  vm.runInContext(controller, context);
  vm.runInContext(
    `
    session = { user: initialUser };
    workspace = { draft: { ...initialDraft, guest: !initialUser }, questions: [] };
    guest.target = workspace.draft.career_target || null;
    edits = initialEdits;
  `,
    context,
  );
  return {
    calls,
    observed: () => flow.snapshot().events,
    flowSnapshot: flow.snapshot,
    document,
    location,
    get markup() {
      return markup;
    },
    element: (id) => elements.get(id),
    snapshot: () => JSON.parse(vm.runInContext('JSON.stringify({workspace, edits})', context)),
    bridge() {
      context.testBridge = {
        dispose() {
          calls.bridgeDisposed = true;
        },
      };
      vm.runInContext('disposeReportLoading = testBridge.dispose', context);
      return vm.runInContext('renderReportBridge(testBridge)', context);
    },
    changeOwner() {
      vm.runInContext('session = {user: {id: "different-owner"}}', context);
    },
    selectPosting(posting) {
      context.postingForTest = posting;
      return vm.runInContext('selectPosting(postingForTest)', context);
    },
    captureContinuation() {
      context.continuedPostings = [];
      vm.runInContext('selectPosting = async (posting) => continuedPostings.push(posting)', context);
      return context.continuedPostings;
    },
    setApi(handler) {
      context.api = async (path, options) => {
        calls.api.push(path);
        return handler(path, options);
      };
    },
    transitionState: () => app.dataset.reportTransition,
    async submit(id, values) {
      const form = elements.get(id);
      assert.ok(form, 'upload form is rendered');
      form.testValues = new Map(Object.entries(values));
      const submit = form.listeners.get('submit');
      assert.equal(typeof submit, 'function', 'production submit handler is bound');
      submit({ preventDefault() {} });
      await calls.pending;
    },
    async render(route = location.hash) {
      location.hash = route;
      // A real browser dispatches hashchange after navigate updates location.
      for (let count = 0; count < 8; count += 1) {
        const before = location.hash;
        vm.runInContext('render()', context);
        await new Promise(setImmediate);
        if (location.hash === before) return;
      }
      assert.fail('Route did not settle');
    },
  };
}

function assertRolePage(fixture) {
  assert.equal(fixture.location.hash, '#/desired-role');
  assert.equal(fixture.document.title, '희망 직무 · CareerLens');
  assert.match(fixture.markup, /data-page="desired-role"/);
  assert.match(fixture.markup, /희망하는 직무를 선택해 주세요/);
  const header = fixture.markup.slice(0, fixture.markup.indexOf('</header>'));
  assert.doesNotMatch(header, /희망 직무/);
  assert.match(header, /aria-current="page">채용공고<\/a>/);
  assert.match(fixture.markup, /aria-current="step"[^>]*>\s*<span class="step-number">2<\/span>/);
  const workflow = fixture.markup.match(/class="steps"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(workflow, 'workflow navigation is present');
  assert.equal((workflow.match(/class="step-number"/g) || []).length, 3);
  assert.equal(fixture.calls.catalog, 0);
  assert.equal(fixture.calls.opportunities.length, 0);
}

test('each distinct posting route is observed without leaking a posting ID or claiming a completed action', async () => {
  const fixture = routeFixture();
  await fixture.render('#/jobs/PRIVATE_JOB_ONE');
  await fixture.render('#/jobs/PRIVATE_JOB_TWO');
  await fixture.render('#/jobs/PRIVATE_JOB_TWO');
  const postingEvents = fixture.observed().filter(({ node }) => node === 'posting');
  assert.equal(postingEvents.length, 2);
  assert.ok(postingEvents.every(({ kind }) => kind === 'navigation'));
  assert.doesNotMatch(JSON.stringify(fixture.observed()), /PRIVATE_JOB/);
});

test('rejected resume preflight emits a blocked input event without recording a successful save', async () => {
  const fixture = routeFixture();
  await fixture.render('#/resume');
  await fixture.submit('guest-upload-form', { file: new File(['not a resume'], 'private.pdf', { type: 'application/pdf' }) });
  assert.ok(fixture.observed().some(({ node, state }) => node === 'input_check' && state === 'blocked'));
  assert.equal(fixture.observed().some(({ node, kind, state }) => node === 'resume' && kind === 'action' && state === 'complete'), false);
  assert.doesNotMatch(JSON.stringify(fixture.observed()), /private\.pdf|not a resume/);
  assert.equal(fixture.calls.api.length, 0);
});

test('a posting-first guest preserves the choice through the real upload submit and records only safe preparation metadata', async () => {
  const fixture = routeFixture();
  const posting = { id: 'PRIVATE_POSTING', role: 'PRIVATE_ROLE', company: 'PRIVATE_COMPANY' };
  await fixture.selectPosting(posting);
  assert.equal(fixture.location.hash, '#/resume');
  await fixture.render();
  assert.match(fixture.markup, /이력서 첨부/);
  assert.ok(fixture.element('dismiss-selected-posting'));
  const continued = fixture.captureContinuation();
  fixture.setApi(async (path) => {
    assert.equal(path, '/guest/resume/upload');
    return { draft: { resume_attached: true, filename: 'PRIVATE_FILENAME.md' }, completed: false };
  });
  await fixture.submit('guest-upload-form', { file: new File(['# PRIVATE_RESUME'], 'PRIVATE_FILENAME.md') });
  assert.equal(continued.length, 1);
  assert.equal(continued[0].id, posting.id);
  assert.equal(fixture.observed().find(({ node, kind }) => node === 'resume' && kind === 'action').state, 'complete');
  assert.equal(fixture.observed().some(({ node }) => node === 'evaluate' || node === 'report'), false);
  assert.doesNotMatch(JSON.stringify(fixture.observed()), /PRIVATE_/);
});

test('dismissing a chosen posting emits cleared metadata from its actual button handler', async () => {
  const fixture = routeFixture();
  await fixture.selectPosting({ id: 'PRIVATE_POSTING', role: 'role', company: 'company' });
  await fixture.render('#/resume');
  fixture.element('dismiss-selected-posting').listeners.get('click')();
  assert.equal(fixture.observed().filter(({ node }) => node === 'posting').at(-1).state, 'cleared');
  assert.equal(fixture.element('dismiss-selected-posting'), undefined);
  assert.doesNotMatch(JSON.stringify(fixture.observed()), /PRIVATE_POSTING/);
});

for (const spec of [
  { form: 'resume-form', route: '#/resume', node: 'resume', path: '/resume', values: { resume_text: 'PRIVATE_INPUT' } },
  { form: 'job-form', route: '#/desired-role', node: 'role', path: '/career-target', values: { role_id: 'custom', role: 'PRIVATE_ROLE' } },
]) {
  test(`${spec.node} form records successful save after the real handler receives its response`, async () => {
    const fixture = routeFixture({ member: true, draft: { resume_text: 'current resume' } });
    await fixture.render(spec.route);
    fixture.setApi(async (path) => {
      assert.equal(path, spec.path);
      return { draft: { resume_text: 'PRIVATE_SAVED', career_target: { role_id: 'custom', label: 'PRIVATE_ROLE' } }, questions: [] };
    });
    await fixture.submit(spec.form, spec.values);
    assert.equal(fixture.observed().filter(({ node, kind }) => node === spec.node && kind === 'action').at(-1).state, 'complete');
    assert.doesNotMatch(JSON.stringify(fixture.observed()), /PRIVATE_/);
  });

  for (const supersede of ['navigation', 'account', 'late-unauthorized']) {
    test(`${spec.node} late response after ${supersede} cannot finish or replace the current workflow`, async () => {
      const fixture = routeFixture({ member: true, draft: { resume_text: 'current resume', report: { summary: 'current report' } } });
      await fixture.render(spec.route);
      let resolve, reject;
      const response = new Promise((done, fail) => { resolve = done; reject = fail; });
      fixture.setApi(async (path) => { assert.equal(path, spec.path); return response; });
      const pending = fixture.submit(spec.form, spec.values);
      await new Promise(setImmediate);
      assert.equal(fixture.observed().filter(({ node, kind }) => node === spec.node && kind === 'action').at(-1).state, 'pending');
      if (supersede === 'navigation') await fixture.render('#/jobs');
      else fixture.changeOwner();
      const expected = fixture.snapshot();
      const expectedRoute = fixture.location.hash;
      if (supersede === 'late-unauthorized') reject(Object.assign(new Error('PRIVATE_SERVER_ERROR'), { status: 401 }));
      else resolve({ draft: { resume_text: 'PRIVATE_OBSOLETE', report: { summary: 'PRIVATE_OLD_REPORT' } }, questions: [] });
      await pending;
      assert.deepEqual(fixture.snapshot(), expected);
      assert.equal(fixture.location.hash, expectedRoute);
      assert.equal(fixture.observed().filter(({ node, kind }) => node === spec.node && kind === 'action').at(-1).state, 'cancelled');
      assert.equal(fixture.calls.notices.length, 0);
      assert.doesNotMatch(JSON.stringify(fixture.observed()), /PRIVATE_/);
    });
  }
}

test('guest role choice before attachment stays local; later role persistence remains observable and rejects a replaced view', async () => {
  const local = routeFixture();
  await local.render('#/desired-role');
  await local.submit('job-form', { role_id: 'custom', role: 'PRIVATE_ROLE' });
  assert.equal(local.calls.api.filter((path) => path !== '/career-roles').length, 0);
  assert.equal(local.observed().filter(({ node, kind }) => node === 'role' && kind === 'action').at(-1).state, 'complete');
  assert.equal(local.observed().some(({ node }) => node === 'local_data'), false, 'in-memory choice is not a storage write');

  const saved = routeFixture({ draft: { resume_attached: true } });
  await saved.render('#/desired-role');
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  saved.setApi(async (path) => { assert.equal(path, '/guest/career-target'); return response; });
  const pending = saved.submit('job-form', { role_id: 'custom', role: 'PRIVATE_ROLE' });
  await saved.render('#/jobs');
  const expected = saved.snapshot();
  resolve({ draft: { resume_attached: true, career_target: { role_id: 'custom', label: 'PRIVATE_OLD_ROLE' } } });
  await pending;
  assert.deepEqual(saved.snapshot(), expected);
  assert.equal(saved.observed().filter(({ node, kind }) => node === 'role' && kind === 'action').at(-1).state, 'cancelled');
  assert.doesNotMatch(JSON.stringify(saved.observed()), /PRIVATE_/);
});

test('a delayed example-resume save cannot restore its old report or claim completion after navigation', async () => {
  const fixture = routeFixture({ member: true, draft: { resume_text: 'current resume' } });
  await fixture.render('#/resume');
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  fixture.setApi(async (path) => { assert.equal(path, '/resume'); return response; });
  const pending = fixture.calls.examples.onSelect({ resume_text: 'PRIVATE_EXAMPLE' });
  await fixture.render('#/jobs');
  const expected = fixture.snapshot();
  resolve({ draft: { resume_text: 'PRIVATE_EXAMPLE', report: { summary: 'PRIVATE_OLD_REPORT' } }, questions: [] });
  await pending;
  assert.deepEqual(fixture.snapshot(), expected);
  assert.equal(fixture.location.hash, '#/jobs');
  assert.equal(fixture.observed().filter(({ node, kind }) => node === 'resume' && kind === 'action').at(-1).state, 'cancelled');
  assert.doesNotMatch(JSON.stringify(fixture.observed()), /PRIVATE_/);
});

function postingNavigationLink(markup) {
  const navigation = markup.match(/<nav class="primary-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation, 'primary navigation is present');
  const link = navigation.match(/href="([^"]+)"[^>]*>채용공고<\/a>/)?.[1];
  assert.ok(link, 'posting link is present');
  return link.replaceAll('&amp;', '&');
}

function assertSavedRolePostingLink(
  markup,
  target = { role_id: 'backend', label: '백엔드 개발자' },
) {
  const route = opportunityRoute(postingNavigationLink(markup));
  assert.ok(route, 'posting link opens role-specific opportunities');
  assert.equal(route.role_id, target.role_id);
  assert.equal(route.label, target.label);
  assert.equal(route.page, 1);
}

function postingWorkflowStep(markup) {
  const step = markup.match(/<(a|span)\s+([^>]+)>\s*<span class="step-number">2<\/span>/);
  assert.ok(step, 'posting workflow step is present');
  return { tag: step[1], attributes: step[2] };
}

function assertSavedRoleWorkflowLink(markup, target) {
  const step = postingWorkflowStep(markup);
  assert.equal(step.tag, 'a');
  const link = step.attributes.match(/href="([^"]+)"/)?.[1];
  assert.ok(link, 'posting workflow link is enabled');
  const route = opportunityRoute(link.replaceAll('&amp;', '&'));
  assert.equal(route?.role_id, target.role_id);
  assert.equal(route?.label, target.label);
}

test('member introduction retains the saved desired role in its posting navigation', async () => {
  const fixture = routeFixture({
    member: true,
    draft: {
      resume_text: '저장한 이력서',
      career_target: { role_id: 'backend', label: '백엔드 개발자' },
    },
  });
  await fixture.render('#/intro');
  assert.equal(fixture.location.hash, '#/intro');
  assert.match(fixture.markup, /data-introduction/);
  assertSavedRolePostingLink(fixture.markup);
});

test('guest authentication retains the saved desired role in its posting navigation', async () => {
  const fixture = routeFixture({
    draft: {
      resume_attached: true,
      career_target: { role_id: 'backend', label: '백엔드 개발자' },
    },
  });
  await fixture.render('#/email');
  assert.equal(fixture.location.hash, '#/email');
  assert.match(fixture.markup, /id="auth-form"/);
  assertSavedRolePostingLink(fixture.markup);
});

for (const member of [false, true]) {
  const label = member ? 'member' : 'guest';
  const draft = member ? { resume_text: '저장한 이력서' } : { resume_attached: true };

  test(`${label} opens the desired-role editor independently of the catalog`, async () => {
    const fixture = routeFixture({ member, draft });
    await fixture.render('#/desired-role');
    assertRolePage(fixture);
    await fixture.render('#/jobs');
    assert.equal(fixture.calls.catalog, 1);
    assert.equal(fixture.document.title, '채용공고 · CareerLens');
    assert.doesNotMatch(fixture.markup, /data-page="desired-role"/);
  });

  test(`${label} old job bookmarks normalize to the desired-role route`, async () => {
    const fixture = routeFixture({ member, draft });
    await fixture.render('#/job');
    assertRolePage(fixture);
  });

  test(`${label} restores the chosen role without exposing legacy focus after leaving the editor`, async () => {
    const saved = { role_id: 'backend', label: '백엔드 개발자', focus: '저장한 관심 사항' };
    const fixture = routeFixture({
      member,
      draft: { ...draft, career_target: saved },
      edits: { role_id: 'ai', focus: '저장 전 관심 사항' },
    });
    await fixture.render();
    await fixture.render('#/jobs');
    await fixture.render('#/desired-role');
    assert.match(fixture.element('career-role').innerHTML, /value="ai"[^>]*selected>/);
    assert.doesNotMatch(fixture.markup, /career-focus|저장 전 관심 사항|저장한 관심 사항/);
    assert.deepEqual(fixture.snapshot().workspace.draft.career_target, saved);
    assertSavedRolePostingLink(fixture.markup, saved);
    assertSavedRoleWorkflowLink(fixture.markup, saved);
  });

  test(`${label} unsaved role opens the combined posting step at role selection`, async () => {
    const fixture = routeFixture({
      member,
      draft,
      edits: { role_id: 'ai', focus: '저장 전 관심 사항' },
    });
    await fixture.render('#/jobs');
    await fixture.render('#/desired-role');
    assert.match(fixture.element('career-role').innerHTML, /value="ai"[^>]*selected>/);
    assert.doesNotMatch(fixture.markup, /career-focus|저장 전 관심 사항/);
    assert.equal(postingNavigationLink(fixture.markup), '#/desired-role');
    const step = postingWorkflowStep(fixture.markup);
    assert.equal(step.tag, 'a');
    assert.match(step.attributes, /href="#\/desired-role"/);
    assert.match(
      fixture.markup,
      /posting-phases__pending" aria-disabled="true"><span>2<\/span> 공고 선택/,
    );
  });

  test(`${label} practice resumes at the saved role's postings in combined step two`, async () => {
    const fixture = routeFixture({
      member,
      draft: { ...draft, career_target: { role_id: 'backend', label: '백엔드 개발자' } },
    });
    await fixture.render('#/practice');
    assert.match(fixture.location.hash, /^#\/opportunities\?/);
    assert.equal(fixture.calls.opportunities.length, 1);
    assert.equal(fixture.calls.opportunities[0].role_id, 'backend');
    assert.match(fixture.markup, /aria-current="step"[^>]*>\s*<span class="step-number">2<\/span>/);
    assert.match(fixture.markup, /aria-current="page">채용공고<\/a>/);
    assert.doesNotMatch(fixture.markup, /data-page="desired-role"/);
  });
}

test('guests may browse desired roles before uploading a resume', async () => {
  const fixture = routeFixture();
  await fixture.render();
  assertRolePage(fixture);
  assert.match(fixture.markup, /분석 전 이력서를 첨부해 주세요/);
});

test('member role entry preserves the saved resume prerequisite', async () => {
  const fixture = routeFixture({ member: true, edits: { resume_text: '저장 전 이력서' } });
  await fixture.render('#/desired-role');
  assert.equal(fixture.location.hash, '#/resume');
  assert.equal(fixture.document.title, '이력서 입력 · CareerLens');
  assert.match(fixture.markup, /저장 전 이력서/);
  assert.doesNotMatch(fixture.markup, /data-page="desired-role"/);
});

test('edited custom role name survives a round trip without changing saved analysis context', async () => {
  const fixture = routeFixture({
    member: true,
    draft: {
      resume_text: '저장한 이력서',
      career_target: { role_id: 'custom', label: '저장한 직무', focus: '저장한 관심 사항' },
    },
    edits: { role: '수정 중인 직무', focus: '수정 중인 관심 사항' },
  });
  await fixture.render('#/jobs');
  await fixture.render('#/desired-role');
  assert.match(fixture.markup, /value="수정 중인 직무"/);
  assert.doesNotMatch(fixture.markup, /career-focus|수정 중인 관심 사항|저장한 관심 사항/);
  assert.equal(fixture.snapshot().workspace.draft.career_target.label, '저장한 직무');
  const saved = { role_id: 'custom', label: '저장한 직무' };
  assertSavedRolePostingLink(fixture.markup, saved);
  assertSavedRoleWorkflowLink(fixture.markup, saved);
});

test('legacy analysis routes and unfinished results reopen saved role postings without questions', async () => {
  for (const member of [false, true]) {
    for (const route of ['#/practice', '#/questions', '#/preparing', '#/result']) {
      const fixture = routeFixture({
        member,
        draft: {
          ...(member ? { resume_text: '저장한 이력서' } : { resume_attached: true }),
          analysis_mode: 'desired_role',
          career_target: { role_id: 'backend', label: '백엔드 개발자' },
        },
      });
      await fixture.render(route);
      assert.match(fixture.location.hash, /^#\/opportunities\?/);
      assert.equal(fixture.calls.opportunities[0].role_id, 'backend');
      assert.equal(fixture.calls.gates, 0);
      assert.doesNotMatch(
        fixture.markup,
        /data-resume-score-card|id="analysis-form"|data-preparation-status/,
      );
    }
  }
});

test('legacy analysis links reopen a selected posting or its completed report for guests and members', async () => {
  for (const member of [false, true]) {
    for (const withTarget of [false, true]) {
      const draft = {
        ...(member ? { resume_text: '저장한 이력서' } : { resume_attached: true }),
        selected_posting_id: 'chosen-posting',
        ...(withTarget ? { career_target: { role_id: 'backend', label: '백엔드 개발자' } } : {}),
      };
      for (const route of ['#/questions', '#/preparing', '#/result']) {
        const fixture = routeFixture({ member, draft });
        await fixture.render(route);
        assert.equal(fixture.location.hash, '#/jobs/chosen-posting');
        assert.doesNotMatch(fixture.markup, /id="analysis-form"|data-preparation-status/);
      }
      for (const route of ['#/questions', '#/preparing']) {
        const fixture = routeFixture({
          member,
          draft: {
            ...draft,
            ...(member
              ? { report: { score: 75, summary: '완료', verdict: '완료' } }
              : { report_locked: true }),
          },
        });
        await fixture.render(route);
        assert.equal(fixture.location.hash, '#/result');
        assert.equal(fixture.calls.gates, member ? 0 : 1);
      }
    }
  }
});

test('guest report remains gated until analysis completes and never renders report content', async () => {
  const draft = { resume_attached: true, selected_posting_id: 'chosen-posting' };
  const incomplete = routeFixture({ draft });
  await incomplete.render('#/result');
  assert.equal(incomplete.location.hash, '#/jobs/chosen-posting');
  assert.equal(incomplete.calls.gates, 0);

  const complete = routeFixture({
    draft: {
      ...draft,
      report_locked: true,
      report: { score: 90, summary: 'PRIVATE_REPORT_NOT_FOR_GUESTS' },
    },
  });
  await complete.render('#/result');
  assert.equal(complete.location.hash, '#/result');
  assert.equal(complete.calls.gates, 1);
  assert.doesNotMatch(complete.markup, /PRIVATE_REPORT_NOT_FOR_GUESTS/);
  assert.doesNotMatch(complete.markup, /data-resume-score-card/);
});

test('the real report route keeps loading modal ownership and activates the safe guest gate only on completion', () => {
  const fixture = routeFixture({
    draft: {
      resume_attached: true,
      report_locked: true,
      report: { score: 91, summary: 'PRIVATE_REPORT_DURING_PARTICLES' },
    },
  });
  const view = fixture.bridge();
  assert.equal(fixture.location.hash, '#/result');
  assert.equal(fixture.calls.bridgeDisposed, undefined, 'render must retain the loading modal');
  assert.equal(fixture.calls.gates, 0, 'the native modal owns focus throughout particles');
  assert.equal(fixture.transitionState(), 'forming');
  assert.doesNotMatch(fixture.markup, /PRIVATE_REPORT_DURING_PARTICLES|data-resume-score-card/);
  view.onReveal();
  assert.equal(fixture.transitionState(), 'revealing');
  assert.equal(fixture.calls.gates, 0);
  view.activate();
  assert.equal(fixture.calls.gates, 1);
});

test('a changed account cannot reveal or activate the old result transition', () => {
  const fixture = routeFixture({ draft: { resume_attached: true, report_locked: true } });
  const view = fixture.bridge();
  fixture.changeOwner();
  view.onReveal();
  view.activate();
  assert.equal(fixture.transitionState(), 'forming');
  assert.equal(fixture.calls.gates, 0);
});

test('navigation disposes the retained modal and makes its late reveal callback inert', async () => {
  const fixture = routeFixture({ draft: { resume_attached: true, report_locked: true } });
  const view = fixture.bridge();
  await fixture.render('#/resume');
  assert.equal(fixture.calls.bridgeDisposed, true);
  view.onReveal();
  view.activate();
  assert.equal(fixture.transitionState(), undefined);
  assert.equal(fixture.calls.gates, 0);
  assert.equal(fixture.location.hash, '#/resume');
});

for (const member of [false, true]) {
  const label = member ? 'member' : 'guest';

  test(`${label} workflow navigation never creates background motion or journey observers`, async () => {
    const fixture = routeFixture({
      member,
      draft: {
        ...(member
          ? {
              resume_text: '저장된 가상 이력서',
              report: { score: 75, summary: '완료', verdict: '완료' },
            }
          : { resume_attached: true, report_locked: true }),
        career_target: { role_id: 'backend', label: '백엔드 개발자' },
        selected_posting_id: 'chosen-posting',
      },
    });
    for (const route of [
      '#/intro',
      '#/resume',
      '#/desired-role',
      '#/jobs',
      '#/opportunities?role_id=backend&label=백엔드%20개발자',
      '#/jobs/chosen-posting',
      '#/result',
      '#/desired-role',
      '#/resume',
      '#/email',
    ]) {
      await fixture.render(route);
      assert.equal(fixture.calls.journeys.length, 0, `${route} has no moving background`);
      assert.equal(fixture.calls.observers.length, 0, `${route} does not observe journey anchors`);
      assert.doesNotMatch(fixture.markup, /data-journey-active|journey-motion-canvas/);
    }
  });

  test(`${label} invalid resume files are rejected before the controller makes an upload request`, async () => {
    for (const [file, message] of [
      [new File(['# My resume'], 'wrong.pdf'), /Markdown\(\.md\)/],
      [new File(['   \n\t'], 'blank.md'), /본문이 비어/],
      [new File([new Uint8Array([0xff, 0xfe, 0x61, 0])], 'invalid.md'), /UTF-8/],
    ]) {
      const fixture = routeFixture({ member });
      await fixture.render('#/resume');
      await fixture.submit(member ? 'upload-form' : 'guest-upload-form', { file });
      assert.equal(fixture.location.hash, '#/resume', 'invalid input stays on the editor');
      assert.equal(fixture.calls.api.length, 0, 'no request sends the rejected file');
      assert.match(fixture.calls.notices.at(-1), message);
      assert.equal(fixture.calls.journeys.length, 0);
      assert.equal(fixture.calls.observers.length, 0);
    }
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const member of [false, true]) {
  for (const change of ['navigation', 'account']) {
    const label = `${member ? 'member' : 'guest'} ${change}`;
    const invalidate = async (fixture) => {
      if (change === 'navigation') await fixture.render('#/jobs');
      else fixture.changeOwner();
    };

    test(`${label} change during local file preflight never starts the upload`, async () => {
      const fixture = routeFixture({ member });
      await fixture.render('#/resume');
      const reading = deferred();
      const contents = deferred();
      const file = {
        name: 'pending.md',
        size: 30,
        arrayBuffer() {
          reading.resolve();
          return contents.promise;
        },
      };
      const submission = fixture.submit(member ? 'upload-form' : 'guest-upload-form', { file });
      await reading.promise;
      await invalidate(fixture);
      const snapshot = fixture.snapshot();
      const markup = fixture.markup;
      const route = fixture.location.hash;
      contents.resolve(new TextEncoder().encode('# Valid pending resume').buffer);
      await submission;
      assert.deepEqual(fixture.calls.api, [], 'stale local validation must not send the file');
      assert.deepEqual(fixture.snapshot(), snapshot);
      assert.equal(fixture.markup, markup);
      assert.equal(fixture.location.hash, route);
      assert.deepEqual(fixture.calls.notices, []);
    });

    test(`${label} change during an upload makes its late response inert`, async () => {
      const fixture = routeFixture({ member });
      await fixture.render('#/resume');
      const uploaded = deferred();
      const response = deferred();
      const uploadPath = member ? '/resume/upload' : '/guest/resume/upload';
      fixture.setApi((path) => {
        assert.equal(path, uploadPath);
        uploaded.resolve();
        return response.promise;
      });
      const submission = fixture.submit(member ? 'upload-form' : 'guest-upload-form', {
        file: new File(['# Valid resume'], 'resume.md'),
      });
      await uploaded.promise;
      await invalidate(fixture);
      const snapshot = fixture.snapshot();
      const markup = fixture.markup;
      const route = fixture.location.hash;
      response.resolve({
        draft: {
          resume_attached: true,
          resume_text: '# Late resume from the previous view',
          filename: 'resume.md',
        },
        questions: [],
      });
      await submission;
      assert.deepEqual(fixture.calls.api, [uploadPath]);
      assert.deepEqual(
        fixture.snapshot(),
        snapshot,
        'late data must not replace the current workspace',
      );
      assert.equal(fixture.markup, markup, 'late data must not rerender the current view');
      assert.equal(fixture.location.hash, route, 'late uploads must not advance the workflow');
      assert.deepEqual(fixture.calls.notices, []);
    });
  }
}
