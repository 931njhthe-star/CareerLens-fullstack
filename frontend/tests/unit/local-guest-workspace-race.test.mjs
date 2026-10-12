import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { backendApi, enableBackendAdapter } from '../../src/shared/api/backend-adapter.js';

const TOKEN = 'careerlens.backend.access-token';
const STATE = 'careerlens.backend.workspace:account-a';
class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

beforeEach(() => {
  const data = new Map();
  globalThis.sessionStorage = {
    get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key),
  };
  sessionStorage.setItem(TOKEN, 'token-a');
  enableBackendAdapter();
});

const report = {
  run_id: 'stored-run', status: 'completed', storage_origin: 'frontend_guest',
  report_text: '# Report\n- 기업: Fixture A\n- 채용공고: Engineer\n',
  scores: { overall_score: 80.25, resume_completeness: 0, job_fit: 80.25, qualifications: 100, practical_competitiveness: 60 },
  criteria: [], completed_at: '2026-10-12T10:00:00Z', resume_text: 'Account A private resume',
};

async function harness(intercept = () => null) {
  const calls = [];
  let ready = false;
  const request = async (path, options = {}) => {
    calls.push({ path, token: sessionStorage.getItem(TOKEN) });
    if (ready) await intercept(path, options);
    if (path === '/local-guest/capabilities') return { available: true, storage_origin: 'frontend_guest' };
    if (path === '/me') return { user_id: 'account-a' };
    if (path === '/resumes?limit=100' || path === '/evaluations?limit=1') return [];
    if (path === '/local-guest/reports') return { reports: [report] };
    if (path === '/local-guest/reports/stored-run') return report;
    assert.fail(`Unexpected request ${path}`);
  };
  await backendApi('/auth/session', {}, request, ApiError);
  calls.length = 0;
  ready = true;
  return { calls, load: (options = {}) => backendApi('/workspace', options, request, ApiError) };
}

for (const boundary of ['/me', '/resumes?limit=100', '/evaluations?limit=1', '/local-guest/reports', '/local-guest/reports/stored-run']) {
  test(`workspace stops at account switch during ${boundary} without writing another account's state`, async () => {
    let release;
    let entered;
    const pending = new Promise((resolve) => { release = resolve; });
    const reached = new Promise((resolve) => { entered = resolve; });
    const { load, calls } = await harness(async (path) => {
      if (path === boundary) { entered(); await pending; }
    });
    const loading = load(); // Deliberately no signal, like the page's loadWorkspace.
    await reached;
    sessionStorage.setItem(TOKEN, 'token-b');
    release();
    await assert.rejects(loading, { name: 'AbortError' });
    assert.equal(sessionStorage.getItem(STATE), null);
    assert.ok(calls.every((call) => call.token === 'token-a'));
    assert.equal(calls.at(-1).path, boundary);
  });
}

test('same account still discovers and restores its claimed frontend report', async () => {
  const { load, calls } = await harness();
  const workspace = await load();
  assert.equal(workspace.draft.report.run_id, 'local-guest:stored-run');
  assert.equal(workspace.draft.report.score, 80.25);
  assert.equal(workspace.draft.report.score_components.resume_completeness.score, 0);
  assert.equal(workspace.draft.resume_text, report.resume_text);
  assert.equal(JSON.parse(sessionStorage.getItem(STATE)).claimed_resume_text, report.resume_text);
  assert.ok(calls.some((call) => call.path === '/local-guest/reports'));
});

test('aborted workspace ignores a late transport that does not honor AbortSignal', async () => {
  const controller = new AbortController();
  const { load } = await harness(async (path) => {
    if (path === '/resumes?limit=100') controller.abort();
  });
  await assert.rejects(load({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(sessionStorage.getItem(STATE), null);
});
