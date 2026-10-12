import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  backendApi,
  enableBackendAdapter,
} from '../../src/shared/api/backend-adapter.js';

function createStorage() {
  const values = new Map();
  return {
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
  assert.deepEqual(roles.items.map((role) => role.id), ['role-001', 'custom']);
  assert.equal(roles.items[0].label, '예시 직무');
  assert.deepEqual(requests, [['/local-data/career-markdown', { signal: undefined, auth: false }]]);
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
    title: '예시 직무 채용',
    source_name: 'local_markdown',
    source_external_id: '001.md',
    description: markdown.content,
  };
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [markdown] };
    if (path === '/jobs?limit=100')
      return [{ ...raw, description: undefined }];
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

  const detail = await backendApi('/job-postings/job-db-001', {}, request, ApiError);
  assert.equal(detail.posting.id, 'job-db-001');
  assert.equal(detail.posting.company, '예시 회사');
  assert.equal(detail.posting.source_markdown, markdown.content);

  const workspace = await backendApi(
    '/job-postings/job-db-001/select',
    { method: 'POST' },
    request,
    ApiError,
  );
  assert.equal(workspace.draft.selected_posting_id, 'job-db-001');
  assert.equal(workspace.draft.role, '예시 직무 채용');
});

test('backend mode uses mock opportunity data with an explicit example marker', async () => {
  const result = await backendApi(
    '/job-postings?role_id=custom&role=의료%20서비스%20기획자&page=1&page_size=20',
    {},
    async (path) => {
      assert.equal(path, '/local-data/career-markdown');
      return { items: [] };
    },
    ApiError,
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source_type, 'example');
  assert.match(result.items[0].description, /시연용 가상 공고/);
  assert.match(result.mock_notice, /실제 백엔드 평가에 사용할 수 없습니다/);
});

test('mock guest upload keeps its lifetime bounded and exposes metadata only', async () => {
  const form = new FormData();
  form.set('file', new Blob(['# Resume'], { type: 'text/markdown' }), 'resume.md');
  const result = await backendApi(
    '/guest/resume/upload',
    { method: 'POST', body: form },
    async () => {
      throw new Error('Guest upload must not call the backend');
    },
    ApiError,
  );
  assert.equal(result.draft.resume_attached, true);
  assert.equal(result.draft.filename, 'resume.md');
  assert.ok(result.expires_at);
  assert.equal(Object.hasOwn(result.draft, 'resume_text'), false);
});

test('guest mock analysis returns a clearly marked locked demonstration report', async () => {
  const form = new FormData();
  form.set('file', new Blob(['# Resume'], { type: 'text/markdown' }), 'resume.md');
  const request = async () => {
    throw new Error('Guest analysis must not call the backend');
  };
  await backendApi('/guest/resume/upload', { method: 'POST', body: form }, request, ApiError);
  const result = await backendApi('/guest/analysis', { method: 'POST' }, request, ApiError);
  assert.equal(result.completed, true);
  assert.equal(result.report_locked, true);
  assert.equal(result.draft.report_locked, true);
  assert.equal(result.draft.resume_attached, true);
  assert.equal(result.draft.demo_report, true);
});

test('unsupported guest resume formats never become account resume content', async () => {
  const form = new FormData();
  form.set('file', new Blob(['not parsed'], { type: 'application/pdf' }), 'resume.pdf');
  const result = await backendApi(
    '/guest/resume/upload',
    { method: 'POST', body: form },
    async () => {
      throw new Error('Mock guest upload must not call the backend');
    },
    ApiError,
  );
  assert.equal(result.draft.mock_upload, true);
  assert.equal(result.draft.resume_attached, true);
  assert.equal(
    JSON.parse(globalThis.sessionStorage.getItem('careerlens.backend.guest')).resume_text,
    '',
  );
});

test('member analysis for a mock posting saves an explicitly demo report', async () => {
  const result = await backendApi(
    '/analysis',
    { method: 'POST' },
    async (path) => {
      if (path === '/me') return { id: 'user-1' };
      throw new Error(`Unexpected backend call: ${path}`);
    },
    ApiError,
  );
  assert.equal(result.report.source, 'mock');
  assert.equal(result.report.demo, true);
  assert.match(result.report.summary, /화면 시연용 예시/);
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
  const reportText = '# 에이전트 최종 보고서\n\n종합점수: 보류\n\nYahoo Finance 조회 결과를 반영했습니다.';
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
    if (path === '/resumes?limit=100') return [{ id: 'resume-1', title: '저장된 이력서' }];
    if (path === '/resumes/resume-1')
      return { id: 'resume-1', title: '저장된 이력서', original_text: '# 이력서' };
    if (path === '/evaluations' && options.method === 'POST') return { run_id: 'run-1' };
    if (path === '/evaluations/run-1/progress?after_id=0')
      throw new ApiError('Not Found', 404);
    if (path === '/evaluations/run-1')
      return {
        id: 'run-1',
        status: 'partial',
        current_stage: 'validation',
        progress_percent: 94,
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
    if (path === '/reports/report-1') return { status: 'completed', report_text: reportText };
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
});

test('claiming a guest demo preserves the resume saved during the claim', async () => {
  const form = new FormData();
  form.set('file', new Blob(['# Guest resume'], { type: 'text/markdown' }), 'resume.md');
  await backendApi(
    '/guest/resume/upload',
    { method: 'POST', body: form },
    async () => {
      throw new Error('Guest upload must not call the backend');
    },
    ApiError,
  );
  await backendApi(
    '/guest/analysis',
    { method: 'POST' },
    async () => {
      throw new Error('Guest analysis must not call the backend');
    },
    ApiError,
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
  assert.equal(claimed.draft.report.demo, true);
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
