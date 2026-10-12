import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { backendApi, enableBackendAdapter } from '../../src/shared/api/backend-adapter.js';

const GUEST = 'careerlens.backend.guest';
const TOKEN = 'careerlens.backend.access-token';
const MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE = `careerlens.backend.workspace:${MEMBER}`;
class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
function stored(key) { return JSON.parse(sessionStorage.getItem(key) || 'null'); }
function stage(overrides = {}) {
  const data = { resume_text: 'Synthetic QA resume', filename: 'fixture.md',
    selected_posting: { id: 'backup-001', role: 'QA engineer', company: 'Fixture', description: 'Untrusted client text' },
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), ...overrides };
  sessionStorage.setItem(GUEST, JSON.stringify(data));
  return data;
}
function metadata(overrides = {}) {
  return { run_id: 'guest-run', status: 'completed', completed: true, report_locked: true,
    current_stage: 'completed', progress_percent: 100, created_at: '2026-10-12T09:00:00Z',
    completed_at: '2026-10-12T09:02:00Z', storage_origin: 'frontend_guest', ...overrides };
}
function result(overrides = {}) {
  return { ...metadata(), owner_user_id: MEMBER, report_text: '# QA report\n- 채용공고: QA engineer\n- 기업: Fixture\n',
    scores: { overall_score: null, resume_completeness: 0, job_fit: 77.35, qualifications: null, practical_competitiveness: 52 },
    criteria: [], report_data: { criteria: [] }, job_id: 'backup-001',
    job_summary: { id: 'backup-001', title: 'QA engineer', company_name: 'Fixture' },
    job_snapshot: { id: 'backup-001', title: 'QA engineer', company_name: 'Fixture', description: 'Canonical server job' },
    resume_text: 'Synthetic QA resume', ...overrides };
}
function harness(overrides = {}) {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (overrides[path]) return overrides[path](options);
    if (path === '/local-guest/capabilities') return { available: true, storage_origin: 'frontend_guest' };
    if (path === '/local-guest/analyses') return metadata({ status: 'queued', completed: false, progress_percent: 0 });
    if (path === '/local-guest/analyses/guest-run') return metadata();
    if (path === '/local-guest/analyses/guest-run/claim') return result();
    if (path === '/local-guest/analyses/guest-run/cancel') return { cancelled: true };
    if (path === '/local-guest/analyses/cancel-pending') return { cancelled: true };
    if (path === '/local-guest/reports') return { reports: [metadata({ title: 'QA engineer', company_name: 'Fixture' })] };
    if (path === '/local-guest/reports/guest-run') return options.method === 'DELETE' ? { deleted: true } : result();
    if (path === '/me') return { user_id: MEMBER };
    if (path === '/resumes?limit=100' || path.startsWith('/evaluations?')) return [];
    assert.fail(`Unexpected request: ${path}`);
  };
  return { calls, request, api: (path, options = {}) => backendApi(path, options, request, ApiError) };
}
beforeEach(() => {
  const data = new Map();
  globalThis.sessionStorage = { get length() { return data.size; }, key: (i) => [...data.keys()][i],
    getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) };
  enableBackendAdapter();
});

test('real capability starts guest calculation from server job id and exposes only locked metadata', async () => {
  const { api, calls } = harness();
  stage();
  const session = await api('/auth/session');
  assert.equal(session.capabilities.guest_analysis, true);
  assert.equal(session.capabilities.guest_report_preview, false);
  const progress = [];
  const completed = await api('/guest/analysis', { method: 'POST', onProgress: (item) => progress.push(item) });
  assert.equal(completed.completed, true);
  assert.equal(completed.report_locked, true);
  assert.equal(completed.preview_ready, false);
  assert.equal(completed.draft.report, undefined);
  assert.equal(progress[0].run.id, 'local-guest:guest-run');
  assert.equal(progress[0].run.progress_percent, 100);
  const create = calls.find((call) => call.path === '/local-guest/analyses');
  assert.equal(create.options.auth, false);
  assert.deepEqual(Object.keys(create.options.body).sort(), ['expires_at', 'job_id', 'resume_text']);
  assert.equal(create.options.body.job_id, 'backup-001');
  assert.match(create.options.idempotencyKey, /^[\da-f-]{36}$/i);
  assert.equal(stored(GUEST).local_run.idempotency_key, create.options.idempotencyKey);
  assert.equal(JSON.stringify(stored(GUEST)).includes('report_text'), false);
  assert.equal(calls.some((call) => call.path.startsWith('/jobs') || call.path.startsWith('/evaluations')), false);
});

test('refresh and resumed guest analysis poll the same run without recalculation', async () => {
  const { api, calls } = harness();
  stage({ local_run: { id: 'guest-run', status: 'running', idempotency_key: 'fixed-intent' } });
  const workspace = await api('/guest/workspace');
  assert.equal(workspace.completed, true);
  await api('/guest/analysis', { method: 'POST' });
  assert.equal(calls.filter((call) => call.path === '/local-guest/analyses').length, 0);
  assert.equal(stored(GUEST).local_run.idempotency_key, 'fixed-intent');
});

test('guest analysis forwards private-free engine observations without keeping events in browser storage', async () => {
  const { api } = harness({ '/local-guest/analyses/guest-run': () => metadata({ analysis_duration_ms: 81234,
    flow_events: [
      { id: 1, node: 'parse_job', state: 'complete', durationMs: 200, job_text: 'PRIVATE_JOB' },
      { id: 2, node: 'guest_store', state: 'complete', report: 'PRIVATE_REPORT' },
      { id: 3, node: 'database', state: 'complete' },
    ] }) });
  stage();
  await api('/auth/session');
  const progress = [];
  await api('/guest/analysis', { method: 'POST', onProgress: (item) => progress.push(item) });
  assert.equal(progress[0].execution, 'guest');
  assert.equal(progress[0].durationMs, 81234);
  assert.deepEqual(progress[0].flowEvents, [
    { id: 1, node: 'parse_job', state: 'complete', durationMs: 200 },
    { id: 2, node: 'guest_store', state: 'complete', durationMs: null },
  ]);
  assert.doesNotMatch(JSON.stringify(progress), /PRIVATE|database/);
  assert.equal(stored(GUEST).local_run.flow_events, undefined);
  assert.equal(stored(GUEST).local_run.flowEvents, undefined);
});

test('restoring a guest workspace forwards durable progress to reconnect the live flow', async () => {
  const { api, calls } = harness({ '/local-guest/analyses/guest-run': () => metadata({
    analysis_duration_ms: 65432,
    flow_events: [{ id: 1, node: 'guest_store', state: 'complete', private_report: 'PRIVATE_REPORT' }],
  }) });
  stage({ local_run: { id: 'guest-run', status: 'running', idempotency_key: 'same-run' } });
  const updates = [];
  const restored = await api('/guest/workspace', { onProgress: (value) => updates.push(value) });
  assert.equal(restored.completed, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].execution, 'guest');
  assert.equal(updates[0].durationMs, 65432);
  assert.deepEqual(updates[0].flowEvents, [{ id: 1, node: 'guest_store', state: 'complete', durationMs: null }]);
  assert.equal(calls.length, 1, 'restoring flow never starts another evaluation');
  assert.doesNotMatch(JSON.stringify(updates), /PRIVATE_REPORT/);
});

test('uncertain creation retries with the retained idempotency key', async () => {
  let attempt = 0;
  const keys = [];
  const { api } = harness({ '/local-guest/analyses': (options) => {
    keys.push(options.idempotencyKey);
    if (!attempt++) throw new ApiError('uncertain', 503);
    return metadata();
  } });
  stage();
  await api('/auth/session');
  await assert.rejects(api('/guest/analysis', { method: 'POST' }), (failure) => failure.status === 503);
  assert.equal((await api('/guest/analysis', { method: 'POST' })).completed, true);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test('cancellation before the creation reply disarms the intent and cancels the returned run', async () => {
  let release;
  const accepted = new Promise((resolve) => { release = resolve; });
  const { api, calls } = harness({ '/local-guest/analyses': (options) => {
    assert.equal(options.signal, undefined, 'keep the accepted run ID reachable after caller abort');
    return accepted;
  } });
  stage();
  await api('/auth/session');
  const controller = new AbortController();
  const pending = api('/guest/analysis', { method: 'POST', signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await api('/guest/analysis/cancel', { method: 'POST' });
  const stop = calls.find((call) => call.path === '/local-guest/analyses/cancel-pending');
  assert.ok(stop.options.body.idempotency_key);
  release(metadata({ status: 'running', completed: false }));
  await rejected;
  assert.equal(calls.filter((call) => call.path === '/local-guest/analyses/guest-run/cancel').length, 1);
  assert.equal(stored(GUEST).completed, false);
  assert.equal(stored(GUEST).local_run, null);
});

test('claim associates a calculated report without uploading or creating a second evaluation', async () => {
  const { api, calls } = harness();
  stage({ completed: true, local_run: { id: 'guest-run', status: 'completed', idempotency_key: 'fixed' } });
  sessionStorage.setItem(TOKEN, 'owner-token');
  const claimed = await api('/guest/claim', { method: 'POST' });
  assert.equal(claimed.draft.report.run_id, 'local-guest:guest-run');
  assert.equal(claimed.draft.report.score_components.resume_completeness.score, 0);
  assert.equal(claimed.draft.report.score_components.job_fit.score, 77.35);
  assert.equal(claimed.draft.report.score_components.qualifications.score, null);
  assert.equal(claimed.draft.report.score, null);
  assert.equal(claimed.draft.report.storage_origin, 'frontend_guest');
  assert.equal(stored(GUEST), null);
  assert.equal(stored(WORKSPACE).pending_guest_analysis, false);
  assert.deepEqual(calls.map((call) => call.path), ['/local-guest/analyses/guest-run/claim']);
  assert.equal(calls[0].options.accessToken, 'owner-token');
  const restored = await api('/workspace');
  assert.equal(restored.draft.report.run_id, 'local-guest:guest-run');
  assert.equal(restored.draft.resume_text, 'Synthetic QA resume');
  assert.equal(calls.some((call) => call.path === '/resumes' || call.path === '/evaluations'), false);
});

test('local claim rejects account replacement and leaves pending guest data recoverable', async () => {
  const { api } = harness({ '/local-guest/analyses/guest-run/claim': () => {
    sessionStorage.setItem(TOKEN, 'replacement-token');
    return result();
  } });
  stage({ completed: true, local_run: { id: 'guest-run', status: 'completed', idempotency_key: 'fixed' } });
  sessionStorage.setItem(TOKEN, 'owner-token');
  await assert.rejects(api('/guest/claim', { method: 'POST' }), { name: 'AbortError' });
  assert.equal(stored(WORKSPACE), null);
  assert.equal(stored(GUEST).local_run.id, 'guest-run');
});

test('local claim requires the owner verified by the frontend server before storing the report', async () => {
  for (const owner_user_id of [undefined, '', 'guessed-member']) {
    const { api, calls } = harness({ '/local-guest/analyses/guest-run/claim': () => result({ owner_user_id }) });
    stage({ completed: true, local_run: { id: 'guest-run', status: 'completed', idempotency_key: 'fixed' } });
    sessionStorage.setItem(TOKEN, 'owner-token');
    await assert.rejects(api('/guest/claim', { method: 'POST' }), (failure) => failure.code === 'report_owner_invalid');
    assert.equal(stored(WORKSPACE), null);
    assert.equal(stored(GUEST).local_run.id, 'guest-run');
    assert.deepEqual(calls.map((call) => call.path), ['/local-guest/analyses/guest-run/claim']);
  }
});

test('guest report restoration keeps the analysed resume when this account has an older backend resume', async () => {
  const { api } = harness({
    '/resumes?limit=100': () => [{ id: 'old-member-resume' }],
    '/resumes/old-member-resume': () => ({ id: 'old-member-resume', original_text: 'Unrelated older resume' }),
  });
  stage({ completed: true, local_run: { id: 'guest-run', status: 'completed', idempotency_key: 'fixed' } });
  sessionStorage.setItem(TOKEN, 'owner-token');
  await api('/guest/claim', { method: 'POST' });
  const restored = await api('/workspace');
  assert.equal(restored.draft.resume_text, 'Synthetic QA resume');
  assert.equal(restored.draft.resume_id, '');
  assert.equal(stored(WORKSPACE).resume_id, '');
  assert.equal(restored.draft.report.run_id, 'local-guest:guest-run');
});

test('authenticated session checks profile and guest capability in parallel', async () => {
  let releaseCapabilities;
  const capabilities = new Promise((resolve) => { releaseCapabilities = resolve; });
  const { api, calls } = harness({ '/local-guest/capabilities': () => capabilities });
  sessionStorage.setItem(TOKEN, 'owner-token');
  const pending = api('/auth/session');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((call) => call.path), ['/local-guest/capabilities', '/me']);
  releaseCapabilities({ available: true, storage_origin: 'frontend_guest' });
  assert.equal((await pending).user.id, MEMBER);
});

test('cancel clears local intent before a late response and cannot revive a report', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { api } = harness({ '/local-guest/analyses/guest-run': () => pending });
  stage({ local_run: { id: 'guest-run', status: 'running', idempotency_key: 'fixed' } });
  const running = api('/guest/analysis', { method: 'POST' });
  await api('/guest/analysis/cancel', { method: 'POST' });
  release(metadata());
  await assert.rejects(running, { name: 'AbortError' });
  assert.equal(stored(GUEST).local_run, null);
  assert.equal(stored(GUEST).completed, false);
});

test('deleting guest workspace deletes server temporary analysis while dropping local inputs', async () => {
  const { api, calls } = harness();
  stage({ local_run: { id: 'guest-run', status: 'completed', idempotency_key: 'fixed' } });
  await api('/guest/workspace', { method: 'DELETE' });
  assert.equal(stored(GUEST), null);
  assert.equal(calls[0].path, '/local-guest/analyses/guest-run');
  assert.equal(calls[0].options.method, 'DELETE');
});

test('owned local reports appear with existing reports and support direct read/context/delete', async () => {
  const { api, calls } = harness({ '/evaluations?limit=20&offset=0': () => [
    { id: 'backend-run', status: 'completed', created_at: '2026-10-10T00:00:00Z' },
  ] });
  sessionStorage.setItem(TOKEN, 'owner-token');
  await api('/auth/session');
  const list = await api('/account/reports');
  assert.deepEqual(list.items.map((item) => item.id), ['local-guest:guest-run', 'backend-run']);
  assert.equal(list.items[0].storage_origin, 'frontend_guest');
  const direct = await api('/account/reports/local-guest%3Aguest-run');
  assert.equal(direct.draft.report.backend_report_text, result().report_text);
  const context = await api('/account/reports/local-guest%3Aguest-run/context');
  assert.deepEqual(context.job_context, { company: 'Fixture', title: 'QA engineer' });
  sessionStorage.setItem(WORKSPACE, JSON.stringify({ report: direct.draft.report }));
  await api('/account/reports/local-guest%3Aguest-run', { method: 'DELETE' });
  assert.equal(stored(WORKSPACE).report, null);
  assert.equal(stored(WORKSPACE).suppress_latest_report, true);
  assert.equal(calls.filter((call) => call.path === '/local-guest/reports/guest-run' && call.options.method === 'DELETE').length, 1);
});

test('login on another tab restores an owned local report from server storage', async () => {
  const { api } = harness();
  sessionStorage.setItem(TOKEN, 'owner-token');
  await api('/auth/session');
  const restored = await api('/workspace');
  assert.equal(restored.draft.report.run_id, 'local-guest:guest-run');
  assert.equal(restored.draft.resume_text, 'Synthetic QA resume');
});

test('incomplete and foreign-origin results cannot become a claimed report', async () => {
  for (const overrides of [{ status: 'running' }, { report_text: '' }, { storage_origin: 'other' }]) {
    const { api } = harness({ '/local-guest/analyses/guest-run/claim': () => result(overrides) });
    stage({ local_run: { id: 'guest-run', status: 'completed', idempotency_key: 'fixed' } });
    sessionStorage.setItem(TOKEN, 'owner-token');
    await assert.rejects(api('/guest/claim', { method: 'POST' }), (failure) => failure.code === 'report_result_invalid');
    assert.equal(stored(WORKSPACE), null);
    assert.ok(stored(GUEST));
  }
});

test('stored reports remain available when new local analysis is disabled', async () => {
  const { api } = harness({ '/local-guest/capabilities': () => ({ available: false, storage_origin: 'frontend_guest' }) });
  sessionStorage.setItem(TOKEN, 'owner-token');
  assert.equal((await api('/auth/session')).capabilities.guest_analysis, false);
  assert.equal((await api('/account/reports')).items[0].id, 'local-guest:guest-run');
});

test('server expiry clears stale guest input and never queues a replacement analysis', async () => {
  const { api, calls } = harness({ '/local-guest/analyses/guest-run': () => { throw new ApiError('expired', 410); } });
  for (const path of ['/guest/workspace', '/guest/analysis']) {
    stage({ local_run: { id: 'guest-run', status: 'running', idempotency_key: 'fixed' } });
    await assert.rejects(api(path, { method: path.endsWith('analysis') ? 'POST' : 'GET' }), (failure) => failure.code === 'guest_expired');
    assert.equal(stored(GUEST), null);
  }
  assert.equal(calls.some((call) => call.path === '/local-guest/analyses'), false);
});
