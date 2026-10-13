import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptBackendAuthCallback,
  backendApi,
  enableBackendAdapter,
  captureBackendSession,
  storeBackendCredentials,
} from '../../src/shared/api/backend-adapter.js';

function createStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

globalThis.sessionStorage = createStorage();
enableBackendAdapter();

beforeEach(() => {
  globalThis.sessionStorage = createStorage();
});

for (const profileOutcome of ['member', 'unauthorized', 'guest']) {
  test(`a delayed ${profileOutcome} session capability response cannot replace a newer login`, async () => {
    if (profileOutcome !== 'guest') sessionStorage.setItem('careerlens.backend.access-token', 'old-owner');
    let release;
    const capabilities = new Promise((resolve) => { release = resolve; });
    const pending = backendApi('/auth/session', {}, async (path) => {
      if (path === '/local-guest/capabilities') return capabilities;
      if (profileOutcome === 'unauthorized') throw new ApiError('expired', 401);
      return { user_id: 'old-owner' };
    }, ApiError);
    await new Promise((resolve) => setImmediate(resolve));
    storeBackendCredentials({ access_token: 'new-owner', refresh_token: 'new-refresh' });
    release({ available: true, storage_origin: 'frontend_guest' });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(sessionStorage.getItem('careerlens.backend.access-token'), 'new-owner');
    assert.equal(sessionStorage.getItem('careerlens.backend.refresh-token'), 'new-refresh');
  });
}

for (const path of ['/auth/login', '/auth/register', '/auth/callback']) {
  test(`a delayed ${path} response never overwrites a newer login`, async () => {
    let release;
    const transport = () => new Promise((resolve) => { release = resolve; });
    const pending = path === '/auth/callback'
      ? acceptBackendAuthCallback({ accessToken: 'old-candidate', refreshToken: 'old-refresh' }, transport, ApiError)
      : backendApi(path, { method: 'POST', body: { email: 'fixture@example.test', password: 'fixture' } }, transport, ApiError);
    storeBackendCredentials({ access_token: 'new-owner', refresh_token: 'new-refresh' });
    release(path === '/auth/callback' ? { user_id: 'old-owner' } : { access_token: 'old-owner', refresh_token: 'old-refresh' });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(sessionStorage.getItem('careerlens.backend.access-token'), 'new-owner');
  });
  test(`a delayed ${path} failure is cancellation rather than a newer account authentication error`, async () => {
    let reject;
    const transport = () => new Promise((_resolve, fail) => { reject = fail; });
    const pending = path === '/auth/callback'
      ? acceptBackendAuthCallback({ accessToken: 'old-candidate', refreshToken: 'old-refresh' }, transport, ApiError)
      : backendApi(path, { method: 'POST', body: { email: 'fixture@example.test', password: 'fixture' } }, transport, ApiError);
    storeBackendCredentials({ access_token: 'new-owner' });
    reject(new ApiError('old request rejected', 401));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(sessionStorage.getItem('careerlens.backend.access-token'), 'new-owner');
  });
}

test('member file conversion cannot upload the old account resume to a replacement account', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'old-owner');
  let release;
  const form = new FormData(); form.set('file', new Blob(['synthetic resume']), 'fixture.md');
  const requests = [];
  const pending = backendApi('/resume/upload', { method: 'POST', body: form }, async (path) => {
    requests.push(path);
    if (path === '/local-data/convert-resume') return new Promise((resolve) => { release = resolve; });
    assert.fail('The replacement account must receive no resume write');
  }, ApiError);
  storeBackendCredentials({ access_token: 'new-owner' });
  release({ text: 'old account resume' });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(requests, ['/local-data/convert-resume']);
  assert.equal(sessionStorage.getItem('careerlens.backend.workspace:new-owner'), null);
});

test('saved report pages filter completed evaluations while paging over the original run count', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const controller = new AbortController();
  const page = Array.from({ length: 20 }, (_, index) => ({
    id: `run-${index}`,
    status: index === 4 ? 'completed' : index === 18 ? 'partial' : 'failed',
    created_at: '2026-10-10T10:00:00Z',
    progress_percent: 100,
  }));
  const calls = [];
  const request = async (path, options) => {
    calls.push(path);
    assert.equal(options.signal, controller.signal);
    return path.endsWith('offset=200') ? page : [];
  };
  const first = await backendApi(
    '/account/reports?offset=200',
    { signal: controller.signal },
    request,
    ApiError,
  );
  assert.deepEqual(first, {
    items: [
      { id: 'run-4', status: 'completed', created_at: page[4].created_at },
      { id: 'run-18', status: 'partial', created_at: page[18].created_at },
    ],
    next_offset: 220,
  });
  const last = await backendApi(
    '/account/reports?offset=220',
    { signal: controller.signal },
    request,
    ApiError,
  );
  assert.deepEqual(last, { items: [], next_offset: null });
  assert.deepEqual(calls, ['/evaluations?limit=20&offset=200', '/evaluations?limit=20&offset=220']);
});

test('saved report list uses database evaluations without querying local guest reports', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    if (path === '/local-guest/capabilities')
      return { available: true, storage_origin: 'frontend_guest' };
    if (path === '/me') return { user_id: 'member-1' };
    if (path === '/evaluations?limit=20&offset=0')
      return [{ id: 'db-run', status: 'completed', created_at: '2026-10-10T10:00:00Z' }];
    assert.fail(`Unexpected request: ${path}`);
  };
  await backendApi('/auth/session', {}, request, ApiError);
  const result = await backendApi('/account/reports', {}, request, ApiError);
  assert.deepEqual(result.items.map(({ id }) => id), ['db-run']);
  assert.deepEqual(calls, [
    '/local-guest/capabilities',
    '/me',
    '/evaluations?limit=20&offset=0',
  ]);
});

test('saved report list validates offsets and upstream arrays', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  for (const offset of ['-1', '1.5', 'NaN', '1e2', '', '9007199254740992']) {
    await assert.rejects(
      backendApi(
        `/account/reports?offset=${offset}`,
        {},
        async () => assert.fail('Invalid offset must not call API'),
        ApiError,
      ),
      (failure) => failure.status === 400 && failure.code === 'report_offset_invalid',
    );
  }
  for (const response of [{ items: [] }, null, [null], [{ id: 'run', status: 'completed' }]]) {
    await assert.rejects(
      backendApi(
        '/account/reports',
        {},
        async (path) => {
          assert.equal(path, '/evaluations?limit=20&offset=0');
          return response;
        },
        ApiError,
      ),
      (failure) => failure.status === 502 && failure.code === 'report_list_invalid',
    );
  }
});

test('saved report access requires a token without reading the active workspace', async () => {
  for (const path of [
    '/account/reports',
    '/account/reports/old-run',
    '/account/reports/old-run/context',
  ]) {
    await assert.rejects(
      backendApi(
        path,
        {},
        async () => assert.fail('Unauthenticated report access must not call API'),
        ApiError,
      ),
      (failure) => failure.status === 401 && failure.code === 'login_required',
    );
  }
});

test('dashboard evaluation list and detail requests reach the authenticated backend', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const calls = [];
  const request = async (path, options) => {
    calls.push({ path, options });
    return path === '/evaluations?limit=100&offset=0'
      ? [{ id: 'run-1', status: 'completed', created_at: '2026-10-13T00:00:00Z' }]
      : { id: 'run-1', status: 'completed' };
  };
  const runs = await backendApi('/evaluations?limit=100&offset=0', {}, request, ApiError);
  const runId = '11111111-1111-4111-8111-111111111111';
  const run = await backendApi(`/evaluations/${runId}`, {}, request, ApiError);
  assert.equal(runs[0].id, 'run-1');
  assert.equal(run.id, 'run-1');
  assert.deepEqual(calls.map(({ path }) => path), [
    '/evaluations?limit=100&offset=0',
    `/evaluations/${runId}`,
  ]);
});

test('opening a saved report loads its latest completed document without reading or mutating the current draft', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const workspaceKey = 'careerlens.backend.workspace:user-1';
  const current = JSON.stringify({
    resume_id: 'current-resume',
    selected_posting: { company: '현재 회사', role: '현재 공고' },
    report: { run_id: 'current-run' },
  });
  sessionStorage.setItem(workspaceKey, current);
  const originalGet = sessionStorage.getItem;
  sessionStorage.getItem = (key) => {
    assert.notEqual(key, workspaceKey);
    assert.notEqual(key, 'careerlens.backend.workspace');
    return originalGet(key);
  };
  sessionStorage.setItem = () => assert.fail('Saved report viewing must not change stored state');
  const controller = new AbortController();
  const calls = [];
  const reportText =
    '# 과거 평가 보고서\n- 채용공고: 저장 당시 공고\n- 기업: 저장 당시 회사\n\n## 평가 결과\n';
  const result = {
    run_id: 'old-run',
    overall_score: null,
    resume_completeness: 72,
    job_fit: 64,
    qualifications: null,
    practical_competitiveness: 56,
    validation_status: 'partial',
    criteria: [],
    reports: [
      { id: 'new-pending', status: 'pending', created_at: '2026-10-12T12:00:00Z' },
      { id: 'older', status: 'completed', created_at: '2026-10-10T12:00:00Z' },
      { id: 'latest-completed', status: 'completed', created_at: '2026-10-11T12:00:00Z' },
    ],
  };
  const workspace = await backendApi(
    '/account/reports/old-run',
    { signal: controller.signal },
    async (path, options) => {
      calls.push(path);
      assert.equal(options.signal, controller.signal);
      if (path === '/evaluations/old-run')
        return { id: 'old-run', status: 'partial', completed_at: '2026-10-10T10:10:00Z' };
      if (path === '/evaluations/old-run/result') return result;
      if (path === '/reports/latest-completed')
        return { status: 'completed', report_text: reportText };
      assert.fail(`Saved report view made unexpected request ${path}`);
    },
    ApiError,
  );
  assert.deepEqual(calls, [
    '/evaluations/old-run',
    '/evaluations/old-run/result',
    '/reports/latest-completed',
  ]);
  assert.deepEqual(Object.keys(workspace.draft).sort(), [
    'analysis_mode',
    'company',
    'created_at',
    'report',
    'role',
    'saved_report',
  ]);
  assert.equal(workspace.draft.analysis_mode, 'saved_report');
  assert.equal(workspace.draft.saved_report, true);
  assert.equal(workspace.draft.company, '저장 당시 회사');
  assert.equal(workspace.draft.role, '저장 당시 공고');
  assert.equal(workspace.draft.created_at, '2026-10-10T10:10:00Z');
  assert.equal(workspace.draft.report.run_id, 'old-run');
  assert.equal(workspace.draft.report.score, null);
  assert.equal(workspace.draft.report.score_components.resume_completeness.score, 72);
  assert.equal(workspace.draft.report.backend_report_text, reportText);
  assert.deepEqual(workspace.draft.report.job_context, {
    title: '저장 당시 공고',
    company: '저장 당시 회사',
    source: 'report',
  });
  assert.deepEqual(workspace.questions, []);
  assert.equal(originalGet(workspaceKey), current);
});

test('saved report loading rejects unfinished or missing reports and preserves owner errors', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  for (const status of ['queued', 'running', 'failed', 'cancelled']) {
    await assert.rejects(
      backendApi(
        '/account/reports/run-1',
        {},
        async (path) => {
          assert.equal(path, '/evaluations/run-1');
          return { id: 'run-1', status };
        },
        ApiError,
      ),
      (failure) => failure.status === 409 && failure.code === 'saved_report_incomplete',
    );
  }
  for (const fixture of [
    { result: { criteria: [], reports: [] }, code: 'saved_report_missing', status: 404 },
    {
      result: { criteria: [], reports: [{ id: 'r', status: 'pending' }] },
      code: 'saved_report_missing',
      status: 404,
    },
    { result: { criteria: [], reports: 'invalid' }, code: 'report_result_invalid', status: 502 },
    {
      report: { status: 'pending', report_text: 'draft' },
      code: 'saved_report_incomplete',
      status: 409,
    },
    { report: { status: 'completed', report_text: '  ' }, code: 'saved_report_empty', status: 502 },
  ]) {
    await assert.rejects(
      backendApi(
        '/account/reports/run-1',
        {},
        async (path) => {
          if (path === '/evaluations/run-1') return { id: 'run-1', status: 'completed' };
          if (path.endsWith('/result'))
            return fixture.result || { criteria: [], reports: [{ id: 'r', status: 'completed' }] };
          return fixture.report;
        },
        ApiError,
      ),
      (failure) => failure.status === fixture.status && failure.code === fixture.code,
    );
  }
  const ownerFailure = new ApiError('자료를 찾을 수 없습니다.', 404);
  await assert.rejects(
    backendApi(
      '/account/reports/not-owned',
      {},
      async (path) => {
        assert.equal(path, '/evaluations/not-owned');
        throw ownerFailure;
      },
      ApiError,
    ),
    (failure) => failure === ownerFailure,
  );
});

test('demo saved report history is empty and never contacts the real API', async () => {
  sessionStorage.setItem('careerlens.backend.demo-session', 'true');
  const request = async () => assert.fail('Demo history must not call the actual backend');
  assert.deepEqual(await backendApi('/account/reports', {}, request, ApiError), {
    items: [],
    next_offset: null,
    demo: true,
  });
  for (const path of ['/account/reports/real-id', '/account/reports/real-id/context']) {
    await assert.rejects(
      backendApi(path, {}, request, ApiError),
      (failure) => failure.status === 404 && failure.code === 'saved_report_missing',
    );
  }
});

test('saved report context reads the newest completed document and never the active workspace', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const originalGet = sessionStorage.getItem;
  sessionStorage.getItem = (key) => {
    assert.ok(!key.startsWith('careerlens.backend.workspace'));
    return originalGet(key);
  };
  sessionStorage.setItem = () =>
    assert.fail('Reading a report context must not persist a workspace');
  const calls = [];
  const controller = new AbortController();
  const context = await backendApi(
    '/account/reports/old-run/context',
    { signal: controller.signal },
    async (path, options) => {
      calls.push(path);
      assert.equal(options.signal, controller.signal);
      if (path === '/evaluations/old-run/result') {
        return {
          criteria: [],
          reports: [
            { id: 'old', status: 'completed', created_at: '2026-10-09T00:00:00Z' },
            { id: 'still-pending', status: 'pending', created_at: '2026-10-12T00:00:00Z' },
            { id: 'completed', status: 'completed', created_at: '2026-10-11T00:00:00Z' },
          ],
        };
      }
      if (path === '/reports/completed') {
        return {
          status: 'completed',
          report_text:
            '# 저장 보고서\n- 채용공고: 과거 공고\n- 기업: 과거 회사\n\n## 근거\n- 기업: 다른 회사',
        };
      }
      assert.fail(`Report context requested unrelated data: ${path}`);
    },
    ApiError,
  );
  assert.deepEqual(context, {
    job_context: { title: '과거 공고', company: '과거 회사', source: 'report' },
  });
  assert.deepEqual(calls, ['/evaluations/old-run/result', '/reports/completed']);
});

test('saved report title and company survive clearing storage and opening on another device', async () => {
  const reportText = '# 분석 보고서\n- 채용공고: 저장된 RAG 개발자 공고\n- 기업: 저장된 기업';
  const request = async (path) => {
    if (path === '/evaluations/saved-run')
      return { id: 'saved-run', status: 'completed', completed_at: '2026-10-09T01:00:00Z' };
    if (path === '/evaluations/saved-run/result')
      return { criteria: [], reports: [{ id: 'saved-body', status: 'completed' }] };
    if (path === '/reports/saved-body') return { status: 'completed', report_text: reportText };
    assert.fail(`Saved report must be restored only from the owner's report APIs: ${path}`);
  };
  sessionStorage.setItem('careerlens.backend.access-token', 'first-device-token');
  sessionStorage.setItem(
    'careerlens.backend.workspace:member',
    JSON.stringify({
      role: '새로운 직무',
      company: '새로운 회사',
      resume_text: '현재 작성 중인 이력서',
    }),
  );
  const first = await backendApi('/account/reports/saved-run', {}, request, ApiError);
  globalThis.sessionStorage = createStorage();
  sessionStorage.setItem('careerlens.backend.access-token', 'second-device-token');
  const restored = await backendApi('/account/reports/saved-run', {}, request, ApiError);
  assert.deepEqual(restored, first);
  assert.equal(restored.draft.role, '저장된 RAG 개발자 공고');
  assert.equal(restored.draft.company, '저장된 기업');
  assert.equal(sessionStorage.length, 1);
});

test('saved reports without posting metadata never substitute the currently selected posting', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  sessionStorage.setItem(
    'careerlens.backend.workspace:member',
    JSON.stringify({
      role: '현재 공고',
      company: '현재 회사',
      selected_posting: { title: '현재 공고', company: '현재 회사' },
    }),
  );
  const restored = await backendApi(
    '/account/reports/old-run',
    {},
    async (path) => {
      if (path === '/evaluations/old-run') return { id: 'old-run', status: 'partial' };
      if (path === '/evaluations/old-run/result')
        return { criteria: [], reports: [{ id: 'body', status: 'completed' }] };
      if (path === '/reports/body')
        return { status: 'completed', report_text: '# 메타데이터 없는 보고서' };
      assert.fail(`Unexpected request: ${path}`);
    },
    ApiError,
  );
  assert.equal(restored.draft.role, '대상 공고 정보 없음');
  assert.equal(restored.draft.company, '');
  assert.deepEqual(restored.draft.report.job_context, { title: '', company: '', source: 'report' });
});

test('saved report context preserves authorization failures from both owner-protected APIs', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  for (const deniedPath of ['/evaluations/other-run/result', '/reports/other-body']) {
    const denied = new ApiError('권한이 없습니다.', 403, 'forbidden');
    const calls = [];
    await assert.rejects(
      backendApi(
        '/account/reports/other-run/context',
        {},
        async (path) => {
          calls.push(path);
          if (path === deniedPath) throw denied;
          assert.equal(path, '/evaluations/other-run/result');
          return { criteria: [], reports: [{ id: 'other-body', status: 'completed' }] };
        },
        ApiError,
      ),
      (failure) => failure === denied,
    );
    assert.deepEqual(
      calls,
      deniedPath.endsWith('/result')
        ? ['/evaluations/other-run/result']
        : ['/evaluations/other-run/result', '/reports/other-body'],
    );
  }
});

test('saved report context propagates aborts instead of returning cached or current posting data', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const controller = new AbortController();
  const aborted = new DOMException('Aborted', 'AbortError');
  const calls = [];
  await assert.rejects(
    backendApi(
      '/account/reports/old-run/context',
      {
        signal: controller.signal,
      },
      async (path, options) => {
        calls.push(path);
        assert.equal(options.signal, controller.signal);
        controller.abort();
        throw aborted;
      },
      ApiError,
    ),
    (failure) => failure === aborted,
  );
  assert.deepEqual(calls, ['/evaluations/old-run/result']);
});

test('saved report context validates upstream results and completed report content', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const cases = [
    { result: null, status: 502, code: 'report_result_invalid' },
    { result: { reports: [], criteria: null }, status: 502, code: 'report_result_invalid' },
    { result: { reports: [], criteria: [] }, status: 404, code: 'saved_report_missing' },
    {
      report: { status: 'pending', report_text: 'draft' },
      status: 409,
      code: 'saved_report_incomplete',
    },
    {
      report: { status: 'completed', report_text: '   ' },
      status: 502,
      code: 'saved_report_empty',
    },
  ];
  for (const fixture of cases) {
    await assert.rejects(
      backendApi(
        '/account/reports/old-run/context',
        {},
        async (path) => {
          if (path.endsWith('/result'))
            return Object.hasOwn(fixture, 'result')
              ? fixture.result
              : { criteria: [], reports: [{ id: 'body', status: 'completed' }] };
          assert.equal(path, '/reports/body');
          return fixture.report;
        },
        ApiError,
      ),
      (failure) => failure.status === fixture.status && failure.code === fixture.code,
    );
  }
});

function sourceMarkdown(id, role = '예시 직무', company = '예시 회사') {
  return {
    id,
    filename: `${id}.md`,
    content: `# ${id}. ${role}
- **회사명:** ${company}
- **공고명:** ${role} 채용
- **직무명:** ${role}
- **근무지:** 서울
- **고용형태:** 정규직
- **경력:** 신입
- **직무 소개:** 한글 직무 소개

### 3. 담당업무
- 원본 업무 설명

### 4. 자격요건
- 원본 자격 설명

### 5. 우대사항
- 원본 우대 설명
`,
  };
}

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

test('backend mode loads the career choices from the frontend job catalog', async () => {
  const requests = [];
  const request = async (path, options = {}) => {
    requests.push([path, options]);
    if (path === '/local-data/career-markdown')
      return { items: [sourceMarkdown('001'), sourceMarkdown('002')] };
    if (path === '/me') return { id: 'user-1', email: 'person@example.com' };
    throw new ApiError('not found', 404);
  };
  const session = await backendApi('/auth/session', {}, request, ApiError);
  assert.equal(session.user, null);
  assert.equal(session.csrf_token, '');
  const roles = await backendApi('/career-roles', {}, request, ApiError);
  assert.deepEqual(
    roles.items.map((role) => role.id),
    ['role-001', 'custom'],
  );
  assert.equal(roles.items[0].label, '예시 직무');
  assert.deepEqual(requests, [
    ['/local-guest/capabilities', { signal: undefined, auth: false }],
    ['/local-data/career-markdown', { signal: undefined, auth: false }],
  ]);
});

test('backend mode parses and opens a posting from its original Markdown', async () => {
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [sourceMarkdown('001')] };
    throw new Error(`Unexpected backend call: ${path}`);
  };
  const result = await backendApi(
    '/job-postings?role_id=role-001&page=1&page_size=20',
    {},
    request,
    ApiError,
  );
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'backup-001');
  assert.equal(result.items[0].source_type, 'example');
  const detail = await backendApi('/job-postings/backup-001', {}, request, ApiError);
  assert.match(detail.posting.description, /원본 업무 설명/);
  assert.match(detail.posting.source_markdown, /### 5\. 우대사항/);
});

test('registered Markdown jobs replace local mock duplicates and keep the backend UUID', async () => {
  globalThis.sessionStorage.setItem('careerlens.backend.access-token', 'real-access-token');
  const markdown = sourceMarkdown('001');
  const raw = {
    id: 'job-db-001',
    company_id: 'company-db-001',
    title: '등록 공고 제목',
    source_name: 'local_markdown',
    source_external_id: '001.md',
    description: markdown.content,
  };
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [markdown] };
    if (path === '/jobs?limit=100&include_details=true') return [{ ...raw, description: undefined }];
    if (path === '/jobs/job-db-001') return raw;
    if (path === '/companies/company-db-001') return { name: '예시 회사' };
    if (path === '/me') return { id: 'user-1' };
    if (path === '/resumes?limit=100') return [];
    throw new Error(`Unexpected backend call: ${path}`);
  };
  const list = await backendApi(
    '/job-postings?role_id=role-001&page=1&page_size=20',
    {},
    request,
    ApiError,
  );
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, 'job-db-001');
  assert.equal(list.items[0].source_type, 'backend');
  assert.equal(list.items[0].source_external_id, '001.md');
  assert.equal(list.items[0].role, '예시 직무');
  assert.equal(list.items[0].title, '등록 공고 제목');
  assert.equal(list.items[0].location, '서울');
  assert.equal(list.items[0].employment_type, '정규직');
  assert.equal(list.items[0].experience_level, '신입');
  assert.equal(list.items[0].source_markdown, markdown.content);
  assert.equal(list.items[0].is_example, true);

  const detail = await backendApi('/job-postings/job-db-001', {}, request, ApiError);
  assert.equal(detail.posting.id, 'job-db-001');
  assert.equal(detail.posting.company, '예시 회사');
  assert.equal(detail.posting.source_markdown, markdown.content);
  assert.equal(detail.posting.role, '예시 직무');
  assert.equal(detail.posting.is_example, true);

  const workspace = await backendApi(
    '/job-postings/job-db-001/select',
    { method: 'POST' },
    request,
    ApiError,
  );
  assert.equal(workspace.draft.selected_posting_id, 'job-db-001');
  assert.equal(workspace.draft.role, '예시 직무');
  assert.match(workspace.draft.job_text, /원본 업무 설명/);
});

test('legacy title classification links still filter exactly and preserve backend identities', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const sources = [
    sourceMarkdown('001', '데이터 분석'),
    sourceMarkdown('002', '데이터 분석 플랫폼 개발'),
  ];
  const jobs = sources.map((source, index) => ({
    id: `registered-${index + 1}`,
    title: '백엔드 공고 제목',
    source_name: 'local_markdown',
    source_external_id: source.filename,
    description: source.content,
  }));
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: sources };
    if (path === '/jobs?limit=100&include_details=true') return jobs;
    const job = jobs.find((item) => path === `/jobs/${item.id}`);
    if (job) return job;
    throw new Error(`Unexpected backend call: ${path}`);
  };
  const category = encodeURIComponent('데이터 분석');
  const result = await backendApi(`/job-postings?role_category=${category}`, {}, request, ApiError);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'registered-1');
  assert.equal(result.items[0].role, '데이터 분석');
  assert.deepEqual(result.filters.roles, ['데이터 분석', '데이터 분석 플랫폼 개발']);
  const empty = await backendApi('/job-postings?role_category=unknown', {}, request, ApiError);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.filters.roles, result.filters.roles);
});

for (const authenticated of [false, true]) {
  test(`${authenticated ? 'registered' : 'preview'} jobs can browse source classification, exact role and all jobs`, async () => {
    if (authenticated) sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
    const sources = [
      { ...sourceMarkdown('001', '모델 서빙 최적화'), role_category: '플랫폼·서빙' },
      { ...sourceMarkdown('002', '추론 플랫폼'), role_category: '플랫폼·서빙' },
      { ...sourceMarkdown('003', '검색 엔지니어'), role_category: 'RAG·데이터' },
      sourceMarkdown('004', '새로운 직무'),
    ];
    // A mention in the description must not make an exact-role match.
    sources[2].content += '\n모델 서빙 최적화 협업';
    const jobs = sources.map((source, index) => ({
      id: `registered-${index + 1}`,
      title: '등록 공고',
      source_name: 'local_markdown',
      source_external_id: source.filename,
    }));
    const request = async (path) => {
      if (path === '/local-data/career-markdown') return { items: sources };
      if (path === '/jobs?limit=100&include_details=true' && authenticated) return jobs;
      const index = jobs.findIndex((job) => path === `/jobs/${job.id}`);
      if (authenticated && index >= 0)
        return { ...jobs[index], description: sources[index].content };
      throw new Error(`Unexpected call: ${path}`);
    };
    const list = (query) => backendApi(`/job-postings?${query}`, {}, request, ApiError);
    const category = await list('role_id=role-001&role_scope=category');
    assert.equal(category.total, 2);
    assert.equal(category.available_total, 4);
    assert.equal(category.role_scope, 'category');
    assert.equal(category.role_category, '플랫폼·서빙');
    assert.deepEqual(
      category.items.map((item) => item.id),
      authenticated ? ['registered-1', 'registered-2'] : ['backup-001', 'backup-002'],
    );
    assert.ok(category.filters.roles.includes('플랫폼·서빙'));
    assert.ok(!category.filters.roles.includes('모델 서빙 최적화'));

    const exact = await list('role_id=role-001&role_scope=exact');
    assert.equal(exact.total, 1);
    assert.equal(exact.items[0].source_external_id, '001.md');
    const all = await list('role_id=role-001&role_scope=all&page_size=2&page=2');
    assert.equal(all.total, 4);
    assert.equal(all.role_scope, 'all');
    assert.deepEqual(
      all.items.map((item) => item.source_external_id),
      ['003.md', '004.md'],
    );

    const fromCatalog = await list(`role_category=${encodeURIComponent('플랫폼·서빙')}`);
    assert.equal(fromCatalog.total, 2);
    const missingCategory = await list('role_id=role-004&role_scope=category');
    assert.equal(missingCategory.total, 4);
    assert.equal(missingCategory.role_scope, 'all');
    assert.equal(missingCategory.role_category, '');
    const custom = await list(`role_id=custom&role=${encodeURIComponent('서빙')}&role_scope=all`);
    assert.equal(custom.total, 4);
    const keyword = await list(
      `role_id=custom&role=${encodeURIComponent('서빙')}&role_scope=category`,
    );
    assert.equal(keyword.role_scope, 'exact');
    assert.equal(keyword.total, 2);
  });
}

test('a filename shared by another source cannot borrow a local fixture identity or content', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const local = sourceMarkdown('001', '로컬 직무', '로컬 회사');
  const external = {
    id: 'external-job',
    company_id: 'external-company',
    source_name: 'external_feed',
    source_external_id: '001.md',
    title: '외부 직무',
    description: '외부 공고 본문',
    location: '부산',
  };
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [local, sourceMarkdown('002')] };
    if (path === '/jobs?limit=100&include_details=true') return [external];
    if (path === '/companies/external-company') return { name: '외부 회사' };
    if (path === '/jobs/external-job') return external;
    throw new Error(`Unexpected call: ${path}`);
  };
  const list = await backendApi('/job-postings', {}, request, ApiError);
  assert.equal(list.total, 1);
  assert.equal(list.items[0].company, '외부 회사');
  assert.equal(list.items[0].role, '외부 직무');
  assert.equal(list.items[0].is_example, false);
  const detail = await backendApi('/job-postings/external-job', {}, request, ApiError);
  assert.equal(detail.posting.description, '외부 공고 본문');
  assert.equal(detail.posting.source_markdown, '');
  assert.equal(detail.posting.location, '부산');
  assert.equal(detail.posting.source_type, 'backend');
});

test('an unmatched guest role returns an empty preview rather than inventing a posting', async () => {
  const result = await backendApi(
    '/job-postings?role_id=custom&role=의료%20서비스%20기획자&page=1&page_size=20',
    {},
    async (path) => {
      assert.equal(path, '/local-data/career-markdown');
      return { items: [] };
    },
    ApiError,
  );
  assert.equal(result.items.length, 0);
  assert.match(result.mock_notice, /로그인 후 백엔드 등록 공고/);
});

test('guest upload uses local conversion and keeps only tab staging plus response metadata', async () => {
  const form = new FormData();
  form.set('file', new Blob(['# Resume'], { type: 'text/markdown' }), 'resume.md');
  const result = await backendApi(
    '/guest/resume/upload',
    { method: 'POST', body: form },
    async (path) => {
      assert.equal(path, '/local-data/convert-resume');
      return { text: '# Resume' };
    },
    ApiError,
  );
  assert.equal(result.draft.resume_attached, true);
  assert.equal(result.draft.filename, 'resume.md');
  assert.ok(result.expires_at);
  assert.equal(Object.hasOwn(result.draft, 'resume_text'), false);
  assert.equal(
    JSON.parse(sessionStorage.getItem('careerlens.backend.guest')).resume_text,
    '# Resume',
  );
});

test('guest preview requires an attached unexpired resume and never starts real analysis', async () => {
  await assert.rejects(
    backendApi(
      '/guest/analysis',
      { method: 'POST' },
      async () => {
        throw new Error('Guest analysis must not call the backend');
      },
      ApiError,
    ),
    (error) => error.status === 409 && error.code === 'guest_expired',
  );
  assert.equal(sessionStorage.getItem('careerlens.backend.guest'), null);
});

test('PDF guest upload stages extracted text instead of a fake attachment', async () => {
  const form = new FormData();
  form.set('file', new Blob(['not parsed'], { type: 'application/pdf' }), 'resume.pdf');
  const result = await backendApi(
    '/guest/resume/upload',
    { method: 'POST', body: form },
    async (path) => {
      assert.equal(path, '/local-data/convert-resume');
      return { text: '# Extracted PDF resume' };
    },
    ApiError,
  );
  assert.equal(result.draft.mock_upload, undefined);
  assert.equal(result.draft.resume_attached, true);
  assert.equal(
    JSON.parse(globalThis.sessionStorage.getItem('careerlens.backend.guest')).resume_text,
    '# Extracted PDF resume',
  );
});

test('real member analysis never silently substitutes a demo report for an unregistered posting', async () => {
  await assert.rejects(
    backendApi(
      '/analysis',
      { method: 'POST' },
      async (path) => {
        if (path === '/me') return { id: 'user-1' };
        throw new Error(`Unexpected backend call: ${path}`);
      },
      ApiError,
    ),
    (error) => error.status === 409 && error.code === 'backend_posting_required',
  );
});

test('backend adapter forwards evaluation cancellation requests with keepalive', async () => {
  const requests = [];
  const request = async (path, options) => {
    requests.push({ path, options });
    return { run_id: 'run-1', status: 'cancelled' };
  };
  const result = await backendApi(
    '/evaluations/run-1/cancel',
    { method: 'POST', body: {}, keepalive: true },
    request,
    ApiError,
  );
  assert.deepEqual(result, { run_id: 'run-1', status: 'cancelled' });
  assert.equal(requests[0].path, '/evaluations/run-1/cancel');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.keepalive, true);
});

test('member backend analysis falls back to run status when progress events are unavailable', async () => {
  const reportText =
    '# 에이전트 최종 보고서\n\n종합점수: 보류\n\nYahoo Finance 조회 결과를 반영했습니다.';
  globalThis.sessionStorage.setItem('careerlens.backend.access-token', 'real-access-token');
  globalThis.sessionStorage.setItem(
    'careerlens.backend.workspace:user-1',
    JSON.stringify({
      resume_id: 'resume-1',
      selected_posting_id: 'job-1',
      selected_posting: {
        id: 'job-1',
        source_type: 'backend',
        company: '예시 기업',
        role: '예시 직무',
        description: '# 원본 공고',
      },
      suppress_latest_report: true,
    }),
  );
  const progressUpdates = [];
  const request = async (path, options = {}) => {
    if (path === '/me') return { id: 'user-1' };
    if (path === '/jobs/job-1')
      return { id: 'job-1', title: '실제 공고', description: '# 서버 공고' };
    if (path === '/resumes?limit=100') return [{ id: 'resume-1', title: '저장된 이력서' }];
    if (path === '/resumes/resume-1')
      return { id: 'resume-1', title: '저장된 이력서', original_text: '# 이력서' };
    if (path === '/evaluations' && options.method === 'POST') return { run_id: 'run-1' };
    if (path === '/evaluations/run-1/progress?after_id=0') throw new ApiError('Not Found', 404);
    if (path === '/evaluations/run-1')
      return {
        id: 'run-1',
        status: 'partial',
        current_stage: 'validation',
        progress_percent: 94,
        completed_at: '2026-10-10T10:20:00Z',
      };
    if (path === '/evaluations/run-1/result')
      return {
        overall_score: null,
        resume_completeness: 75,
        job_fit: 60,
        qualifications: 55,
        practical_competitiveness: 70,
        validation_status: 'partial',
        criteria: [],
        reports: [{ id: 'report-1' }],
      };
    if (path === '/reports/report-1')
      return {
        status: 'completed',
        report_text: reportText,
        completed_at: '2026-10-10T10:19:59Z',
      };
    throw new Error(`Unexpected backend call: ${path}`);
  };
  const result = await backendApi(
    '/analysis',
    { method: 'POST', onProgress: (update) => progressUpdates.push(update) },
    request,
    ApiError,
  );
  assert.equal(progressUpdates.length, 2);
  assert.equal(progressUpdates[0].run.current_stage, 'queued');
  assert.equal(progressUpdates[1].run.progress_percent, 94);
  assert.deepEqual(progressUpdates[1].events, []);
  assert.equal(result.report.source, 'backend');
  assert.equal(result.report.score, null);
  assert.equal(result.report.score_components.resume_completeness.score, 75);
  assert.equal(result.report.backend_report_text, reportText);
  assert.equal(result.report.status, 'partial');
  assert.equal(
    JSON.parse(sessionStorage.getItem('careerlens.backend.workspace:user-1')).report_created_at,
    '2026-10-10T10:19:59Z',
  );
});

function terminalAnalysisFixture(progressPage, { status = 'partial' } = {}) {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  sessionStorage.setItem('careerlens.backend.workspace:flow-member', JSON.stringify({
    resume_id: 'flow-resume', selected_posting_id: 'flow-job',
    selected_posting: { id: 'flow-job', source_type: 'backend' }, suppress_latest_report: true,
  }));
  const calls = [];
  const updates = [];
  const request = async (path, options = {}) => {
    calls.push(path);
    if (path === '/me') return { user_id: 'flow-member' };
    if (path === '/resumes?limit=100') return [{ id: 'flow-resume' }];
    if (path === '/resumes/flow-resume') return { id: 'flow-resume', original_text: '# PRIVATE_RESUME' };
    if (path === '/jobs/flow-job') return { id: 'flow-job', title: 'Fixture job', description: 'PRIVATE_JOB' };
    if (path === '/evaluations' && options.method === 'POST') return { run_id: 'flow-run', status: 'queued' };
    if (path.startsWith('/evaluations/flow-run/progress?after_id=')) return {
      run: {
        id: 'flow-run', status, current_stage: 'completed', progress_percent: 100,
        completed_at: '2026-10-12T10:00:00Z', failure_reason: 'PRIVATE_FAILURE', owner_email: 'PRIVATE_EMAIL',
      },
      events: await progressPage(Number(path.split('after_id=')[1])),
    };
    if (path === '/evaluations/flow-run/result') return {
      overall_score: null, validation_status: status, criteria: [], reports: [{ id: 'flow-report' }],
    };
    if (path === '/reports/flow-report') return { status: 'completed', report_text: '# Final fixture report' };
    assert.fail(`Unexpected fixture request: ${path}`);
  };
  return {
    calls, updates, request,
    run: () => backendApi('/analysis', { method: 'POST', onProgress: (update) => updates.push(update) }, request, ApiError),
  };
}

test('terminal analysis drains a full progress page before report fetch and exposes only sanitized flow metadata', async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1, stage: index === 0 ? 'parsing' : 'unsupported', status: 'running',
    message: index === 0 ? '이력서 문서 구조화 완료' : 'PRIVATE_MESSAGE', progress_percent: 8,
    run_id: 'PRIVATE_RUN', event_payload: { text: 'PRIVATE_PAYLOAD' }, created_at: 'PRIVATE_DATE',
  }));
  const fixture = terminalAnalysisFixture((after) => {
    if (after === 0) return first;
    assert.equal(after, 100, 'cursor advances over raw events even when the sanitizer drops them');
    return [
      { id: 101, stage: 'criterion', status: 'completed', message: 'D3 · 12/12개 항목 검증 및 저장 완료', progress_percent: 82, run_id: 'PRIVATE_RUN' },
      { id: 102, stage: 'validation', status: 'completed', message: '최종 Markdown 보고서 저장 완료', progress_percent: 99, event_payload: 'PRIVATE_PAYLOAD' },
      { id: 103, stage: 'completed', status: 'completed', message: '평가 및 Markdown 보고서 완료', progress_percent: 100 },
    ];
  });
  const result = await fixture.run();
  assert.deepEqual(fixture.calls.filter((path) => path.includes('/progress?')), [
    '/evaluations/flow-run/progress?after_id=0', '/evaluations/flow-run/progress?after_id=100',
  ]);
  assert.ok(fixture.calls.indexOf('/evaluations/flow-run/progress?after_id=100') < fixture.calls.indexOf('/evaluations/flow-run/result'));
  assert.equal(fixture.updates.length, 3);
  assert.ok(fixture.updates.every((update) => Array.isArray(update.events) && update.events.length === 0));
  assert.deepEqual(fixture.updates.flatMap((update) => update.flowEvents || []), [
    { id: 1, node: 'parse_resume', state: 'complete', progress: 8 },
    { id: 101, node: 'domain_d', state: 'complete', criterion: 'D3', progress: 82 },
    { id: 102, node: 'database', state: 'complete', progress: 99 },
    { id: 103, node: 'analysis', state: 'complete', progress: 100 },
  ]);
  assert.doesNotMatch(JSON.stringify(fixture.updates), /PRIVATE|event_payload|failure_reason|owner_email/);
  assert.ok(fixture.updates.slice(1).every(({ run }) => run.status === 'partial'));
  assert.equal(result.report.status, 'partial');
  assert.equal(result.report.score, null);
  assert.equal(result.report.backend_report_text, '# Final fixture report');
});

test('terminal telemetry draining is bounded and cannot fail an already available report', async () => {
  for (const mode of ['failure', 'repeated-page', 'endless-pages']) {
    const fixture = terminalAnalysisFixture((after) => {
      if (after && mode === 'failure') throw new ApiError('PRIVATE_TELEMETRY_ERROR', 503);
      const base = mode === 'repeated-page' ? 0 : after;
      return Array.from({ length: 100 }, (_, index) => ({
        id: base + index + 1, stage: 'unsupported', status: 'running', message: 'PRIVATE_EVENT',
      }));
    }, { status: 'completed' });
    const result = await fixture.run();
    assert.equal(result.report.status, 'completed');
    assert.equal(fixture.calls.filter((path) => path.includes('/progress?')).length, mode === 'endless-pages' ? 10 : 2);
    assert.equal(fixture.calls.at(-1), '/reports/flow-report');
    assert.doesNotMatch(JSON.stringify(fixture.updates), /PRIVATE/);
  }
});

test('claiming an incomplete guest upload transfers the actual resume but never an old mock report', async () => {
  const form = new FormData();
  form.set('file', new Blob(['# Guest resume'], { type: 'text/markdown' }), 'resume.md');
  await backendApi(
    '/guest/resume/upload',
    { method: 'POST', body: form },
    async (path) => {
      assert.equal(path, '/local-data/convert-resume');
      return { text: '# Guest resume' };
    },
    ApiError,
  );
  const staged = JSON.parse(sessionStorage.getItem('careerlens.backend.guest'));
  sessionStorage.setItem(
    'careerlens.backend.guest',
    JSON.stringify({ ...staged, report: { demo: true }, completed: true }),
  );
  const request = async (path, options = {}) => {
    if (path === '/me') return { id: 'user-1' };
    if (path === '/resumes?limit=100')
      return (!options.method || options.method === 'GET') &&
        globalThis.sessionStorage.getItem('resume-created')
        ? [{ id: 'resume-1', title: 'Guest resume' }]
        : [];
    if (path === '/resumes' && options.method === 'POST') {
      globalThis.sessionStorage.setItem('resume-created', 'true');
      return { id: 'resume-1', title: 'Guest resume' };
    }
    if (path === '/resumes/resume-1')
      return { id: 'resume-1', title: 'Guest resume', original_text: '# Guest resume' };
    if (path === '/evaluations?limit=1') return [];
    throw new Error(`Unexpected backend call: ${path}`);
  };
  const claimed = await backendApi('/guest/claim', { method: 'POST' }, request, ApiError);
  assert.equal(claimed.draft.resume_id, 'resume-1');
  assert.equal(claimed.draft.report, undefined);
  assert.equal(globalThis.sessionStorage.getItem('careerlens.backend.guest'), null);
});

test('a changed mock posting does not reload an older backend report', async () => {
  globalThis.sessionStorage.setItem(
    'careerlens.backend.workspace:user-1',
    JSON.stringify({ suppress_latest_report: true, selected_posting: { source_type: 'mock' } }),
  );
  const requests = [];
  const workspace = await backendApi(
    '/workspace',
    {},
    async (path) => {
      requests.push(path);
      if (path === '/me') return { id: 'user-1' };
      if (path === '/resumes?limit=100') return [];
      if (path === '/evaluations?limit=1') return [{ id: 'old-run', status: 'completed' }];
      throw new Error(`Unexpected backend call: ${path}`);
    },
    ApiError,
  );
  assert.equal(workspace.draft.report, undefined);
  assert.equal(requests.includes('/evaluations?limit=1'), false);
});

test('Supabase profile user_id scopes member sessions and saved workspace state', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'test-token');
  const request = async (path) => {
    if (path === '/me') return { user_id: 'supabase-user', display_name: '테스트' };
    if (path === '/resumes?limit=100') return [{ id: 'resume-1' }];
    if (path === '/resumes/resume-1') return { id: 'resume-1', original_text: 'Resume' };
    if (path === '/evaluations?limit=1') return [];
    throw new Error(`Unexpected call: ${path}`);
  };
  const session = await backendApi('/auth/session', {}, request, ApiError);
  assert.equal(session.user.id, 'supabase-user');
  assert.equal(session.user.name, '테스트');
  await backendApi('/workspace', {}, request, ApiError);
  assert.equal(
    JSON.parse(sessionStorage.getItem('careerlens.backend.workspace:supabase-user')).resume_id,
    'resume-1',
  );
  assert.equal(sessionStorage.getItem('careerlens.backend.workspace:undefined'), null);
});

test('a minimal authenticated profile uses a readable member label and keeps available email', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture');
  let profile = { user_id: 'member-1' };
  const request = async (path) => {
    assert.equal(path, '/me');
    return profile;
  };
  const minimal = await backendApi('/auth/session', {}, request, ApiError);
  assert.deepEqual(minimal.user, { id: 'member-1', email: '', name: '회원', is_admin: false });
  profile = { user_id: 'member-1', display_name: '  ', email: 'person@example.test' };
  const withEmail = await backendApi('/auth/session', {}, request, ApiError);
  assert.deepEqual(withEmail.user, {
    id: 'member-1',
    email: 'person@example.test',
    name: 'person@example.test',
    is_admin: false,
  });
});

const adminProfiles = [
  { label: 'boolean is_admin', profile: { is_admin: true }, expected: true },
  { label: 'exact admin role', profile: { role: 'admin' }, expected: true },
  {
    label: 'admin role with false flag',
    profile: { is_admin: false, role: 'admin' },
    expected: true,
  },
  { label: 'ordinary member', profile: {}, expected: false },
  { label: 'string flag', profile: { is_admin: 'true' }, expected: false },
  { label: 'numeric flag', profile: { is_admin: 1 }, expected: false },
  { label: 'role case variant', profile: { role: 'Admin' }, expected: false },
  { label: 'role whitespace', profile: { role: ' admin ' }, expected: false },
  {
    label: 'user-editable metadata',
    profile: { user_metadata: { is_admin: true, role: 'admin' } },
    expected: false,
  },
  { label: 'nested metadata', profile: { app_metadata: { role: 'admin' } }, expected: false },
  {
    label: 'administrator-looking email',
    profile: { email: 'admin@careerlens.example' },
    expected: false,
  },
];

for (const { label, profile, expected } of adminProfiles) {
  test(`admin status uses authenticated profile only: ${label}`, async () => {
    sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
    sessionStorage.setItem('careerlens.backend.is_admin', 'true');
    sessionStorage.setItem(
      'careerlens.backend.workspace:member',
      JSON.stringify({ is_admin: true }),
    );
    const controller = new AbortController();
    const session = await backendApi(
      '/auth/session',
      { signal: controller.signal },
      async (path, options) => {
        assert.equal(path, '/me');
        assert.equal(options.signal, controller.signal);
        return { user_id: 'member', ...profile };
      },
      ApiError,
    );
    assert.equal(session.user.is_admin, expected);
  });

  test(`verified callback uses authenticated profile only: ${label}`, async () => {
    const session = await acceptBackendAuthCallback(
      {
        accessToken: 'candidate-token',
        refreshToken: 'candidate-refresh',
      },
      async (path, options) => {
        assert.equal(path, '/me');
        assert.equal(options.auth, false);
        assert.equal(options.accessToken, 'candidate-token');
        assert.equal(sessionStorage.getItem('careerlens.backend.access-token'), null);
        return { user_id: 'member', ...profile };
      },
      ApiError,
    );
    assert.equal(session.user.is_admin, expected);
    assert.equal(sessionStorage.getItem('careerlens.backend.access-token'), 'candidate-token');
  });
}

test('PDF member upload is converted locally then sends Markdown to the unchanged backend', async () => {
  const body = new FormData();
  body.set('file', new Blob(['synthetic PDF bytes']), '경력.pdf');
  const controller = new AbortController();
  let uploaded = false;
  const request = async (path, options = {}) => {
    if (path === '/local-data/convert-resume') {
      assert.equal(options.body, body);
      assert.equal(options.signal, controller.signal);
      assert.equal(options.auth, false);
      return { filename: '경력.md', text: '# Parsed synthetic resume' };
    }
    if (path === '/resumes' && options.method === 'POST') {
      assert.equal(options.body.get('file').name, 'resume.md');
      assert.equal(await options.body.get('file').text(), '# Parsed synthetic resume');
      assert.equal(options.body.get('title'), '경력');
      assert.equal(options.signal, controller.signal);
      uploaded = true;
      return { id: 'resume-2', title: '경력' };
    }
    if (path === '/me') return { user_id: 'member-2' };
    if (path === '/resumes?limit=100') return [{ id: 'resume-2', title: '경력' }];
    if (path === '/resumes/resume-2')
      return { id: 'resume-2', original_text: '# Parsed synthetic resume' };
    throw new Error(`Unexpected call: ${path}`);
  };
  const workspace = await backendApi(
    '/resume/upload',
    { method: 'POST', body, signal: controller.signal },
    request,
    ApiError,
  );
  assert.equal(uploaded, true);
  assert.equal(workspace.draft.resume_id, 'resume-2');
});

test('a failed local conversion cannot create an empty backend resume', async () => {
  const body = new FormData();
  body.set('file', new Blob(['synthetic']), 'empty.pdf');
  const calls = [];
  await assert.rejects(
    backendApi(
      '/resume/upload',
      { method: 'POST', body },
      async (path) => {
        calls.push(path);
        return { text: '   ' };
      },
      ApiError,
    ),
    (error) => error.code === 'resume_text_empty',
  );
  assert.deepEqual(calls, ['/local-data/convert-resume']);
});

test('logout clears member credentials and cached reports without erasing unrelated app data', async () => {
  for (const key of [
    'careerlens.backend.access-token',
    'careerlens.backend.refresh-token',
    'careerlens.backend.workspace',
    'careerlens.backend.workspace:member-1',
    'careerlens.backend.workspace:member-2',
    'careerlens.backend.bookmarks',
  ]) {
    sessionStorage.setItem(key, 'private fixture');
  }
  sessionStorage.setItem('another-app', 'preserved');
  const session = await backendApi(
    '/auth/logout',
    { method: 'POST' },
    async () => {
      throw new Error('Unexpected request');
    },
    ApiError,
  );
  assert.equal(session.user, null);
  assert.equal(sessionStorage.length, 1);
  assert.equal(sessionStorage.getItem('another-app'), 'preserved');
});

test('guest navigation does not extend the initial upload retention deadline', async () => {
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  sessionStorage.setItem(
    'careerlens.backend.guest',
    JSON.stringify({ filename: 'sample.md', expires_at: expiresAt }),
  );
  const workspace = await backendApi(
    '/guest/career-target',
    { method: 'PUT', body: { role_id: 'custom', role: '테스트' } },
    async (path) => {
      assert.equal(path, '/local-data/career-markdown');
      return { items: [] };
    },
    ApiError,
  );
  assert.equal(workspace.expires_at, expiresAt);
});

test('an evaluation queued during cancellation still reports its run id for server cancellation', async () => {
  sessionStorage.setItem(
    'careerlens.backend.workspace:member-1',
    JSON.stringify({
      resume_id: 'resume-1',
      selected_posting_id: 'job-1',
      selected_posting: { source_type: 'backend', id: 'job-1' },
      suppress_latest_report: true,
    }),
  );
  const controller = new AbortController();
  const updates = [];
  await assert.rejects(
    backendApi(
      '/analysis',
      { method: 'POST', signal: controller.signal, onProgress: (update) => updates.push(update) },
      async (path, options = {}) => {
        if (path === '/me') return { user_id: 'member-1' };
        if (path === '/jobs/job-1')
          return { id: 'job-1', title: '실제 공고', description: '# 서버 공고' };
        if (path === '/resumes?limit=100') return [{ id: 'resume-1' }];
        if (path === '/resumes/resume-1') return { id: 'resume-1', original_text: 'Resume' };
        if (path === '/evaluations' && options.method === 'POST') {
          assert.equal(options.signal, undefined);
          controller.abort();
          return { run_id: 'queued-1', status: 'queued' };
        }
        throw new Error(`Unexpected call: ${path}`);
      },
      ApiError,
    ),
    { name: 'AbortError' },
  );
  assert.equal(updates[0].run.id, 'queued-1');
});

test('restoring a backend report preserves withheld totals and actual evaluation metadata', async () => {
  const criterion = {
    score: null,
    verdict: 'unknown',
    evaluation_criteria: { criterion_code: 'A1', name_ko: '근거' },
  };
  const result = {
    validation_status: 'hold',
    eligibility_status: 'unknown',
    resume_completeness: 85,
    job_fit: 65,
    criteria: [criterion],
    reports: [{ id: 'report-2' }],
  };
  const workspace = await backendApi(
    '/workspace',
    {},
    async (path) => {
      if (path === '/me') return { user_id: 'member-1' };
      if (path === '/resumes?limit=100') return [];
      if (path === '/evaluations?limit=1')
        return [{ id: 'run-2', status: 'partial', created_at: '2026-10-09T00:00:00Z' }];
      if (path === '/evaluations/run-2/result') return result;
      if (path === '/reports/report-2') return { report_text: '# 실제 보고서' };
      throw new Error(`Unexpected call: ${path}`);
    },
    ApiError,
  );
  const report = workspace.draft.report;
  assert.equal(report.score, null);
  assert.match(report.summary, /종합점수는 제공되지 않았습니다/);
  assert.doesNotMatch(report.summary, /로 인해/);
  assert.equal(report.status, 'partial');
  assert.equal(report.validation_status, 'hold');
  assert.equal(report.run_id, 'run-2');
  assert.deepEqual(report.backend_criteria, [criterion]);
  assert.deepEqual(report.backend_result, result);
  assert.equal(workspace.draft.created_at, '2026-10-09T00:00:00Z');
});

test('member listings contain registered backend jobs only, including empty-role matches', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture');
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [sourceMarkdown('001')] };
    if (path === '/jobs?limit=100&include_details=true') return [];
    throw new Error(`Unexpected call: ${path}`);
  };
  const list = await backendApi('/job-postings?role_id=role-001', {}, request, ApiError);
  assert.equal(list.total, 0);
  assert.deepEqual(list.items, []);
});

test('member role filtering finds registered postings after the first 100 records', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture');
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: `job-${index}`,
    title: '다른 직무',
  }));
  const controller = new AbortController();
  const request = async (path, options) => {
    calls.push(path);
    if (path === '/local-data/career-markdown')
      return { items: [sourceMarkdown('999', '후반 직무')] };
    assert.equal(options.signal, controller.signal);
    if (path === '/jobs?limit=100&include_details=true') return firstPage;
    if (path === '/jobs?limit=100&offset=100&include_details=true')
      return [
        {
          id: 'job-101',
          title: '후반 직무',
          source_name: 'local_markdown',
          source_external_id: '999.md',
        },
      ];
    if (path === '/jobs/job-101')
      return {
        id: 'job-101',
        title: '후반 직무',
        source_name: 'local_markdown',
        source_external_id: '999.md',
        description: sourceMarkdown('999', '후반 직무').content,
      };
    const detail = firstPage.find((job) => path === `/jobs/${job.id}`);
    if (detail) return { ...detail, description: '다른 직무의 실제 공고 본문' };
    throw new Error(`Unexpected call: ${path}`);
  };
  const list = await backendApi(
    '/job-postings?role_id=role-999',
    { signal: controller.signal },
    request,
    ApiError,
  );
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, 'job-101');
  assert.equal(list.items[0].source_type, 'backend');
  assert.ok(calls.includes('/jobs?limit=100&offset=100&include_details=true'));
});

for (const registered of [true, false]) {
  test(`guest claim ${registered ? 'maps the preview to the registered job UUID' : 'clears an unregistered preview but preserves the chosen role'}`, async () => {
    const selected = {
      id: 'backup-001',
      source_type: 'example',
      source_name: 'local_markdown',
      source_external_id: '001.md',
      company: '회사',
      role: '역할',
    };
    const careerTarget = { role_id: 'role-001', label: '역할', focus: '' };
    sessionStorage.setItem(
      'careerlens.backend.guest',
      JSON.stringify({
        resume_text: '# Staged resume',
        filename: 'resume.pdf',
        selected_posting: selected,
        career_target: careerTarget,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const actual = {
      id: 'real-job',
      source_name: 'local_markdown',
      source_external_id: '001.md',
      title: '실제 공고',
      description: '본문',
    };
    const calls = [];
    const request = async (path, options = {}) => {
      calls.push(path);
      if (path === '/me') return { user_id: 'member-1' };
      if (path === '/jobs?limit=100')
        return registered
          ? Array.from({ length: 100 }, (_, index) => ({
              id: `other-${index}`,
              title: '다른 공고',
            }))
          : [];
      if (path === '/jobs?limit=100&offset=100') return [actual];
      if (path === '/jobs/real-job') return actual;
      if (path === '/resumes' && options.method === 'POST') {
        assert.equal(await options.body.get('file').text(), '# Staged resume');
        return { id: 'resume-1', title: 'Resume' };
      }
      if (path === '/resumes?limit=100') return [{ id: 'resume-1' }];
      if (path === '/resumes/resume-1') return { id: 'resume-1', original_text: '# Staged resume' };
      throw new Error(`Unexpected call: ${path}`);
    };
    const claimed = await backendApi('/guest/claim', { method: 'POST' }, request, ApiError);
    assert.equal(claimed.draft.selected_posting_id, registered ? 'real-job' : undefined);
    assert.deepEqual(claimed.draft.career_target, careerTarget);
    assert.equal(claimed.draft.report, undefined);
    assert.equal(calls.includes('/evaluations'), false);
    assert.equal(calls.includes('/jobs?limit=100&offset=100'), registered);
    if (registered) {
      assert.equal(
        JSON.parse(sessionStorage.getItem('careerlens.backend.workspace:member-1')).selected_posting
          .is_example,
        true,
      );
    }
    assert.equal(sessionStorage.getItem('careerlens.backend.guest'), null);
  });
}

test('expired guest staging is rejected without creating a backend resume', async () => {
  sessionStorage.setItem(
    'careerlens.backend.guest',
    JSON.stringify({
      resume_text: '# Expired',
      expires_at: new Date(Date.now() - 1).toISOString(),
    }),
  );
  await assert.rejects(
    backendApi(
      '/guest/claim',
      { method: 'POST' },
      async () => {
        throw new Error('No server request expected');
      },
      ApiError,
    ),
    (error) => error.code === 'guest_expired',
  );
  assert.equal(sessionStorage.getItem('careerlens.backend.guest'), null);
});

function stageGuestPreviewInput(overrides = {}) {
  const guest = {
    resume_text: '# Private staged resume', filename: 'resume.md',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    selected_posting: {
      id: 'preview-job', source_type: 'example', source_name: 'local_markdown',
      source_external_id: '001.md', company: '선택 회사', role: '선택 역할',
    },
    ...overrides,
  };
  sessionStorage.setItem('careerlens.backend.guest', JSON.stringify(guest));
  return guest;
}

test('unavailable guest analysis rejects without substituting a short preview or login-after-analysis intent', async () => {
  const guest = stageGuestPreviewInput({ report: { score: 99, summary: 'PRIVATE OLD REPORT' } });
  const noNetwork = async () => assert.fail('Guest preview must not perform an API request');
  const session = await backendApi('/auth/session', {}, noNetwork, ApiError);
  assert.equal(session.capabilities.guest_analysis, false);
  assert.equal(session.capabilities.guest_report_preview, false);
  await assert.rejects(backendApi('/guest/analysis', { method: 'POST' }, noNetwork, ApiError),
    (failure) => failure.status === 503 && failure.code === 'guest_analysis_unavailable');
  const prepared = await backendApi('/guest/workspace', {}, noNetwork, ApiError);
  assert.equal(prepared.completed, false);
  assert.equal(prepared.preview_ready, false);
  assert.equal(prepared.analysis_pending, false);
  assert.equal(prepared.report_locked, false);
  assert.equal(prepared.expires_at, guest.expires_at);
  assert.doesNotMatch(JSON.stringify(prepared), /PRIVATE|Private staged|score|"report":/);
  assert.deepEqual(await backendApi('/guest/workspace', {}, noNetwork, ApiError), prepared);
  const stored = JSON.parse(sessionStorage.getItem('careerlens.backend.guest'));
  assert.equal(stored.report, null);
  assert.equal(stored.completed, false);
});

test('previously staged preview metadata cannot reopen a locked unanalysed report after reload', async () => {
  stageGuestPreviewInput({ preview_ready: true, analysis_pending: true, report_locked: true, completed: false });
  const prepared = await backendApi('/guest/workspace', {}, async () => assert.fail('No request expected'), ApiError);
  assert.equal(prepared.preview_ready, false);
  assert.equal(prepared.analysis_pending, false);
  assert.equal(prepared.report_locked, false);
  assert.equal(prepared.completed, false);
});

test('expired, unselected and aborted guest previews cannot create a locked result', async () => {
  const noNetwork = async () => assert.fail('No request expected');
  for (const expires_at of [new Date(Date.now() - 1).toISOString(), 'invalid']) {
    stageGuestPreviewInput({ expires_at, preview_ready: true, analysis_pending: true, report_locked: true, completed: false });
    const loaded = await backendApi('/guest/workspace', {}, noNetwork, ApiError);
    assert.equal(loaded.report_locked, false);
    assert.equal(sessionStorage.getItem('careerlens.backend.guest'), null);
    await assert.rejects(backendApi('/guest/analysis', { method: 'POST' }, noNetwork, ApiError), (error) => error.code === 'guest_expired');
  }
  stageGuestPreviewInput({ selected_posting: null });
  await assert.rejects(backendApi('/guest/analysis', { method: 'POST' }, noNetwork, ApiError), (error) => error.code === 'posting_required');
  stageGuestPreviewInput();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(backendApi('/guest/analysis', { method: 'POST', signal: controller.signal }, noNetwork, ApiError), { name: 'AbortError' });
  assert.equal((await backendApi('/guest/workspace', {}, noNetwork, ApiError)).report_locked, false);
});

for (const mutation of ['cancel', 'resume', 'role', 'posting']) {
  test(`guest ${mutation} clears preview intent without extending the first upload deadline`, async () => {
    const guest = stageGuestPreviewInput({ preview_ready: true, analysis_pending: true, report_locked: true, completed: false });
    const calls = [];
    const request = async (path) => {
      calls.push(path);
      if (path === '/local-data/career-markdown') return { items: [] };
      if (path === '/local-data/convert-resume') return { text: '# Replacement resume' };
      assert.fail('Unexpected request ' + path);
    };
    if (mutation === 'cancel') await backendApi('/guest/analysis/cancel', { method: 'POST' }, request, ApiError);
    if (mutation === 'role') await backendApi('/guest/career-target', { method: 'PUT', body: { role: '다른 역할' } }, request, ApiError);
    if (mutation === 'posting') await backendApi('/guest/job-postings/mock-data-analyst/select', { method: 'POST' }, request, ApiError);
    if (mutation === 'resume') {
      const form = new FormData(); form.set('file', new Blob(['# Replacement']), 'new.md');
      await backendApi('/guest/resume/upload', { method: 'POST', body: form }, request, ApiError);
    }
    const loaded = await backendApi('/guest/workspace', {}, request, ApiError);
    assert.equal(loaded.preview_ready, false);
    assert.equal(loaded.analysis_pending, false);
    assert.equal(loaded.report_locked, false);
    assert.equal(loaded.expires_at, guest.expires_at);
    if (mutation === 'cancel') assert.deepEqual(calls, []);
  });
}

function guestHandoffRequest(calls, { failCreation = false } = {}) {
  return async (path, options = {}) => {
    calls.push(path);
    if (path === '/me') return { user_id: 'handoff-member' };
    const job = { id: 'registered-job', source_name: 'local_markdown', source_external_id: '001.md',
      title: '현재 서버 공고', description: '현재 서버 본문' };
    if (path === '/jobs?limit=100') return [job];
    if (path === '/jobs/registered-job') return job;
    if (path === '/resumes' && options.method === 'POST') return { id: 'handoff-resume', title: 'Guest resume' };
    if (path === '/resumes?limit=100') return [{ id: 'handoff-resume' }];
    if (path === '/resumes/handoff-resume') return { id: 'handoff-resume', original_text: '# Private staged resume' };
    if (path === '/evaluations' && failCreation) throw new ApiError('Creation response unavailable', 503);
    assert.fail('Unexpected request ' + path);
  };
}

test('claim transfers older prepared input without replaying a preview intent into member analysis', async () => {
  stageGuestPreviewInput({ preview_ready: true, analysis_pending: true, report_locked: true, completed: false });
  const calls = []; const request = guestHandoffRequest(calls);
  sessionStorage.setItem('careerlens.backend.workspace:handoff-member', JSON.stringify({ report: { summary: 'OLD MEMBER REPORT' } }));
  const claimed = await backendApi('/guest/claim', { method: 'POST' }, request, ApiError);
  assert.notEqual(claimed.draft.pending_guest_analysis, true);
  assert.equal(claimed.draft.selected_posting_id, 'registered-job');
  assert.equal(claimed.draft.job_text, '현재 서버 본문');
  assert.equal(claimed.draft.report, undefined);
  assert.equal(calls.some((path) => path.startsWith('/evaluations')), false);
  assert.equal(sessionStorage.getItem('careerlens.backend.guest'), null);
  const reload = await backendApi('/workspace', {}, request, ApiError);
  assert.notEqual(reload.draft.pending_guest_analysis, true);
  assert.equal(reload.draft.report, undefined);
});

test('cancelled preview can still transfer its resume but does not auto-start member analysis', async () => {
  stageGuestPreviewInput({ preview_ready: true, analysis_pending: true, report_locked: true, completed: false });
  const calls = []; const request = guestHandoffRequest(calls);
  await backendApi('/guest/analysis/cancel', { method: 'POST' }, request, ApiError);
  const claimed = await backendApi('/guest/claim', { method: 'POST' }, request, ApiError);
  assert.notEqual(claimed.draft.pending_guest_analysis, true);
  assert.equal(claimed.draft.report, undefined);
  assert.equal(calls.some((path) => path.startsWith('/evaluations')), false);
});

test('uncertain evaluation creation consumes the automatic handoff so reload cannot submit it again', async () => {
  stageGuestPreviewInput();
  const calls = []; const request = guestHandoffRequest(calls, { failCreation: true });
  await backendApi('/guest/claim', { method: 'POST' }, request, ApiError);
  await assert.rejects(backendApi('/analysis', { method: 'POST' }, request, ApiError), (error) => error.status === 503);
  const reload = await backendApi('/workspace', {}, request, ApiError);
  assert.notEqual(reload.draft.pending_guest_analysis, true);
  assert.equal(reload.draft.report, undefined);
  assert.equal(calls.filter((path) => path === '/evaluations').length, 1);
  assert.equal(JSON.parse(sessionStorage.getItem('careerlens.backend.workspace:handoff-member')).pending_guest_analysis, false);
});

for (const changeAt of ['/me', '/jobs?limit=100', '/jobs/registered-job']) {
  test(`guest claim rejects an account change during ${changeAt} before any resume upload`, async () => {
    stageGuestPreviewInput();
    sessionStorage.setItem('careerlens.backend.access-token', 'account-a-token');
    const calls = []; const transport = guestHandoffRequest(calls);
    const request = async (path, options) => {
      const value = await transport(path, options);
      if (path === changeAt) sessionStorage.setItem('careerlens.backend.access-token', 'account-b-token');
      return value;
    };
    await assert.rejects(backendApi('/guest/claim', { method: 'POST' }, request, ApiError), { name: 'AbortError' });
    assert.equal(calls.includes('/resumes'), false);
    assert.equal(sessionStorage.getItem('careerlens.backend.workspace:handoff-member'), null);
    assert.ok(sessionStorage.getItem('careerlens.backend.guest'));
  });
}

test('guest replacement arriving after upload is preserved and never written as the old account draft', async () => {
  stageGuestPreviewInput();
  const calls = []; const transport = guestHandoffRequest(calls);
  let replacement;
  const request = async (path, options) => {
    const value = await transport(path, options);
    if (path === '/resumes') replacement = stageGuestPreviewInput({ resume_text: '# New upload', filename: 'replacement.md' });
    return value;
  };
  await assert.rejects(backendApi('/guest/claim', { method: 'POST' }, request, ApiError), { name: 'AbortError' });
  assert.equal(calls.filter((path) => path === '/resumes').length, 1);
  assert.deepEqual(JSON.parse(sessionStorage.getItem('careerlens.backend.guest')), replacement);
  assert.equal(sessionStorage.getItem('careerlens.backend.workspace:handoff-member'), null);
});

test('guest claim respects cancellation even when an upload transport ignores its signal', async () => {
  const original = stageGuestPreviewInput();
  const controller = new AbortController();
  const calls = []; const transport = guestHandoffRequest(calls);
  const request = async (path, options) => {
    const value = await transport(path, options);
    if (path === '/resumes') controller.abort();
    return value;
  };
  await assert.rejects(backendApi('/guest/claim', { method: 'POST', signal: controller.signal }, request, ApiError), { name: 'AbortError' });
  assert.deepEqual(JSON.parse(sessionStorage.getItem('careerlens.backend.guest')), original);
  assert.equal(sessionStorage.getItem('careerlens.backend.workspace:handoff-member'), null);
});

test('real reports preserve backend judgments, improvements and evidence without invented coaching', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const criteria = [
    {
      score: 85,
      verdict: 'met',
      confidence: 0.9,
      reasoning_summary: '역할과 구현 범위가 구체적으로 적혀 있습니다.',
      improvement_suggestion: '성과를 측정한 기간을 덧붙여 주세요.',
      validation_status: 'passed',
      comparison_basis: '공고에 적힌 기능 설계 책임',
      estimated: false,
      issues: [],
      evidence: [
        { source: 'resume', quote: 'API 기능을 설계했습니다.' },
        { source: 'job', quote: '기능 설계 담당' },
      ],
      evaluation_criteria: {
        criterion_code: 'A1',
        name_ko: '경험 설명',
        domain_code: 'resume_completeness',
        weight: 0.4,
      },
    },
    {
      score: null,
      verdict: 'not_applicable',
      confidence: 1,
      reasoning_summary: '공고에 우대 조건이 없습니다.',
      improvement_suggestion: '평가 제외이므로 보완 목록에 넣으면 안 됩니다.',
      validation_status: 'passed',
      evidence: [],
      comparison_basis: '',
      estimated: false,
      issues: [],
      evaluation_criteria: {
        criterion_code: 'B3',
        name_ko: '우대 역량',
        domain_code: 'job_fit',
        weight: 0.15,
      },
    },
    {
      score: 0,
      verdict: 'not_met',
      confidence: 1,
      reasoning_summary: '명시된 경력 조건에 미달합니다.',
      improvement_suggestion: '관련 고용경력의 시작일과 종료일을 정리해 주세요.',
      validation_status: 'passed',
      evidence: [],
      comparison_basis: '관련 경력 24개월',
      estimated: false,
      issues: [],
      evaluation_criteria: {
        criterion_code: 'C1',
        name_ko: '관련 경력',
        domain_code: 'qualifications',
        weight: 0.6,
      },
    },
    {
      score: null,
      verdict: 'unknown',
      confidence: 0.3,
      reasoning_summary: '운영 규모를 확인할 근거가 부족합니다.',
      improvement_suggestion: '',
      validation_status: 'needs_review',
      evidence: [],
      comparison_basis: '공고에 기재된 운영 규모',
      estimated: true,
      issues: ['운영 규모 확인 필요'],
      evaluation_criteria: {
        criterion_code: 'D1',
        name_ko: '업무 규모',
        domain_code: 'practical_competitiveness',
        weight: 0.35,
      },
    },
  ];
  const raw = {
    criteria,
    reports: [{ id: 'body', status: 'completed' }],
    resume_completeness: 85,
    job_fit: 70,
    qualifications: 0,
    practical_competitiveness: null,
    overall_score: null,
    validation_status: 'partial',
  };
  const restored = await backendApi(
    '/account/reports/run-1',
    {},
    async (path) => {
      if (path === '/evaluations/run-1') return { id: 'run-1', status: 'partial' };
      if (path === '/evaluations/run-1/result') return raw;
      if (path === '/reports/body') return { status: 'completed', report_text: '# 실제 보고서' };
      assert.fail(`Unexpected request: ${path}`);
    },
    ApiError,
  );
  const report = restored.draft.report;
  assert.deepEqual(report.backend_criteria, criteria);
  assert.deepEqual(report.backend_result, raw);
  assert.deepEqual(
    report.matches.map(({ status }) => status),
    ['confirmed', 'excluded', 'missing', 'partial'],
  );
  assert.equal(report.score_components.qualifications.score, 0);
  assert.equal(report.score_components.practical_competitiveness.score, null);
  assert.equal(report.score, null);
  assert.deepEqual(report.strengths, ['경험 설명: 역할과 구현 범위가 구체적으로 적혀 있습니다.']);
  assert.deepEqual(report.gaps, [
    '관련 경력: 명시된 경력 조건에 미달합니다.',
    '업무 규모: 운영 규모를 확인할 근거가 부족합니다.',
  ]);
  assert.deepEqual(report.priorities, [
    { title: '경험 설명', detail: criteria[0].improvement_suggestion },
    { title: '관련 경력', detail: criteria[2].improvement_suggestion },
  ]);
  assert.deepEqual(report.questions, []);
  assert.deepEqual(report.matches[0].evidence_items, [
    {
      source: 'resume',
      quote: 'API 기능을 설계했습니다.',
      excerpt: 'API 기능을 설계했습니다.',
      source_label: '이력서',
    },
    { source: 'job', quote: '기능 설계 담당', excerpt: '기능 설계 담당', source_label: '채용공고' },
  ]);
  assert.equal(report.criteria[0].verdict, 'met');
  assert.equal(report.criteria[0].weight, 0.4);
  assert.equal(report.criteria[0].domain_code, 'resume_completeness');
  assert.equal(report.criteria[0].improvement_suggestion, criteria[0].improvement_suggestion);
  assert.deepEqual(report.matches[3].issues, ['운영 규모 확인 필요']);
  assert.equal(report.matches[3].estimated, true);
  assert.equal(report.matches[3].confidence, 0.3);
  assert.equal(report.matches[3].comparison_basis, '공고에 기재된 운영 규모');
});

test('cached real reports are remapped from their saved backend values without retaining obsolete fake coaching', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  sessionStorage.setItem(
    'careerlens.backend.workspace:member',
    JSON.stringify({
      report: {
        source: 'backend',
        run_id: 'cached-run',
        status: 'completed',
        gaps: ['제외 항목을 보완하세요'],
        questions: ['임의로 만든 질문'],
        backend_report_text: '# 저장된 보고서',
        backend_result: {
          criteria: [
            {
              score: null,
              verdict: 'not_applicable',
              reasoning_summary: '조건이 없습니다.',
              evaluation_criteria: { criterion_code: 'C3' },
            },
          ],
        },
      },
    }),
  );
  const result = await backendApi(
    '/workspace',
    {},
    async (path) => {
      if (path === '/me') return { user_id: 'member' };
      if (path === '/resumes?limit=100') return [];
      assert.fail(`Cached report must not create or fetch a different evaluation: ${path}`);
    },
    ApiError,
  );
  assert.deepEqual(result.draft.report.gaps, []);
  assert.deepEqual(result.draft.report.questions, []);
  assert.equal(result.draft.report.matches[0].status, 'excluded');
  assert.equal(result.draft.report.run_id, 'cached-run');
});

test('registered jobs use current server fields and source text before stale local fixtures', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const local = { ...sourceMarkdown('001', '예전 직무', '예전 회사'), role_category: '예전 분류' };
  const serverMarkdown = sourceMarkdown('001', '새 직무', '서버 문서 회사').content;
  const raw = {
    id: 'job',
    company_id: 'company',
    title: '서버의 수정된 공고명',
    description: serverMarkdown,
    source_name: 'local_markdown',
    source_external_id: '001.md',
    location: '대전',
    employment_type: '계약직',
    career_min_months: 18,
    career_max_months: 30,
    requirements: ['서버 필수 기술'],
    preferred_requirements: ['서버 우대 기술'],
  };
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    if (path === '/local-data/career-markdown') return { items: [local] };
    if (path === '/jobs?limit=100&include_details=true')
      return [
        {
          id: 'job',
          title: raw.title,
          company_id: 'company',
          source_name: 'local_markdown',
          source_external_id: '001.md',
        },
      ];
    if (path === '/jobs/job') return raw;
    if (path === '/companies/company') return { name: '서버 기업명' };
    assert.fail(`Unexpected request: ${path}`);
  };
  const list = await backendApi('/job-postings', {}, request, ApiError);
  const { posting } = await backendApi('/job-postings/job', {}, request, ApiError);
  assert.deepEqual(list.items[0], posting);
  assert.equal(posting.title, raw.title);
  assert.equal(posting.company, '서버 기업명');
  assert.equal(posting.role, '새 직무');
  assert.equal(posting.role_category, '');
  assert.equal(posting.location, '대전');
  assert.equal(posting.employment_type, '계약직');
  assert.equal(posting.experience_level, '경력 1년 6개월~2년 6개월');
  assert.deepEqual(posting.skills, ['서버 필수 기술', '서버 우대 기술']);
  assert.equal(posting.source_markdown, serverMarkdown);
  assert.ok(posting.description.includes(serverMarkdown));
  assert.doesNotMatch(posting.description, /예전 직무|예전 회사/);
  assert.equal(calls.filter((path) => path === '/companies/company').length, 2);
});

test('missing registered job fields stay unavailable instead of borrowing a local fixture', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const local = sourceMarkdown('001', '로컬 직무', '로컬 기업');
  const result = await backendApi(
    '/job-postings/job',
    {},
    async (path) => {
      if (path === '/local-data/career-markdown') return { items: [local] };
      if (path === '/jobs/job')
        return {
          id: 'job',
          title: '등록 공고',
          source_name: 'local_markdown',
          source_external_id: '001.md',
          description: '서버 본문',
        };
      assert.fail(`Unexpected request: ${path}`);
    },
    ApiError,
  );
  assert.equal(result.posting.company, '기업 정보 없음');
  assert.equal(result.posting.location, '근무지 정보 없음');
  assert.equal(result.posting.employment_type, '정보 없음');
  assert.equal(result.posting.role, '등록 공고');
  assert.equal(result.posting.source_markdown, '서버 본문');
});

test('legacy summary-only job detail hydration has bounded concurrency, deduplicates company calls and uses detail fields for filtering', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const records = Array.from({ length: 9 }, (_, index) => ({
    id: `job-${index}`,
    title: `공고 ${index}`,
    company_id: 'company',
  }));
  const controller = new AbortController();
  let active = 0;
  let maximum = 0;
  let companies = 0;
  const result = await backendApi(
    `/job-postings?location=${encodeURIComponent('부산')}`,
    { signal: controller.signal },
    async (path, options) => {
      if (path === '/local-data/career-markdown') return { items: [] };
      assert.equal(options.signal, controller.signal);
      if (path === '/jobs?limit=100&include_details=true') return records;
      if (path === '/companies/company') {
        companies++;
        return { name: '등록 기업' };
      }
      const index = records.findIndex((record) => path === `/jobs/${record.id}`);
      assert.ok(index >= 0);
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return {
        ...records[index],
        description: '실제 본문',
        location: index === 8 ? '부산' : '서울',
      };
    },
    ApiError,
  );
  assert.equal(maximum, 4);
  assert.equal(companies, 1);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'job-8');
  assert.deepEqual(result.filters.locations, ['서울', '부산']);
});

test('member preparation does not synthesize resume statistics or complete unsupported stages', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [] };
    if (path === '/me') return { user_id: 'member' };
    if (path === '/resumes?limit=100') return [];
    assert.fail(`Unsupported preparation must not perform evaluation requests: ${path}`);
  };
  const workspace = await backendApi(
    '/career-target',
    { method: 'PUT', body: { role_id: 'custom', role: '개발자' } },
    request,
    ApiError,
  );
  assert.equal(workspace.draft.preparation.available, false);
  assert.equal(workspace.draft.preparation.complete, false);
  assert.deepEqual(workspace.draft.preparation.stages, []);
  assert.deepEqual(workspace.draft.preparation.resume_evidence, {});
  const stored = sessionStorage.getItem('careerlens.backend.workspace:member');
  for (const stage of ['resume', 'role', 'report']) {
    await assert.rejects(
      backendApi('/preparation', { method: 'POST', body: { stage } }, request, ApiError),
      (error) => error.status === 501 && error.code === 'preparation_unavailable',
    );
  }
  assert.equal(sessionStorage.getItem('careerlens.backend.workspace:member'), stored);
  const session = await backendApi('/auth/session', {}, request, ApiError);
  assert.equal(session.capabilities.preparation_analysis, false);
});

test('previously cached simulated preparation is not exposed as completed real analysis', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  sessionStorage.setItem(
    'careerlens.backend.workspace:member',
    JSON.stringify({
      suppress_latest_report: true,
      preparation: {
        complete: true,
        resume_evidence: {
          statement_count: 8,
          action_statement_count: 5,
          metric_statement_count: 2,
        },
        stages: [{ id: 'resume', status: 'complete' }],
      },
    }),
  );
  const workspace = await backendApi(
    '/workspace',
    {},
    async (path) => {
      if (path === '/me') return { user_id: 'member' };
      if (path === '/resumes?limit=100') return [];
      assert.fail(`Unexpected request: ${path}`);
    },
    ApiError,
  );
  assert.equal(workspace.draft.preparation.complete, false);
  assert.equal(workspace.draft.preparation.status, 'unavailable');
  assert.deepEqual(workspace.draft.preparation.resume_evidence, {});
});

test('member workspace refreshes a cached backend posting from the server before reuse', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const key = 'careerlens.backend.workspace:member';
  const target = { role_id: 'custom', label: '작성 중인 희망 직무' };
  sessionStorage.setItem(
    key,
    JSON.stringify({
      career_target: target,
      selected_posting_id: 'job',
      suppress_latest_report: true,
      selected_posting: {
        id: 'job',
        source_type: 'backend',
        company: '옛 회사',
        role: '옛 직무',
        description: '옛 로컬 본문',
      },
    }),
  );
  const controller = new AbortController();
  const workspace = await backendApi(
    '/workspace',
    { signal: controller.signal },
    async (path, options) => {
      assert.equal(options.signal, controller.signal);
      if (path === '/me') return { user_id: 'member' };
      if (path === '/resumes?limit=100') return [];
      if (path === '/jobs/job')
        return {
          id: 'job',
          company_id: 'company',
          title: '수정된 공고',
          description: '수정된 실제 본문',
        };
      if (path === '/companies/company') return { name: '수정된 회사' };
      assert.fail(`Unexpected request: ${path}`);
    },
    ApiError,
  );
  assert.equal(workspace.draft.role, '수정된 공고');
  assert.equal(workspace.draft.company, '수정된 회사');
  assert.equal(workspace.draft.job_text, '수정된 실제 본문');
  assert.deepEqual(workspace.draft.career_target, target);
  assert.equal(
    JSON.parse(sessionStorage.getItem(key)).selected_posting.description,
    '수정된 실제 본문',
  );
});

test('a removed selected backend posting is cleared while server failures never fall back to stale content', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const key = 'careerlens.backend.workspace:member';
  const state = JSON.stringify({
    selected_posting_id: 'job',
    suppress_latest_report: true,
    career_target: { role_id: 'custom', label: '내 희망 직무' },
    selected_posting: {
      id: 'job',
      source_type: 'backend',
      title: '옛 공고',
      description: '옛 본문',
    },
    report: {
      source: 'backend',
      run_id: 'old-run',
      backend_result: { criteria: [] },
      backend_report_text: '# 기존 결과',
    },
  });
  for (const status of [403, 503, 404]) {
    sessionStorage.setItem(key, state);
    const failure = new ApiError('Synthetic server response', status);
    const request = async (path) => {
      if (path === '/me') return { user_id: 'member' };
      if (path === '/resumes?limit=100') return [];
      assert.equal(path, '/jobs/job');
      throw failure;
    };
    if (status !== 404) {
      await assert.rejects(
        backendApi('/workspace', {}, request, ApiError),
        (error) => error === failure,
      );
      assert.equal(sessionStorage.getItem(key), state);
    } else {
      const workspace = await backendApi('/workspace', {}, request, ApiError);
      assert.equal(workspace.draft.selected_posting_id, undefined);
      assert.equal(workspace.draft.job_text, undefined);
      assert.equal(workspace.draft.report.run_id, 'old-run');
      assert.equal(workspace.draft.career_target.label, '내 희망 직무');
      const stored = JSON.parse(sessionStorage.getItem(key));
      assert.equal(stored.selected_posting, null);
      assert.equal(stored.selected_posting_id, '');
    }
  }
});

test('malformed detail responses use the provided API error type for both list hydration and individual lookup', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  for (const path of ['/job-postings', '/job-postings/job']) {
    for (const invalid of [null, {}, { id: 'different-job', description: '다른 공고' }]) {
      await assert.rejects(
        backendApi(
          path,
          {},
          async (requested) => {
            if (requested === '/local-data/career-markdown') return { items: [] };
            if (requested === '/jobs?limit=100&include_details=true') return [{ id: 'job', title: '공고' }];
            assert.equal(requested, '/jobs/job');
            return invalid;
          },
          ApiError,
        ),
        (error) =>
          error instanceof ApiError && error.status === 502 && error.code === 'job_invalid',
      );
    }
  }
});

test('incompatible old report cannot block login workspace, but auth failures still propagate', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  for (const status of [500, 503, 401]) {
    const action = backendApi(
      '/workspace',
      {},
      async (path) => {
        if (path === '/me') return { user_id: 'member' };
        if (path === '/resumes?limit=100') return [];
        if (path === '/evaluations?limit=1') return [{ id: 'legacy', status: 'partial' }];
        if (path === '/evaluations/legacy/result')
          throw new ApiError('Private server failure', status);
        assert.fail(`Unexpected request: ${path}`);
      },
      ApiError,
    );
    if (status === 401) await assert.rejects(action, (error) => error.status === 401);
    else {
      const workspace = await action;
      assert.equal(workspace.draft.resume_text, '');
      assert.equal(workspace.draft.report, undefined);
    }
  }
});

test('a public dashboard never makes an ordinary member an administrator', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const calls = [];
  const session = await backendApi(
    '/auth/session',
    {},
    async (path) => {
      calls.push(path);
      if (path === '/me') return { user_id: 'verified-member' };
      if (path === '/admin/evaluation-performance?days=1&run_limit=1')
        return { summary: { run_count: 0 }, stages: [], runs: [] };
      assert.fail(`Unexpected request: ${path}`);
    },
    ApiError,
  );
  assert.equal(session.user.is_admin, false);
  assert.deepEqual(calls, ['/local-guest/capabilities', '/me']);
});

test('dashboard availability does not override a server-owned profile admin flag', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  for (const response of [403, 503, {}]) {
    const calls = [];
    const session = await backendApi(
      '/auth/session',
      {},
      async (path) => {
        calls.push(path);
        if (path === '/me') return { user_id: 'member', is_admin: true };
        if (typeof response === 'number') throw new ApiError('Internal response', response);
        return response;
      },
      ApiError,
    );
    assert.equal(session.user.is_admin, true);
    assert.equal(session.user.id, 'member');
    assert.deepEqual(calls, ['/local-guest/capabilities', '/me']);
  }
});

test('callback validates only its profile without probing dashboard access', async () => {
  const calls = [];
  const session = await acceptBackendAuthCallback(
    { accessToken: 'candidate', refreshToken: 'refresh' },
    async (path, options) => {
      calls.push(path);
      assert.equal(options.accessToken, 'candidate');
      assert.equal(options.auth, false);
      assert.equal(sessionStorage.getItem('careerlens.backend.access-token'), null);
      return path === '/me' ? { user_id: 'member' } : { summary: {}, stages: [], runs: [] };
    },
    ApiError,
  );
  assert.equal(session.user.is_admin, false);
  assert.deepEqual(calls, ['/me']);
});

for (const mode of ['anonymous', 'member', 'demo']) {
  test(`dashboard requires a real member session without an administrator check in ${mode} mode`, async () => {
    if (mode === 'member')
      sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
    if (mode === 'demo') sessionStorage.setItem('careerlens.backend.demo-session', 'true');
    const controller = new AbortController();
    const payload = { summary: {}, runs: [], stages: [] };
    let calls = 0;
    const pending = backendApi(
      '/admin/evaluation-performance?days=7&run_limit=100',
      { signal: controller.signal },
      async (path, options) => {
        calls++;
        assert.equal(path, '/admin/evaluation-performance?days=7&run_limit=100');
        assert.equal(options.signal, controller.signal);
        assert.notEqual(options.auth, false);
        return payload;
      },
      ApiError,
    );
    if (mode === 'member') {
      assert.equal(await pending, payload);
      assert.equal(calls, 1);
    } else {
      await assert.rejects(pending, { status: 401 });
      assert.equal(calls, 0);
    }
  });
}

test('report summaries round display while preserving original backend scores', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const result = await backendApi(
    '/account/reports/run',
    {},
    async (path) => {
      if (path === '/evaluations/run') return { id: 'run', status: 'completed' };
      if (path === '/evaluations/run/result')
        return {
          overall_score: 81.125,
          resume_completeness: 67.5678,
          qualifications: 0,
          criteria: [],
          reports: [{ id: 'body', status: 'completed' }],
        };
      if (path === '/reports/body') return { status: 'completed', report_text: '# 실제 점수' };
      assert.fail(`Unexpected request: ${path}`);
    },
    ApiError,
  );
  assert.equal(result.draft.report.score, 81.125);
  assert.match(result.draft.report.summary, /종합점수는 81점/);
  assert.equal(result.draft.report.score_components.resume_completeness.score, 67.5678);
  assert.equal(result.draft.report.score_components.qualifications.score, 0);
});

test('uncertain member creation retries the same idempotent intent and a finished analysis releases it', async () => {
  const fixture = terminalAnalysisFixture(() => []);
  const keys = [];
  let loseResponse = true;
  const request = async (path, options = {}) => {
    if (path === '/evaluations' && options.method === 'POST') {
      keys.push(options.idempotencyKey);
      assert.match(options.idempotencyKey, /^[\da-f-]{36}$/i);
      if (loseResponse) { loseResponse = false; throw new ApiError('Lost response', 0); }
    }
    return fixture.request(path, options);
  };
  const analyze = () => backendApi('/analysis', { method: 'POST' }, request, ApiError);
  await assert.rejects(analyze(), { status: 0 });
  const pending = JSON.parse(sessionStorage.getItem('careerlens.backend.workspace:flow-member')).pending_evaluation;
  assert.equal(pending.idempotency_key, keys[0]);
  assert.equal((await analyze()).report.status, 'partial');
  assert.equal(keys[0], keys[1]);
  assert.equal(JSON.parse(sessionStorage.getItem('careerlens.backend.workspace:flow-member')).pending_evaluation, null);
  await analyze();
  assert.notEqual(keys[1], keys[2]);
});

test('a changed member analysis input and a different account never reuse an uncertain attempt', async () => {
  const fixture = terminalAnalysisFixture(() => []);
  const keys = [];
  const request = async (path, options = {}) => {
    if (path === '/evaluations') { keys.push(options.idempotencyKey); throw new ApiError('Lost response', 0); }
    if (path === '/jobs/other-job') return { id: 'other-job', title: 'Other job', description: 'Synthetic' };
    return fixture.request(path, options);
  };
  const analyze = () => backendApi('/analysis', { method: 'POST' }, request, ApiError);
  await assert.rejects(analyze(), { status: 0 });
  const stateKey = 'careerlens.backend.workspace:flow-member';
  sessionStorage.setItem(stateKey, JSON.stringify({ ...JSON.parse(sessionStorage.getItem(stateKey)),
    selected_posting_id: 'other-job', selected_posting: { id: 'other-job', source_type: 'backend' } }));
  await assert.rejects(analyze(), { status: 0 });
  assert.notEqual(keys[0], keys[1]);
  sessionStorage.setItem('careerlens.backend.access-token', 'another-account');
  sessionStorage.setItem('careerlens.backend.workspace:another-member', JSON.stringify({
    resume_id: 'flow-resume', selected_posting_id: 'flow-job', selected_posting: { id: 'flow-job', source_type: 'backend' }, suppress_latest_report: true,
  }));
  await assert.rejects(backendApi('/analysis', { method: 'POST' },
    (path, options) => path === '/me' ? { user_id: 'another-member' } : request(path, options), ApiError), { status: 0 });
  assert.notEqual(keys[1], keys[2]);
  assert.notEqual(keys[0], keys[2]);
});

test('concurrent same-intent member submissions share the pending key despite a slower workspace read', async () => {
  const fixture = terminalAnalysisFixture(() => []);
  let jobs = 0;
  let releaseSlowWorkspace;
  const slowWorkspace = new Promise((resolve) => { releaseSlowWorkspace = resolve; });
  let releaseCreates;
  const creates = new Promise((resolve) => { releaseCreates = resolve; });
  const keys = [];
  const request = async (path, options = {}) => {
    if (path === '/jobs/flow-job' && ++jobs === 2) await slowWorkspace;
    if (path === '/evaluations') {
      keys.push(options.idempotencyKey);
      releaseSlowWorkspace();
      if (keys.length === 2) releaseCreates();
      await creates;
    }
    return fixture.request(path, options);
  };
  await Promise.all([1, 2].map(() => backendApi('/analysis', { method: 'POST' }, request, ApiError)));
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test('a server-confirmed failed member run releases its creation key for a deliberate retry', async () => {
  const fixture = terminalAnalysisFixture(() => [], { status: 'failed' });
  const keys = [];
  const request = (path, options = {}) => {
    if (path === '/evaluations') keys.push(options.idempotencyKey);
    return fixture.request(path, options);
  };
  for (let attempt = 0; attempt < 2; attempt++)
    await assert.rejects(backendApi('/analysis', { method: 'POST' }, request, ApiError), { code: 'evaluation_failed' });
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test('member analysis tolerates verified refresh but rejects a switched owner during report loading', async () => {
  for (const change of ['refresh', 'switch']) {
    const fixture = terminalAnalysisFixture(() => []);
    const request = async (path, options) => {
      const result = await fixture.request(path, options);
      if (path === '/reports/flow-report') {
        if (change === 'refresh') storeBackendCredentials({ access_token: 'refreshed-same-member' }, captureBackendSession());
        else sessionStorage.setItem('careerlens.backend.access-token', 'different-member');
      }
      return result;
    };
    const pending = backendApi('/analysis', { method: 'POST' }, request, ApiError);
    if (change === 'refresh') assert.equal((await pending).report.status, 'partial');
    else {
      await assert.rejects(pending, { name: 'AbortError' });
      assert.equal(JSON.parse(sessionStorage.getItem('careerlens.backend.workspace:flow-member')).report, undefined);
    }
  }
});
