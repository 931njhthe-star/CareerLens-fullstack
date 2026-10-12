import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { guestWorkspace } from '../../src/features/analysis/guest-state.js';
import { draftForPage, remainingEdits } from '../../src/app/workspace-state.js';
import { workspacePage } from '../../src/pages/workspace.js';
import { createFlowStore } from '../../src/features/activity-flow/events.js';

// Run the actual controller with only the DOM/network boundaries stubbed.
// Removing module wiring and startup lets each test own the session lifecycle.
const controller = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace(/\bstart\(\);\s*$/, '');

function recoveryFixture(getSession, response = {}) {
  const flow = createFlowStore();
  flow.setSession('member');
  flow.record('auth', { kind: 'session' });
  flow.record('report');
  const requests = [];
  const context = vm.createContext({
    beginFlowEvent: flow.begin, finishFlowEvent: flow.finish, recordFlowEvent: flow.record,
    observeFlowProgress() {}, setFlowSession: flow.setSession, mountFlowLauncher() {},
    document: { getElementById: () => ({ dataset: {} }) },
    window: { addEventListener() {} },
    location: { search: '', hash: '#/jobs/chosen-posting' },
    URLSearchParams,
    setTimeout() {},
    clearTimeout() {},
    clearCatalogEdits() {},
    guestWorkspace,
    getSession,
    api: async (path) => {
      requests.push(path);
      return response;
    },
  });
  vm.runInContext(controller, context);
  vm.runInContext(
    `
    session = { user: { id: 'former-member' } };
    workspace = {
      draft: {
        resume_text: 'FORMER_MEMBER_PRIVATE_RESUME',
        filename: 'FORMER_MEMBER_PRIVATE_FILE.txt',
        career_target: { role_id: 'custom', label: 'Role', focus: 'FORMER_MEMBER_PRIVATE_FOCUS' },
        report: { score: 88, summary: 'FORMER_MEMBER_PRIVATE_REPORT' },
      },
      questions: [],
    };
    edits = { focus: 'FORMER_MEMBER_PRIVATE_UNSAVED' };
    selectedPosting = { id: 'FORMER_MEMBER_PRIVATE_POSTING', source_type: 'manual' };
    selectionOwner = session.user.id;
    guest.filename = 'FORMER_MEMBER_PRIVATE_GUEST_FILE';
    guest.target = workspace.draft.career_target;
    returnAfterLogin = 'result';
  `,
    context,
  );
  return {
    flowSnapshot: flow.snapshot,
    requests,
    recover: () => vm.runInContext('handleError({ status: 401 })', context),
    snapshot: () =>
      JSON.parse(
        vm.runInContext(
          'JSON.stringify({ session, workspace, edits, selectedPosting, selectionOwner, guest, returnAfterLogin, viewRevision })',
          context,
        ),
      ),
  };
}

function assertFormerMemberRemoved(state) {
  assert.equal(state.session.user, null);
  assert.ok(!JSON.stringify(state).includes('FORMER_MEMBER_PRIVATE'));
  assert.equal(state.workspace.draft.report, undefined);
  assert.equal(state.workspace.draft.resume_text, undefined);
  assert.deepEqual(state.edits, {});
  assert.equal(state.selectedPosting, null);
  assert.equal(state.selectionOwner, null);
  assert.equal(state.returnAfterLogin, null);
  const anonymousRolePage = workspacePage(
    'desired-role',
    draftForPage('desired-role', state.workspace.draft, state.edits),
    [],
  );
  assert.ok(!anonymousRolePage.includes('FORMER_MEMBER_PRIVATE'));
}

test('401 recovery clears member content before refresh and restores only allowlisted guest data', async () => {
  let finishRefresh;
  const fixture = recoveryFixture(
    () =>
      new Promise((resolve) => {
        finishRefresh = resolve;
      }),
    {
      draft: {
        resume_attached: true,
        filename: 'current-guest.txt',
        resume_text: 'UNEXPECTED_PRIVATE_RESUME',
        report: { score: 99, summary: 'UNEXPECTED_PRIVATE_REPORT' },
      },
      completed: true,
      report_locked: true,
    },
  );
  const recovery = fixture.recover();
  assert.equal(fixture.flowSnapshot().session.mode, 'guest', 'expiry is visible before slow session verification returns');
  assert.equal(fixture.flowSnapshot().states.find(({ node }) => node === 'auth').sessionMode, 'guest');
  assert.equal(fixture.flowSnapshot().states.some(({ node }) => node === 'report'), false);
  assertFormerMemberRemoved(fixture.snapshot());
  assert.equal(fixture.snapshot().viewRevision, 1);
  assert.deepEqual(fixture.requests, []);

  finishRefresh({ user: null });
  await recovery;
  const state = fixture.snapshot();
  assertFormerMemberRemoved(state);
  assert.deepEqual(fixture.requests, ['/guest/workspace']);
  assert.equal(state.workspace.draft.guest, true);
  assert.equal(state.workspace.draft.filename, 'current-guest.txt');
  assert.equal(state.workspace.draft.report_locked, true);
  assert.ok(!JSON.stringify(state).includes('UNEXPECTED_PRIVATE'));
});

test('failed session refresh cannot retain member content on anonymous routes', async () => {
  const fixture = recoveryFixture(async () => {
    throw new Error('Synthetic offline response');
  });
  await assert.rejects(fixture.recover(), /Synthetic offline response/);
  assert.equal(fixture.flowSnapshot().session.mode, 'guest');
  assert.equal(fixture.flowSnapshot().states.some(({ node }) => node === 'report'), false);
  assertFormerMemberRemoved(fixture.snapshot());
  assert.deepEqual(fixture.requests, []);
});

for (const when of ['before claim', 'during claim']) {
  test(`expired guest ${when} cannot open an older member report as the new result`, async () => {
    const location = { search: '', hash: '#/email' };
    const context = vm.createContext({
    beginFlowEvent() {}, finishFlowEvent() {}, recordFlowEvent() {},
    observeFlowProgress() {}, setFlowSession() {}, mountFlowLauncher() {},
      document: { getElementById: () => ({ dataset: {} }) },
      window: { addEventListener() {} },
      location,
      URLSearchParams,
      AbortController,
      setTimeout() {},
      clearTimeout() {},
      clearCatalogEdits() {},
      setSession() {},
      remainingEdits,
      api: async (path) => {
        if (path === '/guest/workspace')
          return when === 'before claim'
            ? { expired: true, completed: false }
            : { completed: true };
        if (path === '/guest/claim') throw Object.assign(new Error('expired'), { status: 410 });
        if (path === '/workspace')
          return { draft: { report: { score: 88, summary: 'OLDER REPORT' } }, questions: [] };
        throw new Error(`Unexpected request ${path}`);
      },
    });
    vm.runInContext(controller, context);
    // A fresh OAuth return also has no in-memory returnAfterLogin hint.
    await vm.runInContext('onSession({user:{id:"member"}})', context);
    assert.equal(location.hash, '/resume');
    assert.match(vm.runInContext('navigationMessage', context), /만료/);
  });
}
