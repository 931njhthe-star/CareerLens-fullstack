import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseAuthCallback, consumeAuthCallback } from '../../src/features/auth/auth-callback.js';
import { completeAuthCallback } from '../../src/shared/api/client.js';
import { publicErrorMessage } from '../../src/shared/api/error-messages.js';

beforeEach(() => {
  const values = new Map();
  globalThis.sessionStorage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
});

test('expired email callbacks show Korean recovery without echoing provider content', () => {
  const callback = parseAuthCallback(
    '#error=access_denied&error_code=otp_expired&error_description=%3Cscript%3Eunsafe%3C%2Fscript%3E',
  );
  assert.equal(callback.kind, 'error');
  assert.match(callback.message, /만료되었거나 이미 사용/);
  assert.match(callback.message, /가입한 이메일로 로그인/);
  assert.doesNotMatch(callback.message, /script|unsafe|회원가입 화면에서 다시/);
});

test('normal application routes and unrelated fragments are not authentication callbacks', () => {
  for (const hash of ['', '#/signup', '#/opportunities?role_id=custom', '#section']) {
    assert.equal(parseAuthCallback(hash), null);
  }
});

test('successful auth fragments are consumed and scrubbed before verification starts', () => {
  const location = {
    pathname: '/',
    search: '?view=desktop',
    hash: '#access_token=synthetic-access&refresh_token=synthetic-refresh&token_type=bearer&type=signup',
  };
  const replacements = [];
  const callback = consumeAuthCallback(location, {
    replaceState: (...args) => replacements.push(args),
  });
  assert.deepEqual(callback, {
    kind: 'session',
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
  });
  assert.equal(replacements[0][2], '/?view=desktop#/email');
  assert.doesNotMatch(replacements[0][2], /synthetic|access_token|refresh_token/);
});

test('recovery callbacks and incomplete credentials never create an authenticated callback', () => {
  assert.equal(
    parseAuthCallback('#access_token=fixture&refresh_token=fixture&type=recovery').kind,
    'error',
  );
  assert.match(
    parseAuthCallback('#access_token=fixture&refresh_token=fixture&type=recovery').message,
    /비밀번호 재설정/,
  );
  assert.equal(parseAuthCallback('#access_token=fixture').kind, 'error');
  assert.equal(
    parseAuthCallback('#access_token=fixture&refresh_token=fixture&token_type=other').kind,
    'error',
  );
});

test('candidate callback identity is validated by the backend before replacing stored credentials', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'previous-access');
  sessionStorage.setItem('careerlens.backend.refresh-token', 'previous-refresh');
  sessionStorage.setItem('careerlens.backend.guest', 'staged-resume-fixture');
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer candidate-access');
    assert.equal(sessionStorage.getItem('careerlens.backend.access-token'), 'previous-access');
    assert.equal(url, '/api/v1/me');
    return Response.json({ user_id: 'verified-member', display_name: '검증된 회원' });
  };
  try {
    const session = await completeAuthCallback({
      accessToken: 'candidate-access',
      refreshToken: 'candidate-refresh',
    });
    assert.equal(session.user.id, 'verified-member');
    assert.equal(session.user.name, '검증된 회원');
    assert.equal(sessionStorage.getItem('careerlens.backend.access-token'), 'candidate-access');
    assert.equal(sessionStorage.getItem('careerlens.backend.refresh-token'), 'candidate-refresh');
    assert.equal(sessionStorage.getItem('careerlens.backend.guest'), 'staged-resume-fixture');
    assert.deepEqual(calls, ['/api/v1/me']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejected callback never refreshes, overwrites the previous session, or loses guest staging', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'previous-access');
  sessionStorage.setItem('careerlens.backend.refresh-token', 'previous-refresh');
  sessionStorage.setItem('careerlens.backend.guest', 'staged-resume-fixture');
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json({ detail: 'Invalid candidate' }, { status: 401 });
  };
  try {
    await assert.rejects(
      completeAuthCallback({ accessToken: 'invalid-access', refreshToken: 'invalid-refresh' }),
      (error) => error.status === 401,
    );
    assert.equal(sessionStorage.getItem('careerlens.backend.access-token'), 'previous-access');
    assert.equal(sessionStorage.getItem('careerlens.backend.refresh-token'), 'previous-refresh');
    assert.equal(sessionStorage.getItem('careerlens.backend.guest'), 'staged-resume-fixture');
    assert.deepEqual(calls, ['/api/v1/me']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const controller = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace(/\bstart\(\);\s*$/, '');

test('startup clears the previous account sidebar even when replacement workspace loading fails', async () => {
  const disposed = [];
  const errorNode = { textContent: '', addEventListener() {} };
  const appNode = { dataset: {}, innerHTML: '' };
  const context = vm.createContext({
    beginFlowEvent() {}, finishFlowEvent() {}, recordFlowEvent() {},
    observeFlowProgress() {}, setFlowSession() {}, mountFlowLauncher() {},
    document: { getElementById: (id) => (id === 'app' ? appNode : errorNode) },
    location: { pathname: '/', search: '', hash: '#/mypage' },
    history: { replaceState() {} },
    window: { addEventListener() {} },
    URLSearchParams,
    publicErrorMessage,
    consumeAuthCallback: () => ({ kind: 'session' }),
    completeAuthCallback: async () => ({ user: { id: 'new-owner' } }),
    disposed,
  });
  vm.runInContext(controller, context);
  vm.runInContext(
    `
    session = { user: { id: 'old-owner' } };
    reportPickerState = { items: [{ id: 'OLD_PRIVATE_REPORT' }], expanded: true };
    reportPickerOwner = 'old-owner';
    disposeReportPicker = () => disposed.push('picker');
    disposeAdminDashboard = () => disposed.push('admin');
    loadWorkspace = async () => { throw new Error('PRIVATE_SERVER_PATH'); };
  `,
    context,
  );
  await vm.runInContext('start()', context);
  assert.deepEqual(disposed, ['picker', 'admin']);
  assert.equal(vm.runInContext('Object.keys(reportPickerState).length', context), 0);
  assert.equal(vm.runInContext('reportPickerOwner', context), undefined);
  assert.doesNotMatch(
    appNode.innerHTML + errorNode.textContent,
    /OLD_PRIVATE_REPORT|PRIVATE_SERVER_PATH/,
  );
});

test('startup scrubs and verifies callback before entering the existing guest-claim flow', async () => {
  const calls = [];
  const location = {
    pathname: '/',
    search: '',
    hash: '#access_token=synthetic&refresh_token=synthetic&type=signup',
  };
  const context = vm.createContext({
    beginFlowEvent() {}, finishFlowEvent() {}, recordFlowEvent() {},
    observeFlowProgress() {}, setFlowSession() {}, mountFlowLauncher() {},
    document: { getElementById: () => ({ dataset: {} }) },
    location,
    history: {
      replaceState(_state, _unused, url) {
        location.hash = url.slice(url.indexOf('#'));
        calls.push('scrub');
      },
    },
    window: { addEventListener() {} },
    URLSearchParams,
    consumeAuthCallback,
    parseAuthCallback,
    completeAuthCallback: async () => {
      assert.equal(location.hash, '#/email');
      calls.push('verify');
      return { user: { id: 'verified' } };
    },
    getSession: async () => {
      throw new Error('The verified session is already available');
    },
    practiceDestination: () => 'jobs/registered',
    notice: (message) => {
      assert.doesNotMatch(message, /synthetic/);
      calls.push('notice');
    },
    calls,
  });
  vm.runInContext(controller, context);
  vm.runInContext(
    `
    claimCompletedGuest = async () => { calls.push('claim'); return 'prepared'; };
    loadWorkspace = async () => { throw new Error('Claim already prepared workspace'); };
    render = () => calls.push('render');
  `,
    context,
  );
  await vm.runInContext('start()', context);
  assert.deepEqual(calls, ['scrub', 'verify', 'claim', 'scrub', 'render', 'notice']);
  assert.equal(location.hash, '#/jobs/registered');
});
