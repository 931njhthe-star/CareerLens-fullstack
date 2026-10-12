import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shell, escapeHtml } from '../../src/shared/components/ui.js';
import * as auth from '../../src/features/auth/auth.js';
import * as guestState from '../../src/features/analysis/guest-state.js';
import { reportGatePage } from '../../src/features/auth/report-gate.js';
import { guestResumePage } from '../../src/features/resumes/guest.js';
import { draftForPage, remainingEdits } from '../../src/app/workspace-state.js';
import { workspacePage } from '../../src/pages/workspace.js';
import { catalogRoute } from '../../src/features/job-postings/catalog-state.js';
import { opportunityRoute } from '../../src/features/job-postings/opportunity-state.js';
import { publicErrorMessage } from '../../src/shared/api/error-messages.js';
import { createFlowStore } from '../../src/features/activity-flow/events.js';

const controller = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace(/\bstart\(\);\s*$/, '');
const posting = { id: 'current-job', source_type: 'backend', company: '회사', role: '직무' };
const preview = {
  completed: false, preview_ready: true, analysis_pending: true, report_locked: true,
  expires_at: '2099-01-01T00:00:00Z',
  draft: { resume_attached: true, selected_posting_id: posting.id, company: posting.company, role: posting.role },
};
const claimedDraft = {
  resume_text: 'CLAIMED_RESUME', resume_id: 'current-resume',
  selected_posting_id: posting.id, selected_posting: posting, pending_guest_analysis: true,
};

function fixture({ draft = guestState.guestWorkspace(preview).draft, temporary = preview,
  claimDraft = claimedDraft, route = '#/result', claimError, claimWait } = {}) {
  const calls = { api: [], auth: [], gates: [], continuations: [], reports: [], renders: 0, notices: [] };
  let clock = 1000;
  const flow = createFlowStore({ now: () => clock });
  const nodes = new Map();
  let markup = '';
  const node = () => ({
    dataset: {}, innerHTML: '', hidden: false, style: {}, disabled: false,
    addEventListener() {}, focus() {}, setAttribute() {}, removeAttribute() {},
    classList: { add() {}, remove() {} }, querySelector: () => null, querySelectorAll: () => [],
  });
  const app = {
    dataset: {},
    get innerHTML() { return markup; },
    set innerHTML(value) {
      markup = value;
      nodes.clear();
      for (const match of value.matchAll(/\bid="([^"]+)"/g)) nodes.set(match[1], node());
    },
  };
  let hash = route;
  const location = {
    pathname: '/', search: '',
    get hash() { return hash; },
    set hash(value) { hash = value.startsWith('#') ? value : `#${value}`; },
  };
  let guest = structuredClone(temporary);
  let memberDraft = structuredClone(claimDraft);
  const context = vm.createContext({
    ...auth, ...guestState,
    document: {
      title: '', getElementById: (id) => id === 'app' ? app : nodes.get(id) || null,
      querySelector: (selector) => selector.startsWith('#') ? nodes.get(selector.slice(1)) || null : null,
      querySelectorAll: () => [],
    },
    window: { addEventListener() {}, scrollTo() {} },
    location,
    history: {
      replaceState(_state, _title, url) { location.hash = url.slice(url.indexOf('#')); },
      pushState(_state, _title, url) { location.hash = url.slice(url.indexOf('#')); },
    },
    URLSearchParams, DOMException, AbortController,
    setTimeout() {}, clearTimeout() {},
    shell, escapeHtml, reportGatePage, guestResumePage, workspacePage,
    draftForPage, remainingEdits, catalogRoute, opportunityRoute, publicErrorMessage,
    beginFlowEvent: flow.begin, finishFlowEvent: flow.finish, recordFlowEvent: flow.record,
    observeFlowProgress() {}, setFlowSession: flow.setSession, mountFlowLauncher() {}, setSession() {},
    stopCatalogLoad() {}, stopResumeExamples() {}, clearCatalogEdits() {}, bindCounters() {},
    bindAuth(options) { calls.auth.push(options); },
    bindReportGate(options) { calls.gates.push(options); return () => {}; },
    bindSavedReportPicker() { return () => {}; },
    notice(message) { calls.notices.push(message); },
    consumeAuthCallback: () => null,
    getSession: async () => ({ user: { id: 'verified-owner' }, backend_adapter: true }),
    api: async (path, options) => {
      calls.api.push({ path, method: options?.method });
      if (path === '/guest/workspace') return guest;
      if (path === '/guest/claim') {
        if (claimWait) await claimWait;
        if (claimError) throw claimError;
        guest = { completed: false, draft: {} };
        return { draft: structuredClone(memberDraft), questions: [] };
      }
      if (path === '/workspace') return { draft: structuredClone(memberDraft), questions: [] };
      assert.fail(`Unexpected API call: ${path}`);
    },
    createReportLoading() { assert.fail('Authentication must not create another report loading screen'); },
    initialDraft: structuredClone(draft), calls,
    completedContinuation() {
      memberDraft = { ...memberDraft, pending_guest_analysis: false };
    },
  });
  vm.runInContext(controller, context);
  vm.runInContext(`
    session = { user: null, backend_adapter: true, capabilities: { guest_analysis: false, guest_report_preview: true } };
    workspace = { draft: initialDraft, questions: [] };
    mountReportVisuals = async () => {};
  `, context);
  return {
    calls, location,
    flowSnapshot: flow.snapshot,
    advanceClock(milliseconds) { clock += milliseconds; },
    get markup() { return markup; },
    snapshot: () => JSON.parse(vm.runInContext('JSON.stringify({workspace,session,returnAfterLogin})', context)),
    render(page) { if (page) location.hash = page; return vm.runInContext('render()', context); },
    claim() { return vm.runInContext('claimCompletedGuest()', context); },
    setupContinuationSpy() {
      vm.runInContext(`
        render = () => { calls.renders++; };
        selectPosting = async (posting, options) => {
          calls.continuations.push({ posting, options, draft: structuredClone(workspace.draft), owner: session.user.id });
          workspace.draft.pending_guest_analysis = false;
          completedContinuation();
        };
      `, context);
      context.structuredClone = structuredClone;
    },
    setupStoredReportRender() {
      vm.runInContext(`
        render = () => {
          calls.renders++;
          calls.reports.push({ owner: session.user.id, report: workspace.draft.report });
        };
      `, context);
    },
    login(owner = 'verified-owner') {
      context.nextSession = { user: { id: owner }, backend_adapter: true };
      return vm.runInContext('onSession(nextSession)', context);
    },
    start() { return vm.runInContext('start()', context); },
    setReturnDestination(destination) { context.destination = destination; vm.runInContext('returnAfterLogin = destination', context); },
    setPriorAccount() {
      vm.runInContext(`session.user = { id: 'former-owner' }; workspace.draft.report = { score: 99, summary: 'FORMER_PRIVATE_REPORT', source: 'backend' };`, context);
    },
    invalidate(kind) {
      context.invalidateKind = kind;
      vm.runInContext(`
        stopReportVisuals();
        if (invalidateKind === 'account') session.user = { id: 'next-owner' };
        workspace = { draft: { resume_text: 'CURRENT_VIEW_RESUME' }, questions: [] };
        location.hash = '#/intro';
      `, context);
    },
  };
}

for (const page of ['email', 'signup']) {
  test(`guest ${page} stays over the locked report shell instead of exposing report contents`, () => {
    const prepared = guestState.guestWorkspace(preview).draft;
    const f = fixture({ draft: { ...prepared, report: { score: 99, summary: 'PRIVATE_REPORT' } } });
    f.render(`#/${page}`);
    assert.equal(f.location.hash, `#/${page}`);
    assert.match(f.markup, /data-report-gate/);
    assert.match(f.markup, /id="auth-form"/);
    assert.doesNotMatch(f.markup, /PRIVATE_REPORT|data-resume-score-card|분석이 완료되었어요/);
    assert.equal(f.calls.auth.length, 1);
    assert.equal(f.calls.api.length, 0);
  });
}

test('login transfers the prepared guest intent and continues once with its exact authenticated posting', async () => {
  const f = fixture();
  f.setReturnDestination('result');
  f.setupContinuationSpy();
  await f.login();
  assert.deepEqual(f.calls.api.map(({ path }) => path), ['/guest/workspace', '/guest/claim']);
  assert.equal(f.calls.continuations.length, 1);
  const continuation = f.calls.continuations[0];
  assert.equal(continuation.owner, 'verified-owner');
  assert.equal(continuation.posting.id, posting.id);
  assert.equal(continuation.options.continuePending, true);
  assert.equal(continuation.draft.resume_id, 'current-resume');
  assert.equal(continuation.draft.report, undefined);
  assert.equal(f.calls.renders, 0, 'no later general render may dispose the continuation overlay');
  await f.login();
  assert.equal(f.calls.continuations.length, 1, 'a later session refresh cannot repeat the consumed preparation');
});

test('startup resumes a claimed pending intent after reload without uploading the guest resume again', async () => {
  const f = fixture({ temporary: { completed: false, draft: {} } });
  f.setupContinuationSpy();
  await f.start();
  assert.deepEqual(f.calls.api.map(({ path }) => path), ['/guest/workspace', '/workspace']);
  assert.equal(f.calls.continuations.length, 1);
  assert.equal(f.calls.continuations[0].options.continuePending, true);
  assert.equal(f.calls.renders, 0);
});

test('an account change cannot reuse the former account report when continuing a guest preparation', async () => {
  const f = fixture();
  f.setPriorAccount();
  f.setupContinuationSpy();
  await f.login('different-owner');
  assert.equal(f.calls.continuations.length, 1);
  assert.equal(f.calls.continuations[0].owner, 'different-owner');
  assert.equal(f.calls.continuations[0].draft.report, undefined);
  assert.doesNotMatch(JSON.stringify(f.snapshot()), /FORMER_PRIVATE_REPORT/);
});

test('an expired guest claim returns to resume preparation without starting an evaluation', async () => {
  const f = fixture({ claimError: Object.assign(new Error('fixture'), { status: 409, code: 'guest_expired' }) });
  f.setReturnDestination('result');
  f.setupContinuationSpy();
  await f.login();
  assert.equal(f.calls.continuations.length, 0);
  assert.equal(f.location.hash, '#/resume');
  assert.equal(f.calls.api.some(({ path }) => path === '/analysis' || path === '/evaluations'), false);
});

test('a claimed preparation whose posting is no longer registered cannot automatically evaluate', async () => {
  const f = fixture({ claimDraft: { ...claimedDraft, selected_posting: null, selected_posting_id: '' } });
  f.setupContinuationSpy();
  await f.login();
  assert.equal(f.calls.continuations.length, 0);
  assert.notEqual(f.location.hash, '#/result');
});

test('explicit account-page login does not claim or evaluate guest preparation', async () => {
  const f = fixture();
  f.setReturnDestination('mypage');
  f.setupContinuationSpy();
  await f.login();
  assert.equal(f.calls.continuations.length, 0);
  assert.equal(f.calls.api.some(({ path }) => path === '/guest/claim'), false);
  assert.equal(f.location.hash, '#/mypage');
});

for (const page of ['email', 'signup']) {
  test(`live guest lock through ${page} and claim emits report completion only after its actual markup appears`, async () => {
    let release;
    const claimWait = new Promise((resolve) => { release = resolve; });
    const completed = { ...preview, completed: true, preview_ready: false, analysis_pending: false };
    const f = fixture({ claimWait, temporary: completed, draft: guestState.guestWorkspace(completed).draft,
      claimDraft: { resume_text: 'PRIVATE_RESUME', report: { run_id: 'PRIVATE_RUN', source: 'backend',
        score: 0, summary: 'SYNTHETIC_RENDERED_RESULT', verdict: '분석 완료' }, pending_guest_analysis: false } });
    f.render('#/result');
    assert.equal(f.flowSnapshot().states.some(({ node }) => node === 'report'), false, 'a locked shell is not a displayed report');
    f.render(`#/${page}`);
    const connecting = f.calls.auth.at(-1).onSession({ user: { id: 'PRIVATE_OWNER' }, backend_adapter: true });
    await new Promise(setImmediate);
    assert.equal(f.flowSnapshot().session.mode, 'member');
    assert.equal(f.flowSnapshot().states.find(({ node }) => node === 'report_lock')?.state, 'waiting');
    assert.equal(f.flowSnapshot().states.find(({ node }) => node === 'guest_claim')?.state, 'pending');
    assert.equal(f.flowSnapshot().states.some(({ node }) => node === 'report'), false);
    assert.doesNotMatch(f.markup, /SYNTHETIC_RENDERED_RESULT/);
    release();
    await connecting;
    assert.match(f.markup, /SYNTHETIC_RENDERED_RESULT/);
    const current = f.flowSnapshot();
    assert.equal(current.states.find(({ node }) => node === 'report')?.state, 'complete');
    assert.equal(current.states.find(({ node }) => node === 'guest_claim')?.state, 'complete');
    assert.equal(current.states.find(({ node }) => node === 'report_lock')?.state, 'complete');
    assert.equal(current.states.find(({ node }) => node === 'result_delivery')?.state, 'complete');
    assert.doesNotMatch(JSON.stringify(current), /PRIVATE_|SYNTHETIC_RENDERED_RESULT/);
    assert.deepEqual(f.calls.api.map(({ path }) => path), ['/guest/claim']);
  });

  test(`successful ${page} renders the completed guest report directly without a loading screen or another analysis`, async () => {
    const completed = { ...preview, completed: true, preview_ready: false, analysis_pending: false };
    const f = fixture({ temporary: completed, draft: guestState.guestWorkspace(completed).draft,
      claimDraft: { resume_text: 'SERVER_RESUME', report: { run_id: 'local-guest:ready', score: 0 }, pending_guest_analysis: false } });
    f.render(`#/${page}`);
    assert.equal(f.calls.auth.length, 1);
    f.setupStoredReportRender();
    await f.calls.auth[0].onSession({ user: { id: 'verified-owner' }, backend_adapter: true });
    assert.deepEqual(f.calls.api.map(({ path }) => path), ['/guest/claim']);
    assert.equal(f.calls.renders, 1);
    assert.equal(f.calls.reports[0].owner, 'verified-owner');
    assert.equal(f.calls.reports[0].report.score, 0);
    assert.equal(f.snapshot().workspace.draft.report.run_id, 'local-guest:ready');
    assert.equal(f.location.hash, '#/result');
    const observed = f.flowSnapshot().states;
    assert.equal(observed.find(({ node }) => node === 'guest_claim')?.state, 'complete');
    assert.equal(observed.find(({ node }) => node === 'report_lock')?.state, 'complete');
    assert.equal(observed.find(({ node }) => node === 'result_delivery')?.state, 'complete');
    assert.equal(typeof observed.find(({ node }) => node === 'result_delivery')?.durationMs, 'number');
    assert.doesNotMatch(JSON.stringify(observed), /SERVER_RESUME|local-guest:ready|verified-owner/);
  });
}

test('a completed server report takes precedence over a stale pending preparation marker', async () => {
  const completed = { ...preview, completed: true, preview_ready: false, analysis_pending: false };
  const f = fixture({ temporary: completed,
    claimDraft: { ...claimedDraft, report: { run_id: 'local-guest:ready', score: 73 } } });
  f.setupStoredReportRender();
  f.setReturnDestination('result');
  await f.login();
  assert.deepEqual(f.calls.api.map(({ path }) => path), ['/guest/workspace', '/guest/claim']);
  assert.equal(f.calls.renders, 1);
  assert.equal(f.calls.reports[0].report.run_id, 'local-guest:ready');
  assert.equal(f.location.hash, '#/result');
});

test('a known completed guest result still obeys expiry rejected by the atomic server claim', async () => {
  const completed = { ...preview, completed: true, preview_ready: false, analysis_pending: false };
  const f = fixture({ temporary: completed, draft: guestState.guestWorkspace(completed).draft,
    claimDraft: {}, claimError: Object.assign(new Error('fixture'), { status: 410, code: 'guest_expired' }) });
  f.setupStoredReportRender();
  f.setReturnDestination('result');
  await f.login();
  assert.deepEqual(f.calls.api.map(({ path }) => path), ['/guest/claim', '/workspace']);
  assert.equal(f.calls.reports.length, 0);
  assert.equal(f.location.hash, '#/resume');
  assert.equal(f.flowSnapshot().states.find(({ node }) => node === 'guest_claim')?.state, 'expired');
  assert.equal(f.flowSnapshot().states.find(({ node }) => node === 'result_delivery')?.state, 'expired');
});

for (const completedKnown of [false, true]) for (const change of ['account', 'navigation']) {
  test(`${change} during ${completedKnown ? 'known completed' : 'prepared'} guest claim prevents a late continuation or workspace replacement`, async () => {
    let release;
    const claimWait = new Promise((resolve) => { release = resolve; });
    const completed = { ...preview, completed: true, preview_ready: false, analysis_pending: false };
    const f = fixture({ claimWait, ...(completedKnown ? {
      temporary: completed, draft: guestState.guestWorkspace(completed).draft,
      claimDraft: { resume_text: 'SERVER_RESUME', report: { run_id: 'local-guest:ready', score: 73 } },
    } : {}) });
    f.setupContinuationSpy();
    const login = f.login();
    await new Promise(setImmediate);
    assert.equal(f.calls.api.at(-1).path, '/guest/claim');
    f.invalidate(change);
    const current = f.snapshot();
    release();
    await login;
    assert.deepEqual(f.snapshot(), current);
    assert.equal(f.location.hash, '#/intro');
    assert.equal(f.calls.continuations.length, 0);
    if (completedKnown) {
      assert.equal(f.flowSnapshot().states.find(({ node }) => node === 'guest_claim')?.state, 'cancelled');
      assert.equal(f.flowSnapshot().states.find(({ node }) => node === 'result_delivery')?.state, 'cancelled');
    }
  });
}

test('a slow guest claim measures the full wait and never emits report display before completion', async () => {
  let release;
  const claimWait = new Promise((resolve) => { release = resolve; });
  const completed = { ...preview, completed: true, preview_ready: false, analysis_pending: false };
  const f = fixture({ claimWait, temporary: completed, draft: guestState.guestWorkspace(completed).draft,
    claimDraft: { report: { score: 0 }, pending_guest_analysis: false } });
  f.setupStoredReportRender();
  const login = f.login();
  await new Promise(setImmediate);
  assert.equal(f.flowSnapshot().states.find(({ node }) => node === 'result_delivery')?.state, 'pending');
  assert.equal(f.calls.reports.length, 0);
  f.advanceClock(4200);
  release();
  await login;
  const delivery = f.flowSnapshot().states.find(({ node }) => node === 'result_delivery');
  assert.equal(delivery.state, 'complete');
  assert.equal(delivery.durationMs, 4200);
  assert.equal(f.calls.reports.length, 1);
});

test('a failed claim cannot report a completed unlock or delivery time', async () => {
  const completed = { ...preview, completed: true, preview_ready: false, analysis_pending: false };
  const f = fixture({ temporary: completed, draft: guestState.guestWorkspace(completed).draft,
    claimError: Object.assign(new Error('temporary unavailable'), { status: 503 }) });
  f.setupStoredReportRender();
  await assert.rejects(f.login(), /temporary unavailable/);
  assert.equal(f.calls.reports.length, 0);
  const states = f.flowSnapshot().states;
  assert.equal(states.find(({ node }) => node === 'guest_claim')?.state, 'failed');
  assert.equal(states.find(({ node }) => node === 'result_delivery')?.state, 'failed');
});
