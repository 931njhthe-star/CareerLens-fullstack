import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { backendApi, enableBackendAdapter } from '../../src/shared/api/backend-adapter.js';

const TOKEN = 'careerlens.backend.access-token';
const BULK = '/jobs?limit=100&include_details=true';
class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function storage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}
const posting = (index, overrides = {}) => ({
  id: `job-${index}`, title: `등록 공고 ${index}`, company_id: `company-${index % 20}`,
  description: `서버 원문 ${index}`, location: index === 99 ? '부산' : '서울',
  requirements: ['실제 요건'], employment_type: '정규직',
  companies: { name: `현재 기업 ${index % 20}` }, ...overrides,
});
const call = (path, request, options = {}) => backendApi(path, options, request, ApiError);
beforeEach(() => {
  globalThis.sessionStorage = storage();
  sessionStorage.setItem(TOKEN, 'member-token');
  enableBackendAdapter();
});

test('100 current jobs and company names need two paginated bulk calls, not per-job hydration', async () => {
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    if (path === '/local-data/career-markdown') return { items: [] };
    if (path === BULK) return Array.from({ length: 100 }, (_, index) => posting(index));
    if (path === '/jobs?limit=100&offset=100&include_details=true') return [];
    assert.fail(`Unexpected per-record request: ${path}`);
  };
  const list = await call('/job-postings?location=부산', request);
  assert.equal(list.available_total, 100);
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, 'job-99');
  assert.equal(list.items[0].company, '현재 기업 19');
  assert.match(list.items[0].description, /서버 원문 99/);
  assert.deepEqual(calls, ['/local-data/career-markdown', BULK,
    '/jobs?limit=100&offset=100&include_details=true']);
});

test('bulk null fields stay unavailable without triggering 100 detail lookups', async () => {
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [] };
    assert.equal(path, BULK);
    return [posting(1, { description: null, companies: null, requirements: null })];
  };
  const list = await call('/job-postings', request);
  assert.equal(list.items[0].company, '기업 정보 없음');
  assert.equal(list.items[0].description, '');
});

test('role/list/filter reuse completed catalogs but selected detail is fetched fresh', async () => {
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    if (path === '/local-data/career-markdown') return { items: [] };
    if (path === BULK) return [posting(1), posting(99)];
    if (path === '/jobs/job-1') return posting(1, { description: '선택 시 갱신한 원문' });
    if (path === '/companies/company-1') return { name: '선택 시 갱신한 기업' };
    assert.fail(path);
  };
  await call('/career-roles', request);
  await call('/job-postings', request);
  const filtered = await call('/job-postings?location=부산', request);
  assert.equal(filtered.total, 1);
  const detail = await call('/job-postings/job-1', request);
  assert.match(detail.posting.description, /선택 시 갱신한 원문/);
  assert.equal(detail.posting.company, '선택 시 갱신한 기업');
  assert.deepEqual(calls, ['/local-data/career-markdown', BULK, '/jobs/job-1', '/companies/company-1']);
});

test('the completed list refreshes after 30 seconds and an aborted cache read is cancelled', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  let fetched = 0;
  Date.now = () => now;
  try {
    const request = async (path) => {
      if (path === '/local-data/career-markdown') return { items: [] };
      assert.equal(path, BULK);
      return [posting(++fetched)];
    };
    assert.equal((await call('/job-postings', request)).items[0].id, 'job-1');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(call('/job-postings', request, { signal: controller.signal }), { name: 'AbortError' });
    now += 29_999;
    assert.equal((await call('/job-postings', request)).items[0].id, 'job-1');
    now++;
    assert.equal((await call('/job-postings', request)).items[0].id, 'job-2');
    assert.equal(fetched, 2);
  } finally { Date.now = originalNow; }
});

test('account changes and logout cannot reuse a previous member list', async () => {
  let fetched = 0;
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [] };
    assert.equal(path, BULK);
    return [posting(++fetched)];
  };
  await call('/job-postings', request);
  sessionStorage.setItem(TOKEN, 'different-account-token');
  assert.equal((await call('/job-postings', request)).items[0].id, 'job-2');
  await call('/auth/logout', request, { method: 'POST' });
  sessionStorage.setItem(TOKEN, 'different-account-token');
  assert.equal((await call('/job-postings', request)).items[0].id, 'job-3');
});

test('a failed or aborted bulk request never populates the completed list cache', async () => {
  const controller = new AbortController();
  let fetched = 0;
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [] };
    assert.equal(path, BULK);
    fetched++;
    if (fetched === 1) throw new ApiError('서버 오류', 503);
    if (fetched === 2) controller.abort();
    return [posting(fetched)];
  };
  await assert.rejects(call('/job-postings', request), { status: 503 });
  await assert.rejects(call('/job-postings', request, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal((await call('/job-postings', request)).items[0].id, 'job-3');
  assert.equal(fetched, 3);
});
